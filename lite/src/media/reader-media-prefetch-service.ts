import type {
	PublicResourceRequestAdapter,
} from '../network/public-resource-request-adapter.js';
import { objectRecord as record } from '../kernel/value-record.js';

export interface ReaderMediaPrefetchPostInput {
	readonly cooked?: unknown;
	readonly boosts?: unknown;
	readonly reactions?: unknown;
}

export interface ReaderMediaPrefetchProgress {
	readonly loadedCount: number;
	readonly totalCount: number;
	readonly failedCount: number;
	readonly complete: boolean;
}

export interface ReaderMediaPrefetchInput<
	TPost extends ReaderMediaPrefetchPostInput,
> {
	readonly posts: readonly TPost[];
	readonly signal: AbortSignal;
	readonly reactionSources?: (post: TPost) => readonly string[];
	readonly waitUntilIdle?: (signal: AbortSignal) => Promise<void>;
	readonly onProgress?: (progress: ReaderMediaPrefetchProgress) => void;
}

export interface ReaderMediaPrefetchServiceOptions {
	readonly document: Document;
	readonly baseUrl: string | URL;
	readonly resources: Pick<PublicResourceRequestAdapter, 'load'>;
	readonly concurrency?: number;
}

function positiveInteger(value: number | undefined, fallback: number): number {
	const numeric = Number(value ?? fallback);
	if (!Number.isSafeInteger(numeric) || numeric < 1) {
		throw new RangeError('媒体预取并发数必须是正安全整数');
	}
	return numeric;
}

function cookedFragments(post: ReaderMediaPrefetchPostInput): readonly string[] {
	const fragments = [String(post.cooked ?? '')];
	const boostValues = Array.isArray(post.boosts)
		? post.boosts
		: post.boosts
			? [post.boosts]
			: [];
	for (const value of boostValues) {
		const boost = record(value);
		if (boost?.cooked) fragments.push(String(boost.cooked));
	}
	return Object.freeze(fragments.filter(Boolean));
}

function absoluteHttpSource(value: unknown, baseUrl: string): string {
	const source = String(value ?? '').trim();
	if (!source) return '';
	try {
		const url = new URL(source, baseUrl);
		url.hash = '';
		return url.protocol === 'http:' || url.protocol === 'https:'
			? url.href
			: '';
	} catch {
		return '';
	}
}

/**
 * 阅读队列媒体“食材”预加工的唯一 owner。
 *
 * 它只从 canonical post/Boost cooked 和宿主回应目录派生 URL；实际 Blob 的 single-flight、
 * scheduler 与持久缓存仍完全属于 PublicResourceRequestAdapter/DomainRequestGateway。
 */
export class ReaderMediaPrefetchService {
	readonly #document: Document;
	readonly #baseUrl: string;
	readonly #resources: Pick<PublicResourceRequestAdapter, 'load'>;
	readonly #concurrency: number;

	constructor(options: ReaderMediaPrefetchServiceOptions) {
		this.#document = options.document;
		this.#baseUrl = new URL(options.baseUrl).href;
		this.#resources = options.resources;
		this.#concurrency = positiveInteger(options.concurrency, 2);
	}

	sources<TPost extends ReaderMediaPrefetchPostInput>(
		posts: readonly TPost[],
		reactionSources?: (post: TPost) => readonly string[],
	): readonly string[] {
		const sources = new Set<string>();
		const add = (value: unknown): void => {
			const source = absoluteHttpSource(value, this.#baseUrl);
			if (source) sources.add(source);
		};
		for (const post of posts) {
			for (const cooked of cookedFragments(post)) {
				const template = this.#document.createElement('template');
				template.innerHTML = cooked;
				for (const image of template.content.querySelectorAll('img')) {
					const source = [
						image.getAttribute('src'),
						image.getAttribute('data-src'),
						image.getAttribute('data-large-src'),
					].map((value) => absoluteHttpSource(value, this.#baseUrl))
						.find(Boolean);
					if (source) sources.add(source);
				}
			}
			for (const source of reactionSources?.(post) ?? []) add(source);
		}
		return Object.freeze([...sources]);
	}

	async prefetch<TPost extends ReaderMediaPrefetchPostInput>(
		input: ReaderMediaPrefetchInput<TPost>,
	): Promise<ReaderMediaPrefetchProgress> {
		const sources = this.sources(input.posts, input.reactionSources);
		let cursor = 0;
		let loadedCount = 0;
		let failedCount = 0;
		const progress = (): ReaderMediaPrefetchProgress => Object.freeze({
			loadedCount,
			totalCount: sources.length,
			failedCount,
			complete: loadedCount >= sources.length,
		});
		input.onProgress?.(progress());
		const worker = async (): Promise<void> => {
			while (cursor < sources.length) {
				if (input.signal.aborted) throw input.signal.reason;
				const source = sources[cursor++]!;
				await input.waitUntilIdle?.(input.signal);
				if (input.signal.aborted) throw input.signal.reason;
				try {
					const blob = await this.#resources.load(source, {
						signal: input.signal,
						profile: 'resource-prefetch',
					});
					if (blob.size > 0) loadedCount += 1;
					else failedCount += 1;
				} catch (error) {
					if (input.signal.aborted) throw error;
					failedCount += 1;
				}
				input.onProgress?.(progress());
			}
		};
		await Promise.all(Array.from(
			{ length: Math.min(this.#concurrency, sources.length) },
			worker,
		));
		return progress();
	}
}
