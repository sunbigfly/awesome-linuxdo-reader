import {
	discoursePostId,
	discoursePostIds,
	discoursePostNumber,
	discoursePostNumbers,
	discourseReplyCursor,
	discourseTopicId,
	type DiscoursePostId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from './identifiers.js';

const nativeReadDescriptorBrand: unique symbol = Symbol('DiscourseNativeReadDescriptor');
const nativeMutationDescriptorBrand: unique symbol = Symbol('DiscourseNativeMutationDescriptor');
const nativeReadDescriptors = new WeakSet<object>();
const nativeMutationDescriptors = new WeakSet<object>();

/** Discourse `/posts/:id/replies.json` 的固定单页上限。 */
export const DISCOURSE_DIRECT_REPLIES_PAGE_SIZE = 20;

export type DiscourseNativeReadOperation =
	| 'topic'
	| 'posts-by-id'
	| 'post-by-id'
	| 'target-post'
	| 'direct-replies'
	| 'post-voting-comments'
	| 'boost-report-access'
	| 'endorsable-categories'
	| 'user-follow-list'
	| 'user-summary'
	| 'user-badges'
	| 'user-directory-stats';

export type DiscourseNativeTargetEndpoint =
	| 'post-by-number'
	| 'topic-floor'
	| 'topic-query'
	| 'topic-id-query';

/**
 * 只有本文件中的具名 Discourse 请求目录能创建 descriptor。
 *
 * transport 不接受 path/header/cache 的自由组合，防止领域 adapter 重新长出第二套 REST
 * 拼装逻辑。descriptor 仍由宿主 `discourse/lib/ajax#ajax` 执行，不拥有认证或 CSRF。
 */
export interface DiscourseNativeReadDescriptor {
	readonly operation: DiscourseNativeReadOperation;
	readonly path: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly browserCache: RequestCache;
	readonly [nativeReadDescriptorBrand]: true;
}

export interface DiscourseNativeMutationDescriptor {
	readonly operation:
		| 'topic-timings'
		| 'topic-summary'
		| 'topic-summary-image-upload';
	readonly path: string;
	readonly method: 'POST';
	readonly headers: Readonly<Record<string, string>>;
	readonly data: Readonly<Record<string, unknown>> | FormData;
	readonly multipart?: true;
	readonly [nativeMutationDescriptorBrand]: true;
}

export interface DiscourseNativeTargetCandidate {
	readonly endpoint: DiscourseNativeTargetEndpoint;
	readonly url: string;
	readonly descriptor: DiscourseNativeReadDescriptor;
}

/**
 * 单楼层的 canonical by-number 已明确 404/410 后，其余 Topic 路由不会让该楼层恢复。
 * 继续 fallback 只会制造无效请求，并可能把 Cloudflare challenge 误判成普通限流。
 */
export function discourseNativeTargetFailureIsDefinitive(input: Readonly<{
	readonly endpoint: DiscourseNativeTargetEndpoint;
	readonly scope: 'single' | 'around';
	readonly status: number;
}>): boolean {
	return input.scope === 'single' &&
		input.endpoint === 'post-by-number' &&
		(input.status === 404 || input.status === 410);
}

export interface DiscourseNativeTopicReadInput {
	readonly basePath?: string;
	readonly topicId: string | number;
}

export interface DiscourseNativePostsByIdReadInput
	extends DiscourseNativeTopicReadInput {
	readonly postIds: readonly number[];
}

export interface DiscourseNativePostByIdReadInput {
	readonly basePath?: string;
	readonly postId: number;
}

export interface DiscourseNativeTargetCandidatesInput
	extends DiscourseNativeTopicReadInput {
	readonly postNumber: number;
	readonly scope: 'single' | 'around';
	readonly slug?: string;
	readonly refresh?: boolean;
}

export interface DiscourseNativeDirectRepliesReadInput {
	readonly basePath?: string;
	readonly parentPostId: number;
	readonly after?: number;
}

export interface DiscourseNativeBoostReportAccessInput {
	readonly basePath?: string;
	readonly boostId: number;
}

export interface DiscourseNativeEndorsableCategoriesInput {
	readonly basePath?: string;
	readonly username: string;
}

export interface DiscourseNativeUserBadgesInput {
	readonly basePath?: string;
	readonly username: string;
}

export interface DiscourseNativeUserSummaryInput {
	readonly basePath?: string;
	readonly username: string;
}

export interface DiscourseNativeUserFollowListInput {
	readonly basePath?: string;
	readonly username: string;
	readonly kind: 'following' | 'followers';
}

export interface DiscourseNativeUserDirectoryStatsInput {
	readonly basePath?: string;
	readonly username: string;
}

export interface DiscourseNativePostVotingCommentsReadInput {
	readonly basePath?: string;
	readonly postId: number;
	readonly afterCommentId?: number;
}

export interface DiscourseNativeTopicTimingsInput {
	readonly basePath?: string;
	readonly topicId: string | number;
	readonly postNumbers: readonly number[];
	readonly readTimeMs: number;
}

export interface DiscourseNativeTopicSummaryInput {
	readonly basePath?: string;
	readonly topicId: string | number;
}

export interface DiscourseNativeTopicSummaryImageUploadInput {
	readonly basePath?: string;
	readonly formData: FormData;
}

export function discourseBasePath(value: string | undefined): string {
	const normalized = String(value ?? '').trim().replace(/\/+$/, '');
	if (normalized && !normalized.startsWith('/') && !/^https?:\/\//i.test(normalized)) {
		throw new Error('basePath 必须是绝对 URL 或以 / 开头的路径');
	}
	return normalized;
}

function encodedSlug(value: string | undefined): string {
	const slug = String(value ?? 'topic').trim();
	if (!slug) throw new Error('slug 不能为空');
	return encodeURIComponent(slug);
}

function readDescriptor(
	operation: DiscourseNativeReadOperation,
	path: string,
	options: {
		readonly headers?: Readonly<Record<string, string>>;
		readonly browserCache?: RequestCache;
	} = {},
): DiscourseNativeReadDescriptor {
	const descriptor: DiscourseNativeReadDescriptor = Object.freeze({
		operation,
		path,
		headers: Object.freeze({ ...(options.headers ?? {}) }),
		browserCache: options.browserCache ?? 'default',
		[nativeReadDescriptorBrand]: true as const,
	});
	nativeReadDescriptors.add(descriptor);
	return descriptor;
}

export function assertDiscourseNativeReadDescriptor(
	value: unknown,
): asserts value is DiscourseNativeReadDescriptor {
	if (
		value === null ||
		typeof value !== 'object' ||
		!nativeReadDescriptors.has(value)
	) {
		throw new Error('读取请求必须来自 Discourse 原生请求目录');
	}
}

export function assertDiscourseNativeMutationDescriptor(
	value: unknown,
): asserts value is DiscourseNativeMutationDescriptor {
	if (
		value === null ||
		typeof value !== 'object' ||
		!nativeMutationDescriptors.has(value)
	) {
		throw new Error('写请求必须来自 Discourse 原生请求目录');
	}
}

function targetDescriptor(
	endpoint: DiscourseNativeTargetEndpoint,
	url: string,
	refresh: boolean,
): DiscourseNativeTargetCandidate {
	return Object.freeze({
		endpoint,
		url,
		descriptor: readDescriptor('target-post', url, {
			headers: { Accept: 'application/json' },
			browserCache: refresh ? 'no-store' : 'default',
		}),
	});
}

export const DiscourseNativeRequests = Object.freeze({
	topic(input: DiscourseNativeTopicReadInput): DiscourseNativeReadDescriptor {
		const topicId = discourseTopicId(input.topicId);
	const basePath = discourseBasePath(input.basePath);
		return readDescriptor(
			'topic',
			`${basePath}/t/${topicId}.json?track_visit=true&forceLoad=true`,
			{
				headers: {
					Accept: 'application/json',
					'Discourse-Track-View': 'true',
					'Discourse-Track-View-Topic-Id': String(topicId),
				},
			},
		);
	},

	postsById(input: DiscourseNativePostsByIdReadInput): DiscourseNativeReadDescriptor {
		const topicId = discourseTopicId(input.topicId);
		const postIds = discoursePostIds(input.postIds);
		const query = postIds
			.map((postId) => `post_ids[]=${encodeURIComponent(postId)}`)
			.join('&');
		return readDescriptor(
			'posts-by-id',
			`${discourseBasePath(input.basePath)}/t/${topicId}/posts.json?${query}`,
			{ headers: { Accept: 'application/json' } },
		);
	},

	postById(input: DiscourseNativePostByIdReadInput): DiscourseNativeReadDescriptor {
		const postId = discoursePostId(input.postId);
		return readDescriptor(
			'post-by-id',
			`${discourseBasePath(input.basePath)}/posts/${postId}.json`,
			{
				headers: { Accept: 'application/json' },
				browserCache: 'no-store',
			},
		);
	},

	targetCandidates(
		input: DiscourseNativeTargetCandidatesInput,
	): readonly DiscourseNativeTargetCandidate[] {
		const topicId = discourseTopicId(input.topicId);
		const postNumber = discoursePostNumber(input.postNumber);
		const basePath = discourseBasePath(input.basePath);
		const slug = encodedSlug(input.slug);
		const refresh = input.refresh === true;
		const paths: Readonly<Record<DiscourseNativeTargetEndpoint, string>> = Object.freeze({
			'post-by-number': `${basePath}/posts/by_number/${topicId}/${postNumber}.json`,
			'topic-floor': `${basePath}/t/${slug}/${topicId}/${postNumber}.json`,
			'topic-query': `${basePath}/t/${slug}/${topicId}.json?post_number=${postNumber}`,
			'topic-id-query': `${basePath}/t/${topicId}.json?post_number=${postNumber}`,
		});
		const order: readonly DiscourseNativeTargetEndpoint[] = input.scope === 'around'
			? ['topic-floor', 'topic-query', 'topic-id-query', 'post-by-number']
			: ['post-by-number', 'topic-floor', 'topic-id-query'];
		return Object.freeze(order.map((endpoint) =>
			targetDescriptor(endpoint, paths[endpoint], refresh)));
	},

	directReplies(
		input: DiscourseNativeDirectRepliesReadInput,
	): DiscourseNativeReadDescriptor {
		const parentPostId = discoursePostId(input.parentPostId);
		const after = discourseReplyCursor(input.after);
		const suffix = after > 0 ? `?after=${after}` : '';
		return readDescriptor(
			'direct-replies',
			`${discourseBasePath(input.basePath)}/posts/${parentPostId}/replies.json${suffix}`,
			{
				headers: { Accept: 'application/json' },
				browserCache: 'no-store',
			},
		);
	},

	postVotingComments(
		input: DiscourseNativePostVotingCommentsReadInput,
	): DiscourseNativeReadDescriptor {
		const postId = discoursePostId(input.postId);
		const afterCommentId = Number(input.afterCommentId ?? 0);
		if (
			!Number.isSafeInteger(afterCommentId) ||
			afterCommentId < 0
		) {
			throw new RangeError('afterCommentId 必须是非负安全整数');
		}
		const query = new URLSearchParams({ post_id: String(postId) });
		if (afterCommentId > 0) {
			query.set('last_comment_id', String(afterCommentId));
		}
		return readDescriptor(
			'post-voting-comments',
			`${discourseBasePath(input.basePath)}/post_voting/comments?${query}`,
			{
				headers: { Accept: 'application/json' },
				browserCache: 'no-store',
			},
		);
	},

	boostReportAccess(
		input: DiscourseNativeBoostReportAccessInput,
	): DiscourseNativeReadDescriptor {
		const boostId = Number(input.boostId);
		if (!Number.isSafeInteger(boostId) || boostId <= 0) {
			throw new RangeError('boostId 必须是正安全整数');
		}
		return readDescriptor(
			'boost-report-access',
			`${discourseBasePath(input.basePath)}/discourse-boosts/boosts/${boostId}.json`,
			{
				headers: { Accept: 'application/json' },
				browserCache: 'no-store',
			},
		);
	},

	endorsableCategories(
		input: DiscourseNativeEndorsableCategoriesInput,
	): DiscourseNativeReadDescriptor {
		const username = String(input.username).trim().replace(/^@+/, '');
		if (!username) throw new Error('username 不能为空');
		return readDescriptor(
			'endorsable-categories',
			`${discourseBasePath(input.basePath)}/category-experts/endorsable-categories/${encodeURIComponent(username)}.json`,
			{ headers: { Accept: 'application/json' } },
		);
	},

	userFollowList(
		input: DiscourseNativeUserFollowListInput,
	): DiscourseNativeReadDescriptor {
		const username = String(input.username).trim().replace(/^@+/, '');
		if (!username) throw new Error('username 不能为空');
		if (input.kind !== 'following' && input.kind !== 'followers') {
			throw new Error('关注列表类型无效');
		}
		return readDescriptor(
			'user-follow-list',
			`${discourseBasePath(input.basePath)}/u/${
				encodeURIComponent(username)
			}/follow/${input.kind}`,
			{ headers: { Accept: 'application/json' } },
		);
	},

	userBadges(
		input: DiscourseNativeUserBadgesInput,
	): DiscourseNativeReadDescriptor {
		const username = String(input.username).trim().replace(/^@+/, '');
		if (!username) throw new Error('username 不能为空');
		return readDescriptor(
			'user-badges',
			`${discourseBasePath(input.basePath)}/user-badges/${encodeURIComponent(username)}.json`,
			{ headers: { Accept: 'application/json' } },
		);
	},

	userSummary(
		input: DiscourseNativeUserSummaryInput,
	): DiscourseNativeReadDescriptor {
		const username = String(input.username).trim().replace(/^@+/, '');
		if (!username) throw new Error('username 不能为空');
		return readDescriptor(
			'user-summary',
			`${discourseBasePath(input.basePath)}/u/${
				encodeURIComponent(username)
			}/summary.json`,
			{ headers: { Accept: 'application/json' } },
		);
	},

	userDirectoryStats(
		input: DiscourseNativeUserDirectoryStatsInput,
	): DiscourseNativeReadDescriptor {
		const username = String(input.username).trim().replace(/^@+/, '');
		if (!username) throw new Error('username 不能为空');
		const query = new URLSearchParams({
			period: 'all',
			order: 'likes_received',
			username,
		});
		return readDescriptor(
			'user-directory-stats',
			`${discourseBasePath(input.basePath)}/directory_items.json?${query}`,
			{ headers: { Accept: 'application/json' } },
		);
	},

	topicTimings(
		input: DiscourseNativeTopicTimingsInput,
	): DiscourseNativeMutationDescriptor {
		const topicId: DiscourseTopicId = discourseTopicId(input.topicId);
		const postNumbers = discoursePostNumbers(input.postNumbers);
		const readTimeMs = Number(input.readTimeMs);
		if (!Number.isSafeInteger(readTimeMs) || readTimeMs < 1 || readTimeMs > 60_000) {
			throw new RangeError('readTimeMs 必须是 1..60000 的安全整数');
		}
		const timings = Object.fromEntries(postNumbers.map((postNumber) => [
			String(postNumber),
			readTimeMs,
		]));
		const data: Readonly<Record<string, unknown>> = Object.freeze({
			topic_id: topicId,
			topic_time: readTimeMs * postNumbers.length,
			timings: Object.freeze(timings),
		});
		const descriptor: DiscourseNativeMutationDescriptor = Object.freeze({
			operation: 'topic-timings' as const,
			path: `${discourseBasePath(input.basePath)}/topics/timings`,
			method: 'POST' as const,
			headers: Object.freeze({
				'Discourse-Background': 'true',
				'X-SILENCE-LOGGER': 'true',
			}),
			data,
			[nativeMutationDescriptorBrand]: true as const,
		});
		nativeMutationDescriptors.add(descriptor);
		return descriptor;
	},

	topicSummary(
		input: DiscourseNativeTopicSummaryInput,
	): DiscourseNativeMutationDescriptor {
		const topicId: DiscourseTopicId = discourseTopicId(input.topicId);
		const descriptor: DiscourseNativeMutationDescriptor = Object.freeze({
			operation: 'topic-summary' as const,
			path:
				`${discourseBasePath(input.basePath)}` +
				`/discourse-ai/summarization/t/${topicId}`,
			method: 'POST' as const,
			headers: Object.freeze({ Accept: 'application/json' }),
			data: Object.freeze({}),
			[nativeMutationDescriptorBrand]: true as const,
		});
		nativeMutationDescriptors.add(descriptor);
		return descriptor;
	},

	topicSummaryImageUpload(
		input: DiscourseNativeTopicSummaryImageUploadInput,
	): DiscourseNativeMutationDescriptor {
		const descriptor: DiscourseNativeMutationDescriptor = Object.freeze({
			operation: 'topic-summary-image-upload' as const,
			path: `${discourseBasePath(input.basePath)}/uploads.json`,
			method: 'POST' as const,
			headers: Object.freeze({ Accept: 'application/json' }),
			data: input.formData,
			multipart: true as const,
			[nativeMutationDescriptorBrand]: true as const,
		});
		nativeMutationDescriptors.add(descriptor);
		return descriptor;
	},
});

export type {
	DiscoursePostId,
	DiscoursePostNumber,
	DiscourseTopicId,
};
