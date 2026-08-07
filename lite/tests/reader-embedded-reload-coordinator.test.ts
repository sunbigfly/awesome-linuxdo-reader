import {
	ReaderEmbeddedReloadCoordinator,
} from '../src/userscript/reader-embedded-reload-coordinator.js';
import type {
	ReaderEmbeddedReloadCapture,
} from '../src/userscript/reader-embedded-reload-coordinator.js';
import { discoursePostNumber } from '../src/discourse/identifiers.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> {
	readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}

	removeItem(key: string): void {
		this.values.delete(key);
	}
}

const target = new EventTarget();
const storage = new MemoryStorage();
let now = 10_000;
let route = '/latest?order=created#reader';
let navigationType = 'reload';
let capture: ReaderEmbeddedReloadCapture | null = Object.freeze({
	mode: 'embed-right',
	topicId: 42,
	anchor: Object.freeze({
		viewport: Object.freeze({
			postNumber: discoursePostNumber(7),
			postOffset: 18,
			scrollTop: 720,
		}),
		replyWindow: null,
		quoteHighlight: null,
	}),
	onlyOp: true,
});
const restored: ReaderEmbeddedReloadCapture[] = [];
const coordinator = new ReaderEmbeddedReloadCoordinator({
	target,
	storage,
	now: () => now,
	currentHostRoute: () => route,
	navigationType: () => navigationType,
	capture: () => capture,
	restore: async (state) => {
		restored.push(state);
		return true;
	},
});

target.dispatchEvent(new Event('pagehide'));
assert(
	storage.values.size === 1,
	'嵌入阅读器 pagehide 必须保存唯一一次 reload 恢复状态',
);
assert(
	await coordinator.restore() &&
		restored.length === 1 &&
		restored[0]?.mode === 'embed-right' &&
		restored[0]?.topicId === 42 &&
		restored[0]?.anchor.viewport.postNumber === 7 &&
		restored[0]?.onlyOp === true &&
		Number(storage.values.size) === 0,
	'reload 必须消费状态并按 mode -> topic -> only-op -> anchor 的 canonical 事务恢复',
);

target.dispatchEvent(new Event('pagehide'));
navigationType = 'navigate';
assert(
	!await coordinator.restore() &&
		restored.length === 1 &&
		Number(storage.values.size) === 0,
	'非 reload 导航必须消费陈旧状态且不得误开 Reader',
);

navigationType = 'reload';
target.dispatchEvent(new Event('pagehide'));
route = '/new';
assert(
	!await coordinator.restore() && restored.length === 1,
	'宿主路由变化后不得恢复旧列表页上的嵌入 Reader',
);

route = '/latest?order=created#reader';
target.dispatchEvent(new Event('pagehide'));
now += 30_001;
assert(
	!await coordinator.restore() && restored.length === 1,
	'超过 30 秒 TTL 的 reload 状态必须失效',
);

now = 50_000;
capture = Object.freeze({ ...capture!, mode: 'floating' });
target.dispatchEvent(new Event('pagehide'));
assert(
	Number(storage.values.size) === 0,
	'floating/fullpage 不得占用嵌入 reload 状态槽',
);

capture = Object.freeze({ ...capture!, mode: 'embed-left' });
coordinator.destroy();
target.dispatchEvent(new Event('pagehide'));
assert(
	Number(storage.values.size) === 0,
	'destroy 必须解除 pagehide listener，不能留下第二生命周期 owner',
);
