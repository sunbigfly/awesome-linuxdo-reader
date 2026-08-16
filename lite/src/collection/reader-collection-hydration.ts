import type { ResponseCacheFlightPort } from
	'../cache/response-repository.js';

export interface ReaderCollectionResumeCheckpoint {
	readonly sourceNextPage?: number;
	readonly sourcePageSize?: number;
	readonly sourceOffset?: number;
}

export interface ReaderCollectionResumePosition {
	readonly page: number;
	readonly offset: number;
}

export interface ReaderCollectionWorkerPoolOptions<TKey> {
	readonly concurrency: number;
	readonly maxTasks?: number;
	readonly claim: () => TKey | null;
	readonly run: (key: TKey) => void | Promise<void>;
	readonly release?: (key: TKey) => void;
	readonly shouldContinue?: () => boolean;
}

export interface ReaderCollectionWorkerPoolResult {
	readonly started: number;
	readonly completed: number;
}

export type ReaderCollectionHydrationLeaseResult =
	| 'producer'
	| 'consumer'
	| 'consumer-timeout';

export interface ReaderCollectionHydrationLeaseOptions {
	readonly coordination?: Pick<
		ResponseCacheFlightPort,
		'acquireFlight' | 'renewFlight' | 'releaseFlight' | 'waitForFlight'
	> | null;
	readonly token: string;
	readonly signal?: AbortSignal;
	readonly heartbeatMs?: number;
	/** 取得 producer lease 后先同步共享持久断点，再开始本标签采集。 */
	readonly beforeRun?: () => void | Promise<void>;
	readonly run: () => void | Promise<void>;
	readonly onError?: (cause: unknown) => void;
}

function positiveSafeInteger(value: unknown, fallback: number): number {
	const normalized = Math.floor(Number(value));
	return Number.isSafeInteger(normalized) && normalized > 0
		? normalized
		: fallback;
}

function nonNegativeSafeInteger(value: unknown): number | null {
	const normalized = Math.floor(Number(value));
	return Number.isSafeInteger(normalized) && normalized >= 0
		? normalized
		: null;
}

/**
 * 把历史断点统一为绝对 offset。页大小变化时最多回放一个重叠页，不再退回第 0 页，
 * 也不会因直接沿用旧页码而跳过记录。
 */
export function readerCollectionResumePosition(
	checkpoint: ReaderCollectionResumeCheckpoint,
	targetPageSizeValue: number,
	legacyPageSizeValue = targetPageSizeValue,
): ReaderCollectionResumePosition {
	const targetPageSize = positiveSafeInteger(targetPageSizeValue, 1);
	const legacyPageSize = positiveSafeInteger(
		checkpoint.sourcePageSize,
		positiveSafeInteger(legacyPageSizeValue, targetPageSize),
	);
	const storedOffset = nonNegativeSafeInteger(checkpoint.sourceOffset);
	const storedPage = nonNegativeSafeInteger(checkpoint.sourceNextPage) ?? 0;
	const offset = storedOffset ?? storedPage * legacyPageSize;
	return Object.freeze({
		page: Math.floor(offset / targetPageSize),
		offset,
	});
}

/** 持续补位的集合 worker pool；不会被 Promise.all 的整批等待屏障卡住。 */
export async function runReaderCollectionWorkers<TKey>(
	options: ReaderCollectionWorkerPoolOptions<TKey>,
): Promise<ReaderCollectionWorkerPoolResult> {
	const concurrency = positiveSafeInteger(options.concurrency, 1);
	const maxTasks = options.maxTasks === undefined
		? Number.MAX_SAFE_INTEGER
		: Math.max(0, Math.floor(Number(options.maxTasks) || 0));
	let started = 0;
	let completed = 0;
	const worker = async (): Promise<void> => {
		while (
			started < maxTasks &&
			(options.shouldContinue?.() ?? true)
		) {
			const key = options.claim();
			if (key === null) return;
			started += 1;
			try {
				await options.run(key);
				completed += 1;
			} finally {
				options.release?.(key);
			}
		}
	};
	await Promise.all(Array.from(
		{ length: Math.min(concurrency, Math.max(1, maxTasks)) },
		() => worker(),
	));
	return Object.freeze({ started, completed });
}

/** 同一账号、同一集合只允许一个标签页执行历史采集。 */
export async function runReaderCollectionHydrationLease(
	options: ReaderCollectionHydrationLeaseOptions,
): Promise<ReaderCollectionHydrationLeaseResult> {
	const coordination = options.coordination;
	const token = String(options.token).trim();
	if (!coordination || !token) {
		await options.beforeRun?.();
		options.signal?.throwIfAborted();
		await options.run();
		return 'producer';
	}
	options.signal?.throwIfAborted();
	const lease = await coordination.acquireFlight(token);
	options.signal?.throwIfAborted();
	if (!lease.producer) {
		const released = await coordination.waitForFlight(
			token,
			options.signal,
		);
		return released ? 'consumer' : 'consumer-timeout';
	}
	const heartbeatMs = positiveSafeInteger(options.heartbeatMs, 10_000);
	const heartbeat = lease.coordinated
		? setInterval(() => {
			void coordination.renewFlight(lease).catch(
				options.onError ?? (() => {}),
			);
		}, heartbeatMs)
		: null;
	try {
		await options.beforeRun?.();
		options.signal?.throwIfAborted();
		await options.run();
		return 'producer';
	} finally {
		if (heartbeat !== null) clearInterval(heartbeat);
		await coordination.releaseFlight(lease);
	}
}
