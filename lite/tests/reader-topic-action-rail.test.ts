import { parseHTML } from 'linkedom';
import type { PostView } from '../src/dom/post-view.js';
import { Signal } from '../src/kernel/signal.js';
import {
	bindReaderTopicActionRailStarter,
	ReaderTopicActionRail,
	type ReaderTopicActionRailPreferences,
} from '../src/post/reader-topic-action-rail.js';
import {
	READER_SELECT_DISMISS_EVENT,
} from '../src/shell/reader-select-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost {
	readonly id: number;
	readonly post_number: number;
	readonly username: string;
	readonly created_at: string;
	readonly revision: number;
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body>' +
		'<div id="reader-portal"></div>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const EventConstructor = parsedWindow.Event as unknown as typeof Event;
const documentAddEventListener = document.addEventListener.bind(document);
const documentRemoveEventListener = document.removeEventListener.bind(document);
let documentDragListenerAdds = 0;
let documentDragListenerRemoves = 0;
Object.defineProperty(document, 'addEventListener', {
	configurable: true,
	value: (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	) => {
		if (type === 'pointermove') documentDragListenerAdds += 1;
		documentAddEventListener(type, listener, options);
	},
});
Object.defineProperty(document, 'removeEventListener', {
	configurable: true,
	value: (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | EventListenerOptions,
	) => {
		if (type === 'pointermove') documentDragListenerRemoves += 1;
		documentRemoveEventListener(type, listener, options);
	},
});
const portal = document.querySelector<HTMLElement>('#reader-portal')!;
const portalRoot = portal.attachShadow({ mode: 'open' });
const shellRoot = document.createElement('section');
shellRoot.className = 'ldp-root';
shellRoot.dataset.readerWorkspaceMode = 'floating';
const mount = document.createElement('main');
mount.className = 'ldp-modal';
shellRoot.append(mount);
portalRoot.append(shellRoot);
assert(mount && shellRoot, '测试 DOM 缺少操作列挂载点');

let preferences: ReaderTopicActionRailPreferences = Object.freeze({
	visible: true,
	fixed: false,
	mode: 'compact',
	positions: Object.freeze({
		floating: Object.freeze({ x: 'left', y: 0.95 }),
		fullpage: Object.freeze({ x: 'right', y: 0.25 }),
		embedded: Object.freeze({ x: 0.5, y: 0.5 }),
	}),
});
const preferenceChanges = new Signal<ReaderTopicActionRailPreferences>();
const patches: Array<Partial<ReaderTopicActionRailPreferences>> = [];
const frameCallbacks = new Map<number, FrameRequestCallback>();
const timerCallbacks = new Map<number, () => void>();
const cancelledFrames: number[] = [];
const cancelledTimers: number[] = [];
let nextFrame = 1;
let nextTimer = 1;
let now = 1_000;
let jumpCount = 0;
let summaryCount = 0;
let downloadCount = 0;
let chronicleCount = 0;
let unwantedTopicsCount = 0;
let userObservationCount = 0;
let rejectJump = false;
let rejectPreferenceUpdate = false;
let resizeCallback: ResizeObserverCallback = () => {};
const resizeTargets = new Set<Element>();
let resizeDisconnected = false;
const renderedRevisions: number[] = [];
const renderedAsRail: boolean[] = [];
const reactionExpandedStates: boolean[] = [];
const errors: unknown[] = [];
let selectDismissCount = 0;
mount.addEventListener(READER_SELECT_DISMISS_EVENT, () => {
	selectDismissCount += 1;
});

const rail = new ReaderTopicActionRail<TestPost>({
	document,
	mount,
	shellRoot,
	identity: (post) => ({
		postId: post.id,
		postNumber: post.post_number,
		username: post.username,
		createdAt: post.created_at,
	}),
	actions: {
		afterRender(post, view: PostView) {
			renderedRevisions.push(post.revision);
			renderedAsRail.push(
				view.slots.root.classList.contains('ldp-topic-action-rail-post'),
			);
			const like = document.createElement('button');
			like.className = 'ldp-like';
			like.dataset.revision = String(post.revision);
			const bookmark = document.createElement('button');
			bookmark.className = 'ldp-topic-bookmark';
			const expandedActions = document.createElement('div');
			expandedActions.className = 'ldp-topic-footer-actions';
			for (let index = 0; index < 5; index += 1) {
				expandedActions.append(document.createElement('button'));
			}
			const contextActions = document.createElement('span');
			contextActions.className = 'ldp-context-actions-slot';
			for (let index = 0; index < 3; index += 1) {
				contextActions.append(document.createElement('button'));
			}
			contextActions.append(expandedActions);
			view.slots.actions.replaceChildren(like, contextActions);
			view.slots.topicFooter.hidden = false;
			view.slots.topicFooter.replaceChildren(bookmark);
		},
		setTopicActionRailExpanded(_view, expanded) {
			reactionExpandedStates.push(expanded);
		},
	},
	preferences: {
		read: () => preferences,
		subscribe(listener, scope) {
			return preferenceChanges.subscribe(listener, scope);
		},
			update(patch) {
				if (rejectPreferenceUpdate) throw new Error('偏好同步写失败');
				patches.push(patch);
			preferences = Object.freeze({
				...preferences,
				...patch,
			});
			preferenceChanges.emit(preferences);
		},
	},
		jumpToTop: () => {
			if (rejectJump) throw new Error('回顶同步失败');
			jumpCount += 1;
		},
		openTopicSummary: () => {
			summaryCount += 1;
		},
		downloadCurrentTopic: () => {
			downloadCount += 1;
		},
		openChronicle: () => {
			chronicleCount += 1;
		},
		openUnwantedTopics: () => {
			unwantedTopicsCount += 1;
		},
		openUserObservations: () => {
			userObservationCount += 1;
		},
	requestFrame: (callback) => {
		const id = nextFrame;
		nextFrame += 1;
		frameCallbacks.set(id, callback);
		return id;
	},
	cancelFrame: (id) => {
		cancelledFrames.push(id);
		frameCallbacks.delete(id);
	},
	createResizeObserver: (callback) => {
		resizeCallback = callback;
		return {
			observe: (target) => resizeTargets.add(target),
			disconnect: () => {
				resizeDisconnected = true;
				resizeTargets.clear();
			},
		};
	},
	scheduleTimer: (callback) => {
		const id = nextTimer;
		nextTimer += 1;
		timerCallbacks.set(id, callback);
		return id;
	},
	cancelTimer: (id) => {
		cancelledTimers.push(id);
		timerCallbacks.delete(id);
	},
		now: () => now,
	onError: (cause) => errors.push(cause),
});
assert(
	!rail.host.hidden &&
		shellRoot.classList.contains('ldp-topic-action-rail-visible') &&
		rail.downloadButton?.hidden === true &&
		rail.summaryButton?.hidden === true &&
		documentDragListenerAdds === 0,
	'首帖缺失时仍必须保留操作列占位，但总结与下载入口只在第二段显示；未开始拖动时不得常驻全局 pointermove',
);

function setNumberProperty(
	target: object,
	name: string,
	value: number,
): void {
	Object.defineProperty(target, name, {
		configurable: true,
		value,
	});
}

function flushFrames(): void {
	for (const [id, callback] of [...frameCallbacks]) {
		frameCallbacks.delete(id);
		callback(now);
	}
}

function click(target: Element): void {
	const event = new EventConstructor('click', {
		bubbles: true,
		cancelable: true,
		composed: true,
	});
	target.dispatchEvent(event);
}

let coldStarter: TestPost | undefined;
let starterLoads = 0;
let resolveStarterLoad: (() => void) | undefined;
const starterChanges = new Signal<void>();
const projectedStarters: TestPost[] = [];
const starterBinding = bindReaderTopicActionRailStarter({
	readStarter: () => coldStarter,
	loadStarter: () => {
		starterLoads += 1;
		return new Promise<void>((resolve) => {
			resolveStarterLoad = resolve;
		});
	},
	subscribe: (listener, scope) =>
		starterChanges.subscribe(listener, scope),
	update: (post) => projectedStarters.push(post),
});
await Promise.resolve();
starterChanges.emit();
await Promise.resolve();
assert(
	starterLoads === 1 && projectedStarters.length === 0,
	'中间楼层冷启动缺首帖时必须只发一条精确补齐请求，其他 session commit 不得叠加飞行请求',
);
coldStarter = Object.freeze({
	id: 100,
	post_number: 1,
	username: 'cold-starter',
	created_at: '2026-07-29T00:00:00.000Z',
	revision: 1,
});
resolveStarterLoad?.();
await Promise.resolve();
await Promise.resolve();
assert(
	Number(projectedStarters.length) === 1 &&
		projectedStarters[0] === coldStarter,
	'精确首帖请求完成后必须立即恢复唯一收纳箱投影',
);
starterBinding();

const committedStarter = Object.freeze({
	id: 101,
	post_number: 1,
	username: 'committed-starter',
	created_at: '2026-08-08T00:00:00.000Z',
	revision: 1,
});
const committedStarterChanges = new Signal<void>();
let committedStarterLoads = 0;
const committedStarterProjections: TestPost[] = [];
const committedStarterBinding = bindReaderTopicActionRailStarter({
	readStarter: () => committedStarter,
	loadStarter: async () => {
		committedStarterLoads += 1;
	},
	subscribe: (listener, scope) =>
		committedStarterChanges.subscribe(listener, scope),
	update: (post) => committedStarterProjections.push(post),
});
assert(
	committedStarterLoads === 0 &&
		committedStarterProjections.length === 1 &&
		committedStarterProjections[0] === committedStarter,
	'大刷新绑定收纳箱时若 canonical 首帖已经提交，必须立即投影且不得重复补载',
);
committedStarterBinding();

let restoredStarter: TestPost | undefined;
let restoreReady: (() => void) | undefined;
const restoredSessionReady = new Promise<void>((resolve) => {
	restoreReady = resolve;
});
const restoredStarterChanges = new Signal<void>();
let restoredStarterLoads = 0;
const restoredStarterProjections: TestPost[] = [];
const restoredStarterBinding = bindReaderTopicActionRailStarter<TestPost>({
	readStarter: () => restoredStarter,
	waitUntilReady: () => restoredSessionReady,
	loadStarter: async () => {
		restoredStarterLoads += 1;
		restoredStarter = Object.freeze({
			id: 102,
			post_number: 1,
			username: 'restored-starter',
			created_at: '2026-08-08T00:01:00.000Z',
			revision: 1,
		});
	},
	subscribe: (listener, scope) =>
		restoredStarterChanges.subscribe(listener, scope),
	update: (post) => restoredStarterProjections.push(post),
});
await Promise.resolve();
assert(
	restoredStarterLoads === 0 && restoredStarterProjections.length === 0,
	'Topic 初始化完成前绑定主帖操作列时不得抢在 canonical 恢复前补载首帖',
);
restoreReady?.();
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	Number(restoredStarterLoads) === 1 &&
		Number(restoredStarterProjections.length) === 1 &&
		restoredStarterProjections[0] === restoredStarter,
	'完整深楼层快照不产生 session commit 时，初始化结束后仍必须精确补载并投影首帖',
);
restoredStarterBinding();

function pointer(
	target: EventTarget,
	type: string,
	values: Readonly<{
		button?: number;
		pointerId: number;
		clientX: number;
		clientY: number;
	}>,
): void {
	const event = new EventConstructor(type, {
		bubbles: true,
		cancelable: true,
		composed: true,
	});
	Object.defineProperties(event, {
		button: { value: values.button ?? 0 },
		pointerId: { value: values.pointerId },
		clientX: { value: values.clientX },
		clientY: { value: values.clientY },
	});
	target.dispatchEvent(event);
}

setNumberProperty(mount, 'clientWidth', 500);
setNumberProperty(mount, 'clientHeight', 600);
setNumberProperty(rail.host, 'offsetWidth', 40);
setNumberProperty(rail.host, 'offsetHeight', 200);
setNumberProperty(rail.toggleButton, 'offsetLeft', 2);
setNumberProperty(rail.toggleButton, 'offsetWidth', 36);
setNumberProperty(rail.toggleButton, 'offsetTop', 160);
setNumberProperty(rail.toggleButton, 'offsetHeight', 40);
Object.defineProperty(mount, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({
		left: 20,
		right: 520,
		top: 40,
		bottom: 640,
		width: 500,
		height: 600,
	}),
});
Object.defineProperty(rail.host, 'getBoundingClientRect', {
	configurable: true,
	value: () => {
		const styledLeft = Number.parseFloat(rail.host.style.left);
		const left = 20 + (Number.isFinite(styledLeft) ? styledLeft : 100);
		return ({
		left,
		right: left + 40,
		top: 200,
		bottom: 400,
		width: 40,
		height: 200,
		});
	},
});
Object.defineProperty(rail.toggleButton, 'getBoundingClientRect', {
	configurable: true,
	value: () => {
		const hostRect = rail.host.getBoundingClientRect();
		return ({
		left: hostRect.left + 2,
		right: hostRect.left + 38,
		top: 360,
		bottom: 400,
		width: 36,
		height: 40,
		});
	},
});

const firstPost: TestPost = Object.freeze({
	id: 101,
	post_number: 1,
	username: 'starter',
	created_at: '2026-07-30T00:00:00.000Z',
	revision: 1,
});
rail.update(firstPost);
flushFrames();
assert(!rail.host.hidden, '有主帖且偏好可见时必须显示操作列');
assert(
	shellRoot.classList.contains('ldp-topic-action-rail-visible'),
	'操作列可见状态必须投影到 Shell 根节点',
);
assert(
	rail.host.querySelectorAll('.ldp-topic-action-rail-post').length === 1 &&
		rail.host.querySelector('.ldp-like')?.getAttribute('data-revision') === '1' &&
		rail.host.querySelectorAll('.ldp-topic-bookmark').length === 1 &&
		renderedAsRail[0] === true,
	'操作列必须复用唯一 PostView 动作投影，不复制动作 DOM',
);
	const downloadGroup = rail.host.querySelector<HTMLElement>(
		':scope > .ldp-topic-action-rail-download-group',
	);
	const secondaryToolsGroup = downloadGroup?.querySelector<HTMLElement>(
		':scope > .ldp-topic-action-rail-secondary-tools',
	);
	const summaryBookmarkGroup = rail.host.querySelector<HTMLElement>(
		'.ldp-topic-action-rail-summary-bookmark-group',
	);
	assert(
		rail.topButton.querySelector('svg[data-icon="arrow-up"]') !== null &&
		rail.summaryButton?.querySelector('svg[data-icon="sparkles"]') !== null &&
		rail.summaryButton?.getAttribute('aria-label') ===
			'AI 总结（LinuxDo 官方 / 自定义）' &&
		Boolean(rail.summaryButton?.hidden) &&
		rail.toggleButton.querySelector('svg[data-icon="menu-box"]') !== null &&
			rail.toggleButton.getAttribute('aria-label')?.includes('两段展开') &&
		rail.downloadButton?.querySelector('svg[data-icon="download"]') !== null &&
		rail.chronicleButton?.querySelector('svg[data-icon="history"]') !== null &&
			rail.downloadButton?.hidden === true &&
			rail.chronicleButton?.hidden === true &&
			rail.userObservationButton?.querySelector(
				'svg[data-icon="activity"]',
			) !== null &&
			rail.userObservationButton?.hidden === true,
		'第一段必须隐藏总结、下载、岁月史书与用户观察，只保留常用阅读动作',
	);
	assert(
		summaryBookmarkGroup?.children[0] === rail.view?.slots.topicFooter &&
			summaryBookmarkGroup.children[1] === rail.summaryButton &&
			summaryBookmarkGroup.querySelector('.ldp-topic-bookmark') !== null &&
			summaryBookmarkGroup.getAttribute('aria-label') === '主题收藏与总结',
		'总结必须与唯一主题收藏投影进入同一组合，不能复制或接管收藏按钮',
	);
	assert(
		secondaryToolsGroup?.children[0] === rail.downloadButton &&
			secondaryToolsGroup.children[1] === rail.userObservationButton &&
			secondaryToolsGroup.children[2] === rail.chronicleButton &&
			secondaryToolsGroup.children[3] === rail.unwantedTopicsButton &&
			secondaryToolsGroup.children.length === 4 &&
			Boolean(downloadGroup?.hidden) &&
			rail.host.style.getPropertyValue(
				'--ldp-topic-rail-actions-width',
			) === '219px',
		'第二段底部动作组必须按八个动作计算碰撞宽度，上方四项工具组保持独立 owner 并在第一段隐藏',
	);
assert(
	rail.host.style.getPropertyValue('--ldp-topic-rail-y') === '0.95' &&
	rail.host.classList.contains('is-default-left') &&
	resizeTargets.has(mount) && resizeTargets.has(rail.host),
	'默认位置必须以归一化锚点投影，并持续观察容器/轨道宽高变化',
);
preferences = Object.freeze({
	...preferences,
	positions: Object.freeze({
		...preferences.positions,
		floating: Object.freeze({ x: 0, y: 0.95 }),
	}),
});
preferenceChanges.emit(preferences);
flushFrames();
assert(
	!rail.host.classList.contains('is-docked-left') &&
	!rail.host.classList.contains('is-actions-open-left'),
	'透明 rail 贴左但按钮外框仍距边界 2px 时不得吸附',
);
preferences = Object.freeze({
	...preferences,
	positions: Object.freeze({
		...preferences.positions,
		floating: Object.freeze({ x: 1, y: 0.95 }),
	}),
});
preferenceChanges.emit(preferences);
flushFrames();
assert(
	!rail.host.classList.contains('is-docked-right') &&
	rail.host.classList.contains('is-actions-open-left'),
	'透明 rail 贴右但按钮外框仍距边界 2px 时不得吸附',
);
preferences = Object.freeze({
	...preferences,
	positions: Object.freeze({
		...preferences.positions,
		floating: Object.freeze({ x: 'left', y: 0.95 }),
	}),
});
preferenceChanges.emit(preferences);
flushFrames();
resizeCallback([], {} as ResizeObserver);
assert(frameCallbacks.size === 1, '容器变化必须立即排队重算冻结操作区几何');
flushFrames();

shellRoot.dataset.readerWorkspaceMode = 'fullpage';
shellRoot.dispatchEvent(new EventConstructor('ldp-reader-workspace-change'));
flushFrames();
	assert(
		rail.host.style.getPropertyValue('--ldp-topic-rail-y') === '0.25' &&
		rail.host.classList.contains('is-default-right') &&
		rail.host.classList.contains('is-actions-open-left'),
	'切到全屏必须恢复自己的右侧位置，横向操作分组同时避让右边缘',
);
shellRoot.dataset.readerWorkspaceMode = 'embed-left';
shellRoot.dispatchEvent(new EventConstructor('ldp-reader-workspace-change'));
flushFrames();
assert(
	rail.host.style.getPropertyValue('--ldp-topic-rail-x') === '0.5' &&
		rail.host.style.getPropertyValue('--ldp-topic-rail-y') === '0.5',
	'左右嵌入必须共享独立于浮窗和全屏的嵌入位置槽位',
);
setNumberProperty(mount, 'clientWidth', 900);
setNumberProperty(mount, 'clientHeight', 900);
resizeCallback([], {} as ResizeObserver);
flushFrames();
assert(
	rail.host.style.getPropertyValue('--ldp-topic-rail-x') === '0.5' &&
		rail.host.style.getPropertyValue('--ldp-topic-rail-y') === '0.5',
	'容器宽高变化后必须保留 X/Y 比例锚点并重新投影',
);
setNumberProperty(mount, 'clientWidth', 500);
setNumberProperty(mount, 'clientHeight', 600);
shellRoot.dataset.readerWorkspaceMode = 'floating';
shellRoot.dispatchEvent(new EventConstructor('ldp-reader-workspace-change'));
flushFrames();

const firstView = rail.view;
rail.update(firstPost);
assert(
	renderedRevisions.join(',') === '1' && Number(frameCallbacks.size) === 0,
	'同一 canonical 主帖引用重复到达时不得重绘操作列或重新读取 rail 尺寸',
);
rail.update(Object.freeze({ ...firstPost, revision: 2 }));
assert(
	rail.view === firstView &&
	renderedRevisions.join(',') === '1,2',
	'同一主帖更新必须复用 PostView 并重投影唯一动作状态',
);

	click(rail.topButton);
	assert(jumpCount === 1, '回顶按钮必须只调用统一 timeline 跳转端口');
	click(rail.toggleButton);
	assert(
		rail.host.classList.contains('is-expanded') &&
			Boolean(downloadGroup?.hidden) === false &&
			Boolean(rail.summaryButton?.hidden) === false &&
			rail.summaryButton?.parentElement === summaryBookmarkGroup,
		'第一段点击收纳箱必须进入第二段，并显示收藏与总结组合',
	);
	click(rail.summaryButton!);
	assert(summaryCount === 1, '第二段 AI 总结按钮必须只调用 Topic 总结浮窗端口');
	click(rail.downloadButton!);
	assert(
		downloadCount === 1 && rail.host.classList.contains('is-expanded') &&
			Boolean(rail.chronicleButton?.hidden) === false,
		'第二段下载图标必须把独立下载范围浮窗停靠到自身旁边',
	);
	pointer(mount, 'pointerdown', {
		pointerId: 20,
		clientX: 200,
		clientY: 200,
	});
	assert(
		!rail.host.classList.contains('is-expanded'),
		'下载范围浮窗开启后，操作列仍可由外部空白恢复常显状态',
	);
	click(rail.toggleButton);
	assert(
		rail.host.classList.contains('is-expanded') &&
		shellRoot.classList.contains('ldp-topic-action-rail-expanded') &&
		rail.toggleButton.getAttribute('aria-expanded') === 'true' &&
		rail.toggleButton.querySelector('svg[data-icon="menu-box"]') !== null &&
			rail.chronicleButton !== null &&
			Boolean(rail.chronicleButton.hidden) === false &&
			rail.unwantedTopicsButton !== null &&
			Boolean(rail.unwantedTopicsButton.hidden) === false &&
			rail.userObservationButton !== null &&
			Boolean(rail.userObservationButton.hidden) === false &&
			reactionExpandedStates.at(-1) === true,
		'第一段必须可切到不重复阅读动作的第二段、显示用户观察并同步回应列表状态',
);
click(rail.userObservationButton!);
assert(
	userObservationCount === 1 && rail.host.classList.contains('is-expanded'),
	'展开后的用户观察入口必须打开观察浮窗且保持动作列展开',
);
click(rail.unwantedTopicsButton!);
assert(
	unwantedTopicsCount === 1 && rail.host.classList.contains('is-expanded'),
	'岁月史书右侧的不想看入口必须打开集合浮窗且保持动作列展开',
);
let capturedChroniclePointerId = 0;
Object.defineProperty(rail.chronicleButton!, 'setPointerCapture', {
	configurable: true,
	value: (pointerId: number) => {
		capturedChroniclePointerId = pointerId;
	},
});
pointer(rail.chronicleButton!, 'pointerdown', {
	pointerId: 21,
	clientX: 10,
	clientY: 10,
});
click(rail.chronicleButton!);
assert(
	chronicleCount === 1 && capturedChroniclePointerId === 21 &&
		rail.host.classList.contains('is-expanded'),
	'真实鼠标序列点击岁月史书必须锁定原按钮、打开搜集浮窗且不收起操作列',
);
const retargetedHistoryClick = new EventConstructor('click', {
	bubbles: true,
	cancelable: true,
	composed: true,
});
Object.defineProperty(retargetedHistoryClick, 'composedPath', {
	configurable: true,
	value: () => [portal, document],
});
document.dispatchEvent(retargetedHistoryClick);
assert(
	chronicleCount === 1 && rail.host.classList.contains('is-expanded'),
	'按下已归收纳箱所有后，抬起产生的外层重定向 click 不得误收纳展开图标',
);
const expandedAction = rail.host.querySelector<HTMLElement>('.ldp-like')!;
let expandedActionClicks = 0;
expandedAction.addEventListener('click', () => {
	expandedActionClicks += 1;
});
pointer(expandedAction, 'pointerdown', {
	pointerId: 22,
	clientX: 10,
	clientY: 10,
});
click(expandedAction);
assert(
	expandedActionClicks === 1 && rail.host.classList.contains('is-expanded'),
	'ShadowRoot 内收纳箱动作必须在 pointerdown 阶段归 rail 所有',
);
const narrowedOwnedActionPointerDown = new EventConstructor('pointerdown', {
	bubbles: true,
	cancelable: true,
	composed: true,
});
Object.defineProperties(narrowedOwnedActionPointerDown, {
	button: { value: 0 },
	pointerId: { value: 23 },
	clientX: { value: 10 },
	clientY: { value: 10 },
	composedPath: {
		configurable: true,
		value: () => [portal, document],
	},
});
expandedAction.dispatchEvent(narrowedOwnedActionPointerDown);
click(expandedAction);
assert(
	Number(expandedActionClicks) === 2 &&
		rail.host.classList.contains('is-expanded'),
	'刷新后即使外层 pointerdown 路径被收窄，rail 自身仍必须先确认功能点击归属',
);
const retargetedInternalPointerDown = new EventConstructor('pointerdown', {
	bubbles: true,
	cancelable: true,
	composed: true,
});
Object.defineProperties(retargetedInternalPointerDown, {
	button: { value: 0 },
	pointerId: { value: 24 },
	clientX: { value: 10 },
	clientY: { value: 10 },
	composedPath: {
		configurable: true,
		value: () => [rail.toggleButton, rail.host, shellRoot, document],
	},
});
document.dispatchEvent(retargetedInternalPointerDown);
assert(
	rail.host.classList.contains('is-expanded') &&
	rail.toggleButton.getAttribute('aria-expanded') === 'true',
	'ShadowRoot 内部按下被 document retarget 后仍必须由 composedPath 识别为操作列内部事件',
);
const outsideIconAction = document.createElement('button');
outsideIconAction.className = 'ldp-outside-icon-action';
outsideIconAction.append(document.createElement('svg'));
mount.append(outsideIconAction);
pointer(outsideIconAction.querySelector('svg')!, 'pointerdown', {
	pointerId: 25,
	clientX: 200,
	clientY: 200,
});
click(outsideIconAction.querySelector('svg')!);
assert(
	rail.host.classList.contains('is-expanded') &&
	rail.toggleButton.getAttribute('aria-expanded') === 'true',
	'收纳箱展开后点击正文或其他功能图标不得触发自动收纳',
);
pointer(mount, 'pointerdown', {
	pointerId: 26,
	clientX: 200,
	clientY: 200,
});
assert(
	!rail.host.classList.contains('is-expanded') &&
	!shellRoot.classList.contains('ldp-topic-action-rail-expanded') &&
	!rail.host.classList.contains('is-collapsed') &&
	reactionExpandedStates.at(-1) === false,
	'全部展开是临时态，点击轨道外空白必须回到常显且关闭表情列表',
);
click(rail.toggleButton);
click(rail.toggleButton);
	assert(
		 rail.host.classList.contains('is-collapsed') &&
			rail.topButton.hidden === false &&
			Boolean(rail.summaryButton?.hidden) &&
			Boolean(rail.downloadButton?.hidden) &&
			rail.toggleButton.hidden === false &&
		patches.some((patch) => patch.mode === 'collapsed') &&
		reactionExpandedStates.at(-1) === false,
		'展开态再次收纳必须只保留回顶和展开控制，隐藏下载并持久化 collapsed 模式',
	);
	click(rail.toggleButton);
	assert(
		!rail.host.classList.contains('is-collapsed') &&
			Boolean(rail.summaryButton?.hidden) &&
			rail.downloadButton?.hidden === true &&
			downloadGroup?.hidden === true &&
		patches.some((patch) => patch.mode === 'compact'),
		'collapsed 模式必须恢复为仅含阅读动作的第一段，总结与下载仍留在第二段',
	);

pointer(rail.toggleButton, 'pointerdown', {
	pointerId: 7,
	clientX: 10,
	clientY: 20,
});
assert(timerCallbacks.size === 1, '未固定操作列长按时必须只登记一个拖动计时器');
assert(
	documentDragListenerAdds === 1,
	'只有按下可拖控件后才允许临时接管 document pointermove',
);
const hold = [...timerCallbacks.values()][0];
timerCallbacks.clear();
hold?.();
assert(rail.host.classList.contains('is-dragging'), '长按完成后必须进入拖动态');
pointer(document, 'pointermove', {
	pointerId: 7,
	clientX: 110,
	clientY: 70,
});
pointer(document, 'pointerup', {
	pointerId: 7,
	clientX: 110,
	clientY: 70,
});
const positionPatch = [...patches].reverse().find((patch) => patch.positions);
const floatingPosition = positionPatch?.positions?.floating;
assert(
	floatingPosition &&
	typeof floatingPosition.x === 'number' &&
	floatingPosition.x > 0.43 &&
	floatingPosition.x < 0.44 &&
	floatingPosition.y > 0.66 &&
	floatingPosition.y < 0.67 &&
	positionPatch?.positions?.fullpage.x === 'right' &&
	positionPatch.positions.fullpage.y === 0.25 &&
	positionPatch.positions.embedded.x === 0.5 &&
	positionPatch.positions.embedded.y === 0.5 &&
	!rail.host.classList.contains('is-dragging') &&
	documentDragListenerRemoves === 1,
	'浮窗拖动必须只持久化浮窗比例位置，并保留另外两个形态槽位',
);

shellRoot.dataset.readerWorkspaceMode = 'fullpage';
shellRoot.dispatchEvent(new EventConstructor('ldp-reader-workspace-change'));
flushFrames();
pointer(rail.toggleButton, 'pointerdown', {
	pointerId: 10,
	clientX: 10,
	clientY: 20,
});
const fullpageHold = [...timerCallbacks.values()][0];
timerCallbacks.clear();
fullpageHold?.();
pointer(document, 'pointermove', {
	pointerId: 10,
	clientX: -90,
	clientY: 70,
});
pointer(document, 'pointerup', {
	pointerId: 10,
	clientX: -90,
	clientY: 70,
});
const fullpageTwoPixelPatch = [...patches].reverse().find((patch) =>
	patch.positions?.fullpage.x === 0
);
assert(
	fullpageTwoPixelPatch?.positions?.fullpage.x === 0,
	'按钮外框距左边界 2px 时不得吸附，即使透明 rail 已经贴边',
);
flushFrames();
pointer(rail.toggleButton, 'pointerdown', {
	pointerId: 11,
	clientX: 10,
	clientY: 20,
});
const fullpageCollisionHold = [...timerCallbacks.values()][0];
timerCallbacks.clear();
fullpageCollisionHold?.();
pointer(document, 'pointermove', {
	pointerId: 11,
	clientX: -91,
	clientY: 70,
});
pointer(document, 'pointerup', {
	pointerId: 11,
	clientX: -91,
	clientY: 70,
});
const fullpagePatch = [...patches].reverse().find((patch) =>
	patch.positions?.fullpage.x === 'left'
);
assert(
	fullpagePatch?.positions?.fullpage.x === 'left' &&
		fullpagePatch.positions.floating === floatingPosition &&
		fullpagePatch.positions.embedded.x === 0.5,
	'按钮外框距左边界 1px 时必须吸附，并只写全屏槽位',
);
flushFrames();
pointer(rail.toggleButton, 'pointerdown', {
	pointerId: 12,
	clientX: 10,
	clientY: 20,
});
const fullpageRightTwoPixelHold = [...timerCallbacks.values()][0];
timerCallbacks.clear();
fullpageRightTwoPixelHold?.();
pointer(document, 'pointermove', {
	pointerId: 12,
	clientX: 370,
	clientY: 70,
});
pointer(document, 'pointerup', {
	pointerId: 12,
	clientX: 370,
	clientY: 70,
});
const fullpageRightTwoPixelPatch = [...patches].reverse().find((patch) =>
	patch.positions?.fullpage.x === 1
);
assert(
	fullpageRightTwoPixelPatch?.positions?.fullpage.x === 1,
	'按钮外框距右边界 2px 时不得吸附，即使透明 rail 已经贴边',
);
flushFrames();
pointer(rail.toggleButton, 'pointerdown', {
	pointerId: 13,
	clientX: 10,
	clientY: 20,
});
const fullpageRightCollisionHold = [...timerCallbacks.values()][0];
timerCallbacks.clear();
fullpageRightCollisionHold?.();
pointer(document, 'pointermove', {
	pointerId: 13,
	clientX: 371,
	clientY: 70,
});
pointer(document, 'pointerup', {
	pointerId: 13,
	clientX: 371,
	clientY: 70,
});
const fullpageRightPatch = [...patches].reverse().find((patch) =>
	patch.positions?.fullpage.x === 'right'
);
assert(
	fullpageRightPatch?.positions?.fullpage.x === 'right',
	'按钮外框距右边界 1px 时必须吸附',
);
shellRoot.dataset.readerWorkspaceMode = 'floating';
shellRoot.dispatchEvent(new EventConstructor('ldp-reader-workspace-change'));
flushFrames();

now += 301;
preferences = Object.freeze({ ...preferences, visible: false });
preferenceChanges.emit(preferences);
assert(
	rail.host.hidden &&
	!shellRoot.classList.contains('ldp-topic-action-rail-visible'),
	'偏好关闭必须同步隐藏操作列和 Shell 占位状态',
);

preferences = Object.freeze({
	...preferences,
	visible: true,
	fixed: true,
});
preferenceChanges.emit(preferences);
flushFrames();
pointer(rail.toggleButton, 'pointerdown', {
	pointerId: 8,
	clientX: 1,
	clientY: 1,
});
assert(Number(timerCallbacks.size) === 0, '固定位置时不得启动拖动计时器');

rail.refresh();
assert(renderedRevisions.at(-1) === 2, '刷新必须重投影最新主帖动作状态');
preferences = Object.freeze({ ...preferences, fixed: false });
preferenceChanges.emit(preferences);
click(rail.toggleButton);
assert(rail.host.classList.contains('is-expanded'), '刷新前必须进入临时全部展开态');
const dismissCountBeforeRefresh = selectDismissCount;
rail.refresh();
assert(
	!rail.host.classList.contains('is-expanded') &&
	!rail.host.classList.contains('is-collapsed') &&
	reactionExpandedStates.at(-1) === false &&
	selectDismissCount === dismissCountBeforeRefresh + 1,
	'刷新必须把临时全部展开恢复到持久化常显态，并关闭已展开的铃铛菜单',
);
rejectJump = true;
let synchronousJumpEscaped = false;
try {
	click(rail.topButton);
} catch {
	synchronousJumpEscaped = true;
}
await Promise.resolve();
await Promise.resolve();
assert(
	!synchronousJumpEscaped &&
		errors.at(-1) instanceof Error &&
		(errors.at(-1) as Error).message === '回顶同步失败',
	'同步回顶异常必须进入统一诊断，不能逃出 rail click listener',
);
rejectJump = false;
click(rail.toggleButton);
rejectPreferenceUpdate = true;
let synchronousUpdateEscaped = false;
try {
	click(rail.toggleButton);
} catch {
	synchronousUpdateEscaped = true;
}
await Promise.resolve();
await Promise.resolve();
assert(
	!synchronousUpdateEscaped &&
		(errors.at(-1) as Error | undefined)?.message === '偏好同步写失败',
	'同步偏好写异常必须进入统一诊断，不能逃出 rail click listener',
);
rejectPreferenceUpdate = false;
Object.defineProperty(parsedWindow, 'matchMedia', {
	configurable: true,
	value: () => ({ matches: true }),
});
pointer(rail.toggleButton, 'pointerdown', {
	pointerId: 90,
	clientX: 1,
	clientY: 1,
});
assert(
	Number(timerCallbacks.size) === 0,
	'窄屏触控底部操作坞不得启动不可见拖动或改写桌面位置偏好',
);
Object.defineProperty(parsedWindow, 'matchMedia', {
	configurable: true,
	value: () => ({ matches: false }),
});
pointer(rail.toggleButton, 'pointerdown', {
	pointerId: 9,
	clientX: 1,
	clientY: 1,
});
rail.destroy();
assert(
	!rail.host.isConnected &&
	preferenceChanges.size === 0 &&
	!shellRoot.classList.contains('ldp-topic-action-rail-visible') &&
	resizeDisconnected &&
	documentDragListenerAdds === documentDragListenerRemoves,
	'销毁必须释放 DOM、偏好监听、临时全局拖动监听和 Shell 状态',
);
assert(
	cancelledFrames.length === 1 && cancelledTimers.length === 1,
	'销毁必须取消尚未执行的定位帧和长按计时器',
);
