import { htmlElement } from '../dom/html-element.js';

export interface VirtualStreamSlots {
	readonly root: HTMLElement;
	readonly beforeSpacer: HTMLElement;
	readonly rootList: HTMLElement;
	readonly afterSpacer: HTMLElement;
	readonly empty: HTMLElement;
	readonly loadingTip: HTMLElement;
	readonly endTip: HTMLElement;
}

export interface VirtualStreamFlowState {
	readonly loading: boolean;
	readonly done: boolean;
	readonly empty: boolean;
}

/**
 * 根虚拟流的唯一 DOM 结构 owner。
 */
export class VirtualStreamView {
	readonly slots: VirtualStreamSlots;

	constructor(document: Document) {
		const root = htmlElement(document, 'div', 'ldp-virtual-stream');
		const beforeSpacer = htmlElement(document, 'div', 'ldp-virtual-spacer ldp-virtual-spacer-before');
		const rootList = htmlElement(document, 'div', 'ldp-virtual-root-list');
		const afterSpacer = htmlElement(document, 'div', 'ldp-virtual-spacer ldp-virtual-spacer-after');
		const empty = htmlElement(document, 'div', 'ldp-comments-empty');
		const loadingTip = htmlElement(document, 'div', 'ldp-loading-tip');
		const loadingCopy = document.createElement('span');
		const endTip = htmlElement(document, 'div', 'ldp-end-tip');
		beforeSpacer.setAttribute('aria-hidden', 'true');
		afterSpacer.setAttribute('aria-hidden', 'true');
		empty.textContent = '暂无评论';
		empty.hidden = true;
		loadingCopy.textContent = '正在加载楼层…';
		loadingTip.append(loadingCopy);
		loadingTip.hidden = true;
		loadingTip.setAttribute('role', 'status');
		loadingTip.setAttribute('aria-live', 'polite');
		endTip.textContent = '已经到底了~';
		endTip.hidden = true;
		endTip.setAttribute('role', 'status');
		endTip.setAttribute('aria-live', 'polite');
		root.append(beforeSpacer, rootList, afterSpacer, empty, loadingTip, endTip);
		this.slots = Object.freeze({
			root,
			beforeSpacer,
			rootList,
			afterSpacer,
			empty,
			loadingTip,
			endTip,
		});
	}

	setSpacerSizes(before: number, after: number): void {
		const beforeSize = `${Math.max(0, before)}px`;
		const afterSize = `${Math.max(0, after)}px`;
		if (this.slots.beforeSpacer.style.blockSize !== beforeSize) {
			this.slots.beforeSpacer.style.blockSize = beforeSize;
		}
		if (this.slots.afterSpacer.style.blockSize !== afterSize) {
			this.slots.afterSpacer.style.blockSize = afterSize;
		}
	}

	setFlowState(state: VirtualStreamFlowState): void {
		this.slots.root.setAttribute('aria-busy', String(state.loading));
		this.slots.loadingTip.hidden = !state.loading;
		this.slots.loadingTip.classList.toggle('show', state.loading);
		this.slots.endTip.hidden = !state.done;
		this.slots.endTip.classList.toggle('show', state.done);
		this.slots.empty.hidden = !state.empty;
	}

	destroy(): void {
		this.slots.root.remove();
	}
}
