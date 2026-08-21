import {
	requestProfileContract,
	type RequestContractProfile,
	type RequestProfileContract,
} from './request-contract.js';
import {
	requestLaneConcurrencyCap,
	type RequestLane,
} from './request-scheduler.js';
import type {
	ReaderBusinessRequestKind,
} from './reader-business-request-config.js';

export type {
	ReaderBusinessRequestKind,
} from './reader-business-request-config.js';

export type ReaderBusinessRequestCacheOwner =
	| 'canonical-topic'
	| 'persistent-pages';

export type ReaderBusinessRequestExecution =
	| 'idle-resumable'
	| 'paged-serial'
	| 'head-burst-history-serial'
	| 'source-parallel-page-serial';

export interface ReaderBusinessRequestPolicy {
	readonly kind: ReaderBusinessRequestKind;
	readonly foregroundProfile: RequestContractProfile;
	readonly warmProfile: RequestContractProfile;
	readonly backgroundProfile: RequestContractProfile;
	readonly mutationProfile?: RequestContractProfile;
	readonly allowedProfiles: readonly RequestContractProfile[];
	readonly lanes: readonly RequestLane[];
	readonly cacheOwner: ReaderBusinessRequestCacheOwner;
	readonly execution: ReaderBusinessRequestExecution;
}

export interface ReaderBusinessRequestPolicySnapshot {
	readonly policy: ReaderBusinessRequestPolicy;
	readonly foreground: RequestProfileContract;
	readonly warm: RequestProfileContract;
	readonly background: RequestProfileContract;
	readonly mutation?: RequestProfileContract;
	readonly laneCaps: readonly Readonly<{
		readonly lane: RequestLane;
		readonly maxConcurrent: number;
	}>[];
}

function businessPolicy<TPolicy extends ReaderBusinessRequestPolicy>(
	policy: TPolicy,
): Readonly<TPolicy> {
	return Object.freeze({
		...policy,
		allowedProfiles: Object.freeze([...policy.allowedProfiles]),
		lanes: Object.freeze([...policy.lanes]),
	});
}

/**
 * 需要联网的集合型业务唯一策略目录。
 *
 * 业务 owner 只引用这里的 profile 与业务身份；Gateway、Scheduler、共享 permit、
 * response cache 和请求监控继续分别执行契约。设置面板从独立参数 owner 读取可调
 * 目标，同时只读投影这里的固定契约，不能另造与运行时脱节的 profile 或缓存语义。
 */
export const READER_TOPIC_DOWNLOAD_REQUEST_POLICY = businessPolicy({
	kind: 'topic-download',
	foregroundProfile: 'background-prefetch',
	warmProfile: 'background-prefetch',
	backgroundProfile: 'background-prefetch',
	allowedProfiles: ['background-prefetch'],
	lanes: ['topic-batch', 'nested-replies', 'standard'],
	cacheOwner: 'canonical-topic',
	execution: 'idle-resumable',
} as const);

export const READER_USER_OBSERVATION_REQUEST_POLICY = businessPolicy({
	kind: 'user-observation',
	foregroundProfile: 'collection-visible',
	warmProfile: 'background-prefetch',
	backgroundProfile: 'background-prefetch',
	allowedProfiles: ['collection-visible', 'background-prefetch'],
	lanes: ['standard'],
	cacheOwner: 'persistent-pages',
	execution: 'paged-serial',
} as const);

export const READER_NOTIFICATION_REQUEST_POLICY = businessPolicy({
	kind: 'notifications',
	foregroundProfile: 'notification-visible',
	warmProfile: 'surface-prefetch',
	backgroundProfile: 'background-prefetch',
	mutationProfile: 'action-critical',
	allowedProfiles: [
		'notification-visible',
		'surface-prefetch',
		'background-prefetch',
		'collection-visible',
		'action-critical',
	],
	lanes: ['standard', 'topic-batch', 'control'],
	cacheOwner: 'persistent-pages',
	execution: 'head-burst-history-serial',
} as const);

export const READER_BOOKMARK_REQUEST_POLICY = businessPolicy({
	kind: 'bookmarks',
	foregroundProfile: 'collection-visible',
	warmProfile: 'background-prefetch',
	backgroundProfile: 'background-prefetch',
	mutationProfile: 'action-critical',
	allowedProfiles: [
		'collection-visible',
		'background-prefetch',
		'action-critical',
	],
	lanes: ['standard', 'control'],
	cacheOwner: 'persistent-pages',
	execution: 'source-parallel-page-serial',
} as const);

export const READER_BUSINESS_REQUEST_POLICIES = Object.freeze([
	READER_TOPIC_DOWNLOAD_REQUEST_POLICY,
	READER_USER_OBSERVATION_REQUEST_POLICY,
	READER_NOTIFICATION_REQUEST_POLICY,
	READER_BOOKMARK_REQUEST_POLICY,
] as const);

const POLICY_BY_KIND = new Map<
	ReaderBusinessRequestKind,
	ReaderBusinessRequestPolicy
>(READER_BUSINESS_REQUEST_POLICIES.map((policy) => [policy.kind, policy]));

export function readerBusinessRequestPolicy(
	kind: ReaderBusinessRequestKind,
): ReaderBusinessRequestPolicy {
	const policy = POLICY_BY_KIND.get(kind);
	if (!policy) throw new Error(`未知 Reader 业务请求策略：${kind}`);
	return policy;
}

export function readerBusinessRequestKindForAction(
	operationValue: string,
): ReaderBusinessRequestKind | undefined {
	const operation = String(operationValue).trim();
	if (operation.includes('bookmark')) return 'bookmarks';
	if (operation === 'notification-mark-read') return 'notifications';
	return undefined;
}

export function assertReaderBusinessRequestContract(input: Readonly<{
	readonly business: ReaderBusinessRequestKind;
	readonly profile: RequestContractProfile;
	readonly lane: RequestLane;
}>): void {
	const policy = readerBusinessRequestPolicy(input.business);
	if (!policy.allowedProfiles.includes(input.profile)) {
		throw new Error(
			`${input.business} 不允许请求 profile ${input.profile}`,
		);
	}
	if (!policy.lanes.includes(input.lane)) {
		throw new Error(`${input.business} 不允许请求车道 ${input.lane}`);
	}
}

export function readerBusinessRequestPolicySnapshot(
	policy: ReaderBusinessRequestPolicy,
): ReaderBusinessRequestPolicySnapshot {
	return Object.freeze({
		policy,
		foreground: requestProfileContract(policy.foregroundProfile),
		warm: requestProfileContract(policy.warmProfile),
		background: requestProfileContract(policy.backgroundProfile),
		...(policy.mutationProfile === undefined
			? {}
			: { mutation: requestProfileContract(policy.mutationProfile) }),
		laneCaps: Object.freeze(policy.lanes.map((lane) => Object.freeze({
			lane,
			maxConcurrent: requestLaneConcurrencyCap(lane),
		}))),
	});
}
