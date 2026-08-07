import type { Cleanup, LifecycleScope } from './lifecycle.js';

export type SignalListener<T> = (value: T) => void;

/**
 * 同步、可释放的小型事件端口。
 *
 * listener 错误会被收集并返回，不会阻止同一提交中的其他 listener；业务 owner 决定如何记录。
 */
export class Signal<T> {
	#listeners = new Set<SignalListener<T>>();

	get size(): number {
		return this.#listeners.size;
	}

	subscribe(listener: SignalListener<T>, scope?: LifecycleScope): Cleanup {
		this.#listeners.add(listener);
		const unsubscribe = () => {
			this.#listeners.delete(listener);
		};
		if (scope) scope.add(unsubscribe);
		return unsubscribe;
	}

	emit(value: T): readonly unknown[] {
		const errors: unknown[] = [];
		for (const listener of [...this.#listeners]) {
			try {
				listener(value);
			} catch (error) {
				errors.push(error);
			}
		}
		return Object.freeze(errors);
	}

	clear(): void {
		this.#listeners.clear();
	}
}
