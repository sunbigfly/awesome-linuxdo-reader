import {
	READER_CREDIT_BRIDGE_CACHE_KEY,
	scheduleReaderCreditAccountBridge,
} from '../src/user/reader-credit-account-bridge.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

let stored: unknown = { preserved: true };
function controlledTimer() {
	let sequence = 0;
	const callbacks = new Map<number, TimerHandler>();
	return {
		timer: {
			setTimeout(callback: TimerHandler) {
				const id = ++sequence;
				callbacks.set(id, callback);
				return id;
			},
			clearTimeout(id: number) {
				callbacks.delete(id);
			},
		},
		runNext() {
			const next = callbacks.entries().next().value as
				| [number, TimerHandler]
				| undefined;
			if (!next) return;
			callbacks.delete(next[0]);
			if (typeof next[1] === 'function') next[1]();
		},
	};
}
const successfulTimer = controlledTimer();
const completeDocument = {
	readyState: 'complete',
	defaultView: null,
} as unknown as Document;
const storage = {
	getValue: () => stored,
	setValue(key: string, value: unknown) {
		assert(
			key === READER_CREDIT_BRIDGE_CACHE_KEY,
			'LDC 同源桥必须继续复用旧版 GM key',
		);
		stored = value;
	},
};

scheduleReaderCreditAccountBridge(
	successfulTimer.timer,
	completeDocument,
	storage,
	{
		async loadUserInfo(signal) {
			assert(!signal.aborted, 'LDC bridge 必须把存活 signal 传入同源 fetch');
			return { data: { username: 'alice', available_balance: 12 } };
		},
	},
);
successfulTimer.runNext();
for (let index = 0; index < 8; index += 1) await Promise.resolve();
assert(
	(stored as { readonly data?: { readonly username?: string } }).data
			?.username === 'alice',
	'LDC 页面必须在同源端口成功后更新桥缓存',
);

const preserved = stored;
const failedTimer = controlledTimer();
const bridgeErrors: unknown[] = [];
scheduleReaderCreditAccountBridge(
	failedTimer.timer,
	completeDocument,
	storage,
	{ loadUserInfo: () => Promise.reject(new Error('offline')) },
	(cause) => bridgeErrors.push(cause),
);
failedTimer.runNext();
for (let index = 0; index < 8; index += 1) await Promise.resolve();
assert(
	stored === preserved && bridgeErrors.length === 1,
	'LDC 同源桥失败时不得清空最近一次成功缓存，且必须进入异常观测回调',
);

const cancelledTimer = controlledTimer();
let cancelledCalls = 0;
const cancelBridge = scheduleReaderCreditAccountBridge(
	cancelledTimer.timer,
	completeDocument,
	storage,
	{
		async loadUserInfo() {
			cancelledCalls += 1;
			return { data: { username: 'late' } };
		},
	},
);
cancelBridge();
cancelledTimer.runNext();
assert(
	cancelledCalls === 0,
	'LDC bridge 生命周期结束必须清除延迟任务，不能在页面退出后补发请求',
);
