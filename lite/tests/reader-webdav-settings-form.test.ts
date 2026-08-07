import { parseHTML } from 'linkedom';
import { ReaderWebDavSettingsForm } from
	'../src/settings/reader-webdav-settings-form.js';
import { ReaderWebDavClient } from '../src/sync/reader-webdav-client.js';
import { ReaderWebDavConfigRepository } from
	'../src/sync/reader-webdav-config-repository.js';
import { ReaderWebDavCoordinator } from
	'../src/sync/reader-webdav-coordinator.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
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
assert(
	categorySwitches.length === 7 &&
	categorySwitches.filter((input) => input.checked).length === 3 &&
	interval.disabled &&
	host.textContent?.includes('正文、图片、附件与页面缓存永不上传') &&
	host.textContent?.includes('立即同步'),
	`WebDAV 设置必须提供七类独立开关、默认关闭定时同步和明确不上载范围：` +
		`switches=${categorySwitches.length}, checked=${
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

form.destroy();
assert(!host.children.length, '销毁 WebDAV 表单必须清空唯一 DOM owner');
