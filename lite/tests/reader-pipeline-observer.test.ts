import { ReaderPipelineObserver } from
	'../src/monitor/reader-pipeline-observer.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

let now = 1_000;
const observer = new ReaderPipelineObserver({
	sourceId: 'test-tab',
	now: () => now,
});
const preheatTrace = observer.begin({
	kind: 'topic-preheat',
	topicId: 42,
	source: 'host-card',
});
now += 5;
const openTrace = observer.begin({
	kind: 'topic-open',
	topicId: 42,
	source: 'link',
	targetPostNumber: 9,
});
assert(
	observer.snapshot.activeTraces === 2 &&
	observer.resolve({ topicId: 42 }) === openTrace,
	'同 Topic 的预热与打开可并存，请求应关联最新活动 trace',
);
now += 15;
observer.mark(openTrace, 'dom-first-commit');
now += 10;
observer.mark(openTrace, 'first-visible-frame');
now += 20;
observer.mark(openTrace, 'anchor-settled', { durationMs: 18 });
observer.finish(openTrace);
now += 5;
observer.mark(openTrace, 'first-visible-frame');
observer.mark(preheatTrace, 'preheat-ready');
observer.finish(preheatTrace);
const scrollTrace = observer.begin({
	kind: 'scroll',
	topicId: 42,
	source: 'direct-user-scroll',
});
observer.mark(scrollTrace, 'scroll-frame-commit', { durationMs: 12 });
observer.mark(scrollTrace, 'scroll-dom-commit', { durationMs: 85 });
observer.finish(scrollTrace);
assert(
	observer.snapshot.metrics.firstDom.p95Ms === 15 &&
	observer.snapshot.metrics.firstVisible.count === 2 &&
	observer.snapshot.metrics.firstVisible.p95Ms === 50 &&
	observer.snapshot.metrics.anchorSettled.p95Ms === 18 &&
	observer.snapshot.metrics.scrollCommit.p95Ms === 12 &&
	observer.snapshot.events.every((event) =>
		event.traceId === openTrace || event.traceId === preheatTrace ||
			event.traceId === scrollTrace),
	'流水线账本必须生成可联结 traceId，允许首可见 rAF 在 trace 结束后补账，并分别聚合首 DOM、首帧、锚定与滚动首帧；后续 DOM 换窗不得污染滚动响应口径',
);
