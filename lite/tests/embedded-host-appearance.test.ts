import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import {
	EmbeddedHostAppearanceController,
	type EmbeddedHostResolvedAppearance,
} from '../src/shell/embedded-host-appearance.js';
import { ReaderWorkspaceModel } from '../src/shell/reader-workspace.js';
import type { ReaderAppearanceProfile } from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const profile: ReaderAppearanceProfile = Object.freeze({
	accentColor: '#111111',
	accentColorDark: '#eeeeee',
	linkColor: '#222222',
	linkColorDark: '#dddddd',
	zebraColor: '#333333',
	zebraColorDark: '#cccccc',
	zebraRadius: 10,
	listZebraColor: '#f7f7f7',
	listZebraColorDark: '#242a31',
	structureColorsEnabled: true,
	replyLineColor: '#444444',
	replyLineColorDark: '#bbbbbb',
	replyLineWidth: 1,
	replyLineRadius: 15,
	quoteLineColor: '#555555',
	quoteLineColorDark: '#aaaaaa',
	quoteLineWidth: 0.5,
	dividerLineColor: '#123456',
	dividerLineColorDark: '#654321',
	dividerLineWidth: 2,
});
const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><div class="overlay"></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const pageRoot = document.documentElement;
const overlay = document.querySelector<HTMLElement>('.overlay')!;
const workspace = new ReaderWorkspaceModel({
	routeKind: 'list',
	requestedMode: 'embed-right',
	embedWidth: 600,
	viewportWidth: 1_440,
});
let appearance: EmbeddedHostResolvedAppearance = Object.freeze({
	profile,
	theme: 'light',
	defaultDividerLineColor: '#e5e5e5',
	defaultDividerLineWidth: 0.5,
});
const changes = new Signal<EmbeddedHostResolvedAppearance>();
const controller = new EmbeddedHostAppearanceController({
	workspace,
	pageRoot,
	overlay,
	readAppearance: () => appearance,
	appearanceChanges: changes,
	measureRowHeight: () => 88,
});
assert(
	pageRoot.style.getPropertyValue('--ldp-reader-host-min-width') === '680px' &&
	overlay.style.getPropertyValue('--ldp-reader-host-min-width') === '680px' &&
	pageRoot.style.getPropertyValue('--ldp-reader-native-row-height') === '88px' &&
	pageRoot.style.getPropertyValue('--ldp-reader-list-zebra-color') === '#f7f7f7' &&
	pageRoot.style.getPropertyValue('--ldp-divider-line-color') === '#123456' &&
	pageRoot.style.getPropertyValue('--ldp-divider-line-width') === '2px',
	'embedded appearance 必须投影单一 host width/row/color/divider 变量',
);

appearance = Object.freeze({
	profile: Object.freeze({
		...profile,
		structureColorsEnabled: false,
		dividerLineWidth: 0.5,
	}),
	theme: 'dark',
	defaultDividerLineColor: '#343b44',
	defaultDividerLineWidth: 0.5,
});
changes.emit(appearance);
assert(
	pageRoot.style.getPropertyValue('--ldp-reader-list-zebra-color') === '#242a31' &&
	pageRoot.classList.contains('ldp-structure-colors-disabled') &&
	!pageRoot.style.getPropertyValue('--ldp-divider-line-color') &&
	!pageRoot.style.getPropertyValue('--ldp-divider-line-width'),
	'主题/结构色变化必须只更新 resolved appearance 投影',
);

workspace.setRequestedMode('floating');
assert(
	!pageRoot.style.getPropertyValue('--ldp-reader-host-min-width') &&
	!overlay.style.getPropertyValue('--ldp-reader-native-row-height') &&
	!pageRoot.style.getPropertyValue('--ldp-reader-list-zebra-color') &&
	!pageRoot.classList.contains('ldp-structure-colors-disabled'),
	'离开 embedded 必须撤销全部宿主外观变量和 class',
);
controller.destroy();
