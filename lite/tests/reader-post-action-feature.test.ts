import { parseHTML } from 'linkedom';
import { DiscourseNativePostModelFactory } from '../src/discourse/native-post-model-factory.js';
import type {
	DiscourseComposerReplyInput,
} from '../src/discourse/native-composer.js';
import {
	discoursePostNumber,
	discourseTopicId,
} from '../src/discourse/identifiers.js';
import type { DiscourseHostApiPort } from '../src/discourse/native-host-api.js';
import { PostView } from '../src/dom/post-view.js';
import { ReplyTreeRepository } from '../src/dom/reply-tree-repository.js';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderLightboxCommentController,
	type ReaderLightboxCommentTopicPort,
} from '../src/media/reader-lightbox-comment-controller.js';
import {
	ReaderLightboxCommentView,
} from '../src/media/reader-lightbox-comment-view.js';
import {
	DiscourseActionDescriptors,
} from '../src/post/discourse-action-descriptors.js';
import type { ActionMutationDescriptor } from '../src/post/action-request-adapter.js';
import {
	PostActionController,
	type ActionMutationPort,
} from '../src/post/post-action-controller.js';
import {
	PostActionFeatureCommands,
	type CanonicalActionPost,
} from '../src/post/post-action-feature-commands.js';
import {
	DiscoursePostReactionCatalog,
	ReaderPostActionFeature,
} from '../src/post/reader-post-action-feature.js';
import type { BoostCopySettings } from '../src/post/boost-copy-rule.js';
import {
	TopicPostActionAdapter,
	type TopicPostActionSessionPort,
} from '../src/post/topic-post-action-adapter.js';
import type { TopicSessionCommit } from '../src/topic/topic-session.js';
import { ReaderSelectSurface } from '../src/shell/reader-select-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

interface TestPost extends CanonicalActionPost {
	readonly topic_id: number;
	readonly reply_to_post_number: number | null;
	readonly user_id?: number;
	readonly username: string;
	readonly cooked: string;
	readonly can_reply: boolean;
	readonly can_flag?: boolean;
	readonly can_edit?: boolean;
	readonly can_delete?: boolean;
	readonly can_assign?: boolean;
	readonly can_manage?: boolean;
	readonly reactions?: readonly Readonly<{
		readonly id: string;
		readonly count: number;
	}>[];
	readonly current_user_reaction?: Readonly<{ readonly id: string }> | null;
	readonly reaction_users_count?: number;
	readonly boosts?: readonly Readonly<{
		readonly id: number;
		readonly raw: string;
		readonly cooked: string;
		readonly user: Readonly<{
			readonly id?: number;
			readonly username: string;
			readonly name: string;
			readonly avatar_template?: string;
			readonly admin?: boolean;
		}>;
		readonly notice?: Readonly<{ readonly type: string }>;
	}>[];
}

interface TestTopic {
	readonly [key: string]: unknown;
	readonly id: number;
	readonly title: string;
	readonly slug: string;
	readonly draft_key: string;
	readonly draft_sequence: number;
	readonly post_stream: Readonly<{ readonly stream: readonly number[] }>;
	readonly valid_reactions: readonly string[];
}

function commit(): TopicSessionCommit {
	return Object.freeze({
		source: 'action-response',
		observedAt: 1,
		acceptedPosts: 1,
		ignoredPosts: 0,
		changedPostNumbers: Object.freeze([]),
		removedPostNumbers: Object.freeze([]),
		topicChanged: false,
		streamChanged: false,
	});
}

function click(element: Element): void {
	const event = document.createEvent('Event');
	event.initEvent('click', true, true);
	element.dispatchEvent(event);
}

function pointerOver(
	element: Element,
	relatedTarget: Node | null = null,
): void {
	const event = document.createEvent('Event');
	event.initEvent('pointerover', true, true);
	Object.defineProperty(event, 'relatedTarget', {
		configurable: true,
		value: relatedTarget,
	});
	element.dispatchEvent(event);
}

function pointerDown(element: Element): void {
	const event = document.createEvent('Event');
	event.initEvent('pointerdown', true, true);
	element.dispatchEvent(event);
}

function pointerOut(
	element: Element,
	relatedTarget: Node | null = null,
): void {
	const event = document.createEvent('Event');
	event.initEvent('pointerout', true, true);
	Object.defineProperty(event, 'relatedTarget', {
		configurable: true,
		value: relatedTarget,
	});
	element.dispatchEvent(event);
}

function change(select: HTMLSelectElement, value: string): void {
	for (const option of select.options) {
		option.toggleAttribute('selected', option.value === value);
	}
	const event = document.createEvent('Event');
	event.initEvent('change', true, true);
	select.dispatchEvent(event);
}

class TestSession implements TopicPostActionSessionPort<TestPost> {
	readonly posts: Map<number, TestPost>;

	constructor(posts: readonly TestPost[]) {
		this.posts = new Map(posts.map((post) => [post.id, post]));
	}

	postById(postId: number): TestPost | undefined {
		return this.posts.get(postId);
	}

	ingestPosts(posts: readonly TestPost[]): TopicSessionCommit {
		for (const post of posts) this.posts.set(post.id, post);
		return commit();
	}

	ingestCreatedPost(post: TestPost): TopicSessionCommit {
		this.posts.set(post.id, post);
		return commit();
	}

	removePostById(postId: number): TopicSessionCommit {
		this.posts.delete(postId);
		return commit();
	}

	async loadPostById(postId: number): Promise<TestPost | null> {
		return this.posts.get(postId) ?? null;
	}

	async refresh(): Promise<void> {}
}

class DeferredMutation implements ActionMutationPort {
	readonly authScope = 'account:post-action-feature';
	readonly calls: ActionMutationDescriptor<unknown>[] = [];
	readonly #resolvers: Array<(value: unknown) => void> = [];
	readonly #rejectors: Array<(cause: unknown) => void> = [];

	execute<T>(descriptor: ActionMutationDescriptor<T>): Promise<T> {
		this.calls.push(descriptor as ActionMutationDescriptor<unknown>);
		return new Promise<T>((resolve, reject) => {
			this.#resolvers.push((value) => resolve(value as T));
			this.#rejectors.push(reject);
		});
	}

	resolve(index: number, value: unknown): void {
		const resolver = this.#resolvers[index];
		if (!resolver) throw new Error(`mutation #${index} 尚未开始`);
		resolver(value);
	}

	reject(index: number, cause: unknown): void {
		const rejector = this.#rejectors[index];
		if (!rejector) throw new Error(`mutation #${index} 尚未开始`);
		rejector(cause);
	}
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><main></main><section class="lightbox"></section></body></html>',
);
const document = parsedDocument as unknown as Document;
void parsedWindow;
const appEvents = {};
const modelFactory = {
	create(attributes: Record<string, unknown>) {
		return { ...attributes };
	},
};
const siteSettings: Record<string, unknown> = {
	discourse_reactions_enabled_reactions: 'heart|laughing',
	discourse_reactions_reaction_for_like: 'heart',
};
let nativeTextReady = false;
let nativeCurrentUserReady = false;
const messageBusHandlers = new Map<string, (message: unknown) => void>();
const messageBus = {
	subscribe(channel: string, handler: (message: unknown) => void) {
		messageBusHandlers.set(channel, handler);
	},
	unsubscribe(channel: string, handler: (message: unknown) => void) {
		if (messageBusHandlers.get(channel) === handler) {
			messageBusHandlers.delete(channel);
		}
	},
};
const host: DiscourseHostApiPort = {
	lookup(name) {
		if (name === 'service:app-events') return appEvents;
		if (name === 'service:message-bus') return messageBus;
		if (name === 'service:current-user') {
			return nativeCurrentUserReady
				? { id: 99, username: 'viewer' }
				: null;
		}
		if (name === 'service:site-settings') return siteSettings;
		return null;
	},
	lookupModule(name) {
		if (name === 'discourse/models/topic') return { default: modelFactory };
		if (name === 'discourse/models/post') {
			return {
				default: {
					create(attributes: Record<string, unknown>) {
						return {
							...attributes,
							actionByName: {
								spam: { can_act: true },
								inappropriate: { can_act: false },
							},
						};
					},
					munge(attributes: unknown) {
						return attributes;
					},
				},
			};
		}
		if (name === 'discourse/lib/text') {
			if (!nativeTextReady) return null;
			return {
				emojiUrlFor(id: string) {
					return `/emoji/${id}.png`;
				},
			};
		}
		return null;
	},
};
const topic: TestTopic = {
	id: 10,
	title: 'Topic',
	slug: 'topic',
	draft_key: 'topic_10',
	draft_sequence: 1,
	post_stream: { stream: [1, 2, 3] },
	valid_reactions: ['heart', 'laughing'],
	notification_level: 1,
	details: {
		notification_level: 1,
		created_by: { username: 'booster' },
	},
	shared_issue_visible: true,
	shared_issue_count: 2,
	user_created_shared_issue: false,
};
const source: TestPost = {
	id: 1,
	topic_id: 10,
	post_number: 1,
	reply_to_post_number: null,
	username: 'source',
	cooked: '<p>source</p>',
	can_reply: true,
	can_flag: true,
	can_assign: true,
	can_boost: true,
	actions_summary: [],
	reactions: [],
	current_user_reaction: null,
	reaction_users_count: 0,
	boosts: [{
		id: 21,
		raw: '我的 Boost',
		cooked: '<p>我的 Boost</p>',
		user: {
			id: 99,
			username: 'viewer',
			name: 'Viewer',
			avatar_template: '/viewer/{size}.png',
		},
	}],
};
const comment: TestPost = {
	id: 2,
	topic_id: 10,
	post_number: 2,
	reply_to_post_number: 1,
	username: 'commenter',
	cooked: '<p>comment</p>',
	can_reply: true,
	can_flag: true,
	can_edit: true,
	can_delete: true,
	can_assign: true,
	can_manage: true,
	can_boost: true,
	actions_summary: [],
	reactions: [{ id: 'heart', count: 2 }],
	current_user_reaction: null,
	reaction_users_count: 2,
	boosts: [{
		id: 20,
		raw: '原 Boo\n续',
		cooked:
			'<p>原 <strong>Boo</strong>' +
			'<img class="emoji" alt="😄" src="/emoji.png"><br>续</p>',
		user: {
			username: 'booster',
			name: 'Booster',
			admin: true,
		},
		notice: { type: 'returning_user' },
	}],
};
const nativeLikePost: TestPost = {
	id: 3,
	topic_id: 10,
	post_number: 3,
	reply_to_post_number: null,
	username: 'native-like',
	cooked: '<p>native like</p>',
	can_reply: true,
	can_flag: false,
	actions_summary: [{ id: 2, can_act: true, acted: false, count: 0 }],
};
const session = new TestSession([source, comment, nativeLikePost]);
const mutation = new DeferredMutation();
const actions = new PostActionController({ mutation });
const models = new DiscourseNativePostModelFactory(host);
const commands = new PostActionFeatureCommands(
	new TopicPostActionAdapter<TestPost>({ session }),
);
const composerInputs: DiscourseComposerReplyInput<TestTopic, TestPost>[] = [];
let rejectNextComposer = false;
let skipNextComposerInsertion = false;
let deleteConfirmations = 0;
let approveBoostDelete = false;
const notices: string[] = [];
const missingCapabilityRefreshes: number[] = [];
const postReportRequests: TestPost[] = [];
const postBookmarkRequests: TestPost[] = [];
const topicBookmarkRequests: TestPost[] = [];
const postShareRequests: TestPost[] = [];
const topicShareRequests: TestPost[] = [];
const topicNotificationRequests: Array<Readonly<{
	readonly post: TestPost;
	readonly level: number;
}>> = [];
let rejectNextTopicNotification = false;
const sharedIssueRequests: TestPost[] = [];
let sharedIssueActive = false;
let sharedIssueCount = 2;
const managementRequests: string[] = [];
const boostReportRequests: Array<Readonly<{
	readonly postId: number;
	readonly boostId: number;
	readonly username: string;
}>> = [];
const boostEmojiSelections: Array<(code: string) => void> = [];
let positionBoostEmoji:
	| ((content: HTMLElement) => void)
	| undefined;
let boostEmojiShows = 0;
let boostEmojiCloses = 0;
const boostEmojiTopLayers = new Set<HTMLElement>();
let scheduledId = 0;
const scheduled = new Map<number, () => void>();
let boostCopySettings: BoostCopySettings = {
	mode: 'counter' as const,
	prefix: '同意：',
	counterMarker: '+',
	counterStep: 2,
	fixedSuffix: '',
};
const feature = new ReaderPostActionFeature<TestTopic, TestPost>({
	document,
	surfaceHost: document.querySelector<HTMLElement>('main')!,
	topic: () => topic,
	actions,
	commands,
	descriptors: new DiscourseActionDescriptors(),
	models,
	reactions: new DiscoursePostReactionCatalog(models),
	capabilityInput: (post) => {
		const currentUser = models.currentUser() as
			| Readonly<Record<string, unknown>>
			| null;
		return {
			post,
			topic,
			...(currentUser ? { currentUser } : {}),
			currentUsername: currentUser ? 'viewer' : '',
			plugins: {
				boosts: true,
				reactions: Array.isArray(post.reactions),
			},
		};
	},
	refreshMissingCapabilities: async (post) => {
		missingCapabilityRefreshes.push(post.post_number);
	},
	presentation: {
		avatarSource(template, size) {
			return template.replace('{size}', String(size));
		},
		categoryHref() {
			return '';
		},
		tagHref() {
			return '';
		},
		userHref(username) {
			return `/u/${username}`;
		},
	},
	readBoostCopySettings: () => boostCopySettings,
	emojiMenu: {
		async show(_anchor, request) {
			boostEmojiShows += 1;
			boostEmojiSelections.push(request.didSelectEmoji);
			positionBoostEmoji = request.computePosition;
		},
		close() {
			boostEmojiCloses += 1;
		},
	},
	topLayer: {
		isOpen: (element) => boostEmojiTopLayers.has(element),
		show: (element) => {
			boostEmojiTopLayers.add(element);
		},
		hide: (element) => {
			boostEmojiTopLayers.delete(element);
		},
	},
	confirmBoostDelete: () => {
		deleteConfirmations += 1;
		return approveBoostDelete;
	},
	reportBoost: async (request) => {
		boostReportRequests.push(request);
		return true;
	},
	reportPost: async (post) => {
		postReportRequests.push(post);
		return true;
	},
	bookmarks: {
		async togglePost(post) {
			postBookmarkRequests.push(post);
			return { bookmarked: true, target: 'post' };
		},
		async toggleTopic(post) {
			topicBookmarkRequests.push(post);
			return { bookmarked: true, target: 'topic' };
		},
	},
	shares: {
		async sharePost(post) {
			postShareRequests.push(post);
			return {
				target: 'post',
				outcome: 'copied',
				url: `https://linux.do/t/10/${post.post_number}`,
				postNumber: post.post_number,
			};
		},
		async shareTopic(post) {
			topicShareRequests.push(post);
			return {
				target: 'topic',
				outcome: 'shared',
				url: 'https://linux.do/t/10',
				postNumber: null,
			};
		},
	},
	topicNotifications: {
		async setLevel(post, level) {
			topicNotificationRequests.push({ post, level });
			if (rejectNextTopicNotification) {
				rejectNextTopicNotification = false;
				throw new Error('通知更新失败');
			}
			Object.assign(topic, {
				notification_level: level,
				details: { notification_level: level },
			});
			return {
				changed: true,
				level: level as 0 | 1 | 2 | 3,
			};
		},
	},
	sharedIssue: {
		state(post) {
			return {
				visible: true,
				active: sharedIssueActive,
				count: sharedIssueCount,
				isAuthor: post.username === 'viewer',
				signedIn: true,
				busy: false,
			};
		},
		async toggle(post) {
			sharedIssueRequests.push(post);
			sharedIssueActive = true;
			sharedIssueCount += 1;
			return {
				changed: true,
				unavailable: false,
				active: sharedIssueActive,
				count: sharedIssueCount,
			};
		},
	},
	management: {
		async openEdit(post) {
			managementRequests.push(`edit:${post.id}`);
			return true;
		},
		async deletePost(post) {
			managementRequests.push(`delete:${post.id}`);
			return true;
		},
		async assignPost(post) {
			managementRequests.push(`assign-post:${post.id}`);
			return true;
		},
		async assignTopic(post) {
			managementRequests.push(`assign-topic:${post.id}`);
			return true;
		},
		async openAdmin(post, anchor) {
			managementRequests.push(
				`admin:${post.id}:${anchor.dataset.postAdmin === ''}`,
			);
			return true;
		},
	},
	notify: (message) => notices.push(message),
	composer: {
		async openReply(input) {
			composerInputs.push(input);
			if (rejectNextComposer) {
				rejectNextComposer = false;
				throw new Error('composer down');
			}
			const insertionSkipped = skipNextComposerInsertion;
			skipNextComposerInsertion = false;
			return {
				topicId: discourseTopicId(10),
				parentPostNumber: discoursePostNumber(input.post.post_number),
				reused: false,
				model: {},
				...(insertionSkipped
					? { insertionSkipped: 'duplicate-mention' as const }
					: {}),
			};
		},
	},
	schedule(callback) {
		scheduledId += 1;
		scheduled.set(scheduledId, callback);
		return scheduledId;
	},
	cancelSchedule(handle) {
		scheduled.delete(handle);
	},
});

let closedBoostScrollPathReads = 0;
const closedBoostScroll = new parsedWindow.Event('scroll');
Object.defineProperty(closedBoostScroll, 'composedPath', {
	configurable: true,
	value: () => {
		closedBoostScrollPathReads += 1;
		return [];
	},
});
document.dispatchEvent(closedBoostScroll);
assert(
	closedBoostScrollPathReads === 0,
	'Boost composer 关闭时正文滚动不得解析事件路径或安排无效定位工作',
);

function openReactionPicker(root: Element): void {
	const trigger = root.querySelector<HTMLElement>('[data-reaction-picker]');
	assert(trigger, '回应 surface 必须存在 picker 入口');
	const beforeOpen = new Set(scheduled.keys());
	pointerOver(trigger);
	const open = [...scheduled].find(([handle]) => !beforeOpen.has(handle));
	assert(open, '回应入口 pointerover 必须建立延迟打开任务');
	scheduled.delete(open[0]);
	open[1]();
	assert(
		!root.querySelector<HTMLElement>('.ldp-reaction-picker')?.hidden,
		'回应选择器必须由悬停任务展开',
	);
}

function closeReactionPicker(root: Element): void {
	const reactions = root.matches('.ldp-reactions')
		? root
		: root.querySelector('.ldp-reactions');
	assert(reactions, '回应 surface 必须存在 reactions root');
	const beforeClose = new Set(scheduled.keys());
	pointerOut(reactions);
	const close = [...scheduled].find(([handle]) => !beforeClose.has(handle));
	assert(close, '离开回应 surface 必须建立延迟关闭任务');
	scheduled.delete(close[0]);
	close[1]();
	assert(
		root.querySelector<HTMLElement>('.ldp-reaction-picker')?.hidden,
		'回应选择器必须由离开任务关闭',
	);
}

const regular = new PostView(document, {
	postId: comment.id,
	postNumber: comment.post_number,
	username: comment.username,
});
document.querySelector('main')!.append(regular.slots.root);
feature.afterRender(comment, regular);
assert(
	regular.slots.actions.querySelector('.ldp-reaction-picker') === null &&
		regular.slots.actions.querySelector('[data-reaction-picker]') === null &&
		scheduled.size === 1,
	'宿主 current-user/text 晚于首批 PostView 时不得错误放行动作，且整个 Topic 只能安排一次有界就绪重投',
);
nativeTextReady = true;
nativeCurrentUserReady = true;
const emojiReadyCallback = scheduled.get(1);
scheduled.delete(1);
emojiReadyCallback?.();
const regularBoost = regular.slots.boost.querySelector<HTMLElement>(
	'.ldp-boost-bubble',
)!;
assert(
	regularBoost.querySelector('.ldp-boost-fallback-icon .ldp-icon-rocket') &&
		regularBoost.querySelector('.ldp-boost-identity-op') &&
		regularBoost.querySelector('.ldp-boost-identity-admin') &&
		regularBoost.querySelector('.ldp-boost-identity-return') &&
		regularBoost.querySelector('[data-boost-mention]') &&
		regularBoost.querySelector('[data-boost-report]'),
	'宿主登录态晚就绪后，既有/后插入楼层必须统一补齐 Boost 兜底头像、身份、引用与权限动作',
);
assert(
	regular.slots.actions.querySelector('[data-reaction-picker]'),
	'宿主运行时就绪后必须统一重算既有 PostView 回应权限，不能要求刷新或清缓存',
);
const regularPrimaryReaction = regular.slots.actions.querySelector<
	HTMLButtonElement
>(
	':scope > .ldp-reaction-summary > ' +
		'.ldp-reaction-like-picker > .ldp-like',
);
assert(
	regularPrimaryReaction?.dataset.counted === '1' &&
		regularPrimaryReaction.querySelector('.ldp-like-count')?.textContent ===
			'2' &&
		!regularPrimaryReaction.classList.contains('liked') &&
		regularPrimaryReaction.hasAttribute('data-tooltip') &&
		regular.slots.actions.querySelector(
			':scope > .ldp-actions > .ldp-like, ' +
				':scope > .ldp-actions > .ldp-reaction-like-picker',
		) === null,
	'已有主爱心回应必须以未点赞常规色显示在胶囊首项、禁用悬浮提示，且不能保留胶囊外旧入口',
);
const ownPost: TestPost = {
	...comment,
	id: 4,
	post_number: 4,
	user_id: 99,
	username: 'Viewer',
	reactions: [
		{ id: 'heart', count: 1 },
		{ id: 'laughing', count: 1 },
	],
};
const ownView = new PostView(document, {
	postId: ownPost.id,
	postNumber: ownPost.post_number,
	username: ownPost.username,
});
document.querySelector('main')!.append(ownView.slots.root);
feature.afterRender(ownPost, ownView);
const ownLike = ownView.slots.actions.querySelector<HTMLButtonElement>(
	'[data-post-like]',
);
const ownReaction = ownView.slots.actions.querySelector<HTMLButtonElement>(
	'[data-reaction="laughing"]',
);
const ownMutationCount = mutation.calls.length;
if (ownLike) click(ownLike);
if (ownReaction) click(ownReaction);
await Promise.resolve();
assert(
	ownLike?.disabled === true &&
	ownReaction?.disabled === true &&
	mutation.calls.length === ownMutationCount,
	'自己的楼层必须让点赞与表情按钮不可点击，并在事件层保持零 reaction POST',
);
const railView = new PostView(document, {
	postId: comment.id,
	postNumber: comment.post_number,
	username: comment.username,
});
railView.slots.root.classList.add('ldp-topic-action-rail-post');
document.querySelector('main')!.append(railView.slots.root);
feature.afterRender(comment, railView);
const railLike = railView.slots.actions.querySelector<HTMLButtonElement>(
	'.ldp-reaction-like-picker > .ldp-like[data-reaction-picker]',
);
assert(
	railLike &&
		railView.slots.actions.querySelector('.ldp-reaction-summary') === null &&
		railView.slots.actions.querySelector(
			'.ldp-topic-action-rail-reaction-badge',
		) === null,
	'主帖收纳箱必须复用主回应按钮作为 picker 锚点，不能把正文回应摘要或重复入口搬进操作列',
);
feature.setTopicActionRailExpanded(railView, true);
assert(
	railView.slots.actions.querySelector('[data-post-share]') &&
	railView.slots.actions.querySelector('[data-post-report]') &&
	railView.slots.actions.querySelector('[data-post-bookmark]'),
	'主帖收纳箱首次展开必须立即补齐楼层链接、举报和收藏等上下文动作，不能等待第二次 hover',
);
assert(
	railLike.getAttribute('aria-expanded') === 'false' &&
		railView.slots.actions.querySelector<HTMLElement>('.ldp-reaction-picker')
			?.hidden,
	'主帖收纳箱展开时回应列表必须保持收起，等待主回应按钮 hover',
);
openReactionPicker(railView.slots.actions);
const railReactionButtons = [...railView.slots.actions.querySelectorAll<
	HTMLButtonElement
>('.ldp-reaction-picker [data-reaction]')];
const railReactionOrder = railReactionButtons
	.map((button) => button.dataset.reaction)
	.join(',');
const railReactionCounts = railReactionButtons
	.map((button) => button.querySelector('b')?.textContent ?? '<missing>')
	.join(',');
assert(
	railLike.getAttribute('aria-expanded') === 'true' &&
		railReactionOrder === 'heart,laughing' &&
		railReactionButtons.every((button) =>
			button.hasAttribute('data-tooltip')) &&
		railReactionButtons[0]?.querySelector('b')?.textContent === '2' &&
		railReactionButtons[1]?.querySelector('b')?.textContent === '',
	'主帖收纳箱展开后 hover 必须显示按现有回应数排序的表情列表，并保留零计数占位；' +
		`expanded=${railLike.getAttribute('aria-expanded')};` +
		`order=${railReactionOrder};counts=${railReactionCounts}`,
);
closeReactionPicker(railView.slots.actions);
assert(
	railLike.getAttribute('aria-expanded') === 'false' &&
		railView.slots.actions.querySelector<HTMLElement>('.ldp-reaction-picker')
			?.hidden,
	'主帖收纳箱展开态的表情列表必须在 hover 离开后自动收起',
);
feature.afterRender({
	...comment,
	reactions: [
		{ id: 'heart', count: 2 },
		{ id: 'laughing', count: 1 },
	],
	current_user_reaction: { id: 'laughing' },
	reaction_users_count: 3,
}, railView);
assert(
	railLike.querySelector('.ldp-like-count')?.textContent === '3' &&
	railView.slots.actions.querySelector<HTMLImageElement>(
		'.ldp-topic-action-rail-reaction-badge img.emoji',
	)?.getAttribute('src') === '/emoji/laughing.png',
	'主帖收纳箱主按钮必须汇总所有表情 count，并标记当前非主表情回应',
);
feature.setTopicActionRailExpanded(railView, false);
assert(
	railView.slots.actions.querySelector<HTMLElement>('.ldp-reaction-picker')
		?.hidden &&
		railView.slots.actions.querySelector('[data-reaction-picker]')
		?.getAttribute('aria-expanded') === 'false',
	'收纳箱切回常显/收纳态时必须保持表情列表关闭',
);
const topicRailView = new PostView(document, {
	postId: source.id,
	postNumber: source.post_number,
	username: source.username,
});
topicRailView.slots.root.classList.add('ldp-topic-action-rail-post');
document.querySelector('main')!.append(topicRailView.slots.root);
feature.afterRender(source, topicRailView);
feature.setTopicActionRailExpanded(topicRailView, true);
const mergedRailActions = topicRailView.slots.actions.querySelector<HTMLElement>(
	':scope > .ldp-actions > .ldp-context-actions-slot',
);
const topicRailActions = mergedRailActions?.querySelector<HTMLElement>(
	':scope > .ldp-topic-footer-actions',
);
const topicRailBookmark = topicRailView.slots.topicFooter.querySelector(
	':scope > .ldp-topic-bookmark',
);
const topicRailSharedIssue = topicRailView.slots.topicFooter.querySelector(
	':scope > .ldp-topic-shared-issue',
);
assert(
	topicRailBookmark &&
	topicRailSharedIssue &&
	topicRailBookmark.nextElementSibling === topicRailSharedIssue &&
	topicRailActions?.querySelector('[data-topic-share]') &&
	topicRailActions.querySelector('[data-topic-notification]') &&
	mergedRailActions?.querySelectorAll(':scope > .ldp-reportbtn').length === 1 &&
	mergedRailActions.querySelectorAll(':scope > .ldp-post-assign').length === 1 &&
	!topicRailActions.querySelector(
		'.ldp-topic-report,.ldp-topic-assign,.ldp-topic-reply',
	) &&
	topicRailView.slots.actions.querySelector(
		':scope > .ldp-actions > .ldp-replybtn:not(.ldp-topic-reply)',
	),
	'全展开收纳箱必须合并楼层与主题操作、去重举报和负责人、移除重复回复，并把共享问题放到独立书签后',
);
const railTopicShare = topicRailActions.querySelector<HTMLButtonElement>(
	'[data-topic-share]',
)!;
const railTopicNotification = topicRailActions.querySelector<HTMLSelectElement>(
	'[data-topic-notification]',
)!;
assert(
	[...mergedRailActions!.querySelectorAll<HTMLButtonElement>('button')]
		.every((button) => !button.disabled) &&
		!railTopicNotification.disabled,
	'第二段底部动作组只应投影当前可用功能，不能留下不可点击图标',
);
click(railTopicShare);
change(railTopicNotification, '3');
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	topicShareRequests.length === 1 &&
		topicShareRequests[0] === source &&
		topicNotificationRequests.length === 1 &&
		topicNotificationRequests[0]?.post === source &&
		topicNotificationRequests[0]?.level === 3,
	'第二段底部动作组的主题分享与通知必须在合并到 actions slot 后仍可使用',
);
topicShareRequests.length = 0;
topicNotificationRequests.length = 0;
Object.assign(topic, {
	notification_level: 1,
	details: { notification_level: 1 },
});
topicRailView.destroy();
const sourceView = new PostView(document, {
	postId: source.id,
	postNumber: source.post_number,
	username: source.username,
});
document.querySelector('main')!.append(sourceView.slots.root);
feature.afterRender(source, sourceView);
const emptyPrimaryReaction = sourceView.slots.actions.querySelector<
	HTMLButtonElement
>(
	':scope > .ldp-reaction-summary > ' +
		'.ldp-reaction-like-picker > .ldp-like',
);
assert(
	emptyPrimaryReaction?.dataset.counted === '0' &&
		emptyPrimaryReaction.querySelector('.ldp-like-count')?.textContent === '' &&
		emptyPrimaryReaction.hasAttribute('data-tooltip') &&
		sourceView.slots.actions.querySelector(
			':scope > .ldp-actions > .ldp-like, ' +
				':scope > .ldp-actions > .ldp-reaction-like-picker',
		) === null,
	'无人回应时胶囊必须保留可直接点赞的空心爱心，且不得显示 0 或胶囊外副本',
);
regular.setTreePosition(source.post_number, 1);
sourceView.slots.replyList.append(regular.slots.root);
assert(
	regular.slots.root.classList.contains('ldp-nested-preview') &&
		regular.slots.root.parentElement === sourceView.slots.replyList &&
		regular.slots.actions.querySelector(
			'.ldp-reaction-like-picker > .ldp-like' +
				'[data-post-like][data-reaction-picker]',
		)
			?.closest('.ldp-post') === regular.slots.root,
	'树状嵌套子回复必须搬入 #1 同款主爱心回应入口，不能保留独立空心占位或被父帖动作 surface 接管',
);
assert(
	sourceView.slots.boost.querySelector('.ldp-boost-identity-me') &&
		sourceView.slots.boost.querySelector('[data-boost-delete]') &&
		!sourceView.slots.boost.querySelector('[data-boost-copy]'),
	'晚就绪 current-user 必须按原生 user id 识别自己的 Boost，不能依赖首次构造用户名',
);
const sourceReactionHost = document.createElement('div');
sourceReactionHost.className = 'ldp-lb-source-reactions';
sourceReactionHost.innerHTML = '<div class="ldp-reactions"></div>';
document.querySelector('main')!.append(sourceReactionHost);
const sourceReactionSurface = feature.mountReactionSurface(
	comment,
	sourceReactionHost,
);
assert(
	sourceReactionHost.classList.contains('ldp-has-reactions') &&
		sourceReactionHost.querySelector<HTMLButtonElement>(
			'[data-reaction-picker]',
		)?.dataset.counted === '1' &&
		sourceReactionHost.querySelector('.ldp-like-count')?.textContent === '2' &&
		sourceReactionHost.querySelector('[data-post-reply]') === null,
	'图片来源回应必须复用同一颗胶囊主爱心及计数，同时不得复制完整 PostView 动作栏',
);
openReactionPicker(sourceReactionHost);
assert(
	sourceReactionHost.querySelector('.ldp-reaction-picker'),
	'独立来源回应 surface 必须复用同一 picker 交互与瞬时状态 owner',
);
closeReactionPicker(sourceReactionHost);
const nativeLikeView = new PostView(document, {
	postId: nativeLikePost.id,
	postNumber: nativeLikePost.post_number,
	username: nativeLikePost.username,
});
document.querySelector('main')!.append(nativeLikeView.slots.root);
feature.afterRender(nativeLikePost, nativeLikeView);
assert(
	missingCapabilityRefreshes.join(',') === '3',
	'后加载楼层缺少 can_boost 时必须只发起一次 around 权威能力补齐，不能永久丢失 Boost 入口或循环请求',
);
const reportContext = models.reportContext(
	topic,
	comment,
	['spam', 'inappropriate'],
);
assert(
	reportContext.actions.length === 1 &&
		reportContext.actions[0]?.nameKey === 'spam',
	'楼层举报类型必须从同一原生 Post model actionByName 过滤 can_act',
);
const topicReportContext = models.reportContext(topic, source, ['spam']);
assert(
	topicReportContext.actions.length === 1 &&
		(topicReportContext.actions[0]?.action as Record<string, unknown>)
			.flagTopic === topicReportContext.post,
	'主题首帖举报必须按 Discourse 原生语义把 flagTopic 指向同一 Post model',
);

const changes = new Signal<unknown>();
const commentTopic: ReaderLightboxCommentTopicPort<TestPost> = {
	changes,
	cachedPosts: () => [...session.posts.values()],
	postByNumber: (postNumber) =>
		[...session.posts.values()].find((post) => post.post_number === postNumber),
	postStreamCoverage: () => ({ complete: true }),
	async loadTarget() {
		return [];
	},
	async ensurePostStream() {
		return { complete: true };
	},
};
const replies = new ReplyTreeRepository(10, {
	async load() {
		return null;
	},
	async save() {},
});
replies.setExpectedPostCount(3);
replies.ingest([source, comment, nativeLikePost], 'topic-json', { observedAt: 1 });
const commentController = new ReaderLightboxCommentController({
	session: commentTopic,
	replies,
	image: {
		key: '10:1:0',
		topicId: 10,
		sourcePostNumber: 1,
		imageOrder: 0,
		originalSrc: 'https://linux.do/image.png',
	},
	matcher: {
		matches(post) {
			return post.post_number === 2;
		},
	},
});
const lightboxRoot = document.querySelector<HTMLElement>('.lightbox')!;
const status = document.createElement('div');
const empty = document.createElement('div');
const list = document.createElement('div');
lightboxRoot.append(status, empty, list);
const lightbox = new ReaderLightboxCommentView({
	document,
	controller: commentController,
	slots: { rootList: list, status, empty },
	identity: (post) => ({
		postId: post.id,
		postNumber: post.post_number,
		username: post.username,
	}),
	render: (post, view) => {
		view.slots.content.innerHTML = post.cooked;
	},
	postFeatures: [feature],
});
const lightboxPost = list.querySelector<HTMLElement>('[data-post-id="2"]')!;
assert(
	regular.slots.actions.innerHTML ===
		lightboxPost.querySelector('.ldp-post-actions')?.innerHTML,
	'普通楼层与灯箱评论必须复用同一 PostAction feature 的回应与回复 DOM',
);
assert(
	lightboxPost.querySelector(
		'.ldp-reaction-like-picker > .ldp-like' +
			'[data-post-like][data-reaction-picker]',
	) &&
		!lightboxPost.querySelector('.ldp-reaction-add'),
	'讨论浮窗必须复用 #1 同款主爱心回应入口，不能再渲染无状态的空心添加按钮',
);
assert(
	regular.slots.actions.querySelector(
		'.ldp-context-actions-slot[data-ldp-context-actions="0"]',
	)?.childElementCount === 0,
	'低频楼层动作在首次交互前必须只保留紧凑占位，不能提前放大长帖 DOM',
);
for (const post of [regular.slots.root, sourceView.slots.root, lightboxPost]) {
	pointerOver(post);
}
assert(
	regular.slots.actions.querySelector(
		'.ldp-context-actions-slot[data-ldp-context-actions="1"] ' +
		'[data-post-share]',
	),
	'普通、嵌套、实时、回屏和灯箱 PostView 必须由同一 feature 按需水合低频动作',
);
const boostQuickActions = regularBoost.querySelector<HTMLElement>(
	':scope > .ldp-boost-quick-actions',
)!;
const boostQuickAction = boostQuickActions.querySelector<HTMLButtonElement>(
	'.ldp-boost-item-action',
)!;
const beforeBoostQuickOpen = new Set(scheduled.keys());
pointerOver(regularBoost);
const boostQuickOpen = [...scheduled].find(([handle]) =>
	!beforeBoostQuickOpen.has(handle));
assert(
	boostQuickOpen &&
		!regularBoost.classList.contains('ldp-boost-quick-actions-open'),
	'Boost 悬停必须先经过独立状态门，不能由绝对定位快捷层扩张父胶囊 hover 命中区',
);
scheduled.delete(boostQuickOpen[0]);
boostQuickOpen[1]();
assert(
	regularBoost.classList.contains('ldp-boost-quick-actions-open'),
	'Boost 快捷层必须在悬停门后建立唯一活动胶囊',
);
const beforeBoostBridgeClose = new Set(scheduled.keys());
pointerOut(regular.slots.boost, document.body);
const boostBridgeClose = [...scheduled].find(([handle]) =>
	!beforeBoostBridgeClose.has(handle));
assert(boostBridgeClose, '离开 Boost 组必须建立有界关闭任务');
pointerOver(boostQuickAction, document.body);
assert(
	!scheduled.has(boostBridgeClose[0]) &&
		regularBoost.classList.contains('ldp-boost-quick-actions-open'),
	'从 Boost 胶囊移向组外快捷层时必须取消关闭任务，保留按钮可点击路径',
);
const beforeBoostQuickClose = new Set(scheduled.keys());
pointerOut(boostQuickAction, document.body);
const boostQuickClose = [...scheduled].find(([handle]) =>
	!beforeBoostQuickClose.has(handle));
assert(boostQuickClose, '离开 Boost 快捷层必须重新建立关闭任务');
scheduled.delete(boostQuickClose[0]);
boostQuickClose[1]();
assert(
	!regularBoost.classList.contains('ldp-boost-quick-actions-open'),
	'Boost 快捷层离开延迟结束后必须关闭，不能留下跨楼层遮挡层',
);
const hoverTrigger = regular.slots.actions.querySelector<HTMLElement>(
	'[data-reaction-picker]',
)!;
const reactionsRoot = regular.slots.actions;
const beforeHoverOpen = new Set(scheduled.keys());
pointerOver(hoverTrigger);
const hoverOpen = [...scheduled].find(([handle]) =>
	!beforeHoverOpen.has(handle));
assert(hoverOpen, '回应入口 pointerover 必须建立唯一延迟打开任务');
scheduled.delete(hoverOpen[0]);
hoverOpen[1]();
assert(
	reactionsRoot.querySelector('[data-reaction-picker]') === hoverTrigger &&
		!reactionsRoot.querySelector<HTMLElement>('.ldp-reaction-picker')?.hidden &&
		reactionsRoot.querySelector<HTMLImageElement>(
			'.ldp-reaction-picker [data-reaction="heart"] img',
		)?.getAttribute('src') === '/emoji/heart.png',
	'回应选择器必须在 250ms 悬停门后原位展开并保留触发按钮，不能因替换鼠标下节点而抖动或吞掉点击',
);
const beforeHoverClose = new Set(scheduled.keys());
pointerOut(reactionsRoot);
const hoverClose = [...scheduled].find(([handle]) =>
	!beforeHoverClose.has(handle));
assert(hoverClose, '离开回应动作行必须建立唯一延迟关闭任务');
scheduled.delete(hoverClose[0]);
hoverClose[1]();
assert(
	reactionsRoot.querySelector('[data-reaction-picker]') === hoverTrigger &&
		reactionsRoot.querySelector<HTMLElement>('.ldp-reaction-picker')?.hidden,
	'回应选择器离开 250ms 后必须关闭，不能留下遮挡层',
);
const postReportButton = regular.slots.actions.querySelector<HTMLButtonElement>(
	'[data-post-report]',
);
assert(postReportButton, 'can_flag 明确允许的非本人楼层必须显示统一举报入口');
const noticesBeforePostReport = notices.length;
click(postReportButton);
await Promise.resolve();
assert(
	postReportRequests.length === 1 &&
		postReportRequests[0] === comment &&
		notices.length === noticesBeforePostReport,
	'普通/嵌套/实时/回屏/灯箱楼层举报必须委托同一 runtime 表单链，成功反馈由表单唯一负责',
);
const topicReportButton =
	sourceView.slots.topicFooter.querySelector<HTMLButtonElement>(
		'[data-post-report]',
	);
assert(
	topicReportButton &&
		!sourceView.slots.topicFooter.hidden &&
		!sourceView.slots.actions.querySelector('[data-post-report]'),
	'主题首帖必须把唯一举报入口投影到 PostView topicFooter，不能重复留在楼层动作栏',
);
const noticesBeforeTopicReport = notices.length;
click(topicReportButton);
await Promise.resolve();
assert(
	Number(postReportRequests.length) === 2 &&
		postReportRequests[1] === source &&
		notices.length === noticesBeforeTopicReport,
	'主题举报必须复用普通楼层的同一 runtime 表单与动作调度链，不能追加重复 toast',
);
const postBookmarkButton =
	regular.slots.actions.querySelector<HTMLButtonElement>(
		'[data-post-bookmark]',
	);
assert(
	postBookmarkButton &&
		!sourceView.slots.actions.querySelector('[data-post-bookmark]'),
	'非首帖必须显示楼层收藏；首帖动作栏不能重复主题收藏入口',
);
click(postBookmarkButton);
await Promise.resolve();
assert(
	postBookmarkRequests.length === 1 &&
		postBookmarkRequests[0] === comment &&
		notices.at(-1) === '已收藏该楼层',
	'所有非首帖 PostView 必须把收藏委托给统一协调器',
);
const topicBookmarkButton =
	sourceView.slots.topicFooter.querySelector<HTMLButtonElement>(
		'[data-topic-bookmark]',
	);
const sharedIssueButton =
	sourceView.slots.topicFooter.querySelector<HTMLButtonElement>(
		'[data-topic-shared-issue]',
	);
const topicReplyButton =
	sourceView.slots.topicFooter.querySelector<HTMLButtonElement>(
		'[data-post-reply].ldp-topic-reply',
	);
assert(
	topicBookmarkButton &&
	sharedIssueButton &&
	topicReplyButton &&
	sharedIssueButton.getAttribute('aria-pressed') === 'false' &&
	sharedIssueButton.textContent?.includes('(2)') &&
	sharedIssueButton.nextElementSibling?.classList.contains(
		'ldp-topic-footer-separator',
	) &&
	!regular.slots.topicFooter.querySelector('[data-topic-shared-issue]') &&
	topicBookmarkButton.getAttribute('aria-pressed') === 'false',
	'共享问题与主题书签必须只在首帖 footer 投影，且共享问题保持旧版首位顺序',
);
click(sharedIssueButton);
await Promise.resolve();
assert(
	sharedIssueRequests.length === 1 &&
	sharedIssueRequests[0] === source &&
	sharedIssueButton.getAttribute('aria-pressed') === 'true' &&
	sharedIssueButton.textContent?.includes('(3)'),
	'共享问题入口必须委托唯一协调器并立即回读 canonical 投影',
);
click(topicBookmarkButton);
await Promise.resolve();
assert(
	topicBookmarkRequests.length === 1 &&
		topicBookmarkRequests[0] === source &&
		notices.at(-1) === '已添加主题书签',
	'主题书签必须复用同一 PostView delegated handler 和协调器',
);
const regularShareButton =
	regular.slots.actions.querySelector<HTMLButtonElement>(
		'[data-post-share]',
	);
const sourceShareButton =
	sourceView.slots.actions.querySelector<HTMLButtonElement>(
		'[data-post-share]',
	);
const topicShareButton =
	sourceView.slots.topicFooter.querySelector<HTMLButtonElement>(
		'[data-topic-share]',
	);
assert(
	regularShareButton &&
	sourceShareButton &&
	topicShareButton &&
	!regular.slots.topicFooter.querySelector('[data-topic-share]'),
	'每个 PostView 都必须有精确楼层链接；只有首帖 footer 额外显示主题分享',
);
click(regularShareButton);
await Promise.resolve();
assert(
	postShareRequests.length === 1 &&
	postShareRequests[0] === comment &&
	notices.at(-1) === '楼层 #2 链接已复制到剪切板',
	'楼层分享必须委托同一协调器并复用旧版精确提示',
);
click(sourceShareButton);
click(topicShareButton);
await Promise.resolve();
assert(
	Number(postShareRequests.length) === 2 &&
	postShareRequests[1] === source &&
	topicShareRequests.length === 1 &&
	topicShareRequests[0] === source,
	'首帖楼层 #1 复制与无楼层主题分享是两个不同目标，不能错误去重',
);
const notificationSelect =
	sourceView.slots.topicFooter.querySelector<HTMLSelectElement>(
		'[data-topic-notification]',
	);
assert(
	notificationSelect &&
	String(notificationSelect.value) === '1' &&
	!notificationSelect.disabled &&
	!regular.slots.topicFooter.querySelector(
		'[data-topic-notification]',
	),
	'主题通知级别必须只在首帖 footer 投影，并读取 canonical Topic 初值',
);
change(notificationSelect, '3');
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	topicNotificationRequests.length === 1 &&
	topicNotificationRequests[0]?.post === source &&
	topicNotificationRequests[0]?.level === 3 &&
	String(notificationSelect.value) === '3' &&
	!notificationSelect.disabled,
	'主题通知 change 必须委托唯一协调器，并在 canonical 提交后解除 busy',
);
let dirtyNotificationValue = String(notificationSelect.value);
Object.defineProperty(notificationSelect, 'value', {
	configurable: true,
	get: () => dirtyNotificationValue,
	set: (value: string) => {
		dirtyNotificationValue = String(value);
	},
});
rejectNextTopicNotification = true;
dirtyNotificationValue = '1';
notificationSelect.dispatchEvent(new (document.defaultView!.Event)('change', {
	bubbles: true,
	cancelable: true,
}));
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	Number(topicNotificationRequests.length) === 2 &&
	topicNotificationRequests[1]?.level === 1 &&
	String(notificationSelect.value) === '3' &&
	notices.at(-1) === '通知设置失败：通知更新失败',
	'通知 mutation 失败后必须显式恢复 canonical select.value，不能只改 dirty option attribute',
);
const editButton = regular.slots.actions.querySelector<HTMLButtonElement>(
	'[data-post-edit]',
);
const managementDeleteButton =
	regular.slots.actions.querySelector<HTMLButtonElement>(
	'[data-post-delete]',
);
const postAssignButton = regular.slots.actions.querySelector<HTMLButtonElement>(
	'[data-post-assign]',
);
const adminButton = regular.slots.actions.querySelector<HTMLButtonElement>(
	'[data-post-admin]',
);
const topicAssignButton =
	sourceView.slots.topicFooter.querySelector<HTMLButtonElement>(
		'[data-topic-assign]',
	);
assert(
	editButton &&
	managementDeleteButton &&
	postAssignButton &&
	adminButton &&
	topicAssignButton &&
	sourceView.slots.topicFooter.querySelector(
		'.ldp-topic-report [data-icon="flag"]',
	) &&
	!regular.slots.topicFooter.querySelector('[data-topic-assign]'),
	'编辑/删除/楼层指定/原生管理必须按 canonical 权限进入所有 PostView，主题 footer 图标必须有 fallback',
);
for (const button of [
	editButton,
	managementDeleteButton,
	postAssignButton,
	adminButton,
	topicAssignButton,
]) {
	click(button);
	await new Promise((resolve) => setTimeout(resolve, 0));
}
assert(
	managementRequests.join(',') ===
		'edit:2,delete:2,assign-post:2,admin:2:true,assign-topic:1',
	'所有管理入口必须只委托统一 coordinator，不能恢复散落的 DOM handler',
);
const shadowActionPortal = document.createElement('div');
document.body.append(shadowActionPortal);
const shadowActionRoot = shadowActionPortal.attachShadow({ mode: 'open' });
const shadowActionHost = document.createElement('main');
shadowActionRoot.append(shadowActionHost);
const shadowManagementRequests: string[] = [];
const shadowTopicNotificationRequests: Array<Readonly<{
	readonly post: TestPost;
	readonly level: number;
}>> = [];
let shadowCurrentUsername = 'viewer';
const shadowMessageBusHandlers = new Map<string, (message: unknown) => void>();
const shadowHost: DiscourseHostApiPort = {
	lookup(name) {
		if (name !== 'service:message-bus') return host.lookup(name);
		return {
			subscribe(channel: string, handler: (message: unknown) => void) {
				shadowMessageBusHandlers.set(channel, handler);
			},
			unsubscribe(channel: string, handler: (message: unknown) => void) {
				if (shadowMessageBusHandlers.get(channel) === handler) {
					shadowMessageBusHandlers.delete(channel);
				}
			},
		};
	},
	lookupModule(name) {
		return host.lookupModule(name);
	},
};
const shadowModels = new DiscourseNativePostModelFactory(shadowHost);
const shadowFeature = new ReaderPostActionFeature<TestTopic, TestPost>({
	document,
	surfaceHost: shadowActionHost,
	topic: () => topic,
	actions,
	commands,
	descriptors: new DiscourseActionDescriptors(),
	models: shadowModels,
	reactions: new DiscoursePostReactionCatalog(shadowModels),
	capabilityInput: (post) => ({
		post,
		topic,
		currentUser: { id: 99, username: 'viewer' },
		currentUsername: shadowCurrentUsername,
		plugins: { boosts: true, reactions: true },
	}),
	topicActionRail: true,
	management: {
		async openEdit(post) {
			shadowManagementRequests.push(`edit:${post.id}`);
			return true;
		},
		async deletePost() { return true; },
		async assignPost() { return true; },
		async assignTopic() { return true; },
		async openAdmin() { return true; },
	},
	topicNotifications: {
		async setLevel(post, level) {
			shadowTopicNotificationRequests.push({ post, level });
			Object.assign(topic, {
				notification_level: 3,
				details: { notification_level: 3 },
			});
			return { changed: true, level: 3 };
		},
	},
});
const shadowRailView = new PostView(document, {
	postId: comment.id,
	postNumber: comment.post_number,
	username: comment.username,
});
shadowRailView.slots.root.classList.add('ldp-topic-action-rail-post');
shadowActionHost.append(shadowRailView.slots.root);
shadowFeature.afterRender(comment, shadowRailView);
shadowFeature.setTopicActionRailExpanded(shadowRailView, true);
const shadowEditButton = shadowRailView.slots.actions
	.querySelector<HTMLButtonElement>('[data-post-edit]');
assert(shadowEditButton, 'ShadowRoot 收纳箱必须投影可编辑楼层动作');
click(shadowEditButton);
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	shadowManagementRequests.join(',') === 'edit:2',
	'ShadowRoot 收纳箱动作必须在自身 interaction root 委托，不能等到 document retarget 后丢失目标',
);
const shadowTopicRailView = new PostView(document, {
	postId: source.id,
	postNumber: source.post_number,
	username: source.username,
});
shadowTopicRailView.slots.root.classList.add('ldp-topic-action-rail-post');
shadowActionHost.append(shadowTopicRailView.slots.root);
shadowFeature.afterRender(source, shadowTopicRailView);
shadowFeature.setTopicActionRailExpanded(shadowTopicRailView, true);
const shadowTopicNotification = shadowTopicRailView.slots.actions
	.querySelector<HTMLSelectElement>('[data-topic-notification]');
assert(
	shadowTopicNotification && !shadowTopicNotification.disabled,
	'ShadowRoot 收纳箱必须保留可点击的主题通知级别入口',
);
const shadowSelectSurface = new ReaderSelectSurface({
	document,
	root: shadowActionHost,
});
const shadowNotificationPointerDown = new (document.defaultView!.Event)(
	'pointerdown',
	{ bubbles: true, cancelable: true },
);
Object.defineProperty(shadowNotificationPointerDown, 'button', { value: 0 });
shadowTopicNotification.dispatchEvent(shadowNotificationPointerDown);
const shadowNotificationMenu = shadowTopicNotification.parentElement
	?.querySelector<HTMLElement>('.ldp-select-menu');
assert(
	shadowTopicNotification.parentElement?.classList.contains(
		'ldp-select-surface',
	) &&
		shadowTopicNotification.getAttribute('aria-expanded') === 'true' &&
		shadowNotificationMenu && !shadowNotificationMenu.hidden &&
		shadowNotificationMenu.querySelectorAll(
			'[data-reader-select-value]',
		).length === 4,
	'ShadowRoot 收纳箱铃铛必须通过统一 select surface 弹出四档通知菜单',
);
change(shadowTopicNotification, '2');
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	shadowTopicNotificationRequests.length === 1 &&
		shadowTopicNotificationRequests[0]?.post === source &&
		shadowTopicNotificationRequests[0]?.level === 2 &&
		shadowTopicNotification.value === '3',
	'ShadowRoot 收纳箱铃铛的 change 必须由自身 interaction root 接管并提交通知级别：' +
		`requests=${shadowTopicNotificationRequests.length}; ` +
		`level=${shadowTopicNotificationRequests[0]?.level ?? 'none'}; ` +
		`rendered=${shadowTopicNotification.value}`,
);
shadowCurrentUsername = '';
shadowFeature.afterRender({ ...source, can_reply: false }, shadowTopicRailView);
assert(
	shadowTopicRailView.slots.actions.querySelector(
		'[data-topic-notification]',
	) === null,
	'当前用户身份不可用时必须隐藏铃铛，不能留下必然失效的入口',
);
shadowSelectSurface.destroy();
shadowTopicRailView.destroy();
shadowRailView.destroy();
shadowFeature.destroy();
shadowActionPortal.remove();
const managementOrder = [
	...regular.slots.actions.querySelectorAll<HTMLButtonElement>(
		':scope > .ldp-actions > .ldp-context-actions-slot > button',
	),
].map((button) =>
	button.dataset.postShare !== undefined
		? 'share'
		: button.dataset.postReport !== undefined
			? 'report'
			: button.dataset.postEdit !== undefined
				? 'edit'
				: button.dataset.postBookmark !== undefined
					? 'bookmark'
					: button.dataset.postDelete !== undefined
						? 'delete'
						: button.dataset.postAssign !== undefined
							? 'assign'
							: button.dataset.postAdmin !== undefined
								? 'admin'
								: '',
).filter(Boolean);
assert(
	managementOrder.join(',') ===
		'share,report,edit,bookmark,delete,assign,admin',
	'管理动作的可见顺序必须保持旧版 share/report/edit/bookmark/delete/assign/admin',
);
assert(
	regular.slots.boost.innerHTML ===
		lightboxPost.querySelector('.ldp-boost-list')?.innerHTML &&
	regular.slots.boost.querySelector('.ldp-boost-bubble') &&
	regular.slots.boost.querySelector(
		'button[data-boost-copy]',
	),
	'canonical Boost list 与复制入口必须在普通/灯箱 PostView 的同一命名槽位一致投影',
);
const reportButton = regular.slots.boost.querySelector<HTMLButtonElement>(
	'button[data-boost-report="20"]',
);
assert(
	reportButton &&
		reportButton.querySelector('.ldp-icon-flag') &&
		reportButton.closest('.ldp-boost-quick-actions')?.querySelector(
			'[data-boost-copy] .ldp-icon-copy',
		) &&
		reportButton.closest('.ldp-boost-quick-actions')?.querySelector(
			'[data-boost-mention] .ldp-icon-at',
		) &&
		!sourceView.slots.boost.querySelector('[data-boost-report]'),
	'非自己的 Boost 必须把复制、@ 与举报图标收进同一悬浮工具层，自己的 Boost 只能显示删除入口',
);
const noticesBeforeBoostReport = notices.length;
click(reportButton);
await Promise.resolve();
assert(
	boostReportRequests.length === 1 &&
		boostReportRequests[0]?.postId === 2 &&
		boostReportRequests[0]?.boostId === 20 &&
		boostReportRequests[0]?.username === 'booster' &&
		notices.length === noticesBeforeBoostReport,
	'Boost 举报入口必须委托唯一 runtime 流程并保留身份，成功反馈由表单唯一负责',
);
click(regular.slots.boost.querySelector<HTMLButtonElement>(
	'button[data-boost-copy]',
)!);
const copiedBoostMenu = document.querySelector<HTMLElement>(
	'.ldp-native-boost-menu',
)!;
const copiedBoostEditor = copiedBoostMenu.querySelector<HTMLElement>(
	'.discourse-boosts__input',
)!;
let boostWheelLeaks = 0;
document.querySelector('main')!.addEventListener('wheel', () => {
	boostWheelLeaks += 1;
});
const boostBoundaryWheel = new parsedWindow.Event('wheel', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(boostBoundaryWheel, {
	deltaX: { value: 0 },
	deltaY: { value: 120 },
	deltaMode: { value: 0 },
});
copiedBoostMenu.dispatchEvent(boostBoundaryWheel);
assert(
	boostBoundaryWheel.defaultPrevented && boostWheelLeaks === 0,
	'Boost composer 的滚轮边界不得继续驱动宿主阅读流',
);
assert(
	copiedBoostMenu.querySelector(
		'[data-boost-emoji] svg[data-ldp-reader-icon]',
	) &&
	copiedBoostMenu.querySelector(
		'[data-boost-submit] svg[data-ldp-reader-icon]',
	) &&
	copiedBoostMenu.querySelector(
		'[data-boost-cancel] svg[data-ldp-reader-icon]',
	),
	'Boost composer 的表情、提交与取消入口必须使用可见内联图标，不能依赖空宿主 use 或文本占位',
);
assert(
	copiedBoostMenu.parentElement === document.querySelector('main'),
	'Boost composer 必须属于 Shell surfaceHost，继承唯一外观和字体投影',
);
assert(
	copiedBoostEditor.textContent === '同意：原 Boo😄 续+2' &&
		copiedBoostMenu.querySelector('.ldp-native-boost-count')?.textContent ===
			'13/16',
	'Boost 气泡复制必须按当前规则预填同一受控 composer，不能写第二份剪贴板/计数状态',
);
const emojiButton = copiedBoostMenu.querySelector<HTMLButtonElement>(
	'[data-boost-emoji]',
);
assert(
	emojiButton && !emojiButton.hidden && !emojiButton.disabled,
	'Boost composer 必须在同一菜单提供原生 emoji 入口',
);
click(emojiButton);
await Promise.resolve();
boostEmojiSelections[0]?.('laughing');
assert(
	boostEmojiShows === 1 &&
		copiedBoostEditor.querySelector('img.emoji')?.getAttribute('alt') ===
			':laughing:' &&
		copiedBoostMenu.querySelector('.ldp-native-boost-count')
			?.textContent === '15/16',
	'原生 picker 选择必须插入 Discourse emoji 图片，并按一个字符计入统一 16 字状态',
);
const boostEmojiPicker = document.createElement('div');
boostEmojiPicker.className = 'emoji-picker';
boostEmojiPicker.append(document.createElement('div'));
const boostEmojiSurface = document.createElement('div');
boostEmojiSurface.className = 'fk-d-menu';
boostEmojiSurface.dataset.identifier = 'ldp-native-boost-emoji-picker';
boostEmojiSurface.append(boostEmojiPicker);
Object.defineProperties(document.documentElement, {
	clientWidth: { configurable: true, value: 640 },
	clientHeight: { configurable: true, value: 240 },
});
Object.defineProperty(boostEmojiPicker, 'offsetHeight', {
	configurable: true,
	value: 400,
});
boostEmojiPicker.getBoundingClientRect = () => {
	const height = Number.parseFloat(boostEmojiPicker.style.height) || 400;
	return {
		x: 0,
		y: 0,
		top: 0,
		right: 320,
		bottom: height,
		left: 0,
		width: 320,
		height,
		toJSON: () => ({}),
	};
};
copiedBoostMenu.getBoundingClientRect = () => ({
	x: 16,
	y: 100,
	top: 100,
	right: 356,
	bottom: 140,
	left: 16,
	width: 340,
	height: 40,
	toJSON: () => ({}),
});
document.body.append(boostEmojiSurface);
positionBoostEmoji?.(boostEmojiPicker);
assert(
	boostEmojiPicker.classList.contains('ldp-boost-picker-constrained') &&
		boostEmojiPicker.style.height === '224px' &&
		boostEmojiPicker.style.getPropertyValue('--ldp-boost-picker-top') ===
			'8px' &&
		boostEmojiSurface.getAttribute('popover') === 'manual' &&
		boostEmojiSurface.dataset.ldpReaderTopLayer === 'portal' &&
		boostEmojiTopLayers.has(boostEmojiSurface),
	'原生 emoji picker 必须进入与回复浮窗一致的 top layer，再复用 constrained CSS 夹入 Reader 边界',
);
let emojiWheelLeaks = 0;
document.body.addEventListener('wheel', () => {
	emojiWheelLeaks += 1;
});
const emojiBoundaryWheel = new parsedWindow.Event('wheel', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperties(emojiBoundaryWheel, {
	deltaX: { value: 0 },
	deltaY: { value: 120 },
	deltaMode: { value: 0 },
});
boostEmojiSurface.dispatchEvent(emojiBoundaryWheel);
assert(
	emojiBoundaryWheel.defaultPrevented && emojiWheelLeaks === 0,
	'提升到 top layer 的原生 emoji 浮层不得把边界滚轮泄漏给宿主',
);
boostEmojiPicker.dispatchEvent(new parsedWindow.Event('scroll', {
	bubbles: true,
}));
assert(
	!copiedBoostMenu.hidden,
	'Boost 内部 emoji picker 滚动不得被 document capture listener 误判为阅读流滚动并关闭 composer',
);
boostEmojiSurface.remove();
const detachedCopyAnchor =
	regular.slots.boost.querySelector<HTMLElement>('[data-boost-copy]')!;
feature.afterRender(comment, regular);
assert(
	copiedBoostMenu.hidden &&
		!detachedCopyAnchor.isConnected &&
		!boostEmojiTopLayers.has(boostEmojiSurface) &&
		!boostEmojiSurface.hasAttribute('popover') &&
		!boostEmojiSurface.dataset.ldpReaderTopLayer &&
		regular.slots.actions.querySelector('[data-post-boost]')
			?.getAttribute('aria-expanded') === 'false',
	'canonical 重投替换 Boost copy anchor 前必须收口 composer、宿主 top layer 与 ARIA，不能遗留脱离 DOM 的 owner',
);
document.dispatchEvent(new parsedWindow.Event('scroll'));
assert(boostEmojiCloses > 0, '关闭 Boost composer 必须同步关闭原生 emoji surface');
boostCopySettings = {
	mode: 'text',
	prefix: '',
	counterMarker: '+',
	counterStep: 1,
	fixedSuffix: '俺也一样',
};
click(regular.slots.boost.querySelector<HTMLButtonElement>(
	'button[data-boost-copy]',
)!);
assert(
	String(copiedBoostEditor.textContent) === '原 Boo😄 续俺也一样',
	'已挂载 PostView 的复制动作必须在点击时热读取统一设置，不依赖重建楼层 DOM',
);
document.dispatchEvent(new parsedWindow.Event('scroll'));
click(regular.slots.boost.querySelector<HTMLButtonElement>(
	'button[data-boost-mention]',
)!);
await Promise.resolve();
const boostQuoteRichHtml = composerInputs[0]?.initialRichHtml ?? '';
const { document: boostQuoteDocument } = parseHTML(
	`<!doctype html><html><body>${boostQuoteRichHtml}</body></html>`,
);
const boostQuote = boostQuoteDocument.querySelector<HTMLElement>('aside.quote');
assert(
	composerInputs.length === 1 &&
		composerInputs[0]?.post === comment &&
			composerInputs[0]?.initialRaw ===
				'[quote="booster, post:2, topic:10, username:booster"]\n' +
				'原 Boo😄\n续\n[/quote]\n\n@booster ' &&
			composerInputs[0]?.dedupeMention === 'booster' &&
			boostQuote?.dataset.username === 'booster' &&
			boostQuote.dataset.post === '2' &&
			boostQuote.dataset.topic === '10' &&
			boostQuote.querySelector('blockquote')?.innerHTML ===
				'<p>原 Boo😄<br>续</p>' &&
			boostQuote.nextElementSibling?.textContent === '@booster\u00a0',
	'Boost 引用动作必须同时提供 Markdown 与富文本引用，并保留多行内容和重复提及身份',
);
skipNextComposerInsertion = true;
click(regular.slots.boost.querySelector<HTMLButtonElement>(
	'button[data-boost-mention]',
)!);
await Promise.resolve();
assert(
	Number(composerInputs.length) === 2 &&
		notices.at(-1) === '回复框中已有 @booster',
	'草稿已提及 Boost 用户时必须聚焦原 Composer，不得重复插入引用或误报成功',
);
click(regular.slots.actions.querySelector<HTMLButtonElement>('[data-post-reply]')!);
await Promise.resolve();
assert(
	Number(composerInputs.length) === 3 &&
	composerInputs[2]?.topic === topic &&
	composerInputs[2]?.post === comment,
	'普通/嵌套/实时/回屏与灯箱评论的回复入口必须复用注入的同一原生 composer',
);
click(topicReplyButton);
await Promise.resolve();
assert(
	Number(composerInputs.length) === 4 &&
		composerInputs[3]?.topic === topic &&
		composerInputs[3]?.post === source,
	'主题首帖 footer 的回复入口必须复用同一 Composer owner，并以首帖作为回复目标',
);
rejectNextComposer = true;
click(regular.slots.boost.querySelector<HTMLButtonElement>(
	'button[data-boost-mention]',
)!);
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	Number(composerInputs.length) === 5 &&
		notices.at(-1) === '引用 Boost 失败：composer down',
	'Boost 引用打开 Composer 失败时必须给用户可见反馈，不能只写诊断',
);
rejectNextComposer = true;
click(regular.slots.actions.querySelector<HTMLButtonElement>(
	'[data-post-reply]',
)!);
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	Number(composerInputs.length) === 6 &&
		notices.at(-1) === '打开回复编辑器失败：composer down',
	'楼层回复打开 Composer 失败时必须给用户可见反馈，不能静默失败',
);

openReactionPicker(regular.slots.actions);
const openedTrigger = regular.slots.actions.querySelector<HTMLButtonElement>(
	'[data-reaction-picker]',
)!;
assert(
	openedTrigger.getAttribute('aria-expanded') === 'true' &&
	!regular.slots.actions.querySelector<HTMLElement>('.ldp-reaction-picker')?.hidden,
	'通用回应 picker 必须由同一悬停 owner 打开',
);
let reactionEscapeLeaks = 0;
const downstreamReactionEscape = (): void => {
	reactionEscapeLeaks += 1;
};
document.addEventListener('keydown', downstreamReactionEscape);
const reactionEscape = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(reactionEscape, 'key', { value: 'Escape' });
document.dispatchEvent(reactionEscape);
document.removeEventListener('keydown', downstreamReactionEscape);
assert(
	reactionEscape.defaultPrevented &&
		reactionEscapeLeaks === 0 &&
		regular.slots.actions.querySelector('[data-reaction-picker]')
			?.getAttribute('aria-expanded') === 'false' &&
		regular.slots.actions.querySelector<HTMLElement>('.ldp-reaction-picker')
			?.hidden,
	'回应 picker 消费 Esc 后必须只关闭自身，不能继续触发 Reader 退出监听器',
);
openReactionPicker(regular.slots.actions);
const laughing = regular.slots.actions.querySelector<HTMLButtonElement>(
	'.ldp-reaction-picker [data-reaction="laughing"]',
)!;
click(laughing);
await Promise.resolve();
const firstReactionNativePost = (
	mutation.calls[0]?.payload as Readonly<{
		readonly args?: readonly unknown[];
	}> | undefined
)?.args?.[0] as TestPost | undefined;
assert(
	mutation.calls.length === 1 &&
	mutation.calls[0]?.operation === 'reaction-toggle' &&
	mutation.calls[0]?.variant === 'laughing' &&
	firstReactionNativePost?.current_user_reaction == null,
	'新增回应必须以未投影的 authoritative post 生成唯一原生 descriptor，再进入共享 PostActionController',
);
const heart = regular.slots.actions.querySelector<HTMLButtonElement>(
	'[data-reaction="heart"]',
);
if (heart) click(heart);
assert(
	mutation.calls.length === 1 &&
	regular.slots.actions.querySelector('.ldp-reaction-summary')
		?.getAttribute('aria-busy') === 'true' &&
	lightboxPost.querySelector('.ldp-reaction-summary')
		?.getAttribute('aria-busy') === 'true',
	'同一 canonical post 的不同视图必须共享 pending，并阻止第二个回应请求',
);

const authoritative: TestPost = {
	...comment,
	reactions: [{ id: 'laughing', count: 1 }, { id: 'heart', count: 2 }],
	current_user_reaction: { id: 'laughing' },
	reaction_users_count: 3,
};
const settled = new Promise<void>((resolve) => {
	const unsubscribe = actions.events.subscribe((event) => {
		if (event.operation !== 'reaction-toggle' || event.phase !== 'settled') return;
		unsubscribe();
		resolve();
	});
});
mutation.resolve(0, authoritative);
await settled;
assert(
	session.postById(2)?.current_user_reaction?.id === 'laughing' &&
	regular.slots.actions.querySelector('.ldp-reaction-summary')
		?.getAttribute('aria-busy') !== 'true' &&
	lightboxPost.querySelector('.ldp-reaction-summary')
		?.getAttribute('aria-busy') !== 'true',
	'authoritative result 必须提交唯一 TopicSession，且所有视图同步解除 busy',
);
feature.afterRender(authoritative, regular);
changes.emit({ source: 'action-response' });
assert(
	regular.slots.actions.querySelector('[data-reaction="laughing"]')
		?.classList.contains('on') &&
	lightboxPost.querySelector('[data-reaction="laughing"]')
		?.classList.contains('on'),
	'canonical post 更新后普通/灯箱视图必须同步显示同一当前回应',
);

const boostButton = regular.slots.actions.querySelector<HTMLButtonElement>(
	'[data-post-boost]',
);
assert(boostButton, '明确 can_boost 的动态 PostView 必须显示 Boost 入口');
click(boostButton);
const boostMenu = document.querySelector<HTMLElement>(
	'.ldp-native-boost-menu',
);
const boostEditor = boostMenu?.querySelector<HTMLElement>(
	'.discourse-boosts__input',
);
assert(
	boostMenu && !boostMenu.hidden && boostEditor,
	'Boost 入口必须打开同一受控 composer，而不是依赖首次楼层模板',
);
click(boostButton);
assert(
	boostMenu.hidden &&
		boostButton.getAttribute('aria-expanded') === 'false',
	'再次点击同一个 Boost anchor 必须关闭唯一 composer',
);
Object.defineProperty(boostMenu, 'offsetWidth', {
	configurable: true,
	value: 360,
});
let boostAnchorTop = 100;
boostButton.getBoundingClientRect = () => ({
	x: 620,
	y: boostAnchorTop,
	top: boostAnchorTop,
	right: 640,
	bottom: boostAnchorTop + 20,
	left: 620,
	width: 20,
	height: 20,
	toJSON: () => ({}),
});
click(boostButton);
assert(
	!boostMenu.hidden &&
		boostButton.getAttribute('aria-expanded') === 'true',
	`关闭后再次点击必须重新打开 Boost composer：${
		String(boostMenu.hidden)
	}/${boostButton.getAttribute('aria-expanded') ?? 'none'}/${
		String(boostButton.disabled)
		}/${String(boostButton.isConnected)}`,
);
assert(
	boostMenu.style.left === '272px',
	`Boost composer 靠近视口右侧时必须按实际 360px 宽度夹入边界：${
		boostMenu.style.left
	}`,
);
const boostClip = boostButton.closest<HTMLElement>('.ldp-body');
if (boostClip) {
	boostClip.getBoundingClientRect = () => ({
		x: 0,
		y: 0,
		top: 0,
		right: 640,
		bottom: 240,
		left: 0,
		width: 640,
		height: 240,
		toJSON: () => ({}),
	});
}
const boostTopBeforeWindowMove = boostMenu.style.top;
boostAnchorTop = 130;
document.querySelector('main')!.dispatchEvent(
	new parsedWindow.Event('ldp-reader-window-change'),
);
assert(
	!boostMenu.hidden && boostMenu.style.top !== boostTopBeforeWindowMove,
	'Reader 浮窗移动后，Boost composer 必须跟随当前楼层 anchor 重定位',
);
assert(
	!boostEditor.closest('[data-post-boost]'),
	'Boost editor 不能成为原 Boost anchor 的 DOM 后代',
);
pointerDown(boostEditor);
assert(
	!boostMenu.hidden,
	'Boost 编辑器内部 pointerdown 不能被文档外部关闭路径销毁',
);
click(boostEditor);
assert(
	!boostMenu.hidden,
	'Boost 编辑器内部 click 必须归浮层自己所有，不能被文档兜底路径销毁',
);
pointerDown(boostMenu);
click(boostButton);
assert(
	!boostMenu.hidden &&
		boostButton.getAttribute('aria-expanded') === 'true',
	'浮层内 pointerdown 后即使 click 被浏览器重定向到原 anchor，也不能切换关闭 composer',
);
pointerDown(document.querySelector('main')!);
assert(
	boostMenu.hidden &&
		boostButton.getAttribute('aria-expanded') === 'false',
	'真正发生在 Boost 浮层与 anchor 之外的 pointerdown 才能关闭 composer',
);
click(boostButton);
assert(
	!boostMenu.hidden,
	'外部关闭后 Boost composer 必须仍可从原 anchor 重新打开并发送',
);
const familyEmoji = '👨‍👩‍👧‍👦';
boostEditor.textContent = familyEmoji.repeat(5);
boostEditor.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	boostEditor.textContent === familyEmoji.repeat(5) &&
		boostMenu.querySelector('.ldp-native-boost-count')?.textContent ===
			'5/16',
	'键盘/粘贴的 Unicode ZWJ emoji 必须按 grapheme 计长并纳入统一五个 emoji 上限',
);
boostEditor.textContent += familyEmoji;
boostEditor.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	boostEditor.textContent === familyEmoji.repeat(5),
	'第六个 Unicode emoji 必须由同一受控 editor 回退，不能绕过 img emoji 计数',
);
const boostSubmit = boostMenu.querySelector<HTMLButtonElement>(
	'[data-boost-submit]',
)!;
const overlongBoost = '超'.repeat(17);
boostEditor.textContent = overlongBoost;
boostEditor.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const overLimitCount = boostMenu.querySelector<HTMLElement>(
	'.ldp-native-boost-count',
)!;
const mutationsBeforeOverLimitSubmit = mutation.calls.length;
const overLimitEnter = new parsedWindow.Event('keydown', {
	bubbles: true,
	cancelable: true,
});
Object.defineProperty(overLimitEnter, 'key', { value: 'Enter' });
boostEditor.dispatchEvent(overLimitEnter);
click(boostSubmit);
await Promise.resolve();
assert(
	boostEditor.textContent === overlongBoost &&
		overLimitCount.textContent === '17/16' &&
		overLimitCount.classList.contains('is-over-limit') &&
		boostEditor.getAttribute('aria-invalid') === 'true' &&
		boostSubmit.disabled &&
		overLimitEnter.defaultPrevented &&
		mutation.calls.length === mutationsBeforeOverLimitSubmit,
	'Boost 超过 16 字时必须保留完整草稿、标红计数并禁用提交；' +
		'即使强制触发点击或 Enter 也不能创建请求',
);
boostEditor.textContent = '赞同 ';
boostEditor.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
assert(
	boostEditor.textContent === '赞同 ' &&
		String(overLimitCount.textContent) === '3/16' &&
		!overLimitCount.classList.contains('is-over-limit') &&
		!boostEditor.hasAttribute('aria-invalid') &&
		!boostSubmit.disabled,
	'Boost 受控输入不得在输入过程中吃掉词间空格或重置普通输入光标',
);
boostEditor.textContent += '理由';
boostEditor.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const boostSettled = new Promise<void>((resolve) => {
	const unsubscribe = actions.events.subscribe((event) => {
		if (event.operation !== 'boost-create' || event.phase !== 'settled') return;
		unsubscribe();
		resolve();
	});
});
click(boostMenu.querySelector<HTMLButtonElement>('[data-boost-submit]')!);
await Promise.resolve();
assert(
	Number(mutation.calls.length) === 2 &&
	mutation.calls[1]?.operation === 'boost-create' &&
	boostMenu.getAttribute('aria-busy') === 'true',
	`Boost 提交必须先进入唯一 pending，再等待 authoritative result：${
		mutation.calls.length
	}/${mutation.calls[1]?.operation ?? 'none'}/${
		boostMenu.getAttribute('aria-busy') ?? 'not-busy'
	}/${
		boostMenu.querySelector('.ldp-native-boost-error')?.textContent ?? ''
	}`,
);
document.dispatchEvent(new parsedWindow.Event('scroll'));
const sourceBoostButton = sourceView.slots.actions.querySelector<HTMLButtonElement>(
	'[data-post-boost]',
);
assert(sourceBoostButton, '另一个 canonical PostView 必须复用同一 Boost composer');
click(sourceBoostButton);
assert(
	boostButton.getAttribute('aria-expanded') === 'false' &&
	sourceBoostButton.getAttribute('aria-expanded') === 'true' &&
	!boostMenu.hidden,
	'Boost composer 从楼层 A 切到楼层 B 时必须复位旧 anchor 并保留唯一 active binding',
);
mutation.resolve(1, authoritative);
await boostSettled;
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	Number(mutation.calls.length) === 2 &&
	mutation.calls[1]?.operation === 'boost-create' &&
	!boostMenu.hidden &&
	sourceBoostButton.getAttribute('aria-expanded') === 'true',
	`较早 Boost 的晚到成功不得关闭后来打开的 composer：${
		mutation.calls.length
	}/${mutation.calls[1]?.operation ?? 'none'}/${String(boostMenu.hidden)}/${
		boostMenu.querySelector('.ldp-native-boost-error')?.textContent ?? ''
	}`,
);
boostEditor.textContent = '确实';
boostEditor.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const secondBoostSettled = new Promise<void>((resolve) => {
	const unsubscribe = actions.events.subscribe((event) => {
		if (event.operation !== 'boost-create' || event.phase !== 'settled') return;
		unsubscribe();
		resolve();
	});
});
click(boostMenu.querySelector<HTMLButtonElement>('[data-boost-submit]')!);
await Promise.resolve();
mutation.reject(2, new Error('服务端拒绝 Boost'));
await secondBoostSettled;
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	Number(mutation.calls.length) === 3 &&
	mutation.calls[2]?.operation === 'boost-create' &&
		!boostMenu.hidden &&
		boostEditor.textContent === '确实' &&
		boostEditor.isContentEditable &&
		!boostSubmit.disabled &&
		boostMenu.querySelector('.ldp-native-boost-error')?.textContent ===
			'服务端拒绝 Boost',
	'服务端拒绝 Boost 后必须保留当前会话草稿、错误反馈并恢复可编辑与重试状态',
);
boostEditor.textContent += '，修改后重试';
boostEditor.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const boostRetrySettled = new Promise<void>((resolve) => {
	const unsubscribe = actions.events.subscribe((event) => {
		if (event.operation !== 'boost-create' || event.phase !== 'settled') return;
		unsubscribe();
		resolve();
	});
});
click(boostSubmit);
await Promise.resolve();
mutation.resolve(3, source);
await boostRetrySettled;
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	Number(mutation.calls.length) === 4 &&
		mutation.calls[3]?.operation === 'boost-create' &&
		boostMenu.hidden,
	'修改服务端拒绝后保留的 Boost 草稿必须可以重新提交，并在成功后关闭 composer',
);

const deleteButton = sourceView.slots.boost.querySelector<HTMLButtonElement>(
	'button[data-boost-delete="21"]',
);
const duplicateSourceView = new PostView(document, {
	postId: 1,
	postNumber: 1,
	username: 'source',
});
document.querySelector('main')!.append(duplicateSourceView.slots.root);
feature.afterRender(source, duplicateSourceView);
const duplicateDeleteButton =
	duplicateSourceView.slots.boost.querySelector<HTMLButtonElement>(
		'button[data-boost-delete="21"]',
	);
assert(
	deleteButton &&
		duplicateDeleteButton &&
		deleteButton.querySelector('.ldp-icon-trash') &&
		duplicateDeleteButton.querySelector('.ldp-icon-trash') &&
		!sourceView.slots.boost.querySelector('[data-boost-copy]'),
	'自己的 Boost 必须复用图标动作入口且不能出现复制预填入口',
);
const deleteSettled = new Promise<void>((resolve) => {
	const unsubscribe = actions.events.subscribe((event) => {
		if (event.operation !== 'boost-delete' || event.phase !== 'settled') return;
		unsubscribe();
		resolve();
	});
});
click(deleteButton);
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	deleteConfirmations === 1 &&
		Number(mutation.calls.length) === 4 &&
		!deleteButton.disabled,
	'取消删除自己的 Boost 必须恢复按钮且零 mutation',
);
approveBoostDelete = true;
click(deleteButton);
click(duplicateDeleteButton);
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	Number(deleteConfirmations) === 2 &&
		Number(mutation.calls.length) === 5 &&
		mutation.calls[4]?.operation === 'boost-delete' &&
		deleteButton.disabled,
	`删除自己的 Boost 必须先复用统一确认，再只生成一个 boost-delete descriptor/pending：${
		deleteConfirmations
	}/${mutation.calls.length}/${
		mutation.calls[4]?.operation ?? 'none'
	}/${String(deleteButton.disabled)}`,
);
const boostDeleteNoticesBefore = notices.filter(
	(notice) => notice === 'Boost 已删除',
).length;
mutation.reject(4, new Error('boost down'));
await deleteSettled;
await new Promise((resolve) => setTimeout(resolve, 0));
feature.afterRender(session.postById(1)!, sourceView);
const retryDeleteButton = sourceView.slots.boost.querySelector<HTMLButtonElement>(
	'button[data-boost-delete="21"]',
);
assert(
	notices.at(-1) === '删除 Boost 失败：boost down' &&
		session.postById(1)?.boosts?.length === 1 &&
		retryDeleteButton !== null &&
		!retryDeleteButton.disabled,
	'Boost 删除失败时必须保留 canonical Boost、恢复入口并给用户可见反馈',
);
const deleteRetrySettled = new Promise<void>((resolve) => {
	const unsubscribe = actions.events.subscribe((event) => {
		if (event.operation !== 'boost-delete' || event.phase !== 'settled') return;
		unsubscribe();
		resolve();
	});
});
click(retryDeleteButton);
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	Number(deleteConfirmations) === 3 &&
		Number(mutation.calls.length) === 6 &&
		mutation.calls[5]?.operation === 'boost-delete',
	`Boost 删除失败后的重试必须创建新的 single-flight mutation：${
		deleteConfirmations
	}/${mutation.calls.length}/${mutation.calls[5]?.operation ?? 'none'}`,
);
mutation.resolve(5, { boostId: 21, deleted: true });
await deleteRetrySettled;
await new Promise((resolve) => setTimeout(resolve, 0));
feature.afterRender(session.postById(1)!, sourceView);
assert(
	sourceView.slots.boost.hidden &&
		notices.filter((notice) => notice === 'Boost 已删除').length ===
			boostDeleteNoticesBefore + 1 &&
		notices.at(-1) === 'Boost 已删除',
	`重复 PostView 同帧删除必须只确认/提示一次，并经 authoritative TopicSession 移除 Boost：${
	String(sourceView.slots.boost.hidden)
	}/${sourceView.slots.boost.childElementCount}/${
		notices.at(-1) ?? 'none'
	}/${String(session.postById(1)?.boosts?.length ?? -1)}`,
);
duplicateSourceView.destroy();

const nativeLikeButton =
	nativeLikeView.slots.actions.querySelector<HTMLButtonElement>(
		'[data-post-like]',
	);
assert(
	nativeLikeButton &&
		!nativeLikeButton.dataset.reaction &&
		nativeLikeButton.querySelector('.ldp-like-count')?.textContent === '0',
	'无 reactions 插件时点赞入口必须使用 canonical action id=2，而不是伪造主回应',
);
const nativeLikeSettled = new Promise<void>((resolve) => {
	const unsubscribe = actions.events.subscribe((event) => {
		if (event.operation !== 'like-toggle' || event.phase !== 'settled') return;
		unsubscribe();
		resolve();
	});
});
click(nativeLikeButton);
await Promise.resolve();
assert(
	Number(mutation.calls.length) === 7 &&
		mutation.calls[6]?.operation === 'like-toggle' &&
		nativeLikeButton.getAttribute('aria-busy') === 'true',
	'无 reactions 插件时必须只生成一个原生 like descriptor，并共享 pending',
);
mutation.resolve(6, { acted: true, count: 1 });
await nativeLikeSettled;
feature.afterRender(session.postById(3)!, nativeLikeView);
assert(
	nativeLikeButton.classList.contains('liked') &&
		nativeLikeButton.querySelector('.ldp-like-count')?.textContent === '1',
	'原生 like 权威结果必须回写 canonical post 并重投现有 PostView',
);

const primaryReactionLike =
	regular.slots.actions.querySelector<HTMLButtonElement>(
		'[data-post-like]',
	);
assert(
	primaryReactionLike?.dataset.reaction === 'heart' &&
		primaryReactionLike.querySelector('.ldp-like-count')?.textContent === '2',
	'安装 reactions 插件时主点赞必须映射站点配置的 main reaction 及其计数',
);
feature.afterRender({
	...session.postById(2)!,
	reactions: [{ id: 'heart', count: 4 }],
	reaction_users_count: 4,
}, regular);
assert(
	primaryReactionLike.querySelector('.ldp-like-count')?.textContent === '4',
	'后台事件重投同一 PostView 时，即使动作 capability 未变化也必须刷新回应计数',
);
feature.afterRender(session.postById(2)!, regular);
assert(
	primaryReactionLike.querySelector('.ldp-like-count')?.textContent === '2',
	'同一 PostView 必须继续接受后续 canonical 回投，不能把事件值冻结在 binding 缓存',
);
const primaryReactionSettled = new Promise<void>((resolve) => {
	const unsubscribe = actions.events.subscribe((event) => {
		if (
			event.operation !== 'reaction-toggle' ||
			event.phase !== 'settled'
		) return;
		unsubscribe();
		resolve();
	});
});
click(primaryReactionLike);
await Promise.resolve();
const switchReactionNativePost = (
	mutation.calls[7]?.payload as Readonly<{
		readonly args?: readonly unknown[];
	}> | undefined
)?.args?.[0] as TestPost | undefined;
assert(
	Number(mutation.calls.length) === 8 &&
		mutation.calls[7]?.operation === 'reaction-toggle' &&
		mutation.calls[7]?.variant === 'heart' &&
		switchReactionNativePost?.current_user_reaction?.id === 'laughing' &&
		primaryReactionLike.classList.contains('liked') &&
		primaryReactionLike.querySelector('.ldp-like-count')?.textContent === '3' &&
		lightboxPost.querySelector('[data-post-like]')
			?.classList.contains('liked'),
	'切换主爱心必须用原 authoritative 回应建模，再乐观同步全部现有 PostView',
);
mutation.resolve(7, {
	...authoritative,
	reactions: [{ id: 'laughing', count: 0 }, { id: 'heart', count: 3 }],
	current_user_reaction: { id: 'heart' },
	reaction_users_count: 3,
});
await primaryReactionSettled;
feature.afterRender(session.postById(2)!, regular);
changes.emit({ source: 'action-response' });
assert(
	primaryReactionLike.classList.contains('liked') &&
		primaryReactionLike.querySelector('.ldp-like-count')?.textContent === '3' &&
		lightboxPost.querySelector('[data-post-like]')
			?.classList.contains('liked'),
	'主回应点赞的 authoritative 结果必须同步全部 canonical PostView',
);

click(nativeLikeButton);
await Promise.resolve();
assert(
	mutation.calls[8]?.operation === 'like-toggle',
	'原生点赞失败反例必须实际进入 like-toggle mutation',
);
mutation.reject(8, new Error('like down'));
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	notices.at(-1) === '点赞失败：like down',
	'原生点赞 mutation 失败时必须给用户可见反馈',
);

click(primaryReactionLike);
await Promise.resolve();
const cancelReactionNativePost = (
	mutation.calls[9]?.payload as Readonly<{
		readonly args?: readonly unknown[];
	}> | undefined
)?.args?.[0] as TestPost | undefined;
assert(
	mutation.calls[9]?.operation === 'reaction-toggle' &&
		cancelReactionNativePost?.current_user_reaction?.id === 'heart',
	'取消回应必须保留请求前的当前回应，不能把 optimistic 空状态传给原生 toggle',
);
mutation.reject(9, new Error('reaction down'));
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	notices.at(-1) === '回应失败：reaction down' &&
		primaryReactionLike.classList.contains('liked') &&
		primaryReactionLike.querySelector('.ldp-like-count')?.textContent === '3',
	'自定义回应 mutation 失败时必须回滚乐观状态并给用户可见反馈',
);

const railLikeCallIndex = mutation.calls.length;
click(railLike);
await Promise.resolve();
assert(
	mutation.calls.length === railLikeCallIndex + 1 &&
		String(mutation.calls[railLikeCallIndex]?.operation) === 'reaction-toggle' &&
		mutation.calls[railLikeCallIndex]?.variant === 'heart' &&
		railView.slots.actions.querySelector<HTMLElement>('.ldp-reaction-picker')
			?.hidden,
	'同时作为 picker 锚点的主爱心按钮点击必须直接切换主回应，不能只打开表情列表',
);
mutation.reject(railLikeCallIndex, new Error('rail like cleanup'));
await new Promise((resolve) => setTimeout(resolve, 0));

const nestedDefaultReactionCallIndex = mutation.calls.length;
const nestedDefaultReaction = regular.slots.actions.querySelector<
	HTMLButtonElement
>('[data-reaction-picker]')!;
const nestedPrimaryAnchor = nestedDefaultReaction.closest<HTMLElement>(
	'.ldp-reaction-like-picker',
)!;
const nestedReactionSummary = nestedPrimaryAnchor.parentElement!;
let nestedReactionAnchorDetached = false;
const nestedReactionObserver = new parsedWindow.MutationObserver((records) => {
	for (const record of records) {
		if ([...record.removedNodes].includes(nestedPrimaryAnchor)) {
			nestedReactionAnchorDetached = true;
		}
	}
});
nestedReactionObserver.observe(nestedReactionSummary, { childList: true });
let nestedReactionFocusedWithoutScroll = false;
const originalNestedReactionFocus = nestedDefaultReaction.focus;
nestedDefaultReaction.focus = (options?: FocusOptions): void => {
	nestedReactionFocusedWithoutScroll = options?.preventScroll === true;
};
let nestedReactionClickLeaks = 0;
const downstreamNestedReactionClick = (): void => {
	nestedReactionClickLeaks += 1;
};
document.addEventListener('click', downstreamNestedReactionClick);
const nestedReactionEvent = document.createEvent('Event');
nestedReactionEvent.initEvent('click', true, true);
nestedDefaultReaction.dispatchEvent(nestedReactionEvent);
document.removeEventListener('click', downstreamNestedReactionClick);
await Promise.resolve();
nestedReactionObserver.disconnect();
nestedDefaultReaction.focus = originalNestedReactionFocus;
assert(
	mutation.calls.length === nestedDefaultReactionCallIndex + 1 &&
		String(mutation.calls[nestedDefaultReactionCallIndex]?.operation) ===
			'reaction-toggle' &&
		mutation.calls[nestedDefaultReactionCallIndex]?.variant === 'heart' &&
		nestedReactionClickLeaks === 0 &&
		nestedReactionEvent.defaultPrevented &&
		!nestedReactionAnchorDetached &&
		regular.slots.actions.querySelector('[data-reaction-picker]') ===
			nestedDefaultReaction &&
		nestedReactionFocusedWithoutScroll &&
		!regular.slots.actions.querySelector('[data-post-like]')
			?.classList.contains('liked') &&
		regular.slots.actions.querySelector('.ldp-like-count')
			?.textContent === '2',
	'树状嵌套子回复点赞必须保留原位按钮、无滚动聚焦并截断楼层及 document 点击链；' +
		`calls=${mutation.calls.length - nestedDefaultReactionCallIndex};` +
		`document=${nestedReactionClickLeaks};default=${nestedReactionEvent.defaultPrevented};` +
		`detached=${nestedReactionAnchorDetached};` +
		`same=${regular.slots.actions.querySelector('[data-reaction-picker]') === nestedDefaultReaction};` +
		`focused=${nestedReactionFocusedWithoutScroll};` +
		`liked=${regular.slots.actions.querySelector('[data-post-like]')?.classList.contains('liked')};` +
		`count=${regular.slots.actions.querySelector('.ldp-like-count')?.textContent}`,
);
mutation.reject(
	nestedDefaultReactionCallIndex,
	new Error('nested default heart cleanup'),
);
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	regular.slots.actions.querySelector('[data-post-like]')
		?.classList.contains('liked') &&
		regular.slots.actions.querySelector('.ldp-like-count')
			?.textContent === '3',
	'树状嵌套子回复默认爱心失败后必须回滚到 authoritative 回应状态',
);

const defaultReactionCallIndex = mutation.calls.length;
const defaultReactionTrigger = sourceView.slots.actions.querySelector<
	HTMLButtonElement
>(
	'[data-reaction-picker]',
)!;
assert(
	defaultReactionTrigger.dataset.reaction === 'heart' &&
		defaultReactionTrigger.matches(
			'.ldp-like[data-post-like][data-reaction-picker]',
		) &&
		!sourceView.slots.actions.querySelector('.ldp-reaction-add'),
	'无既有回应的默认入口必须直接复用 #1 主爱心并显式声明 heart，不能渲染无状态的空心添加按钮',
);
click(defaultReactionTrigger);
await Promise.resolve();
assert(
	mutation.calls.length === defaultReactionCallIndex + 1 &&
		String(mutation.calls[defaultReactionCallIndex]?.operation) ===
			'reaction-toggle' &&
		mutation.calls[defaultReactionCallIndex]?.variant === 'heart' &&
		sourceView.slots.actions.querySelector('[data-post-like]')
			?.classList.contains('liked') &&
		sourceView.slots.actions.querySelector('.ldp-like-count')
			?.textContent === '1',
	'普通楼层的添加回应入口点击必须直接乐观切换默认爱心，不能只打开表情列表',
);
mutation.reject(defaultReactionCallIndex, new Error('default heart cleanup'));
await new Promise((resolve) => setTimeout(resolve, 0));
assert(
	!sourceView.slots.actions.querySelector('[data-post-like]')
		?.classList.contains('liked') &&
		sourceView.slots.actions.querySelector('.ldp-like-count')
		?.textContent === '',
	'默认爱心请求失败后必须回滚所有 optimistic 投影',
);

messageBusHandlers.get('/client_settings')?.({
	name: 'discourse_reactions_enabled_reactions',
	value: 'heart|laughing|clap',
});
messageBusHandlers.get('/client_settings')?.({
	name: 'discourse_reactions_reaction_for_like',
	value: 'laughing',
});
openReactionPicker(regular.slots.actions);
assert(
	regular.slots.actions.querySelector<HTMLButtonElement>(
		'[data-post-like]',
	)?.dataset.reaction === 'laughing' &&
	regular.slots.actions.querySelector(
		'.ldp-reaction-picker [data-reaction="clap"]',
	) !== null &&
	siteSettings.discourse_reactions_reaction_for_like === 'laughing',
	'client_settings 必须更新原生 site-settings 并热重投普通、灯箱和主帖操作列共用 feature',
);
closeReactionPicker(regular.slots.actions);

lightbox.destroy();
regular.destroy();
ownView.destroy();
sourceView.destroy();
nativeLikeView.destroy();
feature.destroy();
sourceReactionSurface.destroy();
actions.destroy();
assert(
	!messageBusHandlers.has('/client_settings'),
	'Post action owner 销毁时必须解除唯一 client_settings MessageBus 订阅',
);
