import { createReaderIcon } from '../components/reader-icon.js';
import { htmlElement as element } from '../dom/html-element.js';
import {
	readerFontFamilyCss,
} from '../font/reader-font-style-controller.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { BlobDownloadPort } from '../media/reader-image-download-service.js';
import type { ReaderImageResourceService } from '../media/reader-image-resource-service.js';
import type { ReaderLightboxItem } from '../media/reader-lightbox-controller.js';
import { ReaderFloatingWindowFrame } from '../shell/reader-floating-window-frame.js';
import type { TranslationAiModelCatalogPort } from
	'../translation/translation-request-adapter.js';
import {
	compareReaderAiModels,
	readerAiModelDisplayLabel,
	type ReaderAiModelSelection,
} from '../translation/reader-translation-config.js';
import type { ReaderShareSurfacePort } from './reader-share-action-coordinator.js';
import {
	parseReaderTopicSummaryFloorRange,
	readerTopicSummaryContextBudget,
	type ReaderTopicCustomSummaryLength,
	type ReaderTopicCustomSummaryPurpose,
	type ReaderTopicCustomSummaryRequestPort,
	type ReaderTopicCustomSummaryScope,
	type ReaderTopicCustomSummaryStage,
} from './reader-topic-custom-summary.js';
import type {
	ReaderTopicSummary,
	ReaderTopicSummaryImageUpload,
	ReaderTopicSummaryImageUploadPort,
	ReaderTopicSummaryRequestPort,
} from './reader-topic-summary-request-adapter.js';

const DEFAULT_SHARE_IMAGE_WIDTH = 1_080;
const SOCIAL_SHARE_IMAGE_WIDTH = 1_200;
const MIN_SHARE_IMAGE_WIDTH = 720;
const MAX_SHARE_IMAGE_WIDTH = 2_160;
const DEFAULT_SHARE_BODY_FONT_SIZE = 31;
const MIN_SHARE_BODY_FONT_SIZE = 22;
const MAX_SHARE_BODY_FONT_SIZE = 48;
const SUMMARY_SHARE_SETTINGS_KEY = 'ldp:topic-summary-share-settings:v1';
const SUMMARY_RESULTS_CACHE_KEY = 'ldp:topic-summary-results:v1';
const SUMMARY_WINDOW_GEOMETRY_KEY = 'ldp:topic-summary-window-geometry:v1';
const LOCAL_FONT_PREFIX = 'local:';

export type ReaderTopicSummaryShareStyle =
	| 'paper'
	| 'ink'
	| 'mist'
	| 'sunset'
	| 'sage'
	| 'porcelain'
	| 'wisteria'
	| 'amber'
	| 'graphite'
	| 'coral';

export interface ReaderTopicSummaryFontCatalogPort {
	readonly readCurrentFamily: () => string;
	readonly queryLocalFonts?: () => Promise<readonly string[]>;
}

export interface ReaderTopicSummaryShareImageOptions {
	readonly document: Document;
	readonly summary: ReaderTopicSummary;
	readonly topicTitle: string;
	readonly topicUrl: string;
	readonly style: ReaderTopicSummaryShareStyle;
	readonly chineseFontFamily: string;
	readonly latinFontFamily: string;
	readonly width?: number;
	readonly bodyFontSize?: number;
}

export interface ReaderTopicSummaryImagePreview {
	readonly blob: Blob;
	readonly alt: string;
	readonly returnFocus: HTMLElement;
}

export interface ReaderTopicSummarySurfaceOptions {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly request: ReaderTopicSummaryRequestPort;
	readonly customRequest?: ReaderTopicCustomSummaryRequestPort;
	readonly aiModels?: TranslationAiModelCatalogPort;
	readonly imagePicker?: Readonly<{
		choose(
			initialItems?: readonly ReaderLightboxItem[],
			options?: Readonly<{
				readonly collisionSurface?: HTMLElement;
				readonly onCatalog?: (total: number) => void;
			}>,
		): Promise<readonly ReaderLightboxItem[] | null>;
		close?(): void;
	}>;
	readonly imageResources?: Pick<ReaderImageResourceService, 'blob'>;
	readonly topicTitle: () => string;
	readonly topicUrl: () => string;
	readonly clipboard?: Pick<ReaderShareSurfacePort, 'copyText'>;
	readonly downloads?: BlobDownloadPort;
	readonly uploader?: ReaderTopicSummaryImageUploadPort;
	readonly openReply?: (raw: string) => Promise<void>;
	readonly fonts?: ReaderTopicSummaryFontCatalogPort;
	readonly settingsStorage?: Pick<Storage, 'getItem' | 'setItem'>;
	readonly positionMode?: () => string;
	readonly renderShareImage?: (
		canvas: HTMLCanvasElement,
		options: ReaderTopicSummaryShareImageOptions,
	) => void;
	readonly createShareImage?: (
		options: ReaderTopicSummaryShareImageOptions,
	) => Promise<Blob>;
	readonly previewImage?: (
		input: ReaderTopicSummaryImagePreview,
	) => void | Promise<void>;
	readonly notify?: (message: string) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

function positionStorage(
	storage: Pick<Storage, 'getItem' | 'setItem'> | undefined,
	readMode: (() => string) | undefined,
): Pick<Storage, 'getItem' | 'setItem'> | undefined {
	if (!storage) return undefined;
	const key = (value: string): string => {
		const mode = String(readMode?.() ?? 'floating')
			.replace(/[^a-z0-9_-]/gi, '')
			.slice(0, 32) || 'floating';
		return `${value}:${mode}`;
	};
	return Object.freeze({
		getItem: (value: string) => storage.getItem(key(value)),
		setItem: (value: string, next: string) => storage.setItem(key(value), next),
	});
}

interface ShareStyleTheme {
	readonly id: ReaderTopicSummaryShareStyle;
	readonly label: string;
	readonly backgroundStart: string;
	readonly backgroundEnd: string;
	readonly ink: string;
	readonly body: string;
	readonly muted: string;
	readonly accent: string;
	readonly rule: string;
	readonly border: string;
}

interface PersistedShareSettings {
	readonly schemaVersion: 5;
	readonly style: ReaderTopicSummaryShareStyle;
	readonly chineseFont: string;
	readonly latinFont: string;
	readonly widthMode: 'default' | 'social' | 'custom';
	readonly customWidth: number;
	readonly fontSizeMode: 'recommended' | 'custom';
	readonly customFontSize: number;
	readonly customPrompt: string;
	readonly customModelBaseUrl: string;
	readonly customModel: string;
	readonly summaryLength: ReaderTopicCustomSummaryLength;
	readonly summaryPurpose: ReaderTopicCustomSummaryPurpose;
}

const SHARE_STYLES = Object.freeze<readonly ShareStyleTheme[]>([
	Object.freeze({
		id: 'paper', label: '米白书页',
		backgroundStart: '#f8f6f0', backgroundEnd: '#eee9df',
		ink: '#242a27', body: '#343a37', muted: '#7c7b75',
		accent: '#4f745f', rule: 'rgba(79,116,95,.28)',
		border: 'rgba(57,64,60,.14)',
	}),
	Object.freeze({
		id: 'ink', label: '黛青夜读',
		backgroundStart: '#202a27', backgroundEnd: '#111816',
		ink: '#f4f1e8', body: '#dbe4df', muted: '#9dafaa',
		accent: '#9bc7ae', rule: 'rgba(155,199,174,.38)',
		border: 'rgba(226,238,232,.18)',
	}),
	Object.freeze({
		id: 'mist', label: '雾蓝档案',
		backgroundStart: '#f5f8fb', backgroundEnd: '#dfe8f0',
		ink: '#203342', body: '#334957', muted: '#718594',
		accent: '#47728d', rule: 'rgba(71,114,141,.28)',
		border: 'rgba(45,73,91,.16)',
	}),
	Object.freeze({
		id: 'sunset', label: '霞光信笺',
		backgroundStart: '#fff5ee', backgroundEnd: '#f1dcd4',
		ink: '#452c2d', body: '#5b4140', muted: '#947670',
		accent: '#a45452', rule: 'rgba(164,84,82,.28)',
		border: 'rgba(98,60,58,.15)',
	}),
	Object.freeze({
		id: 'sage', label: '青苔札记',
		backgroundStart: '#f3f6ee', backgroundEnd: '#dce7d8',
		ink: '#26362c', body: '#3b4c41', muted: '#748376',
		accent: '#54765c', rule: 'rgba(84,118,92,.28)',
		border: 'rgba(54,78,61,.15)',
	}),
	Object.freeze({
		id: 'porcelain', label: '天青瓷影',
		backgroundStart: '#f3faf8', backgroundEnd: '#d8e9e5',
		ink: '#173a3a', body: '#315151', muted: '#6e8582',
		accent: '#347c72', rule: 'rgba(52,124,114,.26)',
		border: 'rgba(37,83,79,.16)',
	}),
	Object.freeze({
		id: 'wisteria', label: '紫藤夜语',
		backgroundStart: '#faf7fc', backgroundEnd: '#e8e0ef',
		ink: '#352b40', body: '#4f4359', muted: '#81748c',
		accent: '#765a88', rule: 'rgba(118,90,136,.27)',
		border: 'rgba(72,54,84,.15)',
	}),
	Object.freeze({
		id: 'amber', label: '琥珀剪报',
		backgroundStart: '#fffaf0', backgroundEnd: '#eadcbe',
		ink: '#3d3020', body: '#554632', muted: '#8d7a5d',
		accent: '#9a6b27', rule: 'rgba(154,107,39,.27)',
		border: 'rgba(91,68,35,.16)',
	}),
	Object.freeze({
		id: 'graphite', label: '银盐暗房',
		backgroundStart: '#2b2c2b', backgroundEnd: '#111312',
		ink: '#f5f1e8', body: '#dedbd3', muted: '#aaa69d',
		accent: '#d4b878', rule: 'rgba(212,184,120,.34)',
		border: 'rgba(240,235,222,.18)',
	}),
	Object.freeze({
		id: 'coral', label: '珊瑚信风',
		backgroundStart: '#fff8f5', backgroundEnd: '#efdcd5',
		ink: '#432e2c', body: '#5e4541', muted: '#947973',
		accent: '#ad5f57', rule: 'rgba(173,95,87,.27)',
		border: 'rgba(99,61,56,.15)',
	}),
]);

const SHARE_STYLE_IDS = new Set(SHARE_STYLES.map((style) => style.id));
const FONT_TOKENS = new Set([
	'reader', 'system', 'cjkSans', 'serif', 'monospace',
]);
const DEFAULT_SHARE_SETTINGS: PersistedShareSettings = Object.freeze({
	schemaVersion: 5,
	style: 'paper',
	chineseFont: 'cjkSans',
	latinFont: 'system',
	widthMode: 'default',
	customWidth: DEFAULT_SHARE_IMAGE_WIDTH,
	fontSizeMode: 'recommended',
	customFontSize: DEFAULT_SHARE_BODY_FONT_SIZE,
	customPrompt: '',
	customModelBaseUrl: '',
	customModel: '',
	summaryLength: 'standard',
	summaryPurpose: 'auto',
});
const CJK_GLYPH = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\u3000-\u303f\uff00-\uffef]/u;

function controlButton(
	document: Document,
	className: string,
	label: string,
	iconName: string,
): HTMLButtonElement {
	const control = element(document, 'button', className) as HTMLButtonElement;
	control.type = 'button';
	control.append(createReaderIcon(document, iconName));
	const text = element(document, 'span');
	text.textContent = label;
	control.append(text);
	return control;
}

function selectOption(
	document: Document,
	value: string,
	label: string,
): HTMLOptionElement {
	const option = document.createElement('option');
	option.value = value;
	option.textContent = label;
	return option;
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

function selectedValue(select: HTMLSelectElement): string {
	return [...select.options].filter((option) => option.selected).at(-1)?.value ??
		String(select.value ?? '');
}

function compactTokenCount(value: number): string {
	if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(1))}M`;
	if (value >= 1_000) return `${Number((value / 1_000).toFixed(1))}K`;
	return String(value);
}

function normalizedSummaryLength(value: unknown): ReaderTopicCustomSummaryLength {
	return value === 'concise' || value === 'detailed' ? value : 'standard';
}

function normalizedSummaryPurpose(value: unknown): ReaderTopicCustomSummaryPurpose {
	return value === 'general' || value === 'problem' || value === 'tutorial' ||
		value === 'debate' || value === 'decision' || value === 'resources' ||
		value === 'progress'
		? value
		: 'auto';
}

function aiModelValue(baseUrl: string, model: string): string {
	return JSON.stringify([baseUrl, model]);
}

function parseAiModelValue(value: string): ReaderAiModelSelection | null {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed) && parsed.length === 2 &&
			typeof parsed[0] === 'string' && typeof parsed[1] === 'string' &&
			parsed[0] && parsed[1]
			? Object.freeze({ baseUrl: parsed[0], model: parsed[1] })
			: null;
	} catch {
		return null;
	}
}

function styleTheme(value: unknown): ShareStyleTheme {
	return SHARE_STYLES.find((style) => style.id === value) ?? SHARE_STYLES[0]!;
}

function normalizedFontToken(value: unknown, fallback: string): string {
	const token = String(value ?? '').trim();
	if (FONT_TOKENS.has(token)) return token;
	if (token.startsWith(LOCAL_FONT_PREFIX)) {
		const family = token.slice(LOCAL_FONT_PREFIX.length)
			.replace(/[\u0000-\u001f\u007f]/g, '')
			.trim()
			.slice(0, 96);
		if (family) return `${LOCAL_FONT_PREFIX}${family}`;
	}
	return fallback;
}

function boundedShareImageWidth(value: unknown): number {
	const numeric = Math.trunc(Number(value));
	if (!Number.isFinite(numeric)) return DEFAULT_SHARE_IMAGE_WIDTH;
	return Math.min(MAX_SHARE_IMAGE_WIDTH, Math.max(MIN_SHARE_IMAGE_WIDTH, numeric));
}

function boundedShareBodyFontSize(value: unknown): number {
	const numeric = Math.trunc(Number(value));
	if (!Number.isFinite(numeric)) return DEFAULT_SHARE_BODY_FONT_SIZE;
	return Math.min(
		MAX_SHARE_BODY_FONT_SIZE,
		Math.max(MIN_SHARE_BODY_FONT_SIZE, numeric),
	);
}

function readShareSettings(
	storage: Pick<Storage, 'getItem'> | null,
): PersistedShareSettings {
	if (!storage) return DEFAULT_SHARE_SETTINGS;
	try {
		const parsed = JSON.parse(
			storage.getItem(SUMMARY_SHARE_SETTINGS_KEY) ?? 'null',
		) as Partial<PersistedShareSettings> | null;
		if (!parsed || ![1, 2, 3, 4, 5].includes(Number(parsed.schemaVersion))) {
			return DEFAULT_SHARE_SETTINGS;
		}
		return Object.freeze({
			schemaVersion: 5,
			style: SHARE_STYLE_IDS.has(parsed.style as ReaderTopicSummaryShareStyle)
				? parsed.style as ReaderTopicSummaryShareStyle
				: DEFAULT_SHARE_SETTINGS.style,
			chineseFont: normalizedFontToken(
				parsed.chineseFont,
				DEFAULT_SHARE_SETTINGS.chineseFont,
			),
			latinFont: normalizedFontToken(
				parsed.latinFont,
				DEFAULT_SHARE_SETTINGS.latinFont,
			),
			widthMode: parsed.widthMode === 'social' || parsed.widthMode === 'custom'
				? parsed.widthMode
				: 'default',
			customWidth: boundedShareImageWidth(parsed.customWidth),
			fontSizeMode: parsed.fontSizeMode === 'custom'
				? 'custom'
				: 'recommended',
			customFontSize: boundedShareBodyFontSize(parsed.customFontSize),
			customPrompt: String(parsed.customPrompt ?? '').trim().slice(0, 2_000),
			customModelBaseUrl: String(parsed.customModelBaseUrl ?? '').trim(),
			customModel: String(parsed.customModel ?? '').trim().slice(0, 160),
			summaryLength: normalizedSummaryLength(parsed.summaryLength),
			summaryPurpose: normalizedSummaryPurpose(parsed.summaryPurpose),
		});
	} catch {
		return DEFAULT_SHARE_SETTINGS;
	}
}

interface PersistedSummaryContext {
	readonly source: 'official' | 'custom';
	readonly model?: string;
	readonly scope?: ReaderTopicCustomSummaryScope;
	readonly purpose?: ReaderTopicCustomSummaryPurpose;
	readonly length?: ReaderTopicCustomSummaryLength;
	readonly floorRange?: string;
	readonly imageCount: number;
	readonly customPrompt?: string;
}

interface PersistedSummaryResult {
	readonly id: string;
	readonly key: string;
	readonly generatedAt: string;
	readonly context: PersistedSummaryContext;
	readonly summary: ReaderTopicSummary;
}

function cachedSummary(value: unknown): ReaderTopicSummary | null {
	if (!value || typeof value !== 'object') return null;
	const candidate = value as Partial<ReaderTopicSummary>;
	const summarizedText = String(candidate.summarizedText ?? '').trim();
	const source = candidate.source === 'custom' ? 'custom' :
		candidate.source === 'official' ? 'official' : null;
	if (!summarizedText || source === null) return null;
	const scope = candidate.scope;
	return Object.freeze({
		summarizedText,
		algorithm: String(candidate.algorithm ?? '').trim(),
		source,
		...(scope === 'starter' || scope === 'all' || scope === 'owner' ||
			scope === 'range' ? { scope } : {}),
		outdated: candidate.outdated === true,
		canRegenerate: candidate.canRegenerate === true,
		newPostsSinceSummary: Math.max(
			0,
			Math.trunc(Number(candidate.newPostsSinceSummary ?? 0)) || 0,
		),
		updatedAt: String(candidate.updatedAt ?? '').trim(),
	});
}

function cachedSummaryContext(
	value: unknown,
	summary: ReaderTopicSummary,
): PersistedSummaryContext {
	if (!value || typeof value !== 'object') {
		return Object.freeze({
			source: summary.source,
			...(summary.algorithm ? { model: summary.algorithm } : {}),
			...(summary.scope ? { scope: summary.scope } : {}),
			imageCount: 0,
		});
	}
	const candidate = value as Readonly<Record<string, unknown>>;
	const source = candidate.source === 'custom' || candidate.source === 'official'
		? candidate.source
		: summary.source;
	const model = String(candidate.model ?? '').trim().slice(0, 160);
	const scope = candidate.scope;
	const purpose = candidate.purpose;
	const length = candidate.length;
	const floorRange = String(candidate.floorRange ?? '').trim().slice(0, 240);
	const customPrompt = String(candidate.customPrompt ?? '').trim().slice(0, 500);
	return Object.freeze({
		source,
		...(model ? { model } : {}),
		...(scope === 'starter' || scope === 'all' || scope === 'owner' ||
			scope === 'range' ? { scope } : {}),
		...(purpose === 'auto' || purpose === 'general' || purpose === 'problem' ||
			purpose === 'tutorial' || purpose === 'debate' ||
			purpose === 'decision' || purpose === 'resources' ||
			purpose === 'progress' ? { purpose } : {}),
		...(length === 'concise' || length === 'standard' || length === 'detailed'
			? { length }
			: {}),
		...(floorRange ? { floorRange } : {}),
		imageCount: Math.max(
			0,
			Math.min(6, Math.trunc(Number(candidate.imageCount ?? 0)) || 0),
		),
		...(customPrompt ? { customPrompt } : {}),
	});
}

function readSummaryResults(
	storage: Pick<Storage, 'getItem'> | null,
): readonly PersistedSummaryResult[] {
	if (!storage) return Object.freeze([]);
	try {
		const parsed = JSON.parse(
			storage.getItem(SUMMARY_RESULTS_CACHE_KEY) ?? 'null',
		) as Readonly<{ readonly schemaVersion?: unknown; readonly entries?: unknown }>;
		const schemaVersion = Number(parsed?.schemaVersion);
		if (![1, 2].includes(schemaVersion) || !Array.isArray(parsed.entries)) {
			return Object.freeze([]);
		}
		return Object.freeze(parsed.entries.flatMap((entry, index) => {
			if (!entry || typeof entry !== 'object') return [];
			const candidate = entry as Readonly<{
				id?: unknown;
				key?: unknown;
				generatedAt?: unknown;
				context?: unknown;
				summary?: unknown;
			}>;
			const key = String(candidate.key ?? '').trim();
			const summary = cachedSummary(candidate.summary);
			if (!key || !summary) return [];
			const generatedAt = String(
				candidate.generatedAt ?? summary.updatedAt ?? '',
			).trim();
			const id = String(candidate.id ?? '').trim() || `legacy-${index}`;
			return [Object.freeze({
				id,
				key,
				generatedAt,
				context: cachedSummaryContext(candidate.context, summary),
				summary,
			})];
		}).slice(-80));
	} catch {
		return Object.freeze([]);
	}
}

function historyTime(value: string): string {
	const date = new Date(value);
	if (!Number.isFinite(date.getTime())) return '时间未知';
	return date.toLocaleString('zh-CN', {
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hour12: false,
	});
}

function historyPurposeLabel(
	value: ReaderTopicCustomSummaryPurpose | undefined,
): string {
	return ({
		auto: '自动结构',
		general: '核心概览',
		problem: '问题求解',
		tutorial: '教程提炼',
		debate: '观点梳理',
		decision: '决策比较',
		resources: '资源整理',
		progress: '进展追踪',
	} as const)[value ?? 'auto'];
}

function historyLengthLabel(
	value: ReaderTopicCustomSummaryLength | undefined,
): string {
	return ({ concise: '精简', standard: '标准', detailed: '详细' } as const)[
		value ?? 'standard'
	];
}

function historyScopeLabel(context: PersistedSummaryContext): string {
	if (context.scope === 'starter') return '#1 楼主帖';
	if (context.scope === 'owner') return '只看楼主';
	if (context.scope === 'range') {
		return context.floorRange ? `楼层 ${context.floorRange}` : '自定义楼层';
	}
	return '全文';
}

function cleanImageText(value: string): string {
	return value
		.replace(/<br\s*\/?>/gi, '\n')
		.replace(/<\/p>\s*<p(?:\s[^>]*)?>/gi, '\n\n')
		.replace(/<\/?p(?:\s[^>]*)?>/gi, '')
		.replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, '$1')
		.replace(/<[^>]+>/g, '')
		.replace(/^#{1,6}\s+/gm, '')
		.replace(/^\s*[-*+]\s+/gm, '• ')
		.replace(/\[([^\]]+)]\([^\s)]+\)/g, '$1')
		.replace(/\*\*([^*]+)\*\*/g, '$1')
		.replace(/__([^_]+)__/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.trim();
}

function summaryLinkLabels(value: string): readonly string[] {
	const labels: string[] = [];
	for (const match of value.matchAll(/\[([^\]]+)]\([^\s)]+\)/g)) {
		const label = cleanImageText(match[1] ?? '');
		if (label) labels.push(label);
	}
	for (const match of value.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi)) {
		const label = cleanImageText(match[1] ?? '');
		if (label) labels.push(label);
	}
	return Object.freeze([...new Set(labels)]
		.sort((left, right) => right.length - left.length));
}

interface MixedFont {
	readonly weight: number;
	readonly size: number;
	readonly chineseFamily: string;
	readonly latinFamily: string;
}

function canvasFamily(value: string): string {
	const normalized = String(value).trim();
	return normalized && normalized !== 'inherit'
		? normalized
		: 'system-ui,sans-serif';
}

function mixedRuns(value: string): readonly Readonly<{
	readonly text: string;
	readonly cjk: boolean;
}>[] {
	const runs: Array<{ text: string; cjk: boolean }> = [];
	for (const character of Array.from(value)) {
		const previous = runs.at(-1);
		const cjk = CJK_GLYPH.test(character) ||
			(/^\s$/u.test(character) && previous?.cjk === true);
		if (previous?.cjk === cjk) previous.text += character;
		else runs.push({ text: character, cjk });
	}
	return runs;
}

function applyMixedFont(
	context: CanvasRenderingContext2D,
	font: MixedFont,
	cjk: boolean,
): void {
	context.font = `${font.weight} ${font.size}px ${canvasFamily(
		cjk ? font.chineseFamily : font.latinFamily,
	)}`;
}

function measureMixedText(
	context: CanvasRenderingContext2D,
	value: string,
	font: MixedFont,
): number {
	let width = 0;
	for (const run of mixedRuns(value)) {
		applyMixedFont(context, font, run.cjk);
		width += context.measureText(run.text).width;
	}
	return width;
}

function drawMixedText(
	context: CanvasRenderingContext2D,
	value: string,
	x: number,
	y: number,
	font: MixedFont,
	align: 'left' | 'right' = 'left',
): void {
	const runs = mixedRuns(value);
	let cursor = align === 'right'
		? x - measureMixedText(context, value, font)
		: x;
	context.textAlign = 'left';
	for (const run of runs) {
		applyMixedFont(context, font, run.cjk);
		context.fillText(run.text, cursor, y);
		cursor += context.measureText(run.text).width;
	}
}

function drawLinkAwareText(
	context: CanvasRenderingContext2D,
	value: string,
	x: number,
	y: number,
	font: MixedFont,
	linkLabels: readonly string[],
	bodyColor: string,
	linkColor: string,
): void {
	let cursor = 0;
	let drawX = x;
	while (cursor < value.length) {
		let nextIndex = value.length;
		let nextLabel = '';
		for (const label of linkLabels) {
			const index = value.indexOf(label, cursor);
			if (index >= 0 && index < nextIndex) {
				nextIndex = index;
				nextLabel = label;
			}
		}
		if (nextIndex > cursor) {
			const plain = value.slice(cursor, nextIndex);
			context.fillStyle = bodyColor;
			drawMixedText(context, plain, drawX, y, font);
			drawX += measureMixedText(context, plain, font);
		}
		if (!nextLabel) break;
		context.fillStyle = linkColor;
		drawMixedText(context, nextLabel, drawX, y, font);
		drawX += measureMixedText(context, nextLabel, font);
		cursor = nextIndex + nextLabel.length;
	}
}

function wrapCanvasText(
	context: CanvasRenderingContext2D,
	value: string,
	maximumWidth: number,
	font: MixedFont,
): readonly string[] {
	const lines: string[] = [];
	const normalized = cleanImageText(value)
		.replace(/\r\n?/g, '\n')
		.replace(/([^\n])\n(?!\n|\s*•\s)/g, (_, before: string, offset: number, source: string) => {
			const after = source.slice(offset + before.length + 1).match(/^\s*(.)/u)?.[1] ?? '';
			return /^[\p{L}\p{N}]$/u.test(before) &&
				/^[\p{L}\p{N}]$/u.test(after) &&
				!CJK_GLYPH.test(before) && !CJK_GLYPH.test(after)
				? `${before} `
				: before;
		});
	for (const paragraph of normalized.split(/\r?\n/)) {
		if (!paragraph.trim()) {
			if (lines.at(-1) !== '') lines.push('');
			continue;
		}
		let current = '';
		const units = paragraph.trim().match(
			/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]|[\p{L}\p{N}]+(?:['’_-][\p{L}\p{N}]+)*|\s+|./gu,
		) ?? [];
		for (const unit of units) {
			const candidate = current + unit;
			if (!current || measureMixedText(context, candidate, font) <= maximumWidth) {
				current = candidate;
				continue;
			}
			lines.push(current.trimEnd());
			current = unit.trimStart();
			if (measureMixedText(context, current, font) <= maximumWidth) continue;
			let fragment = '';
			for (const character of Array.from(current)) {
				if (
					fragment &&
					measureMixedText(context, fragment + character, font) > maximumWidth
				) {
					lines.push(fragment);
					fragment = character;
				} else {
					fragment += character;
				}
			}
			current = fragment;
		}
		if (current) lines.push(current.trimEnd());
	}
	return Object.freeze(lines);
}

function clippedMixedText(
	context: CanvasRenderingContext2D,
	value: string,
	maximumWidth: number,
	font: MixedFont,
): string {
	if (measureMixedText(context, value, font) <= maximumWidth) return value;
	let result = '';
	for (const character of Array.from(value)) {
		if (measureMixedText(context, `${result}${character}…`, font) > maximumWidth) {
			break;
		}
		result += character;
	}
	return `${result}…`;
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob((blob) => {
			if (blob) resolve(blob);
			else reject(new Error('浏览器未能导出总结图片'));
		}, 'image/png');
	});
}

async function loadShareImageFonts(
	document: Document,
	options: Pick<
		ReaderTopicSummaryShareImageOptions,
		'chineseFontFamily' | 'latinFontFamily' | 'bodyFontSize'
	>,
): Promise<boolean> {
	const fontSet = document.fonts;
	if (!fontSet || typeof fontSet.load !== 'function') return false;
	const bodyFontSize = boundedShareBodyFontSize(options.bodyFontSize);
	const requests = [
		fontSet.load(
			`400 ${bodyFontSize}px ${canvasFamily(options.chineseFontFamily)}`,
			'汉字总结阅读',
		),
		fontSet.load(
			`400 ${bodyFontSize}px ${canvasFamily(options.latinFontFamily)}`,
			'LinuxDo Reader 0123',
		),
	];
	const results = await Promise.allSettled(requests);
	return results.some((result) => result.status === 'fulfilled');
}

function drawStyleOrnaments(
	context: CanvasRenderingContext2D,
	style: ReaderTopicSummaryShareStyle,
	width: number,
	height: number,
	theme: ShareStyleTheme,
): void {
	context.save();
	context.strokeStyle = theme.rule;
	context.fillStyle = theme.rule;
	context.lineWidth = 2;
	if (style === 'paper') {
		context.beginPath();
		context.moveTo(width - 230, 70);
		context.lineTo(width - 70, 70);
		context.lineTo(width - 70, 230);
		context.stroke();
	} else if (style === 'ink') {
		context.globalAlpha = .36;
		context.beginPath();
		context.arc(width - 150, 150, 78, 0, Math.PI * 2);
		context.stroke();
		context.beginPath();
		context.arc(width - 150, 150, 112, 0, Math.PI * 2);
		context.stroke();
	} else if (style === 'mist') {
		context.globalAlpha = .55;
		context.fillRect(34, 34, 17, height - 68);
		for (let y = 90; y < height - 90; y += 72) {
			context.fillRect(width - 64, y, 10, 2);
		}
	} else if (style === 'sunset') {
		context.globalAlpha = .28;
		context.beginPath();
		context.arc(width - 105, 120, 108, 0, Math.PI * 2);
		context.fill();
		context.beginPath();
		context.arc(width - 220, 65, 46, 0, Math.PI * 2);
		context.fill();
	} else if (style === 'sage') {
		context.globalAlpha = .3;
		for (const offset of [0, 34, 68]) {
			context.beginPath();
			context.arc(
				width - 80 - offset,
				height - 170,
				120,
				Math.PI,
				Math.PI * 1.55,
			);
			context.stroke();
		}
	} else if (style === 'porcelain') {
		context.globalAlpha = .34;
		for (const radius of [46, 78, 110]) {
			context.beginPath();
			context.arc(width - 92, 92, radius, Math.PI / 2, Math.PI);
			context.stroke();
		}
		context.fillRect(54, height - 210, 3, 124);
	} else if (style === 'wisteria') {
		context.globalAlpha = .31;
		context.beginPath();
		context.moveTo(width - 72, 60);
		context.bezierCurveTo(width - 250, 96, width - 114, 245, width - 286, 286);
		context.stroke();
		for (const [x, y, radius] of [
			[width - 142, 115, 8],
			[width - 186, 158, 6],
			[width - 132, 205, 5],
		] as const) {
			context.beginPath();
			context.arc(x, y, radius, 0, Math.PI * 2);
			context.fill();
		}
	} else if (style === 'amber') {
		context.globalAlpha = .3;
		context.strokeRect(width - 230, 62, 160, 110);
		context.strokeRect(width - 212, 80, 124, 74);
		for (let y = height - 180; y < height - 80; y += 24) {
			context.fillRect(58, y, 126, 2);
		}
	} else if (style === 'graphite') {
		context.globalAlpha = .42;
		context.beginPath();
		context.moveTo(56, 112);
		context.lineTo(210, 56);
		context.lineTo(276, 56);
		context.stroke();
		for (let offset = 0; offset < 5; offset += 1) {
			context.fillRect(
				width - 250 + offset * 35,
				height - 86 - offset * 18,
				22,
				2,
			);
		}
	} else {
		context.globalAlpha = .32;
		for (const offset of [0, 32, 64]) {
			context.beginPath();
			context.moveTo(width - 260, 95 + offset);
			context.bezierCurveTo(
				width - 210,
				55 + offset,
				width - 150,
				135 + offset,
				width - 74,
				92 + offset,
			);
			context.stroke();
		}
	}
	context.restore();
}

/** 浮窗预览与 PNG 导出共用的唯一 Canvas renderer。 */
export function renderReaderTopicSummaryShareImage(
	canvas: HTMLCanvasElement,
	options: ReaderTopicSummaryShareImageOptions,
): void {
	canvas.width = boundedShareImageWidth(options.width);
	canvas.height = 1;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('浏览器 Canvas 不可用');
	const width = canvas.width;
	const bodyFontSize = boundedShareBodyFontSize(options.bodyFontSize);
	const fontScale = bodyFontSize / DEFAULT_SHARE_BODY_FONT_SIZE;
	const horizontalInset = Math.round(width * 84 / DEFAULT_SHARE_IMAGE_WIDTH);
	const contentWidth = width - horizontalInset * 2;
	const bodyFont: MixedFont = Object.freeze({
		weight: 400,
		size: bodyFontSize,
		chineseFamily: options.chineseFontFamily,
		latinFamily: options.latinFontFamily,
	});
	const lines = wrapCanvasText(
		context,
		options.summary.summarizedText,
		contentWidth,
		bodyFont,
	);
	const lineHeight = Math.round(49 * fontScale);
	const titleFont: MixedFont = Object.freeze({
		weight: 720,
		size: Math.round(45 * fontScale),
		chineseFamily: options.chineseFontFamily,
		latinFamily: options.latinFontFamily,
	});
	const titleLines = wrapCanvasText(
		context,
		options.topicTitle || '主题总结',
		contentWidth,
		titleFont,
	);
	const titleLineHeight = Math.round(58 * fontScale);
	const titleExtraHeight = Math.max(0, titleLines.length - 1) * titleLineHeight;
	const bodyStartY = Math.round(278 * fontScale) + titleExtraHeight;
	const bodyHeight = Math.max(1, lines.length) * lineHeight;
	canvas.height = Math.max(
		500,
		bodyStartY + Math.round(108 * fontScale) + bodyHeight,
	);
	const height = canvas.height;
	const theme = styleTheme(options.style);

	const background = context.createLinearGradient(0, 0, width, height);
	background.addColorStop(0, theme.backgroundStart);
	background.addColorStop(1, theme.backgroundEnd);
	context.fillStyle = background;
	context.fillRect(0, 0, width, height);
	context.strokeStyle = theme.border;
	context.lineWidth = Math.max(1, Math.round(2 * fontScale));
	const borderInset = Math.round(width * 34 / DEFAULT_SHARE_IMAGE_WIDTH);
	context.strokeRect(
		borderInset,
		borderInset,
		width - borderInset * 2,
		height - borderInset * 2,
	);
	drawStyleOrnaments(context, theme.id, width, height, theme);

	const eyebrowFont: MixedFont = Object.freeze({
		weight: 650,
		size: Math.round(24 * fontScale),
		chineseFamily: options.chineseFontFamily,
		latinFamily: options.latinFontFamily,
	});
	context.fillStyle = theme.accent;
	context.beginPath();
	context.arc(
		horizontalInset + Math.round(2 * fontScale),
		Math.round(91 * fontScale),
		Math.max(4, Math.round(7 * fontScale)),
		0,
		Math.PI * 2,
	);
	context.fill();
	drawMixedText(
		context,
		options.summary.source === 'custom'
			? 'AWESOME LINUXDO READER · 自定义 AI 总结'
			: 'LINUXDO 官方 AI 总结',
		horizontalInset + Math.round(24 * fontScale),
		Math.round(100 * fontScale),
		eyebrowFont,
	);

	context.fillStyle = theme.ink;
	for (const [index, titleLine] of titleLines.entries()) {
		drawMixedText(
			context,
			titleLine,
			horizontalInset,
			Math.round(176 * fontScale) + index * titleLineHeight,
			titleFont,
		);
	}
	context.fillStyle = theme.rule;
	context.fillRect(
		horizontalInset,
		Math.round(215 * fontScale) + titleExtraHeight,
		Math.round(96 * fontScale),
		Math.max(2, Math.round(3 * fontScale)),
	);

	const linkLabels = summaryLinkLabels(options.summary.summarizedText);
	let y = bodyStartY;
	for (const line of lines) {
		if (line) drawLinkAwareText(
			context,
			line,
			horizontalInset,
			y,
			bodyFont,
			linkLabels,
			theme.body,
			theme.accent,
		);
		y += lineHeight;
	}

	const brandFont: MixedFont = Object.freeze({
		weight: 560,
		size: Math.round(19 * fontScale),
		chineseFamily: options.chineseFontFamily,
		latinFamily: options.latinFontFamily,
	});
	const footFont: MixedFont = Object.freeze({
		weight: 400,
		size: Math.round(18 * fontScale),
		chineseFamily: options.chineseFontFamily,
		latinFamily: options.latinFontFamily,
	});
	context.fillStyle = theme.muted;
	drawMixedText(
		context,
		'Awesome LinuxDo Reader',
		width - horizontalInset,
		height - Math.round(103 * fontScale),
		brandFont,
		'right',
	);
	drawMixedText(
		context,
		'沉浸阅读，专注思考',
		width - horizontalInset,
		height - Math.round(72 * fontScale),
		footFont,
		'right',
	);
	const urlText = clippedMixedText(
		context,
		options.topicUrl,
		Math.round(contentWidth * .6),
		footFont,
	);
	drawMixedText(
		context,
		urlText,
		horizontalInset,
		height - Math.round(72 * fontScale),
		footFont,
	);
}

export async function createReaderTopicSummaryShareImage(
	options: ReaderTopicSummaryShareImageOptions,
): Promise<Blob> {
	await loadShareImageFonts(options.document, options);
	const canvas = options.document.createElement('canvas');
	renderReaderTopicSummaryShareImage(canvas, options);
	return canvasBlob(canvas);
}

function quotedSummary(summary: ReaderTopicSummary, topicUrl: string): string {
	const source = summary.source === 'custom'
		? '来自 Awesome LinuxDo Reader 自定义 AI 总结'
		: '来自 LinuxDo 官方 AI 总结';
	const body = summary.summarizedText
		.split(/\r?\n/)
		.map((line) => line ? `> ${line}` : '>')
		.join('\n');
	return [
		`> **${source}**`,
		'>',
		body,
		'>',
		`> [查看原主题](${topicUrl})`,
	].join('\n');
}

function imageReply(
	imageUrl: string,
	topicTitle: string,
	topicUrl: string,
	summary: ReaderTopicSummary,
): string {
	const source = summary.source === 'custom'
		? 'Awesome LinuxDo Reader 自定义 AI 总结'
		: 'LinuxDo 官方 AI 总结';
	const alt = `${topicTitle} · ${source}`
		.replace(/[\[\]\\]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim();
	return [
		`> **来自 ${source}**`,
		'>',
		`> ![${alt}](${imageUrl})`,
		'>',
		`> [查看原主题](${topicUrl})`,
	].join('\n');
}

function safeTopicFilename(value: string): string {
	const stem = value
		.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, 80);
	return `${stem || 'LinuxDo-主题'}-AI总结.png`;
}

export class ReaderTopicSummarySurface {
	readonly scope: LifecycleScope;
	readonly frame: ReaderFloatingWindowFrame;
	readonly root: HTMLElement;
	readonly closeButton: HTMLButtonElement;
	readonly historyButton: HTMLButtonElement;
	readonly settingsButton: HTMLButtonElement;
	readonly downloadButton: HTMLButtonElement;
	readonly copyImageButton: HTMLButtonElement;
	readonly replyButton: HTMLButtonElement;
	readonly copyButton: HTMLButtonElement;
	readonly sourceSelect: HTMLSelectElement;
	readonly customModelSelect: HTMLSelectElement;
	readonly scopeSelect: HTMLSelectElement;
	readonly summaryPurposeSelect: HTMLSelectElement;
	readonly summaryLengthSelect: HTMLSelectElement;
	readonly floorRangeInput: HTMLInputElement;
	readonly customPromptInput: HTMLTextAreaElement;
	readonly imagePickerButton: HTMLButtonElement;
	readonly promptToggleButton: HTMLButtonElement;
	readonly generateButton: HTMLButtonElement;
	readonly styleSelect: HTMLSelectElement;
	readonly chineseFontSelect: HTMLSelectElement;
	readonly latinFontSelect: HTMLSelectElement;
	readonly widthModeSelect: HTMLSelectElement;
	readonly customWidthInput: HTMLInputElement;
	readonly fontSizeModeSelect: HTMLSelectElement;
	readonly customFontSizeInput: HTMLInputElement;
	readonly previewCanvas: HTMLCanvasElement;
	readonly #document: Document;
	readonly #request: ReaderTopicSummaryRequestPort;
	readonly #customRequest: ReaderTopicCustomSummaryRequestPort | null;
	readonly #aiModels: TranslationAiModelCatalogPort | null;
	readonly #imagePicker: ReaderTopicSummarySurfaceOptions['imagePicker'] | null;
	readonly #imageResources: ReaderTopicSummarySurfaceOptions['imageResources'] | null;
	readonly #topicTitle: () => string;
	readonly #topicUrl: () => string;
	readonly #clipboard: Pick<ReaderShareSurfacePort, 'copyText'> | null;
	readonly #downloads: BlobDownloadPort | null;
	readonly #uploader: ReaderTopicSummaryImageUploadPort | null;
	readonly #openReply: ((raw: string) => Promise<void>) | null;
	readonly #fonts: ReaderTopicSummaryFontCatalogPort | null;
	readonly #storage: Pick<Storage, 'getItem' | 'setItem'> | null;
	readonly #renderShareImage: (
		canvas: HTMLCanvasElement,
		options: ReaderTopicSummaryShareImageOptions,
	) => void;
	readonly #createShareImage: (
		options: ReaderTopicSummaryShareImageOptions,
	) => Promise<Blob>;
	readonly #previewImage: ReaderTopicSummarySurfaceOptions['previewImage'] | null;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	readonly #status: HTMLElement;
	readonly #historyPanel: HTMLElement;
	readonly #historyCount: HTMLElement;
	readonly #historyEmpty: HTMLElement;
	readonly #historyList: HTMLOListElement;
	readonly #settingsPanel: HTMLElement;
	readonly #fontStatus: HTMLElement;
	readonly #preview: HTMLElement;
	readonly #preparation: HTMLElement;
	readonly #controlRow: HTMLElement;
	readonly #methodRow: HTMLElement;
	readonly #tuningRow: HTMLElement;
	readonly #optionsRow: HTMLElement;
	readonly #sourceField: HTMLElement;
	readonly #modelField: HTMLElement;
	readonly #scopeField: HTMLElement;
	readonly #purposeField: HTMLElement;
	readonly #lengthField: HTMLElement;
	readonly #rangeField: HTMLElement;
	readonly #promptField: HTMLElement;
	readonly #officialRule: HTMLElement;
	readonly #customOptions: HTMLElement;
	readonly #progress: HTMLElement;
	#settings: PersistedShareSettings;
	#summary: ReaderTopicSummary | null = null;
	readonly #summaries = new Map<string, ReaderTopicSummary>();
	#historyEntries: readonly PersistedSummaryResult[] = Object.freeze([]);
	#historySerial = 0;
	#historyOpen = false;
	#viewingHistoryId: string | null = null;
	#pending: Promise<void> | null = null;
	#attempted = false;
	#selectedImages: readonly ReaderLightboxItem[] = Object.freeze([]);
	#availableImageCount: number | null = null;
	#imagePickerActive = false;
	#promptExpanded = false;
	#activeStage: ReaderTopicCustomSummaryStage | null = null;
	#localFontsLoaded = false;
	#fontRenderEpoch = 0;
	readonly #fontLoads = new Map<string, Promise<boolean>>();
	readonly #modelContextTokens = new Map<string, number>();
	#busy: 'download' | 'copy-image' | 'reply' | null = null;
	#previewPending = false;
	#uploadedImage: Readonly<{
		readonly key: string;
		readonly value: ReaderTopicSummaryImageUpload;
	}> | null = null;
	#errorMessage = '';

	constructor(options: ReaderTopicSummarySurfaceOptions) {
		this.#document = options.document;
		this.#request = options.request;
		this.#customRequest = options.customRequest ?? null;
		this.#aiModels = options.aiModels ?? null;
		this.#imagePicker = options.imagePicker ?? null;
		this.#imageResources = options.imageResources ?? null;
		this.#topicTitle = options.topicTitle;
		this.#topicUrl = options.topicUrl;
		this.#clipboard = options.clipboard ?? null;
		this.#downloads = options.downloads ?? null;
		this.#uploader = options.uploader ?? null;
		this.#openReply = options.openReply ?? null;
		this.#fonts = options.fonts ?? null;
		this.#storage = options.settingsStorage ?? null;
		this.#settings = readShareSettings(this.#storage);
		this.#historyEntries = readSummaryResults(this.#storage);
		this.#renderShareImage = options.renderShareImage ??
			renderReaderTopicSummaryShareImage;
		this.#createShareImage = options.createShareImage ??
			createReaderTopicSummaryShareImage;
		this.#previewImage = options.previewImage ?? null;
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);

		this.root = element(
			this.#document,
			'section',
			'ldp-topic-summary-surface',
		);
		this.root.hidden = true;
		this.historyButton = controlButton(
			this.#document,
			'ldp-topic-summary-history-toggle',
			'生成历史',
			'history',
		);
		this.historyButton.setAttribute('aria-label', '打开生成历史');
		this.historyButton.setAttribute('aria-expanded', 'false');
		this.settingsButton = controlButton(
			this.#document,
			'ldp-topic-summary-settings-toggle',
			'图片设置',
			'settings',
		);
		this.settingsButton.setAttribute('aria-label', '展开图片设置');
		this.settingsButton.setAttribute('aria-expanded', 'false');

		this.#preparation = element(
			this.#document,
			'section',
			'ldp-topic-summary-preparation',
		);
		this.#preparation.setAttribute('aria-label', 'AI 总结制备');
		this.#controlRow = element(
			this.#document,
			'div',
			'ldp-topic-summary-control-row',
		);
		this.#methodRow = element(
			this.#document,
			'div',
			'ldp-topic-summary-method-row',
		);
		this.#optionsRow = element(
			this.#document,
			'div',
			'ldp-topic-summary-options-row',
		);
		this.#tuningRow = element(
			this.#document,
			'div',
			'ldp-topic-summary-tuning-row',
		);
		this.#sourceField = this.#settingsField('总结来源');
		this.#sourceField.classList.add('ldp-topic-summary-source-field');
		this.sourceSelect = element(
			this.#document,
			'select',
			'ldp-reader-select ldp-topic-summary-source-select',
		) as HTMLSelectElement;
		this.sourceSelect.append(
			selectOption(this.#document, 'official', 'LinuxDo 官方'),
			selectOption(this.#document, 'custom', '自定义 AI 服务'),
		);
		selectValue(this.sourceSelect, 'official');
		this.sourceSelect.setAttribute('aria-label', '总结来源');
		this.#sourceField.append(this.sourceSelect);
		this.#modelField = this.#settingsField('总结模型');
		this.#modelField.classList.add('ldp-topic-summary-model-field');
		this.customModelSelect = element(
			this.#document,
			'select',
			'ldp-reader-select ldp-topic-summary-model-select',
		) as HTMLSelectElement;
		this.customModelSelect.dataset.readerSelectSearchable = 'true';
		this.customModelSelect.setAttribute('aria-label', '自定义总结模型');
		this.customModelSelect.append(selectOption(
			this.#document,
			'',
			'请先在设置面板的「AI 服务」中配置模型',
		));
		this.customModelSelect.disabled = true;
		this.#modelField.append(this.customModelSelect);
		this.#officialRule = element(
			this.#document,
			'p',
			'ldp-topic-summary-source-note',
		);
		this.#officialRule.textContent =
			'官方按站点规则选取可见常规回复，通常取开头 5 楼、热度较高 50 楼和末尾 5 楼；' +
			'存在精选回复时可能改用精选。它不是全楼层总结，阅读器不能指定范围。';
		this.#customOptions = element(
			this.#document,
			'div',
			'ldp-topic-summary-custom-options',
		);
		this.#customOptions.hidden = true;
		this.#scopeField = this.#settingsField('总结范围');
		this.#scopeField.classList.add('ldp-topic-summary-scope-field');
		this.scopeSelect = element(
			this.#document,
			'select',
			'ldp-reader-select ldp-topic-summary-scope-select',
		) as HTMLSelectElement;
		this.scopeSelect.append(
			selectOption(this.#document, 'starter', '#1 楼主帖'),
			selectOption(this.#document, 'all', '全文（按模型上下文自动取样）'),
			selectOption(this.#document, 'owner', '只看楼主（保留回复关系）'),
			selectOption(this.#document, 'range', '自定义楼层范围'),
		);
		selectValue(this.scopeSelect, 'all');
		this.scopeSelect.setAttribute('aria-label', '自定义总结范围');
		this.#scopeField.append(this.scopeSelect);
		this.#purposeField = this.#settingsField('总结结构');
		this.#purposeField.classList.add('ldp-topic-summary-purpose-field');
		this.summaryPurposeSelect = element(
			this.#document,
			'select',
			'ldp-reader-select ldp-topic-summary-purpose-select',
		) as HTMLSelectElement;
		this.summaryPurposeSelect.append(
			selectOption(this.#document, 'auto', '自动（推荐）'),
			selectOption(this.#document, 'general', '核心概览'),
			selectOption(this.#document, 'problem', '问题求解'),
			selectOption(this.#document, 'tutorial', '教程提炼'),
			selectOption(this.#document, 'debate', '观点梳理'),
			selectOption(this.#document, 'decision', '决策比较'),
			selectOption(this.#document, 'resources', '资源整理'),
			selectOption(this.#document, 'progress', '进展追踪'),
		);
		selectValue(this.summaryPurposeSelect, this.#settings.summaryPurpose);
		this.summaryPurposeSelect.setAttribute('aria-label', '自定义总结结构');
		this.#purposeField.append(this.summaryPurposeSelect);
		this.#lengthField = this.#settingsField('总结长度');
		this.#lengthField.classList.add('ldp-topic-summary-length-field');
		this.summaryLengthSelect = element(
			this.#document,
			'select',
			'ldp-reader-select ldp-topic-summary-length-select',
		) as HTMLSelectElement;
		this.summaryLengthSelect.append(
			selectOption(this.#document, 'concise', '精简 · 目标 250–350 字'),
			selectOption(
				this.#document,
				'standard',
				'标准 · 目标 450–650 字（推荐）',
			),
			selectOption(this.#document, 'detailed', '详细 · 目标 800–1000 字'),
		);
		selectValue(this.summaryLengthSelect, this.#settings.summaryLength);
		this.summaryLengthSelect.setAttribute('aria-label', '自定义总结长度');
		this.#lengthField.append(this.summaryLengthSelect);
		this.#rangeField = this.#settingsField('自定义楼层');
		this.#rangeField.classList.add('ldp-topic-summary-range-field');
		this.floorRangeInput = element(
			this.#document,
			'input',
			'ldp-topic-summary-floor-range',
		) as HTMLInputElement;
		this.floorRangeInput.type = 'text';
		this.floorRangeInput.maxLength = 240;
		this.floorRangeInput.placeholder = '#2-#12, #18, #25';
		this.floorRangeInput.setAttribute('aria-label', '自定义总结楼层范围');
		this.#rangeField.append(this.floorRangeInput);
		this.#promptField = this.#settingsField('补充提示词');
		this.#promptField.classList.add('ldp-topic-summary-prompt-field');
		this.customPromptInput = element(
			this.#document,
			'textarea',
			'ldp-topic-summary-custom-prompt',
		) as HTMLTextAreaElement;
		this.customPromptInput.maxLength = 2_000;
		this.customPromptInput.rows = 3;
		this.customPromptInput.value = this.#settings.customPrompt;
		this.customPromptInput.placeholder =
			'可补充关注点；“短总结、非逐楼流水账”等基础约束已内置。';
		this.#promptField.append(this.customPromptInput);
		this.imagePickerButton = controlButton(
			this.#document,
			'ldp-topic-summary-pick-images',
			'0/?',
			'image',
		);
		this.imagePickerButton.disabled =
			!this.#imagePicker || !this.#imageResources;
		this.promptToggleButton = controlButton(
			this.#document,
			'ldp-topic-summary-prompt-toggle',
			'展开补充提示词',
			'chevron-down',
		);
		this.promptToggleButton.setAttribute('aria-expanded', 'false');
		this.#customOptions.append(this.#rangeField, this.#promptField);
		this.generateButton = controlButton(
			this.#document,
			'ldp-topic-summary-generate',
			'生成总结',
			'sparkles',
		);
		this.#progress = element(
			this.#document,
			'ol',
			'ldp-topic-summary-progress',
		);
		this.#progress.hidden = true;
		for (const [stage, label] of [
			['loading-posts', '读取缓存与楼层'],
			['building-tree', '构建回复关系树'],
			['preparing-images', '准备所选图片'],
			['summarizing', 'AI 提炼'],
			['finalizing', '整理短摘要'],
		] as const) {
			const item = element(this.#document, 'li');
			item.dataset.summaryStage = stage;
			item.textContent = label;
			this.#progress.append(item);
		}
		this.#methodRow.append(
			this.#sourceField,
			this.#modelField,
		);
		this.#tuningRow.append(this.#purposeField, this.#lengthField);
		this.#optionsRow.append(
			this.#scopeField,
			this.imagePickerButton,
			this.promptToggleButton,
			this.generateButton,
		);
		this.#controlRow.append(
			this.#methodRow,
			this.#tuningRow,
			this.#optionsRow,
		);
		this.#preparation.append(
			this.#controlRow,
			this.#officialRule,
			this.#customOptions,
			this.#progress,
		);

		this.#settingsPanel = element(
			this.#document,
			'div',
			'ldp-topic-summary-settings',
		);
		this.#settingsPanel.hidden = true;
		const styleField = this.#settingsField('风格');
		this.styleSelect = element(
			this.#document,
			'select',
			'ldp-reader-select ldp-topic-summary-style-select',
		) as HTMLSelectElement;
		this.styleSelect.setAttribute('aria-label', '分享图风格');
		for (const theme of SHARE_STYLES) {
			this.styleSelect.append(selectOption(
				this.#document,
				theme.id,
				theme.label,
			));
		}
		selectValue(this.styleSelect, this.#settings.style);
		styleField.append(this.styleSelect);

		const chineseField = this.#settingsField('中文字体');
		this.chineseFontSelect = this.#fontSelect('中文字体', true);
		chineseField.append(this.chineseFontSelect);
		const latinField = this.#settingsField('英文字体');
		this.latinFontSelect = this.#fontSelect('英文字体', false);
		latinField.append(this.latinFontSelect);
		const widthField = this.#settingsField('画布宽度');
		const widthControls = element(
			this.#document,
			'div',
			'ldp-topic-summary-setting-controls',
		);
		this.widthModeSelect = element(
			this.#document,
			'select',
			'ldp-reader-select',
		) as HTMLSelectElement;
		this.widthModeSelect.setAttribute('aria-label', '分享图画布宽度');
		this.widthModeSelect.append(
			selectOption(this.#document, 'default', '默认 · 1080px'),
			selectOption(this.#document, 'social', '常用社交图 · 1200px'),
			selectOption(this.#document, 'custom', '自定义'),
		);
		selectValue(this.widthModeSelect, this.#settings.widthMode);
		this.customWidthInput = element(
			this.#document,
			'input',
			'ldp-topic-summary-number-input',
		) as HTMLInputElement;
		this.customWidthInput.type = 'number';
		this.customWidthInput.inputMode = 'numeric';
		this.customWidthInput.min = String(MIN_SHARE_IMAGE_WIDTH);
		this.customWidthInput.max = String(MAX_SHARE_IMAGE_WIDTH);
		this.customWidthInput.step = '10';
		this.customWidthInput.value = String(this.#settings.customWidth);
		this.customWidthInput.setAttribute('aria-label', '自定义分享图宽度像素');
		widthControls.append(this.widthModeSelect, this.customWidthInput);
		widthField.append(widthControls);

		const fontSizeField = this.#settingsField('正文字号');
		const fontSizeControls = element(
			this.#document,
			'div',
			'ldp-topic-summary-setting-controls',
		);
		this.fontSizeModeSelect = element(
			this.#document,
			'select',
			'ldp-reader-select',
		) as HTMLSelectElement;
		this.fontSizeModeSelect.setAttribute('aria-label', '分享图正文字号');
		this.fontSizeModeSelect.append(
			selectOption(this.#document, 'recommended', '推荐 · 31px'),
			selectOption(this.#document, 'custom', '自定义'),
		);
		selectValue(this.fontSizeModeSelect, this.#settings.fontSizeMode);
		this.customFontSizeInput = element(
			this.#document,
			'input',
			'ldp-topic-summary-number-input',
		) as HTMLInputElement;
		this.customFontSizeInput.type = 'number';
		this.customFontSizeInput.inputMode = 'numeric';
		this.customFontSizeInput.min = String(MIN_SHARE_BODY_FONT_SIZE);
		this.customFontSizeInput.max = String(MAX_SHARE_BODY_FONT_SIZE);
		this.customFontSizeInput.step = '1';
		this.customFontSizeInput.value = String(this.#settings.customFontSize);
		this.customFontSizeInput.setAttribute('aria-label', '自定义分享图正文字号');
		fontSizeControls.append(
			this.fontSizeModeSelect,
			this.customFontSizeInput,
		);
		fontSizeField.append(fontSizeControls);
		this.#updateShareControlVisibility();
		this.#fontStatus = element(
			this.#document,
			'span',
			'ldp-topic-summary-font-status',
		);
		this.#fontStatus.role = 'status';
		this.#fontStatus.textContent = this.#fonts?.queryLocalFonts
			? '展开设置后读取设置面板共用的本机字体。'
			: '当前浏览器仅提供预设字体。';
		this.#settingsPanel.append(
			styleField,
			chineseField,
			latinField,
			widthField,
			fontSizeField,
			this.#fontStatus,
		);

		this.#historyPanel = element(
			this.#document,
			'section',
			'ldp-topic-summary-history',
		);
		this.#historyPanel.hidden = true;
		this.#historyPanel.setAttribute('aria-label', 'AI 总结生成历史');
		const historyHead = element(
			this.#document,
			'div',
			'ldp-topic-summary-history-head',
		);
		const historyTitle = element(this.#document, 'h2');
		historyTitle.textContent = '生成历史';
		this.#historyCount = element(
			this.#document,
			'span',
			'ldp-topic-summary-history-count',
		);
		historyHead.append(historyTitle, this.#historyCount);
		this.#historyEmpty = element(
			this.#document,
			'p',
			'ldp-topic-summary-history-empty',
		);
		this.#historyEmpty.textContent = '还没有生成记录';
		this.#historyList = element(
			this.#document,
			'ol',
			'ldp-topic-summary-history-list',
		) as HTMLOListElement;
		this.#historyPanel.append(
			historyHead,
			this.#historyEmpty,
			this.#historyList,
		);

		this.#status = element(
			this.#document,
			'p',
			'ldp-topic-summary-status',
		);
		this.#preview = element(
			this.#document,
			'figure',
			'ldp-topic-summary-preview',
		);
		this.previewCanvas = this.#document.createElement('canvas');
		this.previewCanvas.className = 'ldp-topic-summary-canvas';
		this.previewCanvas.setAttribute(
			'role',
			this.#previewImage ? 'button' : 'img',
		);
		this.previewCanvas.setAttribute(
			'aria-label',
			this.#previewImage
				? '在灯箱中查看 AI 总结分享图'
				: 'AI 总结分享图实时预览',
		);
		if (this.#previewImage) this.previewCanvas.setAttribute('tabindex', '0');
		this.#preview.append(this.previewCanvas);

		const actions = element(
			this.#document,
			'footer',
			'ldp-topic-summary-actions',
		);
		this.downloadButton = controlButton(
			this.#document,
			'ldp-topic-summary-download',
			'下载图片',
			'download',
		);
		this.replyButton = controlButton(
			this.#document,
			'ldp-topic-summary-reply-image',
			'带图回复',
			'reply',
		);
		this.copyImageButton = controlButton(
			this.#document,
			'ldp-topic-summary-copy-image',
			'复制带图引用',
			'image',
		);
		this.copyButton = controlButton(
			this.#document,
			'ldp-topic-summary-copy',
			'复制引用',
			'copy',
		);
		actions.append(
			this.downloadButton,
			this.copyImageButton,
			this.replyButton,
			this.copyButton,
		);
		for (const button of [
			this.downloadButton,
			this.copyImageButton,
			this.replyButton,
			this.copyButton,
		]) {
			button.setAttribute(
				'aria-label',
				button.textContent?.trim() || 'AI 总结操作',
			);
		}
		this.root.append(
			this.#historyPanel,
			this.#preparation,
			this.#settingsPanel,
			this.#status,
			this.#preview,
			actions,
		);
		const geometryStorage = positionStorage(
			options.settingsStorage,
			options.positionMode,
		);
		this.frame = new ReaderFloatingWindowFrame({
			document: this.#document,
			mount: options.mount,
			title: 'AI 总结',
			ariaLabel: '主题 AI 总结',
			icon: 'sparkles',
			variant: 'topic-summary',
			tabId: 'topic-summary',
			tabOrder: 35,
			sessionMode: 'standalone',
			launcherSelector: '.ldp-topic-action-rail-summary',
			requestOpen: () => this.open(),
			zIndex: 2_147_483_586,
			...(geometryStorage ? { geometryStorage } : {}),
			geometryStorageKey: SUMMARY_WINDOW_GEOMETRY_KEY,
			policy: Object.freeze({
				minWidth: 360,
				minHeight: 420,
				defaultWidth: 540,
				defaultHeight: 760,
			}),
			placement: 'right',
			tabAction: this.settingsButton,
			notify: this.#notify,
			onClose: () => {
				this.#imagePicker?.close?.();
				this.#historyOpen = false;
				this.root.hidden = true;
			},
			parentScope: this.scope,
		});
		this.closeButton = this.frame.closeButton;
		this.frame.header.insertBefore(this.historyButton, this.settingsButton);
		this.frame.meta.textContent = 'LinuxDo';
		this.frame.body.append(this.root);
		this.#applyTheme();

		this.scope.listen(this.sourceSelect, 'change', () => {
			this.#errorMessage = '';
			this.#activeStage = null;
			this.#restoreSelectionSummary();
			this.#render();
			if (this.#source() === 'custom') void this.#loadAiModels();
		});
		this.scope.listen(this.customModelSelect, 'change', () => {
			const selection = this.#selectedCustomModel();
			this.#settings = Object.freeze({
				...this.#settings,
				customModelBaseUrl: selection?.baseUrl ?? '',
				customModel: selection?.model ?? '',
			});
			this.#persistSettings();
			this.#errorMessage = '';
			this.#renderScopeContextOption();
			this.#restoreSelectionSummary();
			this.#render();
		});
		this.scope.listen(this.scopeSelect, 'change', () => {
			this.#errorMessage = '';
			this.#restoreSelectionSummary();
			this.#render();
		});
		this.scope.listen(this.summaryPurposeSelect, 'change', () => {
			this.#settings = Object.freeze({
				...this.#settings,
				summaryPurpose: normalizedSummaryPurpose(
					selectedValue(this.summaryPurposeSelect),
				),
			});
			this.#persistSettings();
			this.#restoreSelectionSummary();
			this.#render();
		});
		this.scope.listen(this.summaryLengthSelect, 'change', () => {
			this.#settings = Object.freeze({
				...this.#settings,
				summaryLength: normalizedSummaryLength(
					selectedValue(this.summaryLengthSelect),
				),
			});
			this.#persistSettings();
			this.#restoreSelectionSummary();
			this.#render();
		});
		this.scope.listen(this.floorRangeInput, 'change', () => {
			this.#errorMessage = '';
			this.#restoreSelectionSummary();
			this.#render();
		});
		this.scope.listen(this.customPromptInput, 'change', () => {
			this.#settings = Object.freeze({
				...this.#settings,
				customPrompt: this.customPromptInput.value.trim().slice(0, 2_000),
			});
			this.#persistSettings();
			this.#restoreSelectionSummary();
			this.#render();
		});
		this.scope.listen(this.imagePickerButton, 'click', () => {
			void this.#pickImages();
		});
		this.scope.listen(this.promptToggleButton, 'click', () => {
			this.#promptExpanded = !this.#promptExpanded;
			this.#render();
			if (this.#promptExpanded) this.customPromptInput.focus();
		});
		this.scope.listen(this.generateButton, 'click', () => {
			this.#load();
		});
		this.scope.listen(this.historyButton, 'click', () => {
			this.#historyOpen = !this.#historyOpen;
			if (this.#historyOpen) {
				this.#settingsPanel.hidden = true;
				this.settingsButton.setAttribute('aria-expanded', 'false');
				this.settingsButton.setAttribute('aria-label', '展开图片设置');
			}
			this.#render();
		});
		this.scope.listen(this.#historyPanel, 'click', (event) => {
			const origin = event.target as HTMLElement | null;
			const button = origin?.closest<HTMLButtonElement>(
				'[data-summary-history-id]',
			);
			if (!button || !this.#historyPanel.contains(button)) return;
			const entry = this.#historyEntries.find(
				(candidate) => candidate.id === button.dataset.summaryHistoryId,
			);
			if (!entry) return;
			this.#summary = entry.summary;
			this.#viewingHistoryId = entry.id;
			this.#historyOpen = false;
			this.#render();
		});
		this.scope.listen(this.settingsButton, 'click', () => {
			const expanded = this.#settingsPanel.hidden;
			this.#historyOpen = false;
			this.#settingsPanel.hidden = !expanded;
			this.settingsButton.setAttribute('aria-expanded', String(expanded));
			this.settingsButton.setAttribute(
				'aria-label',
				expanded ? '收起图片设置' : '展开图片设置',
			);
			if (expanded) void this.#loadLocalFonts();
		});
		this.scope.listen(this.styleSelect, 'change', () => {
			this.#settings = Object.freeze({
				...this.#settings,
				style: styleTheme(selectedValue(this.styleSelect)).id,
			});
			this.#afterSettingsChange();
		});
		this.scope.listen(this.chineseFontSelect, 'change', () => {
			this.#settings = Object.freeze({
				...this.#settings,
				chineseFont: normalizedFontToken(
					selectedValue(this.chineseFontSelect),
					DEFAULT_SHARE_SETTINGS.chineseFont,
				),
			});
			this.#afterSettingsChange();
		});
		this.scope.listen(this.latinFontSelect, 'change', () => {
			this.#settings = Object.freeze({
				...this.#settings,
				latinFont: normalizedFontToken(
					selectedValue(this.latinFontSelect),
					DEFAULT_SHARE_SETTINGS.latinFont,
				),
			});
			this.#afterSettingsChange();
		});
		this.scope.listen(this.widthModeSelect, 'change', () => {
			const value = selectedValue(this.widthModeSelect);
			this.#settings = Object.freeze({
				...this.#settings,
				widthMode: value === 'social' || value === 'custom'
					? value
					: 'default',
			});
			this.#updateShareControlVisibility();
			this.#afterSettingsChange();
		});
		this.scope.listen(this.customWidthInput, 'input', () => {
			this.#settings = Object.freeze({
				...this.#settings,
				customWidth: boundedShareImageWidth(this.customWidthInput.value),
			});
			this.#afterSettingsChange();
		});
		this.scope.listen(this.customWidthInput, 'change', () => {
			this.customWidthInput.value = String(this.#settings.customWidth);
		});
		this.scope.listen(this.fontSizeModeSelect, 'change', () => {
			this.#settings = Object.freeze({
				...this.#settings,
				fontSizeMode: selectedValue(this.fontSizeModeSelect) === 'custom'
					? 'custom'
					: 'recommended',
			});
			this.#updateShareControlVisibility();
			this.#afterSettingsChange();
		});
		this.scope.listen(this.customFontSizeInput, 'input', () => {
			this.#settings = Object.freeze({
				...this.#settings,
				customFontSize: boundedShareBodyFontSize(
					this.customFontSizeInput.value,
				),
			});
			this.#afterSettingsChange();
		});
		this.scope.listen(this.customFontSizeInput, 'change', () => {
			this.customFontSizeInput.value = String(this.#settings.customFontSize);
		});
		this.scope.listen(this.downloadButton, 'click', () => {
			void this.#downloadImage();
		});
		this.scope.listen(this.replyButton, 'click', () => {
			void this.#replyWithImage();
		});
		this.scope.listen(this.copyImageButton, 'click', () => {
			void this.#copyImageReply();
		});
		this.scope.listen(this.copyButton, 'click', () => {
			void this.#copy();
		});
		if (this.#previewImage) {
			this.scope.listen(this.previewCanvas, 'click', () => {
				void this.#openImagePreview();
			});
			this.scope.listen(this.previewCanvas, 'keydown', (event) => {
				const keyboardEvent = event as KeyboardEvent;
				if (keyboardEvent.key !== 'Enter' && keyboardEvent.key !== ' ') return;
				keyboardEvent.preventDefault();
				void this.#openImagePreview();
			});
		}
		this.scope.listen(this.#document, 'keydown', (event) => {
			if (!this.root.hidden && !this.#imagePickerActive) {
				if (this.#historyOpen && (event as KeyboardEvent).key === 'Escape') {
					event.preventDefault();
					event.stopPropagation();
					this.#historyOpen = false;
					this.#render();
					return;
				}
				this.frame.dismissFromEscapeEvent(
				event as KeyboardEvent,
				);
			}
		}, true);
		this.scope.listen(this.#document, 'pointerdown', (event) => {
			if (!this.root.hidden && !this.#imagePickerActive) {
				this.frame.dismissFromPointerEvent(event);
			}
		}, true);
		this.scope.listen(options.mount, 'ldp-reader-workspace-change', () => {
			if (this.frame.isOpen) this.frame.open();
		});
		this.#restoreSelectionSummary();
		this.#render();
	}

	open(): void {
		if (this.scope.destroyed) return;
		this.#historyOpen = false;
		this.#viewingHistoryId = null;
		this.#restoreSelectionSummary();
		this.root.hidden = false;
		this.frame.open();
		this.#render();
		void this.#loadAiModels();
	}

	close(): void {
		this.#imagePicker?.close?.();
		this.#historyOpen = false;
		this.root.hidden = true;
		this.frame.close();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#settingsField(label: string): HTMLElement {
		const field = element(
			this.#document,
			'label',
			'ldp-topic-summary-setting',
		);
		const title = element(this.#document, 'span');
		title.textContent = label;
		field.append(title);
		return field;
	}

	#fontSelect(label: string, chinese: boolean): HTMLSelectElement {
		const select = element(
			this.#document,
			'select',
			'ldp-reader-select ldp-topic-summary-font-select',
		) as HTMLSelectElement;
		select.dataset.readerSelectSearchable = 'true';
		select.setAttribute('aria-label', label);
		select.append(selectOption(this.#document, 'reader', '跟随阅读器正文'));
		if (chinese) {
			select.append(
				selectOption(this.#document, 'cjkSans', '中文无衬线'),
				selectOption(this.#document, 'serif', '中文衬线'),
				selectOption(this.#document, 'system', '系统默认字体'),
			);
		} else {
			select.append(
				selectOption(this.#document, 'system', '系统默认字体'),
				selectOption(this.#document, 'serif', '衬线'),
				selectOption(this.#document, 'monospace', '等宽'),
			);
		}
		const saved = chinese
			? this.#settings.chineseFont
			: this.#settings.latinFont;
		this.#appendSavedLocalFont(select, saved);
		selectValue(select, saved);
		return select;
	}

	#appendSavedLocalFont(select: HTMLSelectElement, token: string): void {
		if (!token.startsWith(LOCAL_FONT_PREFIX)) return;
		if ([...select.options].some((option) => option.value === token)) return;
		const family = token.slice(LOCAL_FONT_PREFIX.length);
		select.append(selectOption(this.#document, token, family));
	}

	async #loadLocalFonts(): Promise<void> {
		if (this.#localFontsLoaded || !this.#fonts?.queryLocalFonts) return;
		this.#localFontsLoaded = true;
		this.#fontStatus.textContent = '正在读取本机字体…';
		try {
			const names = [...new Set((await this.#fonts.queryLocalFonts())
				.map((name) => String(name).trim())
				.filter(Boolean))]
				.sort((left, right) => left.localeCompare(right));
			if (this.scope.destroyed) return;
			for (const select of [
				this.chineseFontSelect,
				this.latinFontSelect,
			]) {
				for (const name of names) {
					const token = `${LOCAL_FONT_PREFIX}${name}`;
					if ([...select.options].some((option) => option.value === token)) {
						continue;
					}
					select.append(selectOption(this.#document, token, name));
				}
			}
			this.#fontStatus.textContent = names.length
				? `已与设置面板共用 ${names.length} 种本机字体。`
				: '浏览器未返回可用本机字体。';
		} catch (cause) {
			this.#localFontsLoaded = false;
			this.#fontStatus.textContent = '未获得本机字体权限，仍可使用预设字体。';
			this.#onError(cause);
		}
	}

	#updateShareControlVisibility(): void {
		this.customWidthInput.hidden = this.#settings.widthMode !== 'custom';
		this.customFontSizeInput.hidden =
			this.#settings.fontSizeMode !== 'custom';
	}

	#afterSettingsChange(): void {
		this.#uploadedImage = null;
		this.#persistSettings();
		this.#applyTheme();
		this.#renderPreview();
	}

	#persistSettings(): void {
		try {
			this.#storage?.setItem(
				SUMMARY_SHARE_SETTINGS_KEY,
				JSON.stringify(this.#settings),
			);
		} catch (cause) {
			this.#onError(cause);
		}
	}

	#applyTheme(): void {
		const theme = styleTheme(this.#settings.style);
		this.root.dataset.summaryStyle = theme.id;
		for (const property of [
			'--ldp-summary-bg-start',
			'--ldp-summary-bg-end',
			'--ldp-summary-ink',
			'--ldp-summary-muted',
			'--ldp-summary-accent',
			'--ldp-summary-border',
		]) this.root.style.removeProperty(property);
	}

	#fontFamily(token: string): string {
		if (token === 'reader') {
			return canvasFamily(this.#fonts?.readCurrentFamily() ?? '');
		}
		if (token.startsWith(LOCAL_FONT_PREFIX)) {
			return readerFontFamilyCss(
				'custom',
				token.slice(LOCAL_FONT_PREFIX.length),
			);
		}
		if (token === 'cjkSans' || token === 'serif' || token === 'monospace') {
			return readerFontFamilyCss(token);
		}
		return readerFontFamilyCss('system');
	}

	#shareImageOptions(): ReaderTopicSummaryShareImageOptions | null {
		if (!this.#summary) return null;
		const width = this.#settings.widthMode === 'social'
			? SOCIAL_SHARE_IMAGE_WIDTH
			: this.#settings.widthMode === 'custom'
				? this.#settings.customWidth
				: DEFAULT_SHARE_IMAGE_WIDTH;
		const bodyFontSize = this.#settings.fontSizeMode === 'custom'
			? this.#settings.customFontSize
			: DEFAULT_SHARE_BODY_FONT_SIZE;
		return Object.freeze({
			document: this.#document,
			summary: this.#summary,
			topicTitle: this.#topicTitle().trim() || 'LinuxDo 主题',
			topicUrl: this.#topicUrl(),
			style: this.#settings.style,
			chineseFontFamily: this.#fontFamily(this.#settings.chineseFont),
			latinFontFamily: this.#fontFamily(this.#settings.latinFont),
			width,
			bodyFontSize,
		});
	}

	#source(): 'official' | 'custom' {
		return selectedValue(this.sourceSelect) === 'custom' ? 'custom' : 'official';
	}

	#selectedCustomModel(): ReaderAiModelSelection | null {
		return parseAiModelValue(selectedValue(this.customModelSelect));
	}

	#selectedModelContextTokens(): number {
		return this.#modelContextTokens.get(
			selectedValue(this.customModelSelect),
		) ?? 0;
	}

	#customContextBudget(): ReturnType<typeof readerTopicSummaryContextBudget> {
		return readerTopicSummaryContextBudget({
			modelContextTokens: this.#selectedModelContextTokens(),
			imageCount: this.#selectedImages.length,
			customPromptCharacters: this.customPromptInput.value.trim().length,
			summaryLength: this.#settings.summaryLength,
		});
	}

	#renderScopeContextOption(): void {
		const option = [...this.scopeSelect.options].find((item) =>
			item.value === 'all');
		if (!option) return;
		const contextTokens = this.#selectedModelContextTokens();
		option.textContent = contextTokens
			? `全文（按 ${compactTokenCount(contextTokens)} 上下文自动取样）`
			: '全文（按模型上下文自动取样）';
	}

	async #loadAiModels(): Promise<void> {
		if (!this.#aiModels) return;
		try {
			const groups = await this.#aiModels.availableModels();
			if (this.scope.destroyed) return;
			this.#modelContextTokens.clear();
			const hasModels = groups.some((group) => group.catalog.length > 0);
			const placeholder = selectOption(
				this.#document,
				'',
				hasModels
					? '请选择总结模型'
					: '请先在设置面板的「AI 服务」中配置模型',
			);
			placeholder.disabled = true;
			const optionGroups = groups.map((group) => {
				const options = this.#document.createElement('optgroup');
				options.label = group.baseUrl.replace(/\/$/u, '');
				options.append(...[...group.catalog]
					.sort(compareReaderAiModels)
					.map((entry) => {
						const value = aiModelValue(group.baseUrl, entry.id);
						if (entry.contextLength > 0) {
							this.#modelContextTokens.set(value, entry.contextLength);
						}
						return selectOption(
							this.#document,
							value,
							readerAiModelDisplayLabel(entry),
						);
					}));
				return options;
			});
			this.customModelSelect.replaceChildren(placeholder, ...optionGroups);
			const stored = aiModelValue(
				this.#settings.customModelBaseUrl,
				this.#settings.customModel,
			);
			const available = [...this.customModelSelect.options].some((option) =>
				option.value === stored);
			selectValue(this.customModelSelect, available ? stored : '');
			this.customModelSelect.disabled = !hasModels;
			this.#renderScopeContextOption();
			this.#restoreSelectionSummary();
			this.#render();
		} catch (cause) {
			this.#onError(cause);
		}
	}

	#customScope(): ReaderTopicCustomSummaryScope {
		const value = selectedValue(this.scopeSelect);
		return value === 'starter' || value === 'owner' || value === 'range'
			? value
			: 'all';
	}

	#selectionKey(): string {
		if (this.#source() === 'official') return 'official';
		return JSON.stringify([
			'custom',
			this.#selectedCustomModel()?.baseUrl ?? '',
			this.#selectedCustomModel()?.model ?? '',
			this.#selectedModelContextTokens(),
			this.#customScope(),
			this.#settings.summaryPurpose,
			this.#settings.summaryLength,
			this.#customScope() === 'range'
				? this.floorRangeInput.value.trim()
				: '',
			this.customPromptInput.value.trim(),
			...this.#selectedImages.map((item) => item.key),
		]);
	}

	#resultCacheKey(selectionKey = this.#selectionKey()): string {
		return `${this.#topicUrl()}\n${selectionKey}`;
	}

	#restoreSelectionSummary(): void {
		this.#viewingHistoryId = null;
		const selectionKey = this.#selectionKey();
		const memory = this.#summaries.get(selectionKey);
		const persisted = memory ?? [...this.#historyEntries].reverse()
			.find((entry) => entry.key === this.#resultCacheKey(selectionKey))?.summary;
		this.#summary = persisted ?? null;
		if (persisted) this.#summaries.set(selectionKey, persisted);
		if (selectionKey === 'official' && persisted) this.#attempted = true;
	}

	#summaryContext(source: 'official' | 'custom'): PersistedSummaryContext {
		if (source === 'official') {
			return Object.freeze({ source, imageCount: 0 });
		}
		const model = this.#selectedCustomModel()?.model ?? '';
		const scope = this.#customScope();
		const floorRange = scope === 'range'
			? this.floorRangeInput.value.trim().slice(0, 240)
			: '';
		const customPrompt = this.customPromptInput.value.trim().slice(0, 500);
		return Object.freeze({
			source,
			...(model ? { model } : {}),
			scope,
			purpose: this.#settings.summaryPurpose,
			length: this.#settings.summaryLength,
			...(floorRange ? { floorRange } : {}),
			imageCount: this.#selectedImages.length,
			...(customPrompt ? { customPrompt } : {}),
		});
	}

	#persistSummary(
		selectionKey: string,
		summary: ReaderTopicSummary,
		context: PersistedSummaryContext,
	): void {
		const record = Object.freeze({
			id: `${Date.now().toString(36)}-${(++this.#historySerial).toString(36)}`,
			key: this.#resultCacheKey(selectionKey),
			generatedAt: new Date().toISOString(),
			context,
			summary,
		});
		this.#historyEntries = Object.freeze([
			...this.#historyEntries,
			record,
		].slice(-80));
		if (!this.#storage) return;
		try {
			this.#storage.setItem(SUMMARY_RESULTS_CACHE_KEY, JSON.stringify({
				schemaVersion: 2,
				entries: this.#historyEntries,
			}));
		} catch (cause) {
			this.#onError(cause);
		}
	}

	#load(): void {
		if (this.#pending || this.scope.destroyed) return;
		const source = this.#source();
		if (source === 'custom' && !this.#customRequest) {
			this.#errorMessage =
				'请先在设置面板的「AI 服务」中配置 API 与模型';
			this.#render();
			return;
		}
		if (source === 'custom' && !this.#selectedCustomModel()) {
			this.#errorMessage = this.customModelSelect.options.length <= 1
				? '请先在设置面板的「AI 服务」中配置并获取模型'
				: '请先选择按供应商分组的总结模型';
			this.#render();
			return;
		}
		if (source === 'custom' && this.#customScope() === 'range') {
			try {
				parseReaderTopicSummaryFloorRange(
					this.floorRangeInput.value,
					this.#customContextBudget().maxContentPosts,
				);
			} catch (cause) {
				this.#errorMessage = cause instanceof Error
					? cause.message
					: '自定义楼层范围无效';
				this.#render();
				return;
			}
		}
		if (source === 'official') this.#attempted = true;
		const key = this.#selectionKey();
		const context = this.#summaryContext(source);
		const refresh = source === 'custom' && this.#summaries.has(key);
		this.#activeStage = source === 'custom' ? 'loading-posts' : null;
		this.root.classList.add('is-loading');
		this.#errorMessage = '';
		this.#render();
		const pending = (source === 'official'
			? this.#request.request()
			: this.#requestCustom(refresh))
			.then((summary) => {
				if (this.scope.destroyed) return;
				this.#summary = summary;
				this.#viewingHistoryId = null;
				this.#summaries.set(key, summary);
				this.#persistSummary(key, summary, context);
				this.#errorMessage = '';
				this.#activeStage = source === 'custom' ? 'finalizing' : null;
			})
			.catch((cause) => {
				if (this.scope.destroyed) return;
				this.#summary = null;
				this.#errorMessage = cause instanceof Error && cause.message
					? cause.message
					: source === 'official'
						? 'LinuxDo 官方 AI 总结暂时不可用'
						: '自定义 AI 总结暂时不可用';
				this.#onError(cause);
			})
			.finally(() => {
				if (this.#pending === pending) this.#pending = null;
				if (this.scope.destroyed) return;
				this.root.classList.remove('is-loading');
				this.#render();
			});
		this.#pending = pending;
	}

	async #requestCustom(refresh: boolean): Promise<ReaderTopicSummary> {
		if (!this.#customRequest) throw new Error('自定义 AI 总结能力不可用');
		const model = this.#selectedCustomModel();
		if (!model) throw new Error('请先选择总结模型');
		const images = await this.#prepareSelectedImages();
		return this.#customRequest.request({
			model,
			modelContextTokens: this.#selectedModelContextTokens(),
			scope: this.#customScope(),
			purpose: this.#settings.summaryPurpose,
			length: this.#settings.summaryLength,
			...(this.#customScope() === 'range'
				? { floorRange: this.floorRangeInput.value.trim() }
				: {}),
			customPrompt: this.customPromptInput.value.trim(),
			images,
			...(refresh ? { refresh: true } : {}),
			onProgress: (stage, message) => {
				if (this.scope.destroyed) return;
				this.#activeStage = stage;
				this.#status.textContent = message;
				this.#renderProgress();
			},
		});
	}

	async #prepareSelectedImages(): Promise<readonly Readonly<{
		readonly key: string;
		readonly sourcePostNumber: number;
		readonly alt: string;
		readonly dataUrl: string;
	}>[]> {
		if (!this.#selectedImages.length) return Object.freeze([]);
		if (!this.#imageResources) throw new Error('图片资源缓存尚未就绪');
		this.#activeStage = 'preparing-images';
		this.#status.textContent = '正在优先读取所选图片缓存…';
		this.#renderProgress();
		const result: Array<Readonly<{
			readonly key: string;
			readonly sourcePostNumber: number;
			readonly alt: string;
			readonly dataUrl: string;
		}>> = [];
		let totalBytes = 0;
		for (const item of this.#selectedImages) {
			const blob = await this.#imageResources.blob(item, { original: false });
			if (blob.size > 4 * 1_024 * 1_024) {
				throw new Error(`#${item.sourcePostNumber} 的所选图片超过 4 MB`);
			}
			totalBytes += blob.size;
			if (totalBytes > 12 * 1_024 * 1_024) {
				throw new Error('所选图片合计超过 12 MB，请减少图片数量');
			}
			result.push(Object.freeze({
				key: item.key,
				sourcePostNumber: item.sourcePostNumber,
				alt: item.alt,
				dataUrl: await this.#blobDataUrl(blob),
			}));
		}
		return Object.freeze(result);
	}

	async #blobDataUrl(blob: Blob): Promise<string> {
		const bytes = new Uint8Array(await blob.arrayBuffer());
		let binary = '';
		for (let offset = 0; offset < bytes.length; offset += 0x8000) {
			binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
		}
		const encode = this.#document.defaultView?.btoa ?? globalThis.btoa;
		if (typeof encode !== 'function') throw new Error('浏览器不支持图片 Base64 编码');
		return `data:${blob.type || 'application/octet-stream'};base64,${encode(binary)}`;
	}

	async #pickImages(): Promise<void> {
		if (
			!this.#imagePicker ||
			!this.#imageResources ||
			this.#pending ||
			this.#imagePickerActive
		) return;
		this.#imagePickerActive = true;
		this.#render();
		try {
			const selected = await this.#imagePicker.choose(this.#selectedImages, {
				collisionSurface: this.frame.element,
				onCatalog: (total) => {
					this.#availableImageCount = Math.max(0, Math.trunc(total));
					this.#render();
				},
			});
			if (selected === null || this.scope.destroyed) return;
			this.#selectedImages = Object.freeze(selected.slice(0, 6));
			this.#uploadedImage = null;
			this.#restoreSelectionSummary();
			this.#render();
		} catch (cause) {
			this.#onError(cause);
			this.#notify('总结图片选择失败');
		} finally {
			this.#imagePickerActive = false;
			this.#render();
		}
	}

	#render(): void {
		const loading = this.#pending !== null ||
			this.root.classList.contains('is-loading');
		const custom = this.#source() === 'custom';
		const range = custom && this.#customScope() === 'range';
		const generateHost = custom ? this.#optionsRow : this.#methodRow;
		if (this.generateButton.parentElement !== generateHost) {
			generateHost.append(this.generateButton);
		}
		this.#renderHistory();
		this.root.classList.toggle('is-history-open', this.#historyOpen);
		this.#historyPanel.hidden = !this.#historyOpen;
		this.historyButton.disabled = loading;
		this.historyButton.setAttribute('aria-expanded', String(this.#historyOpen));
		this.historyButton.setAttribute(
			'aria-label',
			this.#historyOpen ? '关闭生成历史' : '打开生成历史',
		);
		if (this.#historyOpen) {
			this.frame.meta.textContent = '生成历史';
			return;
		}
		this.#controlRow.classList.toggle('is-custom', custom);
		this.#officialRule.hidden = custom;
		this.#modelField.hidden = !custom;
		this.#tuningRow.hidden = !custom;
		this.#optionsRow.hidden = !custom;
		this.#scopeField.hidden = !custom;
		this.imagePickerButton.hidden = !custom;
		this.promptToggleButton.hidden = !custom;
		this.#rangeField.hidden = !range;
		this.#promptField.hidden = !custom || !this.#promptExpanded;
		this.#customOptions.hidden = !custom ||
			(!range && !this.#promptExpanded);
		const customModelUnavailable = custom &&
			this.customModelSelect.options.length <= 1;
		const customModelUnselected = custom &&
			!customModelUnavailable && !this.#selectedCustomModel();
		this.generateButton.disabled = loading || customModelUnavailable;
		const currentCached = this.#summaries.has(this.#selectionKey());
		const cachedCustom = custom && currentCached;
		const generateLabel = custom
			? cachedCustom ? '重新生成自定义总结' : '生成自定义总结'
			: currentCached
				? '重新获取官方总结'
				: this.#attempted ? '重试官方总结' : '获取官方总结';
		this.generateButton.querySelector('span')!.textContent = generateLabel;
		this.generateButton.setAttribute('aria-label', generateLabel);
		const imageTotal = this.#availableImageCount === null
			? '?'
			: String(this.#availableImageCount);
		this.imagePickerButton.querySelector('span')!.textContent =
			`${this.#selectedImages.length}/${imageTotal}`;
		this.imagePickerButton.setAttribute(
			'aria-label',
			`选择 AI 总结参考图片，已选 ${this.#selectedImages.length} 张，` +
			`全帖共 ${imageTotal} 张，最多选择 6 张`,
		);
		const promptLabel = this.#promptExpanded
			? '收起补充提示词'
			: '展开补充提示词';
		this.promptToggleButton.querySelector('span')!.textContent = promptLabel;
		this.promptToggleButton.setAttribute('aria-label', promptLabel);
		this.promptToggleButton.setAttribute(
			'aria-expanded',
			String(this.#promptExpanded),
		);
		this.promptToggleButton.querySelector('.ldp-icon')?.replaceWith(
			createReaderIcon(
				this.#document,
				this.#promptExpanded ? 'chevron-up' : 'chevron-down',
			),
		);
		this.imagePickerButton.disabled = loading || this.#imagePickerActive ||
			!this.#imagePicker || !this.#imageResources;
		this.sourceSelect.disabled = loading;
		this.customModelSelect.disabled = loading ||
			this.customModelSelect.options.length <= 1;
		this.scopeSelect.disabled = loading;
		this.summaryPurposeSelect.disabled = loading;
		this.summaryLengthSelect.disabled = loading;
		this.floorRangeInput.disabled = loading;
		this.customPromptInput.disabled = loading;
		this.frame.meta.textContent = this.#viewingHistoryId
			? '历史记录'
			: custom ? '自定义 API' : 'LinuxDo';
		this.#progress.hidden = !custom || (!loading && this.#activeStage === null);
		this.#renderProgress();
		this.downloadButton.disabled =
			loading || !this.#summary || !this.#downloads || this.#busy !== null;
		this.replyButton.disabled =
			loading || !this.#summary || !this.#uploader || !this.#openReply ||
			this.#busy !== null;
		this.copyImageButton.disabled =
			loading || !this.#summary || !this.#uploader || !this.#clipboard ||
			this.#busy !== null;
		this.copyButton.disabled = loading || !this.#summary || !this.#clipboard;
		this.root.classList.toggle('has-error', Boolean(this.#errorMessage));
		this.root.classList.toggle('has-summary', Boolean(this.#summary));
		this.root.classList.toggle('is-busy', this.#busy !== null);
		if (loading) {
			if (!custom) this.#status.textContent = '正在获取 LinuxDo 官方总结…';
			this.#preview.hidden = true;
			return;
		}
		if (!this.#summary) {
			this.#status.textContent = this.#errorMessage ||
				(customModelUnavailable
					? '请先在设置面板的「AI 服务」中配置并获取模型'
					: customModelUnselected
						? '请选择一个总结模型'
						: custom
							? '选择范围、可选图片与补充提示词后生成短总结'
						: '官方总结由 LinuxDo 按站点选帖规则生成');
			this.#preview.hidden = true;
			return;
		}
		const viewingEntry = this.#viewingHistoryId
			? this.#historyEntries.find((entry) => entry.id === this.#viewingHistoryId)
			: null;
		this.#status.textContent = this.#busy === 'reply'
			? '图片已生成，正在上传并准备 #1 回复…'
			: this.#busy === 'copy-image'
				? '图片已生成，正在准备剪贴板引用…'
			: this.#busy === 'download'
				? '正在生成下载图片…'
				: viewingEntry
					? `正在查看 ${historyTime(viewingEntry.generatedAt)} 的历史总结`
					: '';
		this.#preview.hidden = false;
		this.#renderPreview();
	}

	#renderHistory(): void {
		const topicPrefix = `${this.#topicUrl()}\n`;
		const entries = this.#historyEntries
			.filter((entry) => entry.key.startsWith(topicPrefix))
			.slice()
			.reverse();
		this.#historyCount.textContent = `本主题 ${entries.length} 条`;
		this.#historyEmpty.hidden = entries.length > 0;
		this.#historyList.hidden = entries.length === 0;
		this.#historyList.replaceChildren(...entries.map((entry) => {
			const item = element(
				this.#document,
				'li',
				'ldp-topic-summary-history-item',
			);
			item.classList.toggle('is-current', entry.id === this.#viewingHistoryId);
			const button = element(
				this.#document,
				'button',
				'ldp-topic-summary-history-entry',
			) as HTMLButtonElement;
			button.type = 'button';
			button.dataset.summaryHistoryId = entry.id;
			const head = element(
				this.#document,
				'span',
				'ldp-topic-summary-history-entry-head',
			);
			const time = element(
				this.#document,
				'time',
				'ldp-topic-summary-history-time',
			);
			time.dateTime = entry.generatedAt;
			time.textContent = historyTime(entry.generatedAt);
			const source = element(
				this.#document,
				'span',
				'ldp-topic-summary-history-source',
			);
			source.textContent = entry.context.source === 'official'
				? 'LinuxDo 官方'
				: '自定义 API';
			head.append(time, source);
			const context = element(
				this.#document,
				'span',
				'ldp-topic-summary-history-context',
			);
			if (entry.context.source === 'official') {
				context.textContent = entry.summary.algorithm || '站点选帖规则';
			} else {
				context.textContent = [
					entry.context.model || entry.summary.algorithm || '自定义模型',
					historyPurposeLabel(entry.context.purpose),
					historyLengthLabel(entry.context.length),
					historyScopeLabel(entry.context),
					entry.context.imageCount
						? `${entry.context.imageCount} 张图`
						: '',
					entry.context.customPrompt ? '含补充提示词' : '',
				].filter(Boolean).join(' · ');
			}
			const excerpt = element(
				this.#document,
				'span',
				'ldp-topic-summary-history-excerpt',
			);
			const plainText = cleanImageText(entry.summary.summarizedText)
				.replace(/\s+/g, ' ');
			excerpt.textContent = plainText.length > 128
				? `${plainText.slice(0, 128)}…`
				: plainText;
			button.append(head, context, excerpt);
			button.setAttribute(
				'aria-label',
				`查看 ${time.textContent} 生成的${source.textContent}总结`,
			);
			item.append(button);
			return item;
		}));
	}

	#renderProgress(): void {
		const stages: readonly ReaderTopicCustomSummaryStage[] = [
			'loading-posts',
			'building-tree',
			'preparing-images',
			'summarizing',
			'finalizing',
		];
		const activeIndex = this.#activeStage === null
			? -1
			: stages.indexOf(this.#activeStage);
		this.#progress.querySelectorAll<HTMLElement>('[data-summary-stage]')
			.forEach((item, index) => {
				item.classList.toggle('is-active', index === activeIndex);
				item.classList.toggle('is-complete', index < activeIndex);
			});
	}

	#renderPreview(): void {
		const imageOptions = this.#shareImageOptions();
		if (!imageOptions || this.#preview.hidden) return;
		try {
			this.#renderShareImage(this.previewCanvas, imageOptions);
			this.#scheduleFontReadyRender(imageOptions);
		} catch (cause) {
			this.#onError(cause);
			this.#status.textContent = '分享图预览生成失败';
		}
	}

	async #openImagePreview(): Promise<void> {
		const imageOptions = this.#shareImageOptions();
		if (
			!imageOptions || !this.#previewImage || this.#previewPending || this.#busy
		) return;
		this.#previewPending = true;
		this.previewCanvas.setAttribute('aria-busy', 'true');
		try {
			const blob = await this.#createShareImage(imageOptions);
			await this.#previewImage({
				blob,
				alt: `${imageOptions.topicTitle} · AI 总结分享图`,
				returnFocus: this.previewCanvas,
			});
		} catch (cause) {
			this.#onError(cause);
			this.#notify('总结图片预览失败');
		} finally {
			this.#previewPending = false;
			this.previewCanvas.removeAttribute('aria-busy');
		}
	}

	#scheduleFontReadyRender(
		imageOptions: ReaderTopicSummaryShareImageOptions,
	): void {
		const key = JSON.stringify([
			imageOptions.chineseFontFamily,
			imageOptions.latinFontFamily,
			imageOptions.bodyFontSize,
		]);
		let pending = this.#fontLoads.get(key);
		if (!pending) {
			pending = loadShareImageFonts(this.#document, imageOptions);
			this.#fontLoads.set(key, pending);
		}
		const epoch = ++this.#fontRenderEpoch;
		void pending.then((loaded) => {
			if (!loaded || this.scope.destroyed || this.#preview.hidden) return;
			if (epoch !== this.#fontRenderEpoch) return;
			const current = this.#shareImageOptions();
			if (!current || JSON.stringify([
				current.chineseFontFamily,
				current.latinFontFamily,
				current.bodyFontSize,
			]) !== key) return;
			this.#renderShareImage(this.previewCanvas, current);
		}).catch((cause: unknown) => this.#onError(cause));
	}

	async #copy(): Promise<void> {
		if (!this.#summary || !this.#clipboard) return;
		this.copyButton.disabled = true;
		try {
			await this.#clipboard.copyText(quotedSummary(
				this.#summary,
				this.#topicUrl(),
			));
			this.#notify(this.#summary.source === 'custom'
				? '已复制带用户链接的自定义 AI 总结引用'
				: '已复制可复用的官方 AI 总结引用');
		} catch (cause) {
			this.#onError(cause);
			this.#notify('复制失败，请检查浏览器剪贴板权限');
		} finally {
			this.copyButton.disabled = false;
		}
	}

	async #downloadImage(): Promise<void> {
		const imageOptions = this.#shareImageOptions();
		if (!imageOptions || !this.#downloads || this.#busy) return;
		this.#busy = 'download';
		this.downloadButton.classList.add('is-busy');
		this.#render();
		try {
			const blob = await this.#createShareImage(imageOptions);
			await this.#downloads.save(
				blob,
				safeTopicFilename(imageOptions.topicTitle),
			);
			this.#notify('AI 总结分享图已下载');
		} catch (cause) {
			this.#onError(cause);
			this.#notify('总结图片下载失败');
		} finally {
			this.#busy = null;
			this.downloadButton.classList.remove('is-busy');
			this.#render();
		}
	}

	async #replyWithImage(): Promise<void> {
		const imageOptions = this.#shareImageOptions();
		if (!imageOptions || !this.#uploader || !this.#openReply || this.#busy) {
			return;
		}
		this.#busy = 'reply';
		this.replyButton.classList.add('is-busy');
		this.#render();
		this.#notify('AI 总结图片正在上传…');
		try {
			const uploaded = await this.#uploadImage(imageOptions);
			await this.#openReply(imageReply(
				uploaded.shortUrl || uploaded.url,
				imageOptions.topicTitle,
				imageOptions.topicUrl,
				imageOptions.summary,
			));
			this.#notify('图片已带入 #1 回复框，请确认后发送');
			this.close();
		} catch (cause) {
			this.#onError(cause);
			this.#notify('图片上传或回复框打开失败');
		} finally {
			this.#busy = null;
			this.replyButton.classList.remove('is-busy');
			this.#render();
		}
	}

	async #copyImageReply(): Promise<void> {
		const imageOptions = this.#shareImageOptions();
		if (
			!imageOptions || !this.#uploader || !this.#clipboard || this.#busy
		) return;
		this.#busy = 'copy-image';
		this.copyImageButton.classList.add('is-busy');
		this.#render();
		this.#notify('AI 总结图片正在上传…');
		try {
			const uploaded = await this.#uploadImage(imageOptions);
			await this.#clipboard.copyText(imageReply(
				uploaded.shortUrl || uploaded.url,
				imageOptions.topicTitle,
				imageOptions.topicUrl,
				imageOptions.summary,
			));
			this.#notify('已复制可粘贴到任意回复框的带图引用');
		} catch (cause) {
			this.#onError(cause);
			this.#notify('图片上传或剪贴板写入失败');
		} finally {
			this.#busy = null;
			this.copyImageButton.classList.remove('is-busy');
			this.#render();
		}
	}

	async #uploadImage(
		imageOptions: ReaderTopicSummaryShareImageOptions,
	): Promise<ReaderTopicSummaryImageUpload> {
		if (!this.#uploader) throw new Error('图片上传能力不可用');
		const key = JSON.stringify({
			style: imageOptions.style,
			chineseFontFamily: imageOptions.chineseFontFamily,
			latinFontFamily: imageOptions.latinFontFamily,
			width: imageOptions.width,
			bodyFontSize: imageOptions.bodyFontSize,
			topicTitle: imageOptions.topicTitle,
			source: imageOptions.summary.source,
			summarizedText: imageOptions.summary.summarizedText,
		});
		if (this.#uploadedImage?.key === key) return this.#uploadedImage.value;
		const filename = safeTopicFilename(imageOptions.topicTitle);
		const blob = await this.#createShareImage(imageOptions);
		const value = await this.#uploader.upload(blob, filename);
		this.#uploadedImage = Object.freeze({ key, value });
		return value;
	}

}
