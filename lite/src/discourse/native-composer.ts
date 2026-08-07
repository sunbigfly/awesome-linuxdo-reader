import {
	discoursePostReference,
	discourseTopicId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from './identifiers.js';
import type { DiscourseHostApiPort } from './native-host-api.js';
import {
	DiscourseNativePostModelFactory,
	type DiscourseNativePostModelInput,
	type DiscourseNativeTopicModelInput,
} from './native-post-model-factory.js';
import { LifecycleScope, type Cleanup } from '../kernel/lifecycle.js';
import { RepeatActionGate } from '../kernel/repeat-action-gate.js';
import { Signal } from '../kernel/signal.js';
import {
	valueRecord as record,
	type MutableUnknownRecord as MutableRecord,
} from '../kernel/value-record.js';
import type {
	DiscourseTopicPayload,
	DiscourseTopicPostInput,
} from '../topic/topic-session.js';

export interface DiscourseComposerTopicInput<
	TPost extends DiscourseTopicPostInput,
> extends DiscourseTopicPayload<TPost>,
	DiscourseNativeTopicModelInput<TPost> {}

export interface DiscourseComposerPostInput extends DiscourseTopicPostInput,
	DiscourseNativePostModelInput {}

export interface DiscourseComposerReplyInput<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends DiscourseComposerPostInput,
> {
	readonly topic: TTopic;
	readonly post: TPost;
	readonly initialRaw?: string;
	readonly replaceRaw?: boolean;
}

export interface DiscourseComposerEditInput<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends DiscourseComposerPostInput,
> {
	readonly topic: TTopic;
	readonly post: TPost;
}

export interface DiscourseComposerSession {
	readonly topicId: DiscourseTopicId;
	readonly parentPostNumber: DiscoursePostNumber;
	readonly reused: boolean;
	readonly model: object;
}

type TrackedDiscourseComposerSession = DiscourseComposerSession & Readonly<{
	readonly action: 'reply' | 'edit';
}>;

export interface DiscoursePrivateMessageComposerSession {
	readonly username: string;
}

export interface DiscourseComposerReplyPort<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends DiscourseComposerPostInput,
> {
	openReply(input: DiscourseComposerReplyInput<TTopic, TPost>): Promise<DiscourseComposerSession>;
}

export interface DiscourseComposerEditPort<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends DiscourseComposerPostInput,
> {
	openEdit(input: DiscourseComposerEditInput<TTopic, TPost>): Promise<DiscourseComposerSession>;
}

export interface DiscourseComposerPort<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends DiscourseComposerPostInput,
> extends DiscourseComposerReplyPort<TTopic, TPost>,
	DiscourseComposerEditPort<TTopic, TPost> {}

export interface DiscourseComposerWindowPort {
	open(element?: HTMLElement | null): boolean;
}

export interface DiscourseComposerCoordinatorOptions {
	readonly host: DiscourseHostApiPort;
	readonly document?: Document;
	readonly isolation?: DiscourseComposerHostIsolation;
	readonly waitForDelay?: (milliseconds: number) => Promise<void>;
	readonly composerOpenTimeoutMs?: number;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

export interface DiscourseComposerCloseGuardOptions {
	readonly document: Document;
	readonly enabled: () => boolean;
	readonly notify?: (message: string) => void;
	readonly parentScope?: LifecycleScope;
}

export interface DiscourseComposerSubmitGuardOptions {
	readonly document: Document;
	readonly parentScope?: LifecycleScope;
}

interface DiscourseComposerReplyRuntime {
	readonly composer: MutableRecord & {
		open(options: MutableRecord): unknown;
	};
	readonly appEvents: MutableRecord;
	readonly replyAction: unknown;
	readonly draft: MutableRecord & {
		get(key: string): unknown;
	};
}

function modelValue(model: unknown, key: string): unknown {
	const value = record(model);
	if (!value) return undefined;
	const getter = value.get;
	return typeof getter === 'function'
		? getter.call(value, key)
		: value[key];
}

function composerModelTopicId(model: unknown): number {
	const post = modelValue(model, 'post');
	const topic = modelValue(model, 'topic') ?? modelValue(post, 'topic');
	return Number(
		modelValue(topic, 'id') ??
		modelValue(model, 'topic_id') ??
		modelValue(model, 'topicId') ??
		modelValue(post, 'topic_id') ??
		modelValue(post, 'topicId'),
	);
}

function setModelValue(model: unknown, key: string, value: unknown): void {
	const target = record(model);
	if (!target) throw new Error('Discourse composer model 不可写');
	const setter = target.set;
	if (typeof setter === 'function') setter.call(target, key, value);
	else target[key] = value;
}

function moduleDefault(host: DiscourseHostApiPort, name: string): MutableRecord {
	const module = record(host.lookupModule(name));
	const value = record(module?.default);
	if (!value) throw new Error(`Discourse 原生模块未就绪：${name}`);
	return value;
}

function normalizedDraftSequence(value: unknown): number {
	const numeric = Number(value);
	if (!Number.isSafeInteger(numeric) || numeric < 0) {
		throw new Error('Topic 缺少合法 draft_sequence');
	}
	return numeric;
}

function normalizedDraftKey(value: unknown): string {
	const normalized = String(value ?? '').trim();
	if (!normalized) throw new Error('Topic 缺少 draft_key');
	return normalized;
}

function composerRequestKey<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends DiscourseComposerPostInput,
>(input: DiscourseComposerReplyInput<TTopic, TPost>): string {
	const topicId = discourseTopicId(input.topic.id);
	const post = discoursePostReference(input.post);
	return JSON.stringify([
		'reply',
		topicId,
		post.postId,
		post.postNumber,
		String(input.initialRaw ?? '').trim(),
		input.replaceRaw === true,
	]);
}

function composerEditRequestKey<
	TTopic extends DiscourseComposerTopicInput<TPost>,
	TPost extends DiscourseComposerPostInput,
>(input: DiscourseComposerEditInput<TTopic, TPost>): string {
	const topicId = discourseTopicId(input.topic.id);
	const post = discoursePostReference(input.post);
	return JSON.stringify([
		'edit',
		topicId,
		post.postId,
		post.postNumber,
	]);
}

function privateMessageRequestKey(username: string): string {
	return JSON.stringify(['private-message', username]);
}

function parseDraft(value: unknown): Readonly<{
	readonly reply: string;
	readonly whisper?: unknown;
}> {
	if (value === null || value === undefined || value === '') return { reply: '' };
	const parsed = JSON.parse(String(value)) as unknown;
	if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
		throw new Error('Discourse composer draft 格式非法');
	}
	const source = parsed as Readonly<Record<string, unknown>>;
	return Object.freeze({
		reply: String(source.reply ?? ''),
		...(source.whisper === undefined ? {} : { whisper: source.whisper }),
	});
}

/**
 * Discourse 原生 composer 的唯一打开协调器。
 *
 * 普通回复、图片引用和灯箱评论都调用本类；它不发送 REST/fetch/GM 请求、不处理 CSRF，
 * draft 只通过 Discourse Draft model 读取，提交仍由原生 composer service 自己完成。
 */
export class DiscourseComposerCoordinator {
	readonly scope: LifecycleScope;
	readonly #host: DiscourseHostApiPort;
	readonly #document: Document | null;
	readonly #models: DiscourseNativePostModelFactory;
	readonly #isolation: DiscourseComposerHostIsolation | null;
	readonly #waitForDelay: (milliseconds: number) => Promise<void>;
	readonly #composerOpenTimeoutMs: number;
	readonly #onError: (error: unknown) => void;
	readonly #requests = new Map<string, Promise<unknown>>();
	#queue: Promise<void> = Promise.resolve();
	#session: TrackedDiscourseComposerSession | null = null;
	#submitPromise: Promise<unknown> | null = null;
	#windowPort: DiscourseComposerWindowPort | null = null;

	constructor(options: DiscourseComposerCoordinatorOptions) {
		this.#host = options.host;
		this.#document = options.document ?? null;
		this.#models = new DiscourseNativePostModelFactory(options.host);
		this.#isolation = options.isolation ?? null;
		this.#waitForDelay = options.waitForDelay ?? ((milliseconds) =>
			new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds)));
		this.#composerOpenTimeoutMs = Math.max(
			0,
			Number(options.composerOpenTimeoutMs) || 1600,
		);
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#requests.clear();
			this.#queue = Promise.resolve();
			this.#session = null;
			this.#submitPromise = null;
		});
	}

	isOpen(): boolean {
		const composer = record(this.#host.lookup('service:composer'));
		const model = modelValue(composer, 'model');
		return modelValue(model, 'viewOpen') === true ||
			String(modelValue(model, 'composeState') ?? '').toLowerCase() ===
				'open';
	}

	/**
	 * 在用户点击回复前只读解析宿主 Composer service、Draft 与原生 model。
	 *
	 * BrowserDiscourseHostApiPort 会缓存成功解析的 service/module，因此应用存续期间的
	 * 首次回复不再承担 module resolver 冷启动；这里不会调用 Draft.get、composer.open
	 * 或创建任何 Topic/Post model。
	 */
	warmReply(): boolean {
		this.#assertActive();
		try {
			this.#replyRuntime();
			this.#models.prepareComposerBindings();
			return true;
		} catch {
			// document-start 时依赖可能尚未注册；实际点击仍会重新解析并给出明确错误。
			return false;
		}
	}

	installCloseGuard(
		options: DiscourseComposerCloseGuardOptions,
	): LifecycleScope {
		this.#assertActive();
		const scope = options.parentScope
			? options.parentScope.child()
			: this.scope.child();
		const gate = new RepeatActionGate();
		const handledEvents = new WeakSet<Event>();
		const consume = (event: Event): void => {
			event.preventDefault();
			event.stopImmediatePropagation();
		};
		const requiresConfirmation = (
			key: string,
			message: string,
		): boolean => {
			if (!options.enabled()) {
				gate.clear();
				return false;
			}
			if (gate.confirm(key)) return false;
			options.notify?.(message);
			return true;
		};
		const discardComposer = (event: Event): void => {
			consume(event);
			void this.discard().catch((error) => {
				this.#onError(error);
				options.notify?.('舍弃回复失败，请重试');
			});
		};
		const onClick = (event: Event): void => {
			if (handledEvents.has(event)) return;
			const target = event.target as Element | null;
			const control = target?.closest(
				'#reply-control .toggle-save-and-close,' +
				'#reply-control .discard-button',
			);
			if (!control) return;
			handledEvents.add(event);
			const shouldDiscard = control.classList.contains('discard-button');
			if (requiresConfirmation(
				shouldDiscard ? 'composer:discard' : 'composer:close',
				shouldDiscard ? '再点一次舍弃回复' : '再点一次关闭回复窗口',
			)) {
				consume(event);
				return;
			}
			if (shouldDiscard) {
				discardComposer(event);
			}
		};
		const onKeyDown = (event: Event): void => {
			if (handledEvents.has(event)) return;
			const keyboard = event as KeyboardEvent;
			if (
				keyboard.key !== 'Escape' ||
				keyboard.repeat ||
				keyboard.defaultPrevented ||
				!this.isOpen()
			) return;
			handledEvents.add(event);
			if (requiresConfirmation('composer:escape', '再按一次 Esc 舍弃回复')) {
				consume(event);
				return;
			}
			discardComposer(event);
		};
		const captureTarget = options.document.defaultView ?? options.document;
		scope.listen(captureTarget, 'click', onClick, true);
		scope.listen(captureTarget, 'keydown', onKeyDown, true);
		if (captureTarget !== options.document) {
			scope.listen(options.document, 'click', onClick, true);
			scope.listen(options.document, 'keydown', onKeyDown, true);
		}
		scope.add(() => gate.clear());
		return scope;
	}

	async discard(): Promise<void> {
		this.#assertActive();
		const composer = record(this.#host.lookup('service:composer'));
		const model = modelValue(composer, 'model');
		if (!composer || !record(model)) {
			this.#session = null;
			return;
		}
		const destroyDraft = composer.destroyDraft;
		if (typeof destroyDraft !== 'function') {
			throw new Error('Discourse composer.destroyDraft 尚未就绪');
		}
		const cleanupErrors: unknown[] = [];
		try {
			composer.skipAutoSave = true;
			try {
				const runloop = record(this.#host.lookupModule('@ember/runloop'));
				const cancel = runloop?.cancel;
				if (typeof cancel === 'function' && composer._saveDraftDebounce) {
					cancel.call(runloop, composer._saveDraftDebounce);
				}
			} catch (error) {
				cleanupErrors.push(error);
			}
			await destroyDraft.call(composer);
			if (modelValue(composer, 'model') === model) {
				const mutableModel = record(model);
				try {
					if (typeof mutableModel?.clearState === 'function') {
						mutableModel.clearState.call(mutableModel);
					}
				} catch (error) {
					cleanupErrors.push(error);
				}
				try {
					if (typeof composer.close === 'function') composer.close.call(composer);
				} catch (error) {
					cleanupErrors.push(error);
				}
				try {
					const appEvents = record(
						composer.appEvents ?? this.#host.lookup('service:app-events'),
					);
					if (typeof appEvents?.trigger === 'function') {
						appEvents.trigger.call(appEvents, 'composer:cancelled');
					}
				} catch (error) {
					cleanupErrors.push(error);
				}
			}
			this.#session = null;
		} finally {
			try {
				composer.skipAutoSave = false;
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
		if (cleanupErrors.length) {
			throw new AggregateError(
				cleanupErrors,
				'Discourse composer 舍弃后清理失败',
			);
		}
	}

	installSubmitGuard(
		options: DiscourseComposerSubmitGuardOptions,
	): LifecycleScope {
		this.#assertActive();
		if (!this.#isolation) {
			throw new Error('Discourse Composer submit guard 缺少宿主隔离 owner');
		}
		const scope = options.parentScope
			? options.parentScope.child()
			: this.scope.child();
		const submit = (event: Event): void => {
			const target = event.target as Element | null;
			const button = target?.closest<HTMLButtonElement>(
				'#reply-control .save-or-cancel button.create',
			) ?? null;
			if (!button || button !== this.#submitButton(options.document)) return;
			event.preventDefault();
			event.stopImmediatePropagation();
			this.#submit(button);
		};
		scope.listen(options.document, 'click', submit, true);
		scope.listen(options.document, 'keydown', (event) => {
			const keyboard = event as KeyboardEvent;
			if (
				keyboard.isComposing ||
				!(keyboard.ctrlKey || keyboard.metaKey) ||
				(keyboard.key !== 'Enter' && keyboard.code !== 'Enter')
			) return;
			const button = this.#submitButton(options.document);
			if (!button) return;
			keyboard.preventDefault();
			keyboard.stopImmediatePropagation();
			this.#submit(button);
		}, true);
		return scope;
	}

	openReply<
		TTopic extends DiscourseComposerTopicInput<TPost>,
		TPost extends DiscourseComposerPostInput,
	>(input: DiscourseComposerReplyInput<TTopic, TPost>): Promise<DiscourseComposerSession> {
		return this.#enqueue(
			composerRequestKey(input),
			() => this.#openReply(input),
		);
	}

	openEdit<
		TTopic extends DiscourseComposerTopicInput<TPost>,
		TPost extends DiscourseComposerPostInput,
	>(input: DiscourseComposerEditInput<TTopic, TPost>): Promise<DiscourseComposerSession> {
		return this.#enqueue(
			composerEditRequestKey(input),
			() => this.#openEdit(input),
		);
	}

	openPrivateMessage(
		usernameValue: string,
	): Promise<DiscoursePrivateMessageComposerSession> {
		const username = String(usernameValue).trim().replace(/^@+/, '');
		if (!username) throw new Error('私信 username 不能为空');
		return this.#enqueue(
			privateMessageRequestKey(username),
			() => this.#openPrivateMessage(username),
		);
	}

	bindWindow(port: DiscourseComposerWindowPort): Cleanup {
		this.#assertActive();
		this.#windowPort = port;
		this.#presentComposerWindow();
		return () => {
			if (this.#windowPort === port) this.#windowPort = null;
		};
	}

	#enqueue<T>(key: string, execute: () => Promise<T>): Promise<T> {
		this.#assertActive();
		const existing = this.#requests.get(key);
		if (existing) return existing as Promise<T>;
		const request = this.#queue.then(
			() => {
				this.#assertActive();
				return execute();
			},
			() => {
				this.#assertActive();
				return execute();
			},
		)
			.catch((error) => {
				this.#onError(error);
				throw error;
			})
			.finally(() => {
				if (this.#requests.get(key) === request) this.#requests.delete(key);
			});
		this.#requests.set(key, request);
		this.#queue = request.then(
			() => {},
			() => {},
		);
		return request;
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #openPrivateMessage(
		username: string,
	): Promise<DiscoursePrivateMessageComposerSession> {
		if (this.isOpen()) {
			throw new Error('Discourse 原生 composer 正在处理另一项编辑，请先完成或关闭');
		}
		const composer = record(this.#host.lookup('service:composer'));
		const openNewMessage = composer?.openNewMessage;
		if (!composer || typeof openNewMessage !== 'function') {
			throw new Error('Discourse 原生 composer.openNewMessage 尚未就绪');
		}
		await openNewMessage.call(composer, { recipients: username });
		this.#assertActive();
		if (!await this.#waitForComposerPopup(this.#composerOpenTimeoutMs)) {
			throw new Error('Discourse 原生私信浮窗未显示');
		}
		if (!this.#presentComposerWindow()) {
			if (typeof composer.close === 'function') {
				composer.close.call(composer);
			}
			throw new Error('Reader 私信浮窗未接管');
		}
		this.#focusComposerInput();
		return Object.freeze({ username });
	}

	async #openReply<
		TTopic extends DiscourseComposerTopicInput<TPost>,
		TPost extends DiscourseComposerPostInput,
	>(input: DiscourseComposerReplyInput<TTopic, TPost>): Promise<DiscourseComposerSession> {
		const topicId = discourseTopicId(input.topic.id);
		const postReference = discoursePostReference(input.post);
		if (
			input.post.topic_id !== undefined &&
			discourseTopicId(input.post.topic_id) !== topicId
		) {
			throw new Error('composer 回复楼层不属于目标 Topic');
		}
		const {
			composer,
			appEvents,
			replyAction,
			draft: Draft,
		} = this.#replyRuntime();
		const topicModel = this.#models.createTopic(input.topic);
		const postModel = this.#models.createPost(input.topic, input.post, topicModel);
		const currentModel = modelValue(composer, 'model');
		const currentTopicId = composerModelTopicId(currentModel);
		const currentOpen = modelValue(currentModel, 'viewOpen') === true ||
			String(modelValue(currentModel, 'composeState') ?? '').toLowerCase() === 'open';
		const currentAction = modelValue(currentModel, 'action');
		const currentReply = String(modelValue(currentModel, 'reply') ?? '');
		const initialRaw = String(input.initialRaw ?? '').trim();
		const sameTopicReply = currentOpen &&
			currentTopicId === topicId &&
			currentAction === replyAction;
		if (sameTopicReply && await this.#waitForComposerPopup(640)) {
			setModelValue(
				currentModel,
				'post',
				postReference.postNumber === 1 ? null : postModel,
			);
			if (initialRaw && input.replaceRaw === true) {
				setModelValue(currentModel, 'reply', initialRaw);
			} else if (initialRaw) {
				const trigger = appEvents.trigger;
				if (typeof trigger !== 'function') {
					throw new Error('Discourse app-events 缺少 composer insert-block');
				}
				trigger.call(appEvents, 'composer:insert-block', initialRaw);
			}
			const session: TrackedDiscourseComposerSession = Object.freeze({
				topicId,
				parentPostNumber: postReference.postNumber,
				action: 'reply',
				reused: true,
				model: currentModel as object,
			});
			this.#session = session;
			this.#presentComposerWindow();
			this.#focusComposerInput();
			return session;
		}
		if (currentOpen) {
			const popupAvailable = this.#composerPopupAvailable();
			if (
				(currentTopicId === topicId || !popupAvailable) &&
				typeof composer.close === 'function'
			) {
				composer.close.call(composer);
				await this.#waitForDelay(0);
			} else {
				throw new Error(
					'Discourse 原生 composer 正在处理另一项编辑，请先完成或关闭',
				);
			}
		}
		const key = normalizedDraftKey(input.topic.draft_key);
		const sequence = normalizedDraftSequence(input.topic.draft_sequence);
		const options: MutableRecord = {
			action: replyAction,
			draftKey: key,
			draftSequence: sequence,
			skipJumpOnSave: true,
			...(postReference.postNumber === 1
				? { topic: topicModel }
				: { post: postModel }),
		};
		const draftResult = record(await Draft.get.call(Draft, key));
		if (draftResult?.draft) {
			const draft = parseDraft(draftResult.draft);
			options.draftSequence = normalizedDraftSequence(
				draftResult.draft_sequence ?? sequence,
			);
			options.reply = input.replaceRaw === true
				? initialRaw
				: `${draft.reply}${initialRaw ? `\n${initialRaw}` : ''}`;
			if (draft.whisper !== undefined) options.whisper = draft.whisper;
		} else if (initialRaw) {
			if (input.replaceRaw === true) options.reply = initialRaw;
			else options.quote = initialRaw;
		}
		if (currentReply && currentOpen && currentTopicId === topicId) {
			options.reply = `${currentReply}${initialRaw ? `\n${initialRaw}` : ''}`;
			delete options.quote;
		}
		await composer.open.call(composer, options);
		this.#assertActive();
		if (!await this.#waitForComposerPopup(this.#composerOpenTimeoutMs)) {
			throw new Error('Discourse 原生回复浮窗未显示');
		}
		const model = modelValue(composer, 'model');
		if (!record(model)) throw new Error('Discourse composer.open 未生成 model');
		const session: TrackedDiscourseComposerSession = Object.freeze({
			topicId,
			parentPostNumber: postReference.postNumber,
			action: 'reply',
			reused: false,
			model: model as object,
		});
		this.#session = session;
		this.#presentComposerWindow();
		this.#focusComposerInput();
		return session;
	}

	#replyRuntime(): DiscourseComposerReplyRuntime {
		const composer = record(this.#host.lookup('service:composer'));
		const appEvents = record(
			composer?.appEvents ?? this.#host.lookup('service:app-events'),
		);
		if (!composer || typeof composer.open !== 'function' || !appEvents) {
			throw new Error('Discourse 原生 composer service 未就绪');
		}
		const Composer = moduleDefault(this.#host, 'discourse/models/composer');
		const replyAction = Composer.REPLY;
		if (!replyAction) throw new Error('Discourse Composer.REPLY 未就绪');
		const draft = moduleDefault(this.#host, 'discourse/models/draft');
		if (typeof draft.get !== 'function') {
			throw new Error('Discourse Draft.get 未就绪');
		}
		return Object.freeze({
			composer: composer as DiscourseComposerReplyRuntime['composer'],
			appEvents,
			replyAction,
			draft: draft as DiscourseComposerReplyRuntime['draft'],
		});
	}

	#presentComposerWindow(): boolean {
		const popup = this.#document?.querySelector<HTMLElement>('#reply-control') ??
			null;
		if (!popup || !this.#composerPopupAvailable()) return false;
		return this.#windowPort?.open(popup) ?? false;
	}

	#composerPopupAvailable(): boolean {
		if (!this.#document) return true;
		const popup = this.#document.querySelector<HTMLElement>('#reply-control');
		if (!popup?.isConnected || popup.hidden) return false;
		if (
			popup.classList.contains('closed') ||
			popup.classList.contains('hidden') ||
			popup.classList.contains('d-none')
		) return false;
		if (popup.getAttribute('aria-hidden') === 'true') return false;
		if (popup.closest('[hidden],[aria-hidden="true"]')) return false;
		return true;
	}

	async #waitForComposerPopup(timeoutMs: number): Promise<boolean> {
		if (!this.#document) return true;
		const deadline = Date.now() + Math.max(0, timeoutMs);
		do {
			if (this.#composerPopupAvailable()) return true;
			if (Date.now() >= deadline) return false;
			await this.#waitForDelay(80);
			this.#assertActive();
		} while (Date.now() <= deadline);
		return false;
	}

	#focusComposerInput(): void {
		const document = this.#document;
		if (!document) return;
		const focus = (): void => {
			if (!this.#composerPopupAvailable()) return;
			const input = [...document.querySelectorAll<HTMLElement>(
				'#reply-control textarea.d-editor-input,' +
				'#reply-control textarea,' +
				'#reply-control .ProseMirror[contenteditable="true"]',
			)].find((candidate) =>
				!candidate.matches('[disabled],[aria-disabled="true"]'));
			if (!input) return;
			try {
				input.focus({ preventScroll: true });
			} catch {
				input.focus();
			}
		};
		const viewport = document.defaultView;
		if (viewport?.requestAnimationFrame) viewport.requestAnimationFrame(focus);
		else queueMicrotask(focus);
	}

	async #openEdit<
		TTopic extends DiscourseComposerTopicInput<TPost>,
		TPost extends DiscourseComposerPostInput,
	>(input: DiscourseComposerEditInput<TTopic, TPost>): Promise<DiscourseComposerSession> {
		const topicId = discourseTopicId(input.topic.id);
		const postReference = discoursePostReference(input.post);
		if (
			input.post.topic_id !== undefined &&
			discourseTopicId(input.post.topic_id) !== topicId
		) {
			throw new Error('composer 编辑楼层不属于目标 Topic');
		}
		const composer = record(this.#host.lookup('service:composer'));
		if (!composer || typeof composer.open !== 'function') {
			throw new Error('Discourse 原生 composer service 未就绪');
		}
		const Composer = moduleDefault(this.#host, 'discourse/models/composer');
		const editAction = Composer.EDIT;
		if (!editAction) throw new Error('Discourse Composer.EDIT 未就绪');
		const topicModel = this.#models.createTopic(input.topic);
		const postModel = this.#models.createPost(
			input.topic,
			input.post,
			topicModel,
		);
		const currentModel = modelValue(composer, 'model');
		const currentTopicId = Number(
			modelValue(
				modelValue(currentModel, 'topic') ??
					modelValue(modelValue(currentModel, 'post'), 'topic'),
				'id',
			),
		);
		const currentOpen = modelValue(currentModel, 'viewOpen') === true ||
			String(modelValue(currentModel, 'composeState') ?? '').toLowerCase() === 'open';
		const currentAction = modelValue(currentModel, 'action');
		if (currentOpen) {
			const currentPostId = Number(
				modelValue(modelValue(currentModel, 'post'), 'id'),
			);
			if (
				currentTopicId !== topicId ||
				currentAction !== editAction ||
				currentPostId !== postReference.postId
			) {
				throw new Error('Discourse 原生 composer 正在处理另一项编辑，请先完成或关闭');
			}
			const session: TrackedDiscourseComposerSession = Object.freeze({
				topicId,
				parentPostNumber: postReference.postNumber,
				action: 'edit',
				reused: true,
				model: currentModel as object,
			});
			if (!await this.#waitForComposerPopup(this.#composerOpenTimeoutMs)) {
				throw new Error('Discourse 原生编辑浮窗未显示');
			}
			this.#session = session;
			this.#presentComposerWindow();
			this.#focusComposerInput();
			return session;
		}
		await composer.open.call(composer, {
			action: editAction,
			post: postModel,
			draftKey: normalizedDraftKey(input.topic.draft_key),
			draftSequence: normalizedDraftSequence(input.topic.draft_sequence),
			skipJumpOnSave: true,
		});
		this.#assertActive();
		if (!await this.#waitForComposerPopup(this.#composerOpenTimeoutMs)) {
			throw new Error('Discourse 原生编辑浮窗未显示');
		}
		const model = modelValue(composer, 'model');
		if (!record(model)) throw new Error('Discourse composer.open 未生成 edit model');
		const session: TrackedDiscourseComposerSession = Object.freeze({
			topicId,
			parentPostNumber: postReference.postNumber,
			action: 'edit',
			reused: false,
			model: model as object,
		});
		this.#session = session;
		this.#presentComposerWindow();
		this.#focusComposerInput();
		return session;
	}

	#submitButton(document: Document): HTMLButtonElement | null {
		const session = this.#session;
		const composer = record(this.#host.lookup('service:composer'));
		if (
			!session ||
			modelValue(composer, 'model') !== session.model ||
			typeof composer?.save !== 'function'
		) return null;
		const button = document.querySelector<HTMLButtonElement>(
			'#reply-control .save-or-cancel button.create',
		);
		return button && !button.disabled ? button : null;
	}

	#submit(button: HTMLButtonElement): void {
		if (button.disabled || this.#submitPromise) return;
		const session = this.#session;
		const composer = record(this.#host.lookup('service:composer'));
		const save = composer?.save;
		if (
			!session ||
			!this.#isolation ||
			modelValue(composer, 'model') !== session.model ||
			typeof save !== 'function'
		) return;
		const transaction = this.#isolation.run(
			session.topicId,
			session.action === 'edit' ? 'edited' : 'created',
			() => save.call(composer, true, { jump: false }),
		);
		this.#submitPromise = transaction;
		void transaction.catch((error) => {
			this.#onError(error);
		}).finally(() => {
			if (this.#submitPromise === transaction) this.#submitPromise = null;
		});
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('DiscourseComposerCoordinator 已销毁');
		}
	}
}

export type DiscourseComposerSaveEventKind = 'created' | 'edited';

export interface DiscourseComposerSaveEvent {
	readonly kind: DiscourseComposerSaveEventKind;
	readonly payload: unknown;
	readonly eventName:
		| 'composer:created-post'
		| 'composer:edited-post'
		| 'post:created';
}

export interface DiscourseComposerEventSource {
	subscribe(
		listener: (event: DiscourseComposerSaveEvent) => void,
		scope?: LifecycleScope,
	): Cleanup;
}

export interface DiscourseComposerTopicSyncSession<TPost> {
	ingestCreatedPost(
		post: TPost,
		source: 'action-response',
		observedAt?: number,
	): unknown;
	ingestPosts(
		posts: readonly TPost[],
		source: 'action-response',
		observedAt?: number,
	): unknown;
	loadLastPost(options?: { readonly refresh?: boolean }): Promise<readonly TPost[]>;
	refresh(options?: { readonly background?: boolean }): Promise<unknown>;
}

export interface DiscourseComposerTopicSyncCommit<TPost> {
	readonly kind: DiscourseComposerSaveEventKind;
	readonly post: TPost | null;
	readonly postNumber: number | null;
	readonly source: 'native-event' | 'canonical-refresh';
}

export interface DiscourseComposerTopicSyncControllerOptions<TPost> {
	readonly topicId: string | number;
	readonly events: DiscourseComposerEventSource;
	readonly session: DiscourseComposerTopicSyncSession<TPost>;
	readonly parentScope?: LifecycleScope;
	readonly now?: () => number;
	readonly schedule?: (callback: () => void) => unknown;
	readonly cancel?: (handle: unknown) => void;
	readonly onError?: (error: unknown) => void;
}

interface PendingComposerFallback {
	handle?: unknown;
}

interface NativeAppEvents {
	on(eventName: string, listener: (payload?: unknown) => void): unknown;
	off(eventName: string, listener: (payload?: unknown) => void): unknown;
}

const COMPOSER_SAVE_EVENTS = Object.freeze([
	Object.freeze({
		eventName: 'composer:created-post' as const,
		kind: 'created' as const,
	}),
	Object.freeze({
		eventName: 'composer:edited-post' as const,
		kind: 'edited' as const,
	}),
	Object.freeze({
		eventName: 'post:created' as const,
		kind: 'created' as const,
	}),
]);

export interface DiscourseComposerHostIsolationOptions {
	readonly host: DiscourseHostApiPort;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

interface SuspendedTopicController {
	readonly controller: MutableRecord;
	readonly topicId: number;
}

function topicRouteTarget(value: unknown): Readonly<{
	readonly topicId: number;
	readonly postNumber: number;
}> | null {
	let segments: string[];
	try {
		segments = new URL(String(value ?? ''), 'https://reader.invalid')
			.pathname.split('/').filter(Boolean);
	} catch {
		return null;
	}
	const topicIndex = segments.indexOf('t');
	if (topicIndex < 0) return null;
	const tail = segments.slice(topicIndex + 1);
	const topicOffset = /^\d+$/.test(tail[0] ?? '') ? 0 : 1;
	const topicId = Number(tail[topicOffset]);
	const postNumber = Number(tail[topicOffset + 1]);
	return Number.isSafeInteger(topicId) && topicId > 0 &&
		Number.isSafeInteger(postNumber) && postNumber > 0
		? Object.freeze({ topicId, postNumber })
		: null;
}

/**
 * Reader 发起的原生 Composer save 与宿主消费者之间的唯一有界隔离 owner。
 *
 * save settle 后恢复 app-events/routeTo；同 Topic 宿主 controller 保持暂停直至 Reader
 * runtime 销毁，以免后续 MessageBus 回声再次驱动背景 Topic。隔离期 save 事件只投影给
 * Reader canonical TopicSession，不永久 monkey-patch 宿主对象。
 */
export class DiscourseComposerHostIsolation
	implements DiscourseComposerEventSource {
	readonly scope: LifecycleScope;
	readonly #host: DiscourseHostApiPort;
	readonly #events = new Signal<DiscourseComposerSaveEvent>();
	readonly #onError: (cause: unknown) => void;
	#releaseActive: Cleanup | null = null;
	#suspended: SuspendedTopicController | null = null;
	#running = false;

	constructor(options: DiscourseComposerHostIsolationOptions) {
		this.#host = options.host;
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#releaseActive?.();
			this.#releaseActive = null;
			this.#resumeTopicController();
			this.#events.clear();
		});
	}

	subscribe(
		listener: (event: DiscourseComposerSaveEvent) => void,
		scope?: LifecycleScope,
	): Cleanup {
		const owned = LifecycleScope.ownedBy(scope ?? this.scope);
		new DiscourseComposerEventPort(this.#host).subscribe(listener, owned);
		this.#events.subscribe(listener, owned);
		return () => owned.destroy();
	}

	async run<T>(
		topicIdValue: string | number,
		kind: DiscourseComposerSaveEventKind,
		execute: () => T | Promise<T>,
	): Promise<T> {
		if (this.scope.destroyed) {
			throw new Error('Discourse Composer 宿主隔离 owner 已销毁');
		}
		if (this.#running) {
			throw new Error('Discourse Composer save 事务正在进行');
		}
		const topicId = Number(discourseTopicId(topicIdValue));
		const appEvents = appEventsPort(
			record(this.#host.lookup('service:composer'))?.appEvents ??
				this.#host.lookup('service:app-events'),
		) as unknown as MutableRecord;
		const originalTrigger = appEvents.trigger;
		if (typeof originalTrigger !== 'function') {
			throw new Error('Discourse app-events 缺少 trigger');
		}
		const expectedNames = new Set(
			kind === 'edited'
				? ['composer:edited-post']
				: ['composer:created-post', 'post:created'],
		);
		const suppressedNames = new Set([
			'composer:created-post',
			'composer:edited-post',
			'post:created',
			'post:highlight',
		]);
		let observed = false;
		const trigger = (eventName: unknown, payload?: unknown): unknown => {
			const name = String(eventName ?? '');
			if (expectedNames.has(name)) {
				observed = true;
				this.#emit(Object.freeze({
					kind,
					payload,
					eventName: name as DiscourseComposerSaveEvent['eventName'],
				}));
			}
			if (suppressedNames.has(name)) return appEvents;
			return originalTrigger.call(appEvents, eventName, payload);
		};
		const releases: Cleanup[] = [];
		const release = (): void => {
			for (const cleanup of releases.splice(0).reverse()) {
				try {
					cleanup();
				} catch (cause) {
					this.#report(cause);
				}
			}
			if (this.#releaseActive === release) this.#releaseActive = null;
		};
		this.#running = true;
		try {
			appEvents.trigger = trigger;
			if (appEvents.trigger !== trigger) {
				throw new Error('Discourse app-events trigger 无法建立有界隔离');
			}
			releases.push(() => {
				if (appEvents.trigger === trigger) appEvents.trigger = originalTrigger;
			});
			const routeModule = record(
				this.#host.lookupModule('discourse/lib/url'),
			);
			const routeOwner = record(routeModule?.default) ?? routeModule;
			const originalRouteTo = routeOwner?.routeTo;
			if (routeOwner && typeof originalRouteTo === 'function') {
				const guardedRouteTo = (value: unknown, ...args: unknown[]): unknown => {
					const target = topicRouteTarget(value);
					if (target?.topicId === topicId) return undefined;
					return originalRouteTo.call(routeOwner, value, ...args);
				};
				routeOwner.routeTo = guardedRouteTo;
				if (routeOwner.routeTo === guardedRouteTo) {
					releases.push(() => {
						if (routeOwner.routeTo === guardedRouteTo) {
							routeOwner.routeTo = originalRouteTo;
						}
					});
				}
			}
			this.#suspendTopicController(topicId);
			this.#releaseActive = release;
			const result = await execute();
			if (!observed) {
				this.#emit(Object.freeze({
					kind,
					payload: result,
					eventName: kind === 'edited'
						? 'composer:edited-post'
						: 'composer:created-post',
				}));
			}
			return result;
		} finally {
			release();
			this.#running = false;
		}
	}

	runActive<T>(
		kind: DiscourseComposerSaveEventKind,
		execute: () => T | Promise<T>,
	): Promise<T> {
		const composer = record(this.#host.lookup('service:composer'));
		const model = modelValue(composer, 'model');
		const topic = modelValue(model, 'topic') ??
			modelValue(modelValue(model, 'post'), 'topic');
		return this.run(
			Number(discourseTopicId(modelValue(topic, 'id'))),
			kind,
			execute,
		);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#emit(event: DiscourseComposerSaveEvent): void {
		for (const cause of this.#events.emit(event)) this.#report(cause);
	}

	#suspendTopicController(topicId: number): void {
		if (this.#suspended?.topicId === topicId) return;
		this.#resumeTopicController();
		const controller = record(this.#host.lookup('controller:topic'));
		const hostTopicId = Number(modelValue(modelValue(controller, 'model'), 'id'));
		if (
			!controller ||
			hostTopicId !== topicId ||
			typeof controller.unsubscribe !== 'function'
		) return;
		controller.unsubscribe.call(controller);
		this.#suspended = Object.freeze({ controller, topicId });
	}

	#resumeTopicController(): void {
		const suspended = this.#suspended;
		this.#suspended = null;
		if (!suspended || typeof suspended.controller.subscribe !== 'function') return;
		const currentTopicId = Number(
			modelValue(modelValue(suspended.controller, 'model'), 'id'),
		);
		if (currentTopicId !== suspended.topicId) return;
		try {
			suspended.controller.subscribe.call(suspended.controller);
		} catch (cause) {
			this.#report(cause);
		}
	}

	#report(cause: unknown): void {
		try {
			this.#onError(cause);
		} catch {
			// 诊断 consumer 失败不能破坏 save cleanup。
		}
	}
}

function appEventsPort(value: unknown): NativeAppEvents {
	const target = record(value);
	if (
		!target ||
		typeof target.on !== 'function' ||
		typeof target.off !== 'function'
	) {
		throw new Error('Discourse app-events 缺少 on/off');
	}
	return target as unknown as NativeAppEvents;
}

function modelJson(value: unknown): unknown {
	const target = record(value);
	if (!target || typeof target.toJSON !== 'function') return value;
	try {
		return target.toJSON.call(target);
	} catch {
		return value;
	}
}

function eventPostCandidate(value: unknown): unknown {
	const normalized = modelJson(value);
	const nested = modelValue(normalized, 'post');
	return nested === undefined ? normalized : modelJson(nested);
}

function topicIdForPost(value: unknown): number | null {
	const direct = Number(modelValue(value, 'topic_id'));
	if (Number.isSafeInteger(direct) && direct > 0) return direct;
	const topic = modelValue(value, 'topic');
	const nested = Number(modelValue(topic, 'id'));
	return Number.isSafeInteger(nested) && nested > 0 ? nested : null;
}

/**
 * Discourse 原生 composer 保存事件的唯一只读端口。
 *
 * 只订阅 app-events；不替换 trigger、不阻止 routeTo、不暂停宿主 Topic controller，也不把
 * event payload 当成网络响应。事件只作为 canonical TopicSession 的提交/刷新提示。
 */
export class DiscourseComposerEventPort implements DiscourseComposerEventSource {
	readonly #host: DiscourseHostApiPort;

	constructor(host: DiscourseHostApiPort) {
		this.#host = host;
	}

	subscribe(
		listener: (event: DiscourseComposerSaveEvent) => void,
		scope?: LifecycleScope,
	): Cleanup {
		let appEvents: NativeAppEvents;
		try {
			appEvents = appEventsPort(
				record(this.#host.lookup('service:composer'))?.appEvents ??
					this.#host.lookup('service:app-events'),
			);
		} catch {
			// document-start/直达 Topic 时 optional app-events 可能尚未注册；
			// 缺少只读保存提示不得阻断整个 Reader application 启动。
			return () => {};
		}
		const bindings: Array<Readonly<{
			eventName: DiscourseComposerSaveEvent['eventName'];
			listener: (payload?: unknown) => void;
		}>> = [];
		try {
			for (const descriptor of COMPOSER_SAVE_EVENTS) {
				const bound = (payload?: unknown): void => {
					listener(Object.freeze({
						kind: descriptor.kind,
						payload,
						eventName: descriptor.eventName,
					}));
				};
				appEvents.on(descriptor.eventName, bound);
				bindings.push(Object.freeze({
					eventName: descriptor.eventName,
					listener: bound,
				}));
			}
		} catch (error) {
			for (const binding of bindings.reverse()) {
				try {
					appEvents.off(binding.eventName, binding.listener);
				} catch {}
			}
			throw error;
		}
		let active = true;
		const cleanup = (): void => {
			if (!active) return;
			active = false;
			for (const binding of bindings.reverse()) {
				try {
					appEvents.off(binding.eventName, binding.listener);
				} catch {}
			}
		};
		scope?.add(cleanup);
		return cleanup;
	}
}

/**
 * composer save hint -> canonical TopicSession 的窄协调器。
 *
 * 带合法实体的 created/edited 事件直接提交 action-response；无实体事件在同一 tick 合并为
 * 一次 canonical load-last/refresh。重复 app-event 与 MessageBus 回声继续由 TopicSession
 * 版本规则去重，本类不保存 post Map、DOM、路由或请求 URL。
 */
export class DiscourseComposerTopicSyncController<TPost> {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<DiscourseComposerTopicSyncCommit<TPost>>();
	readonly #topicId: DiscourseTopicId;
	readonly #events: DiscourseComposerEventSource;
	readonly #session: DiscourseComposerTopicSyncSession<TPost>;
	readonly #now: () => number;
	readonly #schedule: (callback: () => void) => unknown;
	readonly #cancel: (handle: unknown) => void;
	readonly #onError: (error: unknown) => void;
	readonly #pending = new Map<
		DiscourseComposerSaveEventKind,
		PendingComposerFallback
	>();
	#unsubscribe: Cleanup | null = null;

	constructor(options: DiscourseComposerTopicSyncControllerOptions<TPost>) {
		this.#topicId = discourseTopicId(options.topicId);
		this.#events = options.events;
		this.#session = options.session;
		this.#now = options.now ?? Date.now;
		this.#schedule = options.schedule ?? ((callback) => setTimeout(callback, 0));
		this.#cancel = options.cancel ?? ((handle) =>
			clearTimeout(handle as ReturnType<typeof setTimeout>));
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.stop();
			this.changes.clear();
		});
	}

	get active(): boolean {
		return this.#unsubscribe !== null;
	}

	start(): void {
		this.#assertActive();
		if (this.#unsubscribe) return;
		this.#unsubscribe = this.#events.subscribe((event) => {
			this.#handle(event);
		}, this.scope);
	}

	stop(): void {
		const unsubscribe = this.#unsubscribe;
		this.#unsubscribe = null;
		unsubscribe?.();
		for (const pending of this.#pending.values()) {
			if ('handle' in pending) this.#cancel(pending.handle);
		}
		this.#pending.clear();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#handle(event: DiscourseComposerSaveEvent): void {
		if (this.scope.destroyed) return;
		const candidate = eventPostCandidate(event.payload);
		const topicId = topicIdForPost(candidate);
		if (topicId !== null && topicId !== this.#topicId) return;
		let reference: ReturnType<typeof discoursePostReference> | null = null;
		if (topicId === this.#topicId) {
			try {
				reference = discoursePostReference(
					candidate as DiscourseTopicPostInput,
				);
			} catch {
				reference = null;
			}
		}
		if (reference && reference.postId !== null) {
			this.#cancelPending(event.kind);
			try {
				if (event.kind === 'created') {
					this.#session.ingestCreatedPost(
						candidate as TPost,
						'action-response',
						this.#now(),
					);
				} else {
					this.#session.ingestPosts(
						Object.freeze([candidate as TPost]),
						'action-response',
						this.#now(),
					);
				}
				this.#emit(Object.freeze({
					kind: event.kind,
					post: candidate as TPost,
					postNumber: reference.postNumber,
					source: 'native-event',
				}));
			} catch (error) {
				this.#onError(error);
			}
			return;
		}
		this.#scheduleFallback(event.kind);
	}

	#scheduleFallback(kind: DiscourseComposerSaveEventKind): void {
		if (this.#pending.has(kind)) return;
		const pending: PendingComposerFallback = {};
		this.#pending.set(kind, pending);
		try {
			pending.handle = this.#schedule(() => {
				if (this.#pending.get(kind) !== pending) return;
				this.#pending.delete(kind);
				void Promise.resolve()
					.then(async () => {
						await this.#session.refresh({ background: false });
						if (kind === 'created') {
							await this.#session.loadLastPost({ refresh: true });
						}
					})
					.then(() => {
						if (this.scope.destroyed) return;
						this.#emit(Object.freeze({
							kind,
							post: null,
							postNumber: null,
							source: 'canonical-refresh',
						}));
					})
					.catch(this.#onError);
			});
		} catch (error) {
			if (this.#pending.get(kind) === pending) this.#pending.delete(kind);
			this.#onError(error);
		}
	}

	#cancelPending(kind: DiscourseComposerSaveEventKind): void {
		const pending = this.#pending.get(kind);
		if (!pending) return;
		this.#pending.delete(kind);
		if ('handle' in pending) this.#cancel(pending.handle);
	}

	#emit(commit: DiscourseComposerTopicSyncCommit<TPost>): void {
		if (this.scope.destroyed) return;
		for (const error of this.changes.emit(commit)) this.#onError(error);
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('DiscourseComposerTopicSyncController 已销毁');
		}
	}
}
