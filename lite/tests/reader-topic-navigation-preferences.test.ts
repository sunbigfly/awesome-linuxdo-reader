import { parseHTML } from 'linkedom';
import {
	ReaderTopicNavigationPreferenceProjection,
} from '../src/topic/reader-topic-navigation-preferences.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><main class="reader"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('.reader')!;
root.style.setProperty('--ldp-jump-highlight-color', '#112233');
let performance: {
	streamOverscanScreens: number;
	streamMaxMountedPostCount: number;
} = {
	streamOverscanScreens: 1.5,
	streamMaxMountedPostCount: 72,
};
const initialPreferences = {
	jumpHighlightColor: '#ABCDEF',
	jumpHighlightRadius: 12,
	jumpHighlightBorderWidth: 2,
	jumpHighlightRate: 1.3,
	jumpHighlightCount: 3,
} as const;
const projection = new ReaderTopicNavigationPreferenceProjection({
	root,
	preferences: initialPreferences,
	readPerformance: () => performance,
});
assert(
	projection.readOverscan().beforeScreens === 1.5 &&
	projection.readOverscan().afterScreens === 1.5 &&
	projection.readMaxMountedPostCount() === 72,
	'性能设置必须同时驱动树状根窗口前后预加载与整棵分支 DOM 预算',
);
assert(
	projection.snapshot.highlightColor === '#abcdef' &&
	projection.snapshot.highlightStepDurationMs === 769 &&
	projection.readHighlightLifetimeMs() === 2_307 &&
	root.style.getPropertyValue('--ldp-jump-highlight-color') === '#abcdef' &&
	root.style.getPropertyValue('--ldp-jump-highlight-radius') === '12px' &&
	root.style.getPropertyValue('--ldp-jump-highlight-border-width') === '2px' &&
	root.style.getPropertyValue('--ldp-jump-highlight-duration') === '769ms' &&
	root.style.getPropertyValue('--ldp-jump-highlight-count') === '3',
	'高亮偏好必须从同一快照投影 CSS 单次时长、次数和总生命周期',
);
const stableSnapshot = projection.snapshot;
projection.apply(initialPreferences);
projection.refreshPerformance();
assert(
	projection.snapshot === stableSnapshot,
	'等价导航与性能偏好不得重建快照或重复投影 CSS',
);
projection.preview({
	...initialPreferences,
	jumpHighlightColor: '#123456',
	jumpHighlightCount: 5,
});
projection.apply({
	...initialPreferences,
	jumpHighlightColor: '#654321',
});
assert(
	String(projection.snapshot.highlightColor) === '#123456' &&
	projection.snapshot.highlightCount === 5,
	'持久偏好更新不得吞掉设置页尚未保存的高亮预览',
);
projection.clearPreview();
assert(
	String(projection.snapshot.highlightColor) === '#654321' &&
	Number(projection.snapshot.highlightCount) === 3,
	'清除预览必须回到预览期间收到的最新持久偏好',
);

performance = {
	streamOverscanScreens: Number.NaN,
	streamMaxMountedPostCount: 72,
};
projection.refreshPerformance();
assert(
	projection.snapshot.overscanScreens === 1.5,
	'无效 overscan 必须回退到统一 schema 的 balanced 默认值',
);

performance = {
	streamOverscanScreens: 99,
	streamMaxMountedPostCount: 2,
};
projection.apply({
	jumpHighlightColor: 'invalid',
	jumpHighlightRadius: 99,
	jumpHighlightBorderWidth: -1,
	jumpHighlightRate: 0,
	jumpHighlightCount: 99,
});
projection.refreshPerformance();
assert(
	Number(projection.snapshot.overscanScreens) === 3 &&
	projection.snapshot.maxMountedPostCount === 24 &&
	String(projection.snapshot.highlightColor) === '#0888cc' &&
	projection.snapshot.highlightRadius === 24 &&
	projection.snapshot.highlightBorderWidth === 0 &&
	projection.snapshot.highlightRate === 0.5 &&
	Number(projection.snapshot.highlightCount) === 6,
	'projection 必须在绕过 schema 时仍按现行边界安全降级',
);

projection.destroy();
assert(
	root.style.getPropertyValue('--ldp-jump-highlight-color') === '#112233' &&
	!root.style.getPropertyValue('--ldp-jump-highlight-radius') &&
	!root.style.getPropertyValue('--ldp-jump-highlight-duration'),
	'销毁必须恢复接管前 inline CSS，不遗留跨 runtime 状态',
);
