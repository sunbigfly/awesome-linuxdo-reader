import { discourseAvatarTemplateUrl } from '../discourse/native-host-api.js';
import { ReaderHeaderPopoverSurface } from
	'../collection/reader-header-popover-position.js';
import { usesNativeLinkNavigation } from '../dom/event-target.js';
import { replaceImageWithFallbackOnError } from '../components/reader-image-fallback.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderNotificationController,
	ReaderNotificationControllerSnapshot,
} from './reader-notification-controller.js';
import {
	readerNotificationGroup,
	type ReaderNotificationGroupKey,
	type ReaderNotificationMode,
	type ReaderNotificationRecord,
} from './reader-notification-model.js';

export interface ReaderNotificationPanelElements {
	readonly root: HTMLElement;
	readonly toggle: HTMLButtonElement;
	readonly badge: HTMLElement;
	readonly popover: HTMLElement;
	readonly modeTabs: readonly HTMLButtonElement[];
	readonly groupPanels: readonly HTMLElement[];
	readonly groupTabs: readonly HTMLButtonElement[];
	readonly toolbar: HTMLElement;
	readonly unreadStatus: HTMLElement;
	readonly markAll: HTMLButtonElement;
	readonly newMessage: HTMLAnchorElement;
	readonly search: HTMLInputElement;
	readonly searchClear: HTMLButtonElement;
	readonly list: HTMLElement;
	readonly pagePrevious: HTMLButtonElement;
	readonly pageInfo: HTMLElement;
	readonly pageNext: HTMLButtonElement;
}

export interface ReaderNotificationPanelViewOptions {
	readonly document: Document;
	readonly controller: ReaderNotificationController;
	readonly elements: ReaderNotificationPanelElements;
	readonly baseUrl: string;
	readonly relativeTime: (timestamp: string) => string;
	readonly renderIcon?: (name: string, document: Document) => Node;
	readonly avatarSource?: (template: string, size: number) => string | null;
	readonly schedule?: (callback: () => void, delayMs: number) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly parentScope?: LifecycleScope;
	readonly notify?: (message: string) => void;
	readonly onError?: (cause: unknown) => void;
}

function recordHref(record: ReaderNotificationRecord, baseUrl: string): string {
	if (record.target) {
		return new URL(
			`/t/${record.target.topicId}/${record.target.postNumber}`,
			baseUrl,
		).href;
	}
	try {
		return new URL(record.href || '/my/notifications', baseUrl).href;
	} catch {
		return new URL('/my/notifications', baseUrl).href;
	}
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error
		? cause.message
		: String(cause || '未知错误');
}

function dateGroup(
	createdAt: string,
	now: number,
): '今天' | '昨天' | '更早' {
	const timestamp = Date.parse(createdAt);
	if (!Number.isFinite(timestamp)) return '更早';
	const today = new Date(now);
	today.setHours(0, 0, 0, 0);
	const yesterday = today.getTime() - 24 * 60 * 60 * 1_000;
	if (timestamp >= today.getTime()) return '今天';
	if (timestamp >= yesterday) return '昨天';
	return '更早';
}

/**
 * 消息集合面板的唯一 DOM owner。
 *
 * View 只把 controller snapshot 投影到现行 class/ARIA，并把用户意图送回 controller；
 * 不拼 API、不读 current-user、不维护缓存、不猜 Topic 树和楼层加载状态。
 */
export class ReaderNotificationPanelView {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #controller: ReaderNotificationController;
	readonly #elements: ReaderNotificationPanelElements;
	readonly #baseUrl: string;
	readonly #relativeTime: (timestamp: string) => string;
	readonly #renderIcon: ((name: string, document: Document) => Node) | null;
	readonly #avatarSource: (template: string, size: number) => string | null;
	readonly #schedule: (callback: () => void, delayMs: number) => unknown;
	readonly #cancel: (handle: unknown) => void;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	readonly #surface: ReaderHeaderPopoverSurface;
	#relativeTimer: unknown = null;

	constructor(options: ReaderNotificationPanelViewOptions) {
		this.#document = options.document;
		this.#controller = options.controller;
		this.#elements = options.elements;
		this.#baseUrl = new URL(options.baseUrl).href;
		this.#relativeTime = options.relativeTime;
		this.#renderIcon = options.renderIcon ?? null;
		this.#avatarSource = options.avatarSource ??
			((template, size) =>
				discourseAvatarTemplateUrl(template, size, this.#baseUrl));
		this.#schedule = options.schedule ??
			((callback, delayMs) => setTimeout(callback, delayMs));
		this.#cancel = options.cancel ??
			((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#surface = new ReaderHeaderPopoverSurface({
			document: this.#document,
			root: this.#elements.root,
			toggle: this.#elements.toggle,
			popover: this.#elements.popover,
			parentScope: this.scope,
			isOpen: () => this.#controller.snapshot.open,
			requestClose: () => this.#controller.close(),
		});
		this.#bind();
		this.#controller.changes.subscribe((snapshot) => {
			this.#render(snapshot);
		}, this.scope);
		this.scope.add(() => {
			this.#stopRelativeTimer();
			this.#elements.list.replaceChildren();
		});
		this.#render(this.#controller.snapshot);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#bind(): void {
		this.scope.listen(this.#elements.toggle, 'click', () => {
			void this.#controller.toggle().catch((cause) => {
				this.#onError(cause);
				this.#notify('消息加载失败，请重试');
			});
		});
		for (const tab of this.#elements.modeTabs) {
			this.scope.listen(tab, 'click', () => {
				const mode = tab.dataset.notificationMode as ReaderNotificationMode;
				void this.#controller.selectMode(mode).catch((cause) => {
					this.#onError(cause);
					this.#notify('消息分类加载失败');
				});
			});
		}
		for (const tab of this.#elements.groupTabs) {
			this.scope.listen(tab, 'click', () => {
				const group = tab.dataset.notificationGroup as
					ReaderNotificationGroupKey;
				void this.#controller.selectGroup(group).catch((cause) => {
					this.#onError(cause);
					this.#notify('消息分类加载失败');
				});
			});
		}
		this.scope.listen(this.#elements.search, 'input', () => {
			this.#controller.setQuery(this.#elements.search.value);
		});
		this.scope.listen(this.#elements.searchClear, 'click', () => {
			this.#elements.search.value = '';
			this.#controller.setQuery('');
			this.#elements.search.focus();
		});
		this.scope.listen(this.#elements.pagePrevious, 'click', () => {
			void this.#controller.previousPage().catch(this.#onError);
		});
		this.scope.listen(this.#elements.pageNext, 'click', () => {
			void this.#controller.nextPage().catch(this.#onError);
		});
		this.scope.listen(this.#elements.markAll, 'click', () => {
			void this.#controller.markAllAsRead().then(() => {
				this.#notify('消息已全部标为已读');
			}).catch((cause) => {
				this.#onError(cause);
				this.#notify(`标记已读失败：${errorMessage(cause)}`);
			});
		});
		this.scope.listen(this.#elements.list, 'click', (eventValue) => {
			const event = eventValue as MouseEvent;
			const target = event.target as Element | null;
			const item = target?.closest
				? target.closest<HTMLAnchorElement>('.ldp-notification-item')
				: null;
			if (!item || !this.#elements.list.contains(item)) return;
			const identity = item.dataset.notificationKey;
			const record = this.#controller.snapshot.records.find((candidate) =>
				candidate.identity === identity);
			if (!record) return;
			if (!record.target || usesNativeLinkNavigation(event)) {
				void this.#controller.markRecordRead(record).catch(this.#onError);
				return;
			}
			event.preventDefault();
			void this.#controller.openRecord(record).catch((cause) => {
				this.#onError(cause);
				this.#notify('消息目标暂时无法打开');
			});
		});
	}

	#render(snapshot: ReaderNotificationControllerSnapshot): void {
		const {
			toggle,
			badge,
			unreadStatus,
			markAll,
			newMessage,
			search,
			searchClear,
			pagePrevious,
			pageInfo,
			pageNext,
		} = this.#elements;
		this.#surface.sync(snapshot.open);
		toggle.classList.toggle('active', snapshot.open);
		const badgeText = snapshot.unreadCount > 99
			? '99+'
			: String(snapshot.unreadCount);
		badge.hidden = snapshot.unreadCount <= 0;
		badge.textContent = snapshot.unreadCount > 0 ? badgeText : '';
		unreadStatus.textContent = snapshot.unreadCount > 0
			? `未读 ${snapshot.unreadCount} 条`
			: '没有未读消息';
		markAll.disabled = snapshot.unreadCount <= 0 ||
			snapshot.refreshing || snapshot.markingAll;
		markAll.dataset.ldpRequestBusy = snapshot.markingAll ? '1' : '0';
		markAll.setAttribute('aria-busy', String(snapshot.markingAll));
		const markAllLabel = this.#document.createElement('span');
		markAllLabel.textContent = snapshot.markingAll ? '处理中' : '全部已读';
		markAll.replaceChildren(
			renderReaderIcon(
				this.#document,
				snapshot.markingAll ? 'loader' : 'check-square',
				this.#renderIcon,
			),
			markAllLabel,
		);
		markAll.hidden =
			readerNotificationGroup(snapshot.group).source !== 'notifications';
		unreadStatus.hidden = markAll.hidden;
		newMessage.hidden = snapshot.mode !== 'messages';
		this.#elements.toolbar.hidden =
			markAll.hidden && snapshot.mode !== 'messages';
		for (const tab of this.#elements.modeTabs) {
			const active = tab.dataset.notificationMode === snapshot.mode;
			tab.classList.toggle('active', active);
			tab.setAttribute('aria-selected', String(active));
		}
		for (const panel of this.#elements.groupPanels) {
			panel.hidden = panel.dataset.notificationModePanel !== snapshot.mode;
		}
		for (const tab of this.#elements.groupTabs) {
			const active = tab.dataset.notificationGroup === snapshot.group;
			tab.classList.toggle('active', active);
			tab.setAttribute('aria-selected', String(active));
		}
		if (search.value !== snapshot.query) search.value = snapshot.query;
		searchClear.hidden = !snapshot.query;
		pagePrevious.disabled = snapshot.page <= 0 || snapshot.loading;
		pageNext.disabled =
			(!snapshot.hasNext && snapshot.page >= snapshot.totalPages - 1) ||
			snapshot.loading;
		if (snapshot.stale) {
			pageInfo.textContent = `${snapshot.page + 1} 页 · 缓存更新失败`;
			pageInfo.title = snapshot.error instanceof Error
				? snapshot.error.message
				: '无法更新缓存';
		} else {
			pageInfo.removeAttribute('title');
			pageInfo.textContent = snapshot.total > 0
				? `${snapshot.page + 1}/${snapshot.totalPages} · ${snapshot.total}`
				: snapshot.query ? '本地缓存' : `第 ${snapshot.page + 1} 页`;
		}
		this.#renderRecords(snapshot);
		if (snapshot.open) {
			this.#startRelativeTimer();
		} else {
			this.#stopRelativeTimer();
		}
	}

	#renderRecords(snapshot: ReaderNotificationControllerSnapshot): void {
		const list = this.#elements.list;
		if (snapshot.retrying && !snapshot.records.length) {
			const message = this.#document.createElement('div');
			message.className = 'ldp-notification-empty';
			message.textContent = '消息加载暂时中断，正在自动重试…';
			list.replaceChildren(message);
			return;
		}
		if (snapshot.loading && !snapshot.records.length) {
			const message = this.#document.createElement('div');
			message.className = 'ldp-notification-empty';
			message.textContent = '正在加载消息…';
			list.replaceChildren(message);
			return;
		}
		if (snapshot.error && !snapshot.stale && !snapshot.records.length) {
			const message = this.#document.createElement('div');
			message.className = 'ldp-notification-empty';
			message.textContent = '消息加载失败，请重试';
			list.replaceChildren(message);
			return;
		}
		if (!snapshot.records.length) {
			const message = this.#document.createElement('div');
			message.className = 'ldp-notification-empty';
			message.textContent = snapshot.query
				? '本地缓存中没有匹配消息'
				: '暂无消息';
			list.replaceChildren(message);
			return;
		}
		const grouped = new Map<string, ReaderNotificationRecord[]>();
		const now = Date.now();
		for (const record of snapshot.records) {
			const label = dateGroup(record.createdAt, now);
			const records = grouped.get(label) ?? [];
			records.push(record);
			grouped.set(label, records);
		}
		const fragment = this.#document.createDocumentFragment();
		for (const [label, records] of grouped) {
			const section = this.#document.createElement('section');
			section.className = 'ldp-notification-date-group';
			const heading = this.#document.createElement('div');
			heading.className = 'ldp-notification-date-label';
			heading.textContent = label;
			section.append(heading);
			for (const record of records) section.append(this.#recordNode(record));
			fragment.append(section);
		}
		list.replaceChildren(fragment);
	}

	#recordNode(record: ReaderNotificationRecord): HTMLAnchorElement {
		const item = this.#document.createElement('a');
		item.className = 'ldp-notification-item ldp-notification-message-item';
		item.classList.toggle('unread', record.read === false);
		item.href = recordHref(record, this.#baseUrl);
		item.dataset.notificationSource = record.sourceNotificationId === null
			? record.source
			: 'notifications';
		item.dataset.notificationId = String(record.sourceNotificationId ?? 0);
		item.dataset.notificationKey = record.identity;
		item.dataset.readerTargetSource =
			record.source === 'private-messages' ? 'message' : 'notification';
		item.dataset.ldpPreserveTargetPost = '1';
		if (record.target) {
			item.dataset.notificationTopicId = String(record.target.topicId);
			item.dataset.notificationPostNumber = String(record.target.postNumber);
		}
		const avatarUrl = this.#avatarSource(record.avatarTemplate, 48);
		if (avatarUrl) {
			const avatar = this.#document.createElement('img');
			avatar.className = 'ldp-notification-avatar';
			replaceImageWithFallbackOnError(avatar, () => {
				const fallback = this.#document.createElement('span');
				fallback.className = 'ldp-notification-avatar ldp-avatar-fallback';
				fallback.textContent =
					record.actor.slice(0, 1).toLocaleUpperCase() || '?';
				fallback.setAttribute('aria-hidden', 'true');
				return fallback;
			});
			avatar.src = avatarUrl;
			avatar.alt = '';
			avatar.loading = 'lazy';
			avatar.decoding = 'async';
			item.append(avatar);
		} else {
			const avatar = this.#document.createElement('span');
			avatar.className = 'ldp-notification-avatar ldp-avatar-fallback';
			avatar.textContent = record.actor.slice(0, 1).toLocaleUpperCase() || '?';
			avatar.setAttribute('aria-hidden', 'true');
			item.append(avatar);
		}
		const typeIcon = this.#document.createElement('span');
		typeIcon.className = 'ldp-notification-type-icon';
		typeIcon.dataset.notificationGroup = record.group;
		typeIcon.append(renderReaderIcon(
			this.#document,
			record.icon,
			this.#renderIcon,
		));
		const copy = this.#document.createElement('span');
		copy.className = 'ldp-notification-copy';
		const title = this.#document.createElement('span');
		title.className = 'ldp-notification-title';
		const titleText = this.#document.createElement('span');
		titleText.className = 'ldp-notification-title-text';
		titleText.textContent = record.summary;
		title.append(titleText);
		copy.append(title);
		if (record.excerpt) {
			const excerpt = this.#document.createElement('span');
			excerpt.className = 'ldp-notification-excerpt';
			excerpt.textContent = record.excerpt;
			copy.append(excerpt);
		}
		const meta = this.#document.createElement('span');
		meta.className = 'ldp-notification-meta';
		meta.dataset.notificationCreatedAt = record.createdAt;
		meta.textContent = this.#relativeTime(record.createdAt);
		copy.append(meta);
		item.append(typeIcon, copy);
		if (record.stateLabel) {
			const state = this.#document.createElement('span');
			state.className = 'ldp-notification-read-state';
			state.textContent = record.stateLabel;
			item.append(state);
		}
		return item;
	}

	#startRelativeTimer(): void {
		if (this.#relativeTimer !== null) return;
		const update = (): void => {
			this.#relativeTimer = null;
			if (!this.#controller.snapshot.open || this.scope.destroyed) return;
			for (const node of this.#elements.list.querySelectorAll<HTMLElement>(
				'[data-notification-created-at]',
			)) {
				node.textContent = this.#relativeTime(
					node.dataset.notificationCreatedAt ?? '',
				);
			}
			this.#relativeTimer = this.#schedule(update, 30_000);
		};
		this.#relativeTimer = this.#schedule(update, 30_000);
	}

	#stopRelativeTimer(): void {
		if (this.#relativeTimer === null) return;
		this.#cancel(this.#relativeTimer);
		this.#relativeTimer = null;
	}
}
