import type { DiscourseHostApiPort } from './native-host-api.js';
import {
	DiscourseNativePostModelFactory,
	type DiscourseNativeTopicModelInput,
} from './native-post-model-factory.js';
import type { DiscourseTopicPostInput } from '../topic/topic-session.js';
import { DiscourseActionDescriptors } from '../post/discourse-action-descriptors.js';
import {
	BrowserDiscourseNativeActionPort,
	discourseActionTransportDefinition,
} from '../post/discourse-action-transport.js';
import { valueRecord as record } from '../kernel/value-record.js';

export interface DiscourseTopicNotificationLevelMutationPort {
	setLevel(topic: unknown, level: 0 | 1 | 2 | 3): Promise<void>;
}

function modelValue(value: unknown, key: string): unknown {
	const source = record(value);
	const getter = source?.get;
	return typeof getter === 'function'
		? getter.call(value, key)
		: source?.[key];
}

/**
 * 宿主 Topic 列表没有 canonical TopicSession，列表级通知动作仍须复用已登记的
 * TopicDetails.updateNotifications 原生 binding；这里仅补齐 model、descriptor 与执行端口。
 */
export class BrowserDiscourseTopicNotificationLevelMutationPort
implements DiscourseTopicNotificationLevelMutationPort {
	readonly #models: DiscourseNativePostModelFactory;
	readonly #descriptors = new DiscourseActionDescriptors();
	readonly #actions: BrowserDiscourseNativeActionPort;

	constructor(host: DiscourseHostApiPort) {
		this.#models = new DiscourseNativePostModelFactory(host);
		this.#actions = new BrowserDiscourseNativeActionPort(host);
	}

	async setLevel(topic: unknown, level: 0 | 1 | 2 | 3): Promise<void> {
		const topicId = Number(modelValue(topic, 'id'));
		if (!Number.isSafeInteger(topicId) || topicId < 1) {
			throw new RangeError('宿主话题通知动作缺少有效 Topic ID');
		}
		const topicDetails = this.#models.createTopicDetails(
			topic as DiscourseNativeTopicModelInput<DiscourseTopicPostInput>,
		);
		const mutation = this.#descriptors.topicNotificationLevel<object>({
			topicId,
			topicDetails,
			level,
		});
		const definition = discourseActionTransportDefinition(
			mutation.operation,
			mutation.targetType,
		);
		const response = await this.#actions.execute<object>({
			definition,
			targetId: mutation.targetId,
			variant: mutation.variant ?? null,
			payload: mutation.payload,
			signal: new AbortController().signal,
			attempt: 0,
		});
		if (!response.ok) {
			throw new Error(`宿主话题通知设置失败（HTTP ${response.status || 0}）`);
		}
	}
}
