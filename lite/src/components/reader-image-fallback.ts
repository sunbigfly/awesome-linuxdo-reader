/**
 * URL 存在不等于远端图片可用。头像等小图失败时统一原位切换为调用方的语义回退，
 * 避免各 View 留下坏图或重复维护 error handler。
 */
export function replaceImageWithFallbackOnError(
	image: HTMLImageElement,
	createFallback: () => Element,
): void {
	image.addEventListener('error', () => {
		if (!image.parentNode) return;
		image.replaceWith(createFallback());
	}, { once: true });
}

const READER_SITE_LOGO_PLACEHOLDER = `data:image/svg+xml,${encodeURIComponent(
	'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#e9eef3"/><path d="M18 33a14 14 0 1 1 28 0v13H18V33Z" fill="#748392"/><circle cx="27" cy="31" r="3" fill="#fff"/><circle cx="37" cy="31" r="3" fill="#fff"/></svg>',
)}`;

function siteFaviconSource(
	image: HTMLImageElement,
	primarySource: string,
): string {
	const documentOrigin = String(
		image.ownerDocument.location?.origin ?? '',
	).trim();
	for (const base of [documentOrigin, primarySource]) {
		if (!base) continue;
		try {
			const url = new URL('/favicon.ico', base);
			if (url.protocol === 'https:' || url.protocol === 'http:') {
				return url.href;
			}
		} catch {
			// 继续使用下一个可解析基准。
		}
	}
	return '';
}

/**
 * Shell、设置导航与 About 共用的站点 Logo 失败链。
 *
 * 主候选失效时先尝试当前站点 favicon，仍失败才使用内联占位图；三处 View 不再
 * 各自维护 onerror，也不会留下浏览器坏图标记。
 */
export function installReaderSiteLogoFallback(
	image: HTMLImageElement,
	primarySource: string,
): void {
	const primary = String(primarySource).trim();
	const sources = [...new Set([
		primary,
		siteFaviconSource(image, primary),
		READER_SITE_LOGO_PLACEHOLDER,
	].filter(Boolean))];
	let index = 0;
	const advance = (): void => {
		index += 1;
		const next = sources[index];
		if (!next) {
			image.removeEventListener('error', advance);
			return;
		}
		image.src = next;
	};
	image.addEventListener('error', advance);
	image.src = sources[0] ?? READER_SITE_LOGO_PLACEHOLDER;
}
