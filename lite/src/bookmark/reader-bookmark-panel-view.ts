import { discourseAvatarTemplateUrl } from '../discourse/native-host-api.js';
import { replaceImageWithFallbackOnError } from '../components/reader-image-fallback.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import { ReaderHeaderPopoverSurface } from
	'../collection/reader-header-popover-position.js';
import type {
	ReaderBookmarkController,
	ReaderBookmarkControllerSnapshot,
} from './reader-bookmark-controller.js';
import {
	READER_BOOKMARK_TAB_LABELS,
	type ReaderBookmarkRecord,
	type ReaderBookmarkSelectionScope,
	type ReaderBookmarkTab,
} from './reader-bookmark-model.js';

export interface ReaderBookmarkPanelElements {
	readonly root: HTMLElement;
	readonly toggle: HTMLButtonElement;
	readonly popover: HTMLElement;
	readonly tabs: readonly HTMLButtonElement[];
	readonly defaultActions: HTMLElement;
	readonly multiButton: HTMLButtonElement;
	readonly bulkActions: HTMLElement;
	readonly selectScope: HTMLSelectElement;
	readonly selectToggle: HTMLButtonElement;
	readonly deleteSelected: HTMLButtonElement;
	readonly deleteSelectedLabel: HTMLElement;
	readonly multiDone: HTMLButtonElement;
	readonly search: HTMLInputElement;
	readonly searchClear: HTMLButtonElement;
	readonly reactionFilters: HTMLElement;
	readonly list: HTMLElement;
	readonly pagePrevious: HTMLButtonElement;
	readonly pageInfo: HTMLElement;
	readonly pageNext: HTMLButtonElement;
}

export interface ReaderBookmarkDeleteConfirmation {
	readonly count: number;
	readonly title: string;
	readonly message: string;
	readonly confirmLabel: string;
}

export interface ReaderBookmarkPanelViewOptions {
	readonly document: Document;
	readonly controller: ReaderBookmarkController;
	readonly elements: ReaderBookmarkPanelElements;
	readonly baseUrl: string;
	readonly relativeTime: (timestamp: string) => string;
	readonly renderIcon?: (name: string, document: Document) => Node;
	readonly reactionIconSource?: (reaction: string) => string | null;
	readonly avatarSource?: (template: string, size: number) => string | null;
	readonly confirmDelete?: (
		request: ReaderBookmarkDeleteConfirmation,
	) => boolean | Promise<boolean>;
	readonly parentScope?: LifecycleScope;
	readonly notify?: (message: string) => void;
	readonly onError?: (cause: unknown) => void;
}

interface TabDrag {
	readonly tab: ReaderBookmarkTab;
	readonly pointerId: number;
	readonly x: number;
	readonly y: number;
	moved: boolean;
}

function targetHref(record: ReaderBookmarkRecord, baseUrl: string): string {
	return new URL(
		`/t/${record.topicId}/${record.postNumber}`,
		baseUrl,
	).href;
}

function errorMessage(cause: unknown): string {
	return cause instanceof Error
		? cause.message
		: String(cause || '未知错误');
}

/**
 * 收藏与回应中心的唯一 DOM owner。
 *
 * View 只投影 snapshot 并产生意图；不拼端点、不读 current-user、不维护集合缓存，也不
 * 直接调用 Discourse mutation。5px 拖动阈值只属于手势层，排序结果仍由 controller
 * 归一化并交给偏好端口持久化。
 */
export class ReaderBookmarkPanelView {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #controller: ReaderBookmarkController;
	readonly #elements: ReaderBookmarkPanelElements;
	readonly #baseUrl: string;
	readonly #relativeTime: (timestamp: string) => string;
	readonly #renderIcon: ((name: string, document: Document) => Node) | null;
	readonly #reactionIconSource: (reaction: string) => string | null;
	readonly #avatarSource: (template: string, size: number) => string | null;
	readonly #confirmDelete: (
		request: ReaderBookmarkDeleteConfirmation,
	) => boolean | Promise<boolean>;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	readonly #tabList: HTMLElement;
	readonly #surface: ReaderHeaderPopoverSurface;
	#tabDrag: TabDrag | null = null;
	#suppressTabClick = false;

	constructor(options: ReaderBookmarkPanelViewOptions) {
		this.#document = options.document;
		this.#controller = options.controller;
		this.#elements = options.elements;
		this.#baseUrl = new URL(options.baseUrl).href;
		this.#relativeTime = options.relativeTime;
		this.#renderIcon = options.renderIcon ?? null;
		this.#reactionIconSource = options.reactionIconSource ?? (() => null);
		this.#avatarSource = options.avatarSource ??
			((template, size) =>
				discourseAvatarTemplateUrl(template, size, this.#baseUrl));
		this.#confirmDelete = options.confirmDelete ?? (() => true);
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		const tabList = this.#elements.tabs[0]?.parentElement;
		if (!tabList) throw new Error('收藏面板缺少 tablist 锚点');
		this.#tabList = tabList;
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
		this.#controller.changes.subscribe(
			(snapshot) => this.#render(snapshot),
			this.scope,
		);
		this.scope.add(() => {
			for (const tab of this.#elements.tabs) {
				tab.classList.remove('ldp-bookmark-tab-dragging');
			}
			this.#tabDrag = null;
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
				this.#notify('收藏与回应加载失败，请重试');
			});
		});
		for (const tab of this.#elements.tabs) {
			this.scope.listen(tab, 'click', () => {
				if (this.#suppressTabClick) {
					this.#suppressTabClick = false;
					return;
				}
				void this.#controller.selectTab(
					tab.dataset.bookmarkType as ReaderBookmarkTab,
				).catch(this.#onError);
			});
			this.scope.listen(tab, 'pointerdown', (eventValue) => {
				const event = eventValue as PointerEvent;
				if (event.pointerType !== 'mouse' || event.button !== 0) return;
				this.#tabDrag = {
					tab: tab.dataset.bookmarkType as ReaderBookmarkTab,
					pointerId: event.pointerId,
					x: event.clientX,
					y: event.clientY,
					moved: false,
				};
				try {
					tab.setPointerCapture(event.pointerId);
				} catch {
					// Linkedom/旧内核可以没有 pointer capture；document 监听仍会收尾。
				}
			});
		}
		this.scope.listen(this.#tabList, 'pointermove', (eventValue) => {
			const event = eventValue as PointerEvent;
			const drag = this.#tabDrag;
			if (!drag || event.pointerId !== drag.pointerId) return;
			if (
				!drag.moved &&
				Math.hypot(event.clientX - drag.x, event.clientY - drag.y) < 5
			) return;
			drag.moved = true;
			const dragged = this.#elements.tabs.find((tab) =>
				tab.dataset.bookmarkType === drag.tab);
			if (!dragged) return;
			dragged.classList.add('ldp-bookmark-tab-dragging');
			event.preventDefault();
			const siblings = [...this.#elements.tabs].filter(
				(tab) => tab !== dragged,
			);
			const next = siblings.find((tab) => {
				const rect = tab.getBoundingClientRect();
				return event.clientX < rect.left + rect.width / 2;
			});
			this.#tabList.insertBefore(dragged, next ?? null);
		});
		const finishDrag = (eventValue: Event) => {
			const event = eventValue as PointerEvent;
			const drag = this.#tabDrag;
			if (!drag || event.pointerId !== drag.pointerId) return;
			const dragged = this.#elements.tabs.find((tab) =>
				tab.dataset.bookmarkType === drag.tab);
			this.#tabDrag = null;
			dragged?.classList.remove('ldp-bookmark-tab-dragging');
			if (!drag.moved) return;
			this.#suppressTabClick = true;
			const order = [...this.#tabList.querySelectorAll<HTMLElement>(
				'.ldp-bookmark-tab',
			)].map((tab) => tab.dataset.bookmarkType as ReaderBookmarkTab);
			void this.#controller.setTabOrder(order).catch(this.#onError);
		};
		this.scope.listen(this.#document, 'pointerup', finishDrag, true);
		this.scope.listen(this.#document, 'pointercancel', finishDrag, true);
		this.scope.listen(this.#elements.search, 'input', () => {
			this.#controller.setQuery(this.#elements.search.value);
		});
		this.scope.listen(this.#elements.searchClear, 'click', () => {
			this.#elements.search.value = '';
			this.#controller.setQuery('');
			this.#elements.search.focus();
		});
		this.scope.listen(this.#elements.reactionFilters, 'click', (eventValue) => {
			const target = (eventValue.target as Element | null)
				?.closest<HTMLButtonElement>('[data-reaction-filter]');
			if (!target) return;
			this.#controller.setReactionFilter(
				target.dataset.reactionFilter ?? '',
			);
		});
		this.scope.listen(this.#elements.pagePrevious, 'click', () =>
			this.#controller.previousPage());
		this.scope.listen(this.#elements.pageNext, 'click', () =>
			this.#controller.nextPage());
		this.scope.listen(this.#elements.multiButton, 'click', () =>
			this.#controller.enterMulti());
		this.scope.listen(this.#elements.multiDone, 'click', () =>
			this.#controller.exitMulti());
		this.scope.listen(this.#elements.selectScope, 'change', () =>
			this.#controller.setSelectionScope(
				this.#elements.selectScope.value as ReaderBookmarkSelectionScope,
			));
		this.scope.listen(this.#elements.selectToggle, 'click', () =>
			this.#controller.toggleScopeSelection());
		this.scope.listen(this.#elements.deleteSelected, 'click', () => {
			if (this.#elements.deleteSelected.dataset.ldpRequestBusy === '1') return;
			void this.#deleteSelected();
		});
		this.scope.listen(this.#elements.list, 'change', (eventValue) => {
			const target = eventValue.target;
			if (
				!(target instanceof HTMLInputElement) ||
				!target.matches('.ldp-bookmark-select-input')
			) {
				return;
			}
			const item = target.closest<HTMLElement>('[data-bookmark-id]');
			this.#controller.toggleSelection(Number(item?.dataset.bookmarkId));
		});
		this.scope.listen(this.#elements.list, 'click', (eventValue) => {
			const event = eventValue as MouseEvent;
			const target = event.target as Element | null;
			const item = target?.closest<HTMLElement>(
				'[data-bookmark-key]',
			);
			if (!item || !this.#elements.list.contains(item)) return;
			const record = this.#controller.snapshot.records.find((candidate) =>
				candidate.identity === item.dataset.bookmarkKey);
			if (!record) return;
			if (target?.closest('.ldp-bookmark-select')) return;
			if (target?.closest('.ldp-bookmark-delete')) {
				event.preventDefault();
				void this.#deleteOne(
					record,
					target.closest<HTMLButtonElement>('.ldp-bookmark-delete'),
				);
				return;
			}
			event.preventDefault();
			void this.#controller.openRecord(record).catch((cause) => {
				this.#onError(cause);
				this.#notify('收藏目标暂时无法打开');
			});
		});
	}

	async #deleteOne(
		record: ReaderBookmarkRecord,
		button: HTMLButtonElement | null,
	): Promise<void> {
		if (
			record.bookmarkId === null ||
			!button ||
			button.dataset.ldpRequestBusy === '1'
		) return;
		this.#setControlBusy(button, true);
		try {
			await this.#controller.deleteBookmark(record.bookmarkId);
			this.#notify('已取消这条收藏');
		} catch (cause) {
			this.#onError(cause);
			this.#notify(`取消收藏失败：${errorMessage(cause)}`);
		} finally {
			this.#setControlBusy(button, false);
		}
	}

	async #deleteSelected(): Promise<void> {
		const bookmarkIds = [
			...this.#controller.snapshot.selectedBookmarkIds,
		].sort((left, right) => left - right);
		const count = bookmarkIds.length;
		if (!count) return;
		const confirmed = await this.#confirmDelete({
			count,
			title: '取消所选收藏',
			message: `确定取消所选 ${count} 条收藏吗？`,
			confirmLabel: '全部取消',
		});
		if (!confirmed) return;
		this.#setControlBusy(this.#elements.deleteSelected, true);
		try {
			await this.#controller.deleteSelected(bookmarkIds);
			this.#notify(`已取消 ${count} 条收藏`);
		} catch (cause) {
			this.#onError(cause);
			this.#notify(`批量取消收藏失败：${errorMessage(cause)}`);
		} finally {
			this.#setControlBusy(this.#elements.deleteSelected, false);
		}
	}

	#render(snapshot: ReaderBookmarkControllerSnapshot): void {
		const elements = this.#elements;
		this.#surface.sync(snapshot.open);
		const tabs = new Map(this.#elements.tabs.map((tab) => [
			tab.dataset.bookmarkType as ReaderBookmarkTab,
			tab,
		]));
		for (const type of snapshot.tabOrder) {
			const tab = tabs.get(type);
			if (tab) this.#tabList.append(tab);
		}
		for (const tab of elements.tabs) {
			const type = tab.dataset.bookmarkType as ReaderBookmarkTab;
			const active = type === snapshot.tab;
			tab.classList.toggle('active', active);
			tab.setAttribute('aria-selected', String(active));
		}
		const reaction = snapshot.tab === 'Reaction';
		elements.defaultActions.hidden = snapshot.multi;
		elements.bulkActions.hidden = !snapshot.multi || reaction;
		elements.multiButton.disabled = reaction || snapshot.total === 0;
		for (const option of elements.selectScope.options) {
			option.selected = option.value === snapshot.selectionScope;
		}
		const scopeIds = snapshot.selectionScope === 'all'
			? snapshot.scopeBookmarkIds
			: snapshot.visibleBookmarkIds;
		const allSelected = scopeIds.length > 0 &&
			scopeIds.every((id) => snapshot.selectedBookmarkIds.has(id));
		elements.selectToggle.setAttribute('aria-pressed', String(allSelected));
		elements.selectToggle.setAttribute(
			'aria-label',
			`${allSelected ? '全不选' : '全选'}${
				snapshot.selectionScope === 'all' ? '全部页面' : '本页'
			}收藏`,
		);
		this.#replaceIcon(elements.selectToggle, allSelected
			? 'check-square'
			: 'square');
		elements.deleteSelected.disabled =
			snapshot.selectedBookmarkIds.size === 0;
		elements.deleteSelectedLabel.textContent =
			String(snapshot.selectedBookmarkIds.size);
		elements.deleteSelectedLabel.hidden =
			snapshot.selectedBookmarkIds.size === 0;
		elements.search.placeholder = reaction
			? '搜索回应、帖子或用户'
			: '搜索收藏标题或内容';
		elements.search.setAttribute(
			'aria-label',
			reaction ? '搜索回应记录' : '搜索收藏',
		);
		if (elements.search.value !== snapshot.query) {
			elements.search.value = snapshot.query;
		}
		elements.searchClear.hidden = !snapshot.query;
		this.#renderReactionFilters(snapshot);
		this.#renderList(snapshot);
		elements.pagePrevious.disabled = snapshot.page <= 0 ||
			snapshot.loading;
		elements.pageNext.disabled = !snapshot.hasNext || snapshot.loading;
		elements.pageInfo.textContent = snapshot.total
			? `${snapshot.page + 1} / ${snapshot.totalPages}`
			: '暂无记录';
	}

	#renderReactionFilters(snapshot: ReaderBookmarkControllerSnapshot): void {
		const host = this.#elements.reactionFilters;
		host.replaceChildren();
		host.hidden =
			snapshot.tab !== 'Reaction' || snapshot.reactionFilters.size === 0;
		if (host.hidden) return;
		const filters = [['', [...snapshot.reactionFilters.values()].reduce(
			(total, count) => total + count,
			0,
		)] as const, ...snapshot.reactionFilters];
		for (const [reaction, count] of filters) {
			const button = this.#document.createElement('button');
			button.type = 'button';
			button.className = 'ldp-reaction-filter';
			button.dataset.reactionFilter = reaction;
			const active = reaction === snapshot.reactionFilter;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
			const label = reaction
				? this.#reactionIcon(reaction)
				: this.#document.createElement('span');
			if (!reaction) label.textContent = '全部';
			const number = this.#document.createElement('span');
			number.className = 'ldp-reaction-filter-count';
			number.textContent = String(count);
			button.append(label, number);
			button.setAttribute(
				'aria-label',
				reaction ? `只看 ${reaction} 回应，共 ${count} 条` : `全部回应，共 ${count} 条`,
			);
			host.append(button);
		}
	}

	#renderList(snapshot: ReaderBookmarkControllerSnapshot): void {
		const host = this.#elements.list;
		host.replaceChildren();
		if (snapshot.loading && !snapshot.records.length) {
			host.append(this.#message(
				`正在加载${snapshot.tab === 'Reaction' ? '回应' : '收藏'}…`,
			));
			return;
		}
		if (snapshot.error && !snapshot.stale && !snapshot.records.length) {
			const message = this.#message(
				`${snapshot.tab === 'Reaction' ? '回应记录' : '收藏'}加载失败`,
				true,
			);
			const retry = this.#document.createElement('button');
			retry.type = 'button';
			retry.className = 'ldp-collection-retry';
			retry.textContent = '重试';
			retry.addEventListener('click', () => {
				retry.disabled = true;
				void this.#controller.refresh().catch(this.#onError);
			}, { once: true });
			message.append(retry);
			host.append(message);
			return;
		}
		if (snapshot.stale) {
			host.append(this.#message('刷新失败，正在显示上次已加载内容', true));
		}
		if (!snapshot.records.length) {
			if (snapshot.tab === 'Reaction' && !snapshot.query) {
				host.append(this.#message(
					'暂无回应记录；在楼层下方点回应后会出现在这里。',
				));
				return;
			}
			const kind = snapshot.tab === 'Reaction'
				? '回应记录'
				: `${READER_BOOKMARK_TAB_LABELS[snapshot.tab]}收藏`;
			host.append(this.#message(
				snapshot.query ? `没有匹配的${kind}` : `暂无${kind}`,
			));
			return;
		}
		for (const record of snapshot.records) {
			host.append(this.#record(record, snapshot));
		}
	}

	#record(
		record: ReaderBookmarkRecord,
		snapshot: ReaderBookmarkControllerSnapshot,
	): HTMLElement {
		const item = this.#document.createElement('div');
		item.className = record.tab === 'Reaction'
			? 'ldp-reaction-record ldp-collection-item'
			: 'ldp-bookmark-item ldp-collection-item';
		item.dataset.bookmarkKey = record.identity;
		if (record.bookmarkId !== null) {
			item.dataset.bookmarkId = String(record.bookmarkId);
			const selected = snapshot.selectedBookmarkIds.has(record.bookmarkId);
			item.classList.toggle('multi', snapshot.multi);
			item.classList.toggle('selected', selected);
			if (snapshot.multi) {
				const label = this.#document.createElement('label');
				label.className =
					'ldp-bookmark-select ldp-collection-select';
				const input = this.#document.createElement('input');
				input.className =
					'ldp-bookmark-select-input ldp-collection-select-input';
				input.type = 'checkbox';
				input.checked = selected;
				input.setAttribute('aria-label', `选择《${record.title}》`);
				label.append(input);
				item.append(label);
			}
		}
		const link = this.#document.createElement('a');
		link.className = 'ldp-notification-item ldp-bookmark-link';
		link.href = targetHref(record, this.#baseUrl);
		link.dataset.ldpPreserveTargetPost = '1';
		link.append(this.#avatar(record));
		const copy = this.#document.createElement('span');
		copy.className = 'ldp-notification-copy';
		const title = this.#document.createElement('strong');
		title.className = 'ldp-notification-title';
		title.textContent = record.title;
		const meta = this.#document.createElement('span');
		meta.className = 'ldp-notification-meta';
		const user = record.authorUsername
			? ` · @${record.authorUsername}`
			: '';
		const time = record.createdAt
			? ` · ${this.#relativeTime(record.createdAt)}`
			: '';
		if (record.tab === 'Reaction') {
			meta.append(
				this.#reactionIcon(record.reaction, 'ldp-reaction-record-icon'),
				this.#document.createTextNode(
					`回应 · 楼层 #${record.postNumber}${user}${time}`,
			),
			);
		} else {
			meta.textContent = `${record.tab === 'Post'
				? `楼层 #${record.postNumber}`
				: '帖子'}${
			record.highestPostNumber
				? ` · ${record.highestPostNumber} 帖`
				: ''
			}${record.name ? ` · ${record.name}` : ''}${time}`;
		}
		copy.append(title, meta);
		link.append(copy);
		item.append(link);
		if (record.bookmarkId !== null && !snapshot.multi) {
			const remove = this.#document.createElement('button');
			remove.type = 'button';
			remove.className =
				'ldp-bookmark-delete ldp-collection-delete';
			remove.setAttribute('aria-label', '取消这条收藏');
			remove.append(renderReaderIcon(
				this.#document,
				'trash',
				this.#renderIcon,
			));
			item.append(remove);
		}
		return item;
	}

	#avatar(record: ReaderBookmarkRecord): HTMLElement {
		const source = this.#avatarSource(record.avatarTemplate, 64);
		let avatar: HTMLElement;
		if (source) {
			const image = this.#document.createElement('img');
			image.className = 'ldp-notification-avatar';
			replaceImageWithFallbackOnError(image, () => {
				const fallback = this.#document.createElement('span');
				fallback.className =
					'ldp-notification-avatar ldp-notification-avatar-fallback';
				fallback.textContent =
					(record.authorUsername || record.title || '?')
						.slice(0, 1)
						.toLocaleUpperCase();
				return fallback;
			});
			image.src = source;
			image.alt = '';
			image.loading = 'lazy';
			image.decoding = 'async';
			avatar = image;
		} else {
			const fallback = this.#document.createElement('span');
			fallback.className =
				'ldp-notification-avatar ldp-notification-avatar-fallback';
			if (record.tab === 'Reaction') {
				fallback.textContent =
					(record.authorUsername || '?').slice(0, 1).toLocaleUpperCase();
			} else {
				fallback.append(renderReaderIcon(
					this.#document,
					'bookmark',
					this.#renderIcon,
				));
			}
			avatar = fallback;
		}
		if (!record.authorUsername || (!source && record.tab !== 'Reaction')) {
			return avatar;
		}
		const wrapper = this.#document.createElement('span');
		wrapper.className = 'ldp-user-avatar-card';
		wrapper.dataset.userCard = record.authorUsername;
		wrapper.append(avatar);
		return wrapper;
	}

	#message(copy: string, error = false): HTMLElement {
		const message = this.#document.createElement('div');
		message.className = error
			? 'ldp-notification-error'
			: 'ldp-notification-empty';
		message.textContent = copy;
		return message;
	}

	#reactionLabel(reaction: string): string {
		return reaction === 'heart' ? '♥' : `:${reaction}:`;
	}

	#reactionIcon(reaction: string, className = ''): HTMLElement {
		const icon = this.#document.createElement('span');
		if (className) icon.className = className;
		icon.setAttribute('role', 'img');
		icon.setAttribute('aria-label', `${reaction} 回应`);
		let source = '';
		try {
			source = String(this.#reactionIconSource(reaction) ?? '').trim();
		} catch {
			// 原生 emoji helper 不可用时保留可访问文本回退。
		}
		if (source) {
			const image = this.#document.createElement('img');
			image.className = 'emoji only-emoji';
			try {
				image.src = new URL(source, this.#baseUrl).href;
			} catch {
				image.src = source;
			}
			image.alt = reaction;
			image.loading = 'lazy';
			image.decoding = 'async';
			icon.append(image);
		} else {
			icon.textContent = this.#reactionLabel(reaction);
		}
		return icon;
	}

	#replaceIcon(button: HTMLButtonElement, name: string): void {
		const label = button.getAttribute('aria-label');
		button.replaceChildren();
		button.append(renderReaderIcon(
			this.#document,
			name,
			this.#renderIcon,
		));
		if (label) button.setAttribute('aria-label', label);
	}

	#setControlBusy(button: HTMLButtonElement, busy: boolean): void {
		button.dataset.ldpRequestBusy = busy ? '1' : '0';
		button.setAttribute('aria-busy', String(busy));
		button.disabled = busy;
	}
}
