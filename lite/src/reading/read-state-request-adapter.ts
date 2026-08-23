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
import {
	normalizeReadStateSubmission,
	type ReadStateSubmission,
} from './read-state-coordination.js';

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

	constructor(options: ReadStateRequestAdapterOptions) {
		this.#gateway = options.gateway;
		this.#transport = options.transport;
		this.authScope = discourseAuthScope(options.authScope);
		this.topicId = discourseTopicId(options.topicId);
		this.#signal = options.signal;
		this.#basePath = discourseBasePath(options.basePath);
	}

	async submit(
		rawSubmission: ReadStateSubmission,
	): Promise<readonly DiscoursePostNumber[]> {
		const submission = normalizeReadStateSubmission(rawSubmission);
		const postNumbers = discoursePostNumbers(
			submission.timings.map((timing) => timing.postNumber),
		);
		const descriptor = DiscourseNativeRequests.topicTimings({
			basePath: this.#basePath,
			topicId: this.topicId,
			timings: submission.timings,
			topicTimeMs: submission.topicTimeMs,
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
