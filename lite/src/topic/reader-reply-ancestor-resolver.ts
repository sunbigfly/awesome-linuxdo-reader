import {
	discoursePostNumber,
	discoursePostReference,
	type DiscoursePostNumber,
} from '../discourse/identifiers.js';
import type { DiscourseTopicPostInput } from './topic-session.js';

export interface ReaderReplyAncestorSession<TPost> {
	postByNumber(postNumber: number): TPost | undefined;
	loadTarget(
		postNumber: number,
		options?: Readonly<{
			readonly scope?: 'single' | 'around';
			readonly forceRefresh?: boolean;
			readonly advanceCursor?: boolean;
		}>,
	): Promise<readonly TPost[]>;
}

export interface ReaderReplyAncestorResolution {
	readonly rootPostNumber: DiscoursePostNumber;
	readonly complete: boolean;
	readonly loadedPostNumbers: readonly DiscoursePostNumber[];
}

export interface ReaderReplyAncestorResolveOptions {
	readonly stopBeforePostNumber?: number;
	readonly isActive?: () => boolean;
	readonly maxDepth?: number;
}

/**
 * 使用 TopicSession 的原生单楼层能力补齐目标到根的 canonical 祖先链。
 *
 * resolver 不缓存帖子、不提交树、不管理 single-flight；`loadTarget` 的既有仓储、调度、
 * 429 与缓存契约仍是唯一 owner。它只防止“目标已到、父楼未到”被误判成独立根楼层。
 */
export async function resolveReaderReplyAncestors<
	TPost extends DiscourseTopicPostInput,
>(
	session: ReaderReplyAncestorSession<TPost>,
	targetPostNumberValue: number,
	options: ReaderReplyAncestorResolveOptions = {},
): Promise<ReaderReplyAncestorResolution> {
	const targetPostNumber = discoursePostNumber(targetPostNumberValue);
	const stopBeforePostNumber = options.stopBeforePostNumber === undefined
		? null
		: discoursePostNumber(options.stopBeforePostNumber);
	const maxDepth = Math.max(1, Math.floor(options.maxDepth ?? 128));
	const isActive = options.isActive ?? (() => true);
	const seen = new Set<DiscoursePostNumber>();
	const loadedPostNumbers: DiscoursePostNumber[] = [];
	let current = targetPostNumber;
	for (let depth = 0; depth < maxDepth; depth += 1) {
		if (!isActive()) {
			return Object.freeze({
				rootPostNumber: current,
				complete: false,
				loadedPostNumbers: Object.freeze(loadedPostNumbers),
			});
		}
		if (seen.has(current)) {
			throw new Error(`楼层祖先链存在环，经过 #${current}`);
		}
		seen.add(current);
		let post = session.postByNumber(current);
		if (!post) {
			await session.loadTarget(current, {
				scope: 'single',
				advanceCursor: false,
			});
			if (!isActive()) continue;
			post = session.postByNumber(current);
			if (!post) {
				return Object.freeze({
					rootPostNumber: current,
					complete: false,
					loadedPostNumbers: Object.freeze(loadedPostNumbers),
				});
			}
			loadedPostNumbers.push(current);
		}
		const parent = discoursePostReference(post).replyToPostNumber;
		if (parent === null || parent === stopBeforePostNumber) {
			return Object.freeze({
				rootPostNumber: current,
				complete: true,
				loadedPostNumbers: Object.freeze(loadedPostNumbers),
			});
		}
		current = discoursePostNumber(parent);
	}
	return Object.freeze({
		rootPostNumber: current,
		complete: false,
		loadedPostNumbers: Object.freeze(loadedPostNumbers),
	});
}
