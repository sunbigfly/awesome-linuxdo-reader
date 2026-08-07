import {
	BrowserDiscourseHostPort,
	ReaderApplication,
	browserBodyReady,
	detectDiscourseHost,
	type DiscourseHostDescriptor,
	type ReaderApplicationContext,
	type ReaderApplicationStage,
} from '../src/app/reader-application.js';
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

const body = deferred<void>();
const host = deferred<DiscourseHostDescriptor | null>();
const order: string[] = [];
const diagnostics: string[] = [];
let cleanupCount = 0;
let preferenceWrites = 0;
let currentPreferences: Readonly<{ readonly enabled: boolean }> =
	Object.freeze({ enabled: true });
const preferenceCommits = new Signal<{
	readonly value: Readonly<{ readonly enabled: boolean }>;
}>();
let requiredContext:
	| ReaderApplicationContext<{ readonly enabled: boolean }>
	| null = null;
const stages: readonly ReaderApplicationStage<{ readonly enabled: boolean }>[] = [
	{
		name: 'optional-observer',
		required: false,
		setup: () => {
			order.push('optional');
			throw new Error('optional unavailable');
		},
	},
	{
		name: 'required-shell',
		required: true,
		setup: (_scope, context) => {
			order.push('required');
			requiredContext = context;
			return () => {
				cleanupCount += 1;
			};
		},
	},
];
const application = new ReaderApplication({
	bodyReady: () => body.promise,
	host: { waitForHost: () => host.promise },
	preferences: {
		changes: preferenceCommits,
		load: () => {
			order.push('preferences');
			return { value: currentPreferences };
		},
		update: (patch) => {
			preferenceWrites += 1;
			currentPreferences = Object.freeze({
				...currentPreferences,
				...patch,
			});
			const snapshot = Object.freeze({ value: currentPreferences });
			preferenceCommits.emit(snapshot);
			return snapshot;
		},
	},
	stages,
});
application.diagnostics.subscribe((event) => diagnostics.push(event.stage));
const firstStart = application.start();
const duplicateStart = application.start();
assert(firstStart === duplicateStart, '重复 start 必须返回同一 Promise');
assert(application.state === 'waiting-body', '启动必须先等待 body');
body.resolve();
await Promise.resolve();
assert(
	String(application.state) === 'waiting-host' &&
	order[0] === 'preferences',
	'body ready 后必须加载偏好再等待宿主',
);
host.resolve({ detection: 'native-module' });
assert((await firstStart) === 'running', 'required stage 成功后必须进入 running');
assert(
	JSON.stringify(order) === JSON.stringify(['preferences', 'optional', 'required']),
	'stage 必须按声明顺序执行',
);
assert(
	diagnostics.includes('optional-observer'),
	'optional stage 失败必须诊断但不得阻断启动',
);
let livePreferenceEvents = 0;
const readLivePreferenceEvents = () => livePreferenceEvents;
const readPreferenceWrites = () => preferenceWrites;
requiredContext!.preferenceChanges.subscribe(() => {
	livePreferenceEvents += 1;
});
const locallyUpdated = requiredContext!.updatePreferences?.({
	enabled: false,
});
assert(
	locallyUpdated?.enabled === false &&
	!requiredContext!.readPreferences().enabled &&
	readPreferenceWrites() === 1 &&
	readLivePreferenceEvents() === 1,
	'application 唯一偏好写端口必须返回规范化结果，且同步 repository 回声只发布一次',
);
preferenceCommits.emit({
	value: Object.freeze({ enabled: true }),
});
assert(
	requiredContext!.preferences.enabled &&
	requiredContext!.readPreferences().enabled &&
	readLivePreferenceEvents() === 2,
	'stage 必须保留启动快照，同时从 application 唯一实时偏好通道读取后续提交',
);
application.destroy();
preferenceCommits.emit({
	value: Object.freeze({ enabled: false }),
});
let destroyedWriteRejected = false;
try {
	requiredContext!.updatePreferences?.({ enabled: false });
} catch (error) {
	destroyedWriteRejected =
		error instanceof Error && error.name === 'AbortError';
}
assert(
	String(application.state) === 'destroyed' &&
	cleanupCount === 1 &&
	requiredContext!.readPreferences().enabled &&
	readLivePreferenceEvents() === 2 &&
	readPreferenceWrites() === 1 &&
	destroyedWriteRejected,
	'destroy 必须反向释放实时偏好订阅并拒绝晚到设置写入',
);

let requiredCleanup = 0;
const failed = new ReaderApplication({
	bodyReady: async () => {},
	host: {
		waitForHost: async () => ({ detection: 'dom-marker' }),
	},
	preferences: { load: () => ({ value: Object.freeze({}) }) },
	stages: [
		{
			name: 'installed',
			required: true,
			setup: () => () => {
				requiredCleanup += 1;
			},
		},
		{
			name: 'broken',
			required: true,
			setup: () => {
				throw new Error('broken');
			},
		},
	],
});
assert((await failed.start()) === 'failed', 'required stage 失败必须终止启动');
assert(requiredCleanup === 1, 'required stage 失败必须释放此前已安装 stage');

const skippedPreferenceCommits = new Signal<{
	readonly value: Readonly<object>;
}>();
const skipped = new ReaderApplication({
	bodyReady: async () => {},
	host: { waitForHost: async () => null },
	preferences: {
		changes: skippedPreferenceCommits,
		load: () => ({ value: Object.freeze({}) }),
	},
	stages: [],
});
assert((await skipped.start()) === 'skipped', '宿主超时必须进入 skipped');
assert(
	skippedPreferenceCommits.size === 0,
	'skipped application 必须释放已安装的实时偏好订阅',
);

const lateHost = deferred<DiscourseHostDescriptor | null>();
let lateStageRan = false;
const destroyed = new ReaderApplication({
	bodyReady: async () => {},
	host: { waitForHost: () => lateHost.promise },
	preferences: { load: () => ({ value: Object.freeze({}) }) },
	stages: [{
		name: 'late',
		required: true,
		setup: () => {
			lateStageRan = true;
		},
	}],
});
const destroyedStart = destroyed.start();
await Promise.resolve();
destroyed.destroy();
lateHost.resolve({ detection: 'native-module' });
assert((await destroyedStart) === 'destroyed', 'destroy 后晚到宿主不得恢复启动');
assert(!lateStageRan, 'destroy 后不得安装晚到 stage');

const documentEvents = new EventTarget() as unknown as Pick<
	Document,
	'body' | 'addEventListener' | 'removeEventListener'
>;
Object.defineProperty(documentEvents, 'body', { value: null });
const bodyController = new AbortController();
const bodyWait = browserBodyReady(documentEvents, bodyController.signal);
bodyController.abort(new Error('closed'));
let bodyAborted = false;
try {
	await bodyWait;
} catch (error) {
	bodyAborted = error instanceof Error && error.message === 'closed';
}
assert(bodyAborted, 'body readiness 必须响应 application abort');

const nativeDocument = {
	querySelector: () => null,
};
assert(
	detectDiscourseHost(
		(name) => name === 'discourse/lib/url' ? { default: {} } : null,
		nativeDocument,
	)?.detection === 'native-module',
	'宿主识别必须优先使用 Discourse 原生 module',
);
assert(
	detectDiscourseHost(
		() => null,
		{ querySelector: () => ({}) as Element },
	)?.detection === 'dom-marker',
	'原生 module 尚未就绪时只允许 DOM marker 降级识别',
);

let observerDisconnected = 0;
const observerCallback: { current: MutationCallback | null } = { current: null };
const hostDocument = {
	documentElement: {} as HTMLElement,
	querySelector: () => null,
} as unknown as Document;
const hostWindow = {
	addEventListener: () => {},
	removeEventListener: () => {},
	setTimeout: () => 1,
	clearTimeout: () => {},
} as unknown as Window;
let nativeReady = false;
const browserHost = new BrowserDiscourseHostPort({
	moduleLookup: () => nativeReady ? {} : null,
	document: hostDocument,
	window: hostWindow,
	createObserver: (callback) => {
		observerCallback.current = callback;
		return {
			observe: () => {},
			disconnect: () => {
				observerDisconnected += 1;
			},
		};
	},
});
const hostWait = browserHost.waitForHost(new AbortController().signal);
nativeReady = true;
observerCallback.current?.([], {} as MutationObserver);
const detectedHost = await hostWait;
assert(
	detectedHost?.detection === 'native-module',
	'MutationObserver 必须重试原生 module',
);
assert(observerDisconnected === 1, '宿主识别完成后必须释放 observer');

const lateCleanup = deferred<void | (() => void)>();
let lateCleanupCount = 0;
const lateCleanupApplication = new ReaderApplication({
	bodyReady: async () => {},
	host: { waitForHost: async () => ({ detection: 'native-module' }) },
	preferences: { load: () => ({ value: Object.freeze({}) }) },
	stages: [{
		name: 'late-cleanup',
		required: true,
		setup: () => lateCleanup.promise,
	}],
});
const lateCleanupStart = lateCleanupApplication.start();
await Promise.resolve();
await Promise.resolve();
lateCleanupApplication.destroy();
lateCleanup.resolve(() => {
	lateCleanupCount += 1;
});
assert((await lateCleanupStart) === 'destroyed', '销毁后的异步 stage 不得恢复 application');
assert(lateCleanupCount === 1, '销毁后晚到 cleanup 必须立即执行');
