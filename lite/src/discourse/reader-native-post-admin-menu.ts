import {
	readerNativeTopLayerPort,
	type ReaderNativeComposerTopLayerPort,
} from './reader-native-composer-window.js';

const ADMIN_MENU_SELECTOR =
	'.fk-d-menu[data-identifier="admin-post-menu"]';
const ADMIN_MENU_GAP_PX = 8;
const ADMIN_MENU_BOUNDARY_PADDING_PX = 8;
const ADMIN_MENU_FALLBACK_WIDTH_PX = 240;
const ADMIN_MENU_FALLBACK_HEIGHT_PX = 48;

export interface ReaderNativePostAdminMenuPositionOptions {
	readonly document: Document;
	readonly reader: HTMLElement;
	readonly anchor: HTMLElement;
	readonly content: HTMLElement;
	readonly topLayer?: ReaderNativeComposerTopLayerPort;
}

function positive(value: number, fallback: number): number {
	return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}

/**
 * 把 Discourse 原生楼层管理菜单投影到 Reader 窗口内。
 *
 * 菜单 component、权限判断和 mutation 仍由宿主拥有；这里只提升 top layer，并以
 * Reader 窗口为碰撞边界计算固定坐标，避免嵌入模式下被宿主半屏 portal 夹回左侧。
 */
export function positionReaderNativePostAdminMenu(
	options: ReaderNativePostAdminMenuPositionOptions,
): boolean {
	const { document, reader, anchor, content } = options;
	const surface = content.closest<HTMLElement>(ADMIN_MENU_SELECTOR);
	if (
		!surface ||
		!surface.isConnected ||
		!reader.isConnected ||
		!anchor.isConnected
	) return false;

	surface.dataset.ldpReaderAdminMenu = 'positioned';
	const topLayer = options.topLayer ?? readerNativeTopLayerPort();
	if (!surface.hasAttribute('popover')) {
		surface.setAttribute('popover', 'manual');
		surface.dataset.ldpReaderTopLayer = 'portal';
		try {
			topLayer.show(surface);
		} catch {
			// 不支持 Popover API 时仍保留固定定位与高 z-index 回退。
		}
		if (!topLayer.isOpen(surface)) {
			surface.removeAttribute('popover');
			delete surface.dataset.ldpReaderTopLayer;
		}
	}

	const viewport = document.documentElement;
	const readerRect = reader.getBoundingClientRect();
	const anchorRect = anchor.getBoundingClientRect();
	const surfaceRect = surface.getBoundingClientRect();
	const viewportWidth = positive(
		viewport.clientWidth,
		positive(document.defaultView?.innerWidth ?? 0, readerRect.right),
	);
	const viewportHeight = positive(
		viewport.clientHeight,
		positive(document.defaultView?.innerHeight ?? 0, readerRect.bottom),
	);
	const readerLeft = readerRect.width > 0 ? readerRect.left : 0;
	const readerRight = readerRect.width > 0 ? readerRect.right : viewportWidth;
	const readerTop = readerRect.height > 0 ? readerRect.top : 0;
	const readerBottom = readerRect.height > 0
		? readerRect.bottom
		: viewportHeight;
	const leftBound = Math.max(
		ADMIN_MENU_BOUNDARY_PADDING_PX,
		readerLeft + ADMIN_MENU_BOUNDARY_PADDING_PX,
	);
	const rightBound = Math.max(
		leftBound,
		Math.min(
			viewportWidth - ADMIN_MENU_BOUNDARY_PADDING_PX,
			readerRight - ADMIN_MENU_BOUNDARY_PADDING_PX,
		),
	);
	const topBound = Math.max(
		ADMIN_MENU_BOUNDARY_PADDING_PX,
		readerTop + ADMIN_MENU_BOUNDARY_PADDING_PX,
	);
	const bottomBound = Math.max(
		topBound,
		Math.min(
			viewportHeight - ADMIN_MENU_BOUNDARY_PADDING_PX,
			readerBottom - ADMIN_MENU_BOUNDARY_PADDING_PX,
		),
	);
	const width = Math.min(
		positive(surfaceRect.width, ADMIN_MENU_FALLBACK_WIDTH_PX),
		Math.max(1, rightBound - leftBound),
	);
	const height = Math.min(
		positive(surfaceRect.height, ADMIN_MENU_FALLBACK_HEIGHT_PX),
		Math.max(1, bottomBound - topBound),
	);
	const rightCandidate = anchorRect.right + ADMIN_MENU_GAP_PX;
	const leftCandidate = anchorRect.left - ADMIN_MENU_GAP_PX - width;
	const left = rightCandidate + width <= rightBound
		? rightCandidate
		: leftCandidate >= leftBound
			? leftCandidate
			: clamp(anchorRect.left, leftBound, Math.max(leftBound, rightBound - width));
	const top = clamp(
		anchorRect.top,
		topBound,
		Math.max(topBound, bottomBound - height),
	);
	surface.style.setProperty(
		'--ldp-reader-admin-menu-left',
		`${Math.round(left)}px`,
	);
	surface.style.setProperty(
		'--ldp-reader-admin-menu-top',
		`${Math.round(top)}px`,
	);
	return true;
}
