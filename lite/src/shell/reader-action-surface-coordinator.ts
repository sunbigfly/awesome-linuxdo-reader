import { LifecycleScope } from '../kernel/lifecycle.js';

export interface ReaderActionSurfaceCoordinatorOptions {
	readonly parentScope?: LifecycleScope;
}

interface ActiveActionSurface {
	readonly token: symbol;
	readonly close: () => void;
}

/**
 * Shell 操作弹层的唯一互斥 owner。
 *
 * 对齐 main.js 的 `ctx.readerActionDialog`：确认、举报和指定共用一个活动槽，
 * 后来的弹层会先原子取消前一个弹层。领域 surface 仍各自拥有 DOM 与 Promise 生命周期，
 * 本协调器只负责跨类型互斥，避免并存、晚到释放误关新弹层和悬挂 Promise。
 * 主题编辑对应主线预建的 `.ldp-topic-edit-layer`，不占用此活动槽。
 */
export class ReaderActionSurfaceCoordinator {
	readonly scope: LifecycleScope;
	#active: ActiveActionSurface | null = null;

	constructor(options: ReaderActionSurfaceCoordinatorOptions = {}) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.closeActive();
		});
	}

	get active(): boolean {
		return this.#active !== null;
	}

	claim(close: () => void): () => void {
		if (this.scope.destroyed) {
			throw new Error('ReaderActionSurfaceCoordinator 已销毁');
		}
		const previous = this.#active;
		this.#active = null;
		previous?.close();

		const token = Symbol('reader-action-surface');
		this.#active = { token, close };
		let released = false;
		return () => {
			if (released) return;
			released = true;
			if (this.#active?.token === token) this.#active = null;
		};
	}

	destroy(): void {
		this.scope.destroy();
	}

	closeActive(): boolean {
		const active = this.#active;
		this.#active = null;
		active?.close();
		return active !== null;
	}
}
