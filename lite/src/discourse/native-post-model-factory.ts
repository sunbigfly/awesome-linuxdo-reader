import {
	discoursePostReference,
	discourseTopicId,
	type DiscourseTopicId,
} from './identifiers.js';
import {
	discourseNativePostEventModel,
	discourseNativeEmojiUrl,
	discourseNativePostRuntimeBindings,
	type DiscourseHostApiPort,
	type DiscourseNativePostRuntimeBindings,
} from './native-host-api.js';
import {
	BrowserDiscourseMessageBusPort,
} from './native-message-bus.js';
import type { Cleanup } from '../kernel/lifecycle.js';
import {
	valueRecord as record,
	type MutableUnknownRecord as MutableRecord,
} from '../kernel/value-record.js';
import type {
	DiscourseTopicPayload,
	DiscourseTopicPostInput,
} from '../topic/topic-session.js';

export interface DiscourseNativeTopicModelInput<
	TPost extends DiscourseTopicPostInput,
> extends DiscourseTopicPayload<TPost> {
	readonly title?: unknown;
	readonly fancy_title?: unknown;
	readonly category_id?: unknown;
	readonly archetype?: unknown;
	readonly draft_key?: unknown;
	readonly draft_sequence?: unknown;
	readonly last_posted_at?: unknown;
	readonly chunk_size?: unknown;
	readonly details?: unknown;
	readonly tags?: unknown;
}

export interface DiscourseNativePostModelInput extends DiscourseTopicPostInput {
	readonly name?: unknown;
	readonly avatar_template?: unknown;
	readonly post_type?: unknown;
	readonly reply_count?: unknown;
	readonly actions_summary?: unknown;
}

export interface DiscourseNativePostContext {
	readonly topic: object;
	readonly post: object;
	readonly appEvents: object;
}

export interface DiscourseNativeReactionRegistry {
	readonly configuredIds: readonly string[];
	readonly mainReaction: string;
	emojiUrl(id: string): string;
}

export interface DiscourseNativePostFlagAction {
	readonly nameKey: string;
	readonly action: object;
}

export interface DiscourseNativePostReportContext {
	readonly post: object;
	readonly actions: readonly DiscourseNativePostFlagAction[];
}

export interface DiscourseNativePostEventInput {
	readonly id?: unknown;
	readonly [key: string]: unknown;
}

export interface DiscourseNativeTopicDetailsFactory {
	createTopicDetails<TPost extends DiscourseTopicPostInput>(
		topic: DiscourseNativeTopicModelInput<TPost>,
	): object;
}

function moduleDefault(moduleValue: unknown, name: string): MutableRecord {
	const module = record(moduleValue);
	const value = record(module?.default);
	if (!value) throw new Error(`Discourse 原生模块未就绪：${name}`);
	return value;
}

function modelValue(value: unknown, key: string): unknown {
	const target = record(value);
	const getter = target?.get;
	return typeof getter === 'function'
		? getter.call(target, key)
		: target?.[key];
}

function setModelValue(value: unknown, key: string, next: unknown): void {
	const target = record(value);
	const set = target?.set;
	if (typeof set === 'function') {
		set.call(target, key, next);
		return;
	}
	if (target) target[key] = next;
}

function reactionId(value: unknown): string {
	return String(value ?? '').trim().replace(/^:+|:+$/g, '');
}

function modelFactory(
	moduleValue: unknown,
	name: string,
): MutableRecord & { create(attributes: unknown): object } {
	const model = moduleDefault(moduleValue, name);
	if (typeof model.create !== 'function') {
		throw new Error(`Discourse 原生 model 缺少 create：${name}`);
	}
	return model as MutableRecord & { create(attributes: unknown): object };
}

/**
 * Reader JSON 到 Discourse 原生 Topic/Post model 的唯一窄工厂。
 *
 * Composer、点赞、回应和楼层管理只能复用这里的字段归一化；本工厂不发请求、不缓存
 * canonical post，也不修改传入 JSON。
 */
export class DiscourseNativePostModelFactory {
	readonly #host: DiscourseHostApiPort;
	#bindings: DiscourseNativePostRuntimeBindings | null = null;

	constructor(host: DiscourseHostApiPort) {
		this.#host = host;
	}

	/**
	 * 只解析并校验回复 Composer 必需的 Topic/Post 原生 model。
	 *
	 * 该预热入口不创建 model、不读取 draft，也不触发任何宿主请求；实际回复仍由
	 * DiscourseComposerCoordinator 在用户操作后创建对应 Topic/Post 实例。
	 */
	prepareComposerBindings(): void {
		const bindings = this.#runtimeBindings();
		modelFactory(bindings.topicModel, 'discourse/models/topic');
		const Post = modelFactory(bindings.postModel, 'discourse/models/post');
		if (typeof Post.munge !== 'function') {
			throw new Error('Discourse Post.munge 未就绪');
		}
	}

	createTopic<TPost extends DiscourseTopicPostInput>(
		topic: DiscourseNativeTopicModelInput<TPost>,
	): object {
		const bindings = this.#runtimeBindings();
		return this.#createTopic(topic, bindings.topicModel);
	}

	createTopicDetails<TPost extends DiscourseTopicPostInput>(
		topic: DiscourseNativeTopicModelInput<TPost>,
	): object {
		const bindings = this.#runtimeBindings();
		const TopicDetails = modelFactory(
			bindings.topicDetailsModel,
			'discourse/models/topic-details',
		);
		const details = record(topic.details);
		const topicRecord = topic as unknown as Readonly<Record<string, unknown>>;
		return TopicDetails.create({
			...(details ?? {}),
			topic: this.#createTopic(topic, bindings.topicModel),
			notification_level:
				topicRecord.notification_level ??
				modelValue(details, 'notification_level') ??
				1,
		});
	}

	createPost<TPost extends DiscourseTopicPostInput>(
		topic: DiscourseNativeTopicModelInput<TPost>,
		post: DiscourseNativePostModelInput,
		topicModel?: object,
	): object {
		const bindings = this.#runtimeBindings();
		const owner = topicModel ?? this.#createTopic(topic, bindings.topicModel);
		return this.#createPost(topic, post, owner, bindings.postModel);
	}

	createContext<TPost extends DiscourseTopicPostInput>(
		topic: DiscourseNativeTopicModelInput<TPost>,
		post: DiscourseNativePostModelInput,
	): DiscourseNativePostContext {
		const bindings = this.#runtimeBindings();
		const appEvents = record(bindings.appEvents);
		if (!appEvents) throw new Error('Discourse app-events service 未就绪');
		const topicModel = this.#createTopic(topic, bindings.topicModel);
		return Object.freeze({
			topic: topicModel,
			post: this.#createPost(topic, post, topicModel, bindings.postModel),
			appEvents,
		});
	}

	/**
	 * discourse-calendar 的活动报名必须携带插件原生 Event model。
	 *
	 * 特殊正文 feature 只提交 canonical event JSON；module lookup 与 model.create 继续
	 * 收口在同一原生 model 工厂，不能由 DOM 组件自行解析插件模块。
	 */
	createPostEvent(
		event: DiscourseNativePostEventInput,
		fallbackPostId: number,
	): object {
		const EventModel = modelFactory(
			discourseNativePostEventModel(this.#host),
			'discourse-post-event-event',
		);
		const id = Number(event.id) || Number(fallbackPostId);
		if (!Number.isSafeInteger(id) || id < 1) {
			throw new RangeError('活动必须具有正安全整数 ID');
		}
		return EventModel.create({
			...event,
			id,
		});
	}

	/**
	 * Discourse `/client_settings` 是回应目录热更新的唯一宿主事件源。
	 *
	 * 收到消息后先更新原生 site-settings service，再通知现有 PostView 重投；本方法
	 * 不请求 emoji 目录、不维护第二份设置快照，也不暴露 MessageBus 给 UI。
	 */
	subscribeClientSettings(listener: () => void): Cleanup {
		if (typeof listener !== 'function') {
			throw new TypeError('client settings listener 必须是函数');
		}
		const messageBus = new BrowserDiscourseMessageBusPort(this.#host);
		const handler = (message: unknown): void => {
			const input = record(message);
			const name = String(input?.name ?? '').trim();
			if (![
				'discourse_reactions_enabled_reactions',
				'discourse_reactions_reaction_for_like',
			].includes(name)) return;
			setModelValue(
				this.#runtimeBindings().siteSettings,
				name,
				input?.value,
			);
			listener();
		};
		try {
			messageBus.subscribe('/client_settings', handler);
		} catch {
			return () => {};
		}
		return () => {
			try {
				messageBus.unsubscribe('/client_settings', handler);
			} catch {
				// 宿主切页已先销毁 MessageBus 时，Reader cleanup 仍保持幂等。
			}
		};
	}

	/**
	 * 需要原生 current-user model 作为参数的动作共用这一窄入口。
	 *
	 * 不把 service lookup 暴露给 UI；匿名态返回 null，由动作组件保持原按钮不可用。
	 */
	currentUser(): object | null {
		return record(this.#runtimeBindings().currentUser);
	}

	sharedIssueAllowsMultipleSolutions(): boolean {
		return modelValue(
			this.#runtimeBindings().siteSettings,
			'solved_allow_multiple_solutions',
		) === true;
	}

	minimumPostLength(): number {
		const value = Number(modelValue(
			this.#runtimeBindings().siteSettings,
			'min_post_length',
		));
		return Number.isSafeInteger(value) && value > 0 ? value : 16;
	}

	reactionRegistry(): DiscourseNativeReactionRegistry {
		const bindings = this.#runtimeBindings();
		const settings = record(bindings.siteSettings);
		const configuredValue = modelValue(
			settings,
			'discourse_reactions_enabled_reactions',
		);
		const source = Array.isArray(configuredValue)
			? configuredValue
			: String(configuredValue ?? '').split('|');
		const configuredIds = Object.freeze(
			source.map(reactionId).filter(Boolean),
		);
		const mainReaction = reactionId(modelValue(
			settings,
			'discourse_reactions_reaction_for_like',
		));
		return Object.freeze({
			configuredIds,
			mainReaction,
			emojiUrl: (id: string): string =>
				discourseNativeEmojiUrl(this.#host, reactionId(id)),
		});
	}

	reportContext<TPost extends DiscourseTopicPostInput>(
		topic: DiscourseNativeTopicModelInput<TPost>,
		post: DiscourseNativePostModelInput,
		nameKeys: readonly string[],
	): DiscourseNativePostReportContext {
		const native = this.createContext(topic, post);
		const actionByName = modelValue(native.post, 'actionByName');
		const actions = [...new Set(nameKeys
			.map(String)
			.map((name) => name.trim())
			.filter(Boolean))]
			.map((nameKey) => {
				const action = modelValue(actionByName, nameKey);
				const actionRecord = record(action);
				if (
					modelValue(action, 'can_act') !== true ||
					!actionRecord
				) {
					return null;
				}
				if (Number(post.post_number) === 1) {
					actionRecord.flagTopic = native.post;
				}
				return Object.freeze({
					nameKey,
					action: action as object,
				});
			})
			.filter(
				(value): value is DiscourseNativePostFlagAction =>
					value !== null,
			);
		return Object.freeze({
			post: native.post,
			actions: Object.freeze(actions),
		});
	}

	#createTopic<TPost extends DiscourseTopicPostInput>(
		topic: DiscourseNativeTopicModelInput<TPost>,
		topicModule: unknown,
	): object {
		const topicId = discourseTopicId(topic.id);
		const Topic = modelFactory(topicModule, 'discourse/models/topic');
		const details = record(topic.details);
		return Topic.create({
			id: topicId,
			title: String(topic.title ?? ''),
			fancy_title: String(topic.fancy_title ?? topic.title ?? ''),
			slug: String(topic.slug ?? 'topic'),
			category_id: topic.category_id,
			archetype: String(topic.archetype ?? 'regular'),
			draft_key: topic.draft_key,
			draft_sequence: topic.draft_sequence,
			posts_count: topic.posts_count,
			highest_post_number: topic.highest_post_number,
			last_posted_at: topic.last_posted_at,
			chunk_size: topic.chunk_size,
			details: { can_create_post: true, ...(details ?? {}) },
			tags: Array.isArray(topic.tags) ? [...topic.tags] : [],
		});
	}

	#createPost<TPost extends DiscourseTopicPostInput>(
		topic: DiscourseNativeTopicModelInput<TPost>,
		post: DiscourseNativePostModelInput,
		topicModel: object,
		postModule: unknown,
	): object {
		const topicId: DiscourseTopicId = discourseTopicId(topic.id);
		if (
			post.topic_id !== undefined &&
			discourseTopicId(post.topic_id) !== topicId
		) {
			throw new Error('楼层不属于目标 Topic');
		}
		const Post = modelFactory(postModule, 'discourse/models/post');
		if (typeof Post.munge !== 'function') {
			throw new Error('Discourse Post.munge 未就绪');
		}
		const reference = discoursePostReference(post);
		const actions = Array.isArray(post.actions_summary)
			? post.actions_summary.map((action) =>
				action && typeof action === 'object' ? { ...action } : action)
			: [];
		const attributes = {
			...post,
			id: reference.postId,
			topic_id: topicId,
			post_number: reference.postNumber,
			username: String(post.username ?? ''),
			name: String(post.name ?? ''),
			avatar_template: String(post.avatar_template ?? ''),
			post_type: Number(post.post_type ?? 1),
			reply_count: Number(post.reply_count ?? 0),
			topic: topicModel,
			actions_summary: actions,
		};
		const munge = Post.munge as (attributes: unknown) => unknown;
		return Post.create(munge.call(Post, attributes));
	}

	#runtimeBindings(): DiscourseNativePostRuntimeBindings {
		if (this.#bindings) return this.#bindings;
		const bindings = discourseNativePostRuntimeBindings(this.#host);
		if (Object.values(bindings).every((value) =>
			value !== null && value !== undefined)) {
			this.#bindings = bindings;
		}
		return bindings;
	}
}
