import type { Cleanup } from '../kernel/lifecycle.js';
import type {
	ReaderTopicFactory,
	ReaderTopicFactoryContext,
	ReaderTopicCloseReason,
} from '../shell/reader-shell.js';
import {
	ReaderTopicDomCoordinator,
	type ReaderTopicDomCoordinatorOptions,
	type ReaderTopicSessionDomPort,
} from './reader-topic-dom-coordinator.js';
import type { ReplyTreeRepository } from '../dom/reply-tree-repository.js';
import type { DiscourseTopicPostInput } from './topic-session.js';

export interface ReaderTopicRuntimeBundle<
	TTopic,
	TPost extends DiscourseTopicPostInput,
	TServices,
> {
	readonly session: ReaderTopicSessionDomPort<TTopic, TPost>;
	readonly replies: ReplyTreeRepository;
	readonly services: TServices;
	readonly activate?: () => void | Cleanup;
	readonly prepareClose?: (
		reason: ReaderTopicCloseReason,
	) => void | Promise<void>;
	readonly cleanup?: Cleanup;
}

export interface ReaderTopicRuntimeContext<
	TTopic,
	TPost extends DiscourseTopicPostInput,
	TServices,
> {
	readonly topic: TTopic;
	readonly root: HTMLElement;
	readonly session: ReaderTopicSessionDomPort<TTopic, TPost>;
	readonly replies: ReplyTreeRepository;
	readonly dom: ReaderTopicDomCoordinator<TTopic, TPost>;
	readonly services: TServices;
}

export interface ReaderTopicFactoryOptions<
	TTopic,
	TPost extends DiscourseTopicPostInput,
	TServices,
> {
	readonly document: Document;
	readonly createBundle: (
		context: ReaderTopicFactoryContext,
	) =>
		| ReaderTopicRuntimeBundle<TTopic, TPost, TServices>
		| Promise<ReaderTopicRuntimeBundle<TTopic, TPost, TServices>>;
	readonly createDomOptions: (
		bundle: ReaderTopicRuntimeBundle<TTopic, TPost, TServices>,
		context: ReaderTopicFactoryContext,
		root: HTMLElement,
	) => Omit<
		ReaderTopicDomCoordinatorOptions<TTopic, TPost>,
		'document' | 'topicHost' | 'session' | 'replies' | 'parentScope'
	>;
	readonly createRoot?: (
		context: ReaderTopicFactoryContext,
		document: Document,
	) => HTMLElement;
	readonly onAssembled?: (
		value: ReaderTopicRuntimeContext<TTopic, TPost, TServices>,
		context: ReaderTopicFactoryContext,
	) => void | Cleanup;
	readonly onReady?: (
		value: ReaderTopicRuntimeContext<TTopic, TPost, TServices>,
		context: ReaderTopicFactoryContext,
	) => void | Cleanup;
	readonly onPhase?: (
		phase: 'prepare' | 'render',
		context: ReaderTopicFactoryContext,
	) => void;
}

function throwIfAborted(signal: AbortSignal): void {
	if (signal.aborted) throw signal.reason;
}

function createTopicLifetimeContext(
	context: ReaderTopicFactoryContext,
): ReaderTopicFactoryContext {
	const controller = context.scope.abortController(
		new DOMException(
			`Topic ${context.topicId} 生命周期已结束`,
			'AbortError',
		),
		context.signal,
	);
	return Object.freeze({
		...context,
		signal: controller.signal,
	});
}

/**
 * 每篇 Topic 的唯一 assembly transaction。
 *
 * createBundle 负责构造请求/缓存/live/read/action 等领域 owner，本函数只固定 scope、Topic
 * root、树 DOM 协调器、初始化、组合连接、activate、prepareClose 和反向 cleanup 的顺序。
 *
 * onAssembled 必须在 activate 前连接依赖 DOM 的协调器；activate 又必须等 canonical Topic
 * 数据、回复树和首帧 DOM 初始化完成后才执行，防止 MessageBus/composer/已读事件抢在
 * 缓存恢复、树提交或导航订阅之前改变运行态。
 */
export function createReaderTopicFactory<
	TTopic,
	TPost extends DiscourseTopicPostInput,
	TServices = undefined,
>(
	options: ReaderTopicFactoryOptions<TTopic, TPost, TServices>,
): ReaderTopicFactory<ReaderTopicRuntimeContext<TTopic, TPost, TServices>> {
	return async (
		context: ReaderTopicFactoryContext,
	) => {
		throwIfAborted(context.signal);
		const topicContext = createTopicLifetimeContext(context);
		options.onPhase?.('prepare', topicContext);
		const bundle = await options.createBundle(topicContext);
		if (bundle.cleanup) topicContext.scope.add(bundle.cleanup);
		throwIfAborted(topicContext.signal);
		const root = options.createRoot?.(topicContext, options.document) ??
			options.document.createElement('section');
		if (root.isConnected || root.parentNode) {
			throw new Error('Topic root 在 mount 前必须是 detached');
		}
		if (!root.classList.contains('ldp-topic-runtime')) {
			root.classList.add('ldp-topic-runtime');
		}
		root.dataset.topicId = String(topicContext.topicId);
		topicContext.mount(root);
		const dom = new ReaderTopicDomCoordinator<TTopic, TPost>({
			...options.createDomOptions(bundle, topicContext, root),
			document: options.document,
			topicHost: root,
			session: bundle.session,
			replies: bundle.replies,
			parentScope: topicContext.scope,
		});
		const topic = await dom.initialize();
		throwIfAborted(topicContext.signal);
		options.onPhase?.('render', topicContext);
		const value: ReaderTopicRuntimeContext<TTopic, TPost, TServices> = Object.freeze({
			topic,
			root,
			session: bundle.session,
			replies: bundle.replies,
			dom,
			services: bundle.services,
		});
		const assembledCleanup = options.onAssembled?.(value, topicContext);
		if (typeof assembledCleanup === 'function') {
			topicContext.scope.add(assembledCleanup);
		}
		throwIfAborted(topicContext.signal);
		const activationCleanup = bundle.activate?.();
		if (typeof activationCleanup === 'function') {
			topicContext.scope.add(activationCleanup);
		}
		throwIfAborted(topicContext.signal);
		const readyCleanup = options.onReady?.(value, topicContext);
		if (typeof readyCleanup === 'function') topicContext.scope.add(readyCleanup);
		return Object.freeze({
			value,
			...(bundle.prepareClose ? { prepareClose: bundle.prepareClose } : {}),
		});
	};
}
