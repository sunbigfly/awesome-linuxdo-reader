export type DiscourseIngestSource =
	| 'topic-json'
	| 'loader-batch'
	| 'target-refresh'
	| 'action-response'
	| 'message-bus';

export interface DiscourseIngestVersion {
	readonly observedAt: number;
	readonly source: DiscourseIngestSource;
}

export interface DiscourseVersionStamp {
	readonly observedAt: number;
	readonly source: DiscourseIngestSource | null;
}

const SOURCE_RANK: Readonly<Record<DiscourseIngestSource, number>> = Object.freeze({
	'loader-batch': 1,
	'topic-json': 2,
	'target-refresh': 3,
	'action-response': 4,
	'message-bus': 5,
});

export function discourseObservedAt(value: unknown, name = 'observedAt'): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric) || numeric < 0) {
		throw new RangeError(`${name} 必须是非负有限时间戳`);
	}
	return numeric;
}

export function normalizeDiscourseIngestSource(
	value: unknown,
): DiscourseIngestSource | null {
	return typeof value === 'string' && Object.hasOwn(SOURCE_RANK, value)
		? value as DiscourseIngestSource
		: null;
}

/**
 * Discourse 数据 ingress 的全局新旧仲裁。
 *
 * observedAt 是“请求开始/事件到达”的客户端时间，不是服务端内容版本。滚动批次可能在
 * MessageBus 或权威 Topic/目标刷新之后启动，却命中较旧的 HTTP 缓存，因此 loader-batch
 * 只能补未知值或更新它自己写入的值，不能降级更高置信来源。
 */
export function shouldReplaceDiscourseVersion(
	current: DiscourseVersionStamp | null | undefined,
	next: DiscourseIngestVersion,
): boolean {
	if (!current) return true;
	if (
		next.source === 'loader-batch' &&
		current.source !== null &&
		current.source !== 'loader-batch'
	) {
		return false;
	}
	if (next.observedAt !== current.observedAt) {
		return next.observedAt > current.observedAt;
	}
	if (current.source === null) return true;
	return SOURCE_RANK[next.source] >= SOURCE_RANK[current.source];
}

/**
 * 删除墓碑比普通版本更保守：成功 action 删除后，滚动/Topic 全量读取只能继续隐藏该楼层；
 * 只有定点权威刷新、后续 action 或 MessageBus 才能显式恢复。
 */
export function shouldReplaceDiscourseRemoval(
	current: DiscourseVersionStamp,
	next: DiscourseIngestVersion,
): boolean {
	if (
		current.source === 'action-response' &&
		(next.source === 'loader-batch' || next.source === 'topic-json')
	) {
		return false;
	}
	return shouldReplaceDiscourseVersion(current, next);
}
