import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import { eventElement } from '../dom/event-target.js';
import { Signal } from '../kernel/signal.js';
import {
	READER_SHORTCUT_ACTIONS,
	READER_SHORTCUT_DEFAULTS,
	normalizeReaderShortcutBinding,
	normalizeReaderShortcutBindings,
	type ReaderPreferences,
	type ReaderShortcutAction,
	type ReaderShortcutBindings,
} from '../state/reader-preferences-schema.js';

export interface ReaderShortcutPreferencesAdapter<
	TPreferences extends object,
> {
	read(preferences: Readonly<TPreferences>): ReaderShortcutBindings;
	createPatch(bindings: ReaderShortcutBindings): Partial<TPreferences>;
}

export const readerPreferencesShortcutAdapter:
ReaderShortcutPreferencesAdapter<ReaderPreferences> = Object.freeze({
	read: (preferences: Readonly<ReaderPreferences>) =>
		preferences.readerShortcutBindings,
	createPatch: (readerShortcutBindings: ReaderShortcutBindings) => ({
		readerShortcutBindings,
	}),
});

export interface ReaderShortcutActionDefinition {
	readonly id: ReaderShortcutAction;
	readonly label: string;
	readonly description: string;
}

export interface ReaderShortcutGroupDefinition {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly actions: readonly ReaderShortcutActionDefinition[];
}

const definitions = Object.freeze<
	Readonly<Record<ReaderShortcutAction, Readonly<{
		readonly group:
			| 'navigation'
			| 'reading'
			| 'panels'
			| 'topicActions'
			| 'window';
		readonly label: string;
		readonly description: string;
	}>>>
>({
	historyBack: Object.freeze({
		group: 'navigation',
		label: '上一条阅读历史',
		description: '切换到上一条帖子并保存当前位置。',
	}),
	historyForward: Object.freeze({
		group: 'navigation',
		label: '下一条阅读历史',
		description: '切换到下一条帖子并恢复阅读位置。',
	}),
	topicTop: Object.freeze({
		group: 'navigation',
		label: '回到帖子开头',
		description: '跳到主楼。',
	}),
	topicBottom: Object.freeze({
		group: 'navigation',
		label: '跳到帖子末尾',
		description: '跳到当前帖子最后可见楼层。',
	}),
	floorJump: Object.freeze({
		group: 'navigation',
		label: '跳到指定楼层',
		description: '打开楼层号输入框。',
	}),
	discussionHorizontalScroll: Object.freeze({
		group: 'navigation',
		label: '完整讨论横向滚动',
		description: '树状层级超出宽度时，按滚轮方向左右查看。',
	}),
	onlyAuthor: Object.freeze({
		group: 'reading',
		label: '只看楼主',
		description: '切换只看楼主模式。',
	}),
	translate: Object.freeze({
		group: 'reading',
		label: '切换正文翻译',
		description: '在原文、双语和译文之间切换。',
	}),
	refreshTopic: Object.freeze({
		group: 'reading',
		label: '刷新当前帖子',
		description: '清除当前帖子缓存并重新加载。',
	}),
	refreshHost: Object.freeze({
		group: 'reading',
		label: '刷新嵌入原站',
		description: '嵌入阅读时刷新后方的原站列表。',
	}),
	openOriginal: Object.freeze({
		group: 'reading',
		label: '打开原帖',
		description: '在新标签页打开原站帖子。',
	}),
	settings: Object.freeze({
		group: 'panels',
		label: '设置',
		description: '打开设置面板。',
	}),
	notifications: Object.freeze({
		group: 'panels',
		label: '消息',
		description: '打开或关闭通知与私信面板。',
	}),
	historyPanel: Object.freeze({
		group: 'panels',
		label: '浏览历史面板',
		description: '打开或关闭浏览历史列表。',
	}),
	bookmarksPanel: Object.freeze({
		group: 'panels',
		label: '收藏与回应面板',
		description: '打开或关闭收藏与回应列表。',
	}),
	likeTopic: Object.freeze({
		group: 'topicActions',
		label: '点赞主帖',
		description: '点赞或取消点赞当前主帖。',
	}),
	replyTopic: Object.freeze({
		group: 'topicActions',
		label: '回复主题',
		description: '打开当前主题的回复编辑器。',
	}),
	bookmarkTopic: Object.freeze({
		group: 'topicActions',
		label: '收藏主题',
		description: '收藏或编辑当前主题收藏。',
	}),
	toggleFullscreen: Object.freeze({
		group: 'window',
		label: '全屏／浮窗切换',
		description: '在全屏阅读与浮窗阅读之间切换。',
	}),
	toggleQueue: Object.freeze({
		group: 'window',
		label: '阅读队列',
		description: '展开或收起阅读队列。',
	}),
	closeReader: Object.freeze({
		group: 'window',
		label: '关闭阅读器',
		description: '遵循“连续两次关闭”安全设置退出阅读器。',
	}),
});

const groupCopy = Object.freeze({
	navigation: Object.freeze({
		title: '浏览导航',
		description: '在阅读历史和当前帖子的关键位置之间移动。',
	}),
	reading: Object.freeze({
		title: '阅读工具',
		description: '切换阅读过滤、翻译和内容刷新。',
	}),
	panels: Object.freeze({
		title: '界面面板',
		description: '快速打开阅读器里的常用信息面板。',
	}),
	topicActions: Object.freeze({
		title: '帖子操作',
		description: '复用主帖操作列，不复制点赞、回复或收藏逻辑。',
	}),
	window: Object.freeze({
		title: '窗口与队列',
		description: '控制阅读器窗口、阅读队列与退出。',
	}),
});

export const READER_SHORTCUT_GROUPS = Object.freeze(
	(Object.keys(groupCopy) as (keyof typeof groupCopy)[]).map((group) =>
		Object.freeze({
			id: group,
			...groupCopy[group],
			actions: Object.freeze(READER_SHORTCUT_ACTIONS
				.filter((id) => definitions[id].group === group)
				.map((id) => Object.freeze({
					id,
					label: definitions[id].label,
					description: definitions[id].description,
				}))),
		}),
	),
);

export interface ReaderShortcutCapture {
	readonly action: ReaderShortcutAction;
	readonly binding: string;
	readonly accepted: boolean;
	readonly message: string;
}

export interface ReaderShortcutSnapshot {
	readonly bindings: ReaderShortcutBindings;
	readonly recording: ReaderShortcutAction | null;
}

export interface ReaderShortcutControllerOptions<
	TPreferences extends object,
> {
	readonly target: EventTarget;
	readonly preferences: ReaderShortcutPreferencesAdapter<TPreferences>;
	readonly readPreferences: () => Readonly<TPreferences>;
	readonly preferenceChanges: {
		subscribe(
			listener: (preferences: Readonly<TPreferences>) => void,
			scope: LifecycleScope,
		): Cleanup;
	};
	readonly persist: (
		patch: Partial<TPreferences>,
	) => Readonly<TPreferences>;
	readonly execute: (
		action: ReaderShortcutAction,
		event: Event,
	) => boolean | void | Promise<unknown>;
	readonly canExecute?: (
		action: ReaderShortcutAction,
		event: Event,
	) => boolean;
	readonly onUnavailable?: (
		action: ReaderShortcutAction,
		label: string,
	) => void;
	readonly onError?: (cause: unknown) => void;
	readonly parentScope?: LifecycleScope;
}

const reserved = new Set([
	'Ctrl+KeyD',
	'Ctrl+KeyF',
	'Ctrl+KeyH',
	'Ctrl+KeyJ',
	'Ctrl+KeyL',
	'Ctrl+KeyN',
	'Ctrl+KeyO',
	'Ctrl+KeyP',
	'Ctrl+KeyR',
	'Ctrl+KeyS',
	'Ctrl+KeyT',
	'Ctrl+KeyW',
	'Ctrl+Tab',
	'Ctrl+Shift+KeyN',
	'Ctrl+Shift+KeyT',
	'Ctrl+Shift+Tab',
	'Alt+ArrowLeft',
	'Alt+ArrowRight',
	'Alt+F4',
	'Alt+Home',
	'Meta+Comma',
	'Meta+KeyF',
	'Meta+KeyL',
	'Meta+KeyN',
	'Meta+KeyP',
	'Meta+KeyQ',
	'Meta+KeyR',
	'Meta+KeyS',
	'Meta+KeyT',
	'Meta+KeyW',
	'Shift+Meta+KeyT',
	'F11',
	'F12',
]);

export function readerShortcutBindingLabel(binding: string): string {
	const labels: Readonly<Record<string, string>> = Object.freeze({
		Ctrl: 'Ctrl',
		Alt: 'Alt',
		Shift: 'Shift',
		Meta: 'Meta',
		ArrowLeft: '←',
		ArrowRight: '→',
		ArrowUp: '↑',
		ArrowDown: '↓',
		Home: 'Home',
		End: 'End',
		PageUp: 'Page Up',
		PageDown: 'Page Down',
		Space: '空格',
		Escape: 'Esc',
		Enter: 'Enter',
		Tab: 'Tab',
		Comma: ',',
		Period: '.',
		Slash: '/',
		Semicolon: ';',
		Quote: "'",
		BracketLeft: '[',
		BracketRight: ']',
		Backslash: '\\',
		Minus: '-',
		Equal: '=',
		Backquote: '`',
		Mouse1: '鼠标中键',
		Mouse3: '鼠标后退键',
		Mouse4: '鼠标前进键',
		Wheel: '滚轮',
	});
	return binding.split('+').map((part) =>
		labels[part] ??
		(/^Key[A-Z]$/.test(part)
			? part.slice(3)
			: /^Digit\d$/.test(part)
				? part.slice(5)
				: /^Mouse\d+$/.test(part)
					? `鼠标键 ${Number(part.slice(5)) + 1}`
					: part),
	).join(' + ');
}

export function readerShortcutBindingFromEvent(event: Event): string {
	const source = event as Event & Partial<{
		readonly button: number;
		readonly code: string;
		readonly ctrlKey: boolean;
		readonly altKey: boolean;
		readonly shiftKey: boolean;
		readonly metaKey: boolean;
	}>;
	const wheel = event.type === 'wheel';
	const mouse = /^(?:mouse|auxclick)/.test(event.type);
	if (
		wheel &&
		!source.ctrlKey &&
		!source.altKey &&
		!source.shiftKey &&
		!source.metaKey
	) return '';
	const code = wheel
		? 'Wheel'
		: mouse
			? source.button === 1 || Number(source.button) >= 3
				? `Mouse${source.button}`
				: ''
			: String(source.code ?? '');
	if (
		!code ||
		(!mouse && !wheel &&
			/^(?:Control|Alt|Shift|Meta)(?:Left|Right)?$/.test(code))
	) return '';
	return normalizeReaderShortcutBinding([
		source.ctrlKey && 'Ctrl',
		source.altKey && 'Alt',
		source.shiftKey && 'Shift',
		source.metaKey && 'Meta',
		code,
	].filter(Boolean).join('+'));
}

export function readerShortcutBindingIssue(
	bindings: ReaderShortcutBindings,
	binding: string,
	exceptAction?: ReaderShortcutAction,
): string {
	const normalized = normalizeReaderShortcutBinding(binding);
	if (!normalized) return '这个按键组合无法识别，请换一个。';
	const owner = READER_SHORTCUT_ACTIONS.find((action) =>
		action !== exceptAction && bindings[action].includes(normalized),
	);
	if (owner) {
		return `${readerShortcutBindingLabel(normalized)} 已绑定“${definitions[owner].label}”，请先移除或改用其他组合。`;
	}
	if (reserved.has(normalized)) {
		return `${readerShortcutBindingLabel(normalized)} 通常由浏览器占用，无法保证生效，请换一个组合。`;
	}
	const parts = normalized.split('+');
	const code = parts.at(-1) ?? '';
	if (
		parts.length === 1 &&
		/^(?:Key[A-Z]|Digit\d)$/.test(code)
	) {
		return '单个字母或数字容易与论坛快捷键冲突，请至少加入 Ctrl、Alt、Shift 或 Meta。';
	}
	return '';
}

function editableTarget(event: Event): boolean {
	const target = eventElement(event);
	if (!target) return false;
	const element = target;
	if (element.closest(
		'input,textarea,select,[contenteditable="true"],[contenteditable=""]',
	)) return true;
	if (event.type !== 'keydown') return false;
	return Boolean(element.closest(
		'button,a[href],[role="button"],[role="slider"],[role="tab"],' +
			'[role="menuitem"],[role="dialog"]',
	));
}

/**
 * 快捷键解析、冲突、录制、偏好写入和执行分发的唯一 owner。
 */
export class ReaderShortcutController<TPreferences extends object> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderShortcutSnapshot>();
	readonly captures = new Signal<ReaderShortcutCapture>();
	readonly #adapter: ReaderShortcutPreferencesAdapter<TPreferences>;
	readonly #persist: (
		patch: Partial<TPreferences>,
	) => Readonly<TPreferences>;
	readonly #execute: ReaderShortcutControllerOptions<TPreferences>['execute'];
	readonly #canExecute: NonNullable<
		ReaderShortcutControllerOptions<TPreferences>['canExecute']
	>;
	readonly #onUnavailable: NonNullable<
		ReaderShortcutControllerOptions<TPreferences>['onUnavailable']
	>;
	readonly #onError: (cause: unknown) => void;
	#bindings: ReaderShortcutBindings;
	#recording: ReaderShortcutAction | null = null;
	#mouseGuard: Readonly<{ button: number; until: number }> | null = null;

	constructor(options: ReaderShortcutControllerOptions<TPreferences>) {
		this.#adapter = options.preferences;
		this.#persist = options.persist;
		this.#execute = options.execute;
		this.#canExecute = options.canExecute ?? (() => true);
		this.#onUnavailable = options.onUnavailable ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.#bindings = normalizeReaderShortcutBindings(
			this.#adapter.read(options.readPreferences()),
		);
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		options.preferenceChanges.subscribe((preferences) => {
			this.#bindings = normalizeReaderShortcutBindings(
				this.#adapter.read(preferences),
			);
			this.#publish();
		}, this.scope);
		this.scope.listen(options.target, 'keydown', (event) => {
			this.#handle(event as KeyboardEvent);
		}, false);
		this.scope.listen(options.target, 'wheel', (event) => {
			this.#handle(event as WheelEvent);
		}, { capture: true, passive: false });
		this.scope.listen(options.target, 'mousedown', (event) => {
			this.#handle(event as MouseEvent);
		}, true);
		this.scope.listen(options.target, 'mouseup', (event) => {
			this.#handle(event as MouseEvent);
		}, true);
		this.scope.listen(options.target, 'auxclick', (event) => {
			this.#handle(event as MouseEvent);
		}, true);
		this.scope.add(() => {
			this.changes.clear();
			this.captures.clear();
		});
	}

	get snapshot(): ReaderShortcutSnapshot {
		return Object.freeze({
			bindings: this.#bindings,
			recording: this.#recording,
		});
	}

	startRecording(action: ReaderShortcutAction): void {
		if (!READER_SHORTCUT_ACTIONS.includes(action)) {
			throw new RangeError(`未知快捷动作：${action}`);
		}
		this.#recording = this.#recording === action ? null : action;
		this.#publish();
	}

	cancelRecording(): void {
		if (this.#recording === null) return;
		this.#recording = null;
		this.#publish();
	}

	remove(action: ReaderShortcutAction, binding: string): void {
		this.#replace(action, this.#bindings[action].filter(
			(candidate) => candidate !== binding,
		));
	}

	clear(action: ReaderShortcutAction): void {
		this.#replace(action, Object.freeze([]));
	}

	reset(action: ReaderShortcutAction): string {
		const defaults = READER_SHORTCUT_DEFAULTS[action];
		const issue = defaults
			.map((binding) =>
				readerShortcutBindingIssue(this.#bindings, binding, action))
			.find(Boolean);
		if (issue) return issue;
		this.#replace(action, defaults);
		return '';
	}

	resetAll(): void {
		this.#write(normalizeReaderShortcutBindings(READER_SHORTCUT_DEFAULTS));
	}

	destroy(): void {
		this.scope.destroy();
	}

	#handle(event: Event): void {
		const keyboard = event as Partial<KeyboardEvent>;
		const mouse = event as Partial<MouseEvent>;
		if (
			event.type !== 'mousedown' &&
			this.#mouseGuard &&
			mouse.button === this.#mouseGuard.button &&
			Date.now() < this.#mouseGuard.until
		) {
			event.preventDefault();
			event.stopImmediatePropagation();
			return;
		}
		if (
			event.defaultPrevented ||
			keyboard.isComposing ||
			keyboard.repeat
		) return;
		const binding = readerShortcutBindingFromEvent(event);
		if (!binding) return;
		if (this.#recording) {
			this.#consume(event, mouse);
			const action = this.#recording;
			const issue = readerShortcutBindingIssue(
				this.#bindings,
				binding,
				action,
			);
			if (!issue && this.#bindings[action].length >= 3) {
				this.captures.emit(Object.freeze({
					action,
					binding,
					accepted: false,
					message: '每项最多保留 3 个快捷方式。',
				}));
				return;
			}
			if (issue) {
				this.captures.emit(Object.freeze({
					action,
					binding,
					accepted: false,
					message: issue,
				}));
				return;
			}
			this.#replace(action, Object.freeze([
				...this.#bindings[action],
				binding,
			]));
			this.#recording = null;
			this.captures.emit(Object.freeze({
				action,
				binding,
				accepted: true,
				message: `已绑定 ${readerShortcutBindingLabel(binding)}`,
			}));
			this.#publish();
			return;
		}
		const targetBlocked = editableTarget(event);
		const action = READER_SHORTCUT_ACTIONS.find((candidate) =>
			this.#bindings[candidate].includes(binding),
		);
		if (!action) return;
		if (targetBlocked || !this.#canExecute(action, event)) {
			if (event.type !== 'keydown') this.#consume(event, mouse);
			return;
		}
		try {
			const result = this.#execute(action, event);
			if (result === false && action === 'discussionHorizontalScroll') {
				return;
			}
			this.#consume(event, mouse);
			if (result === false) {
				this.#onUnavailable(action, definitions[action].label);
				return;
			}
			if (
				result &&
				typeof (result as PromiseLike<unknown>).then === 'function'
			) {
				void Promise.resolve(result).then((value) => {
					if (value === false) {
						this.#onUnavailable(action, definitions[action].label);
					}
				}).catch(this.#onError);
			}
		} catch (cause) {
			this.#onError(cause);
		}
	}

	#consume(event: Event, mouse: Partial<MouseEvent>): void {
		event.preventDefault();
		event.stopImmediatePropagation();
		if (event.type !== 'mousedown') return;
		this.#mouseGuard = Object.freeze({
			button: Number(mouse.button),
			until: Date.now() + 800,
		});
	}

	#replace(
		action: ReaderShortcutAction,
		bindings: readonly string[],
	): void {
		this.#write(normalizeReaderShortcutBindings({
			...this.#bindings,
			[action]: bindings,
		}));
	}

	#write(bindings: ReaderShortcutBindings): void {
		const persisted = this.#persist(this.#adapter.createPatch(bindings));
		this.#bindings = normalizeReaderShortcutBindings(
			this.#adapter.read(persisted),
		);
		this.#publish();
	}

	#publish(): void {
		if (!this.scope.destroyed) this.changes.emit(this.snapshot);
	}
}
