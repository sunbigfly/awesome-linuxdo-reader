import type {
	DiscourseComposerPostInput,
	DiscourseComposerReplyPort,
	DiscourseComposerTopicInput,
} from '../discourse/native-composer.js';
import type { PostView, PostViewIdentity } from '../dom/post-view.js';
import type { ReplyTreeRepository } from '../dom/reply-tree-repository.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { ReaderTopicPostFeature } from '../topic/reader-topic-dom-coordinator.js';
import type { ReaderPostViewProjector } from '../topic/reader-post-view-projector.js';
import type {
	ReaderPostReactionSurface,
	ReaderPostReactionSurfacePort,
} from '../post/reader-post-action-feature.js';
import {
	ReaderLightboxCommentController,
	type ReaderLightboxCommentTopicPort,
} from './reader-lightbox-comment-controller.js';
import {
	ReaderLightboxCommentView,
} from './reader-lightbox-comment-view.js';
import {
	ReaderLightboxCookedCommentMatcher,
	type ReaderLightboxCommentMatcher,
	type ReaderLightboxCommentPostInput,
} from './reader-lightbox-comment-model.js';
import {
	ReaderLightboxController,
	type ReaderLightboxItem,
} from './reader-lightbox-controller.js';
import {
	ReaderLightboxBatchController,
} from './reader-lightbox-batch-controller.js';
import {
	ReaderLightboxBatchView,
} from './reader-lightbox-batch-view.js';
import {
	readerLightboxImageQuoteRaw,
} from './reader-lightbox-image-quote.js';
import { ReaderLightboxCommentForm } from './reader-lightbox-comment-form.js';
import {
	readerLightboxSourceDescription,
} from './reader-lightbox-source-description.js';
import type {
	ReaderTopicImageCatalogPort,
} from './reader-topic-image-index.js';
import type {
	ReaderImageDownloadService,
} from './reader-image-download-service.js';
import type {
	ReaderImageResourceService,
} from './reader-image-resource-service.js';
import type {
	ReaderImageTransformFrameScheduler,
} from './reader-image-transform-controller.js';
import {
	ReaderLightboxView,
	type ReaderLightboxOriginalSourcePort,
} from './reader-lightbox-view.js';
import type {
	ReaderLightboxGeometryPreferences,
} from './reader-lightbox-geometry-controller.js';
import {
	LIGHTBOX_COMMENTS_WIDTH_DEFAULT,
	LIGHTBOX_DESCRIPTION_HEIGHT_DEFAULT,
} from '../state/reader-preferences-schema.js';

export interface ReaderLightboxFeatureOpenOptions {
	readonly items: readonly ReaderLightboxItem[];
	readonly initialIndex?: number;
	readonly returnFocus?: HTMLElement;
	readonly commentsExpanded?: boolean;
	readonly descriptionExpanded?: boolean;
	readonly commentsEnabled?: boolean;
	readonly includeTopicImages?: boolean;
	readonly batchEnabled?: boolean;
}

export interface ReaderLightboxDefaultSettings
	extends ReaderLightboxGeometryPreferences {
	readonly originalByDefault: boolean;
	readonly commentsExpanded: boolean;
	readonly descriptionExpanded: boolean;
}

export interface ReaderLightboxPreferencesPort {
	read(): Readonly<Partial<ReaderLightboxDefaultSettings>>;
	update(
		patch: Partial<ReaderLightboxDefaultSettings>,
	): void | Promise<void>;
}

export interface ReaderLightboxCommentSubmitInput<TTopic, TPost> {
	readonly topic: TTopic;
	readonly targetPost: TPost;
	readonly raw: string;
}

export interface ReaderLightboxFeatureOptions<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ReaderLightboxCommentPostInput & DiscourseComposerPostInput,
> {
	readonly document: Document;
	readonly mount: HTMLElement;
	readonly topic: () => TTopic;
	readonly session: ReaderLightboxCommentTopicPort<TPost>;
	readonly replies: ReplyTreeRepository;
	readonly composer: DiscourseComposerReplyPort<TTopic, TPost>;
	readonly identity: (post: TPost) => PostViewIdentity;
	readonly renderPost: (post: TPost, view: PostView) => void;
	readonly postFeatures?: readonly ReaderTopicPostFeature<TPost>[];
	readonly reactionSurfaces?: ReaderPostReactionSurfacePort<TPost>;
	readonly postProjector?: ReaderPostViewProjector<TPost>;
	readonly matcher?: ReaderLightboxCommentMatcher<TPost>;
	readonly originalSources?: ReaderLightboxOriginalSourcePort;
	readonly imageResources?: ReaderImageResourceService;
	readonly imageDownloads?: ReaderImageDownloadService;
	readonly topicImages?: ReaderTopicImageCatalogPort;
	readonly confirmOriginalDownload?: (
		missing: number,
		total: number,
	) => boolean | Promise<boolean>;
	readonly notify?: (message: string) => void;
	readonly originalByDefault?: boolean;
	readonly commentsExpandedByDefault?: boolean;
	readonly descriptionExpandedByDefault?: boolean;
	readonly readDefaults?: () =>
		Readonly<Partial<ReaderLightboxDefaultSettings>>;
	readonly preferences?: ReaderLightboxPreferencesPort;
	readonly commentsEnabled?: boolean;
	readonly minimumCommentLength?: () => number;
	readonly submitComment?: (
		input: ReaderLightboxCommentSubmitInput<TTopic, TPost>,
	) => Promise<TPost>;
	readonly frameScheduler?: ReaderImageTransformFrameScheduler;
	readonly onBoundary?: (
		direction: -1 | 1,
		item: ReaderLightboxItem,
	) => boolean | Promise<boolean>;
	readonly onJumpToPost?: (item: ReaderLightboxItem) => void | Promise<void>;
	readonly onDownload?: (item: ReaderLightboxItem) => void | Promise<void>;
	readonly onClose?: () => void;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

export interface ReaderLightboxFeatureSession<
	TPost extends ReaderLightboxCommentPostInput,
> {
	readonly sequence: ReaderLightboxController;
	readonly view: ReaderLightboxView;
	readonly comments: ReaderLightboxCommentController<TPost>;
	readonly commentView: ReaderLightboxCommentView<TPost>;
	readonly commentForm: ReaderLightboxCommentForm<TPost>;
	readonly batch: ReaderLightboxBatchController | null;
	readonly batchView: ReaderLightboxBatchView | null;
}

/**
 * Lightbox 业务唯一组合层。
 *
 * 它只装配既有 owner，不保存第二份序列、post、树、资源缓存或请求状态。切图只切换评论
 * projection；新增评论只生成 quote 并打开共用原生 composer。
 */
export class ReaderLightboxFeature<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends ReaderLightboxCommentPostInput & DiscourseComposerPostInput,
> {
	readonly scope: LifecycleScope;
	readonly #options: ReaderLightboxFeatureOptions<TTopic, TPost>;
	readonly #matcher: ReaderLightboxCommentMatcher<TPost>;
	readonly #onError: (error: unknown) => void;
	#activeScope: LifecycleScope | null = null;
	#active: ReaderLightboxFeatureSession<TPost> | null = null;

	constructor(options: ReaderLightboxFeatureOptions<TTopic, TPost>) {
		this.#options = options;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#matcher = options.matcher ??
			new ReaderLightboxCookedCommentMatcher<TPost>(options.document);
		this.scope.add(() => this.#releaseActive(false));
	}

	get active(): ReaderLightboxFeatureSession<TPost> | null {
		return this.#active;
	}

	open(options: ReaderLightboxFeatureOpenOptions): ReaderLightboxFeatureSession<TPost> {
		this.#assertActive();
		this.#releaseActive(false);
		const localScope = this.scope.child();
		this.#activeScope = localScope;
		const commentsEnabled =
			options.commentsEnabled ??
			this.#options.commentsEnabled !== false;
		const includeTopicImages = options.includeTopicImages !== false;
		const batchEnabled = options.batchEnabled !== false;
		const initialItems = includeTopicImages && this.#options.topicImages
			? [...options.items, ...this.#options.topicImages.snapshot().items]
			: options.items;
		const defaults = this.#defaults();
		const mobileLayout =
			this.#options.document.defaultView?.matchMedia?.(
				'(max-width: 760px)',
			).matches === true;
		const initialPostNumbers = initialItems.map((item) =>
			Number(item.sourcePostNumber));
		const boundaryCursor: Record<-1 | 1, number> = {
			[-1]: Math.min(...initialPostNumbers),
			[1]: Math.max(...initialPostNumbers),
		};
		const sequence = new ReaderLightboxController({
			items: initialItems,
			...(options.initialIndex === undefined
				? {}
				: { initialIndex: options.initialIndex }),
			commentsExpanded:
				options.commentsExpanded ??
					(mobileLayout ? false : defaults.commentsExpanded),
			descriptionExpanded:
				options.descriptionExpanded ?? defaults.descriptionExpanded,
			parentScope: localScope,
			onError: this.#onError,
		});
		let comments: ReaderLightboxCommentController<TPost>;
		let commentView: ReaderLightboxCommentView<TPost>;
		let commentForm: ReaderLightboxCommentForm<TPost>;
		let batch: ReaderLightboxBatchController | null = null;
		let batchView: ReaderLightboxBatchView | null = null;
		const view = new ReaderLightboxView({
			document: this.#options.document,
			mount: this.#options.mount,
			controller: sequence,
			...(options.returnFocus ? { returnFocus: options.returnFocus } : {}),
			...(this.#options.imageResources || this.#options.originalSources
				? {
					originalSources:
						this.#options.imageResources ?? this.#options.originalSources!,
				}
				: {}),
			originalByDefault: defaults.originalByDefault,
			commentsEnabled,
			geometryPreferences: {
				lightboxDescriptionHeight:
					defaults.lightboxDescriptionHeight,
				lightboxCommentsWidthPercent:
					defaults.lightboxCommentsWidthPercent,
			},
			...(this.#options.preferences
				? {
					persistGeometryPreferences: (patch) =>
						this.#options.preferences!.update(patch),
					onDescriptionExpandedChange: (descriptionExpanded: boolean) =>
						this.#options.preferences!.update({ descriptionExpanded }),
				}
				: {}),
			...(this.#options.frameScheduler
				? { frameScheduler: this.#options.frameScheduler }
				: {}),
			...((
				includeTopicImages && this.#options.topicImages
			) || this.#options.onBoundary
				? {
					onBoundary: (
						direction: -1 | 1,
						item: ReaderLightboxItem,
					) => this.#loadBoundary(
						sequence,
						direction,
						item,
						includeTopicImages,
						boundaryCursor,
					),
				}
				: {}),
			...(includeTopicImages && this.#options.onJumpToPost
				? { onJumpToPost: this.#options.onJumpToPost }
				: {}),
			...(this.#options.onDownload
				? { onDownload: this.#options.onDownload }
				: this.#options.imageDownloads
					? {
						onDownload: async (item: ReaderLightboxItem, index: number) => {
							try {
								const missing = await this.#options.imageDownloads!
									.missingOriginalCount([item]);
								const original = missing > 0
									? await this.#confirmOriginal(missing, 1)
									: true;
								await this.#options.imageDownloads!.download(
									item,
									index,
									{ original },
								);
							} catch (cause) {
								this.#options.notify?.(
									`图片下载失败：${cause instanceof Error ? cause.message : '请重试'}`,
								);
								throw cause;
							}
						},
					}
					: {}),
			...(batchEnabled && this.#options.imageDownloads
				? { onBatchDownload: () => batchView?.open() }
				: {}),
			deferEscape: () => batch?.snapshot().open === true,
			onAddComment: (item) => this.#openImageCommentForm(
				item,
				comments,
				commentForm,
			),
			onClose: () => this.#releaseActive(true),
			parentScope: localScope,
			onError: this.#onError,
		});
		comments = new ReaderLightboxCommentController({
			session: this.#options.session,
			replies: this.#options.replies,
			matcher: this.#matcher,
			image: sequence.snapshot().current,
			parentScope: localScope,
			onError: this.#onError,
		});
		let commentFocusFrame: number | null = null;
		localScope.add(() => {
			if (commentFocusFrame === null) return;
			this.#options.document.defaultView?.cancelAnimationFrame(
				commentFocusFrame,
			);
			commentFocusFrame = null;
		});
		commentForm = new ReaderLightboxCommentForm({
			slots: view.slots.commentForm,
			minimumLength: this.#minimumCommentLength(),
			submit: async ({ targetPost, message, includeImage }) => {
				const item = sequence.snapshot().current;
				const sourcePost = comments.snapshot().sourcePost;
				const quote = includeImage
					? readerLightboxImageQuoteRaw({
						image: item,
						username: String(sourcePost?.username ?? '').trim(),
						alt: item.alt,
					})
					: '';
				const raw = `${quote}${message}`;
				if (this.#options.submitComment) {
					await this.#options.submitComment({
						topic: this.#options.topic(),
						targetPost,
						raw,
					});
					return;
				}
				await this.#options.composer.openReply({
					topic: this.#options.topic(),
					post: targetPost,
					initialRaw: raw,
				});
			},
			reveal: () => sequence.setCommentsExpanded(true),
			focus: (input) => {
				const currentWindow = this.#options.document.defaultView;
				if (!currentWindow?.requestAnimationFrame) {
					input.focus({ preventScroll: true });
					return;
				}
				if (commentFocusFrame !== null) {
					currentWindow.cancelAnimationFrame(commentFocusFrame);
				}
				commentFocusFrame = currentWindow.requestAnimationFrame(() => {
					commentFocusFrame = null;
					if (!input.isConnected || !commentForm.open) return;
					view.slots.commentForm.form.scrollIntoView({ block: 'nearest' });
					input.focus({ preventScroll: true });
				});
			},
			parentScope: localScope,
			onError: this.#onError,
		});
		commentView = new ReaderLightboxCommentView({
			document: this.#options.document,
			controller: comments,
			slots: {
				rootList: view.slots.commentsList,
				status: view.slots.commentsStatus,
				empty: view.slots.commentsEmpty,
			},
			identity: this.#options.identity,
			render: this.#options.renderPost,
			...(this.#options.postFeatures
				? { postFeatures: this.#options.postFeatures }
				: {}),
			...(this.#options.postProjector
				? { postProjector: this.#options.postProjector }
				: {}),
			onCountChange: (count) => view.setCommentCount(count),
			parentScope: localScope,
			onError: this.#onError,
		});
		if (batchEnabled && this.#options.imageDownloads) {
			batch = new ReaderLightboxBatchController({
				sequence,
				archiveName: String(this.#options.topic().title ?? '帖子图片'),
				...(includeTopicImages && this.#options.topicImages
					? { imageCatalog: this.#options.topicImages }
					: {}),
				parentScope: localScope,
				onError: this.#onError,
			});
			batchView = new ReaderLightboxBatchView({
				document: this.#options.document,
				mount: view.slots.root,
				controller: batch,
				downloads: this.#options.imageDownloads,
				...(this.#options.imageResources || this.#options.originalSources
					? {
						originalSources:
							this.#options.imageResources ??
							this.#options.originalSources!,
					}
					: {}),
				...(this.#options.confirmOriginalDownload
					? { confirmOriginal: this.#options.confirmOriginalDownload }
					: {}),
				...(this.#options.notify ? { notify: this.#options.notify } : {}),
				parentScope: localScope,
				onError: this.#onError,
			});
		}
		if (includeTopicImages) {
			this.#options.topicImages?.changes.subscribe((snapshot) => {
				sequence.merge(snapshot.items);
			}, localScope);
		}
		let sourceReaction: ReaderPostReactionSurface<TPost> | null = null;
		let sourceReactionPostId = 0;
		const syncSource = (): void => {
			const item = sequence.snapshot().current;
			const sourcePost = comments.snapshot().sourcePost;
			view.setDescription(readerLightboxSourceDescription(
				this.#options.document,
				sourcePost,
				item,
			));
			const postId = Number(sourcePost?.id ?? 0);
			if (!sourcePost || !postId || !this.#options.reactionSurfaces) {
				sourceReaction?.destroy();
				sourceReaction = null;
				sourceReactionPostId = 0;
				view.slots.sourceReactions.hidden = true;
				return;
			}
			view.slots.sourceReactions.hidden = false;
			view.slots.sourceReactions.dataset.postId = String(postId);
			view.slots.sourceReactions.dataset.postNumber = String(
				sourcePost.post_number,
			);
			if (sourceReaction && sourceReactionPostId === postId) {
				sourceReaction.update(sourcePost);
				return;
			}
			sourceReaction?.destroy();
			sourceReaction = this.#options.reactionSurfaces.mountReactionSurface(
				sourcePost,
				view.slots.sourceReactions,
				localScope,
			);
			sourceReactionPostId = postId;
		};
		comments.changes.subscribe(syncSource, localScope);
		localScope.listen(view.slots.root, 'click', (event) => {
			const target = event.target as Element | null;
			const reply = target?.closest<HTMLButtonElement>(
				'button[data-post-reply]',
			);
			if (!reply || !view.slots.commentsList.contains(reply)) return;
			const postRoot = reply.closest<HTMLElement>('.ldp-post');
			const postNumber = Number(postRoot?.dataset.postNumber ?? 0);
			const targetPost = this.#options.session.postByNumber(postNumber);
			if (!targetPost) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			commentForm.openFor(targetPost, false);
		}, true);
		const syncItem = (item: ReaderLightboxItem): void => {
			const itemChanged = comments.image !== item;
			if (itemChanged) {
				commentForm.close();
				comments.select(item);
			}
			syncSource();
			if (itemChanged && commentsEnabled && comments.snapshot().partial) {
				void commentView.load().catch(this.#onError);
			}
		};
		sequence.changes.subscribe((snapshot) => syncItem(snapshot.current), localScope);
		syncSource();
		if (commentsEnabled && comments.snapshot().partial) {
			void commentView.load().catch(this.#onError);
		}
		const session = Object.freeze({
			sequence,
			view,
			comments,
			commentView,
			commentForm,
			batch,
			batchView,
		});
		this.#active = session;
		localScope.add(() => {
			if (this.#activeScope === localScope) {
				this.#activeScope = null;
				this.#active = null;
			}
		});
		return session;
	}

	#defaults(): ReaderLightboxDefaultSettings {
		let current:
			Readonly<Partial<ReaderLightboxDefaultSettings>> = {};
		try {
			current = this.#options.preferences?.read() ??
				this.#options.readDefaults?.() ?? {};
		} catch (error) {
			this.#onError(error);
		}
		return Object.freeze({
			originalByDefault:
				current.originalByDefault ??
				this.#options.originalByDefault === true,
			commentsExpanded:
				current.commentsExpanded ??
				this.#options.commentsExpandedByDefault === true,
			descriptionExpanded:
				current.descriptionExpanded ??
				this.#options.descriptionExpandedByDefault === true,
			lightboxDescriptionHeight:
				current.lightboxDescriptionHeight ??
				LIGHTBOX_DESCRIPTION_HEIGHT_DEFAULT,
			lightboxCommentsWidthPercent:
				current.lightboxCommentsWidthPercent ??
				LIGHTBOX_COMMENTS_WIDTH_DEFAULT,
		});
	}

	async #loadBoundary(
		sequence: ReaderLightboxController,
		direction: -1 | 1,
		item: ReaderLightboxItem,
		includeTopicImages = true,
		cursor: Record<-1 | 1, number>,
	): Promise<boolean> {
		if (includeTopicImages && this.#options.topicImages) {
			const start = direction === -1
				? Math.min(cursor[-1], item.sourcePostNumber)
				: Math.max(cursor[1], item.sourcePostNumber);
			if (this.#options.topicImages.loadAdjacent) {
				const result = await this.#options.topicImages.loadAdjacent(
					direction,
					start,
				);
				cursor[direction] = result.scannedPostNumber;
				sequence.merge(result.snapshot.items);
			} else {
				const snapshot = await this.#options.topicImages.loadAll();
				sequence.merge(snapshot.items);
			}
			const sequenceSnapshot = sequence.snapshot();
			if (
				direction === -1
					? sequenceSnapshot.canMovePrevious
					: sequenceSnapshot.canMoveNext
			) return true;
		}
		return this.#options.onBoundary
			? this.#options.onBoundary(direction, item)
			: false;
	}

	#confirmOriginal(missing: number, total: number): Promise<boolean> {
		if (!this.#options.confirmOriginalDownload) {
			return Promise.resolve(false);
		}
		try {
			return Promise.resolve(
				this.#options.confirmOriginalDownload(missing, total),
			);
		} catch (cause) {
			return Promise.reject(cause);
		}
	}

	close(): void {
		this.#assertActive();
		this.#releaseActive(true);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#minimumCommentLength(): number {
		try {
			return Math.max(
				1,
				Math.trunc(Number(this.#options.minimumCommentLength?.()) || 16),
			);
		} catch (error) {
			this.#onError(error);
			return 16;
		}
	}

	async #openImageCommentForm(
		item: ReaderLightboxItem,
		comments: ReaderLightboxCommentController<TPost>,
		form: ReaderLightboxCommentForm<TPost>,
	): Promise<void> {
		if (comments.image.key !== item.key) comments.select(item);
		let sourcePost = comments.snapshot().sourcePost;
		if (!sourcePost) {
			sourcePost = (await comments.load()).sourcePost;
		}
		if (!sourcePost) throw new Error('图片来源楼层尚未加载');
		form.openFor(sourcePost, true);
	}

	#releaseActive(notify: boolean): void {
		const activeScope = this.#activeScope;
		this.#activeScope = null;
		this.#active = null;
		activeScope?.destroy();
		if (notify && activeScope) this.#options.onClose?.();
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderLightboxFeature 已销毁');
		}
	}
}
