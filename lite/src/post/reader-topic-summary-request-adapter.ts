import {
	discourseAuthScope,
	discourseTopicId,
	type DiscourseAuthScope,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import {
	discourseBasePath,
	DiscourseNativeRequests,
} from '../discourse/native-request-descriptors.js';
import { objectRecord } from '../kernel/value-record.js';
import type {
	ActionRequest,
} from '../network/domain-request-gateway.js';
import type {
	DiscourseNativeMutationTransport,
} from '../network/discourse-native-read-transport.js';

const TOPIC_SUMMARY_TIMEOUT_MS = 120_000;
const TOPIC_SUMMARY_IMAGE_UPLOAD_TIMEOUT_MS = 120_000;

export interface ReaderTopicSummary {
	readonly summarizedText: string;
	readonly algorithm: string;
	readonly source: 'official' | 'custom';
	readonly scope?: 'starter' | 'all' | 'owner' | 'range';
	readonly outdated: boolean;
	readonly canRegenerate: boolean;
	readonly newPostsSinceSummary: number;
	readonly updatedAt: string;
}

export interface ReaderTopicSummaryRequestPort {
	request(): Promise<ReaderTopicSummary>;
}

export interface ReaderTopicSummaryImageUpload {
	readonly url: string;
	readonly shortUrl: string;
	readonly originalFilename: string;
	readonly width: number;
	readonly height: number;
}

export interface ReaderTopicSummaryImageUploadPort {
	upload(blob: Blob, filename: string): Promise<ReaderTopicSummaryImageUpload>;
}

export interface ReaderTopicSummaryGateway {
	mutate<T>(input: ActionRequest<T>): Promise<T>;
}

export interface ReaderTopicSummaryRequestAdapterOptions {
	readonly gateway: ReaderTopicSummaryGateway;
	readonly transport: DiscourseNativeMutationTransport;
	readonly authScope: string;
	readonly topicId: string | number;
	readonly signal: AbortSignal;
	readonly basePath?: string;
}

export interface ReaderTopicSummaryImageUploadAdapterOptions
extends ReaderTopicSummaryRequestAdapterOptions {
	readonly createFormData?: () => FormData;
}

function normalizedCount(value: unknown): number {
	const count = Number(value ?? 0);
	return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

export function normalizeReaderTopicSummary(value: unknown): ReaderTopicSummary {
	const root = objectRecord(value);
	const payload = objectRecord(root?.ai_topic_summary) ??
		objectRecord(root?.summary) ??
		root;
	const summarizedText = String(payload?.summarized_text ?? '').trim();
	if (!summarizedText) {
		throw new Error('LinuxDo 官方 AI 总结没有返回可显示的内容');
	}
	return Object.freeze({
		summarizedText,
		algorithm: String(payload?.algorithm ?? '').trim(),
		source: 'official',
		outdated: payload?.outdated === true,
		canRegenerate: payload?.can_regenerate === true,
		newPostsSinceSummary: normalizedCount(payload?.new_posts_since_summary),
		updatedAt: String(
			payload?.updated_at ?? payload?.summarized_on ?? '',
		).trim(),
	});
}

export function normalizeReaderTopicSummaryImageUpload(
	value: unknown,
): ReaderTopicSummaryImageUpload {
	const root = objectRecord(value);
	const payload = objectRecord(root?.upload) ?? root;
	const shortUrl = String(
		payload?.short_url ?? payload?.short_path ?? '',
	).trim();
	const url = String(payload?.url ?? shortUrl).trim();
	if (!url) throw new Error('LinuxDo 图片上传没有返回可用链接');
	return Object.freeze({
		url,
		shortUrl: shortUrl || url,
		originalFilename: String(payload?.original_filename ?? '').trim(),
		width: normalizedCount(payload?.width),
		height: normalizedCount(payload?.height),
	});
}

/**
 * LinuxDo 官方 Topic Summary 的唯一请求适配器。
 *
 * 非流式 POST 由宿主 Discourse ajax 执行，并继续经过统一 scheduler、限流、
 * Cloudflare 与超时契约；本适配器不持久化结果，也不自行重放请求。
 */
export class ReaderTopicSummaryRequestAdapter
implements ReaderTopicSummaryRequestPort {
	readonly topicId: DiscourseTopicId;
	readonly authScope: DiscourseAuthScope;
	readonly #gateway: ReaderTopicSummaryGateway;
	readonly #transport: DiscourseNativeMutationTransport;
	readonly #signal: AbortSignal;
	readonly #basePath: string;

	constructor(options: ReaderTopicSummaryRequestAdapterOptions) {
		this.#gateway = options.gateway;
		this.#transport = options.transport;
		this.authScope = discourseAuthScope(options.authScope);
		this.topicId = discourseTopicId(options.topicId);
		this.#signal = options.signal;
		this.#basePath = discourseBasePath(options.basePath);
	}

	async request(): Promise<ReaderTopicSummary> {
		const descriptor = DiscourseNativeRequests.topicSummary({
			basePath: this.#basePath,
			topicId: this.topicId,
		});
		const value = await this.#gateway.mutate<unknown>({
			authScope: this.authScope,
			operation: descriptor.operation,
			targetType: 'topic',
			targetId: this.topicId,
			input: descriptor.path,
			method: descriptor.method,
			signal: this.#signal,
			timeoutMs: TOPIC_SUMMARY_TIMEOUT_MS,
			transport: (input) => this.#transport.request<unknown>({
				descriptor,
				signal: input.signal,
				attempt: input.attempt,
			}),
		});
		return normalizeReaderTopicSummary(value);
	}
}

/** AI 总结分享图的唯一上传适配器；multipart 仍由原生 ajax 与中央 Gateway 执行。 */
export class ReaderTopicSummaryImageUploadAdapter
implements ReaderTopicSummaryImageUploadPort {
	readonly topicId: DiscourseTopicId;
	readonly authScope: DiscourseAuthScope;
	readonly #gateway: ReaderTopicSummaryGateway;
	readonly #transport: DiscourseNativeMutationTransport;
	readonly #signal: AbortSignal;
	readonly #basePath: string;
	readonly #createFormData: () => FormData;

	constructor(options: ReaderTopicSummaryImageUploadAdapterOptions) {
		this.#gateway = options.gateway;
		this.#transport = options.transport;
		this.authScope = discourseAuthScope(options.authScope);
		this.topicId = discourseTopicId(options.topicId);
		this.#signal = options.signal;
		this.#basePath = discourseBasePath(options.basePath);
		this.#createFormData = options.createFormData ?? (() => new FormData());
	}

	async upload(
		blob: Blob,
		filename: string,
	): Promise<ReaderTopicSummaryImageUpload> {
		if (!blob || typeof blob.size !== 'number' || blob.size < 1) {
			throw new Error('AI 总结图片为空，无法上传');
		}
		const normalizedFilename = String(filename).trim();
		if (!normalizedFilename) throw new Error('AI 总结图片文件名不能为空');
		const formData = this.#createFormData();
		formData.append('upload_type', 'composer');
		formData.append('files[]', blob, normalizedFilename);
		const descriptor = DiscourseNativeRequests.topicSummaryImageUpload({
			basePath: this.#basePath,
			formData,
		});
		const value = await this.#gateway.mutate<unknown>({
			authScope: this.authScope,
			operation: descriptor.operation,
			targetType: 'topic',
			targetId: this.topicId,
			variant: 'summary-image',
			input: descriptor.path,
			method: descriptor.method,
			signal: this.#signal,
			timeoutMs: TOPIC_SUMMARY_IMAGE_UPLOAD_TIMEOUT_MS,
			transport: (input) => this.#transport.request<unknown>({
				descriptor,
				signal: input.signal,
				attempt: input.attempt,
			}),
		});
		return normalizeReaderTopicSummaryImageUpload(value);
	}
}
