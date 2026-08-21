import { htmlElement } from '../dom/html-element.js';

export interface VirtualStreamSlots {
	readonly root: HTMLElement;
	readonly beforeSpacer: HTMLElement;
	readonly beforeGapPlaceholder: HTMLElement;
	readonly rootList: HTMLElement;
	readonly afterSpacer: HTMLElement;
	readonly afterGapPlaceholder: HTMLElement;
	readonly empty: HTMLElement;
	readonly loadingTip: HTMLElement;
	readonly endTip: HTMLElement;
}

export interface VirtualStreamFlowState {
	readonly loading: boolean;
	readonly done: boolean;
	readonly empty: boolean;
}

export interface VirtualStreamGapPlaceholderState {
	readonly side: 'before' | 'after';
	readonly targetPostNumber: number;
}

function gapPlaceholder(document: Document, side: 'before' | 'after'): HTMLElement {
	const root = htmlElement(document, 'div', 'ldp-virtual-gap-placeholder');
	const avatar = htmlElement(document, 'span', 'ldp-virtual-gap-skeleton-avatar');
	const body = htmlElement(document, 'span', 'ldp-virtual-gap-skeleton-body');
	const line = htmlElement(document, 'span', 'ldp-virtual-gap-skeleton-line');
	const shortLine = htmlElement(
		document,
		'span',
		'ldp-virtual-gap-skeleton-line ldp-virtual-gap-skeleton-line-short',
	);
	const label = htmlElement(document, 'span', 'ldp-virtual-gap-label');
	avatar.setAttribute('aria-hidden', 'true');
	line.setAttribute('aria-hidden', 'true');
	shortLine.setAttribute('aria-hidden', 'true');
	label.textContent = '正在加载附近楼层…';
	body.append(line, shortLine, label);
	root.append(avatar, body);
	root.hidden = true;
	root.setAttribute('data-gap-side', side);
	root.setAttribute('role', 'status');
	root.setAttribute('aria-live', 'polite');
	return root;
}

/**
 * 根虚拟流的唯一 DOM 结构 owner。
 */
export class VirtualStreamView {
	readonly slots: VirtualStreamSlots;
	#endTipRevealed = false;

	constructor(document: Document) {
		const root = htmlElement(document, 'div', 'ldp-virtual-stream');
		const beforeSpacer = htmlElement(document, 'div', 'ldp-virtual-spacer ldp-virtual-spacer-before');
		const beforeGapPlaceholder = gapPlaceholder(document, 'before');
		const rootList = htmlElement(document, 'div', 'ldp-virtual-root-list');
		const afterSpacer = htmlElement(document, 'div', 'ldp-virtual-spacer ldp-virtual-spacer-after');
		const afterGapPlaceholder = gapPlaceholder(document, 'after');
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
		endTip.textContent = '已经见底了~';
		endTip.hidden = true;
		endTip.setAttribute('role', 'status');
		endTip.setAttribute('aria-live', 'polite');
		beforeSpacer.append(beforeGapPlaceholder);
		afterSpacer.append(afterGapPlaceholder);
		root.append(beforeSpacer, rootList, afterSpacer, empty, loadingTip, endTip);
		this.slots = Object.freeze({
			root,
			beforeSpacer,
			beforeGapPlaceholder,
			rootList,
			afterSpacer,
			afterGapPlaceholder,
			empty,
			loadingTip,
			endTip,
		});
	}

	setGapPlaceholder(state: VirtualStreamGapPlaceholderState | null): void {
		for (const [side, spacer, placeholder] of [
			['before', this.slots.beforeSpacer, this.slots.beforeGapPlaceholder],
			['after', this.slots.afterSpacer, this.slots.afterGapPlaceholder],
		] as const) {
			const visible = state?.side === side;
			placeholder.hidden = !visible;
			spacer.classList.toggle('has-gap-placeholder', visible);
			if (!visible) {
				spacer.setAttribute('aria-hidden', 'true');
				placeholder.removeAttribute('data-target-post-number');
				continue;
			}
			spacer.removeAttribute('aria-hidden');
			placeholder.setAttribute(
				'data-target-post-number',
				String(state.targetPostNumber),
			);
		}
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
		const showEndTip = state.done || this.#endTipRevealed;
		this.slots.endTip.hidden = !showEndTip;
		this.slots.endTip.classList.toggle('show', showEndTip);
		this.slots.empty.hidden = !state.empty;
	}

	revealEndTip(): void {
		this.#endTipRevealed = true;
		this.slots.endTip.hidden = false;
		this.slots.endTip.classList.add('show');
	}

	destroy(): void {
		this.slots.root.remove();
	}
}
