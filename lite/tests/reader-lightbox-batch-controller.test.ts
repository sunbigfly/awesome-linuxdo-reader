import {
	ReaderLightboxBatchController,
} from '../src/media/reader-lightbox-batch-controller.js';
import {
	ReaderLightboxController,
	type ReaderLightboxItem,
} from '../src/media/reader-lightbox-controller.js';
import { Signal } from '../src/kernel/signal.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function item(key: string, postNumber: number): ReaderLightboxItem {
	return {
		key,
		topicId: 10,
		sourcePostNumber: postNumber,
		imageOrder: 0,
		previewSrc: `https://linux.do/${key}-small.png`,
		originalSrc: `https://linux.do/${key}.png`,
		alt: key,
	};
}

const first = item('first', 1);
const second = item('second', 2);
const third = item('third', 3);
const sequence = new ReaderLightboxController({ items: [first, second] });
let allLoadCalls = 0;
let catalogComplete = true;
const catalogChanges = new Signal<Readonly<{
	readonly items: readonly ReaderLightboxItem[];
	readonly complete: boolean;
	readonly failedBatchCount: number;
}>>();
const batch = new ReaderLightboxBatchController({
	sequence,
	archiveName: 'Topic.zip',
	imageCatalog: {
		changes: catalogChanges,
		async loadAll() {
			allLoadCalls += 1;
			return {
				items: [first, second, third],
				complete: catalogComplete,
				failedBatchCount: 0,
			};
		},
	},
});
batch.open();
assert(
	batch.snapshot().open &&
	batch.snapshot().selectedItems.length === 0 &&
	batch.snapshot().archiveName === 'Topic',
	'打开批量 surface 必须重置选择并规范化归档名',
);
batch.toggle(first.key);
batch.toggleAll();
assert(
	batch.snapshot().allSelected &&
	batch.snapshot().selectedItems.length === 2,
	'单选与全选必须只写批量 controller',
);
sequence.merge([third]);
assert(
	batch.snapshot().selectedItems.length === 2 &&
	batch.snapshot().items.length === 2 &&
	batch.snapshot().allSelected,
	'已加载范围必须冻结打开时的图片身份，后台补流不能悄悄扩大用户选择范围',
);
assert(
	await batch.selectScope('all') &&
	allLoadCalls === 1 &&
	batch.snapshot().scope === 'all' &&
	batch.snapshot().items.length === 3 &&
	batch.snapshot().allComplete,
	'全部帖子范围只能消费注入的 canonical 图片目录并合并唯一 sequence',
);
await batch.selectScope('loaded');
assert(
	batch.snapshot().items.length === 2 &&
	batch.snapshot().selectedItems.length === 0,
	'切回已加载范围必须恢复打开时快照并清空跨范围选择',
);
catalogComplete = false;
catalogChanges.emit({
	items: [first, second, third],
	complete: false,
	failedBatchCount: 0,
});
assert(
	!await batch.selectScope('all') &&
	Number(allLoadCalls) === 2 &&
	!batch.snapshot().allComplete,
	'再次进入全部范围必须重读唯一目录，不能沿用已经陈旧的 complete 副本',
);
await batch.selectScope('loaded');
batch.toggleAll();
const started = batch.begin();
assert(
	started.busy && started.selectedItems.length === 2 && !batch.close(),
	'下载进行中不得关闭并丢失当前选择',
);
batch.progress(1, 2, 'fetching');
batch.progress(2, 2, 'archiving');
batch.finish('完成');
assert(
	!batch.snapshot().busy &&
	batch.snapshot().phase === 'saved' &&
	batch.snapshot().status === '完成' &&
	batch.close(),
	'进度/完成/关闭必须由同一状态 owner 原子提交',
);
batch.destroy();
sequence.destroy();

const deferredSequence = new ReaderLightboxController({ items: [first] });
let resolveAll!: (value: Readonly<{
	readonly items: readonly ReaderLightboxItem[];
	readonly complete: boolean;
}>) => void;
const deferred = new Promise<Readonly<{
	readonly items: readonly ReaderLightboxItem[];
	readonly complete: boolean;
}>>((resolve) => {
	resolveAll = resolve;
});
const backgroundBatch = new ReaderLightboxBatchController({
	sequence: deferredSequence,
	archiveName: 'Background',
	imageCatalog: {
		loadAll: () => deferred,
	},
});
backgroundBatch.open();
const backgroundLoad = backgroundBatch.selectScope('all');
assert(
	backgroundBatch.snapshot().loadingAll && backgroundBatch.close(),
	'关闭批量 UI 只能释放 surface，不能伪装成取消共享 TopicSession 补流',
);
resolveAll({ items: [first, second], complete: true });
assert(await backgroundLoad && deferredSequence.snapshot().items.length === 2,
	'共享补流晚到后仍须归并唯一图片序列，关闭 overlay 不得丢 canonical 结果');
backgroundBatch.destroy();
deferredSequence.destroy();
