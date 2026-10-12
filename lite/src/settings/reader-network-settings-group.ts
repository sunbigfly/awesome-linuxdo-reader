import type { LifecycleScope } from '../kernel/lifecycle.js';
import type { ReaderShareSurfacePort } from
	'../post/reader-share-action-coordinator.js';
import { BrowserReaderShareSurface } from
	'../userscript/browser-share-surface.js';
import {
	settingsButton,
	settingsCopy,
	settingsElement as element,
	settingsIcon,
	settingsOption,
} from './reader-settings-dom.js';

export const READER_COMMUNITY_DOH_URL = 'https://edge.1molchuan.top/linuxdo';

let nextGuideId = 0;

const browserGuides = Object.freeze([
	{
		id: 'chrome',
		name: 'Chrome / Chromium',
		url: 'chrome://settings/security',
		steps: '开启“使用安全 DNS”，选择自定义提供商，粘贴上方 DoH 地址并保存。',
	},
	{
		id: 'edge',
		name: 'Microsoft Edge',
		url: 'edge://settings/privacy',
		steps: '在“安全性”中开启安全 DNS，选择自定义服务提供商，粘贴上方 DoH 地址并保存。',
	},
	{
		id: 'firefox',
		name: 'Firefox',
		url: 'about:preferences#privacy',
		steps: '在“基于 HTTPS 的 DNS”中选择增强保护或最大保护，再选择自定义提供商，粘贴上方 DoH 地址并保存。',
	},
]);

/** 浏览器配置辅助卡片；展开步骤与复制地址均不改变浏览器 DNS。 */
export function createReaderNetworkSettingsGroup(options: Readonly<{
	readonly document: Document;
	readonly scope: LifecycleScope;
	readonly clipboard?: Pick<ReaderShareSurfacePort, 'copyText'>;
}>): HTMLElement {
	const { document, scope } = options;
	const clipboard = options.clipboard ??
		new BrowserReaderShareSurface(document.defaultView);
	const group = element(document, 'section', 'ldp-settings-category-group');
	group.dataset.settingsCategory = 'performance-network';
	const head = element(document, 'div', 'ldp-settings-category-head');
	head.append(settingsCopy(
		document,
		'ldp-network-heading',
		'浏览器 DoH 配置',
		'需在浏览器设置中配置后生效，作用于整个浏览器的联网。',
	));
	const content = element(document, 'div', 'ldp-network-content');
	const preset = element(document, 'div', 'ldp-network-preset');
	const icon = element(document, 'span', 'ldp-network-preset-icon');
	icon.append(settingsIcon(document, 'link'));
	const name = element(document, 'strong', 'ldp-network-preset-name');
	name.textContent = '一摩尔氚 DoH';
	const badge = element(document, 'span', 'ldp-network-badge');
	badge.textContent = '普通版';
	preset.append(icon, name, badge);
	content.append(preset);

	const status = element(document, 'small', 'ldp-network-status');
	status.dataset.networkStatus = '';
	status.setAttribute('role', 'status');
	status.setAttribute('aria-live', 'polite');

	const addressControl = (
		host: HTMLElement,
		label: string,
		value: string,
		key: string,
	): HTMLInputElement => {
		const row = element(document, 'div', 'ldp-network-address-controls');
		const input = element(document, 'input', 'ldp-network-input');
		input.type = 'text';
		input.readOnly = true;
		input.value = value;
		input.setAttribute('aria-label', label);
		input.dataset.networkAddress = key;
		const copy = settingsButton(
			document, 'ldp-network-copy', '复制' + label, 'copy', '复制地址',
		);
		copy.dataset.networkCopy = key;
		scope.listen(copy, 'click', () => {
			if (copy.disabled || scope.destroyed) return;
			copy.disabled = true;
			status.textContent = '';
			void (async () => {
				try {
					await clipboard.copyText(input.value);
					if (!scope.destroyed) status.textContent = '已复制' + label + '。';
				} catch {
					if (scope.destroyed) return;
					input.focus();
					input.select?.();
					status.textContent = '自动复制不可用，请手动复制上面的' + label + '。';
				} finally {
					if (!scope.destroyed) copy.disabled = false;
				}
			})();
		});
		row.append(input, copy);
		host.append(row);
		return input;
	};
	addressControl(content, 'DoH 地址', READER_COMMUNITY_DOH_URL, 'doh');

	const toolbar = element(document, 'div', 'ldp-network-toolbar');
	const toggle = settingsButton(
		document, 'ldp-network-toggle', '查看浏览器 DoH 配置步骤',
		'chevron-down', '查看配置步骤',
	);
	toggle.dataset.networkToggle = '';
	toggle.setAttribute('aria-expanded', 'false');
	const source = element(document, 'a', 'ldp-network-source');
	source.href = 'https://linux.do/t/2946664';
	source.target = '_blank';
	source.rel = 'noopener noreferrer';
	source.textContent = '服务说明';
	source.append(settingsIcon(document, 'external-link'));
	toolbar.append(toggle, source);

	const guide = element(document, 'div', 'ldp-network-guide');
	guide.id = 'ldp-network-guide-' + ++nextGuideId;
	guide.dataset.networkGuide = '';
	guide.hidden = true;
	toggle.setAttribute('aria-controls', guide.id);
	const browserRow = element(document, 'label', 'ldp-network-browser-row');
	const browserLabel = element(document, 'span', 'ldp-network-browser-label');
	browserLabel.textContent = '你使用的浏览器';
	const browser = element(document, 'select', 'ldp-reader-select ldp-network-browser');
	browser.setAttribute('aria-label', '配置 DoH 的浏览器');
	browser.dataset.networkBrowser = '';
	const userAgent = document.defaultView?.navigator.userAgent ?? '';
	const browserId = /\bEdg\//.test(userAgent) ? 'edge' :
		/\bFirefox\//.test(userAgent) ? 'firefox' : 'chrome';
	for (const item of browserGuides) {
		const option = settingsOption(document, item.id, item.name);
		option.selected = item.id === browserId;
		browser.append(option);
	}
	browserRow.append(browserLabel, browser);
	guide.append(browserRow);
	const steps = element(document, 'ol', 'ldp-network-steps');
	const step = (title: string, description: string): HTMLElement => {
		const item = element(document, 'li', 'ldp-network-step');
		item.dataset.networkStep = String(steps.children.length + 1);
		const body = element(document, 'div', 'ldp-network-step-body');
		const heading = element(document, 'strong', 'ldp-network-step-title');
		heading.textContent = title;
		const copy = element(document, 'p', 'ldp-network-step-copy');
		copy.textContent = description;
		body.append(heading, copy);
		item.append(body);
		steps.append(item);
		return body;
	};
	step('复制 DoH 地址', '点击上方“复制地址”，用于填写自定义 DNS 提供商。');
	const browserStep = step('打开浏览器设置', '复制下面的设置地址，粘贴到浏览器地址栏打开。');
	const settingsAddress = addressControl(browserStep, '浏览器设置地址', '', 'browser');
	const saveStep = step('启用安全 DNS 并保存', '');
	const instructions = saveStep.querySelector<HTMLElement>('.ldp-network-step-copy')!;
	instructions.dataset.networkSteps = '';
	const refresh = element(document, 'p', 'ldp-network-step-copy');
	refresh.textContent = '保存后刷新论坛，阅读器继续使用原站登录会话。';
	saveStep.append(refresh);
	const managed = element(document, 'p', 'ldp-network-managed-note');
	managed.textContent = '如果浏览器提示“受管理，已停用”，需先检查浏览器管理策略；阅读器无法解除这个限制。';
	guide.append(steps, managed);

	const note = element(document, 'p', 'ldp-network-note');
	note.textContent = 'DoH / ECH 是网络辅助方案，不能保证减少 CF 盾或免除站点验证。';
	const renderBrowser = (): void => {
		const selected = browserGuides.find((item) => item.id === browser.value) ??
			browserGuides[0]!;
		settingsAddress.value = selected.url;
		instructions.textContent = selected.steps;
		status.textContent = '';
	};
	scope.listen(browser, 'change', renderBrowser);
	scope.listen(toggle, 'click', () => {
		guide.hidden = !guide.hidden;
		toggle.setAttribute('aria-expanded', String(!guide.hidden));
		const text = toggle.querySelector('span')!;
		text.textContent = guide.hidden ? '查看配置步骤' : '收起配置步骤';
		status.textContent = '';
	});
	renderBrowser();
	content.append(toolbar, status, guide, note);
	group.append(head, content);
	return group;
}
