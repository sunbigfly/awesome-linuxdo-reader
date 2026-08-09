import type {
	ReplyTreeDomCommit,
	ReplyTreeDomMountPlan,
	ReplyTreeDomOwner,
} from '../dom/reply-tree-dom-owner.js';
import type { ReplyTreeRepository } from '../dom/reply-tree-repository.js';
import type { PostNumber } from '../dom/reply-tree.js';
import type {
	VirtualRootLayout,
	VirtualRootWindow,
	VirtualWindowInput,
} from './virtual-root-layout.js';
import type { VirtualStreamView } from './virtual-stream-view.js';

export interface VirtualStreamDomCommit {
	readonly window: VirtualRootWindow;
	readonly tree: ReplyTreeDomCommit;
	readonly attachedRoots: readonly PostNumber[];
	readonly detachedRoots: readonly PostNumber[];
}

export interface VirtualStreamDomControllerOptions {
	readonly prepareRoots?: (
		postNumbers: readonly PostNumber[],
		input: VirtualWindowInput,
		window: VirtualRootWindow,
	) => ReplyTreeDomMountPlan | undefined;
	readonly roots?: () => readonly PostNumber[];
}

/**
 * 根楼层虚拟窗口的唯一 DOM 挂载 owner。
 *
 * 离屏根视图保存在内存中；其子孙仍由 ReplyTreeDomOwner 持有并依据拓扑停放。
 */
export class VirtualStreamDomController {
	readonly repository: ReplyTreeRepository;
	readonly layout: VirtualRootLayout;
	readonly streamView: VirtualStreamView;
	readonly domOwner: ReplyTreeDomOwner;
	readonly #prepareRoots: (
		postNumbers: readonly PostNumber[],
		input: VirtualWindowInput,
		window: VirtualRootWindow,
	) => ReplyTreeDomMountPlan | undefined;
	readonly #roots: () => readonly PostNumber[];
	#connectedRoots: ReadonlySet<PostNumber> = new Set();
	#committed = false;

	constructor(
		repository: ReplyTreeRepository,
		layout: VirtualRootLayout,
		streamView: VirtualStreamView,
		domOwner: ReplyTreeDomOwner,
		options: VirtualStreamDomControllerOptions = {},
	) {
		if (streamView.slots.rootList !== domOwner.rootList) {
			throw new Error('ReplyTreeDomOwner 必须挂载到 VirtualStreamView.rootList');
		}
		this.repository = repository;
		this.layout = layout;
		this.streamView = streamView;
		this.domOwner = domOwner;
		this.#prepareRoots = options.prepareRoots ?? (() => {});
		this.#roots = options.roots ?? (() => repository.topology.roots());
	}

	commit(input: VirtualWindowInput): VirtualStreamDomCommit {
		const window = this.layout.window(input);
		const mountPlan = this.#prepareRoots(window.postNumbers, input, window);
		const desired = new Set(window.postNumbers);
		const connectedBefore = this.#committed
			? this.#connectedRoots
			: new Set(this.#roots().filter((postNumber) => {
				const root = this.domOwner.view(postNumber)?.slots.root;
				return !!root && this.streamView.slots.rootList.contains(root);
			}));
		const tree = this.domOwner.sync(desired, mountPlan);
		for (let index = 0; index < window.postNumbers.length; index += 1) {
			const postNumber = window.postNumbers[index]!;
			const root = this.domOwner.view(postNumber)?.slots.root;
			const zebra = (window.startIndex + index) % 2 === 1;
			if (root?.classList.contains('ldp-zebra-alt') !== zebra) {
				root?.classList.toggle('ldp-zebra-alt', zebra);
			}
			const beforeZebra =
				index + 1 < window.postNumbers.length &&
				(window.startIndex + index + 1) % 2 === 1;
			if (root?.classList.contains('ldp-before-zebra') !== beforeZebra) {
				root?.classList.toggle('ldp-before-zebra', beforeZebra);
			}
		}
		const connectedAfter = new Set(
			[...desired].filter(
				(postNumber) => {
					const root = this.domOwner.view(postNumber)?.slots.root;
					return !!root && this.streamView.slots.rootList.contains(root);
				},
			),
		);
		const attachedRoots = [...connectedAfter]
			.filter((postNumber) => !connectedBefore.has(postNumber));
		const detachedRoots = [...connectedBefore]
			.filter((postNumber) => !connectedAfter.has(postNumber));
		this.#connectedRoots = connectedAfter;
		this.#committed = true;
		const firstRootInset = window.postNumbers[0] === undefined
			? undefined
			: mountPlan?.rootVirtualInsets?.get(window.postNumbers[0]);
		const lastRootPostNumber = window.postNumbers.at(-1);
		const lastRootInset = lastRootPostNumber === undefined
			? undefined
			: mountPlan?.rootVirtualInsets?.get(lastRootPostNumber);
		this.streamView.setSpacerSizes(
			window.beforeSpacer + (firstRootInset?.beforeSize ?? 0),
			window.afterSpacer + (lastRootInset?.afterSize ?? 0),
		);
		return Object.freeze({
			window,
			tree,
			attachedRoots: Object.freeze(
				attachedRoots.sort((left, right) => left - right),
			),
			detachedRoots: Object.freeze(
				detachedRoots.sort((left, right) => left - right),
			),
		});
	}

}
