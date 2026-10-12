export interface PostViewOwnRegion {
	readonly boundary: HTMLElement | null;
	readonly rect: Pick<DOMRect, 'top' | 'bottom' | 'height'>;
}

/** 楼层自身的头部与正文边界，排除作为同级 slot 挂载的子回复树。 */
export function readPostViewOwnRegion(target: HTMLElement): PostViewOwnRegion {
	const targetRect = target.getBoundingClientRect();
	let boundary: HTMLElement | null = null;
	let height = targetRect.height;
	if (target.classList.contains('ldp-post')) {
		const actions = target.dataset.postNumber === '1'
			? target.querySelector<HTMLElement>(
				':scope > .ldp-post-body > .ldp-reactions, :scope > .ldp-reactions',
			)
			: null;
		const candidates = [
			actions,
			target.querySelector<HTMLElement>(':scope > .ldp-post-body'),
			target.querySelector<HTMLElement>(':scope > .ldp-post-head'),
		];
		for (const candidate of candidates) {
			if (!candidate) continue;
			const boundaryRect = candidate.getBoundingClientRect();
			if (boundaryRect.height <= 0 || boundaryRect.bottom <= targetRect.top) continue;
			boundary = candidate;
			height = Math.min(targetRect.height, boundaryRect.bottom - targetRect.top);
			break;
		}
	}
	return Object.freeze({
		boundary,
		rect: Object.freeze({
			top: targetRect.top,
			bottom: targetRect.top + height,
			height,
		}),
	});
}
