declare const topicIdBrand: unique symbol;
declare const postIdBrand: unique symbol;
declare const postNumberBrand: unique symbol;
declare const replyCursorBrand: unique symbol;
declare const authScopeBrand: unique symbol;

export type DiscourseTopicId = number & { readonly [topicIdBrand]: true };
export type DiscoursePostId = number & { readonly [postIdBrand]: true };
export type DiscoursePostNumber = number & { readonly [postNumberBrand]: true };
export type DiscourseReplyCursor = number & { readonly [replyCursorBrand]: true };
export type DiscourseAuthScope = string & { readonly [authScopeBrand]: true };

export interface DiscoursePostIdentityFields {
	readonly id?: unknown;
	readonly topic_id?: unknown;
	readonly post_number?: unknown;
	readonly reply_to_post_number?: unknown;
}

export interface DiscoursePostReference {
	readonly postId: DiscoursePostId | null;
	readonly topicId: DiscourseTopicId | null;
	readonly postNumber: DiscoursePostNumber;
	readonly replyToPostNumber: DiscoursePostNumber | null;
}

function positiveInteger(value: unknown, name: string): number {
	const numeric = Number(value);
	if (!Number.isSafeInteger(numeric) || numeric < 1) {
		throw new RangeError(`${name} 必须是正安全整数`);
	}
	return numeric;
}

export function discourseTopicId(value: unknown): DiscourseTopicId {
	return positiveInteger(value, 'topicId') as DiscourseTopicId;
}

export function discoursePostId(value: unknown): DiscoursePostId {
	return positiveInteger(value, 'postId') as DiscoursePostId;
}

export function discoursePostNumber(value: unknown): DiscoursePostNumber {
	return positiveInteger(value, 'postNumber') as DiscoursePostNumber;
}

export function discourseReplyCursor(value: unknown): DiscourseReplyCursor {
	const numeric = Number(value ?? 0);
	if (!Number.isSafeInteger(numeric) || numeric < 0) {
		throw new RangeError('replyCursor 必须是非负安全整数');
	}
	return numeric as DiscourseReplyCursor;
}

export function discourseAuthScope(value: unknown): DiscourseAuthScope {
	const normalized = String(value ?? '').trim();
	if (!normalized) throw new Error('authScope 不能为空');
	return normalized as DiscourseAuthScope;
}

export function tryDiscourseTopicId(value: unknown): DiscourseTopicId | null {
	try {
		return discourseTopicId(value);
	} catch {
		return null;
	}
}

export function tryDiscoursePostId(value: unknown): DiscoursePostId | null {
	try {
		return discoursePostId(value);
	} catch {
		return null;
	}
}

export function tryDiscoursePostNumber(value: unknown): DiscoursePostNumber | null {
	try {
		return discoursePostNumber(value);
	} catch {
		return null;
	}
}

export function discoursePostReference(
	input: DiscoursePostIdentityFields,
): DiscoursePostReference {
	const postNumber = discoursePostNumber(input.post_number);
	const parent = tryDiscoursePostNumber(input.reply_to_post_number);
	if (parent === postNumber) {
		throw new Error(`楼层 #${postNumber} 不能回复自身`);
	}
	return Object.freeze({
		postId: tryDiscoursePostId(input.id),
		topicId: tryDiscourseTopicId(input.topic_id),
		postNumber,
		replyToPostNumber: parent,
	});
}

export function discoursePostIds(values: readonly unknown[]): readonly DiscoursePostId[] {
	const normalized = [...new Set(values.map(discoursePostId))]
		.sort((left, right) => left - right);
	if (!normalized.length) throw new Error('postIds 不能为空');
	return Object.freeze(normalized);
}

export function discoursePostIdStream(
	values: readonly unknown[],
): readonly DiscoursePostId[] {
	const seen = new Set<DiscoursePostId>();
	const stream: DiscoursePostId[] = [];
	for (const value of values) {
		const postId = discoursePostId(value);
		if (seen.has(postId)) continue;
		seen.add(postId);
		stream.push(postId);
	}
	return Object.freeze(stream);
}

export function discoursePostNumbers(
	values: readonly unknown[],
): readonly DiscoursePostNumber[] {
	const normalized = [...new Set(values.map(discoursePostNumber))]
		.sort((left, right) => left - right);
	if (!normalized.length) throw new Error('postNumbers 不能为空');
	return Object.freeze(normalized);
}
