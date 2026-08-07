import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import type { ReaderWorkspaceCoordinator } from '../src/shell/reader-workspace-coordinator.js';
import type {
	ReaderWindowSnapshot,
	ReaderWorkspaceMode,
} from '../src/shell/reader-workspace.js';
import { ReaderWindowSettingsForm } from '../src/settings/reader-window-settings-form.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const presentations = Object.freeze({
	floating: Object.freeze({
		mode: 'floating',
		floating: true,
		fullPage: false,
		embedded: false,
		side: '',
	}),
	fullpage: Object.freeze({
		mode: 'fullpage',
		floating: false,
		fullPage: true,
		embedded: false,
		side: '',
	}),
	'embed-right': Object.freeze({
		mode: 'embed-right',
		floating: false,
		fullPage: false,
		embedded: true,
		side: 'right',
	}),
} satisfies Readonly<Record<string, Readonly<{
	readonly mode: ReaderWorkspaceMode;
	readonly floating: boolean;
	readonly fullPage: boolean;
	readonly embedded: boolean;
	readonly side: '' | 'left' | 'right';
}>>>);

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body><section id="settings"></section></body></html>',
);
const document = parsedDocument as unknown as Document;
const host = document.querySelector<HTMLElement>('#settings')!;
const changes = new Signal<ReaderWindowSnapshot>();
let snapshot: ReaderWindowSnapshot = Object.freeze({
	geometry: Object.freeze({ width: 1_080, height: 774, left: 180, top: 63 }),
	viewportWidth: 1_440,
	viewportHeight: 900,
	presentation: presentations.floating,
	managed: true,
	locked: false,
	pinned: false,
	isDefault: true,
});
const windowPort = {
	changes,
	get snapshot(): ReaderWindowSnapshot {
		return snapshot;
	},
};
const geometryCalls: number[][] = [];
let resetCalls = 0;
const commit = (patch: Partial<ReaderWindowSnapshot>): void => {
	snapshot = Object.freeze({ ...snapshot, ...patch });
	changes.emit(snapshot);
};
const workspace = {
	window: windowPort,
	setWindowGeometry(width: number, height: number, left: number, top: number) {
		geometryCalls.push([width, height, left, top]);
		commit({
			geometry: Object.freeze({ width, height, left, top }),
			isDefault: false,
		});
	},
	setWindowPinned(pinned: boolean) {
		commit({ pinned, isDefault: false });
	},
	setWindowLocked(locked: boolean) {
		commit({ locked, isDefault: false });
	},
	resetWindow() {
		resetCalls += 1;
		commit({
			geometry: Object.freeze({
				width: 1_080,
				height: 774,
				left: 180,
				top: 63,
			}),
			locked: false,
			pinned: false,
			isDefault: true,
		});
	},
} as unknown as ReaderWorkspaceCoordinator;

const form = new ReaderWindowSettingsForm({ document, host, workspace });
const fields = [...host.querySelectorAll<HTMLElement>('.ldp-reader-window-field')];
const reset = host.querySelector<HTMLButtonElement>('.ldp-reader-window-reset')!;
const status = host.querySelector<HTMLElement>('.ldp-reader-window-status')!;
const pinned = host.querySelector<HTMLInputElement>('.ldp-reader-window-pin-input')!;
const locked = host.querySelector<HTMLInputElement>('.ldp-reader-window-lock-input')!;
assert(
	fields.length === 4 &&
	fields.every((field) =>
		field.children.length === 2 &&
		field.children[0]?.tagName === 'SPAN' &&
	field.children[1]?.classList.contains('ldp-reader-window-input-wrap')) &&
	host.querySelectorAll('.ldp-reader-window-option').length === 2 &&
	host.querySelectorAll(
		'.ldp-reader-window-option .ldp-setting-switch > input',
	).length === 2 &&
	pinned.role === 'switch' &&
	locked.role === 'switch' &&
	fields.map((field) => field.firstElementChild?.textContent).join('|') ===
		'浮窗宽度（最小 360px）|浮窗高度（最小 320px）|距浏览器左侧|距浏览器顶部',
	'浮窗设置必须保持主线 2×2 字段语义和两项共享滑动开关入口',
);
assert(
	String(status.textContent) === '1080 × 774 · (180, 63) · 可拖动缩放' &&
	reset.disabled,
	'默认浮窗必须显示完整主线状态，并禁用无作用的恢复默认按钮',
);

const width = host.querySelector<HTMLInputElement>('.ldp-reader-window-width')!;
width.value = '900';
width.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(
	geometryCalls.at(-1)?.join(',') === '900,774,180,63' &&
	!reset.disabled,
	'数字字段必须把四项值交给唯一 Workspace owner，非默认后启用恢复按钮',
);
pinned.checked = true;
pinned.dispatchEvent(new window.Event('change', { bubbles: true }));
locked.checked = true;
locked.dispatchEvent(new window.Event('change', { bubbles: true }));
assert(
	String(status.textContent) ===
		'900 × 774 · (180, 63) · 保持显示 · 已锁定',
	'状态必须同步固定与锁定，锁定后不再显示可拖动缩放',
);

commit({
	presentation: presentations.fullpage,
	managed: false,
});
assert(
	String(status.textContent) ===
		'当前为全屏阅读；以下配置将在切换到浮窗后生效。浮窗：900 × 774 · (180, 63) · 保持显示 · 已锁定',
	'非浮窗形态必须保留主线形态提示和完整已保存状态',
);
commit({
	viewportWidth: 700,
	viewportHeight: 800,
});
assert(
	[...host.querySelectorAll<HTMLInputElement>('input')].every((input) =>
		input.disabled) &&
	reset.disabled &&
	String(status.textContent) ===
		'当前视口较窄，阅读器使用同一套窄屏响应式布局。',
	'700px 及以下必须禁用全部浮窗编辑与恢复，并显示主线窄屏提示',
);

commit({
	viewportWidth: 1_440,
	viewportHeight: 900,
	presentation: presentations['embed-right'],
	managed: false,
});
reset.dispatchEvent(new window.Event('click', { bubbles: true }));
assert(
	resetCalls === 1 && reset.disabled && snapshot.isDefault,
	'恢复默认必须只调用 Workspace reset，并在 canonical 默认状态回声后禁用',
);
form.destroy();
assert(!host.childElementCount, '销毁浮窗设置必须清空自身 DOM 和订阅');
