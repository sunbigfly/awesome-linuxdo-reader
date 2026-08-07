import { parseHTML } from 'linkedom';
import {
	READER_IMAGE_SCALE_PROPERTY,
	ReaderImageScaleProjection,
	readerImageScalePercent,
} from '../src/media/reader-image-scale.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

assert(
	readerImageScalePercent({ preset: '125', custom: 87 }) === 125 &&
	readerImageScalePercent({ preset: 'custom', custom: 87.4 }) === 87 &&
	readerImageScalePercent({ preset: 'custom', custom: 999 }) === 200 &&
	readerImageScalePercent({ preset: '25', custom: 100 }) === 50,
	'图片比例必须保留旧版整数、50–200 边界和 25 旧 preset 的实际钳制语义',
);

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><main class="reader" style="--ldp-image-zoom:.9"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('.reader')!;
const projection = new ReaderImageScaleProjection({ root });

assert(
	projection.apply({ preset: 'custom', custom: 150 }) === 150 &&
	projection.percent === 150 &&
	root.style.getPropertyValue(READER_IMAGE_SCALE_PROPERTY) === '1.5',
	'projection 必须只在 Reader root 投影规范化设计变量',
);
projection.apply({ preset: '100', custom: 150 });
assert(
	root.style.getPropertyValue(READER_IMAGE_SCALE_PROPERTY) === '1',
	'切回 preset 必须覆盖 custom 而不扫描正文图片',
);
projection.destroy();
assert(
	root.style.getPropertyValue(READER_IMAGE_SCALE_PROPERTY) === '.9',
	'销毁必须恢复接管前的 inline value',
);

let destroyedRejected = false;
try {
	projection.apply({ preset: '100', custom: 100 });
} catch (error) {
	destroyedRejected = error instanceof Error && error.message.includes('已销毁');
}
assert(destroyedRejected, '销毁后不得继续投影图片比例');
