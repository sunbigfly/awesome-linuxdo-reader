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
const offlineTopicSwitch = host.querySelector<HTMLInputElement>(
	'input[aria-label="同步离线 Topic 下载（HTML 正文）"]',
);
assert(
	categorySwitches.length === 10 &&
	categorySwitches.filter((input) => input.checked).length === 3 &&
	offlineTopicSwitch?.checked === false &&
	interval.disabled &&
	host.textContent?.includes('离线 Topic HTML 和译文只在各自单独勾选后同步') &&
	host.textContent?.includes('每个 Topic 以独立明文 HTML 文件存入你的 WebDAV') &&
	host.textContent?.includes('图片与附件仍保留原 URL') &&
	host.textContent?.includes('AI 翻译服务集合（Key 加密）') &&
	host.textContent?.includes('只加密每个 URL 对应的 API Key') &&
	host.textContent?.includes('离线 Topic 下载（HTML 正文）') &&
	host.textContent?.includes('立即同步'),
	`WebDAV 设置必须提供十类独立开关、离线 Topic、加密翻译设置与译文缓存，并默认关闭定时同步：` +
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

form.destroy();
assert(!host.children.length, '销毁 WebDAV 表单必须清空唯一 DOM owner');

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
