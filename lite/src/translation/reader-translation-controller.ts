import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import { abortableDelay } from '../network/coordinated-request-client.js';
import type { TranslationBatchPort } from './translation-request-adapter.js';
import {
	translationBlockNeedsTranslation,
	translationBlocks,
	translationSourceText,
} from './translation-text.js';

export type ReaderTranslationMode = 'original' | 'bilingual' | 'translation';

export interface ReaderTranslationPostMetadata {
	readonly postType: number;
	readonly username: string;
	readonly actionCode?: string | null;
	readonly hydrated: boolean;
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
	readonly persistMode?: (mode: ReaderTranslationMode) => void;
	readonly readPost?: (
		post: HTMLElement,
	) => ReaderTranslationPostMetadata;
	readonly startupDelayMs?: number;
	readonly delay?: (
		milliseconds: number,
		signal: AbortSignal,
	) => Promise<void>;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
	readonly notify?: (message: string) => void;
}

interface TranslationQueueEntry {
	readonly text: string;
	readonly nodes: Set<Element>;
}

function startupDelay(value: number | undefined): number {
	const normalized = Number(value ?? 120);
	if (!Number.isSafeInteger(normalized) || normalized < 0 || normalized > 10_000) {
		throw new RangeError('翻译 startupDelayMs 必须是 0..10000 的安全整数');
	}
	return normalized;
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
 * 它只提取文本、维护 mode/queue、写入命名 translation span；请求、provider fallback、缓存和
 * 429 由 TranslationBatchPort 背后的中央 gateway 负责。
 */
export class ReaderTranslationController {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderTranslationSnapshot>();
	readonly #translator: TranslationBatchPort;
	readonly #surfaces: () => readonly HTMLElement[];
	readonly #persistMode: ((mode: ReaderTranslationMode) => void) | undefined;
	readonly #readPost: (post: HTMLElement) => ReaderTranslationPostMetadata;
	readonly #delay: (milliseconds: number, signal: AbortSignal) => Promise<void>;
	readonly #startupDelayMs: number;
	readonly #onError: (error: unknown) => void;
	readonly #notify: (message: string) => void;
	readonly #queue = new Map<string, TranslationQueueEntry>();
	readonly #styledSurfaces = new Set<HTMLElement>();
	#mode: ReaderTranslationMode;
	#active: boolean;
	#draining = false;
	#destroyed = false;
	#requestController: AbortController | null = null;
	#drainPromise: Promise<void> | null = null;
	#started = false;

	constructor(options: ReaderTranslationControllerOptions) {
		this.#translator = options.translator;
		this.#surfaces = options.surfaces;
		this.#mode = normalizedMode(options.initialMode);
		this.#active = this.#mode !== 'original';
		this.#persistMode = options.persistMode;
		this.#readPost = options.readPost ?? defaultPostMetadata;
		this.#delay = options.delay ?? abortableDelay;
		this.#startupDelayMs = startupDelay(options.startupDelayMs);
		this.#onError = options.onError ?? (() => {});
		this.#notify = options.notify ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#destroyed = true;
			this.#active = false;
			this.#queue.clear();
			this.#requestController?.abort(
				new DOMException('正文翻译已销毁', 'AbortError'),
			);
			this.#requestController = null;
			for (const surface of this.#styledSurfaces) {
				surface.classList.remove(
					'ldp-translation-active',
					'ldp-translation-only',
				);
			}
			this.#styledSurfaces.clear();
			this.changes.clear();
		});
		this.#applyMode();
	}

	get mode(): ReaderTranslationMode {
		return this.#mode;
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
		} else {
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

	flush(): Promise<void> {
		if (this.#drainPromise) return this.#drainPromise;
		if (this.#destroyed || !this.#active || !this.#queue.size) {
			return Promise.resolve();
		}
		const operation = this.#drain().finally(() => {
			if (this.#drainPromise === operation) this.#drainPromise = null;
		});
		this.#drainPromise = operation;
		return operation;
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
			this.#styledSurfaces.delete(surface);
		}
		for (const surface of surfaces) {
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
		const current = this.#queue.get(text) ?? {
			text,
			nodes: new Set<Element>(),
		};
		current.nodes.add(node);
		this.#queue.set(text, current);
	}

	#nextBatch(): readonly TranslationQueueEntry[] {
		const entries: TranslationQueueEntry[] = [];
		let characters = 0;
		for (const entry of this.#queue.values()) {
			if (
				entries.length &&
				(entries.length >= 20 || characters + entry.text.length > 3_500)
			) {
				break;
			}
			this.#queue.delete(entry.text);
			entries.push(entry);
			characters += entry.text.length;
		}
		return Object.freeze(entries);
	}

	async #drain(): Promise<void> {
		this.#draining = true;
		this.#emit();
		const controller = new AbortController();
		this.#requestController = controller;
		let current: readonly TranslationQueueEntry[] = Object.freeze([]);
		try {
			if (this.#startupDelayMs) {
				await this.#delay(this.#startupDelayMs, controller.signal);
			}
			while (this.#queue.size && this.#active && !this.#destroyed) {
				current = this.#nextBatch();
				const translations = await this.#translator.translate(
					current.map((entry) => entry.text),
					controller.signal,
				);
				if (translations.length !== current.length) {
					throw new Error('翻译 adapter 返回数量不匹配');
				}
				if (
					!this.#active ||
					this.#destroyed ||
					controller.signal.aborted
				) {
					current = Object.freeze([]);
					continue;
				}
				current.forEach((entry, index) => {
					const translation = String(translations[index] ?? '').trim();
					if (!translation) throw new Error('翻译 adapter 返回空译文');
					const queued = this.#queue.get(entry.text);
					if (queued) {
						queued.nodes.forEach((node) => entry.nodes.add(node));
						this.#queue.delete(entry.text);
					}
					for (const node of entry.nodes) {
						this.#attachTranslation(node, entry.text, translation);
					}
				});
				current = Object.freeze([]);
				this.#emit();
			}
		} catch (error) {
			if (!controller.signal.aborted && this.#active && !this.#destroyed) {
				for (const entry of current) {
					const queued = this.#queue.get(entry.text) ?? entry;
					entry.nodes.forEach((node) => queued.nodes.add(node));
					this.#queue.set(entry.text, queued);
				}
				this.#notify(
					`${error instanceof Error && error.message
						? error.message
						: '翻译失败'}，请稍后重试`,
				);
				this.#onError(error);
			}
		} finally {
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
		node.classList.add('ldp-translation-source');
		output.lang = 'zh-CN';
		output.textContent = translation;
	}
}
