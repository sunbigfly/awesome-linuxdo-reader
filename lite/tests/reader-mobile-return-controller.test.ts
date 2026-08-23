import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import {
	dispatchReaderEscape,
	isReaderAppleMobilePlatform,
	ReaderMobileReturnController,
} from '../src/shell/reader-mobile-return-controller.js';
import type { ReaderShellState } from '../src/shell/reader-shell.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class TestMediaQueryList extends EventTarget {
	matches: boolean;
	readonly media = '(mobile)';
	onchange: ((this: MediaQueryList, ev: MediaQueryListEvent) => unknown) | null = null;

	constructor(matches: boolean) {
		super();
		this.matches = matches;
	}

	addListener(): void {}
	removeListener(): void {}
}

class TestHistory {
	readonly entries: unknown[] = [{ route: 'topic-list' }];
	readonly urls = ['https://linux.do/latest'];
	index = 0;
	readonly #onPop: () => void;
	readonly #onUrl: (href: string) => void;
	readonly #deferred: boolean;
	#pendingPops = 0;

	constructor(
		onPop: () => void,
		onUrl: (href: string) => void,
		deferred: boolean,
	) {
		this.#onPop = onPop;
		this.#onUrl = onUrl;
		this.#deferred = deferred;
	}

	get state(): unknown {
		return this.entries[this.index] ?? null;
	}

	pushState(state: unknown, _unused?: string, url?: string | URL | null): void {
		this.entries.splice(this.index + 1, Infinity, state);
		this.urls.splice(this.index + 1, Infinity, this.#resolveUrl(url));
		this.index += 1;
		this.#syncUrl();
	}

	replaceState(state: unknown, _unused?: string, url?: string | URL | null): void {
		this.entries[this.index] = state;
		this.urls[this.index] = this.#resolveUrl(url);
		this.#syncUrl();
	}

	back(): void {
		if (this.index <= 0) return;
		this.index -= 1;
		this.#syncUrl();
		this.#queuePop();
	}

	forward(): void {
		if (this.index >= this.entries.length - 1) return;
		this.index += 1;
		this.#syncUrl();
		this.#queuePop();
	}

	get pendingPops(): number {
		return this.#pendingPops;
	}

	flushPop(): void {
		if (this.#pendingPops <= 0) {
			throw new Error('没有待触发的 popstate');
		}
		this.#pendingPops -= 1;
		this.#onPop();
	}

	#queuePop(): void {
		if (this.#deferred) {
			this.#pendingPops += 1;
			return;
		}
		this.#onPop();
	}

	#resolveUrl(url: string | URL | null | undefined): string {
		if (url === undefined || url === null || String(url) === '') {
			return this.urls[this.index]!;
		}
		return new URL(String(url), this.urls[this.index]).href;
	}

	#syncUrl(): void {
		this.#onUrl(this.urls[this.index]!);
	}
}

class TestWindow extends EventTarget {
	readonly media: TestMediaQueryList;
	readonly history: TestHistory;
	readonly navigator: ReaderMobileReturnNavigatorShape;
	readonly location = { href: 'https://linux.do/latest' };

	constructor(
		mobile: boolean,
		navigator: ReaderMobileReturnNavigatorShape,
		deferredHistory = false,
	) {
		super();
		this.media = new TestMediaQueryList(mobile);
		this.navigator = navigator;
		this.history = new TestHistory(
			() => this.dispatchEvent(new Event('popstate')),
			(href) => {
				this.location.href = href;
			},
			deferredHistory,
		);
	}

	matchMedia(): MediaQueryList {
		return this.media as unknown as MediaQueryList;
	}
}

type ReaderMobileReturnNavigatorShape = Readonly<{
	userAgent: string;
	platform: string;
	maxTouchPoints: number;
}>;

assert(
	isReaderAppleMobilePlatform({
		userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
		platform: 'iPhone',
		maxTouchPoints: 5,
	}) &&
		isReaderAppleMobilePlatform({
			userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
			platform: 'MacIntel',
			maxTouchPoints: 5,
		}) &&
		!isReaderAppleMobilePlatform({
			userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
			platform: 'MacIntel',
			maxTouchPoints: 0,
		}) &&
		!isReaderAppleMobilePlatform({
			userAgent: 'Mozilla/5.0 (Linux; Android 16)',
			platform: 'Linux armv8l',
			maxTouchPoints: 5,
		}),
	'Apple 移动平台识别必须覆盖 iPhone/iPad 桌面 UA，且不能误判 Mac 或 Android',
);

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><main class="ldp-overlay"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
let dispatchedEscape = '';
document.addEventListener('keydown', (event) => {
	const keyboardEvent = event as KeyboardEvent;
	dispatchedEscape = `${keyboardEvent.key}:${keyboardEvent.code}`;
}, { once: true });
dispatchReaderEscape(document);
assert(
	dispatchedEscape === 'Escape:Escape',
	'移动返回必须合成普通 Escape 键盘事件，让现有浮层与 Reader owner 继续决定关闭顺序',
);
const localSurface = document.createElement('section');
localSurface.className = 'ldp-color-picker-popover';
document.body.append(localSurface);
let localSurfaceEscape = '';
localSurface.addEventListener('keydown', (event) => {
	const keyboardEvent = event as KeyboardEvent;
	localSurfaceEscape = [
		keyboardEvent.key,
		keyboardEvent.target === localSurface,
		keyboardEvent.composed,
	].join(':');
}, { once: true });
dispatchReaderEscape(document);
assert(
	localSurfaceEscape === 'Escape:true:true',
	'移动返回合成的 Esc 必须投递给真实顶层 surface，并穿透 ShadowRoot 复用局部关闭 owner',
);
localSurface.remove();
const root = document.querySelector<HTMLElement>('.ldp-overlay')!;
const button = document.createElement('button');
button.hidden = true;
root.append(button);
const window = new TestWindow(true, {
	userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
	platform: 'iPhone',
	maxTouchPoints: 5,
});
let state: ReaderShellState = 'idle';
const changes = new Signal<ReaderShellState>();
let escapeRequests = 0;
let remainingLayers = 3;
const controller = new ReaderMobileReturnController({
	document,
	root,
	button,
	window: window as unknown as Window,
	readReaderState: () => state,
	readerChanges: changes,
	dispatchEscape: () => {
		escapeRequests += 1;
		remainingLayers -= 1;
		if (remainingLayers > 0) return;
		state = 'closed';
		changes.emit(state);
	},
});
let hostPopRequests = 0;
window.addEventListener('popstate', () => {
	hostPopRequests += 1;
});

state = 'opening';
changes.emit(state);
assert(
	window.history.index === 1 &&
		window.history.entries.length === 2 &&
		(window.history.state as Record<string, unknown>).route ===
			'topic-list' &&
		hostPopRequests === 0 &&
		!button.hidden &&
		root.classList.contains('ldp-apple-mobile-return'),
	'移动端 Reader 打开时必须保留宿主 state、只压入一个同 URL 返回位，并显示 Apple 返回入口',
);
state = 'running';
changes.emit(state);
assert(
	window.history.entries.length === 2,
	'Reader 从 opening 进入 running 不得重复压入返回历史位',
);

window.history.back();
assert(
	escapeRequests === 1 &&
		state === 'running' &&
		window.history.index === 1 &&
		window.history.entries.length === 2 &&
		(window.history.state as Record<string, unknown>).route === 'topic-list' &&
		hostPopRequests === 0 &&
		!button.hidden,
	'第一次返回必须只合成一次 Esc 关闭最上层浮窗、补回同 URL 历史位，且不能传播给宿主',
);

window.history.back();
assert(
	Number(escapeRequests) === 2 &&
		String(state) === 'running' &&
		Number(window.history.index) === 1 &&
		hostPopRequests === 0,
	'第二次返回必须继续复用既有 Esc 层级顺序，每次只关闭一个层级',
);

window.history.back();
assert(
	Number(escapeRequests) === 3 &&
		String(state) === 'closed' &&
		Number(window.history.index) === 0 &&
		(window.history.state as Record<string, unknown>).route === 'topic-list' &&
		hostPopRequests === 0 &&
		button.hidden,
	'最后一层 Esc 关闭 Reader 后必须停在原宿主 URL，不能补历史位或触发宿主刷新',
);

state = 'opening';
changes.emit(state);
state = 'running';
changes.emit(state);
remainingLayers = 2;
button.click();
assert(
	Number(escapeRequests) === 4 &&
		state === 'running' &&
		window.history.index === 1 &&
		!button.hidden,
	'Apple 可见返回按钮也必须先关闭当前最上层浮窗，不能越级关闭 Reader',
);
button.click();
assert(
	Number(escapeRequests) === 5 &&
		String(state) === 'closed' &&
		Number(window.history.index) === 0 &&
		hostPopRequests === 0 &&
		button.hidden,
	'Apple 可见返回按钮必须逐次复用同一 Esc 链，并在 Reader 关闭时静默回收历史位',
);

const desktopRoot = document.createElement('main');
const desktopButton = document.createElement('button');
desktopRoot.append(desktopButton);
const desktopWindow = new TestWindow(false, {
	userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15)',
	platform: 'MacIntel',
	maxTouchPoints: 0,
});
const desktopChanges = new Signal<ReaderShellState>();
const desktopController = new ReaderMobileReturnController({
	document,
	root: desktopRoot,
	button: desktopButton,
	window: desktopWindow as unknown as Window,
	readReaderState: () => 'running',
	readerChanges: desktopChanges,
	dispatchEscape() {},
});
assert(
	desktopWindow.history.entries.length === 1 && desktopButton.hidden,
	'桌面端不得写入移动返回历史位，也不得显示 Apple 返回入口',
);

const androidRoot = document.createElement('main');
const androidButton = document.createElement('button');
androidRoot.append(androidButton);
const androidWindow = new TestWindow(true, {
	userAgent: 'Mozilla/5.0 (Linux; Android 16)',
	platform: 'Linux armv8l',
	maxTouchPoints: 5,
});
const androidChanges = new Signal<ReaderShellState>();
const androidController = new ReaderMobileReturnController({
	document,
	root: androidRoot,
	button: androidButton,
	window: androidWindow as unknown as Window,
	readReaderState: () => 'running',
	readerChanges: androidChanges,
	dispatchEscape() {},
});
assert(
	androidWindow.history.entries.length === 2 &&
		androidButton.hidden &&
		!androidRoot.classList.contains('ldp-apple-mobile-return'),
	'Android 必须保留系统返回的 Esc 接管，但不得显示 iOS 专属返回入口',
);
androidWindow.media.matches = false;
androidWindow.media.dispatchEvent(new Event('change'));
assert(
	androidWindow.history.index === 0 && androidButton.hidden,
	'Reader 在移动与桌面断点间切换时必须回收移动返回位，不能留下额外空返回层',
);
androidWindow.media.matches = true;
androidWindow.media.dispatchEvent(new Event('change'));
assert(
	Number(androidWindow.history.index) === 1,
	'Reader 回到移动断点后必须重新建立且只建立一个系统返回位',
);

const routingRoot = document.createElement('main');
const routingButton = document.createElement('button');
routingRoot.append(routingButton);
const routingWindow = new TestWindow(true, {
	userAgent: 'Mozilla/5.0 (Linux; Android 16)',
	platform: 'Linux armv8l',
	maxTouchPoints: 5,
});
const routingChanges = new Signal<ReaderShellState>();
let routingEscapes = 0;
const routingController = new ReaderMobileReturnController({
	document,
	root: routingRoot,
	button: routingButton,
	window: routingWindow as unknown as Window,
	readReaderState: () => 'running',
	readerChanges: routingChanges,
	dispatchEscape() {
		routingEscapes += 1;
	},
});
routingWindow.history.pushState({ route: 'host-topic' }, '', '/t/host-topic/42');
routingWindow.history.back();
assert(
	routingEscapes === 1 &&
	routingWindow.history.index === 2 &&
	(routingWindow.history.state as Record<string, unknown>).route ===
		'host-topic' &&
	routingWindow.location.href === 'https://linux.do/t/host-topic/42' &&
	(routingWindow.history.state as Record<string, unknown>)
		.ldpReaderMobileReturn !== undefined,
	'宿主在 Reader guard 之后追加 URL 时，返回必须先恢复真实宿主路由再关闭一层 Reader surface，不能改变 URL',
);

const deferredRoot = document.createElement('main');
const deferredButton = document.createElement('button');
deferredRoot.append(deferredButton);
const deferredWindow = new TestWindow(true, {
	userAgent: 'Mozilla/5.0 (Linux; Android 16)',
	platform: 'Linux armv8l',
	maxTouchPoints: 5,
}, true);
let deferredEscapes = 0;
const deferredController = new ReaderMobileReturnController({
	document,
	root: deferredRoot,
	button: deferredButton,
	window: deferredWindow as unknown as Window,
	readReaderState: () => 'running',
	readerChanges: new Signal<ReaderShellState>(),
	dispatchEscape() {
		deferredEscapes += 1;
	},
});
deferredWindow.history.pushState(
	{ route: 'host-topic-async' },
	'',
	'/t/host-topic-async/84',
);
deferredWindow.history.back();
assert(
	deferredEscapes === 0 &&
		deferredWindow.location.href === 'https://linux.do/latest' &&
		deferredWindow.history.pendingPops === 1,
	'异步 popstate 到达前不得提前关闭 Reader surface',
);
deferredWindow.history.flushPop();
assert(
	Number(deferredEscapes) === 0 &&
		String(deferredWindow.location.href) ===
			'https://linux.do/t/host-topic-async/84' &&
		Number(deferredWindow.history.pendingPops) === 1,
	'返回落到 guard 后必须先 forward 恢复宿主真实 URL，再等待恢复事务完成',
);
deferredWindow.history.flushPop();
assert(
	Number(deferredEscapes) === 1 &&
		String(deferredWindow.location.href) ===
			'https://linux.do/t/host-topic-async/84' &&
		Number(deferredWindow.history.pendingPops) === 0,
	'只有真实 URL 恢复完成后才允许关闭当前顶层 surface',
);

deferredController.destroy();
routingController.destroy();
androidController.destroy();
desktopController.destroy();
controller.destroy();
