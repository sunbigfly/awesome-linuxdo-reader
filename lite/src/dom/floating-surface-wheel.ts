import { eventElement, eventPathIncludes } from './event-target.js';
import type { Cleanup } from '../kernel/lifecycle.js';

export interface FloatingSurfaceWheelStyle {
	readonly overflowX: string;
	readonly overflowY: string;
}

export interface FloatingSurfaceWheelEnvironment {
	readonly style?: (element: Element) => FloatingSurfaceWheelStyle;
}

export interface FloatingSurfaceWheelBindingOptions {
	/** surface 本身的监听阶段；原生编辑器等需要先于子节点处理时可启用。 */
	readonly capture?: boolean;
	/**
	 * 捕获已从宿主元素开始、但指针随后进入浮层的同一段滚轮事务。
	 * 默认开启；关闭只应用于明确需要保留宿主滚轮锁定语义的 surface。
	 */
	readonly captureLatchedTarget?: boolean;
}

interface FloatingSurfaceBindingCount {
	total: number;
	latchedTarget: number;
}

interface FloatingSurfaceDocumentBinding {
	readonly document: Document;
	readonly surfaces: Map<HTMLElement, FloatingSurfaceBindingCount>;
	readonly onWheel: (event: Event) => void;
}

const DOCUMENT_WHEEL_OPTIONS: AddEventListenerOptions = {
	capture: true,
	passive: false,
};
const boundFloatingSurfaces = new WeakMap<
	Document,
	FloatingSurfaceDocumentBinding
>();

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

function floatingSurfaceAtWheelPoint(
	binding: FloatingSurfaceDocumentBinding,
	event: WheelEvent,
): HTMLElement | null {
	const x = Number(event.clientX);
	const y = Number(event.clientY);
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	const candidates = [...binding.surfaces]
		.filter(([surface, count]) =>
			count.latchedTarget > 0 && !surface.hidden && surface.isConnected)
		.reverse();
	const hits = new Map<Node, Element | null>();
	let canHitTest = false;
	for (const [surface] of candidates) {
		const root = surface.getRootNode() as Node & Readonly<{
			elementFromPoint?: (clientX: number, clientY: number) => Element | null;
		}>;
		const tester = typeof root.elementFromPoint === 'function'
			? root.elementFromPoint.bind(root)
			: typeof binding.document.elementFromPoint === 'function'
				? binding.document.elementFromPoint.bind(binding.document)
				: null;
		if (!tester) continue;
		canHitTest = true;
		let hit = hits.get(root);
		if (!hits.has(root)) {
			hit = tester(x, y);
			hits.set(root, hit ?? null);
		}
		if (hit && (hit === surface || surface.contains(hit))) return surface;
	}
	if (canHitTest) return null;
	for (const [surface] of candidates) {
		const rect = surface.getBoundingClientRect();
		if (
			rect.width > 0 &&
			rect.height > 0 &&
			x >= rect.left &&
			x <= rect.right &&
			y >= rect.top &&
			y <= rect.bottom
		) return surface;
	}
	return null;
}

function installDocumentBinding(document: Document): FloatingSurfaceDocumentBinding {
	let binding: FloatingSurfaceDocumentBinding;
	const onWheel = (eventValue: Event): void => {
		const event = eventValue as WheelEvent;
		for (const surface of binding.surfaces.keys()) {
			if (eventPathIncludes(event, surface)) return;
		}
		const surface = floatingSurfaceAtWheelPoint(binding, event);
		if (!surface) return;
		containFloatingSurfaceWheel(surface, event);
		event.stopImmediatePropagation();
	};
	binding = {
		document,
		surfaces: new Map(),
		onWheel,
	};
	document.addEventListener('wheel', onWheel, DOCUMENT_WHEEL_OPTIONS);
	boundFloatingSurfaces.set(document, binding);
	return binding;
}

/**
 * 为长期浮层安装统一滚轮边界，并兜住 Chromium 同一段滚轮事务继续锁定旧宿主目标的情况。
 *
 * 事件路径已经进入 surface 时仍由 surface 自己处理，以保留内部滚动、缩放等原生/业务行为；
 * 只有事件目标留在外部而坐标已进入 surface 时，document capture 才阻断旧宿主继续滚动。
 */
export function bindFloatingSurfaceWheel(
	surface: HTMLElement,
	options: FloatingSurfaceWheelBindingOptions = {},
): Cleanup {
	const surfaceOptions: AddEventListenerOptions = {
		capture: options.capture === true,
		passive: false,
	};
	const onSurfaceWheel = (event: Event): void => {
		containFloatingSurfaceWheel(surface, event as WheelEvent);
	};
	surface.addEventListener('wheel', onSurfaceWheel, surfaceOptions);

	const document = surface.ownerDocument;
	const binding = boundFloatingSurfaces.get(document) ??
		installDocumentBinding(document);
	const count = binding.surfaces.get(surface) ?? {
		total: 0,
		latchedTarget: 0,
	};
	count.total += 1;
	if (options.captureLatchedTarget !== false) count.latchedTarget += 1;
	binding.surfaces.set(surface, count);

	let active = true;
	return () => {
		if (!active) return;
		active = false;
		surface.removeEventListener('wheel', onSurfaceWheel, surfaceOptions);
		const current = binding.surfaces.get(surface);
		if (current) {
			current.total -= 1;
			if (options.captureLatchedTarget !== false) current.latchedTarget -= 1;
			if (current.total <= 0) binding.surfaces.delete(surface);
		}
		if (!binding.surfaces.size) {
			document.removeEventListener(
				'wheel',
				binding.onWheel,
				DOCUMENT_WHEEL_OPTIONS,
			);
			boundFloatingSurfaces.delete(document);
		}
	};
}
