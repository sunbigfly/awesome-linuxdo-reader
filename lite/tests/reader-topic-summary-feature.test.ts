import { parseHTML } from 'linkedom';
import type { ActionRequest } from '../src/network/domain-request-gateway.js';
import type { ReaderLightboxItem } from
	'../src/media/reader-lightbox-controller.js';
import {
	BrowserDiscourseNativeMutationTransport,
} from '../src/network/discourse-native-read-transport.js';
import {
	normalizeReaderTopicSummary,
	ReaderTopicSummaryImageUploadAdapter,
	ReaderTopicSummaryRequestAdapter,
	type ReaderTopicSummary,
} from '../src/post/reader-topic-summary-request-adapter.js';
import {
	READER_TOPIC_SUMMARY_RESULTS_STORAGE_KEY,
	READER_TOPIC_SUMMARY_SHARE_SETTINGS_KEY,
	renderReaderTopicSummaryShareImage,
	ReaderTopicSummarySurface,
	type ReaderTopicSummaryShareImageOptions,
} from '../src/post/reader-topic-summary-surface.js';
import { normalizeReaderAiModelCatalogEntry } from
	'../src/translation/reader-translation-config.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class RecordingGateway {
	readonly requests: ActionRequest<unknown>[] = [];

	async mutate<T>(input: ActionRequest<T>): Promise<T> {
		this.requests.push(input as ActionRequest<unknown>);
		const response = await input.transport({
			signal: input.signal,
			attempt: 1,
		});
		return response.value;
	}
}

const gateway = new RecordingGateway();
const nativeCalls: Array<{
	readonly path: string;
	readonly options: Readonly<Record<string, unknown>>;
}> = [];
const nativeTransport = new BrowserDiscourseNativeMutationTransport({
	lookup() {
		return null;
	},
	lookupModule(name) {
		if (name !== 'discourse/lib/ajax') return null;
		return {
			ajax(path: string, options: Readonly<Record<string, unknown>>) {
				nativeCalls.push({ path, options });
				if (path === '/uploads.json') {
					return Promise.resolve(Object.freeze({
						url: '/uploads/default/original/summary.png',
						short_url: 'upload://summary.png',
						original_filename: 'summary.png',
						width: 1_080,
						height: 720,
					}));
				}
				return Promise.resolve(Object.freeze({
					ai_topic_summary: Object.freeze({
						summarized_text: '第一条结论\n\n- 第二条结论',
						algorithm: 'test-model',
						outdated: false,
						can_regenerate: true,
						new_posts_since_summary: 2,
						summarized_on: '2026-08-15T00:00:00.000Z',
					}),
				}));
			},
		};
	},
});
const controller = new AbortController();
const requestAdapter = new ReaderTopicSummaryRequestAdapter({
	gateway,
	transport: nativeTransport,
	authScope: 'account:test',
	topicId: 42,
	signal: controller.signal,
});
const requestedSummary = await requestAdapter.request();
const request = gateway.requests[0]!;
assert(
	request.operation === 'topic-summary' &&
	request.targetType === 'topic' &&
	request.targetId === 42 &&
	request.method === 'POST' &&
	request.timeoutMs === 120_000,
	'官方总结必须经过统一 action identity，并给模型生成保留 120 秒有界等待',
);
assert(
	String(request.input) === '/discourse-ai/summarization/t/42' &&
	nativeCalls[0]?.path === '/discourse-ai/summarization/t/42' &&
	nativeCalls[0]?.options.type === 'POST' &&
	nativeCalls[0]?.options.cache === false,
	'官方总结必须使用 Discourse 原生 ajax 非流式 POST 且不得浏览器缓存',
);
assert(
	requestedSummary.summarizedText.includes('第一条结论') &&
	requestedSummary.canRegenerate &&
	requestedSummary.newPostsSinceSummary === 2 &&
	requestedSummary.updatedAt === '2026-08-15T00:00:00.000Z',
	'官方 ai_topic_summary 包装及 serializer 字段必须归一成稳定领域结果',
);

let emptyRejected = false;
try {
	normalizeReaderTopicSummary({ summarized_text: '   ' });
} catch (cause) {
	emptyRejected = cause instanceof Error && cause.message.includes('没有返回');
}
assert(emptyRejected, '空 serializer 不得伪装成成功总结');

const uploadAdapter = new ReaderTopicSummaryImageUploadAdapter({
	gateway,
	transport: nativeTransport,
	authScope: 'account:test',
	topicId: 42,
	signal: controller.signal,
});
const uploaded = await uploadAdapter.upload(
	new Blob(['png'], { type: 'image/png' }),
	'summary.png',
);
const uploadRequest = gateway.requests[1]!;
const uploadOptions = nativeCalls[1]?.options;
const uploadData = uploadOptions?.data as FormData | undefined;
assert(
	uploadRequest.operation === 'topic-summary-image-upload' &&
	uploadRequest.targetId === 42 &&
	uploadRequest.variant === 'summary-image' &&
	String(uploadRequest.input) === '/uploads.json' &&
	nativeCalls[1]?.path === '/uploads.json',
	'总结图片上传必须有独立 action identity 并使用官方 uploads.json',
);
assert(
	uploadOptions?.processData === false &&
	uploadOptions?.contentType === false &&
	uploadData?.get('upload_type') === 'composer' &&
	(uploadData?.get('files[]') as Blob | null)?.size === 3 &&
	uploaded.shortUrl === 'upload://summary.png' &&
	uploaded.width === 1_080,
	'multipart 必须按 Composer 协议原样交给原生 ajax，并归一上传回调链接',
);

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main id="mount"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const EventConstructor = parsedWindow.Event as unknown as typeof Event;
const mount = document.querySelector<HTMLElement>('#mount')!;
const fontLoads: Array<{ readonly font: string; readonly text: string }> = [];
Object.defineProperty(document, 'fonts', {
	configurable: true,
	value: Object.freeze({
		async load(font: string, text = ''): Promise<readonly unknown[]> {
			fontLoads.push({ font, text });
			return Object.freeze([]);
		},
	}),
});
const summary: ReaderTopicSummary = Object.freeze({
	summarizedText: '这是一段 official summary。\n\n包含可复用的第二段。',
	algorithm: 'test-model',
	source: 'official',
	outdated: false,
	canRegenerate: true,
	newPostsSinceSummary: 0,
	updatedAt: '2026-08-15T00:00:00.000Z',
});
let summaryRequests = 0;
const copied: string[] = [];
const saved: Array<{ readonly blob: Blob; readonly filename: string }> = [];
const imageOptions: ReaderTopicSummaryShareImageOptions[] = [];
const previewOptions: ReaderTopicSummaryShareImageOptions[] = [];
const previewedImages: Array<Readonly<{
	readonly blob: Blob;
	readonly alt: string;
	readonly returnFocus: HTMLElement;
}>> = [];
const uploadedBlobs: Array<{ readonly blob: Blob; readonly filename: string }> = [];
const openedReplies: string[] = [];
const notifications: string[] = [];
const errors: unknown[] = [];
const customRequests: Array<Readonly<{
	readonly model: Readonly<{ readonly baseUrl: string; readonly model: string }>;
	readonly modelContextTokens?: number;
	readonly scope: string;
	readonly purpose?: string;
	readonly length?: string;
	readonly floorRange?: string;
	readonly customPrompt?: string;
	readonly images?: readonly unknown[];
	readonly refresh?: boolean;
}>> = [];
let imagePickerCalls = 0;
let deferImagePicker = false;
let resolveDeferredImagePicker:
	| ((items: readonly ReaderLightboxItem[] | null) => void)
	| null = null;
let localFontQueries = 0;
const stored = new Map<string, string>([[
	'ldp:topic-summary-share-settings:v1',
	JSON.stringify({
		schemaVersion: 1,
		style: 'mist',
		chineseFont: 'local:Noto Sans CJK SC',
		latinFont: 'local:Inter',
		customModelBaseUrl: 'https://api.example.com/v1',
		customModel: 'summary-test-model',
	}),
]]);
stored.set(
	'ldp:topic-summary-window-geometry:v1:floating',
	JSON.stringify({
		readerWindowWidth: 520,
		readerWindowHeight: 700,
		readerWindowX: 120,
		readerWindowY: 80,
		readerWindowLocked: false,
		readerWindowPinned: false,
	}),
);
stored.set(
	'ldp:topic-summary-window-geometry:v1:fullpage',
	JSON.stringify({
		readerWindowWidth: 620,
		readerWindowHeight: 680,
		readerWindowX: 24,
		readerWindowY: 36,
		readerWindowLocked: false,
		readerWindowPinned: false,
	}),
);
let positionMode = 'floating';
const surface = new ReaderTopicSummarySurface({
	document,
	mount,
	request: {
		async request() {
			summaryRequests += 1;
			return summary;
		},
	},
	customRequest: {
		async request(input) {
			customRequests.push(input);
			input.onProgress?.('loading-posts', '已命中完整楼层缓存，共 4 楼');
			input.onProgress?.('building-tree', '正在构建回复关系树');
			input.onProgress?.('summarizing', '自定义 AI 正在提炼主题');
			input.onProgress?.('finalizing', '正在整理用户链接');
			return Object.freeze({
				summarizedText:
					'楼主给出结论，[@alice](https://linux.do/u/alice) 随后补充限制。',
				algorithm: 'custom-test-model',
				source: 'custom',
				scope: input.scope,
				outdated: false,
				canRegenerate: false,
				newPostsSinceSummary: 0,
				updatedAt: '2026-08-15T02:00:00.000Z',
			});
		},
	},
	aiModels: {
		async availableModels() {
			const catalog = Object.freeze([
				normalizeReaderAiModelCatalogEntry({
					id: 'summary-test-model',
					name: 'Summary Pro',
					context_length: 128_000,
					architecture: { output_modalities: ['text'] },
					benchmarks: {
						artificial_analysis: { intelligence_index: 68 },
					},
				})!,
			]);
			return Object.freeze([
				Object.freeze({
					baseUrl: 'https://api.example.com/v1',
					models: Object.freeze(['summary-test-model']),
					catalog,
				}),
				Object.freeze({
					baseUrl: 'https://second.example.com/v1',
					models: Object.freeze(['summary-test-model']),
					catalog,
				}),
			]);
		},
	},
	imagePicker: {
		async choose(_initialItems, options) {
			imagePickerCalls += 1;
			options?.onCatalog?.(3);
			if (deferImagePicker) {
				return new Promise<readonly ReaderLightboxItem[] | null>((resolve) => {
					resolveDeferredImagePicker = resolve;
				});
			}
			return Object.freeze([Object.freeze({
				key: '42:2:0:image',
				topicId: 42,
				sourcePostNumber: 2,
				imageOrder: 0,
				previewSrc: 'https://linux.do/image-small.png',
				originalSrc: 'https://linux.do/image.png',
				alt: '测试图片',
			})]);
		},
	},
	imageResources: {
		async blob() {
			return new Blob(['png'], { type: 'image/png' });
		},
	},
	topicTitle: () => '优雅 Test 主题',
	topicUrl: () => 'https://linux.do/t/topic/42',
	clipboard: {
		async copyText(value) {
			copied.push(value);
		},
	},
	downloads: {
		save(blob, filename) {
			saved.push({ blob, filename });
		},
	},
	uploader: {
		async upload(blob, filename) {
			uploadedBlobs.push({ blob, filename });
			return Object.freeze({
				url: '/uploads/default/original/summary.png',
				shortUrl: 'upload://summary.png',
				originalFilename: filename,
				width: 1_080,
				height: 720,
			});
		},
	},
	openReply: async (raw) => {
		openedReplies.push(raw);
	},
	fonts: {
		readCurrentFamily: () => 'Reader Current, sans-serif',
		async queryLocalFonts() {
			localFontQueries += 1;
			return [
				'Inter',
				'JetBrains Mono',
				'Noto Sans CJK SC',
				'Source Han Serif SC',
			];
		},
	},
	settingsStorage: {
		getItem: (key) => stored.get(key) ?? null,
		setItem: (key, value) => {
			stored.set(key, value);
		},
	},
	positionMode: () => positionMode,
	renderShareImage: (_canvas, options) => {
		previewOptions.push(options);
	},
	async createShareImage(options) {
		imageOptions.push(options);
		return new Blob(['png'], { type: 'image/png' });
	},
	previewImage: async (input) => {
		previewedImages.push(input);
	},
	notify: (message) => notifications.push(message),
	onError: (cause) => errors.push(cause),
});

const drawCalls: Array<Readonly<{
	readonly text: string;
	readonly y: number;
	readonly color: string;
}>> = [];
const fakeContext = {
	font: '',
	fillStyle: '',
	strokeStyle: '',
	lineWidth: 1,
	globalAlpha: 1,
	textAlign: 'left',
	measureText: (text: string) => ({ width: Array.from(text).length * 12 }),
	fillText(this: { readonly fillStyle: unknown }, text: string, _x: number, y: number) {
		drawCalls.push({ text, y, color: String(this.fillStyle) });
	},
	createLinearGradient: () => ({ addColorStop() {} }),
	fillRect() {},
	strokeRect() {},
	beginPath() {},
	arc() {},
	fill() {},
	stroke() {},
	moveTo() {},
	lineTo() {},
	bezierCurveTo() {},
	save() {},
	restore() {},
} as unknown as CanvasRenderingContext2D;
const layoutCanvas = document.createElement('canvas');
Object.defineProperty(layoutCanvas, 'getContext', {
	configurable: true,
	value: () => fakeContext,
});
renderReaderTopicSummaryShareImage(layoutCanvas, {
	document,
	summary: Object.freeze({
		...summary,
		summarizedText:
			'该讨论围绕 [Cloudnet](https://linux.do/u/cloudnet) 测速显示绿色但使用十几分钟后\n超时的问题展开。' +
			'其他用户提出节点不稳定、运营商限流、网络环境变化、CDN 域名以及 DNS 问题。',
	}),
	topicTitle: '链接与分行测试',
	topicUrl: 'https://linux.do/t/topic/42',
	style: 'paper',
	chineseFontFamily: 'Noto Sans CJK SC',
	latinFontFamily: 'Inter',
});
assert(
	drawCalls.filter(({ y }) => y === 278)
		.reduce((width, { text }) => width + Array.from(text).length * 12, 0) >= 700 &&
	drawCalls.some(({ text, color }) =>
		text === 'Cloudnet' && color === '#4f745f'
	) &&
	layoutCanvas.height === 500,
	'分享图必须按 CJK 字符填满可用行宽、突出返回链接，并收紧短内容尾部留白',
);
const longDrawStart = drawCalls.length;
const longCanvas = document.createElement('canvas');
Object.defineProperty(longCanvas, 'getContext', {
	configurable: true,
	value: () => fakeContext,
});
renderReaderTopicSummaryShareImage(longCanvas, {
	document,
	summary: Object.freeze({
		...summary,
		summarizedText: [
			...Array.from(
				{ length: 34 },
				(_, index) => `第 ${index + 1} 组资料：保留用途、链接与限制说明。`,
			),
			'FINAL-RESOURCE-KEPT',
		].join('\n\n'),
	}),
	topicTitle: '这是一条需要自动换行且不能省略内容的长标题'.repeat(5),
	topicUrl: 'https://linux.do/t/topic/42',
	style: 'ink',
	chineseFontFamily: 'Noto Sans CJK SC',
	latinFontFamily: 'Inter',
});
const longDrawCalls = drawCalls.slice(longDrawStart);
assert(
	longCanvas.height > 1_800 &&
	longDrawCalls.some(({ text }) => text.includes('FINAL-RESOURCE-KEPT')) &&
	longDrawCalls.some(({ y }) => y === 234),
	'长总结与长标题必须完整绘制，并由内容行数自动扩展分享图高度',
);
const customSizeCanvas = document.createElement('canvas');
Object.defineProperty(customSizeCanvas, 'getContext', {
	configurable: true,
	value: () => fakeContext,
});
renderReaderTopicSummaryShareImage(customSizeCanvas, {
	document,
	summary,
	topicTitle: '自定义画布与字号',
	topicUrl: 'https://linux.do/t/topic/42',
	style: 'paper',
	chineseFontFamily: 'Noto Sans CJK SC',
	latinFontFamily: 'Inter',
	width: 1_360,
	bodyFontSize: 36,
});
assert(
	customSizeCanvas.width === 1_360 && customSizeCanvas.height >= 500,
	'分享图 renderer 必须接收自定义宽度与字号，且继续按内容计算完整高度',
);

function click(target: Element): void {
	target.dispatchEvent(new EventConstructor('click', {
		bubbles: true,
		cancelable: true,
		composed: true,
	}));
}

function change(target: Element): void {
	target.dispatchEvent(new EventConstructor('change', {
		bubbles: true,
		cancelable: true,
		composed: true,
	}));
}

function input(target: Element): void {
	target.dispatchEvent(new EventConstructor('input', {
		bubbles: true,
		cancelable: true,
		composed: true,
	}));
}

function selectValue(select: HTMLSelectElement, value: string): void {
	for (const option of select.options) {
		option.selected = false;
		option.removeAttribute('selected');
	}
	const selected = [...select.options].find((option) => option.value === value);
	if (!selected) return;
	selected.selected = true;
	selected.setAttribute('selected', '');
}

async function flush(): Promise<void> {
	await Promise.resolve();
	await new Promise((resolve) => setTimeout(resolve, 0));
}

surface.open();
await flush();
assert(
	summaryRequests === 0 &&
	surface.sourceSelect.value === 'official' &&
	surface.root.textContent?.includes('不是全楼层总结') &&
	surface.generateButton.textContent?.includes('获取官方总结'),
	'打开浮窗必须默认官方来源并先解释站点选帖规则，不得自动消耗总结请求',
);
click(surface.generateButton);
await flush();
assert(
	!surface.root.hidden &&
	surface.frame.isOpen &&
	surface.frame.active &&
	surface.frame.element.classList.contains('is-topic-summary') &&
	surface.frame.element.classList.contains('is-standalone') &&
	!surface.frame.tabList.isConnected &&
	!surface.frame.header.querySelector('.ldp-reader-floating-window-tab') &&
	!surface.frame.title.hidden &&
	surface.frame.header.dataset.readerFloatingDragSurface === 'topic-summary' &&
	surface.historyButton.nextElementSibling === surface.settingsButton &&
	surface.settingsButton.nextElementSibling === surface.closeButton &&
	surface.frame.host.style.zIndex === '2147483586' &&
	surface.frame.geometry.snapshot.geometry.left === 120 &&
	Number(summaryRequests) === 1 &&
	surface.generateButton.parentElement?.classList.contains(
		'ldp-topic-summary-method-row',
	) &&
	surface.root.querySelector<HTMLElement>(
		'.ldp-topic-summary-options-row',
	)?.hidden &&
	previewOptions.length > 0 &&
	previewOptions.at(-1)?.style === 'mist' &&
	surface.styleSelect.options.length === 10 &&
	surface.root.querySelectorAll('.ldp-topic-summary-actions > button').length === 4 &&
	[...surface.root.querySelectorAll<HTMLButtonElement>(
		'.ldp-topic-summary-actions > button',
	)].every((button) =>
		Boolean(button.getAttribute('aria-label')) &&
		Boolean(button.querySelector('svg.ldp-icon'))
	) &&
	!surface.root.querySelector('.ldp-topic-summary-retry'),
	'显式获取后必须进入宿主之上的独立可拖动浮窗，并提供十种风格和四个 SVG 操作',
);
positionMode = 'fullpage';
mount.dispatchEvent(new EventConstructor('ldp-reader-workspace-change', {
	bubbles: true,
}));
assert(
	Number(surface.frame.geometry.snapshot.geometry.left) === 24 &&
	surface.frame.geometry.snapshot.geometry.top === 36,
	`阅读器形态变化后必须恢复该形态独立持久化的浮窗位置：${JSON.stringify(
		surface.frame.geometry.snapshot.geometry,
	)}`,
);
surface.close();
surface.open();
await flush();
assert(
	Number(summaryRequests) === 1 &&
	String(stored.get('ldp:topic-summary-results:v1')).includes(
		'这是一段 official summary',
	) &&
	surface.generateButton.textContent?.includes('重新获取官方总结'),
	'关闭重开必须直接恢复持久化官方结果，不得重复请求而触发无意义 429',
);
click(surface.generateButton);
await flush();
assert(
	Number(summaryRequests) === 2 &&
	surface.generateButton.textContent?.includes('重新获取官方总结'),
	'官方结果必须先读缓存，但仍允许用户主动重新获取以记录新增或已编辑楼层',
);
const officialHistory = JSON.parse(
	stored.get('ldp:topic-summary-results:v1') ?? '{}',
) as Readonly<{
	readonly schemaVersion?: number;
	readonly entries?: readonly Readonly<{ readonly key?: string }>[];
}>;
click(surface.historyButton);
assert(
	officialHistory.schemaVersion === 2 &&
	officialHistory.entries?.length === 2 &&
	officialHistory.entries[0]?.key === officialHistory.entries[1]?.key &&
	surface.historyButton.getAttribute('aria-expanded') === 'true' &&
	surface.root.querySelectorAll('.ldp-topic-summary-history-item').length === 2 &&
	surface.root.textContent?.includes('本主题 2 条'),
	'重复获取必须追加独立时间线记录，不能覆盖同一选择的旧版本',
);
click(surface.root.querySelector<HTMLButtonElement>(
	'.ldp-topic-summary-history-entry',
)!);
assert(
	surface.historyButton.getAttribute('aria-expanded') === 'false' &&
	surface.frame.meta.textContent === '历史记录' &&
	!surface.previewCanvas.closest<HTMLElement>(
		'.ldp-topic-summary-preview',
	)?.hidden,
	'点击时间线记录必须退出历史列表并恢复当次可分享结果',
);
stored.set(READER_TOPIC_SUMMARY_RESULTS_STORAGE_KEY, JSON.stringify({
	schemaVersion: 2,
	entries: [
		...(officialHistory.entries ?? []),
		{
			...(officialHistory.entries?.at(-1) ?? {}),
			id: 'remote-tab-summary',
			generatedAt: '2026-08-16T02:00:00.000Z',
		},
	],
}));
stored.set(READER_TOPIC_SUMMARY_SHARE_SETTINGS_KEY, JSON.stringify({
	schemaVersion: 5,
	style: 'sunset',
	chineseFont: 'system',
	latinFont: 'system',
	widthMode: 'social',
	customWidth: 1_080,
	fontSizeMode: 'recommended',
	customFontSize: 31,
	customPrompt: '',
	customModelBaseUrl: 'https://api.example.com/v1',
	customModel: 'summary-test-model',
	summaryLength: 'standard',
	summaryPurpose: 'general',
}));
stored.set(
	'ldp:topic-summary-window-geometry:v1:fullpage',
	JSON.stringify({
		readerWindowWidth: 650,
		readerWindowHeight: 690,
		readerWindowX: 30,
		readerWindowY: 42,
		readerWindowLocked: false,
		readerWindowPinned: false,
	}),
);
surface.reloadExternalState();
click(surface.historyButton);
assert(
	surface.root.querySelectorAll('.ldp-topic-summary-history-item').length === 3 &&
	surface.styleSelect.value === 'sunset' &&
	surface.widthModeSelect.value === 'social' &&
	Number(surface.frame.geometry.snapshot.geometry.left) === 30,
	'其他标签的总结历史、分享设置与当前形态浮窗位置必须由同一局部回调同步',
);
click(surface.historyButton);

click(surface.settingsButton);
await flush();
assert(
	surface.settingsButton.getAttribute('aria-expanded') === 'true' &&
	localFontQueries === 1 &&
	surface.chineseFontSelect.dataset.readerSelectSearchable === 'true' &&
	[...surface.chineseFontSelect.options]
		.some((option) =>
			option.value === 'local:Noto Sans CJK SC' &&
			option.textContent === 'Noto Sans CJK SC'
		) &&
	[...surface.latinFontSelect.options]
		.some((option) => option.value === 'local:Inter') &&
	surface.customWidthInput.hidden &&
	surface.customFontSizeInput.hidden,
	'齿轮必须按需展开风格及中英文字体，并共用设置面板本机字体搜索源',
);

selectValue(surface.styleSelect, 'wisteria');
assert(
	[...surface.styleSelect.options].some((option) =>
		option.value === 'wisteria' && option.selected
	),
	'测试必须能选中新增加的紫藤夜语',
);
change(surface.styleSelect);
selectValue(surface.chineseFontSelect, 'local:Source Han Serif SC');
change(surface.chineseFontSelect);
selectValue(surface.latinFontSelect, 'local:JetBrains Mono');
change(surface.latinFontSelect);
selectValue(surface.widthModeSelect, 'social');
change(surface.widthModeSelect);
assert(
	previewOptions.at(-1)?.width === 1_200 && surface.customWidthInput.hidden,
	'常用社交图档必须即时切换到 1200px，且不显示自定义输入框',
);
selectValue(surface.widthModeSelect, 'custom');
change(surface.widthModeSelect);
surface.customWidthInput.value = '1360';
input(surface.customWidthInput);
selectValue(surface.fontSizeModeSelect, 'custom');
change(surface.fontSizeModeSelect);
surface.customFontSizeInput.value = '36';
input(surface.customFontSizeInput);
await flush();
const persisted = JSON.parse(
	stored.get('ldp:topic-summary-share-settings:v1') ?? '{}',
) as Record<string, unknown>;
assert(
	persisted.style === 'wisteria' &&
	persisted.chineseFont === 'local:Source Han Serif SC' &&
	persisted.latinFont === 'local:JetBrains Mono' &&
	persisted.schemaVersion === 5 &&
	persisted.widthMode === 'custom' &&
	persisted.customWidth === 1_360 &&
	persisted.fontSizeMode === 'custom' &&
	persisted.customFontSize === 36 &&
	!surface.customWidthInput.hidden &&
	!surface.customFontSizeInput.hidden,
	`风格、字体、宽度与字号必须持久化：${JSON.stringify(persisted)}`,
);
assert(
	previewOptions.at(-1)?.style === 'wisteria' &&
	previewOptions.at(-1)?.width === 1_360 &&
	previewOptions.at(-1)?.bodyFontSize === 36 &&
	surface.root.style.getPropertyValue('--ldp-summary-bg-start') === '' &&
	previewOptions.at(-1)?.chineseFontFamily.includes('Source Han Serif SC') &&
	previewOptions.at(-1)?.latinFontFamily.includes('JetBrains Mono') &&
	fontLoads.some(({ font, text }) =>
		font.includes('Source Han Serif SC') && text.includes('汉字')
	) &&
	fontLoads.some(({ font, text }) =>
		font.includes('JetBrains Mono') && text.includes('LinuxDo')
	),
	`中英文字体必须分别加载字形并在就绪后即时重绘：${JSON.stringify({
		preview: previewOptions.at(-1),
		fontLoads,
	})}`,
);

click(surface.previewCanvas);
await flush();
assert(
	surface.previewCanvas.getAttribute('role') === 'button' &&
	surface.previewCanvas.getAttribute('tabindex') === '0' &&
	previewedImages.length === 1 &&
	previewedImages[0]?.blob.type === 'image/png' &&
	previewedImages[0]?.returnFocus === surface.previewCanvas &&
	previewedImages[0]?.alt.includes('优雅 Test 主题'),
	`点击生成图必须把同设置 PNG 交给既有灯箱入口，并保留键盘与焦点返回语义：${JSON.stringify({
		role: surface.previewCanvas.getAttribute('role'),
		tabIndex: surface.previewCanvas.getAttribute('tabindex'),
		count: previewedImages.length,
		type: previewedImages[0]?.blob.type,
		returnFocus: previewedImages[0]?.returnFocus === surface.previewCanvas,
		alt: previewedImages[0]?.alt,
		errors: errors.map((value) => String(value)),
	})}`,
);

click(surface.copyButton);
await flush();
assert(
	copied[0]?.startsWith('> **来自 LinuxDo 官方 AI 总结**') &&
	copied[0]?.includes('> [查看原主题](https://linux.do/t/topic/42)'),
	'复制文字必须输出可直接复用并标注官方来源的 Markdown 引用',
);

click(surface.copyImageButton);
await flush();
assert(
	uploadedBlobs.length === 1 &&
	copied[1]?.includes('![优雅 Test 主题 · LinuxDo 官方 AI 总结]') &&
	copied[1]?.includes('(upload://summary.png)'),
	'复制带图引用必须上传 PNG，并把回调 short_url 整合为可粘贴 Markdown',
);

click(surface.replyButton);
await flush();
assert(
	uploadedBlobs.length === 1 &&
	openedReplies.length === 1 &&
	openedReplies[0] === copied[1] &&
	surface.root.hidden,
	'带图回复必须复用已上传图片并只预填 #1 回复内容，发送仍留给用户',
);

surface.open();
click(surface.downloadButton);
await flush();
assert(
	imageOptions.length === 3 &&
	saved.length === 1 &&
	saved[0]?.blob.type === 'image/png' &&
	saved[0]?.filename === '优雅 Test 主题-AI总结.png',
	'下载路径必须保存与实时预览同设置的 PNG，并保持稳定主题文件名',
);
assert(
	notifications.includes('已复制可粘贴到任意回复框的带图引用') &&
	notifications.includes('图片已带入 #1 回复框，请确认后发送') &&
	notifications.includes('AI 总结分享图已下载') &&
	errors.length === 0,
	'上传、剪贴板、回复预填和下载成功必须给出明确反馈且不得误报错误',
);

selectValue(surface.sourceSelect, 'custom');
change(surface.sourceSelect);
await flush();
selectValue(
	surface.customModelSelect,
	JSON.stringify(['https://api.example.com/v1', 'summary-test-model']),
);
change(surface.customModelSelect);
assert(
	surface.root.querySelector('.ldp-topic-summary-control-row')?.classList
		.contains('is-custom') &&
	surface.root.querySelector('.ldp-topic-summary-method-row')?.children.length === 2 &&
	surface.root.querySelector('.ldp-topic-summary-tuning-row')?.children.length === 2 &&
	surface.root.querySelector('.ldp-topic-summary-options-row')?.children.length === 4 &&
	surface.generateButton.parentElement?.classList.contains(
		'ldp-topic-summary-options-row',
	) &&
	!surface.root.querySelector<HTMLElement>(
		'.ldp-topic-summary-options-row',
	)?.hidden &&
	surface.customModelSelect.querySelectorAll('optgroup').length === 2 &&
	surface.customModelSelect.options[1]?.textContent?.includes('Summary Pro') &&
	surface.customModelSelect.options[1]?.textContent?.includes('基准 68') &&
	surface.summaryPurposeSelect.options.length === 8 &&
	[...surface.summaryPurposeSelect.options].map((option) => option.textContent)
		.join('|') ===
		'自动（推荐）|核心概览|问题求解|教程提炼|观点梳理|决策比较|资源整理|进展追踪' &&
	[...surface.scopeSelect.options].find((option) => option.value === 'all')
		?.textContent === '全文（按 128K 上下文自动取样）' &&
	surface.customPromptInput.closest<HTMLElement>(
		'.ldp-topic-summary-prompt-field',
	)?.hidden,
	'自定义来源与模型必须同处首行，范围、图片、提示词和生成入口位于第二行',
);
click(surface.promptToggleButton);
selectValue(surface.scopeSelect, 'owner');
change(surface.scopeSelect);
selectValue(surface.summaryPurposeSelect, 'decision');
change(surface.summaryPurposeSelect);
selectValue(surface.summaryLengthSelect, 'detailed');
change(surface.summaryLengthSelect);
surface.customPromptInput.value = '优先说明楼主最终结论';
change(surface.customPromptInput);
deferImagePicker = true;
click(surface.imagePickerButton);
await flush();
const pickerCloseProbe = document.createElement('button');
pickerCloseProbe.className = 'ldp-lb-batch-close';
mount.append(pickerCloseProbe);
pickerCloseProbe.dispatchEvent(new EventConstructor('pointerdown', {
	bubbles: true,
	cancelable: true,
	composed: true,
}));
const pickerEscapeProbe = new EventConstructor('keydown', {
	bubbles: true,
	cancelable: true,
	composed: true,
});
Object.defineProperty(pickerEscapeProbe, 'key', { value: 'Escape' });
document.dispatchEvent(pickerEscapeProbe);
assert(
	!surface.root.hidden && surface.frame.isOpen,
	'图片选择会话活动时，关闭按钮的 pointerdown 与 Escape 都不能越级关闭总结浮窗',
);
(resolveDeferredImagePicker as (
	((items: readonly ReaderLightboxItem[] | null) => void) | null
))?.(null);
await flush();
pickerCloseProbe.remove();
deferImagePicker = false;
click(surface.imagePickerButton);
await flush();
assert(
	imagePickerCalls === 2 &&
	surface.imagePickerButton.textContent?.includes('1/3') &&
	surface.imagePickerButton.getAttribute('aria-label')?.includes('全帖共 3 张') &&
	surface.root.querySelector<HTMLElement>(
		'.ldp-topic-summary-source-note',
	)?.hidden,
	'自定义来源必须显示范围、补充提示词和复用灯箱图片选择器，并隐藏官方规则',
);
click(surface.generateButton);
await flush();
assert(
	customRequests.length === 1 &&
	customRequests[0]?.model.baseUrl === 'https://api.example.com/v1' &&
	customRequests[0]?.model.model === 'summary-test-model' &&
	customRequests[0]?.modelContextTokens === 128_000 &&
	customRequests[0]?.scope === 'owner' &&
	customRequests[0]?.purpose === 'decision' &&
	customRequests[0]?.length === 'detailed' &&
	customRequests[0]?.customPrompt === '优先说明楼主最终结论' &&
	customRequests[0]?.images?.length === 1 &&
	String(surface.frame.meta.textContent) === '自定义 API' &&
	!surface.previewCanvas.hidden,
	`自定义总结必须把范围、Prompt 与所选图片交给共享 API，并投影可视化制备阶段：${JSON.stringify({
		customRequests,
		meta: surface.frame.meta.textContent,
		previewHidden: surface.previewCanvas.hidden,
		generateDisabled: surface.generateButton.disabled,
		generateLabel: surface.generateButton.textContent,
		status: surface.root.querySelector('.ldp-topic-summary-status')?.textContent,
		errors: errors.map((value) => String(value)),
	})}`,
);
selectValue(surface.summaryLengthSelect, 'standard');
change(surface.summaryLengthSelect);
assert(
	surface.previewCanvas.closest<HTMLElement>('.ldp-topic-summary-preview')?.hidden &&
	surface.generateButton.textContent?.includes('生成自定义总结'),
	'切换到尚未生成的总结档位时不得错误复用其他下拉组合的结果',
);
selectValue(surface.summaryLengthSelect, 'detailed');
change(surface.summaryLengthSelect);
assert(
	!surface.previewCanvas.closest<HTMLElement>('.ldp-topic-summary-preview')?.hidden &&
	Number(customRequests.length) === 1 &&
	surface.generateButton.textContent?.includes('重新生成自定义总结'),
	'切回已生成的下拉组合时必须恢复该组合自己的缓存，并允许重新生成',
);
click(surface.generateButton);
await flush();
assert(
	Number(customRequests.length) === 2 && customRequests[1]?.refresh === true,
	'自定义总结命中既有结果时必须先展示缓存，并允许用户显式重新生成',
);
selectValue(surface.scopeSelect, 'range');
change(surface.scopeSelect);
surface.floorRangeInput.value = '#2-#4, #8';
change(surface.floorRangeInput);
click(surface.generateButton);
await flush();
assert(
	Number(customRequests.length) === 3 &&
	customRequests[2]?.scope === 'range' &&
	customRequests[2]?.floorRange === '#2-#4, #8',
	'自定义范围必须接受区间与散点楼层，并作为独立参数传给嵌套总结请求',
);
click(surface.historyButton);
const allHistory = JSON.parse(
	stored.get('ldp:topic-summary-results:v1') ?? '{}',
) as Readonly<{
	readonly entries?: readonly Readonly<{
		readonly context?: Readonly<Record<string, unknown>>;
	}>[];
}>;
assert(
	allHistory.entries?.length === 6 &&
	surface.root.querySelectorAll('.ldp-topic-summary-history-item').length === 6 &&
	allHistory.entries.filter((entry) =>
		entry.context?.purpose === 'decision' &&
		entry.context?.length === 'detailed' &&
		entry.context?.scope === 'owner'
	).length === 2 &&
	allHistory.entries.some((entry) =>
		entry.context?.scope === 'range' &&
		entry.context?.floorRange === '#2-#4, #8'
	) &&
	surface.root.textContent?.includes('决策比较 · 详细') &&
	surface.root.textContent?.includes('楼层 #2-#4, #8'),
	'不同配置与同配置重生成都必须持久化，并在当前主题时间线标清结构、长度和范围',
);
click(surface.historyButton);
click(surface.copyButton);
await flush();
assert(
	copied.at(-1)?.startsWith(
		'> **来自 Awesome LinuxDo Reader 自定义 AI 总结**',
	) &&
	copied.at(-1)?.includes('[@alice](https://linux.do/u/alice)'),
	'自定义文字引用必须保留 AI 产物里的 LinuxDo 用户可点击链接',
);

surface.destroy();
assert(!mount.contains(surface.root), 'Topic 销毁必须移除总结浮窗');

let emptyModelRequests = 0;
const emptyModelSurface = new ReaderTopicSummarySurface({
	document,
	mount,
	request: { request: async () => summary },
	customRequest: {
		async request() {
			emptyModelRequests += 1;
			return summary;
		},
	},
	aiModels: {
		availableModels: async () => Object.freeze([]),
	},
	topicTitle: () => '无模型主题',
	topicUrl: () => 'https://linux.do/t/topic/404',
});
emptyModelSurface.open();
selectValue(emptyModelSurface.sourceSelect, 'custom');
change(emptyModelSurface.sourceSelect);
await flush();
assert(
	emptyModelSurface.customModelSelect.disabled &&
	emptyModelSurface.generateButton.disabled &&
	emptyModelSurface.customModelSelect.textContent?.includes(
		'设置面板的「AI 服务」',
	) &&
	emptyModelSurface.root.querySelector<HTMLElement>(
		'.ldp-topic-summary-status',
	)?.textContent?.includes('设置面板的「AI 服务」') &&
	emptyModelRequests === 0,
	'自定义总结没有任何模型时必须指向设置面板的 AI 服务，并禁止误发请求',
);
emptyModelSurface.destroy();
