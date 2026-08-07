import type {
	DiscourseNativeTopicEditCatalogPort,
	DiscourseNativeTopicEditTag,
} from '../discourse/native-host-api.js';
import type {
	DiscourseNativePostModelFactory,
	DiscourseNativeTopicModelInput,
} from '../discourse/native-post-model-factory.js';
import { discourseTopicId, type DiscourseTopicId } from '../discourse/identifiers.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { valueRecord as record } from '../kernel/value-record.js';
import type { DiscourseActionDescriptors } from '../post/discourse-action-descriptors.js';
import type { PostActionController } from '../post/post-action-controller.js';
import {
	TopicActionFeatureCommands,
	type TopicActionSessionPort,
} from '../post/topic-action-feature-commands.js';
import type {
	ReaderTopicEditFormPort,
	ReaderTopicEditSubmission,
} from '../shell/reader-topic-edit-form-surface.js';
import type {
	DiscourseTopicPostInput,
	TopicSessionCommit,
} from './topic-session.js';
import type { Signal } from '../kernel/signal.js';

type TopicRecord<TPost extends DiscourseTopicPostInput> =
	DiscourseNativeTopicModelInput<TPost> & Readonly<Record<string, unknown>>;

export interface ReaderTopicEditSessionPort<TTopic> extends
	TopicActionSessionPort<TTopic> {
	readonly changes: Signal<TopicSessionCommit>;
}

export interface ReaderTopicEditControllerOptions<
	TTopic extends DiscourseNativeTopicModelInput<TPost>,
	TPost extends DiscourseTopicPostInput,
> {
	readonly topicId: number;
	readonly session: ReaderTopicEditSessionPort<TTopic>;
	readonly trigger: HTMLButtonElement;
	readonly form: ReaderTopicEditFormPort;
	readonly catalog: DiscourseNativeTopicEditCatalogPort;
	readonly actions: PostActionController;
	readonly descriptors: DiscourseActionDescriptors;
	readonly models: DiscourseNativePostModelFactory;
	readonly parentScope?: LifecycleScope;
	readonly notify?: (message: string) => void;
	readonly onError?: (error: unknown) => void;
}

function text(value: unknown): string {
	return String(value ?? '').trim();
}

function topicCanEdit(value: unknown): boolean {
	return record(record(value)?.details)?.can_edit === true;
}

function categoryName(value: unknown): string {
	return text(value).replace(/\s*[,，]\s*Lv\s*\d+\s*$/i, '').trim();
}

function categoryLevel(value: unknown): string {
	const match = text(value).match(/(?:^|[,，]\s*)Lv\s*(\d+)\s*$/i);
	return match?.[1] ? `Lv${match[1]}` : '';
}

function topicTags(value: unknown): readonly DiscourseNativeTopicEditTag[] {
	const tags = record(value)?.tags;
	if (!Array.isArray(tags)) return Object.freeze([]);
	const byName = new Map<string, DiscourseNativeTopicEditTag>();
	for (const value of tags) {
		const source = record(value);
		const name = text(source?.name ?? source?.text ?? value);
		if (!name) continue;
		const id = Number(source?.id);
		byName.set(name.toLocaleLowerCase(), Object.freeze({
			id: Number.isSafeInteger(id) && id > 0 ? id : null,
			name,
		}));
	}
	return Object.freeze([...byName.values()]);
}

/**
 * Header Topic 编辑的唯一领域协调器。
 *
 * 权限只读 canonical `details.can_edit`；表单只提交值对象；保存只经原生 Topic model、
 * 中央 action controller 和 TopicSession commit，不维护第二份 Topic。
 */
export class ReaderTopicEditController<
	TTopic extends DiscourseNativeTopicModelInput<TPost>,
	TPost extends DiscourseTopicPostInput,
> {
	readonly topicId: DiscourseTopicId;
	readonly scope: LifecycleScope;
	readonly #session: ReaderTopicEditSessionPort<TopicRecord<TPost>>;
	readonly #trigger: HTMLButtonElement;
	readonly #form: ReaderTopicEditFormPort;
	readonly #catalog: DiscourseNativeTopicEditCatalogPort;
	readonly #actions: PostActionController;
	readonly #commands: TopicActionFeatureCommands<TopicRecord<TPost>>;
	readonly #descriptors: DiscourseActionDescriptors;
	readonly #models: DiscourseNativePostModelFactory;
	readonly #onError: (error: unknown) => void;
	readonly #notify: (message: string) => void;
	readonly #abort = new AbortController();
	#opening: Promise<boolean> | null = null;

	constructor(options: ReaderTopicEditControllerOptions<TTopic, TPost>) {
		this.topicId = discourseTopicId(options.topicId);
		this.#session = options.session as unknown as
			ReaderTopicEditSessionPort<TopicRecord<TPost>>;
		this.#trigger = options.trigger;
		this.#form = options.form;
		this.#catalog = options.catalog;
		this.#actions = options.actions;
		this.#commands = new TopicActionFeatureCommands({
			topicId: this.topicId,
			session: this.#session,
		});
		this.#descriptors = options.descriptors;
		this.#models = options.models;
		this.#onError = options.onError ?? (() => {});
		this.#notify = options.notify ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#abort.abort(new Error('Reader Topic 编辑生命周期已结束'));
			this.#trigger.hidden = true;
			this.#trigger.setAttribute('aria-expanded', 'false');
		});
		this.scope.listen(this.#trigger, 'click', () => {
			void this.open().catch((error) => this.#report(error));
		});
		this.#session.changes.subscribe(() => this.sync(), this.scope);
		this.sync();
	}

	sync(): void {
		const canEdit = topicCanEdit(this.#session.topic);
		this.#trigger.hidden = !canEdit;
		this.#trigger.disabled = !canEdit;
		if (!canEdit) this.#trigger.setAttribute('aria-expanded', 'false');
	}

	open(): Promise<boolean> {
		if (this.#opening) return this.#opening;
		const topic = this.#topic();
		if (!topicCanEdit(topic)) {
			return Promise.reject(new Error('当前账号没有编辑该帖子的权限'));
		}
		const categories = [...this.#catalog.categories()];
		const categoryId = Number(topic.category_id ?? topic.categoryId);
		if (
			Number.isSafeInteger(categoryId) &&
			categoryId > 0 &&
			!categories.some((category) => category.id === categoryId)
		) {
			categories.unshift(Object.freeze({
				id: categoryId,
				name: categoryName(
					topic.category_name ?? topic.categoryName ?? '当前类别',
				) || '当前类别',
				slug: text(topic.category_slug ?? topic.categorySlug),
				color: '',
				parentCategoryId: null,
			}));
		}
		this.#trigger.setAttribute('aria-expanded', 'true');
		const request = this.#form.open({
			title: text(topic.title ?? topic.fancy_title),
			categoryId:
				Number.isSafeInteger(categoryId) && categoryId > 0
					? categoryId
					: 0,
			tags: topicTags(topic),
			categories: Object.freeze(categories),
			signal: this.#abort.signal,
			searchTags: (input) => this.#catalog.searchTags(input),
			submit: (submission) => this.#submit(submission),
		});
		const opening = request.finally(() => {
			if (this.#opening === opening) this.#opening = null;
			this.#trigger.setAttribute('aria-expanded', 'false');
		});
		this.#opening = opening;
		return opening;
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #submit(submission: ReaderTopicEditSubmission): Promise<void> {
		const topic = this.#topic();
		if (!topicCanEdit(topic)) {
			throw new Error('当前账号没有编辑该帖子的权限');
		}
		const nativeFields = Object.freeze({
			title: submission.title,
			category_id: submission.category.id,
			tags: Object.freeze(submission.tags.map((tag) => Object.freeze({
				name: tag.name,
				...(tag.id ? { id: tag.id } : {}),
			}))),
		});
		const canonicalFields = Object.freeze({
			title: submission.title,
			category_id: submission.category.id,
			category_name: categoryName(submission.category.name),
			category_level: categoryLevel(submission.category.name),
			category_slug: submission.category.slug,
			tags: Object.freeze(submission.tags.map((tag) => tag.name)),
		});
		await this.#actions.dispatch(this.#commands.edit(
			canonicalFields,
			this.#descriptors.topicEdit({
				topicId: this.topicId,
				topic: this.#models.createTopic(topic),
				changedFields: nativeFields,
			}),
		));
		this.#notify('帖子信息已更新');
	}

	#topic(): TopicRecord<TPost> {
		const topic = this.#session.topic;
		if (!topic) throw new Error('canonical Topic 尚未加载');
		if (discourseTopicId(topic.id) !== this.topicId) {
			throw new Error('Topic 编辑目标与当前会话不一致');
		}
		return topic;
	}

	#report(error: unknown): void {
		try {
			this.#onError(error);
		} catch {
			// 诊断 consumer 不能破坏 Header 交互。
		}
	}
}
