import { parseHTML } from 'linkedom';
import {
	READER_MANUAL_URL,
	ReaderAboutSettingsContent,
} from '../src/settings/reader-about-settings-content.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document } = parseHTML(
	'<html><body><div id="about"></div></body></html>',
);
const host = document.querySelector<HTMLElement>('#about')!;
const content = new ReaderAboutSettingsContent({
	document,
	host,
	version: '0.1.16',
	logoUrl: 'https://linux.do/logo.png',
	brandName: 'Awesome LinuxDo Reader',
});
const manual = host.querySelector<HTMLAnchorElement>('.ldp-about-link');
assert(
	host.querySelectorAll('.ldp-about-content').length === 1 &&
	host.querySelector('.ldp-about-version')?.textContent === 'v0.1.16' &&
	host.querySelector('.ldp-about-logo')?.getAttribute('src') ===
		'https://linux.do/logo.png' &&
	host.querySelectorAll('.ldp-about-feature').length === 4 &&
	[...host.querySelectorAll('.ldp-about-feature')].every(
		(feature) => feature.children.length === 2,
	),
	'关于内容必须复用唯一 panel host，并保留旧版身份、版本与四项能力结构',
);
assert(
	manual?.href === READER_MANUAL_URL &&
	manual.target === '_blank' &&
	manual.rel.includes('noopener') &&
	manual.textContent.includes('在线用户手册'),
	'在线用户手册必须保持独立网页、原生新标签 anchor 与 opener 隔离',
);
assert(
	manual.querySelector('svg[data-icon="list-checks"]') !== null &&
	manual.querySelector('svg[data-icon="external-link"]') !== null &&
	[...host.querySelectorAll('.ldp-about-feature')].every(
		(feature) => feature.querySelector('svg[data-ldp-reader-icon]') !== null,
	),
	'关于面板的手册入口和四项能力必须使用可见的本地图标',
);
assert(
	host.querySelectorAll('.ldp-about-credits a').length === 3,
	'既有开源参考和许可链接必须完整保留',
);
content.destroy();
assert(
	host.childElementCount === 0,
	'About owner 销毁时必须只移除自己挂载的内容',
);

let emptyVersionRejected = false;
try {
	new ReaderAboutSettingsContent({
		document,
		host,
		version: ' ',
	});
} catch (error) {
	emptyVersionRejected =
		error instanceof Error &&
		error.message.includes('version');
}
assert(emptyVersionRejected, '版本为空时必须显式拒绝');
