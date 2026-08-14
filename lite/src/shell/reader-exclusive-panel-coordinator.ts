import { LifecycleScope } from '../kernel/lifecycle.js';

export interface ReaderExclusivePanelEntry {
	readonly id: string;
	/** 同组面板并存，由共享标签栏切换 active surface。 */
	readonly coexistGroup?: string;
	readonly trigger: HTMLElement;
	readonly isOpen: () => boolean;
	readonly open: () => void | Promise<void>;
	readonly close: () => boolean | void | Promise<boolean | void>;
}

export interface ReaderExclusivePanelCoordinatorOptions {
	readonly entries: readonly ReaderExclusivePanelEntry[];
	readonly beforeOpen?: (
		target: ReaderExclusivePanelEntry,
	) => boolean | void | Promise<boolean | void>;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

/** Header 一级面板的唯一互斥事务 owner。 */
export class ReaderExclusivePanelCoordinator {
	readonly scope: LifecycleScope;
	readonly #entries: readonly ReaderExclusivePanelEntry[];
	readonly #beforeOpen: NonNullable<
		ReaderExclusivePanelCoordinatorOptions['beforeOpen']
	>;
	readonly #onError: (cause: unknown) => void;
	#epoch = 0;

	constructor(options: ReaderExclusivePanelCoordinatorOptions) {
		this.#entries = Object.freeze([...options.entries]);
		this.#beforeOpen = options.beforeOpen ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const triggers = new Set<HTMLElement>();
		for (const entry of this.#entries) {
			if (!entry.id || triggers.has(entry.trigger)) {
				throw new Error('Header 面板互斥项必须拥有唯一 id 与 trigger');
			}
			triggers.add(entry.trigger);
			this.scope.listen(entry.trigger, 'click', (event) => {
				event.preventDefault();
				event.stopImmediatePropagation();
				void this.#activate(entry);
			}, true);
		}
		this.scope.add(() => {
			this.#epoch += 1;
			for (const entry of this.#entries) {
				entry.trigger.removeAttribute('aria-busy');
			}
		});
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #activate(target: ReaderExclusivePanelEntry): Promise<void> {
		const epoch = ++this.#epoch;
		target.trigger.setAttribute('aria-busy', 'true');
		try {
			if (target.isOpen() && !target.coexistGroup) {
				await target.close();
				return;
			}
			for (const entry of this.#entries) {
				if (entry === target || !entry.isOpen()) continue;
				if (
					target.coexistGroup &&
					entry.coexistGroup === target.coexistGroup
				) continue;
				const closed = await entry.close();
				if (closed === false || epoch !== this.#epoch || this.scope.destroyed) {
					return;
				}
			}
			if (epoch !== this.#epoch || this.scope.destroyed) return;
			const ready = await this.#beforeOpen(target);
			if (ready === false || epoch !== this.#epoch || this.scope.destroyed) {
				return;
			}
			await target.open();
		} catch (cause) {
			if (!this.scope.destroyed && epoch === this.#epoch) this.#onError(cause);
		} finally {
			if (epoch === this.#epoch) target.trigger.removeAttribute('aria-busy');
		}
	}
}
