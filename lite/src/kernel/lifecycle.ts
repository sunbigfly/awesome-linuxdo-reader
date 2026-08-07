export type Cleanup = () => void;

/**
 * 轻量、可组合且反向释放的生命周期作用域。
 *
 * 每个业务 owner 只向自己的 scope 登记监听器、observer、frame、timer 和子 scope。
 * destroy 可重复调用；新增到已销毁 scope 的 cleanup 会立即执行，避免晚到任务泄漏。
 */
export class LifecycleScope {
	#cleanups: Cleanup[] = [];
	#destroyed = false;

	/**
	 * 为业务 owner 创建唯一作用域：有父级时建立受控 child，否则建立独立 root。
	 */
	static ownedBy(parent?: LifecycleScope): LifecycleScope {
		return parent ? parent.child() : new LifecycleScope();
	}

	get destroyed(): boolean {
		return this.#destroyed;
	}

	add(cleanup: Cleanup): Cleanup {
		let active = true;
		const runOnce = (): void => {
			if (!active) return;
			active = false;
			const index = this.#cleanups.indexOf(runOnce);
			if (index >= 0) this.#cleanups.splice(index, 1);
			cleanup();
		};
		if (this.#destroyed) {
			runOnce();
			return runOnce;
		}
		this.#cleanups.push(runOnce);
		return runOnce;
	}

	child(): LifecycleScope {
		const child = new LifecycleScope();
		const detach = this.add(() => child.destroy());
		child.add(detach);
		return child;
	}

	/** 创建由本 scope 独占、可选转发上游取消原因的 AbortController。 */
	abortController(
		destroyReason: unknown,
		upstream?: AbortSignal,
	): AbortController {
		const controller = new AbortController();
		const abort = (reason: unknown): void => {
			if (!controller.signal.aborted) controller.abort(reason);
		};
		const forwardAbort = (): void => abort(upstream?.reason);
		if (upstream?.aborted) forwardAbort();
		else upstream?.addEventListener('abort', forwardAbort, { once: true });
		this.add(() => {
			upstream?.removeEventListener('abort', forwardAbort);
			abort(destroyReason);
		});
		return controller;
	}

	listen(
		target: EventTarget,
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): Cleanup {
		target.addEventListener(type, listener, options);
		return this.add(() => target.removeEventListener(type, listener, options));
	}

	observe(observer: { disconnect(): void }, target?: Element, options?: unknown): Cleanup {
		if (target && 'observe' in observer && typeof observer.observe === 'function') {
			observer.observe(target, options);
		}
		return this.add(() => observer.disconnect());
	}

	timer(timerId: number, clear: (id: number) => void = clearTimeout): Cleanup {
		return this.add(() => clear(timerId));
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		const errors: unknown[] = [];
		const cleanups = this.#cleanups.splice(0);
		for (let index = cleanups.length - 1; index >= 0; index -= 1) {
			try {
				cleanups[index]!();
			} catch (error) {
				errors.push(error);
			}
		}
		if (errors.length) throw new AggregateError(errors, 'LifecycleScope cleanup failed');
	}
}
