import { parseHTML } from 'linkedom';
import { READER_CACHE_COORDINATION_STORAGE_KEY } from
	'../src/app/reader-data-runtime.js';
import { READER_REQUEST_PERMIT_STORAGE_KEY } from
	'../src/network/browser-shared-request-permit.js';
import {
	ReaderBrowserStorageManagementSurface,
	measureReaderLocalStorageRemaining,
	readReaderBrowserStorageSnapshot,
} from '../src/settings/reader-browser-storage-management.js';
import type {
	ReaderChoiceRequest,
	ReaderConfirmRequest,
} from '../src/shell/reader-feedback-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class FakeStorage implements Storage {
	readonly #values = new Map<string, string>();
	quotaBytes = Number.POSITIVE_INFINITY;
	writeError: unknown = null;

	get length(): number {
		return this.#values.size;
	}

	clear(): void {
		this.#values.clear();
	}

	getItem(key: string): string | null {
		return this.#values.get(String(key)) ?? null;
	}

	key(index: number): string | null {
		return [...this.#values.keys()][index] ?? null;
	}

	removeItem(key: string): void {
		this.#values.delete(String(key));
	}

	setItem(keyValue: string, valueValue: string): void {
		if (this.writeError) throw this.writeError;
		const key = String(keyValue);
		const value = String(valueValue);
		const next = new Map(this.#values);
		next.set(key, value);
		const bytes = [...next].reduce(
			(total, [entryKey, entryValue]) =>
				total + (entryKey.length + entryValue.length) * 2,
			0,
		);
		if (bytes > this.quotaBytes) {
			throw new DOMException('quota', 'QuotaExceededError');
		}
		this.#values.set(key, value);
	}
}

const now = 2_000_000_000_000;
const storage = new FakeStorage();
storage.setItem('linuxdo-enhanced-reader:prefs', JSON.stringify({ theme: 'dark' }));
storage.setItem('discourse_theme_id', '12');
storage.setItem(READER_REQUEST_PERMIT_STORAGE_KEY, JSON.stringify({
	schemaVersion: 1,
	updatedAt: now - 2 * 24 * 60 * 60 * 1_000,
	events: [],
	intents: [],
	active: [],
	policies: [],
	rateLimits: [],
	challenge: null,
}));
storage.setItem(READER_CACHE_COORDINATION_STORAGE_KEY, JSON.stringify({
	schemaVersion: 1,
	epoch: 2,
	updatedAt: now - 1_000,
	flights: [],
	failures: [],
}));
const snapshot = await readReaderBrowserStorageSnapshot({
	storage,
	now: () => now,
	originStorage: {
		estimate: async () => ({ usage: 2_000, quota: 10_000 }),
		persisted: async () => false,
	},
});
assert(
	snapshot.health === 'available' &&
		snapshot.entries.length === 3 &&
		snapshot.entries[0]!.bytes >= snapshot.entries[1]!.bytes &&
		snapshot.entries.every((entry) => entry.readerOwned) &&
		!snapshot.entries.some((entry) => entry.key === 'discourse_theme_id') &&
		snapshot.bytes === snapshot.readerBytes &&
		snapshot.staleCount === 1 &&
		snapshot.entries.some((entry) =>
			entry.key === READER_REQUEST_PERMIT_STORAGE_KEY && entry.stale) &&
		!snapshot.entries.find((entry) =>
			entry.key === READER_CACHE_COORDINATION_STORAGE_KEY)!.stale &&
		snapshot.originQuota === 10_000 &&
		snapshot.persistent === false,
	'localStorage 快照必须只读取并暴露 Reader 键，同时保留久远安全项与浏览器总存储估算',
);

storage.quotaBytes = snapshot.bytes + 1_200;
const remaining = measureReaderLocalStorageRemaining(storage, {
	now: () => now,
	maxBytes: 4_096,
});
assert(
	remaining.cause === undefined &&
		remaining.bytes > 0 &&
		remaining.bytes < 4_096 &&
		![...Array.from({ length: storage.length }, (_, index) => storage.key(index))]
			.some((key) => key?.includes('storage-probe:v1')),
	'localStorage 余量必须通过有界探针逼近，并在成功或 quota 失败后删除探针',
);
storage.quotaBytes = Number.POSITIVE_INFINITY;

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main id="host"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const host = document.querySelector<HTMLElement>('#host')!;
const confirmations: ReaderConfirmRequest[] = [];
const choices: ReaderChoiceRequest[] = [];
const notices: string[] = [];
let reloads = 0;
const surface = new ReaderBrowserStorageManagementSurface({
	document,
	host,
	storage,
	now: () => now,
	remainingProbeMaxBytes: 4_096,
	originStorage: {
		estimate: async () => ({ usage: 2_000, quota: 10_000 }),
		persisted: async () => true,
		persist: async () => true,
	},
	confirm: async (request) => {
		confirmations.push(request);
		return true;
	},
	choose: async (request) => {
		choices.push(request);
		return 'confirm';
	},
	notify: (message) => notices.push(message),
	reload: () => {
		reloads += 1;
	},
});
await new Promise((resolve) => setTimeout(resolve, 0));
await surface.refresh({ measureRemaining: true });
assert(
	host.querySelectorAll('.ldp-local-storage-row').length === 3 &&
	host.querySelector<HTMLDetailsElement>('.ldp-local-storage-picker')
		?.hasAttribute('open') === false &&
	host.querySelector<HTMLElement>('.ldp-local-storage-picker-summary')
		?.textContent === 'Reader 数据（0 / 3）' &&
	host.querySelector<HTMLDetailsElement>('.ldp-local-storage-boundary')
		?.hasAttribute('open') === false &&
	host.querySelector<HTMLElement>('.ldp-local-storage-boundary-summary')
		?.textContent === '空间仍不足？查看浏览器清理方法' &&
	host.querySelector<HTMLElement>('.ldp-local-storage-boundary')
		?.textContent?.includes('从地址栏左侧的站点信息进入“网站设置”') &&
	![...host.querySelectorAll<HTMLInputElement>('.ldp-local-storage-select')]
		.some((input) => input.value === 'discourse_theme_id') &&
	host.querySelector<HTMLElement>('.ldp-local-storage-summary')
		?.textContent?.includes('已用 ') &&
	host.querySelector<HTMLElement>('.ldp-local-storage-summary')
		?.textContent?.includes('可追加 至少') &&
	host.querySelector<HTMLElement>('.ldp-local-storage-summary')
		?.textContent?.includes('已持久保存') &&
	host.querySelector<HTMLButtonElement>('.ldp-local-storage-permission')
		?.hidden === true &&
	host.querySelector<HTMLButtonElement>('.ldp-local-storage-stale')
		?.disabled === false &&
	host.querySelector<HTMLButtonElement>('.ldp-local-storage-stale')
		?.hidden === false &&
	host.querySelector<HTMLButtonElement>('.ldp-local-storage-clear')
		?.hidden === true &&
	host.querySelector<HTMLElement>('.ldp-local-storage-status')
		?.textContent === '' &&
	host.querySelector<HTMLElement>(
		'.ldp-local-storage-row.is-stale .ldp-local-storage-key-copy small',
	)?.textContent === 'Reader 临时项 · 久远可清理',
	'数据管理必须只用默认折叠入口显示 Reader 键，并提示其他站点数据的浏览器清理路径',
);

const initialSelects = host.querySelectorAll<HTMLInputElement>(
	'.ldp-local-storage-select',
);
const picker = host.querySelector<HTMLDetailsElement>(
	'.ldp-local-storage-picker',
)!;
picker.open = true;
const selectAll = host.querySelector<HTMLInputElement>(
	'.ldp-local-storage-select-all',
)!;
selectAll.checked = true;
selectAll.dispatchEvent(new parsedWindow.Event('change'));
assert(
	host.querySelector<HTMLElement>('.ldp-local-storage-picker-summary')
		?.textContent === 'Reader 数据（3 / 3）' &&
	[...initialSelects].every((input) => input.checked) &&
	selectAll.checked &&
	!selectAll.indeterminate &&
	host.querySelector<HTMLButtonElement>('.ldp-local-storage-clear')
		?.disabled === false &&
	host.querySelector<HTMLButtonElement>('.ldp-local-storage-clear')
		?.hidden === false &&
	host.querySelector<HTMLButtonElement>('.ldp-local-storage-clear span')
		?.textContent === '删除已选 3 项' &&
	picker.open,
	'localStorage 下拉必须支持全选，并实时显示已选数量',
);
initialSelects[0]!.checked = false;
initialSelects[0]!.dispatchEvent(new parsedWindow.Event('change', {
	bubbles: true,
}));
assert(
	host.querySelector<HTMLElement>('.ldp-local-storage-picker-summary')
		?.textContent === 'Reader 数据（2 / 3）' &&
	!selectAll.checked &&
	selectAll.indeterminate,
	'取消单项后全选框必须进入部分选择状态',
);
selectAll.checked = false;
selectAll.dispatchEvent(new parsedWindow.Event('change'));
assert(
	[...initialSelects].every((input) => !input.checked) &&
	!selectAll.indeterminate &&
	host.querySelector<HTMLButtonElement>('.ldp-local-storage-clear')
		?.hidden === true,
	'取消全选必须清空选择，并收起删除按钮',
);

host.querySelector<HTMLButtonElement>('.ldp-local-storage-stale')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	confirmations[0]?.title === '清理久远 Reader 数据？' &&
	storage.getItem(READER_REQUEST_PERMIT_STORAGE_KEY) === null &&
	storage.getItem('linuxdo-enhanced-reader:prefs') !== null &&
	storage.getItem('discourse_theme_id') === '12' &&
	reloads === 1 &&
	notices.includes('已清理 1 项久远 Reader 数据'),
	'默认久远清理只能删除无有效租约的 Reader 临时状态，并保留设置与站点数据',
);

await surface.refresh();
assert(
	host.querySelector<HTMLButtonElement>('.ldp-local-storage-stale')
		?.hidden === true,
	'没有久远 Reader 数据时不应占用空间显示久远清理按钮',
);
const readerSelect = [...host.querySelectorAll<HTMLInputElement>(
	'.ldp-local-storage-select',
)].find((input) => input.value === 'linuxdo-enhanced-reader:prefs')!;
readerSelect.checked = true;
readerSelect.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
host.querySelector<HTMLButtonElement>('.ldp-local-storage-clear')!.click();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	confirmations[1]?.title === '删除所选 localStorage 项？' &&
	confirmations[1]?.note?.includes('这里只会删除 Reader 数据') &&
	storage.getItem('linuxdo-enhanced-reader:prefs') === null &&
	storage.getItem('discourse_theme_id') === '12' &&
	Number(reloads) === 2,
	'原始清理必须二次确认、按选择删除 Reader 键，并始终保留原站数据',
);

surface.destroy();

const quotaStorage = new FakeStorage();
quotaStorage.setItem('site-key', 'value');
quotaStorage.writeError = new DOMException('quota', 'QuotaExceededError');
const quotaDocument = parseHTML(
	'<!doctype html><html><body><main id="host"></main></body></html>',
).document as unknown as Document;
let opened = 0;
const quotaChoices: ReaderChoiceRequest[] = [];
const quotaSurface = new ReaderBrowserStorageManagementSurface({
	document: quotaDocument,
	host: quotaDocument.querySelector<HTMLElement>('#host')!,
	storage: quotaStorage,
	now: () => now,
	confirm: async () => false,
	choose: async (request) => {
		quotaChoices.push(request);
		return 'confirm';
	},
	openSettings: () => {
		opened += 1;
	},
});
const warned = await quotaSurface.warnAtStartup();
assert(
	warned &&
	quotaChoices[0]?.title === '浏览器本地存储不可写' &&
	quotaChoices[0]?.details?.[0]?.value === '空间已满或余量不足' &&
	quotaChoices[0]?.note?.includes('持久保存不会扩大 localStorage 配额') &&
	opened === 1,
	'Reader 启动时必须识别 quota 写失败并提供数据管理修复入口',
);
quotaSurface.destroy();

const denied = await readReaderBrowserStorageSnapshot({
	storage: new FakeStorage(),
	storageAccess: { hasAccess: async () => false },
});
assert(
	denied.health === 'access-denied' && denied.storageAccess === false,
	'存储访问权限不足必须与容量不足分开报告',
);
