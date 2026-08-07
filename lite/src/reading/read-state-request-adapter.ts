import {
	discourseAuthScope,
	discoursePostNumbers,
	discourseTopicId,
	type DiscourseAuthScope,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import {
	discourseBasePath,
	DiscourseNativeRequests,
} from '../discourse/native-request-descriptors.js';
import type {
	ReadStateRequest,
} from '../network/domain-request-gateway.js';
import type {
	DiscourseNativeMutationTransport,
} from '../network/discourse-native-read-transport.js';

export interface ReadStateRequestPort {
	submitReadState<T>(input: ReadStateRequest<T>): Promise<T>;
}

export interface ReadStateRequestAdapterOptions {
	readonly gateway: ReadStateRequestPort;
	readonly transport: DiscourseNativeMutationTransport;
	readonly authScope: string;
	readonly topicId: string | number;
	readonly signal: AbortSignal;
	readonly basePath?: string;
	readonly readTimeMs?: number;
}

function positiveMilliseconds(value: number | undefined): number {
	const milliseconds = Number(value ?? 1_500);
	if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 60_000) {
		throw new RangeError('readTimeMs 必须是 1..60000 的安全整数');
	}
	return milliseconds;
}

/**
 * Discourse timings endpoint 的唯一适配器。
 *
 * 它只把 canonical 楼层号映射成请求 body/headers，并交给 DomainRequestGateway；
 * 不拥有 pending/confirmed、批次、重试、DOM 或跨 tab 状态。
 */
export class ReadStateRequestAdapter {
	readonly topicId: DiscourseTopicId;
	readonly authScope: DiscourseAuthScope;
	readonly #gateway: ReadStateRequestPort;
	readonly #transport: DiscourseNativeMutationTransport;
	readonly #signal: AbortSignal;
	readonly #basePath: string;
	readonly #readTimeMs: number;

	constructor(options: ReadStateRequestAdapterOptions) {
		this.#gateway = options.gateway;
		this.#transport = options.transport;
		this.authScope = discourseAuthScope(options.authScope);
		this.topicId = discourseTopicId(options.topicId);
		this.#signal = options.signal;
		this.#basePath = discourseBasePath(options.basePath);
		this.#readTimeMs = positiveMilliseconds(options.readTimeMs);
	}

	async submit(
		rawPostNumbers: readonly number[],
	): Promise<readonly DiscoursePostNumber[]> {
		const postNumbers = discoursePostNumbers(rawPostNumbers);
		const descriptor = DiscourseNativeRequests.topicTimings({
			basePath: this.#basePath,
			topicId: this.topicId,
			postNumbers,
			readTimeMs: this.#readTimeMs,
		});
		await this.#gateway.submitReadState({
			authScope: this.authScope,
			topicId: this.topicId,
			postNumbers,
			input: descriptor.path,
			method: 'POST',
			signal: this.#signal,
			transport: (input) => this.#transport.request<unknown>({
				descriptor,
				signal: input.signal,
				attempt: input.attempt,
			}),
		});
		return postNumbers;
	}
}
