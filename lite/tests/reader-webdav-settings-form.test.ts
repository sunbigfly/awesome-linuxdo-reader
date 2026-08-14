import { parseHTML } from 'linkedom';
import { ReaderWebDavSettingsForm } from
	'../src/settings/reader-webdav-settings-form.js';
import { ReaderWebDavClient } from '../src/sync/reader-webdav-client.js';
import { ReaderWebDavConfigRepository } from
	'../src/sync/reader-webdav-config-repository.js';
import { ReaderWebDavCoordinator } from
	'../src/sync/reader-webdav-coordinator.js';
import {
	createReaderWebDavCategorySelection,
	normalizeReaderWebDavConfig,
} from '../src/sync/reader-webdav-model.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class ControlledValueStorage {
	value: unknown = null;
	failNextWrite: Error | null = null;
	blockNextRead = false;
	blockNextWrite = false;
	#releaseRead: (() => void) | null = null;
	#releaseWrite: (() => void) | null = null;

	get readBlocked(): boolean {
		return this.#releaseRead !== null;
	}

	get writeBlocked(): boolean {
		return this.#releaseWrite !== null;
	}

	async getValue(): Promise<unknown> {
		if (this.blockNextRead) {
			this.blockNextRead = false;
			await new Promise<void>((resolve) => {
				this.#releaseRead = resolve;
			});
			this.#releaseRead = null;
		}
		return this.value;
	}

	async setValue(_key: string, value: unknown): Promise<void> {
		const failure = this.failNextWrite;
		if (failure) {
			this.failNextWrite = null;
			throw failure;
		}
		if (this.blockNextWrite) {
			this.blockNextWrite = false;
			await new Promise<void>((resolve) => {
				this.#releaseWrite = resolve;
			});
			this.#releaseWrite = null;
		}
		this.value = structuredClone(value);
	}

	releaseWrite(): void {
		const release = this.#releaseWrite;
		if (!release) throw new Error('当前没有等待释放的 WebDAV 设置写入');
		release();
	}

	releaseRead(): void {
		const release = this.#releaseRead;
		if (!release) throw new Error('当前没有等待释放的 WebDAV 设置读取');
		release();
	}
}

async function settle(): Promise<void> {
	await Promise.resolve();
	await Promise.resolve();
	await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main id="host"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const host = document.querySelector<HTMLElement>('#host')!;
let stored: unknown = null;
const repository = new ReaderWebDavConfigRepository({
	storage: {
		getValue: () => stored,
		setValue: (_key, value) => {
			stored = structuredClone(value);
		},
	},
	createWriterId: () => 'settings-device',
});
const coordinator = new ReaderWebDavCoordinator({
	client: new ReaderWebDavClient({
		request: () => {
			throw new Error('保存设置不得发出 WebDAV 请求');
		},
	}),
	repository,
	categories: [],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
});
const form = new ReaderWebDavSettingsForm({
	document,
	host,
	repository,
	coordinator,
});
await Promise.resolve();
await Promise.resolve();
await new Promise<void>((resolve) => setTimeout(resolve, 0));

const categorySwitches = [...host.querySelectorAll<HTMLInputElement>(
	'.ldp-webdav-category-list input[type="checkbox"]',
)];
const interval = host.querySelector<HTMLSelectElement>(
	'.ldp-webdav-interval',
)!;
const offlineTopicSwitch = host.querySelector<HTMLInputElement>(
	'input[aria-label="同步离线 Topic 下载（HTML 正文）"]',
);
const notificationHistorySwitch = host.querySelector<HTMLInputElement>(
	'input[aria-label="同步通知历史缓存"]',
);
const activityHistorySwitch = host.querySelector<HTMLInputElement>(
	'input[aria-label="同步回复、Boost 与表情回应历史"]',
);
assert(
	categorySwitches.length === 12 &&
	categorySwitches.filter((input) => input.checked).length === 3 &&
	offlineTopicSwitch?.checked === false &&
	notificationHistorySwitch?.checked === false &&
	activityHistorySwitch?.checked === false &&
	interval.disabled &&
	host.textContent?.includes('通知与互动历史、离线 Topic HTML 和译文只在各自单独勾选后同步') &&
	host.textContent?.includes('不上传原始分页响应、请求游标或限流状态') &&
	host.textContent?.includes('不含私信、未读状态或原生通知 ID') &&
	host.textContent?.includes('单调合并') &&
	host.textContent?.includes('不为同步额外请求 Discourse') &&
	host.textContent?.includes('每个 Topic 以独立明文 HTML 文件存入你的 WebDAV') &&
	host.textContent?.includes('图片与附件仍保留原 URL') &&
	host.textContent?.includes('AI 翻译服务集合（Key 加密）') &&
	host.textContent?.includes('只加密每个 URL 对应的 API Key') &&
	host.textContent?.includes('离线 Topic 下载（HTML 正文）') &&
	host.textContent?.includes('立即同步'),
	`WebDAV 设置必须提供十二类独立开关、两类历史缓存、离线 Topic、加密翻译设置与译文缓存，并默认关闭定时同步：` +
		`switches=${categorySwitches.length}, offline=${String(
			offlineTopicSwitch?.checked,
		)}, checked=${
			categorySwitches.filter((input) => input.checked).length
		}, intervalDisabled=${String(interval.disabled)}, text=${host.textContent}`,
);

const inputs = [...host.querySelectorAll<HTMLInputElement>(
	'.ldp-webdav-field input',
)];
inputs[0]!.value = 'https://dav.example.test/dav/';
inputs[1]!.value = 'webdav-user';
inputs[2]!.value = 'application-password';
inputs[3]!.value = 'Reader/v2/state.json';
const auto = host.querySelector<HTMLInputElement>(
	'.ldp-setting-switch input[aria-label="启用定时同步"]',
)!;
auto.checked = true;
auto.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
for (const option of interval.options) {
	option.toggleAttribute('selected', option.value === '30');
}
host.querySelector<HTMLButtonElement>(
	'button[aria-label="保存 WebDAV 设置"]',
)!.click();
await Promise.resolve();
await Promise.resolve();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
assert(
	repository.snapshot.config.endpoint === 'https://dav.example.test/dav/' &&
	repository.snapshot.config.username === 'webdav-user' &&
	repository.snapshot.config.password === 'application-password' &&
	repository.snapshot.config.remotePath === 'Reader/v2/state.json' &&
	repository.snapshot.config.autoSyncEnabled &&
	repository.snapshot.config.autoSyncIntervalMinutes === 30 &&
	host.querySelector('.ldp-webdav-status')?.textContent
		?.includes('已保存'),
	`保存按钮必须持久化连接、远端路径和定时策略，且不能触发网络请求：${
		JSON.stringify(repository.snapshot.config)
		} status=${host.querySelector('.ldp-webdav-status')?.textContent}`,
);
assert(
	inputs[1]?.autocomplete === 'off' &&
	inputs[2]?.autocomplete === 'off' &&
	inputs[2]?.value === '' &&
	inputs[2]?.placeholder.includes('已保存') &&
	!host.innerHTML.includes('application-password'),
	'已保存 WebDAV 应用密码不得回填宿主 DOM 或声明为站点登录密码，用户名也不得触发账号自动填充',
);

inputs[0]!.value = 'https://unsaved-draft.example.test/dav/';
await repository.saveStatus(Object.freeze({
	kind: 'success',
	message: '仅更新同步状态',
	at: 1,
}));
assert(
	inputs[0]?.value === 'https://unsaved-draft.example.test/dav/',
	'只更新 WebDAV 同步状态时不得覆盖用户尚未保存的连接草稿',
);

const externallyApplied = normalizeReaderWebDavConfig({
	endpoint: 'https://dav-imported.example.test/dav/',
	username: 'imported-user',
	password: 'imported-application-password',
	remotePath: 'Imported/v2/sync.json',
	categories: createReaderWebDavCategorySelection({
		preferences: true,
		'offline-topics': true,
	}),
	autoSyncEnabled: false,
	autoSyncIntervalMinutes: 180,
});
await repository.saveConfig(externallyApplied);
assert(
	inputs[0]?.value === externallyApplied.endpoint &&
	inputs[1]?.value === externallyApplied.username &&
	inputs[2]?.value === '' &&
	inputs[3]?.value === externallyApplied.remotePath &&
	interval.value === '180' &&
	repository.snapshot.status.kind === 'idle' &&
	repository.snapshot.status.message.includes('尚未使用当前配置同步') &&
	host.querySelector<HTMLInputElement>(
		'input[aria-label="同步设置配置"]',
	)?.checked === true &&
	host.querySelector<HTMLInputElement>(
		'input[aria-label="同步离线 Topic 下载（HTML 正文）"]',
	)?.checked === true &&
	!host.innerHTML.includes('imported-application-password'),
	'设置导入或重置写入 canonical WebDAV 配置后，表单必须热投影非敏感字段、清除旧目标状态且不暴露密码',
);

host.querySelector<HTMLButtonElement>(
	'button[aria-label="保存 WebDAV 设置"]',
)!.click();
await settle();
assert(
	String(repository.snapshot.config.password) === 'imported-application-password',
	'同一 WebDAV 地址和用户名下留空保存必须复用脚本存储中的应用密码',
);

inputs[2]!.value = 'imported-application-password';
inputs[2]!.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
host.querySelector<HTMLButtonElement>(
	'button[aria-label="保存 WebDAV 设置"]',
)!.click();
await settle();
assert(
	String(repository.snapshot.config.password) ===
		'imported-application-password' &&
	inputs[2]?.value === '',
	'重复保存相同密码即使 canonical 配置未变化，也必须立即清除宿主 DOM 中的密码草稿',
);

inputs[0]!.value = 'https://dav-other.example.test/dav/';
host.querySelector<HTMLButtonElement>(
	'button[aria-label="保存 WebDAV 设置"]',
)!.click();
await settle();
assert(
	String(repository.snapshot.config.password) === '' &&
	!repository.snapshot.config.autoSyncEnabled,
	'切换 WebDAV 地址但未填写新密码时必须清除旧目标凭据，不能把旧密码带到新服务',
);

await repository.saveConfig(normalizeReaderWebDavConfig({
	...externallyApplied,
	autoSyncEnabled: true,
}));

form.destroy();
assert(!host.children.length, '销毁 WebDAV 表单必须清空唯一 DOM owner');

const actionStorage = new ControlledValueStorage();
actionStorage.value = structuredClone(stored);
actionStorage.blockNextRead = true;
const actionRepository = new ReaderWebDavConfigRepository({
	storage: actionStorage,
	createWriterId: () => 'settings-action-device',
});
let actionRequests = 0;
let blockActionRequest = false;
let releaseActionRequest: (() => void) | null = null;
const actionCoordinator = new ReaderWebDavCoordinator({
	client: new ReaderWebDavClient({
		request: (options) => {
			actionRequests += 1;
			if (blockActionRequest) {
				blockActionRequest = false;
				releaseActionRequest = () => options.onload({ status: 207 });
			} else {
				queueMicrotask(() => options.onload({ status: 207 }));
			}
			return { abort() {} };
		},
	}),
	repository: actionRepository,
	categories: [],
	hostname: () => 'linux.do',
	username: () => 'reader-account',
});
const actionForm = new ReaderWebDavSettingsForm({
	document,
	host,
	repository: actionRepository,
	coordinator: actionCoordinator,
});
await Promise.resolve();
await Promise.resolve();
const loadingControls = [...host.querySelectorAll<
	HTMLInputElement | HTMLSelectElement | HTMLButtonElement
>('input, select, button')];
assert(
	actionStorage.readBlocked &&
		loadingControls.every((control) => control.disabled) &&
		host.querySelector('.ldp-webdav-status')?.textContent?.includes(
			'正在读取 WebDAV 设置',
		),
	'WebDAV 设置未读取完成时必须锁定表单，避免空草稿覆盖已存配置',
);
actionStorage.releaseRead();
await settle();
const actionButtons = [...host.querySelectorAll<HTMLButtonElement>(
	'.ldp-webdav-actions button',
)];
const testButton = host.querySelector<HTMLButtonElement>(
	'button[aria-label="测试 WebDAV 连接"]',
)!;
const syncButton = host.querySelector<HTMLButtonElement>(
	'button[aria-label="立即执行 WebDAV 合并同步"]',
)!;
const saveButton = host.querySelector<HTMLButtonElement>(
	'button[aria-label="保存 WebDAV 设置"]',
)!;
host.querySelector<HTMLInputElement>(
	'input[aria-label="远端文件"]',
)!.value = 'Action/v2/sync.json';
actionStorage.blockNextWrite = true;
testButton.dispatchEvent(new parsedWindow.Event('click', { bubbles: true }));
syncButton.dispatchEvent(new parsedWindow.Event('click', { bubbles: true }));
await Promise.resolve();
await Promise.resolve();
assert(
	actionStorage.writeBlocked &&
		loadingControls.every((control) => control.disabled) &&
		actionButtons.every((button) => button.getAttribute('aria-busy') === 'true') &&
		actionRequests === 0,
	'测试连接保存草稿期间必须立即锁定整张表单，连续点击不得越过原子门禁',
);
actionStorage.releaseWrite();
await settle();
assert(
	Number(actionRequests) === 1 &&
		actionButtons.every((button) => !button.disabled) &&
		actionButtons.every((button) => button.getAttribute('aria-busy') === 'false') &&
		host.querySelector('.ldp-webdav-status')?.textContent?.includes('连接成功'),
	'草稿持久化后只能执行最先触发的一次 WebDAV 动作，并完整释放忙碌态',
);

blockActionRequest = true;
testButton.dispatchEvent(new parsedWindow.Event('click', { bubbles: true }));
await settle();
assert(releaseActionRequest !== null, '配置切换竞态必须先阻塞旧目标连接测试');
await actionRepository.saveConfig(normalizeReaderWebDavConfig({
	...actionRepository.snapshot.config,
	remotePath: 'Imported-during-test/v2/sync.json',
}));
(releaseActionRequest as (() => void))();
releaseActionRequest = null;
await settle();
assert(
	actionRepository.snapshot.config.remotePath ===
		'Imported-during-test/v2/sync.json' &&
	actionRepository.snapshot.status.kind === 'idle' &&
	host.querySelector('.ldp-webdav-status')?.textContent?.includes(
		'尚未使用当前配置同步',
	),
	'旧目标连接测试完成后不得把新导入配置标记为连接成功或旧目标错误',
);

const configBeforeFailure = actionRepository.snapshot.config;
host.querySelector<HTMLInputElement>(
	'input[aria-label="远端文件"]',
)!.value = 'Failure/v2/sync.json';
actionStorage.failNextWrite = new Error('WebDAV 本地设置写入失败');
saveButton.dispatchEvent(new parsedWindow.Event('click', { bubbles: true }));
await settle();
assert(
	actionRepository.snapshot.config === configBeforeFailure &&
		actionButtons.every((button) => !button.disabled) &&
		host.querySelector('.ldp-webdav-status')?.textContent?.includes(
			'WebDAV 本地设置写入失败',
		),
	'设置持久化失败必须保留上一份 canonical 快照、显示错误并释放动作门禁',
);

actionStorage.blockNextWrite = true;
testButton.dispatchEvent(new parsedWindow.Event('click', { bubbles: true }));
await Promise.resolve();
await Promise.resolve();
assert(actionStorage.writeBlocked, '销毁竞态必须先进入待提交的设置写入');
const requestsBeforeDestroy = actionRequests;
actionForm.destroy();
actionStorage.releaseWrite();
await settle();
assert(
	!host.children.length && actionRequests === requestsBeforeDestroy,
	'表单销毁后即使草稿写入完成，也不得继续启动 WebDAV 网络请求',
);

let signedIn = false;
const unavailableForm = new ReaderWebDavSettingsForm({
	document,
	host,
	repository,
	coordinator,
	unavailableReason: () => signedIn
		? ''
		: '当前未登录 Discourse，WebDAV 同步不可用。请先登录并刷新页面。',
});
await Promise.resolve();
await Promise.resolve();
await new Promise<void>((resolve) => setTimeout(resolve, 0));
const unavailableControls = [...host.querySelectorAll<
	HTMLInputElement | HTMLSelectElement | HTMLButtonElement
>('input, select, button')];
assert(
	unavailableControls.length > 0 &&
		unavailableControls.every((control) => control.disabled) &&
	host.querySelector('.ldp-webdav-status')?.textContent?.includes(
		'当前未登录 Discourse，WebDAV 同步不可用。请先登录并刷新页面。',
	),
	`未登录 Discourse 时必须禁用整个 WebDAV 表单并显示操作指引：controls=${
		unavailableControls.length
	}, enabled=${unavailableControls.filter((control) => !control.disabled).length}, ` +
		`status=${host.querySelector('.ldp-webdav-status')?.textContent}`,
);
signedIn = true;
unavailableForm.refreshAvailability();
const restoredControls = [...host.querySelectorAll<
	HTMLInputElement | HTMLSelectElement | HTMLButtonElement
>('input, select, button')];
assert(
	restoredControls.every((control) => !control.disabled) &&
	!host.querySelector('.ldp-webdav-status')?.textContent?.includes(
		'当前未登录 Discourse',
	),
	`Discourse 会话在启动后恢复时必须重新启用 WebDAV：disabled=${
		restoredControls.filter((control) => control.disabled).length
	}, status=${host.querySelector('.ldp-webdav-status')?.textContent}`,
);
signedIn = false;
unavailableForm.refreshAvailability();
assert(
	restoredControls.every((control) => control.disabled),
	'Discourse 会话退出后再次显示设置页时必须恢复 WebDAV 门禁',
);
unavailableForm.destroy();
assert(!host.children.length, '不可用 WebDAV 表单销毁后必须清空唯一 DOM owner');
