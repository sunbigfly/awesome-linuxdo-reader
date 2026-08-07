import {
	discourseTopicId,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	ReaderApplicationContext,
	ReaderApplicationStage,
} from '../app/reader-application.js';

export type ReaderShellState =
	| 'idle'
	| 'opening'
	| 'switching'
	| 'running'
	| 'failed'
	| 'closed'
	| 'destroyed';

export type ReaderTopicCloseReason = 'switch' | 'close';

export interface ReaderShellView {
	readonly root: HTMLElement;
	readonly modal: HTMLElement;
	readonly body: HTMLElement;
	readonly topicHost: HTMLElement;
	readonly surfaceHost: HTMLElement;
}

export interface ReaderShellDiagnostic {
	readonly phase:
		| 'prepare-close'
		| 'topic-cleanup'
		| 'topic-open'
		| 'shell-cleanup';
	readonly topicId: DiscourseTopicId | null;
	readonly cause: unknown;
}

export interface ReaderShellStageOptions<
	TPreferences extends object,
	TContext,
> {
	readonly name?: string;
	readonly compatibilityKey: (
		context: ReaderApplicationContext<TPreferences>,
	) => string;
	readonly createView: (
		context: ReaderApplicationContext<TPreferences>,
	) => ReaderShellView;
	readonly onReady?: (
		shell: ReaderShell<TContext>,
		context: ReaderApplicationContext<TPreferences>,
	) => void | Cleanup;
}

export interface ReaderTopicFactoryContext {
	readonly topicId: DiscourseTopicId;
	readonly scope: LifecycleScope;
	readonly signal: AbortSignal;
	mount(node: Node): Cleanup;
}

export interface ReaderTopicFactoryResult<TContext> {
	readonly value: TContext;
	readonly prepareClose?: (
		reason: ReaderTopicCloseReason,
	) => void | Promise<void>;
	readonly cleanup?: Cleanup;
}

export type ReaderTopicFactory<TContext> = (
	context: ReaderTopicFactoryContext,
) => ReaderTopicFactoryResult<TContext> | Promise<ReaderTopicFactoryResult<TContext>>;

export type ReaderShellOpenResult<TContext> =
	| {
		readonly status: 'opened' | 'reused';
		readonly topicId: DiscourseTopicId;
		readonly value: TContext;
	}
	| {
		readonly status: 'superseded';
		readonly topicId: DiscourseTopicId;
	}
	| {
		readonly status: 'failed';
		readonly topicId: DiscourseTopicId;
		readonly cause: unknown;
	};

interface ActiveTopic<TContext> {
	readonly topicId: DiscourseTopicId;
	readonly value: TContext;
	readonly scope: LifecycleScope;
	readonly prepareClose?: ReaderTopicFactoryResult<TContext>['prepareClose'];
}

interface OpeningTopic<TContext> {
	readonly topicId: DiscourseTopicId;
	readonly epoch: number;
	readonly controller: AbortController;
	readonly scope: LifecycleScope;
	promise: Promise<ReaderShellOpenResult<TContext>>;
}

function compatibilityKey(value: string): string {
	const key = String(value).trim();
	if (!key) throw new Error('Reader Shell compatibilityKey 不能为空');
	return key;
}

function abortReason(topicId: DiscourseTopicId): DOMException {
	return new DOMException(`Topic ${topicId} 打开已被替代`, 'AbortError');
}

function validateView(view: ReaderShellView): ReaderShellView {
	for (const [name, element] of Object.entries(view)) {
		if (!element || element.nodeType !== 1) {
			throw new TypeError(`Reader Shell ${name} 必须是 Element`);
		}
		if (name !== 'root' && element !== view.root && !view.root.contains(element)) {
			throw new Error(`Reader Shell ${name} 必须属于 root`);
		}
	}
	return Object.freeze({ ...view });
}

/**
 * Shell 浮动 surface 的唯一移动 owner。
 *
 * manager 只移动已登记节点，不解释设置、通知、头像或媒体业务。
 */
export class ReaderSurfaceManager {
	readonly parking: DocumentFragment;
	readonly #root: HTMLElement;
	readonly #defaultHost: HTMLElement;
	readonly #surfaces = new Set<HTMLElement>();
	#destroyed = false;

	constructor(
		root: HTMLElement,
		defaultHost: HTMLElement,
		parentScope?: LifecycleScope,
	) {
		if (defaultHost !== root && !root.contains(defaultHost)) {
			throw new Error('surface defaultHost 必须属于 Shell root');
		}
		this.#root = root;
		this.#defaultHost = defaultHost;
		this.parking = root.ownerDocument.createDocumentFragment();
		parentScope?.add(() => this.destroy());
	}

	get size(): number {
		return this.#surfaces.size;
	}

	mount<TSurface extends HTMLElement>(
		surface: TSurface,
		host: HTMLElement = this.#defaultHost,
	): TSurface {
		this.#assertActive();
		this.#assertHost(host);
		if (surface === this.#root) throw new Error('Shell root 不能登记为 surface');
		this.#surfaces.add(surface);
		if (surface.parentNode !== host) host.append(surface);
		return surface;
	}

	park<TSurface extends HTMLElement>(surface: TSurface): TSurface {
		this.#assertActive();
		if (!this.#surfaces.has(surface)) {
			throw new Error('未登记 surface 不能进入 Shell parking');
		}
		if (surface.parentNode !== this.parking) this.parking.append(surface);
		return surface;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		for (const surface of this.#surfaces) surface.remove();
		this.#surfaces.clear();
		this.parking.replaceChildren();
	}

	#assertHost(host: HTMLElement): void {
		if (host !== this.#root && !this.#root.contains(host)) {
			throw new Error('surface host 必须属于当前 Shell root');
		}
	}

	#assertActive(): void {
		if (this.#destroyed) throw new Error('ReaderSurfaceManager 已销毁');
	}
}

/**
 * 稳定壳层与单一 active Topic context 的唯一 owner。
 *
 * 它不发送请求、不解释 Topic 数据、不绘制楼层，只负责打开事务、生命周期和命名挂载点。
 */
export class ReaderShell<TContext> {
	readonly changes = new Signal<ReaderShellState>();
	readonly diagnostics = new Signal<ReaderShellDiagnostic>();
	readonly compatibilityKey: string;
	readonly view: ReaderShellView;
	readonly scope: LifecycleScope;
	readonly surfaces: ReaderSurfaceManager;
	#state: ReaderShellState = 'idle';
	#epoch = 0;
	#active: ActiveTopic<TContext> | null = null;
	#opening: OpeningTopic<TContext> | null = null;
	#deactivation: Promise<boolean> | null = null;

	constructor(
		compatibility: string,
		view: ReaderShellView,
		parentScope?: LifecycleScope,
	) {
		this.compatibilityKey = compatibilityKey(compatibility);
		this.view = validateView(view);
		this.scope = LifecycleScope.ownedBy(parentScope);
		this.surfaces = new ReaderSurfaceManager(
			this.view.root,
			this.view.surfaceHost,
			this.scope,
		);
		this.#syncRootVisibility();
	}

	get state(): ReaderShellState {
		return this.#state;
	}

	get activeTopicId(): DiscourseTopicId | null {
		return this.#active?.topicId ?? null;
	}

	get activeValue(): TContext | null {
		return this.#active?.value ?? null;
	}

	canReuse(compatibility: string): boolean {
		return this.#state !== 'destroyed'
			&& this.compatibilityKey === compatibilityKey(compatibility);
	}

	open(
		topicIdValue: number,
		factory: ReaderTopicFactory<TContext>,
	): Promise<ReaderShellOpenResult<TContext>> {
		if (this.#state === 'destroyed') {
			return Promise.resolve({
				status: 'failed',
				topicId: discourseTopicId(topicIdValue),
				cause: new Error('Reader Shell 已销毁'),
			});
		}
		const topicId = discourseTopicId(topicIdValue);
		if (this.#opening?.topicId === topicId) return this.#opening.promise;
		if (!this.#opening && this.#active?.topicId === topicId) {
			return Promise.resolve(Object.freeze({
				status: 'reused',
				topicId,
				value: this.#active.value,
			}));
		}

		this.#epoch += 1;
		this.#cancelOpening();
		const controller = new AbortController();
		const scope = this.scope.child();
		scope.add(() => {
			if (!controller.signal.aborted) controller.abort(abortReason(topicId));
		});
		const opening: OpeningTopic<TContext> = {
			topicId,
			epoch: this.#epoch,
			controller,
			scope,
			promise: Promise.resolve({ status: 'superseded', topicId }),
		};
		this.#opening = opening;
		this.#setState(this.#active ? 'switching' : 'opening');
		opening.promise = this.#runOpen(opening, factory);
		return opening.promise;
	}

	async closeTopic(): Promise<boolean> {
		if (this.#isDestroyed()) return true;
		const epoch = ++this.#epoch;
		this.#cancelOpening();
		this.#setState('closed');
		const closed = await this.#deactivateActive('close');
		if (this.#isDestroyed()) return true;
		if (this.#epoch === epoch) {
			this.#setState('closed');
		}
		return closed;
	}

	destroy(): void {
		if (this.#state === 'destroyed') return;
		this.#epoch += 1;
		this.#cancelOpening();
		this.#active = null;
		this.#setState('destroyed');
		try {
			this.scope.destroy();
		} catch (cause) {
			this.diagnostics.emit(Object.freeze({
				phase: 'shell-cleanup',
				topicId: null,
				cause,
			}));
		} finally {
			this.view.root.remove();
		}
	}

	async #runOpen(
		opening: OpeningTopic<TContext>,
		factory: ReaderTopicFactory<TContext>,
	): Promise<ReaderShellOpenResult<TContext>> {
		const deactivated = await this.#deactivateActive('switch');
		if (!deactivated) {
			const cause = new Error('当前 Topic prepareClose 失败');
			const current = this.#isCurrent(opening);
			this.#destroyTopicScope(opening.scope, opening.topicId);
			if (current) {
				this.#opening = null;
				this.#setState('running');
				return Object.freeze({ status: 'failed', topicId: opening.topicId, cause });
			}
			return Object.freeze({ status: 'superseded', topicId: opening.topicId });
		}
		if (!this.#isCurrent(opening)) {
			this.#destroyTopicScope(opening.scope, opening.topicId);
			return Object.freeze({ status: 'superseded', topicId: opening.topicId });
		}

		try {
			const result = await factory(Object.freeze({
				topicId: opening.topicId,
				scope: opening.scope,
				signal: opening.controller.signal,
				mount: (node: Node) => {
					this.view.topicHost.append(node);
					return opening.scope.add(() => node.parentNode?.removeChild(node));
				},
			}));
			if (typeof result.cleanup === 'function') opening.scope.add(result.cleanup);
			if (!this.#isCurrent(opening)) {
				this.#destroyTopicScope(opening.scope, opening.topicId);
				return Object.freeze({ status: 'superseded', topicId: opening.topicId });
			}
			this.#active = Object.freeze({
				topicId: opening.topicId,
				value: result.value,
				scope: opening.scope,
				...(result.prepareClose ? { prepareClose: result.prepareClose } : {}),
			});
			this.#opening = null;
			this.#setState('running');
			return Object.freeze({
				status: 'opened',
				topicId: opening.topicId,
				value: result.value,
			});
		} catch (cause) {
			const current = this.#isCurrent(opening);
			this.#destroyTopicScope(opening.scope, opening.topicId);
			if (!current) {
				return Object.freeze({ status: 'superseded', topicId: opening.topicId });
			}
			this.#opening = null;
			this.#setState('failed');
			this.diagnostics.emit(Object.freeze({
				phase: 'topic-open',
				topicId: opening.topicId,
				cause,
			}));
			return Object.freeze({ status: 'failed', topicId: opening.topicId, cause });
		}
	}

	#cancelOpening(): void {
		const opening = this.#opening;
		if (!opening) return;
		this.#opening = null;
		if (!opening.controller.signal.aborted) {
			opening.controller.abort(abortReason(opening.topicId));
		}
		this.#destroyTopicScope(opening.scope, opening.topicId);
	}

	#isCurrent(opening: OpeningTopic<TContext>): boolean {
		return this.#state !== 'destroyed'
			&& this.#opening === opening
			&& this.#epoch === opening.epoch
			&& !opening.controller.signal.aborted;
	}

	#deactivateActive(reason: ReaderTopicCloseReason): Promise<boolean> {
		if (!this.#active) return Promise.resolve(true);
		if (this.#deactivation) {
			const deactivation = this.#deactivation;
			if (reason === 'switch') return deactivation;
			return deactivation.then((closed) => {
				if (closed || !this.#active) return closed;
				return this.#deactivateActive('close');
			});
		}
		const active = this.#active;
		const operation = (async (): Promise<boolean> => {
			let prepared = true;
			try {
				await active.prepareClose?.(reason);
			} catch (cause) {
				prepared = false;
				this.diagnostics.emit(Object.freeze({
					phase: 'prepare-close',
					topicId: active.topicId,
					cause,
				}));
				if (reason === 'switch') return false;
			}
			if (this.#active === active) this.#active = null;
			this.#destroyTopicScope(active.scope, active.topicId);
			return prepared;
		})();
		const deactivation = operation.finally(() => {
			if (this.#deactivation === deactivation) this.#deactivation = null;
		});
		this.#deactivation = deactivation;
		return this.#deactivation;
	}

	#destroyTopicScope(scope: LifecycleScope, topicId: DiscourseTopicId): void {
		try {
			scope.destroy();
		} catch (cause) {
			this.diagnostics.emit(Object.freeze({
				phase: 'topic-cleanup',
				topicId,
				cause,
			}));
		}
	}

	#setState(state: ReaderShellState): void {
		if (this.#state === state) return;
		this.#state = state;
		this.#syncRootVisibility();
		this.changes.emit(state);
	}

	#syncRootVisibility(): void {
		this.view.root.hidden =
			this.#state === 'idle' ||
			this.#state === 'closed' ||
			this.#state === 'destroyed';
	}

	#isDestroyed(): boolean {
		return this.#state === 'destroyed';
	}
}

/**
 * 将唯一 Shell owner 装入 ReaderApplication scope；具体 DOM 模板和 Topic factory
 * 仍由调用方的组件/领域 stage 提供。
 */
export function createReaderShellStage<
	TPreferences extends object,
	TContext,
>(
	options: ReaderShellStageOptions<TPreferences, TContext>,
): ReaderApplicationStage<TPreferences> {
	return Object.freeze({
		name: String(options.name ?? 'reader-shell').trim() || 'reader-shell',
		required: true,
		setup: (
			scope: LifecycleScope,
			context: ReaderApplicationContext<TPreferences>,
		): Cleanup => {
			const shell = new ReaderShell<TContext>(
				options.compatibilityKey(context),
				options.createView(context),
				scope,
			);
			let readyCleanup: Cleanup | undefined;
			try {
				readyCleanup = options.onReady?.(shell, context) || undefined;
			} catch (cause) {
				shell.destroy();
				throw cause;
			}
			return () => {
				try {
					readyCleanup?.();
				} finally {
					shell.destroy();
				}
			};
		},
	});
}
