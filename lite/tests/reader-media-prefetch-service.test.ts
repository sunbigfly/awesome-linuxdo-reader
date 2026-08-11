import { parseHTML } from 'linkedom';
import {
	ReaderMediaPrefetchService,
} from '../src/media/reader-media-prefetch-service.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML('<html><body></body></html>');
const document = parsedDocument as unknown as Document;
const calls: Array<Readonly<{
	source: string;
	profile: string | undefined;
}>> = [];
let active = 0;
let maxActive = 0;
const service = new ReaderMediaPrefetchService({
	document,
	baseUrl: 'https://forum.example/t/1',
	concurrency: 2,
	resources: {
		async load(source, options) {
			calls.push({ source, profile: options.profile });
			active += 1;
			maxActive = Math.max(maxActive, active);
			await Promise.resolve();
			active -= 1;
			if (source.endsWith('/b.png')) throw new Error('broken');
			return new Blob(['image']);
		},
	},
});

const progress: string[] = [];
let idleChecks = 0;
const result = await service.prefetch({
	posts: [{
		cooked: [
			'<p><img src="/a.png"><img data-src="/b.png"></p>',
			'<img src="data:image/gif;base64,AA==" data-src="/lazy.png">',
			'<img src="data:image/png;base64,AA==">',
		].join(''),
		boosts: [{ cooked: '<img data-large-src="/boost.png">' }],
		reactions: [{ id: 'smile' }],
	}],
	signal: new AbortController().signal,
	reactionSources: () => [
		'https://cdn.example/smile.png',
		'https://forum.example/a.png',
	],
	waitUntilIdle: async () => {
		idleChecks += 1;
	},
	onProgress: (snapshot) => progress.push(
		`${snapshot.loadedCount}/${snapshot.totalCount}/${snapshot.failedCount}`,
	),
});

assert(
	calls.map((call) => call.source).sort().join(',') === [
		'https://cdn.example/smile.png',
		'https://forum.example/a.png',
		'https://forum.example/b.png',
		'https://forum.example/boost.png',
		'https://forum.example/lazy.png',
	].sort().join(',') &&
	calls.every((call) => call.profile === 'resource-prefetch'),
	'媒体预取必须去重正文、Boost 与宿主回应图片，并只进入中央 resource-prefetch profile',
);
assert(
	result.loadedCount === 4 &&
	result.totalCount === 5 &&
	result.failedCount === 1 &&
	!result.complete &&
	idleChecks === 5 &&
	maxActive === 2 &&
	progress[0] === '0/5/0' &&
	progress.at(-1) === '4/5/1',
	'媒体预取必须兼容 lazy 占位图、限制两路并发、逐资源让行并持续报告 partial 覆盖度',
);

const aborted = new AbortController();
aborted.abort(new DOMException('queue closed', 'AbortError'));
try {
	await service.prefetch({
		posts: [{ cooked: '<img src="/late.png">' }],
		signal: aborted.signal,
	});
	throw new Error('已取消的媒体预取不得继续请求');
} catch (error) {
	assert(
		error instanceof DOMException && error.name === 'AbortError',
		'媒体预取必须保留阅读队列 AbortSignal 的取消语义',
	);
}
