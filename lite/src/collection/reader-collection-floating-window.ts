import { createReaderIcon } from '../components/reader-icon.js';
import { htmlElement as node } from '../dom/html-element.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	ReaderFloatingWindowFrame,
} from '../shell/reader-floating-window-frame.js';

export interface ReaderCollectionFloatingWindowOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly toggle: HTMLButtonElement;
	readonly content: HTMLElement;
	readonly title: string;
	readonly ariaLabel: string;
	readonly icon: string;
	readonly variant: string;
	readonly tabOrder: number;
	readonly geometryStorage?: Pick<Storage, 'getItem' | 'setItem'>;
	readonly isOpen: () => boolean;
	readonly requestOpen: () => void | Promise<void>;
	readonly requestClose: () => void;
	readonly notify?: (message: string) => void;
	readonly parentScope?: LifecycleScope;
}

export type ReaderCollectionProgressState =
	| 'running'
	| 'waiting'
	| 'error'
	| 'complete';

export interface ReaderCollectionProgressSnapshot {
	readonly visible: boolean;
	readonly label: string;
	readonly detail: string;
	readonly state: ReaderCollectionProgressState;
	readonly completed: number;
	readonly total: number;
	readonly valueText: string;
	readonly retryable?: boolean;
}

export const READER_COLLECTION_FLOATING_WINDOW_POLICY = Object.freeze({
	minWidth: 320,
	minHeight: 460,
	defaultWidth: 560,
	defaultHeight: 680,
});

export const READER_COLLECTION_FLOATING_WINDOW_PLACEMENT = 'center' as const;

export const READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY =
	'linuxdo-enhanced-reader:collection-window:v1';

export interface ReaderCollectionScrollWindowOptions<T> {
	readonly list: HTMLElement;
	readonly pager: HTMLElement;
	readonly identity: (record: T) => string;
	readonly loadMore: () => void | Promise<void>;
	readonly onError?: (cause: unknown) => void;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderCollectionScrollPage<T> {
	readonly streamKey: string;
	readonly page: number;
	readonly records: readonly T[];
	readonly loading: boolean;
	readonly hasMore: boolean;
}

interface ReaderCollectionNodeCacheEntry<T, TNode extends Node> {
	readonly record: T;
	readonly variant: string;
	readonly node: TNode;
}

/**
 * 通知、收藏与用户活动列表共用的轻量 DOM recycler。记录对象及视图变体未变化时复用
 * 原节点，避免历史进度每推进一页就重建头像、图标和全部事件子树。
 */
export class ReaderCollectionNodeCache<T, TNode extends Node> {
	readonly #entries = new Map<string, ReaderCollectionNodeCacheEntry<T, TNode>>();

	node(
		keyValue: string,
		record: T,
		variantValue: string,
		create: () => TNode,
	): TNode {
		const key = String(keyValue);
		const variant = String(variantValue);
		const cached = this.#entries.get(key);
		if (cached?.record === record && cached.variant === variant) {
			return cached.node;
		}
		const node = create();
		this.#entries.set(key, Object.freeze({ record, variant, node }));
		return node;
	}

	prune(keys: Iterable<string>): void {
		const retained = new Set(keys);
		for (const key of this.#entries.keys()) {
			if (!retained.has(key)) this.#entries.delete(key);
		}
	}

	clear(): void {
		this.#entries.clear();
	}
}

/**
 * 集合浮窗与用户观察共用的滚动分页 owner。
 *
 * Controller 仍只拥有单页请求与缓存；这里把已看过的页合并为当前视口投影，并在距
 * 底部 96px 时请求下一页。切换分类或筛选会清空旧投影，避免跨集合混入记录。
 */
export class ReaderCollectionScrollWindow<T> {
	readonly scope: LifecycleScope;
	readonly #list: HTMLElement;
	readonly #identity: (record: T) => string;
	readonly #loadMore: () => void | Promise<void>;
	readonly #onError: (cause: unknown) => void;
	readonly #pages = new Map<number, readonly T[]>();
	#streamKey = '';
	#records: readonly T[] = Object.freeze([]);
	#loading = false;
	#hasMore = false;
	#pending = false;
	#retryBoundaryAfterPending = false;
	#boundaryMicrotaskPending = false;

	constructor(options: ReaderCollectionScrollWindowOptions<T>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#list = options.list;
		this.#identity = options.identity;
		this.#loadMore = options.loadMore;
		this.#onError = options.onError ?? (() => {});
		options.pager.hidden = true;
		options.pager.setAttribute('aria-hidden', 'true');
		this.#list.dataset.collectionScrollLoading = 'false';
		this.scope.listen(this.#list, 'scroll', () => {
			this.#requestMoreIfNearEnd(true);
		}, { passive: true });
		this.scope.add(() => {
			this.#boundaryMicrotaskPending = false;
			this.#retryBoundaryAfterPending = false;
			this.#pages.clear();
			this.#records = Object.freeze([]);
			delete this.#list.dataset.collectionScrollLoading;
		});
	}

	get records(): readonly T[] {
		return this.#records;
	}

	project(input: ReaderCollectionScrollPage<T>): readonly T[] {
		const page = Math.max(0, Math.floor(input.page));
		if (input.streamKey !== this.#streamKey) {
			this.#streamKey = input.streamKey;
			this.#pages.clear();
			this.#list.scrollTop = 0;
		}
		for (const index of [...this.#pages.keys()]) {
			if (index > page) this.#pages.delete(index);
		}
		if (!input.loading) this.#pages.set(page, Object.freeze([...input.records]));
		const records: T[] = [];
		const identities = new Set<string>();
		for (let index = 0; index <= page; index += 1) {
			for (const record of this.#pages.get(index) ?? []) {
				const identity = this.#identity(record);
				if (identities.has(identity)) continue;
				identities.add(identity);
				records.push(record);
			}
		}
		this.#records = Object.freeze(records);
		this.sync({ loading: input.loading, hasMore: input.hasMore });
		return this.#records;
	}

	sync(state: Readonly<{ loading: boolean; hasMore: boolean }>): void {
		this.#loading = state.loading;
		this.#hasMore = state.hasMore;
		this.#list.dataset.collectionScrollLoading = String(
			state.loading || this.#pending,
		);
		// 触底可能先于缓存或请求状态解锁；状态变化后主动复查，不能依赖
		// 切换浮窗标签造成的偶发 layout/scroll 事件。
		this.#scheduleBoundaryCheck();
	}

	update(identity: string, replace: (record: T) => T): void {
		this.replaceWhere(
			(record) => this.#identity(record) === identity,
			replace,
		);
	}

	replaceWhere(
		predicate: (record: T) => boolean,
		replace: (record: T) => T,
	): void {
		for (const [page, records] of this.#pages) {
			let changed = false;
			const next = records.map((record) => {
				if (!predicate(record)) return record;
				changed = true;
				return replace(record);
			});
			if (changed) this.#pages.set(page, Object.freeze(next));
		}
		this.#rebuildRecords();
	}

	forget(predicate: (record: T) => boolean): void {
		for (const [page, records] of this.#pages) {
			this.#pages.set(page, Object.freeze(records.filter((record) =>
				!predicate(record))));
		}
		this.#rebuildRecords();
	}

	#rebuildRecords(): void {
		const records: T[] = [];
		const identities = new Set<string>();
		for (const page of [...this.#pages.keys()].sort((left, right) => left - right)) {
			for (const record of this.#pages.get(page) ?? []) {
				const identity = this.#identity(record);
				if (identities.has(identity)) continue;
				identities.add(identity);
				records.push(record);
			}
		}
		this.#records = Object.freeze(records);
	}

	#scheduleBoundaryCheck(): void {
		if (
			this.scope.destroyed ||
			this.#boundaryMicrotaskPending
		) return;
		this.#boundaryMicrotaskPending = true;
		queueMicrotask(() => {
			this.#boundaryMicrotaskPending = false;
			if (!this.scope.destroyed) this.#requestMoreIfNearEnd();
		});
	}

	#requestMoreIfNearEnd(explicitScroll = false): void {
		/*
		 * 通知、收藏、历史等浮窗关闭时仍可能收到领域状态同步。隐藏 surface 的
		 * clientHeight/scrollHeight 既不具备分页语义，还会在 Topic 开关热路径中
		 * 强制整棵 Reader DOM 做 layout；等浮窗重新显示后由 scroll 或下一次 sync
		 * 再检查真实边界。
		 */
		if (!this.#list.isConnected || this.#list.closest('[hidden]')) return;
		const scrollTop = Math.max(0, Number(this.#list.scrollTop) || 0);
		const clientHeight = Math.max(0, Number(this.#list.clientHeight) || 0);
		const scrollHeight = Math.max(0, Number(this.#list.scrollHeight) || 0);
		if (
			(explicitScroll || clientHeight > 0) &&
			scrollTop + clientHeight >= scrollHeight - 96
		) this.#requestMore();
	}

	#requestMore(): void {
		if (this.#pending) {
			this.#retryBoundaryAfterPending = true;
			return;
		}
		if (this.#loading || !this.#hasMore) return;
		this.#pending = true;
		this.#list.dataset.collectionScrollLoading = 'true';
		void Promise.resolve(this.#loadMore()).catch(this.#onError).finally(() => {
			this.#pending = false;
			this.#list.dataset.collectionScrollLoading = String(this.#loading);
			if (!this.#retryBoundaryAfterPending) return;
			this.#retryBoundaryAfterPending = false;
			this.#scheduleBoundaryCheck();
		});
	}
}

/** Header 集合入口与用户观察共用的独立窗口 surface owner。 */
export class ReaderCollectionFloatingWindow {
	readonly scope: LifecycleScope;
	readonly frame: ReaderFloatingWindowFrame;
	readonly #toggle: HTMLButtonElement;
	readonly #content: HTMLElement;
	readonly #isOpen: () => boolean;
	readonly #requestClose: () => void;

	constructor(options: ReaderCollectionFloatingWindowOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#toggle = options.toggle;
		this.#content = options.content;
		this.#isOpen = options.isOpen;
		this.#requestClose = options.requestClose;
		this.frame = new ReaderFloatingWindowFrame({
			document: options.document,
			mount: options.mount,
			title: options.title,
			ariaLabel: options.ariaLabel,
			icon: options.icon,
			variant: options.variant,
			tabId: options.variant,
			tabOrder: options.tabOrder,
			requestOpen: options.requestOpen,
			zIndex: 2_147_483_584,
			...(options.geometryStorage
				? { geometryStorage: options.geometryStorage }
				: {}),
			geometryStorageKey: READER_COLLECTION_FLOATING_WINDOW_GEOMETRY_KEY,
			policy: READER_COLLECTION_FLOATING_WINDOW_POLICY,
			placement: READER_COLLECTION_FLOATING_WINDOW_PLACEMENT,
			...(options.notify ? { notify: options.notify } : {}),
			onClose: () => {
				this.#content.hidden = true;
				this.#requestClose();
			},
			parentScope: this.scope,
		});
		this.frame.element.classList.add('is-user-observation-list');
		this.#content.hidden = true;
		this.frame.body.append(this.#content);
		this.#toggle.setAttribute('aria-haspopup', 'dialog');
		this.scope.listen(options.document, 'pointerdown', (event) => {
			if (!this.#isOpen()) return;
			this.frame.dismissFromPointerEvent(event);
		}, true);
		this.scope.listen(options.document, 'keydown', (eventValue) => {
			const event = eventValue as KeyboardEvent;
			if (!this.#isOpen() || !this.frame.dismissFromEscapeEvent(event)) return;
			if (!this.frame.active && this.#toggle.isConnected) {
				this.#toggle.focus({ preventScroll: true });
			}
		}, true);
		this.scope.add(() => {
			this.#toggle.setAttribute('aria-expanded', 'false');
		});
	}

	get isOpen(): boolean {
		return this.frame.isOpen;
	}

	attachHeaderActions(options: Readonly<{
		root: HTMLElement;
		buttons: readonly HTMLButtonElement[];
		label: string;
	}>): void {
		options.root.classList.add('ldp-reader-floating-window-extra-actions');
		options.root.setAttribute('role', 'group');
		options.root.setAttribute('aria-label', options.label);
		for (const button of options.buttons) {
			button.classList.add('ldp-reader-floating-window-extra-action');
		}
		const divider = this.frame.element.ownerDocument.createElement('span');
		divider.className = 'ldp-reader-floating-window-action-divider';
		divider.setAttribute('aria-hidden', 'true');
		options.root.append(divider);
		this.frame.actions.prepend(options.root);
	}

	sync(open: boolean): void {
		if (this.scope.destroyed) return;
		const opening = open && !this.frame.isOpen;
		this.#content.hidden = !open;
		this.#toggle.setAttribute('aria-expanded', String(open));
		if (opening) this.frame.open();
		else if (!open) this.frame.close();
	}

	destroy(): void {
		this.scope.destroy();
	}
}

/** 用户观察进度条的集合业务投影；只渲染，不拥有请求状态。 */
export class ReaderCollectionProgressView {
	readonly scope: LifecycleScope;
	readonly element: HTMLElement;
	readonly #document: Document;
	readonly #retry: () => void | Promise<void>;
	readonly #onError: (cause: unknown) => void;
	#retrying = false;

	constructor(options: Readonly<{
		document: Document;
		retry: () => void | Promise<void>;
		onError?: (cause: unknown) => void;
		parentScope?: LifecycleScope;
	}>) {
		this.#document = options.document;
		this.#retry = options.retry;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.element = node(
			options.document,
			'div',
			'ldp-user-observation-progress ldp-collection-cache-progress',
		);
		this.element.hidden = true;
		this.scope.listen(this.element, 'click', (event) => {
			const target = event.target as (EventTarget & {
				closest?: (selector: string) => Element | null;
			}) | null;
			const retry = typeof target?.closest === 'function'
				? target.closest(
					'.ldp-user-observation-progress-retry',
				) as HTMLButtonElement | null
				: null;
			if (!retry || !this.element.contains(retry) || this.#retrying) return;
			event.preventDefault();
			event.stopPropagation();
			this.#retrying = true;
			this.#syncRetryButton(retry);
			void Promise.resolve()
				.then(() => this.#retry())
				.catch(this.#onError)
				.finally(() => {
					this.#retrying = false;
					const current = this.element.querySelector<HTMLButtonElement>(
						'.ldp-user-observation-progress-retry',
					);
					if (current) this.#syncRetryButton(current);
				});
		});
	}

	#syncRetryButton(button: HTMLButtonElement): void {
		button.disabled = this.#retrying;
		button.dataset.ldpRequestBusy = this.#retrying ? '1' : '0';
		button.setAttribute('aria-busy', String(this.#retrying));
		button.replaceChildren(
			createReaderIcon(
				this.#document,
				this.#retrying ? 'loader' : 'rotate-ccw',
			),
			this.#document.createTextNode(this.#retrying ? '重试中' : '重试'),
		);
	}

	render(snapshot: ReaderCollectionProgressSnapshot): void {
		this.element.hidden = !snapshot.visible;
		if (!snapshot.visible) {
			this.element.replaceChildren();
			return;
		}
		this.element.dataset.phase = snapshot.state;
		const copy = node(
			this.#document,
			'div',
			'ldp-user-observation-progress-copy',
		);
		copy.append(
			node(this.#document, 'strong', '', snapshot.label),
			node(this.#document, 'span', '', snapshot.detail),
		);
		if (snapshot.retryable) {
			const retry = this.#document.createElement('button');
			retry.type = 'button';
			retry.className = 'ldp-user-observation-progress-retry';
			this.#syncRetryButton(retry);
			copy.append(retry);
		}
		const total = Math.max(1, Math.floor(snapshot.total));
		const completed = Math.max(
			0,
			Math.min(total, Number(snapshot.completed) || 0),
		);
		const completeSegments = Math.floor(completed);
		const partialProgress = completed - completeSegments;
		const segments = node(
			this.#document,
			'div',
			'ldp-user-observation-progress-segments',
		);
		segments.setAttribute('role', 'progressbar');
		segments.setAttribute('aria-label', '后台缓存进度');
		segments.setAttribute('aria-valuemin', '0');
		segments.setAttribute('aria-valuemax', String(total));
		segments.setAttribute(
			'aria-valuenow',
			String(Math.round(completed * 1_000) / 1_000),
		);
		segments.setAttribute('aria-valuetext', snapshot.valueText);
		segments.style.gridTemplateColumns = `repeat(${total}, minmax(0, 1fr))`;
		segments.append(...Array.from({ length: total }, (_, index) => {
			const segment = node(this.#document, 'span', '');
			if (index < completeSegments) segment.classList.add('is-complete');
			else if (index === completeSegments && completed < total) {
				segment.classList.add(
					snapshot.state === 'error'
						? 'is-error'
						: snapshot.state === 'waiting'
							? 'is-waiting'
								: 'is-active',
				);
				if (partialProgress > 0 && snapshot.state !== 'error') {
					segment.classList.add('is-partial');
					segment.style.setProperty(
						'--ldp-collection-progress',
						`${Math.round(partialProgress * 100)}%`,
					);
				}
			}
			return segment;
		}));
		this.element.replaceChildren(copy, segments);
	}

	destroy(): void {
		this.scope.destroy();
	}
}
