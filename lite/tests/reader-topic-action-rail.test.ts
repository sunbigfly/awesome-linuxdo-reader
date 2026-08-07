import { parseHTML } from 'linkedom';
import type { PostView } from '../src/dom/post-view.js';
import { Signal } from '../src/kernel/signal.js';
import {
	bindReaderTopicActionRailStarter,
	ReaderTopicActionRail,
	type ReaderTopicActionRailPreferences,
} from '../src/post/reader-topic-action-rail.js';

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
		'<section class="ldp-root"><main class="ldp-modal"></main></section>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const EventConstructor = parsedWindow.Event as unknown as typeof Event;
const mount = document.querySelector<HTMLElement>('.ldp-modal');
const shellRoot = document.querySelector<HTMLElement>('.ldp-root');
assert(mount && shellRoot, '测试 DOM 缺少操作列挂载点');

let preferences: ReaderTopicActionRailPreferences = Object.freeze({
	visible: true,
	fixed: false,
	mode: 'compact',
	position: Object.freeze({ x: 'left', y: 0.95 }),
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
let rejectJump = false;
let rejectPreferenceUpdate = false;
let resizeCallback: ResizeObserverCallback = () => {};
const resizeTargets = new Set<Element>();
let resizeDisconnected = false;
const renderedRevisions: number[] = [];
const renderedAsRail: boolean[] = [];
const reactionExpandedStates: boolean[] = [];
const errors: unknown[] = [];

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
			view.slots.actions.replaceChildren(like);
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

const deferredStarterChanges = new Signal<void>();
let deferredStarterLoads = 0;
const deferredStarterBinding = bindReaderTopicActionRailStarter<TestPost>({
	readStarter: () => undefined,
	loadStarter: async () => {
		deferredStarterLoads += 1;
	},
	deferLoadUntilChange: true,
	subscribe: (listener, scope) =>
		deferredStarterChanges.subscribe(listener, scope),
	update() {},
});
await Promise.resolve();
assert(
	deferredStarterLoads === 0,
	'Topic 初始化前绑定主帖操作列时不得抢在 canonical 首包前补载首帖',
);
deferredStarterChanges.emit();
await Promise.resolve();
assert(
	Number(deferredStarterLoads) === 1,
	'首个 session commit 后仍缺首帖时必须保留一次精确补载',
);
deferredStarterBinding();

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
setNumberProperty(rail.toggleButton, 'offsetTop', 160);
setNumberProperty(rail.toggleButton, 'offsetHeight', 40);
Object.defineProperty(mount, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({ left: 20, top: 40 }),
});
Object.defineProperty(rail.host, 'getBoundingClientRect', {
	configurable: true,
	value: () => ({ left: 120, top: 200 }),
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
assert(
	rail.topButton.querySelector('svg[data-icon="arrow-up"]') !== null &&
	rail.toggleButton.querySelector('svg[data-icon="layers"]') !== null,
	'主帖操作列回顶和收纳按钮必须使用自足 SVG，不能留下截图中的空白热区',
);
assert(
	rail.host.style.getPropertyValue('--ldp-topic-rail-y') === '0.95' &&
	rail.host.classList.contains('is-default-left') &&
	resizeTargets.has(mount) && resizeTargets.has(rail.host),
	'默认位置必须以归一化锚点投影，并持续观察容器/轨道宽高变化',
);
const maximumRailLeft = 500 - 40;
preferences = Object.freeze({
	...preferences,
	position: Object.freeze({ x: 2 / maximumRailLeft, y: 0.95 }),
});
preferenceChanges.emit(preferences);
flushFrames();
assert(
	rail.host.classList.contains('is-docked-left'),
	'操作列距左边 2px 时必须触发吸附',
);
preferences = Object.freeze({
	...preferences,
	position: Object.freeze({ x: 3 / maximumRailLeft, y: 0.95 }),
});
preferenceChanges.emit(preferences);
flushFrames();
assert(
	!rail.host.classList.contains('is-docked-left'),
	'操作列距左边 3px 时不得触发吸附',
);
preferences = Object.freeze({
	...preferences,
	position: Object.freeze({ x: 1 - 2 / maximumRailLeft, y: 0.95 }),
});
preferenceChanges.emit(preferences);
flushFrames();
assert(
	rail.host.classList.contains('is-docked-right'),
	'操作列距右边 2px 时必须触发吸附',
);
preferences = Object.freeze({
	...preferences,
	position: Object.freeze({ x: 1 - 3 / maximumRailLeft, y: 0.95 }),
});
preferenceChanges.emit(preferences);
flushFrames();
assert(
	!rail.host.classList.contains('is-docked-right'),
	'操作列距右边 3px 时不得触发吸附',
);
preferences = Object.freeze({
	...preferences,
	position: Object.freeze({ x: 'left', y: 0.95 }),
});
preferenceChanges.emit(preferences);
flushFrames();
resizeCallback([], {} as ResizeObserver);
assert(frameCallbacks.size === 1, '容器变化必须立即排队重算冻结操作区几何');
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
	shellRoot.classList.contains('ldp-topic-action-rail-expanded') &&
	rail.toggleButton.getAttribute('aria-expanded') === 'true' &&
	reactionExpandedStates.at(-1) === true,
	'compact 操作列必须可展开完整动作并同步常显回应列表',
);
const retargetedInternalClick = new EventConstructor('click', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(retargetedInternalClick, 'composedPath', {
	configurable: true,
	value: () => [rail.toggleButton, rail.host, shellRoot, document],
});
document.dispatchEvent(retargetedInternalClick);
assert(
	rail.host.classList.contains('is-expanded') &&
	rail.toggleButton.getAttribute('aria-expanded') === 'true',
	'ShadowRoot 内部点击被 document retarget 后仍必须由 composedPath 识别为操作列内部事件',
);
click(mount!);
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
	patches.some((patch) => patch.mode === 'collapsed') &&
	reactionExpandedStates.at(-1) === false,
	'展开态再次收纳必须持久化 collapsed 模式并关闭常显回应列表',
);
click(rail.toggleButton);
assert(
	!rail.host.classList.contains('is-collapsed') &&
	patches.some((patch) => patch.mode === 'compact'),
	'collapsed 模式必须可恢复为 compact',
);

pointer(rail.toggleButton, 'pointerdown', {
	pointerId: 7,
	clientX: 10,
	clientY: 20,
});
assert(timerCallbacks.size === 1, '未固定操作列长按时必须只登记一个拖动计时器');
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
const positionPatch = [...patches].reverse().find((patch) => patch.position);
assert(
	positionPatch?.position &&
	typeof positionPatch.position.x === 'number' &&
	positionPatch.position.x > 0.43 &&
	positionPatch.position.x < 0.44 &&
	positionPatch.position.y > 0.66 &&
	positionPatch.position.y < 0.67 &&
	!rail.host.classList.contains('is-dragging'),
	'拖动结束必须持久化相对挂载容器的位置比例并清理临时态',
);

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
rail.refresh();
assert(
	!rail.host.classList.contains('is-expanded') &&
	!rail.host.classList.contains('is-collapsed') &&
	reactionExpandedStates.at(-1) === false,
	'刷新必须把临时全部展开恢复到持久化常显态',
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
	resizeDisconnected,
	'销毁必须释放 DOM、偏好监听和 Shell 状态',
);
assert(
	cancelledFrames.length === 1 && cancelledTimers.length === 1,
	'销毁必须取消尚未执行的定位帧和长按计时器',
);
