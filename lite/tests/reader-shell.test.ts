import { parseHTML } from 'linkedom';
import {
	ReaderShell,
	createReaderShellStage,
	type ReaderShellView,
	type ReaderTopicFactoryResult,
} from '../src/shell/reader-shell.js';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import { Signal } from '../src/kernel/signal.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function deferred<T>(): {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
} {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function createView(document: Document): ReaderShellView {
	const root = document.createElement('div');
	root.className = 'ldp-overlay';
	const modal = document.createElement('section');
	const body = document.createElement('main');
	const topicHost = document.createElement('div');
	const surfaceHost = document.createElement('aside');
	body.append(topicHost);
	modal.append(body, surfaceHost);
	root.append(modal);
	document.body.append(root);
	return { root, modal, body, topicHost, surfaceHost };
}

const { document: parsedDocument } = parseHTML('<!doctype html><html><body></body></html>');
const document = parsedDocument as unknown as Document;
const view = createView(document);
const shell = new ReaderShell<string>('list-route', view);
assert(view.root.hidden, 'idle Shell 不得遮挡宿主页面');
assert(shell.canReuse('list-route'), '同 compatibility key 的稳定 Shell 必须可复用');
assert(!shell.canReuse('direct-topic'), '不同路由族不得复用同一 Shell');

const surface = document.createElement('button');
let surfaceClicks = 0;
surface.addEventListener('click', () => {
	surfaceClicks += 1;
});
shell.surfaces.mount(surface);
assert(
	surface.parentElement === view.surfaceHost && shell.surfaces.size === 1,
	'surface 必须挂入具名 surfaceHost 并登记唯一 owner',
);
shell.surfaces.park(surface);
assert(
	surface.parentNode === shell.surfaces.parking,
	'park 必须移动同一节点而不是复制 surface',
);
shell.surfaces.mount(surface);
surface.click();
assert(surfaceClicks === 1, 'surface 停放/恢复不得丢失节点监听器状态');
const externalSurface = document.createElement('button');
document.body.append(externalSurface);
let unregisteredParkRejected = false;
try {
	shell.surfaces.park(externalSurface);
} catch (error) {
	unregisteredParkRejected =
		error instanceof Error && error.message.includes('未登记');
}
assert(
	unregisteredParkRejected && externalSurface.parentElement === document.body,
	'park 不得登记或拆走 Shell 外部节点',
);
let externalHostRejected = false;
try {
	shell.surfaces.mount(surface, document.createElement('div'));
} catch {
	externalHostRejected = true;
}
assert(externalHostRejected, 'surface 不得越权挂到当前 Shell 之外');

const lifecycle: string[] = [];
let topicOneFactoryRuns = 0;
const firstOpen = await shell.open(1, ({ mount }) => {
	topicOneFactoryRuns += 1;
	const node = document.createElement('article');
	node.dataset.topicId = '1';
	mount(node);
	return {
		value: 'topic-1',
		prepareClose: (reason) => {
			lifecycle.push(`prepare-1:${reason}`);
		},
		cleanup: () => {
			lifecycle.push('cleanup-1');
		},
	};
});
assert(
	firstOpen.status === 'opened' &&
	shell.activeTopicId === 1 &&
	!view.root.hidden &&
	view.topicHost.querySelector('[data-topic-id="1"]'),
	'首次打开必须显示 Shell、提交唯一 active Topic 并挂入 topicHost',
);
const reused = await shell.open(1, () => {
	topicOneFactoryRuns += 1;
	return { value: 'duplicate' };
});
assert(
	reused.status === 'reused' &&
	reused.value === 'topic-1' &&
	topicOneFactoryRuns === 1,
	'running 的同 Topic open 必须复用，不能重复创建 context',
);

const secondOpen = await shell.open(2, ({ mount }) => {
	const node = document.createElement('article');
	node.dataset.topicId = '2';
	mount(node);
	return {
		value: 'topic-2',
		cleanup: () => {
			lifecycle.push('cleanup-2');
		},
	};
});
assert(
	secondOpen.status === 'opened' &&
	shell.activeTopicId === 2 &&
	!view.topicHost.querySelector('[data-topic-id="1"]') &&
	view.topicHost.querySelector('[data-topic-id="2"]'),
	'切帖必须先释放旧 Topic DOM，再提交新 context',
);
assert(
	JSON.stringify(lifecycle.slice(0, 2)) ===
		JSON.stringify(['prepare-1:switch', 'cleanup-1']),
	'切帖必须严格先 prepare，再 cleanup',
);

const duplicateOpeningResult = deferred<ReaderTopicFactoryResult<string>>();
const duplicateOpening = shell.open(3, () => duplicateOpeningResult.promise);
assert(
	shell.open(3, () => ({ value: 'must-not-run' })) === duplicateOpening,
	'同 Topic opening 必须返回同一个 Promise',
);
duplicateOpeningResult.resolve({ value: 'topic-3' });
assert((await duplicateOpening).status === 'opened', '同 Topic opening 复用后必须正常提交');

const failedView = createView(document);
const failedShell = new ReaderShell<string>('list-route', failedView);
const failedDiagnostics: string[] = [];
failedShell.diagnostics.subscribe((diagnostic) => failedDiagnostics.push(diagnostic.phase));
await failedShell.open(11, ({ mount }) => {
	const node = document.createElement('article');
	node.dataset.topicId = '11';
	mount(node);
	return {
		value: 'topic-11',
		prepareClose: () => {
			throw new Error('draft failed');
		},
	};
});
const NativeAbortController = globalThis.AbortController;
let failedOpeningAborts = 0;
class TrackingAbortController extends NativeAbortController {
	override abort(reason?: unknown): void {
		if (!this.signal.aborted) failedOpeningAborts += 1;
		super.abort(reason);
	}
}
globalThis.AbortController = TrackingAbortController;
const blockedSwitch = await failedShell.open(12, () => ({ value: 'topic-12' }));
globalThis.AbortController = NativeAbortController;
assert(
	blockedSwitch.status === 'failed' &&
	failedShell.activeTopicId === 11 &&
	failedView.topicHost.querySelector('[data-topic-id="11"]'),
	'prepareClose 失败必须保留旧 active context 和 DOM',
);
assert(failedOpeningAborts === 1, 'prepareClose 失败必须释放本次 opening child scope');
assert(
	failedDiagnostics.includes('prepare-close'),
	'prepareClose 失败必须留下具名诊断',
);
assert(
	!await failedShell.closeTopic() &&
		failedShell.state === 'closed' &&
		failedShell.activeTopicId === null &&
		failedView.root.hidden &&
		!failedView.topicHost.firstChild,
	'显式关闭即使保存失败也必须保持界面关闭并释放旧 Topic，不能重新显示',
);
failedShell.destroy();

const factoryFailureView = createView(document);
const factoryFailureShell = new ReaderShell<string>('list-route', factoryFailureView);
const factoryFailureDiagnostics: string[] = [];
factoryFailureShell.diagnostics.subscribe((diagnostic) =>
	factoryFailureDiagnostics.push(diagnostic.phase));
const factoryFailure = await factoryFailureShell.open(13, ({ mount }) => {
	const node = document.createElement('article');
	node.dataset.topicId = '13';
	mount(node);
	throw new Error('factory failed');
});
assert(
	factoryFailure.status === 'failed' &&
	factoryFailureShell.state === 'failed' &&
	!factoryFailureView.topicHost.firstChild &&
	factoryFailureDiagnostics.includes('topic-open'),
	'当前 factory 失败必须清理本次 scope 并报告 failed，不能误判 superseded',
);
factoryFailureShell.destroy();

const stageView = createView(document);
const stageShell: { current: ReaderShell<string> | null } = { current: null };
let stageReadyCleanup = 0;
const shellStage = createReaderShellStage<{ readonly enabled: boolean }, string>({
	compatibilityKey: () => 'list-route',
	createView: () => stageView,
	onReady: (readyShell) => {
		stageShell.current = readyShell;
		return () => {
			stageReadyCleanup += 1;
		};
	},
});
const stageScope = new LifecycleScope();
const stageCleanup = shellStage.setup(stageScope, {
	preferences: Object.freeze({ enabled: true }),
	readPreferences: () => Object.freeze({ enabled: true }),
	preferenceChanges: new Signal<
		Readonly<{ readonly enabled: boolean }>
	>(),
	host: Object.freeze({ detection: 'native-module' }),
});
assert(typeof stageCleanup === 'function', 'Reader Shell application stage 必须返回 cleanup');
if (typeof stageCleanup === 'function') stageScope.add(stageCleanup);
assert(
	stageShell.current !== null &&
	shellStage.required &&
	shellStage.name === 'reader-shell',
	'application stage 必须只创建一个 required Shell owner',
);
stageScope.destroy();
assert(
	stageReadyCleanup === 1 &&
	String(stageShell.current?.state) === 'destroyed' &&
	!stageView.root.isConnected,
	'application scope 销毁必须释放 ready consumer 与 Shell root',
);

const rapidView = createView(document);
const rapidShell = new ReaderShell<string>('list-route', rapidView);
const lateResult = deferred<ReaderTopicFactoryResult<string>>();
let lateCleanupCount = 0;
const lateNode = document.createElement('article');
lateNode.dataset.topicId = '21';
const lateOpen = rapidShell.open(21, ({ mount }) => {
	mount(lateNode);
	return lateResult.promise;
});
await Promise.resolve();
const currentOpen = rapidShell.open(22, ({ mount }) => {
	const node = document.createElement('article');
	node.dataset.topicId = '22';
	mount(node);
	return { value: 'topic-22' };
});
assert((await currentOpen).status === 'opened', '后一次快速 open 不得等待忽略 abort 的旧 factory');
lateResult.resolve({
	value: 'topic-21',
	cleanup: () => {
		lateCleanupCount += 1;
	},
});
assert(
	(await lateOpen).status === 'superseded' &&
	rapidShell.activeTopicId === 22 &&
	lateCleanupCount === 1 &&
	!lateNode.isConnected,
	'晚到旧 factory 必须立即 cleanup，且不得覆盖新 active context',
);

const closeRaceView = createView(document);
const closeRaceShell = new ReaderShell<string>('list-route', closeRaceView);
const closeGate = deferred<void>();
await closeRaceShell.open(31, () => ({
	value: 'topic-31',
	prepareClose: () => closeGate.promise,
}));
const closeRaceStates: string[] = [];
closeRaceShell.changes.subscribe((state) => closeRaceStates.push(state));
const staleClose = closeRaceShell.closeTopic();
await Promise.resolve();
const newerOpen = closeRaceShell.open(32, () => ({ value: 'topic-32' }));
closeGate.resolve();
await staleClose;
assert(
	(await newerOpen).status === 'opened' &&
	closeRaceShell.activeTopicId === 32 &&
	closeRaceShell.state === 'running' &&
	closeRaceStates[0] === 'closed' &&
	closeRaceStates.at(-1) === 'running',
	'close 必须先同步隐藏；更新的 open 接管后最终状态仍只能由新事务发布',
);

const immediateCloseView = createView(document);
const immediateCloseShell = new ReaderShell<string>(
	'list-route',
	immediateCloseView,
);
const immediateCloseGate = deferred<void>();
await immediateCloseShell.open(41, ({ mount }) => {
	const node = document.createElement('article');
	node.dataset.topicId = '41';
	mount(node);
	return {
		value: 'topic-41',
		prepareClose: () => immediateCloseGate.promise,
	};
});
const immediateClose = immediateCloseShell.closeTopic();
assert(
	immediateCloseShell.state === 'closed' &&
		immediateCloseView.root.hidden &&
		immediateCloseShell.activeTopicId === 41,
	'关闭意图必须在异步 prepareClose 完成前同步隐藏 Shell',
);
immediateCloseGate.resolve();
assert(
	await immediateClose &&
		immediateCloseShell.activeTopicId === null &&
		!immediateCloseView.topicHost.firstChild,
	'后台 prepareClose 完成后必须释放 Topic scope，且不能再次切换可见状态',
);

assert(await shell.closeTopic(), 'closeTopic 应成功释放当前 Topic');
assert(
	shell.state === 'closed' &&
	shell.activeTopicId === null &&
	view.root.hidden &&
	!view.topicHost.firstChild &&
	lifecycle.includes('cleanup-2'),
	'closeTopic 必须隐藏并保留可复用 Shell，同时清空 active Topic 与其 DOM',
);
shell.destroy();
assert(
	String(shell.state) === 'destroyed' &&
	!view.root.isConnected &&
	!surface.isConnected &&
	Number(shell.surfaces.size) === 0,
	'Shell destroy 必须释放 root 和 mounted/parked 全部 surface',
);
rapidShell.destroy();
closeRaceShell.destroy();
immediateCloseShell.destroy();
