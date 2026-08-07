import {
	LifecycleScope,
	type Cleanup,
} from '../kernel/lifecycle.js';
import {
	discoursePostId,
	discoursePostNumber,
	type DiscoursePostId,
} from '../discourse/identifiers.js';
import type { PostNumber } from './reply-tree.js';
import type {
	PostActionViewManifestSnapshot,
} from '../post/post-action-manifest-controller.js';
import { htmlElement as createHtmlElement } from './html-element.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

export interface PostViewIdentity {
	readonly postId: number;
	readonly postNumber: PostNumber;
	readonly username: string;
	readonly createdAt?: string;
}

export interface PostViewSlots {
	readonly root: HTMLElement;
	readonly header: HTMLElement;
	readonly body: HTMLElement;
	readonly content: HTMLElement;
	readonly bodyLayer: HTMLElement | null;
	readonly boost: HTMLElement | null;
	readonly actions: HTMLElement | null;
	readonly topicFooter: HTMLElement | null;
	readonly replyTree: HTMLElement | null;
	readonly branchOverlay: SVGSVGElement | null;
	readonly replyControls: HTMLElement | null;
	readonly replyList: HTMLElement | null;
}

export interface OwnedPostViewSlots extends PostViewSlots {
	readonly bodyLayer: HTMLElement;
	readonly boost: HTMLElement;
	readonly actions: HTMLElement;
	readonly topicFooter: HTMLElement;
	readonly replyTree: HTMLElement;
	readonly branchOverlay: SVGSVGElement;
	readonly replyControls: HTMLElement;
	readonly replyList: HTMLElement;
}

export interface PostActionManifestSource {
	snapshot(): PostActionViewManifestSnapshot;
	subscribe(
		listener: (snapshot: PostActionViewManifestSnapshot) => void,
		scope?: LifecycleScope,
	): Cleanup;
}

export type PostActionManifestRenderer = (
	slots: OwnedPostViewSlots,
	snapshot: PostActionViewManifestSnapshot,
) => void;

/**
 * 一个楼层的唯一结构所有者。
 *
 * 它只创建和释放命名槽位，不解释 cooked 内容、不请求数据、不挂载子孙楼层。
 */
export class PostView {
	readonly identity: PostViewIdentity;
	readonly scope: LifecycleScope;
	readonly slots: OwnedPostViewSlots;
	#unbindActionManifest: Cleanup | null = null;

	constructor(document: Document, identity: PostViewIdentity, parentScope?: LifecycleScope) {
		const postId: DiscoursePostId = discoursePostId(identity.postId);
		const postNumber = discoursePostNumber(identity.postNumber);
		this.identity = Object.freeze({ ...identity, postId, postNumber });
		this.scope = LifecycleScope.ownedBy(parentScope);

		const root = createHtmlElement(document, 'article', 'ldp-post');
		root.dataset.postId = String(postId);
		root.dataset.postNumber = String(postNumber);
		root.dataset.username = identity.username;
		if (identity.createdAt) root.dataset.createdAt = identity.createdAt;

		const header = createHtmlElement(document, 'header', 'ldp-post-head');
		const body = createHtmlElement(document, 'div', 'ldp-post-body');
		const content = createHtmlElement(document, 'div', 'ldp-content cooked');
		const bodyLayer = createHtmlElement(document, 'div', 'ldp-post-body-layer');
		const boost = createHtmlElement(document, 'div', 'ldp-boost-list');
		boost.hidden = true;
		const actions = createHtmlElement(document, 'div', 'ldp-reactions ldp-post-actions');
		const topicFooter = createHtmlElement(document, 'footer', 'ldp-topic-footer-slot');
		topicFooter.hidden = true;
		body.append(content, bodyLayer, boost, actions, topicFooter);

		const replyTree = createHtmlElement(document, 'section', 'ldp-children ldp-reply-tree');
		const branchOverlay = document.createElementNS(SVG_NAMESPACE, 'svg') as SVGSVGElement;
		branchOverlay.classList.add('ldp-branch-overlay');
		branchOverlay.setAttribute('hidden', '');
		branchOverlay.setAttribute('aria-hidden', 'true');
		branchOverlay.setAttribute('focusable', 'false');
		const visiblePath = document.createElementNS(SVG_NAMESPACE, 'path');
		visiblePath.classList.add('ldp-branch-visible-path');
		const hitPath = document.createElementNS(SVG_NAMESPACE, 'path');
		hitPath.classList.add('ldp-branch-hit-path');
		branchOverlay.append(visiblePath, hitPath);
		const replyControls = createHtmlElement(document, 'div', 'ldp-reply-controls ldp-sub-actions');
		const replyList = createHtmlElement(document, 'div', 'ldp-reply-list');
		// main.js 的完整讨论/分页操作属于整条已内联子树的尾部，
		// 不得插在父楼层与第一个子楼层之间。
		replyTree.append(branchOverlay, replyList, replyControls);
		root.append(header, body, replyTree);

		this.slots = Object.freeze({
			root,
			header,
			body,
			content,
			bodyLayer,
			boost,
			actions,
			topicFooter,
			replyTree,
			branchOverlay,
			replyControls,
			replyList,
		});
	}

	get postNumber(): PostNumber {
		return this.identity.postNumber;
	}

	setTreePosition(parentPostNumber: PostNumber | null, depth: number | undefined): void {
		if (parentPostNumber !== null) discoursePostNumber(parentPostNumber);
		if (
			depth !== undefined &&
			(!Number.isSafeInteger(depth) || depth < 0)
		) {
			throw new RangeError('depth 必须是非负安全整数或 undefined');
		}
		const parentValue = parentPostNumber === null
			? undefined
			: String(parentPostNumber);
		if (parentValue === undefined) {
			if (this.slots.root.dataset.parentPostNumber !== undefined) {
				delete this.slots.root.dataset.parentPostNumber;
			}
		} else if (this.slots.root.dataset.parentPostNumber !== parentValue) {
			this.slots.root.dataset.parentPostNumber = parentValue;
		}
		const depthValue = depth === undefined ? undefined : String(depth);
		if (depthValue === undefined) {
			if (this.slots.root.dataset.ldpNestDepth !== undefined) {
				delete this.slots.root.dataset.ldpNestDepth;
			}
		} else if (this.slots.root.dataset.ldpNestDepth !== depthValue) {
			this.slots.root.dataset.ldpNestDepth = depthValue;
		}
		const nested = depth !== undefined && depth > 0;
		if (this.slots.root.classList.contains('ldp-nested-preview') !== nested) {
			this.slots.root.classList.toggle('ldp-nested-preview', nested);
		}
		if (nested && this.slots.root.classList.contains('ldp-zebra-alt')) {
			this.slots.root.classList.remove('ldp-zebra-alt');
		}
	}

	/**
	 * 将普通、嵌套、实时新增和回屏楼层接到同一份动作状态。
	 *
	 * PostView 只提供命名槽位与生命周期；具体按钮 DOM 仍由 renderer 组件拥有。
	 */
	bindActionManifest(
		source: PostActionManifestSource,
		renderer: PostActionManifestRenderer,
	): Cleanup {
		this.#unbindActionManifest?.();
		renderer(this.slots, source.snapshot());
		const unsubscribe = source.subscribe((snapshot) => {
			renderer(this.slots, snapshot);
		}, this.scope);
		let active = true;
		const cleanup = (): void => {
			if (!active) return;
			active = false;
			unsubscribe();
			if (this.#unbindActionManifest === cleanup) {
				this.#unbindActionManifest = null;
			}
		};
		this.#unbindActionManifest = cleanup;
		this.scope.add(cleanup);
		return cleanup;
	}

	destroy(): void {
		try {
			this.scope.destroy();
		} finally {
			this.slots.root.remove();
		}
	}
}
