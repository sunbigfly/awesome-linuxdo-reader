import type {
	DiscourseNativeTopicLinkPort,
} from '../discourse/native-host-api.js';
import {
	discoursePostNumber,
	discourseTopicId,
} from '../discourse/identifiers.js';

type UnknownRecord = Readonly<Record<string, unknown>>;

export interface ReaderShareSurfacePort {
	share(input: Readonly<{
		readonly title: string;
		readonly url: string;
	}>): Promise<'shared' | 'unsupported' | 'cancelled'>;
	copyText(text: string): Promise<void>;
}

export interface ReaderShareActionResult {
	readonly target: 'post' | 'topic';
	readonly outcome: 'shared' | 'copied' | 'cancelled';
	readonly url: string;
	readonly postNumber: number | null;
}

export interface ReaderShareActionPort<TPost> {
	sharePost(post: TPost): Promise<ReaderShareActionResult>;
	shareTopic(post: TPost): Promise<ReaderShareActionResult>;
}

export interface ReaderShareActionCoordinatorOptions<TTopic> {
	readonly topicId: number;
	readonly topic: () => TTopic;
	readonly links: DiscourseNativeTopicLinkPort;
	readonly surface: ReaderShareSurfacePort;
	readonly fallbackTitle: () => string;
}

function record(value: unknown): UnknownRecord {
	return value !== null && typeof value === 'object'
		? value as UnknownRecord
		: {};
}

/**
 * 主题分享与精确楼层链接复制的唯一语义协调器。
 *
 * Discourse 原生端口拥有 URL，userscript 浏览器端口拥有 Web Share/Clipboard；本类只
 * 区分 Topic 与 Post 目标、保留 Web Share 取消语义，并对同一目标做 single-flight。
 */
export class ReaderShareActionCoordinator<TTopic, TPost extends UnknownRecord>
implements ReaderShareActionPort<TPost> {
	readonly #topicId: number;
	readonly #topic: () => TTopic;
	readonly #links: DiscourseNativeTopicLinkPort;
	readonly #surface: ReaderShareSurfacePort;
	readonly #fallbackTitle: () => string;
	readonly #flights = new Map<string, Promise<ReaderShareActionResult>>();

	constructor(options: ReaderShareActionCoordinatorOptions<TTopic>) {
		this.#topicId = discourseTopicId(options.topicId);
		this.#topic = options.topic;
		this.#links = options.links;
		this.#surface = options.surface;
		this.#fallbackTitle = options.fallbackTitle;
	}

	sharePost(post: TPost): Promise<ReaderShareActionResult> {
		const postNumber = discoursePostNumber(post.post_number);
		return this.#once(`post:${postNumber}`, async () => {
			const url = this.#href(postNumber);
			await this.#surface.copyText(url);
			return Object.freeze({
				target: 'post',
				outcome: 'copied',
				url,
				postNumber,
			});
		});
	}

	shareTopic(_post: TPost): Promise<ReaderShareActionResult> {
		return this.#once('topic', async () => {
			const url = this.#href(0);
			const canonicalTitle = String(
				record(this.#topic()).title ?? '',
			).trim();
			const title = canonicalTitle ||
				String(this.#fallbackTitle()).trim();
			let outcome: Awaited<ReturnType<ReaderShareSurfacePort['share']>>;
			try {
				outcome = await this.#surface.share({ title, url });
			} catch {
				outcome = 'unsupported';
			}
			if (outcome === 'cancelled') {
				return Object.freeze({
					target: 'topic',
					outcome: 'cancelled',
					url,
					postNumber: null,
				});
			}
			if (outcome === 'shared') {
				return Object.freeze({
					target: 'topic',
					outcome: 'shared',
					url,
					postNumber: null,
				});
			}
			await this.#surface.copyText(url);
			return Object.freeze({
				target: 'topic',
				outcome: 'copied',
				url,
				postNumber: null,
			});
		});
	}

	#href(postNumber: number): string {
		const href = this.#links.topicHref(this.#topicId, postNumber);
		if (!href) {
			throw new Error(
				postNumber
					? `无法生成楼层 #${postNumber} 的 Discourse 链接`
					: '无法生成 Discourse 主题链接',
			);
		}
		return href;
	}

	#once(
		key: string,
		run: () => Promise<ReaderShareActionResult>,
	): Promise<ReaderShareActionResult> {
		const active = this.#flights.get(key);
		if (active) return active;
		const flight = run().finally(() => {
			if (this.#flights.get(key) === flight) this.#flights.delete(key);
		});
		this.#flights.set(key, flight);
		return flight;
	}
}
