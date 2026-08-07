import { eventElement } from './event-target.js';

export interface FloatingSurfaceWheelStyle {
	readonly overflowX: string;
	readonly overflowY: string;
}

export interface FloatingSurfaceWheelEnvironment {
	readonly style?: (element: Element) => FloatingSurfaceWheelStyle;
}

function defaultStyle(element: Element): FloatingSurfaceWheelStyle {
	const view = element.ownerDocument.defaultView;
	if (typeof view?.getComputedStyle === 'function') {
		return view.getComputedStyle(element);
	}
	return { overflowX: '', overflowY: '' };
}

function wheelDelta(
	event: WheelEvent,
	surface: HTMLElement,
): Readonly<{ x: number; y: number }> {
	const lineScale = 40;
	if (event.deltaMode === 1) {
		return { x: event.deltaX * lineScale, y: event.deltaY * lineScale };
	}
	if (event.deltaMode === 2) {
		return {
			x: event.deltaX * surface.clientWidth,
			y: event.deltaY * surface.clientHeight,
		};
	}
	return { x: event.deltaX, y: event.deltaY };
}

/**
 * Reader 浮层滚轮边界的唯一 DOM 原语。
 *
 * 浮层内部仍有可滚动祖先时保留浏览器原生滚动；抵达所有内部边界后阻止默认行为，避免滚轮继续
 * 驱动 Reader 主流。它不拥有监听器，调用方必须通过自身 LifecycleScope 或节点生命周期绑定。
 */
export function containFloatingSurfaceWheel(
	surface: HTMLElement,
	event: WheelEvent,
	environment: FloatingSurfaceWheelEnvironment = {},
): void {
	event.stopPropagation();
	const target = eventElement(event);
	const { x: deltaX, y: deltaY } = wheelDelta(event, surface);
	if (!target || !surface.contains(target)) {
		if (deltaX || deltaY) event.preventDefault();
		return;
	}
	const style = environment.style ?? defaultStyle;
	let scrollTarget: HTMLElement | null = target as HTMLElement;
	while (scrollTarget && surface.contains(scrollTarget)) {
		const computed = style(scrollTarget);
		const maxScrollLeft = scrollTarget.scrollWidth - scrollTarget.clientWidth;
		const maxScrollTop = scrollTarget.scrollHeight - scrollTarget.clientHeight;
		const canScrollX = Boolean(
			deltaX &&
			maxScrollLeft > 1 &&
			/(auto|scroll|overlay)/.test(computed.overflowX) &&
			(deltaX < 0
				? scrollTarget.scrollLeft > 0
				: scrollTarget.scrollLeft < maxScrollLeft - 1),
		);
		const canScrollY = Boolean(
			deltaY &&
			maxScrollTop > 1 &&
			/(auto|scroll|overlay)/.test(computed.overflowY) &&
			(deltaY < 0
				? scrollTarget.scrollTop > 0
				: scrollTarget.scrollTop < maxScrollTop - 1),
		);
		if (canScrollX || canScrollY) return;
		if (scrollTarget === surface) break;
		scrollTarget = scrollTarget.parentElement;
	}
	if (deltaX || deltaY) event.preventDefault();
}
