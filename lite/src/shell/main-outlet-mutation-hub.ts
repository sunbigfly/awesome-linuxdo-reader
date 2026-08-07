import type { LifecycleScope } from '../kernel/lifecycle.js';

export interface MainOutletMutationBatch {
	readonly root: Element | null;
	readonly rootChanged: boolean;
	readonly records: readonly MutationRecord[];
}

export interface MainOutletMutationHubOptions {
	readonly document: Document;
	readonly createObserver?: (
		callback: MutationCallback,
	) => Pick<MutationObserver, 'observe' | 'disconnect'>;
	readonly onListenerError?: (error: unknown) => void;
}

export type MainOutletMutationListener = (batch: MainOutletMutationBatch) => void;

const MAIN_OUTLET_SELECTORS = Object.freeze([
	'#main-outlet',
	'.list-container,.topic-list,.latest-topic-list',
	'#ember-app',
]);

function mainOutlet(documentPort: Document): Element | null {
	for (const selector of MAIN_OUTLET_SELECTORS) {
		const root = documentPort.querySelector(selector);
		if (root) return root;
	}
	return null;
}

/**
 * Discourse 主 outlet DOM 变化的唯一共享 observer。
 *
 * 第一位订阅者出现时安装，最后一位离开时释放；路由替换 outlet 时只重定向同一个 observer，
 * 消费者不再各自扫描 body 或维护重复 MutationObserver。
 */
export class MainOutletMutationHub {
	readonly #document: Document;
	readonly #createObserver: NonNullable<MainOutletMutationHubOptions['createObserver']>;
	readonly #onListenerError: (error: unknown) => void;
	readonly #listeners = new Set<MainOutletMutationListener>();
	#observer: Pick<MutationObserver, 'observe' | 'disconnect'> | null = null;
	#root: Element | null = null;
	#destroyed = false;

	constructor(options: MainOutletMutationHubOptions) {
		this.#document = options.document;
		this.#createObserver = options.createObserver ??
			((callback) => new MutationObserver(callback));
		this.#onListenerError = options.onListenerError ?? (() => {});
	}

	get currentRoot(): Element | null {
		return this.#root;
	}

	subscribe(
		listener: MainOutletMutationListener,
		scope?: LifecycleScope,
	): () => void {
		if (this.#destroyed) throw new Error('MainOutletMutationHub 已销毁');
		this.#listeners.add(listener);
		if (this.#listeners.size === 1) this.#start();
		this.#notifyOne(listener, Object.freeze({
			root: this.#root,
			rootChanged: true,
			records: Object.freeze([]),
		}));
		let active = true;
		const unsubscribe = () => {
			if (!active) return;
			active = false;
			this.#listeners.delete(listener);
			if (!this.#listeners.size) this.#stop();
		};
		scope?.add(unsubscribe);
		return unsubscribe;
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.#listeners.clear();
		this.#stop();
	}

	#start(): void {
		if (this.#observer || !this.#document.body) return;
		this.#observer = this.#createObserver((records) => this.#receive(records));
		this.#retarget();
	}

	#stop(): void {
		this.#observer?.disconnect();
		this.#observer = null;
		this.#root = null;
	}

	#retarget(): boolean {
		const observer = this.#observer;
		const body = this.#document.body;
		if (!observer || !body) return false;
		const nextRoot = mainOutlet(this.#document);
		if (this.#root === nextRoot && nextRoot?.isConnected) return false;
		observer.disconnect();
		observer.observe(body, { childList: true });
		if (nextRoot) {
			let ancestor = nextRoot.parentElement;
			while (ancestor && ancestor !== body) {
				observer.observe(ancestor, { childList: true });
				ancestor = ancestor.parentElement;
			}
			observer.observe(nextRoot, {
				childList: true,
				subtree: true,
				characterData: true,
			});
		}
		this.#root = nextRoot;
		return true;
	}

	#receive(records: readonly MutationRecord[]): void {
		if (this.#destroyed || !this.#listeners.size) return;
		const body = this.#document.body;
		const shouldRetarget = records.some((record) =>
			record.target === body ||
			!this.#root?.isConnected ||
			!this.#root.contains(record.target),
		);
		const rootChanged = shouldRetarget ? this.#retarget() : false;
		const batch = Object.freeze({
			root: this.#root,
			rootChanged,
			records: Object.freeze([...records]),
		});
		for (const listener of [...this.#listeners]) this.#notifyOne(listener, batch);
	}

	#notifyOne(listener: MainOutletMutationListener, batch: MainOutletMutationBatch): void {
		try {
			listener(batch);
		} catch (error) {
			this.#onListenerError(error);
		}
	}
}
