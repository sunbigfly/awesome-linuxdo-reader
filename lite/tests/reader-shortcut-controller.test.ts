import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderShortcutController,
	readerShortcutBindingIssue,
	readerShortcutBindingLabel,
} from '../src/shell/reader-shortcut-controller.js';
import { ReaderShortcutSettingsForm } from '../src/settings/reader-shortcut-settings-form.js';
import {
	normalizeReaderShortcutBindings,
	type ReaderShortcutAction,
	type ReaderShortcutBindings,
} from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function eventWith(
	window: Window,
	type: string,
	properties: Readonly<Record<string, unknown>> = {},
): Event {
	const EventConstructor = (
		window as unknown as { Event: typeof Event }
	).Event;
	const event = new EventConstructor(type, {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperties(
		event,
		Object.fromEntries(
			Object.entries(properties).map(([name, value]) => [
				name,
				{ value, configurable: true },
			]),
		),
	);
	return event;
}

interface ShortcutPreferences {
	readonly bindings: ReaderShortcutBindings;
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main id="surface" tabindex="-1">阅读器</main><button id="control">控件</button><input id="editor"><main id="settings"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
const surface = document.querySelector<HTMLElement>('#surface')!;
const control = document.querySelector<HTMLButtonElement>('#control')!;
const editor = document.querySelector<HTMLInputElement>('#editor')!;
const settingsHost = document.querySelector<HTMLElement>('#settings')!;
const preferenceChanges = new Signal<Readonly<ShortcutPreferences>>();
let preferences: Readonly<ShortcutPreferences> = Object.freeze({
	bindings: normalizeReaderShortcutBindings(undefined),
});
const executed: ReaderShortcutAction[] = [];
let closeReaderBlocked = true;
let allActionsBlocked = false;
let unavailableAction: ReaderShortcutAction | null = null;
let unavailableMessage = '';
const controller = new ReaderShortcutController<ShortcutPreferences>({
	target: document,
	preferences: {
		read: (value) => value.bindings,
		createPatch: (bindings) => ({ bindings }),
	},
	readPreferences: () => preferences,
	preferenceChanges,
	persist(patch) {
		preferences = Object.freeze({
			...preferences,
			...patch,
		});
		preferenceChanges.emit(preferences);
		return preferences;
	},
	execute(action) {
		executed.push(action);
		return action !== unavailableAction;
	},
	canExecute: (action) => !allActionsBlocked &&
		(action !== 'closeReader' || !closeReaderBlocked),
	onUnavailable: (_action, label) => {
		unavailableMessage = `“${label}”当前不可用`;
	},
});

const back = eventWith(window, 'keydown', { code: 'ArrowLeft' });
surface.dispatchEvent(back);
assert(
	executed.at(-1) === 'historyBack' && back.defaultPrevented,
	'默认快捷键必须由唯一 controller 执行动作并消费页面事件',
);
const blockedEscape = eventWith(window, 'keydown', { code: 'Escape' });
surface.dispatchEvent(blockedEscape);
assert(
	executed.at(-1) === 'historyBack' && !blockedEscape.defaultPrevented,
	'更高层 surface 开放时，快捷键 owner 不得抢先执行 Reader 退出',
);
closeReaderBlocked = false;
const acceptedEscape = eventWith(window, 'keydown', { code: 'Escape' });
surface.dispatchEvent(acceptedEscape);
assert(
	executed.at(-1) === 'closeReader' && acceptedEscape.defaultPrevented,
	'更高层 surface 释放后，Reader 退出快捷键必须恢复唯一执行路径',
);
const beforeEditable = executed.length;
editor.dispatchEvent(eventWith(window, 'keydown', { code: 'ArrowRight' }));
assert(
	executed.length === beforeEditable,
	'输入框、文本域、选择框和 contenteditable 内不得拦截阅读器快捷键',
);
control.dispatchEvent(eventWith(window, 'keydown', { code: 'ArrowRight' }));
assert(
	executed.length === beforeEditable,
	'按钮、链接、菜单项、滑杆、标签页和对话框内的键盘交互不得被全局快捷键抢占',
);
allActionsBlocked = true;
const blockedHome = eventWith(window, 'keydown', { code: 'Home' });
const blockedMouseDown = eventWith(window, 'mousedown', { button: 4 });
surface.dispatchEvent(blockedHome);
surface.dispatchEvent(blockedMouseDown);
assert(
	executed.length === beforeEditable &&
		!blockedHome.defaultPrevented &&
		blockedMouseDown.defaultPrevented,
	'高层上下文必须让键盘交给 surface，并消费会触发浏览器导航的已绑定鼠标事件',
);
allActionsBlocked = false;

const form = new ReaderShortcutSettingsForm({
	document,
	host: settingsHost,
	shortcuts: controller,
});
assert(
	settingsHost.querySelectorAll('[data-shortcut-action]').length === 21 &&
		settingsHost.querySelectorAll('.ldp-other-setting-group').length === 5 &&
		[...settingsHost.querySelectorAll(
			'.ldp-other-setting-group-head strong',
		)].map((node) => node.textContent).join('|') ===
			'浏览导航|阅读工具|界面面板|帖子操作|窗口与队列' &&
		settingsHost.querySelector(
			'[data-shortcut-action="settings"] [data-shortcut-binding="Ctrl+Comma"]',
		),
	'快捷键设置必须按 main 的五组顺序完整投影 21 项动作和规范化后的当前绑定',
);
settingsHost.querySelector<HTMLButtonElement>(
	'[data-shortcut-record="translate"]',
)!.click();
const recorded = eventWith(window, 'keydown', {
	code: 'KeyK',
	ctrlKey: true,
});
surface.dispatchEvent(recorded);
assert(
	preferences.bindings.translate.includes('Ctrl+KeyK') &&
		controller.snapshot.recording === null &&
		recorded.defaultPrevented,
	'录制成功必须立即写入唯一偏好端口、退出录制并消费原始事件',
);

let captureMessage = '';
controller.captures.subscribe((capture) => {
	captureMessage = capture.message;
});
controller.startRecording('onlyAuthor');
surface.dispatchEvent(eventWith(window, 'keydown', {
	code: 'KeyK',
	ctrlKey: true,
}));
assert(
	controller.snapshot.recording === 'onlyAuthor' &&
		captureMessage.includes('切换正文翻译') &&
		!preferences.bindings.onlyAuthor.length,
	'重复绑定必须指出原 owner，且不能覆盖或退出当前录制',
);
surface.dispatchEvent(eventWith(window, 'keydown', {
	code: 'KeyW',
	ctrlKey: true,
}));
assert(
	captureMessage.includes('浏览器占用') &&
		controller.snapshot.recording === 'onlyAuthor',
	'浏览器保留快捷键必须拒绝写入并继续等待有效组合',
);
surface.dispatchEvent(eventWith(window, 'keydown', {
	code: 'KeyO',
	ctrlKey: true,
}));
assert(
	captureMessage.includes('浏览器占用') &&
		controller.snapshot.recording === 'onlyAuthor',
	'main 明确保留的 Ctrl+O 也必须拒绝，不能被旧 Lite 测试锁成有效组合',
);
surface.dispatchEvent(eventWith(window, 'keydown', {
	code: 'KeyO',
	ctrlKey: true,
	shiftKey: true,
}));
assert(
	preferences.bindings.onlyAuthor.includes('Ctrl+Shift+KeyO'),
	'未被浏览器保留的有效替代组合必须在拒绝后仍能完成同一录制事务',
);

const horizontal = eventWith(window, 'wheel', {
	shiftKey: true,
	deltaY: 80,
});
const vertical = eventWith(window, 'wheel', {
	deltaY: 80,
});
surface.dispatchEvent(vertical);
assert(
	!vertical.defaultPrevented &&
		executed.at(-1) !== 'discussionHorizontalScroll',
	'无修饰键滚轮必须始终保留给正文纵向滚动，不能被旧快捷键配置吞掉',
);
unavailableAction = 'topicTop';
const unavailableHome = eventWith(window, 'keydown', { code: 'Home' });
surface.dispatchEvent(unavailableHome);
assert(
	unavailableHome.defaultPrevented &&
		unavailableMessage === '“回到帖子开头”当前不可用',
	'已识别但当前不可用的普通动作必须消费原事件并投影明确反馈',
);
unavailableAction = 'discussionHorizontalScroll';
const unavailableHorizontal = eventWith(window, 'wheel', {
	shiftKey: true,
	deltaY: 80,
});
surface.dispatchEvent(unavailableHorizontal);
assert(
	!unavailableHorizontal.defaultPrevented,
	'完整讨论没有可横向滚动区域时必须放行原滚轮，不能套用普通 unavailable 消费语义',
);
unavailableAction = null;
surface.dispatchEvent(horizontal);
assert(
	executed.at(-1) === 'discussionHorizontalScroll' &&
		horizontal.defaultPrevented,
	'Shift+Wheel 必须进入完整讨论横向浏览动作，并保留可取消默认滚动的监听契约',
);

const beforeMouseHistory = executed.length;
const mouseDown = eventWith(window, 'mousedown', { button: 3 });
const mouseUp = eventWith(window, 'mouseup', { button: 3 });
const auxClick = eventWith(window, 'auxclick', { button: 3 });
surface.dispatchEvent(mouseDown);
surface.dispatchEvent(mouseUp);
surface.dispatchEvent(auxClick);
assert(
	executed.length === beforeMouseHistory + 1 &&
		executed.at(-1) === 'historyBack' &&
		mouseDown.defaultPrevented &&
		mouseUp.defaultPrevented &&
		auxClick.defaultPrevented,
	'侧键必须在 mousedown 捕获阶段执行一次，并用同一 guard 消费后续 mouseup/auxclick',
);

preferences = Object.freeze({
	bindings: normalizeReaderShortcutBindings({
		...preferences.bindings,
		topicTop: ['Ctrl+Home'],
	}),
});
preferenceChanges.emit(preferences);
assert(
	controller.snapshot.bindings.topicTop[0] === 'Ctrl+Home' &&
		settingsHost.querySelector(
			'[data-shortcut-action="topicTop"] [data-shortcut-binding="Ctrl+Home"]',
		),
	'外部偏好热更新必须原地同步 controller 与设置 DOM，不能维护第二份绑定状态',
);
assert(
	readerShortcutBindingIssue(
		preferences.bindings,
		'Ctrl+Shift+KeyO',
		'translate',
	).includes('只看楼主') &&
		readerShortcutBindingLabel('Shift+Wheel') === 'Shift + 滚轮',
	'冲突诊断与展示名称必须复用同一规范化词典',
);

form.destroy();
controller.destroy();
assert(
	!settingsHost.children.length,
	'销毁快捷键设置必须移除其 DOM，并释放唯一 controller 监听',
);
