import {
	READER_INFORMATION_FLOW_EXCLUSIONS,
	READER_INFORMATION_FLOW_INVENTORY,
	ReaderInformationFlowCoordinator,
} from '../src/state/reader-information-flow-coordinator.js';
import {
	ReaderHistoryRepository,
} from '../src/history/reader-history-repository.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class CacheChanges {
	readonly listeners = new Set<(query: Readonly<{
		readonly ids?: readonly string[];
	}>) => void>();

	subscribeInvalidation(listener: (query: Readonly<{
		readonly ids?: readonly string[];
	}>) => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	publish(ids: readonly string[]): void {
		for (const listener of this.listeners) listener({ ids });
	}
}

function storageChange(
	target: EventTarget,
	key: string,
	oldValue: string | null,
	newValue: string | null,
): void {
	const event = new Event('storage');
	Object.defineProperties(event, {
		key: { value: key },
		oldValue: { value: oldValue },
		newValue: { value: newValue },
	});
	target.dispatchEvent(event);
}

const inventory = READER_INFORMATION_FLOW_INVENTORY.map(({ domain }) => domain);
assert(
	inventory.join(',') === [
		'preferences',
		'reading-history',
		'chronicle',
		'unwanted-topics',
		'reader-queue',
		'user-observations',
		'host-opened-topics',
		'topic-context',
		'topic-summary-state',
		'surface-layout',
		'connect-trust-history',
		'credit-account',
		'notifications',
		'bookmarks',
		'download-history',
		'custom-sites',
		'translation-config',
		'webdav-config',
		'response-cache',
		'read-confirmations',
	].join(','),
	'跨标签信息流清单必须覆盖业务持久状态、GM 配置及既有缓存/已读广播',
);
assert(
	READER_INFORMATION_FLOW_EXCLUSIONS.map(({ domain }) => domain).join(',') === [
		'request-permit',
		'cache-flight-lock',
		'embedded-reload-transaction',
		'native-tab-bypass',
		'account-scope-migration-metadata',
		'asset-cache',
		'settings-reset-reminder',
	].join(','),
	'持久写入口审计必须显式锁定仅协议/一次性事务的排除项，不能把漏接误称为无需同步',
);

const storageEvents = new EventTarget();
const cache = new CacheChanges();
const scheduled: Array<() => void> = [];
const refreshes: string[] = [];
const coordinator = new ReaderInformationFlowCoordinator({
	storageEvents,
	cache,
	schedule: (callback) => scheduled.push(callback),
});
coordinator.register({
	domain: 'reading-history',
	storageKeys: ['history:account:test'],
	refresh: (source) => {
		refreshes.push(`history:${source}`);
	},
});
coordinator.register({
	domain: 'download-history',
	cacheIds: ['offline:manifest:account:test'],
	refresh: (source) => {
		refreshes.push(`downloads:${source}`);
	},
});
storageChange(storageEvents, 'unrelated', null, '1');
storageChange(storageEvents, 'history:account:test', '[]', '[1]');
storageChange(storageEvents, 'history:account:test', '[1]', '[2]');
cache.publish(['offline:body:1']);
cache.publish(['offline:manifest:account:test']);
assert(
	scheduled.length === 2,
	'同 tick 的同领域 storage 事件必须合并，且缓存只匹配目标 manifest',
);
for (const callback of scheduled.splice(0)) callback();
await Promise.resolve();
await Promise.resolve();
assert(
	refreshes.join(',') === 'history:storage,downloads:cache',
	'storage 与 cache 广播必须只回调对应领域，不得触发整页刷新或串域更新',
);

let release = (): void => {};
let inFlightRefreshes = 0;
coordinator.register({
	domain: 'chronicle',
	storageKeys: ['chronicle:account:test'],
	refresh: async () => {
		inFlightRefreshes += 1;
		if (inFlightRefreshes === 1) {
			await new Promise<void>((resolve) => {
				release = resolve;
			});
		}
	},
});
storageChange(storageEvents, 'chronicle:account:test', null, '1');
scheduled.shift()?.();
await Promise.resolve();
storageChange(storageEvents, 'chronicle:account:test', '1', '2');
storageChange(storageEvents, 'chronicle:account:test', '2', '3');
release();
await Promise.resolve();
await Promise.resolve();
await Promise.resolve();
assert(
	inFlightRefreshes === 2,
	'领域回调在飞期间的多次广播必须只补跑一次，避免重复渲染与事件风暴',
);

let userscriptNotify = (): void => {};
let userscriptReleased = false;
let userscriptRefreshes = 0;
coordinator.register({
	domain: 'custom-sites',
	subscriptions: [{
		source: 'userscript-value',
		subscribe: (notify) => {
			userscriptNotify = notify;
			return () => {
				userscriptReleased = true;
			};
		},
	}],
	refresh: (source) => {
		if (source === 'userscript-value') userscriptRefreshes += 1;
	},
});
userscriptNotify();
userscriptNotify();
scheduled.shift()?.();
await Promise.resolve();
await Promise.resolve();
assert(
	userscriptRefreshes === 1,
	'GM value-change 必须与 storage/cache 共用同一领域合并与回调机制',
);

const values = new Map<string, string>();
const sharedStorage = {
	getItem(key: string) {
		return values.get(key) ?? null;
	},
	setItem(key: string, value: string) {
		values.set(key, value);
	},
};
const firstHistory = new ReaderHistoryRepository({
	storage: sharedStorage,
	key: 'history:two-tabs',
	now: () => 1_000,
});
const secondHistory = new ReaderHistoryRepository({
	storage: sharedStorage,
	key: 'history:two-tabs',
	now: () => 1_000,
});
firstHistory.load();
secondHistory.load();
const secondTabEvents = new EventTarget();
const secondTabCoordinator = new ReaderInformationFlowCoordinator({
	storageEvents: secondTabEvents,
});
secondTabCoordinator.register({
	domain: 'reading-history',
	storageKeys: [secondHistory.storageKey],
	refresh: () => secondHistory.reloadExternal(),
});
firstHistory.remember({
	topicId: 42,
	title: '中键新标签 Topic',
	postNumber: 7,
});
secondHistory.remember({
	topicId: 43,
	title: '原标签随后进入的 Topic',
	postNumber: 2,
});
storageChange(
	secondTabEvents,
	secondHistory.storageKey,
	'[]',
	values.get(secondHistory.storageKey) ?? null,
);
await Promise.resolve();
await Promise.resolve();
assert(
	secondHistory.entry(42)?.postNumber === 7 &&
		secondHistory.entry(42)?.title === '中键新标签 Topic' &&
		firstHistory.reloadExternal().entries.some((entry) =>
			entry.topicId === 43),
	'新标签经统一 openTarget 写入历史后，其他标签必须自动重读；事件到达前的后续写入也不得覆盖另一标签记录',
);

coordinator.destroy();
secondTabCoordinator.destroy();
const beforeDestroy = refreshes.length;
storageChange(storageEvents, 'history:account:test', '[2]', '[3]');
cache.publish(['offline:manifest:account:test']);
assert(
	refreshes.length === beforeDestroy && cache.listeners.size === 0 &&
		userscriptReleased,
	'销毁必须释放 storage/cache 订阅，晚到事件不得继续更新已关闭页面',
);
