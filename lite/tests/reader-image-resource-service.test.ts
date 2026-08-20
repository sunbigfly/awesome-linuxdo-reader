import { ReaderImageResourceService } from '../src/media/reader-image-resource-service.js';
import type { ReaderLightboxItem } from '../src/media/reader-lightbox-controller.js';
import type { PublicResourceRequestAdapter } from '../src/network/public-resource-request-adapter.js';
import { RequestStatusError } from '../src/network/coordinated-request-client.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const first: ReaderLightboxItem = {
	key: '10:1:0',
	topicId: 10,
	sourcePostNumber: 1,
	imageOrder: 0,
	previewSrc: 'https://linux.do/a-small.png',
	originalSrc: 'https://linux.do/a.png',
	alt: 'A',
};
const second: ReaderLightboxItem = {
	...first,
	key: '10:1:1',
	imageOrder: 1,
	previewSrc: 'https://linux.do/b-small.png',
	originalSrc: 'https://linux.do/b.png',
	alt: 'B',
};
const recursiveFallback: ReaderLightboxItem = {
	...first,
	key: '10:1:2',
	imageOrder: 2,
	previewSrc: 'https://linux.do/c-small.png',
	originalSrc: 'https://linux.do/c-original.png',
	fallbackSrcs: Object.freeze([
		'https://linux.do/c-original-download.png?dl=1',
		'https://linux.do/c-large.png',
		'https://linux.do/c-medium.png',
	]),
	originalFallbackCount: 1,
	alt: 'C',
};
const alternateOriginal: ReaderLightboxItem = {
	...first,
	key: '10:1:3',
	imageOrder: 3,
	previewSrc: 'https://linux.do/d-small.png',
	originalSrc: 'https://cdn.linux.do/d-original.png',
	fallbackSrcs: Object.freeze([
		'https://linux.do/uploads/short-url/d.png?dl=1',
	]),
	originalFallbackCount: 1,
	alt: 'D',
};
const blobs = new Map<string, Blob>();
blobs.set(first.previewSrc, new Blob(['preview-a'], { type: 'image/png' }));
blobs.set(first.originalSrc, new Blob(['original-a'], { type: 'image/png' }));
blobs.set(second.previewSrc, new Blob(['preview-b'], { type: 'image/png' }));
blobs.set(second.originalSrc, new Blob(['original-b'], { type: 'image/png' }));
blobs.set(
	recursiveFallback.fallbackSrcs![2]!,
	new Blob(['medium-c'], { type: 'image/png' }),
);
blobs.set(
	alternateOriginal.fallbackSrcs![0]!,
	new Blob(['original-d'], { type: 'image/png' }),
);
const cache = new Map<string, Blob>();
const invalidated: string[] = [];
const invalidationBatches: string[][] = [];
const calls: string[] = [];
const loadValidations: Array<string | undefined> = [];
const normalize = (source: string): string =>
	new URL(source, 'https://linux.do/').href;
const resources = {
	normalize(source: string) {
		return normalize(source);
	},
	async load(source: string, options?: { readonly validation?: string }) {
		const normalized = normalize(source);
		calls.push(normalized);
		loadValidations.push(options?.validation);
		const blob = blobs.get(normalized);
		if (!blob) throw new RequestStatusError(404);
		cache.set(normalized, blob);
		return blob;
	},
	async cached(source: string) {
		return cache.get(normalize(source)) ?? null;
	},
	async invalidate(source: string) {
		const normalized = normalize(source);
		invalidated.push(normalized);
		cache.delete(normalized);
	},
	async invalidateWithReport(source: string) {
		const normalized = normalize(source);
		invalidated.push(normalized);
		cache.delete(normalized);
		return {
			memoryEntries: 1,
			failures: [],
			complete: true,
		};
	},
	async invalidateManyWithReport(sources: readonly string[]) {
		const normalized = [...new Set(sources.map((source) => normalize(source)))];
		invalidationBatches.push(normalized);
		for (const source of normalized) {
			invalidated.push(source);
			cache.delete(source);
		}
		return {
			memoryEntries: normalized.length,
			failures: [],
			complete: true,
		};
	},
} as unknown as PublicResourceRequestAdapter;
let objectIndex = 0;
const revoked: string[] = [];
const service = new ReaderImageResourceService({
	resources,
	objectUrls: {
		createObjectURL() {
			objectIndex += 1;
			return `blob:test-${objectIndex}`;
		},
		revokeObjectURL(source) {
			revoked.push(source);
		},
	},
	maxObjectUrls: 1,
});
const firstSource = await service.load(first, { refresh: false, cachedOnly: false });
const repeatedSource = await service.load(first, { refresh: false, cachedOnly: true });
assert(
	firstSource?.source === 'blob:test-1' &&
	firstSource.original &&
	repeatedSource?.source === firstSource.source &&
	repeatedSource.original &&
	calls.length === 1,
	'原图展示与 cachedOnly 必须复用同一 Blob/Object URL',
);
await service.load(second, { refresh: false, cachedOnly: false });
assert(
	revoked.includes('blob:test-1') &&
	service.diagnostics().objectUrls === 1 &&
	service.diagnostics().objectUrlLimit === 1,
	'Object URL LRU 超限时必须由唯一资源 owner 回收',
);
const alternateCallStart = calls.length;
const alternate = await service.load(alternateOriginal, {
	refresh: false,
	cachedOnly: false,
});
assert(
	alternate?.source === 'blob:test-3' &&
		alternate.original &&
		calls.slice(alternateCallStart).join(',') === [
			alternateOriginal.originalSrc,
			...alternateOriginal.fallbackSrcs!,
		].join(','),
	'主 CDN original 不可用时必须继续检查同一原图的下载来源，成功后仍标记为原图',
);
const fallbackCallStart = calls.length;
const degraded = await service.load(recursiveFallback, {
	refresh: false,
	cachedOnly: false,
});
assert(
	degraded?.source === 'blob:test-4' &&
		!degraded.original &&
		calls.slice(fallbackCallStart).join(',') === [
			recursiveFallback.originalSrc,
			...recursiveFallback.fallbackSrcs!,
		].join(','),
	'original 与较大后备源确认不存在后，必须按候选顺序递归降级到首个可用图片',
);
cache.delete(first.originalSrc);
const fallback = await service.blob(first);
assert(
	await fallback.text() === 'preview-a' &&
	calls.at(-1) === first.previewSrc,
	'非强制原图下载必须优先缓存原图并稳健回退预览图',
);
const original = await service.blob(first, { original: true, refresh: true });
assert(
	await original.text() === 'original-a' &&
	invalidated.includes(first.originalSrc),
	'强制刷新原图必须统一失效 Blob cache 与 Object URL',
);
cache.delete(first.originalSrc);
cache.delete(second.originalSrc);
assert(
	await service.missingOriginalCount([first, second]) === 2,
	'批量下载缺失原图统计必须复用同一缓存真相',
);
const invalidationReport = await service.invalidateSources([
	first.originalSrc,
	first.originalSrc,
]);
assert(
	invalidationReport.complete &&
		invalidationReport.memoryEntries === 1 &&
		invalidationBatches.length === 1 &&
		invalidationBatches[0]?.length === 1 &&
		invalidated.filter((source) => source === first.originalSrc).length === 2,
	'主题图片失效必须先去重并只提交一个批次，再向当前主题重建事务返回精确缓存报告',
);
service.destroy();
assert(revoked.includes('blob:test-4'), '销毁资源服务必须回收剩余 Object URL');

const avatarCallStart = calls.length;
const avatarService = new ReaderImageResourceService({
	resources,
	objectUrls: {
		createObjectURL() {
			return 'blob:avatar-source';
		},
		revokeObjectURL() {},
	},
});
const avatarSource = await avatarService.resolveSource(first.previewSrc);
const repeatedAvatarSource = await avatarService.resolveSource(first.previewSrc);
assert(
	avatarSource === 'blob:avatar-source' &&
		repeatedAvatarSource === avatarSource &&
		calls.length === avatarCallStart + 1,
	'页面上下文无法直连的头像必须复用统一 Blob 请求、缓存与 Object URL',
);
const validatedAvatarSource = await avatarService.resolveAvatarSource(
	first.previewSrc,
);
assert(
	validatedAvatarSource === first.previewSrc &&
		loadValidations.at(-1) === 'discourse-avatar',
	'持久头像必须经 Discourse 空头像校验后返回稳定 URL，不占用 Object URL LRU',
);
avatarService.destroy();

let avatarConsumerSignal: AbortSignal | null = null;
const cancellableAvatarResources = {
	normalize(source: string) {
		return normalize(source);
	},
	load(_source: string, options: { readonly signal: AbortSignal }) {
		avatarConsumerSignal = options.signal;
		return new Promise<Blob>((_resolve, reject) => {
			options.signal.addEventListener(
				'abort',
				() => reject(options.signal.reason),
				{ once: true },
			);
		});
	},
} as unknown as PublicResourceRequestAdapter;
const cancellableAvatarService = new ReaderImageResourceService({
	resources: cancellableAvatarResources,
	objectUrls: {
		createObjectURL() {
			return 'blob:cancellable-avatar';
		},
		revokeObjectURL() {},
	},
});
const avatarConsumer = new AbortController();
const cancelledAvatar = cancellableAvatarService.resolveAvatarSource(
	first.previewSrc,
	avatarConsumer.signal,
).then(
	() => null,
	(error: unknown) => error,
);
const avatarCancellationReason = new Error('avatar host detached');
avatarConsumer.abort(avatarCancellationReason);
assert(
	await cancelledAvatar === avatarCancellationReason &&
		(avatarConsumerSignal as AbortSignal | null)?.aborted === true,
	'头像 DOM 生命周期取消必须贯通到资源仓库消费者，最后一个消费者离开后允许统一请求链终止 producer',
);
cancellableAvatarService.destroy();

let resolveShared!: (blob: Blob) => void;
let rejectShared!: (error: unknown) => void;
const sharedBlob = new Promise<Blob>((resolve, reject) => {
	resolveShared = resolve;
	rejectShared = reject;
});
let producerSignal: AbortSignal | null = null;
const sharedResources = {
	normalize(source: string) {
		return normalize(source);
	},
	async cached() {
		return null;
	},
	async invalidate() {},
	async invalidateWithReport() {
		return { memoryEntries: 0, failures: [], complete: true };
	},
	load(_source: string, options: { readonly signal: AbortSignal }) {
		if (!producerSignal) {
			producerSignal = options.signal;
			options.signal.addEventListener(
				'abort',
				() => rejectShared(options.signal.reason),
				{ once: true },
			);
		}
		return sharedBlob;
	},
} as unknown as PublicResourceRequestAdapter;
const sharedService = new ReaderImageResourceService({
	resources: sharedResources,
	objectUrls: {
		createObjectURL() {
			return 'blob:shared';
		},
		revokeObjectURL() {},
	},
});
const consumer = new AbortController();
const cancelled = sharedService.blob(first, {
	original: true,
	signal: consumer.signal,
}).then(
	() => null,
	(error: unknown) => error,
);
const visible = sharedService.load(first, {
	refresh: false,
	cachedOnly: false,
}).then(
	(value) => ({ value, error: null }),
	(error: unknown) => ({ value: null, error }),
);
const cancelledReason = new Error('batch cancelled');
consumer.abort(cancelledReason);
assert(
		await cancelled === cancelledReason &&
		(producerSignal as AbortSignal | null)?.aborted === false,
	'单个下载消费者取消时不得中止同 URL 的共享 Blob producer',
);
resolveShared(new Blob(['shared-image'], { type: 'image/png' }));
const visibleResult = await visible;
assert(
	visibleResult.value?.source === 'blob:shared' &&
		visibleResult.value.original &&
		visibleResult.error === null,
	'下载取消后仍在等待的灯箱显示消费者必须能收到共享 Blob',
);
sharedService.destroy();
