import {
	discourseAuthScope,
	discoursePostId,
	discoursePostIds,
	discoursePostNumber,
	discoursePostNumbers,
	discourseReplyCursor,
	discourseTopicId,
} from '../discourse/identifiers.js';
import type { RequestIdentityValue } from './request-contract.js';

export type RequestIdentity = Readonly<Record<string, RequestIdentityValue>>;

function token(value: string | number, name: string): string {
	const normalized = String(value).trim();
	if (!normalized) throw new Error(`${name} 不能为空`);
	return normalized;
}

function nonNegative(value: string | number, name: string): number {
	const numeric = Number(value);
	if (!Number.isSafeInteger(numeric) || numeric < 0) {
		throw new RangeError(`${name} 必须是非负安全整数`);
	}
	return numeric;
}

export function topicRequestIdentity(input: {
	readonly authScope: string;
	readonly topicId: string | number;
	readonly operation: string;
	readonly postId?: number;
	readonly postNumber?: number;
	readonly cursor?: number;
}): RequestIdentity {
	const identity: Record<string, RequestIdentityValue> = {
		authScope: discourseAuthScope(input.authScope),
		topicId: discourseTopicId(input.topicId),
		operation: token(input.operation, 'operation'),
	};
	if (input.postId !== undefined) identity.postId = discoursePostId(input.postId);
	if (input.postNumber !== undefined) {
		identity.postNumber = discoursePostNumber(input.postNumber);
	}
	if (input.cursor !== undefined) identity.cursor = discourseReplyCursor(input.cursor);
	return Object.freeze(identity);
}

export function topicPostsRequestIdentity(input: {
	readonly authScope: string;
	readonly topicId: string | number;
	readonly postIds: readonly number[];
}): RequestIdentity {
	return Object.freeze({
		authScope: discourseAuthScope(input.authScope),
		topicId: discourseTopicId(input.topicId),
		postIds: discoursePostIds(input.postIds).join(','),
	});
}

export function nestedRequestIdentity(input: {
	readonly authScope: string;
	readonly topicId: string | number;
	readonly parentPostNumber: number;
	readonly parentPostId?: number;
	readonly after?: number;
}): RequestIdentity {
	const identity: Record<string, RequestIdentityValue> = {
		authScope: discourseAuthScope(input.authScope),
		topicId: discourseTopicId(input.topicId),
		parentPostNumber: discoursePostNumber(input.parentPostNumber),
		after: discourseReplyCursor(input.after),
	};
	if (input.parentPostId !== undefined) {
		identity.parentPostId = discoursePostId(input.parentPostId);
	}
	return Object.freeze(identity);
}

export function notificationRequestIdentity(input: {
	readonly authScope: string;
	readonly group: string;
	readonly page: number;
	readonly variant?: string;
}): RequestIdentity {
	const identity: Record<string, RequestIdentityValue> = {
		authScope: discourseAuthScope(input.authScope),
		group: token(input.group, 'group'),
		page: nonNegative(input.page, 'page'),
	};
	if (input.variant !== undefined) {
		identity.variant = token(input.variant, 'variant');
	}
	return Object.freeze(identity);
}

export function collectionRequestIdentity(input: {
	readonly authScope: string;
	readonly collection: string;
	readonly page: number;
	readonly cursor?: string | number;
	readonly variant?: string;
}): RequestIdentity {
	const identity: Record<string, RequestIdentityValue> = {
		authScope: discourseAuthScope(input.authScope),
		collection: token(input.collection, 'collection'),
		page: nonNegative(input.page, 'page'),
	};
	if (input.cursor !== undefined) {
		identity.cursor = token(input.cursor, 'cursor');
	}
	if (input.variant !== undefined) {
		identity.variant = token(input.variant, 'variant');
	}
	return Object.freeze(identity);
}

export function userRequestIdentity(input: {
	readonly authScope: string;
	readonly username: string;
	readonly resource: string;
	readonly page?: number;
}): RequestIdentity {
	const identity: Record<string, RequestIdentityValue> = {
		authScope: discourseAuthScope(input.authScope),
		username: token(input.username, 'username').replace(/^@/, '').toLocaleLowerCase(),
		resource: token(input.resource, 'resource'),
	};
	if (input.page !== undefined) identity.page = nonNegative(input.page, 'page');
	return Object.freeze(identity);
}

export function resourceRequestIdentity(input: {
	readonly resourceId: string;
	readonly variant: string;
}): RequestIdentity {
	return Object.freeze({
		resourceId: token(input.resourceId, 'resourceId'),
		variant: token(input.variant, 'variant'),
	});
}

export function translationRequestIdentity(input: {
	readonly provider: string;
	readonly textFingerprint: string;
	readonly sourceLanguage: string;
	readonly targetLanguage: string;
}): RequestIdentity {
	return Object.freeze({
		provider: token(input.provider, 'provider'),
		textFingerprint: token(input.textFingerprint, 'textFingerprint'),
		sourceLanguage: token(input.sourceLanguage, 'sourceLanguage'),
		targetLanguage: token(input.targetLanguage, 'targetLanguage'),
	});
}

export function actionRequestIdentity(input: {
	readonly authScope: string;
	readonly operation: string;
	readonly targetType: string;
	readonly targetId: string | number;
	readonly variant?: string;
}): RequestIdentity {
	const identity: Record<string, RequestIdentityValue> = {
		authScope: discourseAuthScope(input.authScope),
		operation: token(input.operation, 'operation'),
		targetType: token(input.targetType, 'targetType'),
		targetId: token(input.targetId, 'targetId'),
	};
	if (input.variant !== undefined) identity.variant = token(input.variant, 'variant');
	return Object.freeze(identity);
}

export function readRequestIdentity(input: {
	readonly authScope: string;
	readonly topicId: string | number;
	readonly postNumbers: readonly number[];
}): RequestIdentity {
	return Object.freeze({
		authScope: discourseAuthScope(input.authScope),
		topicId: discourseTopicId(input.topicId),
		postNumbers: discoursePostNumbers(input.postNumbers).join(','),
	});
}
