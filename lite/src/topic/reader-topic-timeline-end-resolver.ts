import {
	discoursePostReference,
	tryDiscoursePostNumber,
	type DiscoursePostIdentityFields,
	type DiscoursePostNumber,
} from '../discourse/identifiers.js';

export interface ReaderTopicTimelineEndResolverPort<
	TPost extends DiscoursePostIdentityFields,
> {
	readonly readTotalPostCount: () => unknown;
	readonly readCachedPosts?: () => readonly TPost[];
	loadAround(postNumber: number): Promise<readonly TPost[]>;
	loadBefore(postNumber: number): Promise<readonly TPost[]>;
}

function latestRootInContiguousTail<TPost extends DiscoursePostIdentityFields>(
	posts: readonly TPost[],
	total: DiscoursePostNumber,
): DiscoursePostNumber | null {
	const references = posts.flatMap((post) => {
		try {
			return [discoursePostReference(post)];
		} catch {
			return [];
		}
	}).filter(({ postNumber }) => postNumber <= total)
		.sort((left, right) => right.postNumber - left.postNumber);
	let expected = Number(total);
	for (const reference of references) {
		if (reference.postNumber !== expected) return null;
		if (reference.replyToPostNumber === null) return reference.postNumber;
		expected -= 1;
	}
	return null;
}

/**
 * 从 canonical 尾部向前补流，直到找到最后一个主信息流正文根。
 *
 * `reply_to_post_number === null` 是 canonical 正文根；非 null 就是树状嵌套。
 * 一批尾部数据可能全是指向早期正文的楼中楼，因此不能把尾楼映射到它自己的祖先；
 * 那会从 Topic 末尾倒退到很早的正文。尾段没有正文根时继续按 post_stream 向前补批。
 */
export async function resolveReaderTopicTimelineEndPostNumber<
	TPost extends DiscoursePostIdentityFields,
>(
	port: ReaderTopicTimelineEndResolverPort<TPost>,
): Promise<DiscoursePostNumber | null> {
	const total = tryDiscoursePostNumber(port.readTotalPostCount());
	if (total === null) return null;
	const cachedRoot = latestRootInContiguousTail(
		port.readCachedPosts?.() ?? Object.freeze([]),
		total,
	);
	if (cachedRoot !== null) return cachedRoot;
	let boundary = total;
	let firstBatch = true;
	for (;;) {
		const posts = firstBatch
			? await port.loadAround(boundary)
			: await port.loadBefore(boundary);
		const references = posts.flatMap((post) => {
			try {
				return [discoursePostReference(post)];
			} catch {
				return [];
			}
		});
		if (!references.length) return null;
		const earliest = Math.min(...references.map(({ postNumber }) => postNumber));
		const latestRoot = references
			.filter(({ postNumber, replyToPostNumber }) =>
				postNumber <= boundary && replyToPostNumber === null
			)
			.sort((left, right) => right.postNumber - left.postNumber)
			.at(0)?.postNumber;
		if (latestRoot !== undefined) return latestRoot;
		if (!firstBatch && earliest >= boundary) return null;
		if (earliest <= 1) return null;
		boundary = discoursePostReference({
			post_number: earliest,
		}).postNumber;
		firstBatch = false;
	}
}
