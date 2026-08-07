import type {
	DiscourseNativeRelativeTimeFormatter,
	DiscourseNativeTopicPresentationPort,
} from '../discourse/native-host-api.js';
import type {
	DiscourseNativePostModelFactory,
} from '../discourse/native-post-model-factory.js';
import type { DiscourseIngestSource } from '../discourse/ingest-version.js';
import type { PostView } from '../dom/post-view.js';
import { htmlElement } from '../dom/html-element.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	valueRecord as record,
	type UnknownRecord,
} from '../kernel/value-record.js';
import type {
	DiscourseActionDescriptors,
} from '../post/discourse-action-descriptors.js';
import type {
	ActionCommand,
	PostActionController,
} from '../post/post-action-controller.js';
import type {
	CanonicalActionPost,
	PostActionFeatureCommands,
} from '../post/post-action-feature-commands.js';
import type { ReaderTopicPostFeature } from './reader-topic-dom-coordinator.js';
import type {
	DiscourseTopicPostInput,
	TopicSessionCommit,
} from './topic-session.js';
import type { Signal } from '../kernel/signal.js';

const EMPTY_RECORD: UnknownRecord = Object.freeze({});

export interface ReaderTopicSpecialContentSessionPort<TTopic, TPost> {
	readonly topic: TTopic | null;
	readonly changes: Signal<TopicSessionCommit>;
	cachedPosts(): readonly TPost[];
	postByNumber(postNumber: number): TPost | undefined;
	ingestPosts(
		posts: readonly TPost[],
		source: DiscourseIngestSource,
	): TopicSessionCommit;
}

export type ReaderPostVotingCommentsLoader = (
	postId: number,
	afterCommentId: number,
) => Promise<unknown>;

export interface ReaderSolvedAnswer {
	readonly postNumber: number;
	readonly username: string;
	readonly name: string;
	readonly avatarSource: string;
	readonly createdAt: string;
	readonly cooked: string;
	readonly excerpt: string;
}

export interface ReaderTopicSpecialContentFeatureOptions<
	TTopic,
	TPost extends CanonicalActionPost,
> {
	readonly document: Document;
	readonly session: ReaderTopicSpecialContentSessionPort<TTopic, TPost>;
	/** 使用主 DOM 的稳定提交信号，避免滚动中独立改写楼主正文高度。 */
	readonly presentationChanges?: Signal<TopicSessionCommit>;
	readonly presentation: DiscourseNativeTopicPresentationPort;
	readonly relativeTime: DiscourseNativeRelativeTimeFormatter;
	readonly navigate: (postNumber: number) => void | Promise<void>;
	readonly renderIcon?: (name: string, document: Document) => Node | null;
	readonly actions?: PostActionController;
	readonly commands?: PostActionFeatureCommands<TPost>;
	readonly descriptors?: DiscourseActionDescriptors;
	readonly models?: DiscourseNativePostModelFactory;
	readonly loadPostVotingComments?: ReaderPostVotingCommentsLoader;
	readonly onBodyLayerChanged?: (view: PostView) => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function text(value: unknown): string {
	return String(value ?? '').trim();
}

function postNumber(value: unknown): number | null {
	const numeric = Number(record(value)?.post_number ?? value);
	return Number.isSafeInteger(numeric) && numeric > 1 ? numeric : null;
}

function acceptedCandidates(
	topic: UnknownRecord,
	posts: readonly unknown[],
): readonly UnknownRecord[] {
	const byPostNumber = new Map<number, UnknownRecord>();
	const add = (value: unknown): void => {
		const number = postNumber(value);
		if (number === null) return;
		byPostNumber.set(number, Object.freeze({
			...(byPostNumber.get(number) ?? {}),
			...(record(value) ?? {}),
			post_number: number,
		}));
	};
	if (Array.isArray(topic.accepted_answers)) {
		for (const answer of topic.accepted_answers) add(answer);
	}
	add(topic.accepted_answer);
	for (const postValue of posts) {
		const post = record(postValue);
		if (post?.accepted_answer === true) add(post);
	}
	return Object.freeze([...byPostNumber.values()]
		.sort((left, right) =>
			Number(left.post_number) - Number(right.post_number)));
}

export function normalizeReaderSolvedAnswers(
	topicValue: unknown,
	posts: readonly unknown[],
	presentation: DiscourseNativeTopicPresentationPort,
): readonly ReaderSolvedAnswer[] {
	const topic = record(topicValue) ?? EMPTY_RECORD;
	const postsByNumber = new Map<number, UnknownRecord>();
	for (const postValue of posts) {
		const post = record(postValue);
		const number = Number(post?.post_number);
		if (post && Number.isSafeInteger(number) && number > 0) {
			postsByNumber.set(number, post);
		}
	}
	return Object.freeze(
		acceptedCandidates(topic, posts).map((candidate) => {
			const number = Number(candidate.post_number);
			const canonical = postsByNumber.get(number) ?? EMPTY_RECORD;
			const username = text(candidate.username ?? canonical.username);
			const name = text(
				candidate.name ??
				canonical.name ??
				username,
			) || '已解决回复';
			const avatarTemplate = text(
				candidate.avatar_template ??
				canonical.avatar_template,
			);
			return Object.freeze({
				postNumber: number,
				username,
				name,
				avatarSource: presentation.avatarSource(avatarTemplate, 32),
				createdAt: text(
					candidate.created_at ??
					canonical.created_at,
				),
				cooked: text(candidate.cooked ?? canonical.cooked),
				excerpt: text(candidate.excerpt ?? canonical.excerpt),
			});
		}),
	);
}

function specialBadges(post: UnknownRecord): readonly Readonly<{
	readonly label: string;
	readonly tone: string;
	readonly title: string;
	readonly icon: string;
}>[] {
	const badges: Array<Readonly<{
		label: string;
		tone: string;
		title: string;
		icon: string;
	}>> = [];
	const add = (
		label: string,
		tone = '',
		title = '',
		icon = '',
	): void => {
		badges.push(Object.freeze({ label, tone, title, icon }));
	};
	const postType = Number(post.post_type);
	if (postType === 4) add('私信回复');
	if (postType === 2) add('管理操作', 'warn');
	if (post.wiki === true) add('Wiki');
	if (post.hidden === true) add('已隐藏', 'warn');
	if (post.deleted_at) add('已删除', 'danger');
	if (post.locked === true) add('已锁定', 'warn');
	return Object.freeze(badges);
}

function postIdentityBadge(post: UnknownRecord): Readonly<{
	readonly label: string;
	readonly title: string;
	readonly icon: string;
}> | null {
	const username = text(post.username).toLocaleLowerCase();
	if (Number(post.post_type) === 3 || username === 'system') {
		return Object.freeze({
			label: '系统',
			title: '系统账户',
			icon: 'settings',
		});
	}
	if (post.moderator === true || post.group_moderator === true) {
		return Object.freeze({
			label: '版主',
			title: '版主',
			icon: 'shield-halved',
		});
	}
	const notice = record(post.notice);
	const noticeType = text(notice?.type);
	if (noticeType === 'new_user') {
		return Object.freeze({
			label: '新用户',
			title: '新用户，首次发帖',
			icon: 'user-plus',
		});
	}
	if (noticeType === 'returning_user') {
		return Object.freeze({
			label: '回归用户',
			title: '回归用户，久未发帖',
			icon: 'rotate-ccw',
		});
	}
	if (noticeType !== 'custom') return null;
	const source = `${text(notice?.raw)} ${text(notice?.cooked)}`;
	return /\bpremium\b/i.test(source)
		? Object.freeze({ label: 'Premium', title: 'Premium', icon: 'check' })
		: Object.freeze({ label: '富可敌国', title: '富可敌国', icon: 'tag' });
}

const SYSTEM_ACTION_LABELS = Object.freeze<Record<string, string>>({
	closed: '主题已关闭',
	opened: '主题已重新开放',
	archived: '主题已归档',
	unarchived: '主题已取消归档',
	pinned: '主题已置顶',
	unpinned: '主题已取消置顶',
	autoclosed: '主题已自动关闭',
	'autoclosed.enabled': '主题已自动关闭',
	'autoclosed.disabled': '主题已自动重新开放',
	split_topic: '帖子已拆分到新主题',
	merged: '主题已合并',
	moved: '帖子已移动',
	visible: '主题已公开',
	invisible: '主题已隐藏',
	'visible.enabled': '主题已公开',
	'visible.disabled': '主题已取消公开',
	renamed: '主题标题已修改',
	assigned: '已指定',
});

const SYSTEM_ACTION_ICONS = Object.freeze<Record<string, string>>({
	visible: 'check',
	invisible: 'eye-off',
	'visible.enabled': 'check',
	'visible.disabled': 'eye-off',
	assigned: 'user-plus',
});

/**
 * 已解决答案、特殊标记和站点 notice 的唯一 PostView feature。
 *
 * 插入内容只能进入 PostView.bodyLayer，因此始终留在正文锚点内，不能成为回复树 sibling，
 * 也不会改变 canonical 父子关系或让 branch SVG 把卡片当楼层。TopicSession 更新时只重投
 * 已挂载的 #1，不重新请求帖子或扫描页面 DOM。
 */
export class ReaderTopicSpecialContentFeature<
	TTopic,
	TPost extends DiscourseTopicPostInput & CanonicalActionPost,
> implements ReaderTopicPostFeature<TPost> {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #session: ReaderTopicSpecialContentSessionPort<TTopic, TPost>;
	readonly #presentation: DiscourseNativeTopicPresentationPort;
	readonly #relativeTime: DiscourseNativeRelativeTimeFormatter;
	readonly #navigate: (postNumber: number) => void | Promise<void>;
	readonly #renderIcon:
		((name: string, document: Document) => Node | null) | null;
	readonly #actions: PostActionController | null;
	readonly #commands: PostActionFeatureCommands<TPost> | null;
	readonly #descriptors: DiscourseActionDescriptors | null;
	readonly #models: DiscourseNativePostModelFactory | null;
	readonly #loadPostVotingComments: ReaderPostVotingCommentsLoader | null;
	readonly #onBodyLayerChanged: ((view: PostView) => void) | null;
	readonly #onError: (error: unknown) => void;
	readonly #boundViews = new WeakSet<PostView>();
	readonly #starterViews = new Set<PostView>();
	readonly #views = new Map<PostView, number>();
	readonly #expandedComments = new WeakSet<PostView>();
	readonly #pendingPostIds = new Map<number, number>();
	readonly #loadingCommentPostIds = new Set<number>();

	constructor(
		options: ReaderTopicSpecialContentFeatureOptions<TTopic, TPost>,
	) {
		this.#document = options.document;
		this.#session = options.session;
		this.#presentation = options.presentation;
		this.#relativeTime = options.relativeTime;
		this.#navigate = options.navigate;
		this.#renderIcon = options.renderIcon ?? null;
		this.#actions = options.actions ?? null;
		this.#commands = options.commands ?? null;
		this.#descriptors = options.descriptors ?? null;
		this.#models = options.models ?? null;
		this.#loadPostVotingComments = options.loadPostVotingComments ?? null;
		this.#onBodyLayerChanged = options.onBodyLayerChanged ?? null;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		(options.presentationChanges ?? this.#session.changes).subscribe(() => {
			for (const view of [...this.#starterViews]) {
				if (view.scope.destroyed) {
					this.#starterViews.delete(view);
					continue;
				}
				if (!this.#renderSolved(view)) continue;
				this.#notifyBodyLayerChanged(view);
			}
		}, this.scope);
		this.#actions?.events.subscribe((event) => {
			const postIds = event.presentation?.postIds ?? [];
			if (event.phase === 'pending') {
				for (const postId of postIds) {
					this.#pendingPostIds.set(
						postId,
						(this.#pendingPostIds.get(postId) ?? 0) + 1,
					);
				}
			} else if (event.phase === 'settled') {
				for (const postId of postIds) {
					const next = (this.#pendingPostIds.get(postId) ?? 1) - 1;
					if (next > 0) this.#pendingPostIds.set(postId, next);
					else this.#pendingPostIds.delete(postId);
				}
			} else {
				return;
			}
			this.#refreshInteractiveViews(new Set(postIds));
		}, this.scope);
		this.scope.add(() => {
			this.#starterViews.clear();
			this.#views.clear();
			this.#pendingPostIds.clear();
			this.#loadingCommentPostIds.clear();
		});
	}

	afterRender(postValue: TPost, view: PostView): void {
		const post = record(postValue) ?? EMPTY_RECORD;
		this.#views.set(view, Number(post.post_number));
		this.#bindView(view);
		this.#renderRootState(post, view);
		this.#renderSpecialBadges(post, view);
		this.#renderNotice(post, view);
		this.#renderSystemAction(post, view);
		this.#renderPostEvent(post, view);
		if (Number(post.post_number) === 1) {
			this.#starterViews.add(view);
			this.#renderSolved(view);
		}
		// 投票评论最后投影，保持其位于活动/已解决正文之后。
		this.#renderPostVoting(post, view);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#bindView(view: PostView): void {
		if (this.#boundViews.has(view)) return;
		this.#boundViews.add(view);
		view.scope.listen(view.slots.root, 'click', (event) => {
			this.#onClick(view, event);
		});
		view.scope.listen(view.slots.root, 'submit', (event) => {
			this.#onSubmit(view, event);
		});
		view.scope.add(() => {
			this.#starterViews.delete(view);
			this.#views.delete(view);
		});
	}

	#refreshInteractiveViews(postIds?: ReadonlySet<number>): void {
		for (const [view, number] of [...this.#views]) {
			if (view.scope.destroyed) {
				this.#views.delete(view);
				continue;
			}
			const post = this.#session.postByNumber(number);
			if (!post) continue;
			const postId = Number(post.id);
			if (postIds && !postIds.has(postId)) continue;
			const source = record(post) ?? EMPTY_RECORD;
			if (this.#renderInteractiveBody(source, view)) {
				this.#notifyBodyLayerChanged(view);
			}
		}
	}

	#currentPost(view: PostView): TPost | null {
		const number = this.#views.get(view) ?? view.postNumber;
		return this.#session.postByNumber(number) ?? null;
	}

	#onClick(view: PostView, event: Event): void {
		const target = event.target as Element | null;
		const solved = target?.closest<HTMLElement>(
			'[data-reader-solved-post-number]',
		);
		if (solved && view.slots.bodyLayer.contains(solved)) {
			const number = Number(solved.dataset.readerSolvedPostNumber);
			if (!Number.isSafeInteger(number) || number < 2) return;
			event.preventDefault();
			void new Promise<void>((resolve) => {
				resolve(this.#navigate(number));
			}).catch((error) => {
				if (!this.scope.destroyed && !view.scope.destroyed) {
					this.#onError(error);
				}
			});
			return;
		}
		const post = this.#currentPost(view);
		if (!post) return;
		const source = record(post) ?? EMPTY_RECORD;
		const postId = Number(source.id);
		if (!Number.isSafeInteger(postId) || postId < 1) return;
		const commentsToggle = target?.closest<HTMLElement>(
			'[data-pv-comments-toggle]',
		);
		if (commentsToggle) {
			event.preventDefault();
			if (this.#expandedComments.has(view)) {
				this.#expandedComments.delete(view);
			} else {
				this.#expandedComments.add(view);
			}
			this.#renderPostVoting(source, view);
			this.#notifyBodyLayerChanged(view);
			return;
		}
		const commentsMore = target?.closest<HTMLElement>(
			'[data-pv-comments-more]',
		);
		if (commentsMore) {
			event.preventDefault();
			void this.#loadMorePostVotingComments(post, view);
			return;
		}
		const vote = target?.closest<HTMLElement>('[data-pv-vote]');
		if (vote) {
			event.preventDefault();
			const direction = text(vote.dataset.pvVote);
			if (direction !== 'up' && direction !== 'down') return;
			const current = text(source.post_voting_user_voted_direction);
			void this.#runAction(() => {
				if (!this.#descriptors || !this.#commands) {
					throw new Error('Post Voting 动作端口尚未就绪');
				}
				const mutation = this.#descriptors.postVotingVote<TPost>({
					postId,
					direction,
					remove: current === direction,
				});
				return this.#commands.postVotingVote(postId, mutation);
			});
			return;
		}
		const commentVote = target?.closest<HTMLElement>(
			'[data-pv-comment-vote]',
		);
		if (commentVote) {
			event.preventDefault();
			const commentNode = commentVote.closest<HTMLElement>(
				'[data-pv-comment-id]',
			);
			const commentId = Number(commentNode?.dataset.pvCommentId);
			if (!Number.isSafeInteger(commentId) || commentId < 1) return;
			const comments = this.#postVotingComments(source);
			const comment = comments.find((entry) =>
				Number(entry.id) === commentId);
			void this.#runAction(() => {
				if (!this.#descriptors || !this.#commands) {
					throw new Error('Post Voting 评论动作端口尚未就绪');
				}
				const remove = comment?.user_voted === true;
				const mutation = this.#descriptors.postVotingCommentVote({
					commentId,
					remove,
				});
				return this.#commands.postVotingCommentVote(
					postId,
					commentId,
					remove,
					mutation,
				);
			});
			return;
		}
		const attendance = target?.closest<HTMLElement>(
			'[data-event-status]',
		);
		if (!attendance) return;
		event.preventDefault();
		const status = text(attendance.dataset.eventStatus);
		const eventData = record(source.event);
		const eventId = Number(eventData?.id) || postId;
		if (
			!eventData ||
			!Number.isSafeInteger(eventId) ||
			eventId < 1
		) return;
		void this.#runAction(() => {
			if (!this.#descriptors || !this.#commands || !this.#models) {
				throw new Error('Discourse 活动动作端口尚未就绪');
			}
			const invitee = record(eventData.watching_invitee);
			const eventModel = this.#models.createPostEvent(eventData, postId);
			const mutation = this.#descriptors.eventAttendance({
				eventId,
				event: eventModel,
				status,
				alreadyInvited: Number(invitee?.id) > 0,
			});
			return this.#commands.eventAttendance(postId, mutation);
		});
	}

	#onSubmit(view: PostView, event: Event): void {
		const form = (event.target as Element | null)?.closest<HTMLFormElement>(
			'.ldp-pv-comment-form',
		);
		if (!form || !view.slots.root.contains(form)) return;
		event.preventDefault();
		const post = this.#currentPost(view);
		const source = record(post);
		const postId = Number(source?.id);
		if (!post || !Number.isSafeInteger(postId) || postId < 1) return;
		const input = form.querySelector<HTMLInputElement>(
			'.ldp-pv-comment-input',
		);
		const raw = text(input?.value);
		if (!raw) return;
		void this.#runAction(() => {
			if (!this.#descriptors || !this.#commands) {
				throw new Error('Post Voting 评论动作端口尚未就绪');
			}
			const mutation = this.#descriptors.postVotingCommentCreate({
				postId,
				raw,
			});
			return this.#commands.postVotingCommentCreate(postId, mutation);
		}).then(() => {
			if (!this.scope.destroyed && !view.scope.destroyed && input) {
				input.value = '';
			}
		});
	}

	async #runAction<TOptimistic, TResult>(
		create: () => ActionCommand<TOptimistic, TResult>,
	): Promise<void> {
		try {
			if (!this.#actions) throw new Error('楼层动作控制器尚未就绪');
			await this.#actions.dispatch(create());
		} catch (error) {
			if (!this.scope.destroyed) this.#onError(error);
		}
	}

	async #loadMorePostVotingComments(
		post: TPost,
		view: PostView,
	): Promise<void> {
		const source = record(post) ?? EMPTY_RECORD;
		const postId = Number(source.id);
		if (
			!this.#loadPostVotingComments ||
			!Number.isSafeInteger(postId) ||
			postId < 1 ||
			this.#loadingCommentPostIds.has(postId)
		) return;
		const loaded = this.#postVotingComments(source);
		const afterCommentId = Number(loaded.at(-1)?.id) || 0;
		this.#loadingCommentPostIds.add(postId);
		this.#renderPostVoting(source, view);
		this.#notifyBodyLayerChanged(view);
		try {
			const payload = await this.#loadPostVotingComments(
				postId,
				afterCommentId,
			);
			const payloadRecord = record(payload);
			const incomingSource = Array.isArray(payload)
				? payload
				: Array.isArray(payloadRecord?.comments)
					? payloadRecord.comments
					: [];
			const merged = new Map<number, UnknownRecord>();
			for (const comment of [...loaded, ...incomingSource]) {
				const candidate = record(comment);
				const id = Number(candidate?.id);
				if (candidate && Number.isSafeInteger(id) && id > 0) {
					merged.set(id, Object.freeze({ ...candidate }));
				}
			}
			this.#session.ingestPosts([
				{
					...source,
					post_voting_comments: Object.freeze([...merged.values()]),
				} as unknown as TPost,
			], 'action-response');
		} catch (error) {
			if (!this.scope.destroyed && !view.scope.destroyed) {
				this.#onError(error);
			}
		} finally {
			this.#loadingCommentPostIds.delete(postId);
			const current = this.#session.postByNumber(Number(source.post_number));
			if (current && !view.scope.destroyed) {
				this.#renderPostVoting(record(current) ?? EMPTY_RECORD, view);
				this.#notifyBodyLayerChanged(view);
			}
		}
	}

	#renderInteractiveBody(post: UnknownRecord, view: PostView): boolean {
		const selector =
			':scope > :is(.ldp-pv-votes,.ldp-pv-comments,.ldp-event-card)';
		const hadInteractiveBody = Boolean(
			view.slots.bodyLayer.querySelector(selector),
		);
		this.#renderPostEvent(post, view);
		this.#renderPostVoting(post, view);
		return hadInteractiveBody || Boolean(
			view.slots.bodyLayer.querySelector(selector),
		);
	}

	#notifyBodyLayerChanged(view: PostView): void {
		if (this.scope.destroyed || view.scope.destroyed) return;
		try {
			this.#onBodyLayerChanged?.(view);
		} catch (error) {
			this.#onError(error);
		}
	}

	#postVotingComments(post: UnknownRecord): readonly UnknownRecord[] {
		const source = Array.isArray(post.post_voting_comments)
			? post.post_voting_comments
			: Array.isArray(post.comments)
				? post.comments
				: [];
		return Object.freeze(source
			.map((value) => record(value))
			.filter((value): value is UnknownRecord => value !== null));
	}

	#renderSolved(view: PostView): boolean {
		if (view.scope.destroyed) return false;
		const answers = normalizeReaderSolvedAnswers(
			this.#session.topic,
			this.#session.cachedPosts(),
			this.#presentation,
		);
		const previous = view.slots.bodyLayer.querySelector<HTMLElement>(
			':scope > .ldp-solved-card',
		);
		if (!answers.length) {
			previous?.remove();
			return previous !== null;
		}

		const card = htmlElement(this.#document, 'section', 'ldp-solved-card');
		const heading = htmlElement(this.#document, 'div', 'ldp-solved-head');
		const icon = this.#icon('check');
		if (icon) heading.append(icon);
		const headingLabel = answers.length > 1
			? `✓ 已解决 · ${answers.length} 个答案`
			: '✓ 已解决';
		const headingText = htmlElement(
			this.#document,
			'span',
			'ldp-solved-label',
			icon ? headingLabel.replace(/^✓\s*/, '') : headingLabel,
		);
		heading.append(headingText);
		card.append(heading);
		for (const answer of answers) {
			card.append(this.#answerNode(answer));
		}
		if (previous?.isEqualNode(card)) return false;
		if (previous) previous.replaceWith(card);
		else view.slots.bodyLayer.append(card);
		return true;
	}

	#answerNode(answer: ReaderSolvedAnswer): HTMLElement {
		const body = htmlElement(this.#document, 'div', 'ldp-solved-body');
		body.dataset.solvedPostNumber = String(answer.postNumber);
		const authorRow = htmlElement(
			this.#document,
			'div',
			'ldp-solved-author-row',
		);
		const profileHref = this.#presentation.userHref(answer.username);
		if (answer.avatarSource) {
			const avatarLink = this.#document.createElement(
				profileHref ? 'a' : 'span',
			);
			avatarLink.className = 'ldp-user-link';
			if (profileHref) avatarLink.setAttribute('href', profileHref);
			if (answer.username) avatarLink.dataset.userCard = answer.username;
			const avatar = htmlElement(this.#document, 'img', 'ldp-solved-avatar');
			avatar.src = answer.avatarSource;
			avatar.alt = '';
			avatar.loading = 'lazy';
			avatar.decoding = 'async';
			avatarLink.append(avatar);
			authorRow.append(avatarLink);
		}
		const author = this.#document.createElement(
			profileHref ? 'a' : 'span',
		);
		author.className = 'ldp-user-link ldp-solved-author';
		author.textContent = answer.name;
		if (profileHref) author.setAttribute('href', profileHref);
		if (answer.username) author.dataset.userCard = answer.username;
		authorRow.append(author);
		if (answer.username) {
			const username = htmlElement(
				this.#document,
				'span',
				'ldp-solved-username',
				`@${answer.username}`,
			);
			authorRow.append(username);
		}
		const relative = answer.createdAt
			? this.#relativeTime(answer.createdAt)
			: '';
		if (relative) {
			const time = htmlElement(this.#document, 'span', '', `· ${relative}`);
			authorRow.append(time);
		}
		const floor = htmlElement(
			this.#document,
			'button',
			'ldp-solved-floor ldp-jump-self',
			`#${answer.postNumber}`,
		);
		floor.type = 'button';
		floor.dataset.readerSolvedPostNumber = String(answer.postNumber);
		floor.setAttribute('aria-label', `跳到楼层 #${answer.postNumber}`);
		authorRow.append(floor);
		body.append(authorRow);

		const excerpt = htmlElement(
			this.#document,
			'div',
			'ldp-solved-excerpt ldp-content cooked',
		);
		if (answer.cooked) excerpt.innerHTML = answer.cooked;
		else excerpt.textContent = answer.excerpt || '查看被采纳的完整回复。';
		body.append(excerpt);
		const jump = htmlElement(
			this.#document,
			'button',
			'ldp-solved-jump ldp-jump-self',
			'阅读更多',
		);
		jump.type = 'button';
		jump.dataset.readerSolvedPostNumber = String(answer.postNumber);
		body.append(jump);
		return body;
	}

	#renderPostVoting(post: UnknownRecord, view: PostView): void {
		view.slots.bodyLayer
			.querySelector(':scope > .ldp-pv-votes')
			?.remove();
		view.slots.bodyLayer
			.querySelector(':scope > .ldp-pv-comments')
			?.remove();
		const topic = record(this.#session.topic) ?? EMPTY_RECORD;
		const enabled = topic.is_post_voting === true;
		const isAnswer = enabled && Number(post.post_number) !== 1;
		view.slots.root.classList.toggle('ldp-post-voting-answer', isAnswer);
		if (!isAnswer) return;
		const postId = Number(post.id);
		const pending = this.#pendingPostIds.has(postId);
		const votes = htmlElement(this.#document, 'div', 'ldp-pv-votes');
		const direction = text(post.post_voting_user_voted_direction);
		for (const [value, label, iconName] of [
			['up', '赞同', 'chevron-up'],
			['down', '反对', 'chevron-down'],
		] as const) {
			const button = this.#document.createElement('button');
			button.type = 'button';
			button.className = `ldp-pv-vote${direction === value ? ' on' : ''}`;
			button.dataset.pvVote = value;
			button.setAttribute('aria-label', label);
			button.disabled = pending || !this.#actions;
			const icon = this.#icon(iconName);
			if (icon) button.append(icon);
			else button.textContent = value === 'up' ? '↑' : '↓';
			votes.append(button);
			if (value === 'up') {
				const score = htmlElement(
					this.#document,
					'span',
					'ldp-pv-score',
					String(Math.max(0, Number(post.post_voting_vote_count) || 0)),
				);
				votes.append(score);
			}
		}
		view.slots.bodyLayer.prepend(votes);

		const comments = this.#postVotingComments(post);
		const count = Math.max(
			0,
			Number(post.comments_count) || comments.length,
		);
		const host = htmlElement(this.#document, 'section', 'ldp-pv-comments');
		const toggle = htmlElement(
			this.#document,
			'button',
			'ldp-pv-comments-toggle',
		);
		toggle.type = 'button';
		toggle.dataset.pvCommentsToggle = '';
		const expanded = this.#expandedComments.has(view);
		toggle.setAttribute('aria-expanded', String(expanded));
		toggle.setAttribute(
			'aria-label',
			expanded ? '收起评论' : '展开评论',
		);
		const toggleIcon = this.#icon('message-square');
		if (toggleIcon) toggle.append(toggleIcon);
		const toggleCount = htmlElement(this.#document, 'span', '', String(count));
		toggle.append(toggleCount);
		host.append(toggle);
		const body = htmlElement(this.#document, 'div', 'ldp-pv-comments-body');
		body.hidden = !expanded;
		for (const comment of comments) {
			body.append(this.#postVotingCommentNode(comment, pending));
		}
		if (comments.length < count && this.#loadPostVotingComments) {
			const more = htmlElement(
				this.#document,
				'button',
				'ldp-pv-comments-more',
			);
			more.type = 'button';
			more.dataset.pvCommentsMore = '';
			more.disabled = this.#loadingCommentPostIds.has(postId);
			more.textContent = more.disabled ? '正在加载…' : '加载更多评论';
			body.append(more);
		}
		if (this.#models?.currentUser()) {
			const form = htmlElement(this.#document, 'form', 'ldp-pv-comment-form');
			const input = htmlElement(this.#document, 'input', 'ldp-pv-comment-input');
			input.name = 'raw';
			input.autocomplete = 'off';
			input.placeholder = '写评论…';
			input.required = true;
			input.disabled = pending;
			const submit = htmlElement(
				this.#document,
				'button',
				'ldp-pv-comment-submit',
				'发送',
			);
			submit.type = 'submit';
			submit.disabled = pending;
			form.append(input, submit);
			body.append(form);
		}
		host.append(body);
		view.slots.bodyLayer.append(host);
	}

	#postVotingCommentNode(
		comment: UnknownRecord,
		pending: boolean,
	): HTMLElement {
		const user = record(comment.user) ?? EMPTY_RECORD;
		const username = text(comment.username ?? user.username);
		const name = text(comment.name ?? user.name ?? username) || '用户';
		const node = htmlElement(this.#document, 'article', 'ldp-pv-comment');
		const commentId = Number(comment.id);
		if (Number.isSafeInteger(commentId) && commentId > 0) {
			node.dataset.pvCommentId = String(commentId);
		}
		const avatarTemplate = text(
			user.avatar_template ?? comment.avatar_template,
		);
		const avatarSource = this.#presentation.avatarSource(avatarTemplate, 28);
		const avatarHost = this.#document.createElement(
			username ? 'a' : 'span',
		);
		avatarHost.className = 'ldp-user-link';
		if (username) {
			avatarHost.dataset.userCard = username;
			const href = this.#presentation.userHref(username);
			if (href) avatarHost.setAttribute('href', href);
		}
		if (avatarSource) {
			const avatar = htmlElement(
				this.#document,
				'img',
				'ldp-pv-comment-avatar',
			);
			avatar.src = avatarSource;
			avatar.alt = '';
			avatar.loading = 'lazy';
			avatar.decoding = 'async';
			avatarHost.append(avatar);
		}
		node.append(avatarHost);
		const content = htmlElement(this.#document, 'div', 'ldp-pv-comment-body');
		const meta = htmlElement(
			this.#document,
			'div',
			'ldp-pv-comment-meta',
			[
				name,
				username ? `@${username}` : '',
				text(comment.created_at)
					? this.#relativeTime(text(comment.created_at))
					: '',
			].filter(Boolean).join(' · '),
		);
		const cooked = htmlElement(this.#document, 'div', 'ldp-content cooked');
		const cookedValue = text(comment.cooked);
		if (cookedValue) cooked.innerHTML = cookedValue;
		else cooked.textContent = text(comment.raw);
		content.append(meta, cooked);
		node.append(content);
		const vote = this.#document.createElement('button');
		vote.type = 'button';
		vote.className = `ldp-pv-comment-vote${
			comment.user_voted === true ? ' on' : ''
		}`;
		vote.dataset.pvCommentVote = '';
		vote.setAttribute('aria-label', '赞同评论');
		vote.disabled = pending || !this.#actions ||
			!Number.isSafeInteger(commentId) || commentId < 1;
		const icon = this.#icon('chevron-up');
		if (icon) vote.append(icon);
		const count = htmlElement(
			this.#document,
			'span',
			'',
			String(Math.max(0, Number(comment.post_voting_vote_count) || 0)),
		);
		vote.append(count);
		node.append(vote);
		return node;
	}

	#renderPostEvent(post: UnknownRecord, view: PostView): void {
		view.slots.bodyLayer
			.querySelector(':scope > .ldp-event-card')
			?.remove();
		const event = record(post.event);
		if (!event) return;
		const postId = Number(post.id);
		const pending = this.#pendingPostIds.has(postId);
		const card = htmlElement(this.#document, 'section', 'ldp-event-card');
		const title = htmlElement(
			this.#document,
			'h3',
			'ldp-event-title',
			text(event.name) || '活动',
		);
		card.append(title);
		const grid = htmlElement(this.#document, 'div', 'ldp-event-grid');
		const dateLabel = this.#eventDateLabel(event);
		if (dateLabel) {
			const date = this.#document.createElement('div');
			const strong = htmlElement(this.#document, 'b', '', dateLabel);
			date.append(strong);
			const timezone = text(event.timezone);
			if (timezone) {
				const zone = htmlElement(
					this.#document,
					'span',
					'ldp-event-meta',
					` ${timezone}`,
				);
				date.append(zone);
			}
			grid.append(date);
		}
		const locationRecord = record(event.location);
		const location = typeof event.location === 'string'
			? text(event.location)
			: text(
				locationRecord?.name ??
				locationRecord?.address ??
				locationRecord?.display,
			);
		if (location) {
			const place = htmlElement(
				this.#document,
				'div',
				'',
				`地点：${location}`,
			);
			grid.append(place);
		}
		const description = text(event.description_html);
		if (description) {
			const detail = htmlElement(this.#document, 'div', 'cooked');
			detail.innerHTML = description;
			grid.append(detail);
		}
		const stats = record(event.stats) ?? EMPTY_RECORD;
		const statsNode = htmlElement(this.#document, 'div', 'ldp-event-meta');
		const going = Math.max(0, Number(stats.going) || 0);
		const interested = Math.max(0, Number(stats.interested) || 0);
		const maxAttendees = Math.max(0, Number(event.max_attendees) || 0);
		statsNode.textContent = [
			`参加 ${going}`,
			`感兴趣 ${interested}`,
			maxAttendees ? `名额 ${going}/${maxAttendees}` : '',
			event.is_ongoing === true ? '进行中' : '',
			event.is_expired === true ? '已结束' : '',
		].filter(Boolean).join(' · ');
		grid.append(statsNode);
		card.append(grid);
		const actions = htmlElement(this.#document, 'div', 'ldp-event-actions');
		const watching = record(event.watching_invitee) ?? EMPTY_RECORD;
		const currentStatus = text(watching.status);
		const closed = event.is_closed === true ||
			event.is_expired === true ||
			event.can_update_attendance === false;
		for (const [status, label] of [
			['going', '参加'],
			['interested', '感兴趣'],
			['not_going', '不参加'],
		] as const) {
			const button = htmlElement(
				this.#document,
				'button',
				`ldp-event-action${currentStatus === status ? ' on' : ''}`,
				label,
			);
			button.type = 'button';
			button.dataset.eventStatus = status;
			button.disabled = closed || pending || !this.#actions || !this.#models;
			actions.append(button);
		}
		const calendarUrl = text(event.ics_url ?? event.calendar_url);
		if (/^(?:https?:\/\/|\/)/i.test(calendarUrl)) {
			const calendar = htmlElement(
				this.#document,
				'a',
				'ldp-event-ics',
				'下载日历',
			);
			calendar.href = calendarUrl;
			calendar.download = '';
			actions.append(calendar);
		}
		card.append(actions);
		view.slots.bodyLayer.append(card);
	}

	#eventDateLabel(event: UnknownRecord): string {
		const options: Intl.DateTimeFormatOptions = {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			...(event.all_day === true
				? {}
				: { hour: '2-digit', minute: '2-digit' }),
		};
		const format = (value: unknown): string => {
			const date = new Date(text(value));
			return Number.isFinite(date.getTime())
				? date.toLocaleString('zh-CN', options)
				: '';
		};
		return [format(event.starts_at), format(event.ends_at)]
			.filter(Boolean)
			.join(' — ');
	}

	#icon(name: string): Node {
		return renderReaderIcon(this.#document, name, this.#renderIcon);
	}

	#renderRootState(post: UnknownRecord, view: PostView): void {
		const postType = Number(post.post_type);
		const actionCode = text(post.action_code);
		view.slots.root.classList.toggle('ldp-whisper', postType === 4);
		view.slots.root.classList.toggle(
			'ldp-system-post',
			postType === 2 || postType === 3,
		);
		view.slots.root.classList.toggle(
			'ldp-system-action-compact',
			(postType === 2 || postType === 3) &&
				actionCode === 'assigned',
		);
		this.#renderIdentityBadge(post, view);
	}

	#renderIdentityBadge(post: UnknownRecord, view: PostView): void {
		view.slots.header
			.querySelector(':scope > .ldp-new-user-badge')
			?.remove();
		const noticeType = text(record(post.notice)?.type);
		view.slots.root.classList.toggle(
			'ldp-new-user',
			noticeType === 'new_user',
		);
		const identity = postIdentityBadge(post);
		if (!identity) return;
		const badge = htmlElement(
			this.#document,
			'span',
			'ldp-new-user-badge',
		);
		badge.title = identity.title;
		badge.setAttribute('role', 'img');
		badge.setAttribute('aria-label', identity.title);
		badge.append(
			this.#icon(identity.icon),
			htmlElement(this.#document, 'span', '', identity.label),
		);
		const username = view.slots.header.querySelector(':scope > .ldp-user');
		if (username) username.after(badge);
		else view.slots.header.append(badge);
	}

	#renderSpecialBadges(post: UnknownRecord, view: PostView): void {
		view.slots.bodyLayer
			.querySelector(':scope > .ldp-special-badges')
			?.remove();
		const badges = specialBadges(post);
		if (!badges.length) return;
		const host = htmlElement(this.#document, 'div', 'ldp-special-badges');
		for (const badge of badges) {
			const node = this.#document.createElement('span');
			node.className = `ldp-special-badge ${badge.tone}`.trim();
			if (badge.title) node.title = badge.title;
			if (badge.icon) node.append(this.#icon(badge.icon));
			const label = htmlElement(this.#document, 'span', '', badge.label);
			node.append(label);
			host.append(node);
		}
		view.slots.bodyLayer.prepend(host);
	}

	#renderNotice(post: UnknownRecord, view: PostView): void {
		view.slots.bodyLayer
			.querySelector(':scope > .ldp-special-notice')
			?.remove();
		const notice = record(post.notice);
		const noticeType = text(notice?.type);
		if (['new_user', 'returning_user', 'custom'].includes(noticeType)) {
			return;
		}
		const label = typeof post.notice === 'string'
			? text(post.notice)
			: text(notice?.text ?? noticeType);
		if (!label) return;
		const node = htmlElement(
			this.#document,
			'div',
			'ldp-special-notice',
			label,
		);
		view.slots.bodyLayer.prepend(node);
	}

	#renderSystemAction(post: UnknownRecord, view: PostView): void {
		view.slots.bodyLayer
			.querySelector(':scope > .ldp-system-action')
			?.remove();
		const postType = Number(post.post_type);
		const actionCode = text(post.action_code);
		if ((postType !== 2 && postType !== 3) || !actionCode) return;
		const node = htmlElement(this.#document, 'div', 'ldp-system-action');
		node.append(this.#icon(
			SYSTEM_ACTION_ICONS[actionCode] ?? 'settings',
		));
		const label =
			SYSTEM_ACTION_LABELS[actionCode] ??
			`系统操作：${actionCode.replace(/[._]/g, ' ')}`;
		const content = this.#document.createElement('span');
		content.append(this.#document.createTextNode(label));
		if (actionCode === 'assigned') {
			const who = record(post.action_code_who);
			const username = text(who?.username ?? post.action_code_who)
				.replace(/^@/, '');
			if (username) {
				content.append(this.#document.createTextNode('给 '));
				const user = htmlElement(
					this.#document,
					'a',
					'ldp-user-link ldp-system-action-user',
					`@${username}`,
				);
				user.dataset.userCard = username;
				const href = this.#presentation.userHref(username);
				if (href) user.href = href;
				content.append(user);
			}
		}
		node.append(content);
		view.slots.bodyLayer.prepend(node);
	}
}
