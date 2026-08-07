import type {
	DiscourseNativeTopicPresentationPort,
} from '../discourse/native-host-api.js';
import {
	createReaderIcon,
	renderReaderIcon,
} from '../components/reader-icon.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import {
	valueRecord as record,
	type UnknownRecord,
} from '../kernel/value-record.js';
import type {
	DiscourseTopicPostInput,
	TopicSessionCommit,
} from './topic-session.js';
import type {
	ReaderTopicOnlyOpController,
	ReaderTopicOnlyOpSnapshot,
} from './reader-topic-only-op-controller.js';

const EMPTY_RECORD: UnknownRecord = Object.freeze({});

export interface ReaderTopicHeaderSessionPort<TTopic, TPost> {
	readonly topicId?: unknown;
	readonly topic: TTopic | null;
	readonly changes: Signal<TopicSessionCommit>;
	cachedPosts(): readonly TPost[];
}

export interface ReaderTopicHeaderCategory {
	readonly id: number;
	readonly name: string;
	readonly level: string;
	readonly icon: string;
	readonly href: string;
}

export interface ReaderTopicHeaderTag {
	readonly name: string;
	readonly icon: string;
	readonly href: string;
}

export interface ReaderTopicHeaderVote {
	readonly count: number;
	readonly voted: boolean;
	readonly canVote: boolean;
}

export interface ReaderTopicHeaderSnapshot {
	readonly topicId: number;
	readonly categoryId: number;
	readonly title: string;
	readonly ownerUsername: string;
	readonly ownerHref: string;
	readonly statsText: string;
	readonly category: ReaderTopicHeaderCategory | null;
	readonly tags: readonly ReaderTopicHeaderTag[];
	readonly vote: ReaderTopicHeaderVote | null;
}

export interface ReaderTopicHeaderControllerOptions<TTopic, TPost> {
	readonly session: ReaderTopicHeaderSessionPort<TTopic, TPost>;
	readonly presentation: DiscourseNativeTopicPresentationPort;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

export interface ReaderTopicHeaderElements {
	readonly titleJump: HTMLElement;
	readonly metaHost: HTMLElement;
	readonly metaStats: HTMLElement;
	readonly metaOwner: HTMLElement;
	readonly metaOwnerValue: HTMLAnchorElement;
	readonly onlyOpToggle: HTMLButtonElement;
	readonly onlyOpProgress: HTMLElement;
	readonly onlyOpProgressValue: HTMLElement;
	readonly topicIdentityHost: HTMLElement;
}

export interface ReaderTopicHeaderViewOptions {
	readonly controller: ReaderTopicHeaderController<unknown, unknown>;
	readonly elements: ReaderTopicHeaderElements;
	readonly hostDocument?: Document;
	readonly onJumpFirst: () => void | Promise<void>;
	readonly onlyOp?: ReaderTopicOnlyOpController<DiscourseTopicPostInput>;
	readonly onToggleTopicVote?: (voted: boolean) => void | Promise<void>;
	readonly renderIcon?: (name: string, document: Document) => Node | null;
	readonly createResizeObserver?: (
		callback: ResizeObserverCallback,
	) => Pick<ResizeObserver, 'observe' | 'disconnect'>;
	readonly createMutationObserver?: (
		callback: MutationCallback,
	) => Pick<MutationObserver, 'observe' | 'disconnect'>;
	readonly requestFrame?: (callback: FrameRequestCallback) => number;
	readonly cancelFrame?: (id: number) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function text(value: unknown): string {
	return String(value ?? '').trim();
}

function count(value: unknown): number | null {
	if (value === null || value === undefined || value === '') return null;
	const numeric = Number(value);
	return Number.isFinite(numeric)
		? Math.max(0, Math.floor(numeric))
		: null;
}

function categoryLevel(value: unknown): string {
	const match = text(value).match(/(?:^|[,，]\s*)Lv\s*(\d+)\s*$/i);
	return match?.[1] ? `Lv${match[1]}` : '';
}

function categoryName(value: unknown): string {
	return text(value)
		.replace(/\s*[,，]\s*Lv\s*\d+\s*$/i, '')
		.trim();
}

function safeIconName(value: unknown): string {
	const normalized = text(value).toLowerCase().replace(/^fa-/, '');
	return (
		normalized.length <= 80 &&
		/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized)
	)
		? normalized
		: '';
}

function topicTags(
	topic: UnknownRecord,
): readonly Readonly<{ name: string; icon: string }>[] {
	if (!Array.isArray(topic.tags)) return Object.freeze([]);
	const tags = topic.tags
		.map((value) => {
			const source = record(value);
			return Object.freeze({
				name: text(source?.name ?? source?.id ?? value),
				icon: safeIconName(
					source?.icon ??
					source?.icon_name ??
					source?.iconName,
				),
			});
		})
		.filter((tag) => Boolean(tag.name));
	const byName = new Map<string, Readonly<{ name: string; icon: string }>>();
	for (const tag of tags) {
		const previous = byName.get(tag.name);
		if (!previous || (!previous.icon && tag.icon)) byName.set(tag.name, tag);
	}
	return Object.freeze([...byName.values()]);
}

export function readerTopicOwnerUsername(
	topicValue: unknown,
	posts: readonly unknown[] = [],
): string {
	const topic = record(topicValue) ?? EMPTY_RECORD;
	const details = record(topic.details);
	const createdBy = record(details?.created_by);
	const firstPost = posts
		.map((post) => record(post))
		.find((post) => Number(post?.post_number) === 1);
	return text(
		topic._opUsername ||
		createdBy?.username ||
		firstPost?.username ||
		topic.original_poster_username,
	);
}

export function normalizeReaderTopicHeader(
	topicValue: unknown,
	posts: readonly unknown[],
	presentation: DiscourseNativeTopicPresentationPort,
	fallbackTopicId: unknown = 0,
): ReaderTopicHeaderSnapshot {
	const topic = record(topicValue) ?? EMPTY_RECORD;
	const category = record(topic.category) ?? EMPTY_RECORD;
	const owner = readerTopicOwnerUsername(topic, posts);
	const categoryId = count(
		topic.category_id ??
		topic.categoryId ??
		category.id,
	) ?? 0;
	const rawCategoryName =
		topic.category_name ??
		topic.categoryName ??
		category.name ??
		topic.category_slug ??
		category.slug ??
		presentation.categoryName?.(categoryId);
	const normalizedCategoryName = categoryName(rawCategoryName);
	const level = [
		topic.category_level,
		topic.categoryLevel,
		rawCategoryName,
	].map(categoryLevel).find(Boolean) ?? '';
	const tags = topicTags(topic).map((tag) => Object.freeze({
		name: tag.name,
		icon: tag.icon,
		href: presentation.tagHref(tag.name),
	}));
	const voteCount = count(topic.vote_count) ?? 0;
	const voted = topic.user_voted === true;
	const canVote = topic.can_vote === true || voted;
	const hasVoteCapability = ['can_vote', 'user_voted', 'vote_count']
		.some((key) => Object.hasOwn(topic, key));
	const stats: string[] = [];
	const postsCount = count(topic.posts_count);
	const views = count(topic.views);
	const likes = count(topic.like_count);
	const participants = count(topic.participant_count);
	if (postsCount !== null) stats.push(`${postsCount} 帖`);
	if (views !== null) stats.push(`${views} 浏览`);
	if (likes !== null) stats.push(`${likes} 赞`);
	if (participants !== null) stats.push(`${participants} 用户`);

	return Object.freeze({
		topicId: count(topic.id) ?? count(fallbackTopicId) ?? 0,
		categoryId,
		title: text(topic.title ?? topic.fancy_title) || '未命名主题',
		ownerUsername: owner,
		ownerHref: presentation.userHref(owner),
		statsText: stats.join(' · ') || '主题信息暂不可用',
		category: normalizedCategoryName
			? Object.freeze({
				id: categoryId,
				name: normalizedCategoryName,
				level,
				icon: safeIconName(
					topic.category_icon ??
					topic.categoryIcon ??
					category.icon ??
					category.icon_name ??
					category.iconName ??
					presentation.categoryIcon?.(categoryId),
				),
				href: presentation.categoryHref(categoryId),
			})
			: null,
		tags: Object.freeze(tags),
		vote: hasVoteCapability && (canVote || voteCount > 0)
			? Object.freeze({ count: voteCount, voted, canVote })
			: null,
	});
}

/**
 * canonical Topic -> header snapshot 的唯一 application owner。
 *
 * 它只读取 TopicSession 已提交的数据与 Discourse 原生展示端口；不读宿主 DOM、不请求
 * category/tag/avatar，也不保存第二份 Topic。
 */
export class ReaderTopicHeaderController<TTopic, TPost> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderTopicHeaderSnapshot>();
	readonly #session: ReaderTopicHeaderSessionPort<TTopic, TPost>;
	readonly #presentation: DiscourseNativeTopicPresentationPort;
	readonly #topicId: number;
	readonly #onError: (error: unknown) => void;
	#snapshot: ReaderTopicHeaderSnapshot;

	constructor(options: ReaderTopicHeaderControllerOptions<TTopic, TPost>) {
		this.#session = options.session;
		this.#presentation = options.presentation;
		this.#topicId = count(options.session.topicId) ?? 0;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#snapshot = normalizeReaderTopicHeader(
			this.#session.topic,
			this.#session.cachedPosts(),
			this.#presentation,
			this.#topicId,
		);
		this.#session.changes.subscribe(() => this.refresh(), this.scope);
		this.scope.add(() => this.changes.clear());
	}

	get snapshot(): ReaderTopicHeaderSnapshot {
		return this.#snapshot;
	}

	refresh(): ReaderTopicHeaderSnapshot {
		const next = normalizeReaderTopicHeader(
			this.#session.topic,
			this.#session.cachedPosts(),
			this.#presentation,
			this.#topicId,
		);
		if (JSON.stringify(next) === JSON.stringify(this.#snapshot)) {
			return this.#snapshot;
		}
		this.#snapshot = next;
		for (const error of this.changes.emit(next)) this.#onError(error);
		return next;
	}

	destroy(): void {
		this.scope.destroy();
	}
}

function appendLinkedIdentity(
	document: Document,
	parent: HTMLElement,
	className: string,
	label: string,
	href: string,
	icon: string,
	renderIcon: ((name: string, document: Document) => Node | null) | null,
	hostIcon: Element | null = null,
): HTMLElement {
	const node = document.createElement(href ? 'a' : 'span');
	node.className = className;
	if (node.tagName === 'A' && href) node.setAttribute('href', href);
	const fallbackIcon = className.includes('ldp-topic-category')
		? 'code'
		: 'tag';
	const hostIconName = safeIconName(
		hostIcon?.querySelector('use')?.getAttribute('href')?.replace(/^#/, ''),
	);
	const requestedIcon = icon || hostIconName;
	if (requestedIcon) {
		const rendered = renderReaderIcon(document, requestedIcon, renderIcon);
		const renderedElement = rendered.nodeType === 1
			? rendered as Element
			: null;
		const unresolved = renderedElement?.matches(
			'[data-reader-icon-fallback-for]',
		) || renderedElement?.querySelector(
			'[data-reader-icon-fallback-for]',
		);
		node.append(
			unresolved
				? createReaderIcon(document, fallbackIcon)
				: rendered,
		);
	} else if (hostIcon && hostIcon.tagName.toLowerCase() === 'img') {
		/*
		 * 宿主页的 <use href="#icon"> 进入 Shadow DOM 后无法继续解析外层
		 * sprite；只取已校验的 fragment 名，再经 Reader 原生 renderer 生成
		 * 自包含 SVG。图片等不依赖 sprite 的宿主图标仍沿用安全 clone。
		 */
		node.append(hostIcon);
	} else {
		node.append(createReaderIcon(document, fallbackIcon));
	}
	const textNode = document.createElement('span');
	textNode.className = 'ldp-topic-tag-text';
	textNode.textContent = label;
	node.append(textNode);
	parent.append(node);
	return node;
}

interface ReaderTopicHostIconMetadata {
	readonly categoryIcon: Element | null;
	readonly categoryId: number;
	readonly categoryName: string;
	readonly categoryLevel: string;
	readonly categoryHref: string;
	readonly tagIcons: ReadonlyMap<string, Element>;
	readonly tagHrefs: ReadonlyMap<string, string>;
}

const SAFE_ICON_FRAGMENT = /^#[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

interface ReaderTopicHostIdentityCache {
	readonly categoryIcons: Map<string, Element>;
	readonly categoryHrefs: Map<string, string>;
	readonly tagIcons: Map<string, Element>;
	readonly tagHrefs: Map<string, string>;
}

const HOST_IDENTITY_CACHE = new WeakMap<Document, ReaderTopicHostIdentityCache>();
const HOST_IDENTITY_INDEX_LIMIT = 128;

export interface ReaderTopicHostIdentityCacheStats {
	readonly categoryEntries: number;
	readonly tagEntries: number;
	readonly indexLimit: number;
}

export function readerTopicHostIdentityCacheStats(
	document: Document,
): ReaderTopicHostIdentityCacheStats {
	const cache = HOST_IDENTITY_CACHE.get(document);
	return Object.freeze({
		categoryEntries: cache
			? new Set([
				...cache.categoryIcons.keys(),
				...cache.categoryHrefs.keys(),
			]).size
			: 0,
		tagEntries: cache
			? new Set([
				...cache.tagIcons.keys(),
				...cache.tagHrefs.keys(),
			]).size
			: 0,
		indexLimit: HOST_IDENTITY_INDEX_LIMIT,
	});
}

export function clearReaderTopicHostIdentityCache(document: Document): void {
	HOST_IDENTITY_CACHE.delete(document);
}

function rememberHostIdentity<T>(map: Map<string, T>, key: string, value: T): void {
	map.delete(key);
	map.set(key, value);
	while (map.size > HOST_IDENTITY_INDEX_LIMIT) {
		const oldest = map.keys().next().value;
		if (oldest === undefined) break;
		map.delete(oldest);
	}
}

function cachedHostIdentity<T>(map: Map<string, T>, key: string): T | undefined {
	const value = map.get(key);
	if (value === undefined) return undefined;
	map.delete(key);
	map.set(key, value);
	return value;
}

function hostIdentityCache(document: Document): ReaderTopicHostIdentityCache {
	let cache = HOST_IDENTITY_CACHE.get(document);
	if (!cache) {
		cache = {
			categoryIcons: new Map(),
			categoryHrefs: new Map(),
			tagIcons: new Map(),
			tagHrefs: new Map(),
		};
		HOST_IDENTITY_CACHE.set(document, cache);
	}
	return cache;
}

function categoryCacheKeys(id: number, name: string): readonly string[] {
	return Object.freeze([
		...(id > 0 ? [`id:${id}`] : []),
		...(name ? [`name:${name}`] : []),
	]);
}

function cachedCategoryValue<T>(
	values: Map<string, T>,
	id: number,
	name: string,
): T | null {
	for (const key of categoryCacheKeys(id, name)) {
		const value = cachedHostIdentity(values, key);
		if (value !== undefined) return value;
	}
	return null;
}

function cloneHostIdentityIcon(link: Element | null): Element | null {
	if (!link) return null;
	const source = [...link.querySelectorAll('svg,img')]
		.find((candidate) => candidate.closest('a') === link);
	if (!source) return null;
	const clone = source.cloneNode(true) as Element;
	clone.querySelectorAll('script,foreignObject').forEach((node) => node.remove());
	for (const node of [clone, ...clone.querySelectorAll('*')]) {
		for (const attribute of [...node.attributes]) {
			if (/^on/i.test(attribute.name)) node.removeAttribute(attribute.name);
		}
	}
	if (clone.tagName.toLowerCase() === 'svg') {
		for (const use of clone.querySelectorAll('use')) {
			const href = use.getAttribute('href') ??
				use.getAttribute('xlink:href') ?? '';
			if (!SAFE_ICON_FRAGMENT.test(href)) return null;
		}
	} else {
		const sourceUrl = clone.getAttribute('src') ?? '';
		if (/^\s*javascript:/i.test(sourceUrl)) return null;
		clone.removeAttribute('srcset');
		clone.setAttribute('alt', '');
	}
	clone.setAttribute('aria-hidden', 'true');
	return clone;
}

function hostTopicRouteId(document: Document): number {
	const pathname = document.defaultView?.location?.pathname ?? '';
	return Number(
		pathname.match(/\/t\/(?:[^/]+\/)?(\d+)(?:\/|$)/)?.[1] ?? 0,
	);
}

const HOST_TOPIC_SOURCE_ROOT_SELECTOR =
	'tr.topic-list-item,.topic-list-item,.latest-topic-list-item,' +
	'.search-result-topic,.fps-result,.category-topic-link';

function hostSourceTopicId(root: Element): number {
	const direct = Number(
		root.getAttribute('data-topic-id') ??
		(root as HTMLElement).dataset.topicId ??
		0,
	);
	if (Number.isSafeInteger(direct) && direct > 0) return direct;
	const href = root.querySelector<HTMLAnchorElement>('a[href*="/t/"]')
		?.getAttribute('href') ?? '';
	return Number(
		href.match(/\/t\/(?:[^/]+\/)?(\d+)(?:\/|$)/)?.[1] ?? 0,
	);
}

/**
 * Topic JSON 不带 icon 时，从当前 Discourse 标题区复制已经由宿主安全渲染的图标。
 * 只读取非 Reader overlay 的当前 Topic，不把宿主 DOM 保存为第二份 Topic 状态。
 */
export function readReaderTopicHostIconMetadata(
	document: Document,
	snapshot: ReaderTopicHeaderSnapshot,
): ReaderTopicHostIconMetadata {
	const cache = hostIdentityCache(document);
	const tagIcons = new Map<string, Element>();
	const tagHrefs = new Map<string, string>();
	const empty = (): ReaderTopicHostIconMetadata => Object.freeze({
		categoryIcon: null,
		categoryId: 0,
		categoryName: '',
		categoryLevel: '',
		categoryHref: '',
		tagIcons,
		tagHrefs,
	});
	const routeTopicId = hostTopicRouteId(document);
	let root = routeTopicId > 0 &&
		(!snapshot.topicId || routeTopicId === snapshot.topicId)
		? [...document.querySelectorAll<HTMLElement>(
			'#topic-title,.topic-title,.title-wrapper',
		)].find((candidate) => !candidate.closest('.ldp-overlay')) ?? null
		: null;
	if (!root) {
		root = [...document.querySelectorAll<HTMLElement>(
			HOST_TOPIC_SOURCE_ROOT_SELECTOR,
		)].find((candidate) =>
			!candidate.closest('.ldp-overlay') &&
			hostSourceTopicId(candidate) === snapshot.topicId,
			) ?? null;
	}
	const categorySelector =
		'a.badge-category__wrapper,a.badge-category,a.topic-category,' +
		'a[href^="/c/"],a[href*="/c/"]';
	const categoryLink = root?.querySelector(categorySelector) ??
		(
			snapshot.categoryId > 0
				? [...document.querySelectorAll<HTMLElement>(categorySelector)]
					.find((candidate) => {
						const href = candidate.getAttribute('href') ?? '';
						const categoryId = Number(
							candidate.querySelector<HTMLElement>(
								'[data-category-id]',
							)?.dataset.categoryId,
						) || Number(
							href.match(/\/c\/(?:[^/]+\/)*(\d+)(?:\/|$)/)?.[1] ?? 0,
						);
						return categoryId === snapshot.categoryId;
					}) ?? null
				: null
		);
	const tagNames = new Set(snapshot.tags.map((tag) => tag.name));
	for (const link of (root ?? document).querySelectorAll<HTMLElement>(
		'a.discourse-tag,.discourse-tags a,.topic-tags a',
	)) {
		const name = text(link.dataset.tagName ?? link.textContent);
		if (!root && !tagNames.has(name)) continue;
		const icon = cloneHostIdentityIcon(link);
		const href = link.getAttribute('href') ?? '';
		if (name && icon) tagIcons.set(name, icon);
		if (name && href) tagHrefs.set(name, href);
	}
	for (const [name, icon] of tagIcons) {
		rememberHostIdentity(
			cache.tagIcons,
			name,
			icon.cloneNode(true) as Element,
		);
	}
	for (const [name, href] of tagHrefs) {
		rememberHostIdentity(cache.tagHrefs, name, href);
	}
	for (const tag of snapshot.tags) {
		if (!tagIcons.has(tag.name)) {
			const cachedIcon = cachedHostIdentity(cache.tagIcons, tag.name);
			if (cachedIcon) {
				tagIcons.set(tag.name, cachedIcon.cloneNode(true) as Element);
			}
		}
		if (!tagHrefs.has(tag.name)) {
			const cachedHref = cachedHostIdentity(cache.tagHrefs, tag.name);
			if (cachedHref) tagHrefs.set(tag.name, cachedHref);
		}
	}
	const categoryText = text(
		(categoryLink as HTMLElement | null)?.dataset.categoryName ??
		categoryLink?.getAttribute('title') ??
		categoryLink?.textContent,
	);
	const liveCategoryHref = categoryLink?.getAttribute('href') ?? '';
	const hrefCategoryId = Number(
		liveCategoryHref.match(/\/c\/(?:[^/]+\/)*(\d+)(?:\/|$)/)?.[1] ?? 0,
	);
	const categoryId =
		Number((categoryLink as HTMLElement | null)?.dataset.categoryId) ||
		hrefCategoryId ||
		snapshot.categoryId;
	const normalizedCategoryName =
		categoryName(categoryText) || snapshot.category?.name || '';
	const liveCategoryIcon = cloneHostIdentityIcon(categoryLink);
	for (const key of categoryCacheKeys(categoryId, normalizedCategoryName)) {
		if (liveCategoryIcon) {
			rememberHostIdentity(
				cache.categoryIcons,
				key,
				liveCategoryIcon.cloneNode(true) as Element,
			);
		}
		if (liveCategoryHref) {
			rememberHostIdentity(cache.categoryHrefs, key, liveCategoryHref);
		}
	}
	const cachedCategoryIcon = cachedCategoryValue(
		cache.categoryIcons,
		categoryId,
		normalizedCategoryName,
	);
	const categoryIcon = liveCategoryIcon ??
		(cachedCategoryIcon?.cloneNode(true) as Element | undefined) ?? null;
	const categoryHref = liveCategoryHref ||
		cachedCategoryValue(
			cache.categoryHrefs,
			categoryId,
			normalizedCategoryName,
		) || '';
	if (
		!root &&
		!categoryLink &&
		!categoryIcon &&
		!categoryHref &&
		!tagIcons.size &&
		!tagHrefs.size
	) {
		return empty();
	}
	return Object.freeze({
		categoryIcon,
		categoryId,
		categoryName: normalizedCategoryName,
		categoryLevel: categoryLevel(categoryText),
		categoryHref,
		tagIcons,
		tagHrefs,
	});
}

function hasCompleteHostIdentityIcons(
	metadata: ReaderTopicHostIconMetadata,
	snapshot: ReaderTopicHeaderSnapshot,
): boolean {
	const categoryComplete = snapshot.category
		? Boolean(snapshot.category.icon || metadata.categoryIcon)
		: snapshot.categoryId <= 0 ||
			Boolean(metadata.categoryName && metadata.categoryIcon);
	return categoryComplete && snapshot.tags.every((tag) =>
		Boolean(tag.icon || metadata.tagIcons.get(tag.name)),
	);
}

/**
 * Topic 标题、统计、楼主、分类与标签的唯一 DOM 投影。
 *
 * Shell 只提供稳定 host；View 只用锚点和现有设计语言 class 组装子节点。标题跳转仍进入
 * canonical navigation transaction，分类/标签链接保留浏览器原生行为。
 */
export class ReaderTopicHeaderView {
	readonly scope: LifecycleScope;
	readonly #controller: ReaderTopicHeaderController<unknown, unknown>;
	readonly #elements: ReaderTopicHeaderElements;
	readonly #onJumpFirst: () => void | Promise<void>;
	readonly #onlyOp:
		ReaderTopicOnlyOpController<DiscourseTopicPostInput> | null;
	readonly #onToggleTopicVote:
		((voted: boolean) => void | Promise<void>) | null;
	readonly #renderIcon:
		((name: string, document: Document) => Node | null) | null;
	readonly #onError: (error: unknown) => void;
	readonly #hostDocument: Document;
	readonly #topicScroller: HTMLElement;
	readonly #topicTags: HTMLElement;
	readonly #topicVote: HTMLElement;
	readonly #requestFrame: (callback: FrameRequestCallback) => number;
	readonly #cancelFrame: (id: number) => void;
	#hostMetadataObserver:
		Pick<MutationObserver, 'observe' | 'disconnect'> | null = null;
	#topicHintFrame = 0;
	#hostMetadataFrame = 0;
	#hostMetadataStopTimer = 0;
	#hostMetadataRetryTimer = 0;
	#hostMetadataRetryDelay = 80;
	#topicVotePending = false;

	constructor(options: ReaderTopicHeaderViewOptions) {
		this.#controller = options.controller;
		this.#elements = options.elements;
		this.#onJumpFirst = options.onJumpFirst;
		this.#onlyOp = options.onlyOp ?? null;
		this.#onToggleTopicVote = options.onToggleTopicVote ?? null;
		this.#renderIcon = options.renderIcon ?? null;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const document = this.#elements.topicIdentityHost.ownerDocument;
		const rootHost = (
			this.#elements.topicIdentityHost.getRootNode() as ShadowRoot
		).host;
		this.#hostDocument = options.hostDocument ??
			rootHost?.ownerDocument ??
			document;
		const defaultView = this.#hostDocument.defaultView ?? document.defaultView;
		this.#requestFrame = options.requestFrame ?? ((callback) =>
			defaultView?.requestAnimationFrame
				? defaultView.requestAnimationFrame(callback)
				: setTimeout(() => callback(Date.now()), 0));
		this.#cancelFrame = options.cancelFrame ?? ((id) => {
			if (defaultView?.cancelAnimationFrame) {
				defaultView.cancelAnimationFrame(id);
				return;
			}
			clearTimeout(id);
		});
		const leftHint = document.createElement('span');
		leftHint.className =
			'ldp-title-topic-scroll-hint ldp-title-topic-scroll-hint-left';
		leftHint.setAttribute('aria-hidden', 'true');
		const scroller = document.createElement('div');
		scroller.className = 'ldp-title-topic-scroller';
		scroller.setAttribute('role', 'group');
		scroller.tabIndex = 0;
		scroller.setAttribute(
			'aria-label',
			'主题分类和标签，滚轮可横向浏览',
		);
		const tags = document.createElement('div');
		tags.className = 'ldp-topic-tags';
		const vote = document.createElement('div');
		vote.className = 'ldp-topic-vote-slot';
		vote.hidden = true;
		scroller.append(tags, vote);
		const rightHint = document.createElement('span');
		rightHint.className =
			'ldp-title-topic-scroll-hint ldp-title-topic-scroll-hint-right';
		rightHint.setAttribute('aria-hidden', 'true');
		this.#elements.topicIdentityHost.replaceChildren(
			leftHint,
			scroller,
			rightHint,
		);
		this.#topicScroller = scroller;
		this.#topicTags = tags;
		this.#topicVote = vote;
		this.scope.listen(vote, 'click', (event) => {
			const button = (event.target as Element | null)
				?.closest<HTMLButtonElement>('[data-topic-vote]');
			if (!button || button.disabled) return;
			event.preventDefault();
			void this.#toggleTopicVote();
		});
		this.scope.listen(scroller, 'scroll', () => this.#queueTopicHints(), {
			passive: true,
		});
		this.scope.listen(
			this.#elements.topicIdentityHost,
			'wheel',
			(event) => this.#onTopicWheel(event as WheelEvent),
			{ passive: false },
		);
		const NativeResizeObserver = defaultView?.ResizeObserver;
		const resizeObserver = options.createResizeObserver?.(
			() => this.#queueTopicHints(),
		) ?? (NativeResizeObserver
			? new NativeResizeObserver(() => this.#queueTopicHints())
			: null);
		if (resizeObserver) {
			resizeObserver.observe(this.#elements.topicIdentityHost);
			resizeObserver.observe(scroller);
			resizeObserver.observe(tags);
			this.scope.add(() => resizeObserver.disconnect());
		}
		this.scope.add(() => {
			if (this.#topicHintFrame) {
				this.#cancelFrame(this.#topicHintFrame);
				this.#topicHintFrame = 0;
			}
			this.#stopHostMetadataHydration();
		});
		this.scope.listen(this.#elements.titleJump, 'click', () => {
			void this.#jumpFirst();
		});
		this.scope.listen(this.#elements.titleJump, 'keydown', (event) => {
			const key = (event as KeyboardEvent).key;
			if (key !== 'Enter' && key !== ' ') return;
			event.preventDefault();
			void this.#jumpFirst();
		});
		this.scope.listen(this.#elements.onlyOpToggle, 'click', () => {
			try {
				this.#onlyOp?.toggle();
			} catch (error) {
				this.#onError(error);
			}
		});
		this.#controller.changes.subscribe(
			(snapshot) => this.render(snapshot),
			this.scope,
		);
		this.#onlyOp?.changes.subscribe(
			(snapshot) => this.#renderOnlyOp(snapshot),
			this.scope,
		);
		this.render(this.#controller.snapshot);
		this.#renderOnlyOp(this.#onlyOp?.snapshot ?? null);
		this.#startHostMetadataHydration(options.createMutationObserver);
	}

	render(snapshot: ReaderTopicHeaderSnapshot): void {
		const document = this.#elements.titleJump.ownerDocument;
		const hostIcons = readReaderTopicHostIconMetadata(
			this.#hostDocument,
			snapshot,
		);
		this.#elements.titleJump.textContent = snapshot.title;
		this.#elements.metaStats.textContent = snapshot.statsText;
		this.#elements.metaOwner.hidden = !snapshot.ownerUsername;
		this.#elements.metaOwnerValue.textContent = snapshot.ownerUsername
			? `@${snapshot.ownerUsername}`
			: '';
		if (snapshot.ownerUsername && snapshot.ownerHref) {
			this.#elements.metaOwnerValue.href = snapshot.ownerHref;
			this.#elements.metaOwnerValue.dataset.userCard =
				snapshot.ownerUsername;
			this.#elements.metaOwnerValue.target = '_blank';
			this.#elements.metaOwnerValue.rel = 'noopener';
		} else {
			this.#elements.metaOwnerValue.removeAttribute('href');
			this.#elements.metaOwnerValue.removeAttribute('data-user-card');
			this.#elements.metaOwnerValue.removeAttribute('target');
			this.#elements.metaOwnerValue.removeAttribute('rel');
		}

		this.#topicTags.replaceChildren();
		const renderedCategory = snapshot.category
			? Object.freeze({
				...snapshot.category,
				href: snapshot.category.href || hostIcons.categoryHref,
			})
			: (
			hostIcons.categoryName
				? Object.freeze({
					id: hostIcons.categoryId,
					name: hostIcons.categoryName,
					level: hostIcons.categoryLevel,
					icon: '',
					href: hostIcons.categoryHref,
				})
				: null
			);
		if (renderedCategory) {
			const label = renderedCategory.level
				? `${renderedCategory.name}, ${renderedCategory.level}`
				: renderedCategory.name;
			appendLinkedIdentity(
				document,
				this.#topicTags,
				'ldp-topic-tag ldp-topic-category',
				label,
				renderedCategory.href,
				renderedCategory.icon,
				this.#renderIcon,
				hostIcons.categoryIcon,
			);
		}
		for (const tag of snapshot.tags) {
			appendLinkedIdentity(
				document,
				this.#topicTags,
				'ldp-topic-tag ldp-topic-label',
				tag.name,
				tag.href || hostIcons.tagHrefs.get(tag.name) || '',
				tag.icon,
				this.#renderIcon,
				hostIcons.tagIcons.get(tag.name) ?? null,
			);
		}
		this.#topicTags.hidden = this.#topicTags.childElementCount === 0;
		this.#renderTopicVote(snapshot.vote);
		this.#queueTopicHints();
		if (
			hasCompleteHostIdentityIcons(hostIcons, snapshot) &&
			!(
				snapshot.categoryId > 0 &&
				!snapshot.category &&
				!hostIcons.categoryName
			)
		) {
			this.#stopHostMetadataHydration();
		}
	}

	destroy(): void {
		this.scope.destroy();
	}

	#startHostMetadataHydration(
		createMutationObserver:
			ReaderTopicHeaderViewOptions['createMutationObserver'],
	): void {
		const refreshed = this.#controller.refresh();
		const metadata = readReaderTopicHostIconMetadata(
			this.#hostDocument,
			refreshed,
		);
		if (
			!(
				refreshed.categoryId > 0 &&
				!refreshed.category &&
				!metadata.categoryName
			) &&
			hasCompleteHostIdentityIcons(metadata, refreshed)
		) {
			this.render(refreshed);
			return;
		}
		const document = this.#hostDocument;
		const root = document.querySelector('#main-outlet,#ember-app') ??
			document.body ??
			document.documentElement;
		const NativeMutationObserver = document.defaultView?.MutationObserver;
		if (!root || (!createMutationObserver && !NativeMutationObserver)) return;
		const onMutation: MutationCallback = (records) => {
			if (!records.some((record) => {
				const target = record.target as Element;
				return typeof target.closest !== 'function' ||
					!target.closest('.ldp-overlay');
			})) return;
			this.#queueHostMetadataSync();
		};
		this.#hostMetadataObserver = createMutationObserver?.(onMutation) ??
			(NativeMutationObserver
				? new NativeMutationObserver(onMutation)
				: null);
		this.#hostMetadataObserver?.observe(root, {
			childList: true,
			subtree: true,
		});
		this.#hostMetadataRetryDelay = 80;
		this.#queueHostMetadataSync();
		this.#hostMetadataStopTimer = document.defaultView?.setTimeout(
			() => this.#stopHostMetadataHydration(),
			60_000,
		) ?? 0;
	}

	#queueHostMetadataSync(): void {
		if (this.#hostMetadataFrame || this.scope.destroyed) return;
		this.#hostMetadataFrame = this.#requestFrame(() => {
			this.#hostMetadataFrame = 0;
			if (this.scope.destroyed) return;
			const previous = this.#controller.snapshot;
			const next = this.#controller.refresh();
			if (next === previous) this.render(next);
			if (this.#hostMetadataObserver) this.#scheduleHostMetadataRetry();
		});
	}

	#scheduleHostMetadataRetry(): void {
		if (this.#hostMetadataRetryTimer || !this.#hostMetadataObserver) return;
		const window = this.#hostDocument.defaultView;
		if (!window) return;
		const delay = this.#hostMetadataRetryDelay;
		this.#hostMetadataRetryDelay = Math.min(delay * 2, 4_000);
		this.#hostMetadataRetryTimer = window.setTimeout(() => {
			this.#hostMetadataRetryTimer = 0;
			this.#queueHostMetadataSync();
		}, delay);
	}

	#stopHostMetadataHydration(): void {
		this.#hostMetadataObserver?.disconnect();
		this.#hostMetadataObserver = null;
		if (this.#hostMetadataFrame) {
			this.#cancelFrame(this.#hostMetadataFrame);
			this.#hostMetadataFrame = 0;
		}
		if (this.#hostMetadataStopTimer) {
			this.#hostDocument.defaultView?.clearTimeout(
				this.#hostMetadataStopTimer,
			);
			this.#hostMetadataStopTimer = 0;
		}
		if (this.#hostMetadataRetryTimer) {
			this.#hostDocument.defaultView?.clearTimeout(
				this.#hostMetadataRetryTimer,
			);
			this.#hostMetadataRetryTimer = 0;
		}
	}

	async #jumpFirst(): Promise<void> {
		try {
			await this.#onJumpFirst();
		} catch (error) {
			if (!this.scope.destroyed) this.#onError(error);
		}
	}

	async #toggleTopicVote(): Promise<void> {
		const vote = this.#controller.snapshot.vote;
		if (!vote || !this.#onToggleTopicVote || this.#topicVotePending) return;
		this.#topicVotePending = true;
		this.#renderTopicVote(vote);
		try {
			await this.#onToggleTopicVote(vote.voted);
		} catch (error) {
			if (!this.scope.destroyed) this.#onError(error);
		} finally {
			this.#topicVotePending = false;
			if (!this.scope.destroyed) {
				this.#renderTopicVote(this.#controller.snapshot.vote);
			}
		}
	}

	#renderTopicVote(vote: ReaderTopicHeaderVote | null): void {
		if (!vote) {
			this.#topicVote.replaceChildren();
			this.#topicVote.hidden = true;
			return;
		}
		this.#topicVote.hidden = false;
		let button = this.#topicVote.querySelector<HTMLButtonElement>(
			':scope > .ldp-topic-vote',
		);
		if (!button) {
			button = this.#topicVote.ownerDocument.createElement('button');
			button.type = 'button';
			button.className = 'ldp-topic-vote';
			button.dataset.topicVote = '';
			const countNode = this.#topicVote.ownerDocument.createElement('span');
			button.append('▲ ', countNode, ' 票');
			this.#topicVote.append(button);
		}
		button.classList.toggle('on', vote.voted);
		button.setAttribute('aria-pressed', String(vote.voted));
		button.setAttribute(
			'aria-label',
			`${vote.voted ? '取消主题投票' : '为主题投票'}，当前 ${vote.count} 票`,
		);
		button.disabled = this.#topicVotePending || (!vote.canVote && !vote.voted);
		button.toggleAttribute('aria-busy', this.#topicVotePending);
		button.querySelector('span')!.textContent = String(vote.count);
	}

	#queueTopicHints(): void {
		if (this.scope.destroyed || this.#topicHintFrame) return;
		this.#topicHintFrame = this.#requestFrame(() => {
			this.#topicHintFrame = 0;
			if (this.scope.destroyed) return;
			const row = this.#elements.topicIdentityHost;
			const scroller = this.#topicScroller;
			const hasOverflow =
				(!this.#topicTags.hidden || !this.#topicVote.hidden) &&
				scroller.scrollWidth > row.clientWidth + 1;
			const maxScrollLeft = Math.max(
				0,
				scroller.scrollWidth - scroller.clientWidth,
			);
			row.classList.toggle('has-overflow', hasOverflow);
			row.classList.toggle(
				'can-scroll-left',
				hasOverflow && scroller.scrollLeft > 1,
			);
			row.classList.toggle(
				'can-scroll-right',
				hasOverflow && scroller.scrollLeft < maxScrollLeft - 1,
			);
		});
	}

	#onTopicWheel(event: WheelEvent): void {
		const rawDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
			? event.deltaX
			: event.deltaY;
		if (!rawDelta) return;
		const maxScrollLeft = Math.max(
			0,
			this.#topicScroller.scrollWidth - this.#topicScroller.clientWidth,
		);
		if (maxScrollLeft <= 1) return;
		const delta = event.deltaMode === 1
			? rawDelta * 40
			: event.deltaMode === 2
				? rawDelta * this.#topicScroller.clientWidth
				: rawDelta;
		const nextScrollLeft = Math.min(
			maxScrollLeft,
			Math.max(0, this.#topicScroller.scrollLeft + delta),
		);
		if (nextScrollLeft === this.#topicScroller.scrollLeft) return;
		event.preventDefault();
		event.stopPropagation();
		this.#topicScroller.scrollLeft = nextScrollLeft;
		this.#queueTopicHints();
	}

	#renderOnlyOp(snapshot: ReaderTopicOnlyOpSnapshot | null): void {
		const enabled = snapshot?.enabled === true;
		const available = snapshot?.available === true;
		this.#elements.onlyOpToggle.disabled = !available;
		this.#elements.onlyOpToggle.classList.toggle('active', enabled);
		this.#elements.onlyOpToggle.setAttribute(
			'aria-pressed',
			String(enabled),
		);
		this.#elements.onlyOpToggle.setAttribute(
			'aria-label',
			enabled ? '显示全部楼层' : '只看楼主',
		);
		const showProgress = Boolean(
			enabled &&
			snapshot &&
			!snapshot.complete &&
			snapshot.totalPostCount > 0,
		);
		this.#elements.onlyOpProgress.hidden = !showProgress;
		if (!showProgress || !snapshot) {
			this.#elements.onlyOpProgressValue.textContent = '';
			this.#elements.onlyOpProgress.style.removeProperty(
				'--ldp-only-op-progress',
			);
			return;
		}
		const percent = Math.min(
			100,
			snapshot.loadedPostCount / snapshot.totalPostCount * 100,
		);
		this.#elements.onlyOpProgress.style.setProperty(
			'--ldp-only-op-progress',
			`${percent.toFixed(1)}%`,
		);
		this.#elements.onlyOpProgressValue.textContent =
			`已载入 ${snapshot.loadedPostCount}/${snapshot.totalPostCount}` +
			` · 楼主 ${snapshot.ownerPostCount}`;
	}
}
