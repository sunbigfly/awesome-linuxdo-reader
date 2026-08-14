import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import { abortableDelay } from '../network/coordinated-request-client.js';
import type { TranslationBatchPort } from './translation-request-adapter.js';
import type { ReaderTranslationAnimation } from './reader-translation-config.js';
import {
	DEFAULT_READER_TRANSLATION_THEME,
	type ReaderTranslationTheme,
} from './reader-translation-presentation.js';
import {
	renderTranslationText,
	translationBlockNeedsTranslation,
	translationBlocks,
	translationProtectedTokensMatch,
	translationSourceText,
	translationTextsFromHtml,
} from './translation-text.js';

export type ReaderTranslationMode = 'original' | 'bilingual' | 'translation';

export interface ReaderTranslationPostMetadata {
	readonly postType: number;
	readonly username: string;
	readonly actionCode?: string | null;
	readonly hydrated: boolean;
}

export interface ReaderTranslationPreloadPost {
	readonly cooked?: unknown;
	readonly post_type?: unknown;
	readonly username?: unknown;
	readonly action_code?: unknown;
}

export interface ReaderOfflineTranslationOptions {
	readonly onProgress?: (completed: number, total: number) => void;
}

export interface ReaderTranslationSnapshot {
	readonly mode: ReaderTranslationMode;
	readonly active: boolean;
	readonly busy: boolean;
	readonly queued: number;
}

export interface ReaderTranslationControllerOptions {
	readonly translator: TranslationBatchPort;
	readonly surfaces: () => readonly HTMLElement[];
	readonly initialMode: ReaderTranslationMode;
	readonly initialAnimation?: ReaderTranslationAnimation;
	readonly initialTheme?: ReaderTranslationTheme;
	readonly persistMode?: (mode: ReaderTranslationMode) => void;
	readonly readPost?: (
		post: HTMLElement,
	) => ReaderTranslationPostMetadata;
	readonly startupDelayMs?: number;
	readonly delay?: (
		milliseconds: number,
		signal: AbortSignal,
	) => Promise<void>;
	readonly isSectionVisible?: (section: Element) => boolean;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
	readonly notify?: (message: string) => void;
}

interface TranslationQueueEntry {
	readonly text: string;
	readonly nodes: Set<Element>;
	readonly generation: number;
	priority: 'visible' | 'prefetch';
}

const TRANSLATION_PRELOAD_WORKERS = 5;
const TRANSLATION_MAX_WORKERS = 6;
const TRANSLATION_PREFETCH_BATCH_MAX_ENTRIES = 20;
const TRANSLATION_PREFETCH_BATCH_MAX_CHARACTERS = 3_500;
const TRANSLATION_ANIMATION_SEGMENT_LIMIT = 120;
const SEGMENTED_TRANSLATION_ANIMATIONS = new Set<ReaderTranslationAnimation>([
	'fade',
	'blur',
	'shimmer',
	'spring',
]);

interface TranslationAnimationToken {
	text: string;
	animated: boolean;
}

interface TranslationAnimationTextPlan {
	readonly node: Text;
	readonly tokens: readonly TranslationAnimationToken[];
}

interface AttachedTranslation {
	readonly output: HTMLElement;
	readonly source: string;
	readonly translation: string;
}

function translationAnimationTokens(value: string): readonly TranslationAnimationToken[] {
	const raw = typeof Intl.Segmenter === 'function'
		? [...new Intl.Segmenter('zh-CN', { granularity: 'word' }).segment(value)]
			.map((entry) => ({
				text: entry.segment,
				animated: entry.isWordLike === true,
			}))
		: (value.match(/\s+|[\p{L}\p{M}\p{N}]+|./gu) ?? [value]).map((text) => ({
			text,
			animated: /[\p{L}\p{N}]/u.test(text),
		}));
	const tokens: TranslationAnimationToken[] = [];
	let prefix = '';
	for (const entry of raw) {
		if (entry.animated) {
			tokens.push({ text: `${prefix}${entry.text}`, animated: true });
			prefix = '';
			continue;
		}
		if (/^\s+$/u.test(entry.text)) {
			if (prefix) {
				const previous = tokens.at(-1);
				if (previous?.animated) previous.text += prefix;
				else tokens.push({ text: prefix, animated: false });
				prefix = '';
			}
			tokens.push({ text: entry.text, animated: false });
			continue;
		}
		const previous = tokens.at(-1);
		if (previous?.animated) previous.text += entry.text;
		else prefix += entry.text;
	}
	if (prefix) {
		const previous = tokens.at(-1);
		if (previous?.animated) previous.text += prefix;
		else tokens.push({ text: prefix, animated: false });
	}
	return Object.freeze(tokens);
}

function segmentTranslationOutput(output: HTMLElement): readonly HTMLElement[] {
	const document = output.ownerDocument;
	const showText = document.defaultView?.NodeFilter?.SHOW_TEXT ?? 4;
	const walker = document.createTreeWalker(output, showText);
	const plans: TranslationAnimationTextPlan[] = [];
	let tokenCount = 0;
	for (let node = walker.nextNode(); node; node = walker.nextNode()) {
		if (node.nodeType !== 3 || !node.nodeValue?.trim()) continue;
		const tokens = translationAnimationTokens(node.nodeValue);
		const animated = tokens.filter((token) => token.animated).length;
		if (!animated) continue;
		plans.push({ node: node as Text, tokens });
		tokenCount += animated;
	}
	if (!tokenCount) return Object.freeze([]);
	const groupSize = Math.max(
		1,
		Math.ceil(tokenCount / TRANSLATION_ANIMATION_SEGMENT_LIMIT),
	);
	const segments: HTMLElement[] = [];
	for (const plan of plans) {
		const fragment = document.createDocumentFragment();
		let buffer = '';
		let bufferedTokens = 0;
		const flush = (): void => {
			if (!buffer) return;
			const segment = document.createElement('span');
			segment.className = 'ldp-translation-segment';
			segment.textContent = buffer;
			segments.push(segment);
			fragment.append(segment);
			buffer = '';
			bufferedTokens = 0;
		};
		for (const token of plan.tokens) {
			if (!token.animated) {
				if (buffer) buffer += token.text;
				else fragment.append(document.createTextNode(token.text));
				continue;
			}
			if (bufferedTokens >= groupSize) flush();
			buffer += token.text;
			bufferedTokens += 1;
			if (bufferedTokens >= groupSize) flush();
		}
		flush();
		plan.node.replaceWith(fragment);
	}
	const staggerMs = Math.min(
		42,
		Math.max(8, Math.floor(720 / Math.max(1, segments.length - 1))),
	);
	segments.forEach((segment, index) => {
		segment.style.setProperty(
			'--ldp-translation-segment-delay',
			`${index * staggerMs}ms`,
		);
	});
	segments.at(-1)?.classList.add('ldp-translation-segment-last');
	return Object.freeze(segments);
}

function collapsedTranslationDetails(node: Element): HTMLDetailsElement | null {
	const details = node.closest<HTMLDetailsElement>('details:not([open])');
	if (!details) return null;
	const directSummary = details.querySelector(':scope > summary');
	return directSummary?.contains(node) ? null : details;
}

function translationSectionVisible(node: Element): boolean {
	if (!node.isConnected || node.closest('[hidden]')) return false;
	const checkVisibility = (node as Element & {
		checkVisibility?: (options?: Readonly<Record<string, boolean>>) => boolean;
	}).checkVisibility;
	if (typeof checkVisibility === 'function') {
		try {
			if (!checkVisibility.call(node, {
				contentVisibilityAuto: true,
				visibilityProperty: true,
			})) return false;
		} catch {
			// 旧 Chromium 不认识扩展选项时继续使用几何可见性。
		}
	}
	const viewport = node.ownerDocument.defaultView;
	const width = Number(viewport?.innerWidth);
	const height = Number(viewport?.innerHeight);
	if (!(width > 0) || !(height > 0)) return true;
	const rect = node.getBoundingClientRect();
	return rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
}

function translationSectionAnimationKey(node: Element, source: string): string {
	const post = node.closest<HTMLElement>('.ldp-post');
	const content = node.closest<HTMLElement>('.ldp-content');
	const postIdentity = post?.dataset.postId ?? post?.dataset.postNumber ??
		post?.dataset.username ?? 'anonymous';
	const contentIdentity = content?.classList.contains('ldp-solved-excerpt')
		? 'solved'
		: 'body';
	const blockIndex = content ? translationBlocks(content).indexOf(node) : -1;
	return [postIdentity, contentIdentity, blockIndex, node.tagName, source].join('\u001f');
}

function startupDelay(value: number | undefined): number {
	const normalized = Number(value ?? 120);
	if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > 10_000) {
		throw new RangeError('翻译 startupDelayMs 必须是 0..10000 的安全整数');
	}
	return normalized;
}

function retryDelayMs(
	error: unknown,
	retryIndex: number,
	priority: 'visible' | 'prefetch',
): number | null {
	if (retryIndex >= 2) return null;
	const source = error && typeof error === 'object'
		? error as Readonly<Record<string, unknown>>
		: null;
	if (
		source?.name === 'AbortError' ||
		source?.cloudflareMitigated === true ||
		[400, 401, 403, 404, 410, 422].includes(Number(source?.status))
	) return null;
	const decision = source?.decision && typeof source.decision === 'object'
		? source.decision as Readonly<Record<string, unknown>>
		: null;
	const retryAfter = Number(decision?.waitMs);
	if (Number.isFinite(retryAfter) && retryAfter > 0) {
		return Math.min(15_000, Math.max(350, retryAfter));
	}
	return priority === 'visible'
		? [350, 900][retryIndex]!
		: [800, 1_800][retryIndex]!;
}

function defaultPostMetadata(post: HTMLElement): ReaderTranslationPostMetadata {
	const postType = Number(post.dataset.postType ?? 1);
	return Object.freeze({
		postType: Number.isSafeInteger(postType) ? postType : 1,
		username: String(post.dataset.username ?? ''),
		actionCode: post.dataset.actionCode ?? null,
		hydrated: post.dataset.ldpContentHydrated !== '0',
	});
}

function normalizedMode(value: ReaderTranslationMode): ReaderTranslationMode {
	if (!['original', 'bilingual', 'translation'].includes(value)) {
		throw new Error(`正文翻译模式非法：${String(value)}`);
	}
	return value;
}

/**
 * 主评论流、完整讨论浮窗和特殊正文共用的唯一翻译 DOM/state owner。
 *
 * 它只提取文本、维护 Topic/窗口 queue、写入命名 translation span；请求、provider fallback、
 * 配额和缓存由 TranslationBatchPort 背后的翻译专属任务 owner 负责。
 */
export class ReaderTranslationController {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderTranslationSnapshot>();
	readonly #translator: TranslationBatchPort;
	readonly #surfaces: () => readonly HTMLElement[];
	readonly #persistMode: ((mode: ReaderTranslationMode) => void) | undefined;
	readonly #readPost: (post: HTMLElement) => ReaderTranslationPostMetadata;
	readonly #delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
	readonly #isSectionVisible: (section: Element) => boolean;
	readonly #startupDelayMs: number;
	readonly #onError: (error: unknown) => void;
	readonly #notify: (message: string) => void;
	readonly #queue = new Map<string, TranslationQueueEntry>();
	readonly #inFlight = new Map<string, TranslationQueueEntry>();
	readonly #preloadContext = new Set<string>();
	readonly #styledSurfaces = new Set<HTMLElement>();
	readonly #animationCleanups = new Map<HTMLElement, () => void>();
	readonly #attachedTranslations = new WeakMap<Element, AttachedTranslation>();
	readonly #settledTranslations = new Map<string, string>();
	readonly #settledAnimationSections = new Set<string>();
	#mode: ReaderTranslationMode;
	#animation: ReaderTranslationAnimation;
	#theme: ReaderTranslationTheme;
	#active: boolean;
	#draining = false;
	#destroyed = false;
	#requestController: AbortController | null = null;
	#drainPromise: Promise<void> | null = null;
	#startUrgentWorker: (() => void) | null = null;
	#activeTopicKey: string | null = null;
	#generation = 0;
	#restartAfterDrain = false;
	#started = false;

	constructor(options: ReaderTranslationControllerOptions) {
		this.#translator = options.translator;
		this.#surfaces = options.surfaces;
		this.#mode = normalizedMode(options.initialMode);
		this.#animation = options.initialAnimation ?? 'fade';
		this.#theme = options.initialTheme ?? DEFAULT_READER_TRANSLATION_THEME;
		this.#active = this.#mode !== 'original';
		this.#persistMode = options.persistMode;
		this.#readPost = options.readPost ?? defaultPostMetadata;
		this.#delay = options.delay ?? abortableDelay;
		this.#isSectionVisible = options.isSectionVisible ?? translationSectionVisible;
		this.#startupDelayMs = startupDelay(options.startupDelayMs);
		this.#onError = options.onError ?? (() => {});
		this.#notify = options.notify ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#destroyed = true;
			this.#active = false;
			this.#queue.clear();
			this.#inFlight.clear();
			this.#preloadContext.clear();
			this.#settledTranslations.clear();
			this.#startUrgentWorker = null;
			this.#requestController?.abort(
				new DOMException('正文翻译已销毁', 'AbortError'),
			);
			this.#requestController = null;
			for (const cleanup of [...this.#animationCleanups.values()]) cleanup();
			this.#animationCleanups.clear();
			this.#settledAnimationSections.clear();
			for (const surface of this.#styledSurfaces) {
				surface.classList.remove(
					'ldp-translation-active',
					'ldp-translation-only',
				);
				delete surface.dataset.translationAnimation;
				delete surface.dataset.translationTheme;
			}
			this.#styledSurfaces.clear();
			this.changes.clear();
		});
		this.#applyMode();
	}

	get mode(): ReaderTranslationMode {
		return this.#mode;
	}

	get theme(): ReaderTranslationTheme {
		return this.#theme;
	}

	setAnimation(animation: ReaderTranslationAnimation): void {
		if (this.#destroyed || this.#animation === animation) return;
		for (const cleanup of [...this.#animationCleanups.values()]) cleanup();
		this.#animation = animation;
		this.#applyMode();
	}

	setTheme(theme: ReaderTranslationTheme): void {
		if (this.#destroyed || this.#theme === theme) return;
		this.#theme = theme;
		this.#applyMode();
	}

	activateTopic(topicId: string | number): number {
		if (this.#destroyed) return this.#generation;
		const key = String(topicId);
		this.#activeTopicKey = key;
		this.#resetTranslationWork('正文翻译已切换帖子');
		return this.#generation;
	}

	deactivateTopic(topicId: string | number, generation?: number): void {
		if (
			this.#destroyed ||
			this.#activeTopicKey !== String(topicId) ||
			(generation !== undefined && generation !== this.#generation)
		) return;
		this.#activeTopicKey = null;
		this.#resetTranslationWork('正文翻译帖子已关闭');
	}

	snapshot(): ReaderTranslationSnapshot {
		return Object.freeze({
			mode: this.#mode,
			active: this.#active,
			busy: this.#draining && this.#active,
			queued: this.#queue.size,
		});
	}

	start(): void {
		if (this.#destroyed || this.#started) return;
		this.#started = true;
		if (this.#active) {
			this.syncMountedPosts();
			void this.flush();
		}
	}

	setMode(
		modeValue: ReaderTranslationMode,
		options: Readonly<{ readonly persist?: boolean }> = {},
	): void {
		if (this.#destroyed) return;
		const mode = normalizedMode(modeValue);
		this.#mode = mode;
		this.#active = mode !== 'original';
		if (!this.#active) {
			this.#queue.clear();
			this.#clearLoadingTranslations();
			this.#requestController?.abort(
				new DOMException('正文翻译已关闭', 'AbortError'),
			);
		} else {
			if (this.#drainPromise) this.#restartAfterDrain = true;
			this.#queuePreloadContext();
			this.syncMountedPosts();
			void this.flush();
		}
		if (options.persist !== false) this.#persistMode?.(mode);
		this.#applyMode();
	}

	cycleMode(): ReaderTranslationMode {
		const next = !this.#active
			? 'bilingual'
			: this.#mode === 'bilingual'
				? 'translation'
				: 'original';
		this.setMode(next);
		this.#notify(
			next === 'bilingual'
				? '正文翻译：双语显示'
				: next === 'translation'
					? '正文翻译：全译文'
					: '已恢复原文',
		);
		return next;
	}

	syncMountedPosts(): void {
		if (this.#destroyed) return;
		this.#applyMode();
		if (!this.#active) return;
		for (const surface of this.#translationSurfaces()) {
			surface.querySelectorAll<HTMLElement>('.ldp-post')
				.forEach((post) => this.syncPost(post));
		}
	}

	syncPost(
		post: HTMLElement,
		metadata: ReaderTranslationPostMetadata = this.#readPost(post),
	): void {
		if (this.#destroyed || !this.#active) return;
		for (const [output, cleanup] of this.#animationCleanups) {
			if (!output.isConnected) cleanup();
		}
		const username = String(metadata.username).trim().toLocaleLowerCase();
		if (
			metadata.postType !== 1 ||
			String(metadata.actionCode ?? '').trim() ||
			username === 'system' ||
			username === 'discobot' ||
			!metadata.hydrated
		) {
			return;
		}
		const contents = [...new Set([
			post.querySelector(
				':scope > .ldp-post-body > .ldp-content',
			),
			post.querySelector(':scope > .ldp-content'),
			...post.querySelectorAll(
				':scope > .ldp-post-body > .ldp-post-body-layer ' +
				'.ldp-solved-card .ldp-solved-excerpt.ldp-content,' +
				':scope > .ldp-solved-card ' +
				'.ldp-solved-excerpt.ldp-content',
			),
		].filter((node): node is Element => node !== null))];
		for (const block of contents.flatMap((content) =>
			[...translationBlocks(content)])) {
			this.#queueBlock(block);
		}
		this.#applyMode();
		void this.flush();
	}

	/**
	 * 把当前 Topic 已取得的译文投影到离线 cooked；只消费本控制器已完成的结果，
	 * 不排队、不读缓存也不发起下载阶段网络请求。
	 */
	projectKnownTranslations(root: ParentNode): number {
		if (this.#destroyed || !this.#active) return 0;
		return this.projectOfflineTranslations(root, this.#settledTranslations);
	}

	projectOfflineTranslations(
		root: ParentNode,
		translations: ReadonlyMap<string, string>,
	): number {
		let projected = 0;
		for (const block of translationBlocks(root)) {
			const source = translationSourceText(block);
			const translation = translations.get(source);
			if (!translation) continue;
			this.#attachTranslation(block, source, translation);
			projected += 1;
		}
		return projected;
	}

	/**
	 * 下载阶段补齐所选正文的全部译文，再由 projectKnownTranslations 写入离线 cooked。
	 * 请求仍走唯一 TranslationBatchPort，因此复用 provider、缓存、配额与中央调度。
	 */
	async prepareOfflineTranslations(
		document: Document,
		posts: readonly ReaderTranslationPreloadPost[],
		signal: AbortSignal,
		options: ReaderOfflineTranslationOptions = {},
	): Promise<ReadonlyMap<string, string>> {
		if (this.#destroyed || !this.#active) return new Map();
		if (signal.aborted) throw signal.reason;
		const sources = new Set<string>();
		for (const post of posts) {
			const username = String(post.username ?? '').trim().toLocaleLowerCase();
			if (
				Number(post.post_type ?? 1) !== 1 ||
				String(post.action_code ?? '').trim() ||
				username === 'system' ||
				username === 'discobot'
			) continue;
			for (const text of translationTextsFromHtml(document, post.cooked)) {
				sources.add(text);
			}
		}
		await this.flush();
		if (signal.aborted) throw signal.reason;
		const prepared = new Map<string, string>();
		for (const source of sources) {
			const translation = this.#settledTranslations.get(source);
			if (translation) prepared.set(source, translation);
		}
		options.onProgress?.(prepared.size, sources.size);
		const pending = [...sources].filter((source) => !prepared.has(source));
		for (let offset = 0; offset < pending.length;) {
			const batch: string[] = [];
			let characters = 0;
			while (offset < pending.length) {
				const source = pending[offset]!;
				if (
					batch.length &&
					(batch.length >= TRANSLATION_PREFETCH_BATCH_MAX_ENTRIES ||
						characters + source.length >
							TRANSLATION_PREFETCH_BATCH_MAX_CHARACTERS)
				) break;
				batch.push(source);
				characters += source.length;
				offset += 1;
			}
			let translations: readonly string[] = [];
			for (let retryIndex = 0; ; retryIndex += 1) {
				try {
					translations = await this.#translator.translate(
						batch,
						signal,
						{ priority: 'prefetch' },
					);
					break;
				} catch (error) {
					const waitMs = retryDelayMs(error, retryIndex, 'prefetch');
					if (waitMs === null || signal.aborted) throw error;
					await this.#delay(waitMs, signal);
					if (this.#destroyed) {
						throw new DOMException('正文翻译已销毁', 'AbortError');
					}
				}
			}
			if (translations.length !== batch.length) {
				throw new Error('离线 HTML 翻译返回数量不匹配');
			}
			batch.forEach((source, index) => {
				const translation = String(translations[index] ?? '').trim();
				if (
					!translation ||
					!translationProtectedTokensMatch(source, translation)
				) {
					throw new Error('离线 HTML 译文为空或改写了正文占位符');
				}
				this.#settledTranslations.set(source, translation);
				prepared.set(source, translation);
			});
			options.onProgress?.(prepared.size, sources.size);
		}
		return prepared;
	}

	updatePreloadWindow(
		document: Document,
		topicId: string | number,
		posts: readonly ReaderTranslationPreloadPost[],
		generation?: number,
	): void {
		if (this.#destroyed) return;
		if (generation !== undefined && generation !== this.#generation) return;
		if (this.#activeTopicKey !== String(topicId)) this.activateTopic(topicId);
		const nextContext = new Set<string>();
		for (const post of posts) {
			const username = String(post.username ?? '').trim().toLocaleLowerCase();
			if (
				Number(post.post_type ?? 1) !== 1 ||
				String(post.action_code ?? '').trim() ||
				username === 'system' ||
				username === 'discobot'
			) continue;
			for (const text of translationTextsFromHtml(document, post.cooked)) {
				nextContext.add(text);
			}
		}
		this.#preloadContext.clear();
		nextContext.forEach((text) => this.#preloadContext.add(text));
		for (const [text, entry] of this.#queue) {
			if (
				entry.generation === this.#generation &&
				entry.priority === 'prefetch' &&
				![...entry.nodes].some((node) => node.isConnected) &&
				!nextContext.has(text)
			) this.#queue.delete(text);
		}
		if (!this.#active) return;
		this.#queuePreloadContext();
		void this.flush();
	}

	/** @deprecated 仅供旧调用点兼容；新 Topic owner 应显式传入窗口身份。 */
	preloadPosts(
		document: Document,
		posts: readonly ReaderTranslationPreloadPost[],
	): void {
		this.updatePreloadWindow(document, this.#activeTopicKey ?? 'legacy', posts);
	}

	flush(): Promise<void> {
		if (this.#drainPromise) {
			const current = this.#drainPromise;
			return current.then(() => this.#drainPromise ? this.flush() : undefined);
		}
		if (this.#destroyed || !this.#active || !this.#queue.size) {
			return Promise.resolve();
		}
		const operation = this.#drain().finally(() => {
			if (this.#drainPromise !== operation) return;
			this.#drainPromise = null;
			if (this.#restartAfterDrain) {
				this.#restartAfterDrain = false;
				if (this.#active && this.#queue.size) void this.flush();
			}
		});
		this.#drainPromise = operation;
		return operation.then(() => this.#drainPromise ? this.flush() : undefined);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#translationSurfaces(): readonly HTMLElement[] {
		const seen = new Set<HTMLElement>();
		const surfaces: HTMLElement[] = [];
		for (const surface of this.#surfaces()) {
			if (!surface || seen.has(surface)) continue;
			seen.add(surface);
			surfaces.push(surface);
		}
		return Object.freeze(surfaces);
	}

	#applyMode(): void {
		const surfaces = this.#translationSurfaces();
		const mounted = new Set(surfaces);
		for (const surface of this.#styledSurfaces) {
			if (mounted.has(surface)) continue;
			surface.classList.remove(
				'ldp-translation-active',
				'ldp-translation-only',
			);
			delete surface.dataset.translationAnimation;
			delete surface.dataset.translationTheme;
			this.#styledSurfaces.delete(surface);
		}
		for (const surface of surfaces) {
			surface.dataset.translationAnimation = this.#animation;
			surface.dataset.translationTheme = this.#theme;
			surface.classList.toggle('ldp-translation-active', this.#active);
			surface.classList.toggle(
				'ldp-translation-only',
				this.#active && this.#mode === 'translation',
			);
			if (this.#active) this.#styledSurfaces.add(surface);
			else this.#styledSurfaces.delete(surface);
		}
		this.#emit();
	}

	#emit(): void {
		if (this.#destroyed) return;
		this.changes.emit(this.snapshot()).forEach(this.#onError);
	}

	#resetTranslationWork(message: string): void {
		this.#generation += 1;
		this.#queue.clear();
		this.#inFlight.clear();
		this.#preloadContext.clear();
		this.#settledTranslations.clear();
		this.#clearLoadingTranslations();
		this.#restartAfterDrain = this.#drainPromise !== null;
		this.#requestController?.abort(new DOMException(message, 'AbortError'));
		this.#emit();
	}

	#queuePreloadContext(): void {
		for (const text of this.#preloadContext) {
			const inFlight = this.#inFlight.get(text);
			if (inFlight?.generation === this.#generation) continue;
			const queued = this.#queue.get(text);
			if (queued?.generation === this.#generation) continue;
			this.#queue.set(text, {
				text,
				nodes: new Set<Element>(),
				generation: this.#generation,
				priority: 'prefetch',
			});
		}
	}

	#queueBlock(node: Element): void {
		const text = translationSourceText(node);
		if (!translationBlockNeedsTranslation(text)) return;
		const output = node.querySelector(':scope > .ldp-translation-text');
		if (
			node.classList.contains('ldp-translation-source') &&
			output?.textContent?.trim()
		) {
			return;
		}
		const inFlight = this.#inFlight.get(text);
		const priority = this.#isSectionVisible(node) ? 'visible' : 'prefetch';
		if (
			inFlight?.generation === this.#generation &&
			!this.#requestController?.signal.aborted
		) {
			if (priority === 'visible') inFlight.priority = 'visible';
			inFlight.nodes.add(node);
			this.#markLoading(node);
			return;
		}
		const queued = this.#queue.get(text);
		const current: TranslationQueueEntry =
			queued?.generation === this.#generation ? queued : {
			text,
			nodes: new Set<Element>(),
			generation: this.#generation,
			priority,
			};
		if (priority === 'visible') current.priority = 'visible';
		current.nodes.add(node);
		this.#queue.set(text, current);
		this.#markLoading(node);
		this.#startUrgentWorker?.();
	}

	#nextBatch(): readonly TranslationQueueEntry[] {
		const entries: TranslationQueueEntry[] = [];
		let characters = 0;
		const priority = [...this.#queue.values()].some((entry) =>
			entry.priority === 'visible')
			? 'visible'
			: 'prefetch';
		const maximumEntries = priority === 'visible'
			? 6
			: TRANSLATION_PREFETCH_BATCH_MAX_ENTRIES;
		const maximumCharacters = priority === 'visible'
			? 1_400
			: TRANSLATION_PREFETCH_BATCH_MAX_CHARACTERS;
		for (const entry of this.#queue.values()) {
			if (entry.priority !== priority) continue;
			if (
				entries.length &&
				(entries.length >= maximumEntries ||
					characters + entry.text.length > maximumCharacters)
			) {
				break;
			}
			this.#queue.delete(entry.text);
			entries.push(entry);
			characters += entry.text.length;
		}
		return Object.freeze(entries);
	}

	#requeue(entries: readonly TranslationQueueEntry[]): void {
		for (const entry of entries) {
			if (entry.generation !== this.#generation) continue;
			const queued = this.#queue.get(entry.text) ?? entry;
			entry.nodes.forEach((node) => queued.nodes.add(node));
			if (entry.priority === 'visible') queued.priority = 'visible';
			this.#queue.set(entry.text, queued);
		}
	}

	async #drain(): Promise<void> {
		const generation = this.#generation;
		this.#draining = true;
		this.#emit();
		const controller = new AbortController();
		this.#requestController = controller;
		let failure: unknown = null;
		const worker = async (visibleOnly = false): Promise<void> => {
			while (
				this.#queue.size &&
				this.#active &&
				!this.#destroyed &&
				generation === this.#generation &&
				!controller.signal.aborted
			) {
				if (
					visibleOnly &&
					![...this.#queue.values()].some((entry) =>
						entry.priority === 'visible')
				) return;
				const current = this.#nextBatch();
				if (!current.length) return;
				current.forEach((entry) => this.#inFlight.set(entry.text, entry));
				try {
					const priority = current.some((entry) =>
						entry.priority === 'visible')
						? 'visible'
						: 'prefetch';
					let translations: readonly string[] = [];
					for (let retryIndex = 0; ; retryIndex += 1) {
						try {
							translations = await this.#translator.translate(
								current.map((entry) => entry.text),
								controller.signal,
								{
									priority,
									cacheContext: Object.freeze([...this.#preloadContext]),
									onProgress: (index, translation) => {
										const entry = current[index];
										if (
											!entry ||
											entry.generation !== this.#generation ||
											controller.signal.aborted
										) return;
										this.#settledTranslations.set(
											entry.text,
											translation,
										);
										for (const node of entry.nodes) {
											this.#attachTranslation(
												node,
												entry.text,
												translation,
											);
										}
									},
								},
							);
							break;
						} catch (error) {
							const waitMs = retryDelayMs(error, retryIndex, priority);
							if (waitMs === null || controller.signal.aborted) throw error;
							await this.#delay(waitMs, controller.signal);
							if (!this.#active || this.#destroyed) return;
						}
					}
					if (translations.length !== current.length) {
						throw new Error('翻译 adapter 返回数量不匹配');
					}
					if (
						!this.#active ||
						this.#destroyed ||
						generation !== this.#generation ||
						controller.signal.aborted
					) return;
					current.forEach((entry, index) => {
						const translation = String(translations[index] ?? '').trim();
						if (!translation) throw new Error('翻译 adapter 返回空译文');
						this.#settledTranslations.set(entry.text, translation);
						const queued = this.#queue.get(entry.text);
						if (queued) {
							queued.nodes.forEach((node) => entry.nodes.add(node));
							this.#queue.delete(entry.text);
						}
						for (const node of entry.nodes) {
							this.#attachTranslation(node, entry.text, translation);
						}
					});
					this.#emit();
				} catch (error) {
					this.#resetLoading(current);
					if (
						this.#active &&
						!this.#destroyed &&
						generation === this.#generation
					) this.#requeue(current);
					if (!controller.signal.aborted) {
						failure = error;
						controller.abort(error);
					}
					return;
				} finally {
					for (const entry of current) {
						if (this.#inFlight.get(entry.text) === entry) {
							this.#inFlight.delete(entry.text);
						}
					}
				}
			}
		};
		try {
			const visibleQueued = [...this.#queue.values()].some((entry) =>
				entry.priority === 'visible');
			if (this.#startupDelayMs && !visibleQueued) {
				await this.#delay(this.#startupDelayMs, controller.signal);
			}
			const workers = new Set<Promise<void>>();
			const spawnWorker = (visibleOnly = false): void => {
				let operation: Promise<void>;
				operation = worker(visibleOnly).finally(() => workers.delete(operation));
				workers.add(operation);
			};
			this.#startUrgentWorker = () => {
				if (
					controller.signal.aborted ||
					workers.size >= TRANSLATION_MAX_WORKERS ||
					![...this.#queue.values()].some((entry) =>
						entry.priority === 'visible')
				) return;
				spawnWorker(true);
			};
			for (let index = 0; index < TRANSLATION_PRELOAD_WORKERS; index += 1) {
				spawnWorker();
			}
			while (workers.size) await Promise.race([...workers]);
		} catch (error) {
			if (!controller.signal.aborted) failure = error;
		} finally {
			this.#startUrgentWorker = null;
			if (
				failure &&
				this.#active &&
				!this.#destroyed &&
				generation === this.#generation
			) {
				this.#notify(
					`${failure instanceof Error && failure.message
						? failure.message
						: '翻译失败'}；自动重试后仍未成功，已保留原文`,
				);
				this.#onError(failure);
			}
			if (this.#requestController === controller) {
				this.#requestController = null;
			}
			this.#draining = false;
			this.#emit();
		}
	}

	#attachTranslation(
		node: Element,
		source: string,
		translation: string,
	): void {
		if (translationSourceText(node) !== source) return;
		this.#settledTranslations.set(source, translation);
		const output = this.#translationOutput(node);
		const attached = this.#attachedTranslations.get(node);
		if (
			attached?.output === output &&
			attached.source === source &&
			attached.translation === translation &&
			output.textContent?.trim()
		) return;
		const rendered = renderTranslationText(node, translation);
		if (!rendered) throw new Error('译文未完整保留 @、链接或代码占位符');
		node.classList.add('ldp-translation-source');
		node.classList.remove('ldp-translation-loading');
		output.lang = 'zh-CN';
		output.removeAttribute('aria-busy');
		output.removeAttribute('aria-label');
		this.#clearTranslationAnimation(output);
		output.replaceChildren(rendered);
		this.#attachedTranslations.set(node, { output, source, translation });
		const sectionKey = translationSectionAnimationKey(node, source);
		if (this.#settledAnimationSections.has(sectionKey)) return;
		if (this.#animation === 'none') {
			this.#settledAnimationSections.add(sectionKey);
			return;
		}
		const details = collapsedTranslationDetails(node);
		if (details) {
			this.#deferTranslationAnimation(details, node, output, source, sectionKey);
			return;
		}
		if (!this.#isSectionVisible(node)) {
			this.#settledAnimationSections.add(sectionKey);
			return;
		}
		this.#playTranslationAnimation(output, sectionKey);
	}

	#deferTranslationAnimation(
		details: HTMLDetailsElement,
		node: Element,
		output: HTMLElement,
		source: string,
		sectionKey: string,
	): void {
		const cleanup = (): void => {
			details.removeEventListener('toggle', onToggle);
			if (this.#animationCleanups.get(output) === cleanup) {
				this.#animationCleanups.delete(output);
			}
		};
		const onToggle = (): void => {
			if (!details.hasAttribute('open')) return;
			this.#clearTranslationAnimation(output);
			if (
				!output.isConnected ||
				translationSourceText(node) !== source ||
				this.#settledAnimationSections.has(sectionKey)
			) return;
			if (!this.#isSectionVisible(node)) {
				this.#settledAnimationSections.add(sectionKey);
				return;
			}
			this.#playTranslationAnimation(output, sectionKey);
		};
		details.addEventListener('toggle', onToggle);
		this.#animationCleanups.set(output, cleanup);
	}

	#playTranslationAnimation(output: HTMLElement, sectionKey: string): void {
		this.#settledAnimationSections.add(sectionKey);
		this.#prepareTranslationAnimation(output);
		void output.getBoundingClientRect();
		output.classList.add('ldp-translation-enter');
	}

	#prepareTranslationAnimation(output: HTMLElement): void {
		if (
			!SEGMENTED_TRANSLATION_ANIMATIONS.has(this.#animation) ||
			output.ownerDocument.defaultView?.matchMedia?.(
				'(prefers-reduced-motion: reduce)',
			).matches === true
		) return;
		const segments = segmentTranslationOutput(output);
		if (!segments.length) return;
		output.classList.add('ldp-translation-segmented');
		const onAnimationEnd = (event: Event): void => {
			const target = event.target;
			const ElementConstructor = output.ownerDocument.defaultView?.Element;
			if (
				ElementConstructor &&
				target instanceof ElementConstructor &&
				target.classList.contains('ldp-translation-segment-last')
			) cleanup();
		};
		const cleanup = (): void => {
			output.removeEventListener('animationend', onAnimationEnd);
			for (const segment of output.querySelectorAll<HTMLElement>(
				'.ldp-translation-segment',
			)) {
				segment.replaceWith(output.ownerDocument.createTextNode(
					segment.textContent ?? '',
				));
			}
			output.normalize();
			output.classList.remove(
				'ldp-translation-enter',
				'ldp-translation-segmented',
			);
			if (this.#animationCleanups.get(output) === cleanup) {
				this.#animationCleanups.delete(output);
			}
		};
		output.addEventListener('animationend', onAnimationEnd);
		this.#animationCleanups.set(output, cleanup);
	}

	#clearTranslationAnimation(output: HTMLElement): void {
		this.#animationCleanups.get(output)?.();
		output.classList.remove(
			'ldp-translation-enter',
			'ldp-translation-segmented',
		);
	}

	#translationOutput(node: Element): HTMLElement {
		const document = node.ownerDocument;
		let original = node.querySelector<HTMLElement>(
			':scope > .ldp-translation-original',
		);
		let output = node.querySelector<HTMLElement>(
			':scope > .ldp-translation-text',
		);
		if (!original) {
			original = document.createElement('span');
			original.className = 'ldp-translation-original';
			while (node.firstChild) original.append(node.firstChild);
			node.append(original);
		}
		if (!output) {
			output = document.createElement('span');
			output.className = 'ldp-translation-text';
			node.append(output);
		}
		return output;
	}

	#markLoading(node: Element): void {
		if (node.classList.contains('ldp-translation-loading')) return;
		const output = this.#translationOutput(node);
		const indicator = node.ownerDocument.createElement('span');
		indicator.className = 'ldp-translation-loading-indicator';
		indicator.setAttribute('aria-hidden', 'true');
		indicator.append(...[0, 1, 2].map(() => {
			const dot = node.ownerDocument.createElement('i');
			return dot;
		}));
		node.classList.add('ldp-translation-source', 'ldp-translation-loading');
		output.lang = 'zh-CN';
		output.setAttribute('aria-busy', 'true');
		output.setAttribute('aria-label', '正在翻译');
		output.replaceChildren(indicator);
	}

	#resetLoading(entries: readonly TranslationQueueEntry[]): void {
		for (const entry of entries) {
			for (const node of entry.nodes) {
				if (!node.classList.contains('ldp-translation-loading')) continue;
				node.classList.remove('ldp-translation-loading');
				const output = node.querySelector<HTMLElement>(
					':scope > .ldp-translation-text',
				);
				output?.removeAttribute('aria-busy');
				output?.removeAttribute('aria-label');
				output?.replaceChildren();
			}
		}
	}

	#clearLoadingTranslations(): void {
		for (const surface of this.#translationSurfaces()) {
			for (const node of surface.querySelectorAll<HTMLElement>(
				'.ldp-translation-loading',
			)) {
				this.#resetLoading([{
					text: '',
					nodes: new Set([node]),
					generation: this.#generation,
					priority: 'visible',
				}]);
			}
		}
	}
}
