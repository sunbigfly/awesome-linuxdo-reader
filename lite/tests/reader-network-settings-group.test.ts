import { parseHTML } from 'linkedom';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import {
	createReaderNetworkSettingsGroup,
	READER_COMMUNITY_DOH_URL,
} from '../src/settings/reader-network-settings-group.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;
const scope = new LifecycleScope();
const copied: string[] = [];
let rejectCopy = false;
const group = createReaderNetworkSettingsGroup({
	document,
	scope,
	clipboard: {
		async copyText(value) {
			if (rejectCopy) throw new Error('clipboard denied');
			copied.push(value);
		},
	},
});
document.body.append(group);
const toggle = group.querySelector<HTMLButtonElement>('[data-network-toggle]')!;
const guide = group.querySelector<HTMLElement>('[data-network-guide]')!;
const doh = group.querySelector<HTMLInputElement>('[data-network-address="doh"]')!;
const browser = group.querySelector<HTMLSelectElement>('[data-network-browser]')!;
const browserAddress = group.querySelector<HTMLInputElement>(
	'[data-network-address="browser"]',
)!;
const status = group.querySelector<HTMLElement>('[data-network-status]')!;

function select(field: HTMLSelectElement, value: string): void {
	for (const option of field.querySelectorAll('option')) {
		option.selected = false;
	}
	field.querySelector<HTMLOptionElement>(`option[value="${value}"]`)!
		.selected = true;
	field.dispatchEvent(new window.Event('change', { bubbles: true }));
}

async function copy(key: string): Promise<void> {
	group.querySelector<HTMLButtonElement>(`[data-network-copy="${key}"]`)!
		.click();
	await Promise.resolve();
	await Promise.resolve();
}

assert(
	guide.hidden && toggle.getAttribute('aria-expanded') === 'false' &&
		toggle.getAttribute('aria-controls') === guide.id &&
		group.querySelector('.ldp-network-badge')?.textContent === '普通版' &&
		!group.querySelector('[data-network-plan]') && copied.length === 0,
	'DoH 默认应展示可复制的预置地址和折叠指引，而不是暗示已启用的联网开关',
);
toggle.click();
assert(
	!guide.hidden && toggle.getAttribute('aria-expanded') === 'true' &&
		group.querySelectorAll('.ldp-network-step').length === 3 && doh.readOnly &&
		doh.value === 'https://edge.1molchuan.top/linuxdo' &&
		doh.value === READER_COMMUNITY_DOH_URL &&
		group.textContent?.includes('需在浏览器设置中配置后生效') &&
		group.textContent?.includes('不能保证减少 CF 盾') &&
		guide.textContent?.includes('受管理，已停用') &&
		!guide.textContent?.includes('/plus'),
	'DoH 指引应展示三个操作步骤、浏览器生效条件和受管理限制，保留 CF 验证边界',
);
await copy('doh');
assert(
	copied[0] === READER_COMMUNITY_DOH_URL &&
		status.textContent === '已复制DoH 地址。',
	'复制 DoH 应只写入所选普通版地址并反馈结果',
);
for (const [id, url, step] of [
	['chrome', 'chrome://settings/security', '使用安全 DNS'],
	['edge', 'edge://settings/privacy', '安全性'],
	['firefox', 'about:preferences#privacy', '增强保护或最大保护'],
]) {
	select(browser, id!);
	assert(
		browserAddress.value === url && browserAddress.readOnly &&
			group.querySelector('[data-network-steps]')?.textContent?.includes(step!),
		`${id} 应显示对应浏览器的配置地址与步骤`,
	);
}
await copy('browser');
assert(
	copied[1] === 'about:preferences#privacy',
	'浏览器设置地址应可复制到地址栏，而不是作为普通网页链接打开',
);
rejectCopy = true;
await copy('doh');
assert(
	status.textContent?.includes('请手动复制上面的DoH 地址') &&
		doh.value === READER_COMMUNITY_DOH_URL &&
		!group.querySelector<HTMLButtonElement>('[data-network-copy="doh"]')!
			.disabled,
	'剪贴板不可用时应保留可手动复制的地址，并允许再次尝试',
);
toggle.click();
assert(
	guide.hidden && toggle.getAttribute('aria-expanded') === 'false' &&
		String(status.textContent) === '',
	'收起操作应同步折叠指引和 ARIA 状态',
);
scope.destroy();
toggle.click();
assert(guide.hidden, '销毁后应移除配置步骤监听器');

const pendingScope = new LifecycleScope();
let finishCopy: (() => void) | undefined;
const pendingGroup = createReaderNetworkSettingsGroup({
	document,
	scope: pendingScope,
	clipboard: {
		copyText: () => new Promise<void>((resolve) => { finishCopy = resolve; }),
	},
});
const pendingStatus = pendingGroup.querySelector<HTMLElement>('[data-network-status]')!;
pendingGroup.querySelector<HTMLButtonElement>('[data-network-copy="doh"]')!.click();
assert(finishCopy, '复制应开始一次剪贴板操作');
pendingScope.destroy();
finishCopy();
await Promise.resolve();
assert(pendingStatus.textContent === '', '销毁后异步复制结果不能更新已释放的界面');
