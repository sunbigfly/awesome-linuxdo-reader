import type { DiscoursePostNumber } from '../src/discourse/identifiers.js';
import {
	BrowserReadStateCoordinator,
	READ_STATE_ATTEMPT_STORAGE_KEY,
	READ_STATE_INTENT_STORAGE_KEY,
	READ_STATE_SUCCESS_STORAGE_KEY,
	type ReadStateConfirmation,
	type ReadStateCoordinationMessage,
	type ReadStateMessageChannel,
	type ReadStateStoragePort,
} from '../src/reading/read-state-coordination.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStorage implements ReadStateStoragePort {
	readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

class MemoryChannel implements ReadStateMessageChannel {
	readonly listeners = new Set<(message: unknown) => void>();
	readonly posts: ReadStateCoordinationMessage[] = [];
	closed = false;

	post(message: ReadStateCoordinationMessage): void {
		this.posts.push(message);
	}

	subscribe(listener: (message: unknown) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	emit(message: unknown): void {
		for (const listener of [...this.listeners]) listener(message);
	}

	close(): void {
		this.closed = true;
		this.listeners.clear();
	}
}

const storage = new MemoryStorage();
storage.setItem(READ_STATE_SUCCESS_STORAGE_KEY, JSON.stringify([
	{
		fingerprint: '10:1,2',
		at: 900,
		authScope: 'account:a',
		topicId: 10,
		postNumbers: [1, 2],
	},
	{
		fingerprint: '10:8',
		at: 900,
		// 旧 main 记录没有 auth scope，lite 不能据此跨账号确认。
	},
]));
const channel = new MemoryChannel();
let lockCalls = 0;
const coordinator = new BrowserReadStateCoordinator({
	storage,
	channel,
	now: () => 1_000,
	ttlMs: 500,
	lock: async (_name, task) => {
		lockCalls += 1;
		return task();
	},
});
const allConfirmations: ReadStateConfirmation[] = [];
coordinator.subscribeConfirmations((confirmation) => {
	allConfirmations.push(confirmation);
});
const submissions: number[][] = [];
const confirmed = await coordinator.submitOnce(
	'account:a',
	10,
	[3, 2],
	async (missing) => {
		submissions.push([...missing]);
		return missing;
	},
);
assert(
	lockCalls === 2,
	'有 lock port 时必须分别在登记意图和合并提交阶段进入原子事务',
);
assert(submissions.length === 1 && submissions[0]?.join(',') === '3', '已确认 #2 不应重复提交');
assert(confirmed.join(',') === '2,3', '应合并近期确认和新成功楼层');
assert(
	allConfirmations.length === 1 &&
		allConfirmations[0]?.postNumbers.join(',') === '3' &&
		allConfirmations[0]?.confirmedAt === 1_000,
	'全局确认出口只能发布本次服务器成功提交的楼层，不能混入已有已读状态',
);
const stored = JSON.parse(storage.getItem(READ_STATE_SUCCESS_STORAGE_KEY) ?? '[]') as Array<{
	fingerprint?: string;
	authScope?: string;
	postNumbers?: number[];
}>;
assert(
	stored.some((entry) =>
		entry.fingerprint === 'account%3Aa:10' &&
		entry.authScope === 'account:a' &&
		entry.postNumbers?.join(',') === '1,2,3'),
	'同一 auth/topic 必须把旧批次与新成功楼层合并成一条持久记录',
);

const accountBSubmissions: number[][] = [];
await coordinator.submitOnce('account:b', 10, [2], async (missing) => {
	accountBSubmissions.push([...missing]);
	return missing;
});
assert(accountBSubmissions[0]?.join(',') === '2', '不同 auth scope 不得复用确认');
assert(
	Number(allConfirmations.length) === 2 &&
		allConfirmations[1]?.authScope === 'account:b',
	'服务器成功确认出口必须保留账号边界',
);

const received: number[][] = [];
coordinator.subscribe('account:a', 10, (message) => {
	received.push([...message.postNumbers]);
});
channel.emit({
	authScope: 'account:a',
	topicId: 10,
	postNumbers: [9],
	confirmedAt: 1_000,
});
channel.emit({
	authScope: 'account:b',
	topicId: 10,
	postNumbers: [11],
	confirmedAt: 1_000,
});
assert(received.length === 1 && received[0]?.join(',') === '9', '广播必须按 auth/topic 隔离');
assert(
	Number(allConfirmations.length) === 4,
	'跨标签收到的服务器确认也必须进入全局确认出口，由消费端按账号去重',
);
channel.emit({
	type: 'challenge-halted',
	authScope: 'account:a',
	topicId: 99,
	haltedAt: 1_000,
});
let broadcastHaltSubmitted = false;
let broadcastHaltObserved = false;
try {
	await coordinator.submitOnce('account:a', 99, [1], async (missing) => {
		broadcastHaltSubmitted = missing.length > 0;
		return missing;
	});
} catch (error) {
	broadcastHaltObserved = !!error && typeof error === 'object' &&
		'cloudflareMitigated' in error && error.cloudflareMitigated === true;
}
assert(
	broadcastHaltObserved && !broadcastHaltSubmitted,
	'其他 tab 广播的 Topic timings Cloudflare 失败必须阻止本 tab 后续接棒发请求',
);

const coalescedStorage = new MemoryStorage();
let coalescedLockTail = Promise.resolve<unknown>(undefined);
const coalescedLock = <T>(_name: string, task: () => Promise<T>): Promise<T> => {
	const result = coalescedLockTail.catch(() => undefined).then(task);
	coalescedLockTail = result.then(() => undefined, () => undefined);
	return result;
};
const coalescedA = new BrowserReadStateCoordinator({
	storage: coalescedStorage,
	lock: coalescedLock,
	intentCoalesceMs: 10,
});
const coalescedB = new BrowserReadStateCoordinator({
	storage: coalescedStorage,
	lock: coalescedLock,
	intentCoalesceMs: 10,
});
const coalescedSubmissions: number[][] = [];
const submitCoalesced = async (missing: readonly DiscoursePostNumber[]) => {
	coalescedSubmissions.push([...missing]);
	return missing;
};
const [coalescedAResult, coalescedBResult] = await Promise.all([
	coalescedA.submitOnce('account:a', 11, [55], submitCoalesced),
	coalescedB.submitOnce('account:a', 11, [7, 9, 13], submitCoalesced),
]);
assert(
	coalescedSubmissions.length === 1 &&
		coalescedSubmissions[0]?.join(',') === '7,9,13,55' &&
		coalescedAResult.join(',') === '55' &&
		coalescedBResult.join(',') === '7,9,13',
	'同 auth/topic 的跨标签并发楼层必须先合并，再由一个 submitter 发出一次 timings',
);
assert(
	coalescedStorage.getItem(READ_STATE_INTENT_STORAGE_KEY) === '[]',
	'合并批次成功后必须清理共享意图，不能把下一次真实滚动当成旧批次',
);
coalescedA.close();
coalescedB.close();

let unlockedSubmitted = false;
const unlocked = new BrowserReadStateCoordinator({
	storage: new MemoryStorage(),
});
const unlockedConfirmed = await unlocked.submitOnce('account:a', 12, [4], async (missing) => {
	unlockedSubmitted = true;
	return missing;
});
assert(unlockedSubmitted && unlockedConfirmed.join(',') === '4', '无 lock 能力时必须明确降级');

let failedTaskCalls = 0;
const failingTaskCoordinator = new BrowserReadStateCoordinator({
	storage: new MemoryStorage(),
	lock: async (_name, task) => task(),
});
try {
	await failingTaskCoordinator.submitOnce('account:a', 13, [5], async () => {
		failedTaskCalls += 1;
		throw new Error('network failed inside lock');
	});
	throw new Error('锁内网络失败不得成功');
} catch (error) {
	assert(
		error instanceof Error && error.message === 'network failed inside lock',
		'锁内网络错误必须原样传播',
	);
}
assert(failedTaskCalls === 1, '锁内 task 失败不得被当成 lock 失败重放');

const challengeAttemptStorage = new MemoryStorage();
let challengeAttemptNow = 2_000;
const challengeAttemptCoordinator = new BrowserReadStateCoordinator({
	storage: challengeAttemptStorage,
	now: () => challengeAttemptNow,
	attemptTtlMs: 1_000,
	lock: async (_name, task) => task(),
});
try {
	await challengeAttemptCoordinator.submitOnce('account:a', 14, [3, 4, 5], async () => {
		throw Object.assign(new Error('challenge'), { cloudflareMitigated: true });
	});
	throw new Error('Cloudflare 尝试不得成功');
} catch (error) {
	assert(
		error instanceof Error && error.message === 'challenge',
		'Cloudflare 失败必须原样传播给当前 controller',
	);
}
const postChallengeSubmissions: number[][] = [];
let propagatedChallenge = false;
try {
	await challengeAttemptCoordinator.submitOnce('account:a', 14, [4, 5, 6], async (missing) => {
		postChallengeSubmissions.push([...missing]);
		return missing;
	});
} catch (error) {
	propagatedChallenge = !!error && typeof error === 'object' &&
		'cloudflareMitigated' in error && error.cloudflareMitigated === true;
}
assert(
	propagatedChallenge && postChallengeSubmissions.length === 0 &&
		challengeAttemptCoordinator.knownAttempted('account:a', 14, [3, 4, 5, 6])
			.join(',') === '3,4,5',
	'过盾后同 Topic 的等待 tab 必须收到同一停止语义，不能接棒提交不同新楼层',
);
assert(
	JSON.parse(challengeAttemptStorage.getItem(READ_STATE_ATTEMPT_STORAGE_KEY) ?? '[]')
		.length === 1,
	'Cloudflare 楼层尝试必须写入单独账本，不能伪装成服务器成功确认',
);
challengeAttemptNow += 1_001;
challengeAttemptCoordinator.close();
const reopenedChallengeAttemptCoordinator = new BrowserReadStateCoordinator({
	storage: challengeAttemptStorage,
	now: () => challengeAttemptNow,
	attemptTtlMs: 1_000,
	lock: async (_name, task) => task(),
});
let expiredAttemptSubmitted = false;
await reopenedChallengeAttemptCoordinator.submitOnce('account:a', 14, [4], async (missing) => {
	expiredAttemptSubmitted = missing.length === 1;
	return missing;
});
assert(
	expiredAttemptSubmitted,
	'原 Topic owner 保持停止；重开后的新 owner 在精确去重窗口到期后恢复一次提交',
);

const singleRecordStorage = new MemoryStorage();
const singleRecordCoordinator = new BrowserReadStateCoordinator({
	storage: singleRecordStorage,
	maxRecords: 1,
});
await singleRecordCoordinator.submitOnce('account:a', 20, [1], async (missing) => missing);
await singleRecordCoordinator.submitOnce('account:a', 20, [2], async (missing) => missing);
const singleRecords = JSON.parse(
	singleRecordStorage.getItem(READ_STATE_SUCCESS_STORAGE_KEY) ?? '[]',
) as Array<{ fingerprint?: string; postNumbers?: number[] }>;
assert(
	singleRecords.length === 1 &&
		singleRecords[0]?.fingerprint === 'account%3Aa:20' &&
		singleRecords[0]?.postNumbers?.join(',') === '1,2',
	'maxRecords=1 仍必须合并保留同一 Topic 的全部成功楼层',
);

const persistentStorage = new MemoryStorage();
let persistentNow = 1_000;
const firstPersistentCoordinator = new BrowserReadStateCoordinator({
	storage: persistentStorage,
	now: () => persistentNow,
});
let persistentSubmissions = 0;
await firstPersistentCoordinator.submitOnce('account:a', 30, [4, 7], async (missing) => {
	persistentSubmissions += 1;
	return missing;
});
firstPersistentCoordinator.close();
persistentNow += 365 * 24 * 60 * 60_000;
const reopenedPersistentCoordinator = new BrowserReadStateCoordinator({
	storage: persistentStorage,
	now: () => persistentNow,
});
assert(
	reopenedPersistentCoordinator.knownConfirmed('account:a', 30, [4, 7, 8])
		.join(',') === '4,7',
	'默认持久记录跨重开和一年后仍必须恢复已确认楼层',
);
const reopenedConfirmed = await reopenedPersistentCoordinator.submitOnce(
	'account:a',
	30,
	[4, 7],
	async (missing) => {
		persistentSubmissions += 1;
		return missing;
	},
);
assert(
	persistentSubmissions === 1 && reopenedConfirmed.join(',') === '4,7',
	'重开后持久化已读楼层不得再次进入 POST submitter',
);

coordinator.close();
unlocked.close();
failingTaskCoordinator.close();
challengeAttemptCoordinator.close();
reopenedChallengeAttemptCoordinator.close();
singleRecordCoordinator.close();
reopenedPersistentCoordinator.close();
assert(channel.closed, 'coordinator close 必须关闭自有频道');
