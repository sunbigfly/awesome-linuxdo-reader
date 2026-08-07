import {
	ReaderLightboxController,
	type ReaderLightboxItem,
} from '../src/media/reader-lightbox-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

function item(
	key: string,
	postNumber: number,
	imageOrder = 0,
	previewSrc = `https://linux.do/preview/${key}.jpg`,
): ReaderLightboxItem {
	return Object.freeze({
		key,
		topicId: 10,
		sourcePostNumber: postNumber,
		imageOrder,
		previewSrc,
		originalSrc: `https://linux.do/original/${key}.jpg`,
		alt: key,
	});
}

const controller = new ReaderLightboxController({
	items: [item('third', 3), item('first', 1), item('second', 2)],
	initialIndex: 0,
	commentsExpanded: true,
});
assert(
	controller.snapshot().current.key === 'third' &&
	controller.snapshot().index === 2,
	'序列排序后必须按调用方选中的图片 key 定位，不能沿用易偏移的下标',
);
assert(
	controller.snapshot().commentsExpanded &&
	!controller.snapshot().descriptionExpanded,
	'界面开关必须由唯一序列 owner 保存',
);

const emissions: string[] = [];
controller.changes.subscribe((snapshot) => emissions.push(snapshot.current.key));
assert(controller.move(-1) && controller.snapshot().current.key === 'second',
	'相邻导航必须使用 canonical 序列');
controller.select(-100);
assert(controller.snapshot().current.key === 'first', '选择下标必须安全钳制');
assert(!controller.move(-1), '越过序列边界必须返回 false');

const beforeDuplicate = emissions.length;
controller.merge([item('first', 1), item('second', 2), item('third', 3)]);
assert(
	emissions.length === beforeDuplicate &&
	controller.snapshot().current.key === 'first',
	'重复扫描结果不得产生额外状态广播',
);
const currentBeforeIncrementalMerge = controller.snapshot().current;
controller.merge([item('fourth', 4), item('second', 2, 0, 'https://linux.do/new.jpg')]);
assert(
	controller.snapshot().items.map((entry) => entry.key).join(',') ===
	'first,second,third,fourth' &&
	controller.snapshot().items[1]?.previewSrc === 'https://linux.do/new.jpg' &&
	controller.snapshot().current === currentBeforeIncrementalMerge,
	'增量扫描必须按 key 去重更新，并保持语义未变的当前图片对象身份',
);

const metadataController = new ReaderLightboxController({
	items: [item('metadata', 1)],
});
let metadataEmissions = 0;
metadataController.changes.subscribe(() => {
	metadataEmissions += 1;
});
metadataController.merge([item('metadata', 2)]);
assert(
	metadataEmissions === 1 &&
	metadataController.snapshot().current.sourcePostNumber === 2,
	'同 key 图片的楼层等 canonical 元数据更新必须通知评论和跳转消费者',
);
metadataController.destroy();

controller.setCommentsExpanded(false);
controller.setDescriptionExpanded(true);
assert(
	!controller.snapshot().commentsExpanded &&
	controller.snapshot().descriptionExpanded,
	'评论和描述开关必须复用同一状态投影',
);
controller.destroy();
try {
	controller.move(1);
	throw new Error('销毁后的灯箱序列不得继续使用');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('已销毁'),
		'销毁后必须提供明确生命周期诊断',
	);
}
