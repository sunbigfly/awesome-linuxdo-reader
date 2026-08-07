import { parseHTML } from 'linkedom';
import { PostView } from '../src/dom/post-view.js';
import { ReplyTreeDomOwner } from '../src/dom/reply-tree-dom-owner.js';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import { ReplyTreeVirtualLayoutController } from '../src/stream/reply-tree-virtual-layout-controller.js';
import { VirtualRootLayout } from '../src/stream/virtual-root-layout.js';
import { VirtualStreamDomController } from '../src/stream/virtual-stream-dom-controller.js';
import {
	VirtualStreamFrameController,
	type FrameSchedulerPort,
	type RootSizeEntry,
	type RootSizeObserverPort,
} from '../src/stream/virtual-stream-frame-controller.js';
import { VirtualStreamView } from '../src/stream/virtual-stream-view.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class FakeFrames implements FrameSchedulerPort {
	readonly callbacks = new Map<number, () => void>();
	#nextHandle = 1;

	request(callback: () => void): number {
		const handle = this.#nextHandle++;
		this.callbacks.set(handle, callback);
		return handle;
	}

	cancel(handle: number): void {
		this.callbacks.delete(handle);
	}

	run(): void {
		const callbacks = [...this.callbacks.values()];
		this.callbacks.clear();
		for (const callback of callbacks) callback();
	}
}

class FakeRootObserver implements RootSizeObserverPort {
	readonly observed = new Set<Element>();
	disconnected = false;
	callback: (entries: readonly RootSizeEntry[]) => void = () => {};

	observe(target: Element): void {
		this.observed.add(target);
	}

	unobserve(target: Element): void {
		this.observed.delete(target);
	}

	disconnect(): void {
		this.disconnected = true;
		this.observed.clear();
	}

	emit(entries: readonly RootSizeEntry[]): void {
		this.callback(entries);
	}
}

const { document: parsedDocument } = parseHTML('<!doctype html><html><body></body></html>');
const document = parsedDocument as unknown as Document;
const streamView = new VirtualStreamView(document);
document.body.append(streamView.slots.root);
const repository = new ReplyTreeRepository(13, {
	load: async () => null,
	save: async () => {},
});
const layout = new VirtualRootLayout(100);
const rootProjection = new ReplyTreeVirtualLayoutController(repository, layout);
const domOwner = new ReplyTreeDomOwner(repository.topology, streamView.slots.rootList);
const virtualDom = new VirtualStreamDomController(repository, layout, streamView, domOwner);
const ingest = repository.ingest(
	[
		{ post_number: 3, reply_to_post_number: null },
		{ post_number: 1, reply_to_post_number: null },
	],
	'topic-json',
);
for (const accepted of ingest.acceptedPosts) {
	domOwner.register(new PostView(document, {
		postId: 1_000 + accepted.postNumber,
		postNumber: accepted.postNumber,
		username: `user-${accepted.postNumber}`,
	}), false);
}
domOwner.sync();

const frames = new FakeFrames();
const observer = new FakeRootObserver();
let scrollOffset = 0;
let userScrolling = false;
let deferRootMeasurements = false;
let deferredMeasurementNotifications = 0;
const siblingBlockSizes = new Map<Element, number>();
const frameController = new VirtualStreamFrameController(virtualDom, {
	readWindowInput: () => ({
		scrollOffset,
		viewportSize: 100,
		overscanBeforeScreens: 0,
		overscanAfterScreens: 0,
	}),
	applyScrollCompensation: (delta) => {
		scrollOffset += delta;
	},
	shouldApplyScrollCompensation: () => !userScrolling,
	shouldDeferMeasurements: () => deferRootMeasurements,
	onMeasurementsDeferred: () => {
		deferredMeasurementNotifications += 1;
	},
	resolveRootBlockSize: (target, blockSize) =>
		blockSize + (siblingBlockSizes.get(target) ?? 0),
	observerFactory: (callback) => {
		observer.callback = callback;
		return observer;
	},
	frameScheduler: frames,
});

const first = frameController.flushNow();
assert(first.window.postNumbers[0] === 1, '初始帧应挂载 #1');
const cleanupFirst = frameController.observeRoot(domOwner.view(1)!.slots.root);
frameController.observeRoot(domOwner.view(3)!.slots.root);
assert(observer.observed.size === 2, '根视图必须进入统一尺寸 observer');

scrollOffset = 100;
frameController.notifyScroll();
frameController.notifyScroll();
assert(frames.callbacks.size === 1, '同一帧多次 scroll 只能排一个提交');
frames.run();
assert(frameController.lastCommit?.window.postNumbers[0] === 3, '滚动帧未切换到 #3');

observer.emit([
	{ target: domOwner.view(1)!.slots.root, blockSize: 150 },
]);
observer.emit([
	{ target: domOwner.view(3)!.slots.root, blockSize: 100 },
]);
assert(frames.callbacks.size === 1, '同一帧多批尺寸变化必须合并');
frames.run();
assert(scrollOffset === 150, '锚点前根楼层增高应产生一次等额 scroll compensation');
assert(frameController.lastCommit?.window.postNumbers[0] === 3, '补偿后可见锚点不应跳楼');

observer.emit([
	{ target: domOwner.view(3)!.slots.root, blockSize: 100 },
]);
assert(Number(frames.callbacks.size) === 0, '相同根高度不应触发空提交帧');
observer.emit([
	{ target: domOwner.view(1)!.slots.root, blockSize: 150.4 },
]);
assert(Number(frames.callbacks.size) === 0, '亚像素尺寸波动不得形成反复补偿帧');

userScrolling = true;
observer.emit([
	{ target: domOwner.view(1)!.slots.root, blockSize: 180 },
]);
frames.run();
assert(
	scrollOffset === 150 && layout.blockSizeOf(1) === 180,
	'用户滚动活跃时尺寸只更新布局模型，不得由第二个 owner 写 scroll compensation',
);
userScrolling = false;

deferRootMeasurements = true;
observer.emit([
	{ target: domOwner.view(1)!.slots.root, blockSize: 200 },
]);
observer.emit([
	{ target: domOwner.view(1)!.slots.root, blockSize: 220 },
]);
assert(
	layout.blockSizeOf(1) === 180 &&
		Number(frames.callbacks.size) === 0 &&
		deferredMeasurementNotifications === 2,
	'滚动手势期间根高度必须只保留最后一个样本，不得逐次改写根前缀或排提交帧',
);
deferRootMeasurements = false;
frameController.flushDeferredMeasurements();
assert(
	layout.blockSizeOf(1) === 220 && Number(frames.callbacks.size) === 1,
	'停滚后必须一次提交每个根的最后高度样本并合并到唯一虚拟帧',
);
frames.run();

observer.emit([
	{ target: domOwner.view(1)!.slots.root, blockSize: 210 },
]);
scrollOffset = 250;
frameController.notifyScroll();
frames.run();
assert(
	scrollOffset === 250,
	'用户在尺寸回调后继续滚动时，旧锚点补偿不得追赶并反向推动视口',
);

cleanupFirst();
assert(Number(observer.observed.size) === 1, 'observeRoot cleanup 未解除单个根观察');
observer.emit([
	{ target: domOwner.view(1)!.slots.root, blockSize: 90 },
]);
assert(Number(frames.callbacks.size) === 0, '解除观察后的延迟尺寸回调不得进入下一帧事务');
const thirdRoot = domOwner.view(3)!.slots.root;
Object.defineProperty(thirdRoot, 'getBoundingClientRect', {
	configurable: true,
	value: () => Object.freeze({ height: 100 }),
});
siblingBlockSizes.set(thirdRoot, 18);
frameController.refreshRootMeasurement(thirdRoot);
frames.run();
assert(
	layout.blockSizeOf(3) === 118,
	'隐藏楼层分隔条作为根同级节点时，虚拟占位必须计入同一根高度',
);
siblingBlockSizes.delete(thirdRoot);
frameController.refreshRootMeasurement(thirdRoot);
frames.run();
assert(
	layout.blockSizeOf(3) === 100,
	'分隔条销毁后必须主动回收虚拟占位，不能留下滚动空洞',
);
frameController.notifyScroll();
assert(frames.callbacks.size === 1, '销毁前应存在待提交帧');
frameController.destroy();
assert(Number(frames.callbacks.size) === 0, '销毁必须取消待提交帧');
assert(observer.disconnected, '销毁必须断开统一尺寸 observer');

await repository.flush();
rootProjection.destroy();
domOwner.destroy();
streamView.destroy();
