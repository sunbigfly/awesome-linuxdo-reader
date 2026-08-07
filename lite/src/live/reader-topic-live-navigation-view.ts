import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderTopicLiveNavigationController,
	ReaderTopicLiveNavigationSnapshot,
} from './reader-topic-live-navigation-controller.js';

export interface ReaderTopicLiveNavigationViewElements {
	readonly root: HTMLElement;
	readonly jump: HTMLButtonElement;
	readonly label: HTMLElement;
	readonly dismiss: HTMLButtonElement;
}

export interface ReaderTopicLiveNavigationViewOptions<TTopic, TPost> {
	readonly navigation: ReaderTopicLiveNavigationController<TTopic, TPost>;
	readonly elements: ReaderTopicLiveNavigationViewElements;
	readonly notify?: (message: string) => void;
	readonly parentScope?: LifecycleScope;
}

/**
 * 当前 Topic 新回复胶囊的唯一 DOM owner。
 *
 * View 只消费 live navigation snapshot，并把查看/关闭交还 controller；不订阅 MessageBus、
 * 不读取帖子、不清理队列、不请求目标，也不自行滚动。
 */
export class ReaderTopicLiveNavigationView<TTopic, TPost> {
	readonly scope: LifecycleScope;
	readonly #navigation: ReaderTopicLiveNavigationController<TTopic, TPost>;
	readonly #elements: ReaderTopicLiveNavigationViewElements;
	readonly #notify: (message: string) => void;

	constructor(
		options: ReaderTopicLiveNavigationViewOptions<TTopic, TPost>,
	) {
		this.#navigation = options.navigation;
		this.#elements = options.elements;
		this.#notify = options.notify ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.listen(this.#elements.jump, 'click', () => {
			this.#jump();
		});
		this.scope.listen(this.#elements.dismiss, 'click', () => {
			this.#navigation.dismiss();
		});
		this.#navigation.changes.subscribe((snapshot) => {
			this.#sync(snapshot);
		}, this.scope);
		this.scope.add(() => {
			this.#elements.root.hidden = true;
			this.#elements.root.removeAttribute('aria-busy');
			this.#elements.label.textContent = '';
		});
		this.#sync(this.#navigation.snapshot);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#sync(snapshot: ReaderTopicLiveNavigationSnapshot): void {
		const hidden =
			snapshot.pendingCount <= 0 ||
			snapshot.dismissed ||
			snapshot.targetPostNumber === null;
		if (this.#elements.root.hidden !== hidden) {
			this.#elements.root.hidden = hidden;
		}
		const busy = String(snapshot.jumping);
		if (this.#elements.root.getAttribute('aria-busy') !== busy) {
			this.#elements.root.setAttribute('aria-busy', busy);
		}
		const disabled = snapshot.jumping || hidden;
		if (this.#elements.jump.disabled !== disabled) {
			this.#elements.jump.disabled = disabled;
		}
		if (this.#elements.dismiss.disabled !== disabled) {
			this.#elements.dismiss.disabled = disabled;
		}
		const label = snapshot.pendingCount === 1
			? '查看 1 个新回复'
			: `查看 ${snapshot.pendingCount} 个新回复`;
		const labelText = hidden ? '' : label;
		if (this.#elements.label.textContent !== labelText) {
			this.#elements.label.textContent = labelText;
		}
		const ariaLabel = snapshot.targetPostNumber === null
			? '查看新回复'
			: `${label}，从楼层 #${snapshot.targetPostNumber} 开始`;
		if (this.#elements.jump.getAttribute('aria-label') !== ariaLabel) {
			this.#elements.jump.setAttribute('aria-label', ariaLabel);
		}
	}

	#jump(): void {
		if (this.#navigation.snapshot.jumping) return;
		void this.#navigation.jumpPending().then((result) => {
			if (this.scope.destroyed) return;
			if (
				result &&
				result.status !== 'revealed' &&
				result.status !== 'superseded'
			) {
				this.#notify('新回复暂时无法定位，请重试');
			}
		}).catch(() => {
			if (this.scope.destroyed) return;
			this.#notify('新回复加载失败，请重试');
		});
	}
}
