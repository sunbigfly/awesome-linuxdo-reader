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

export type ReaderImageSourceRecovery = (
	source: string,
	signal?: AbortSignal,
) => string | Promise<string>;

interface ReaderImageRecoveryRegistration {
	readonly currentNode: () => Element | null;
	readonly abort: () => void;
}

interface ReaderImageRecoveryRegistry {
	readonly entries: Set<ReaderImageRecoveryRegistration>;
	readonly observer: MutationObserver;
}

const readerImageRecoveryRegistries = new WeakMap<Node, ReaderImageRecoveryRegistry>();

function registerReaderImageRecovery(
	node: Element,
	registration: ReaderImageRecoveryRegistration,
): () => void {
	const root = node.getRootNode();
	const Observer = node.ownerDocument.defaultView?.MutationObserver;
	if (!Observer) return () => {};
	let registry = readerImageRecoveryRegistries.get(root);
	if (!registry) {
		const entries = new Set<ReaderImageRecoveryRegistration>();
		const observer = new Observer(() => {
			for (const entry of [...entries]) {
				if (entry.currentNode()?.isConnected) continue;
				entry.abort();
			}
		});
		observer.observe(root, { childList: true, subtree: true });
		registry = { entries, observer };
		readerImageRecoveryRegistries.set(root, registry);
	}
	registry.entries.add(registration);
	let released = false;
	return () => {
		if (released) return;
		released = true;
		registry?.entries.delete(registration);
		if (registry?.entries.size) return;
		registry?.observer.disconnect();
		if (readerImageRecoveryRegistries.get(root) === registry) {
			readerImageRecoveryRegistries.delete(root);
		}
	};
}

/**
 * 装配统一资源层时先保留可替换的语义占位，恢复完成后原位提交真实图片；没有资源层时
 * 才按浏览器直连候选逐级降级。资源层负责请求、single-flight、缓存与来源校验，本
 * helper 只拥有单个 img 的候选推进和 DOM 替换。
 */
export function installReaderImageSourceFallback(
	image: HTMLImageElement,
	sources: readonly string[],
	createFallback: () => Element,
	recoverSource?: ReaderImageSourceRecovery,
	visibleSource?: string,
): void {
	const imageRef = new WeakRef(image);
	const candidates = [...new Set(
		sources.map((source) => String(source).trim()).filter(Boolean),
	)];
	let directIndex = 0;
	let recoveryIndex = 0;
	let fallbackRef: WeakRef<Element> | null = null;
	let recovering = false;
	let activeRecovery: AbortController | null = null;

	const currentFallback = (): Element | null => fallbackRef?.deref() ?? null;
	const currentNode = (): Element | null => {
		const fallback = currentFallback();
		if (fallback?.isConnected) return fallback;
		const currentImage = imageRef.deref();
		return currentImage?.isConnected ? currentImage : null;
	};

	const showFallback = (): Element | null => {
		const fallback = currentFallback();
		if (fallback?.parentNode) return fallback;
		const next = createFallback();
		const currentImage = imageRef.deref();
		if (currentImage?.parentNode) currentImage.replaceWith(next);
		fallbackRef = new WeakRef(next);
		return next.parentNode ? next : null;
	};
	const recoverNext = async (): Promise<void> => {
		if (recovering) return;
		recovering = true;
		const controller = new AbortController();
		activeRecovery = controller;
		let releaseLifecycle = (): void => {};
		void Promise.resolve().then(() => {
			if (!recovering || activeRecovery !== controller || controller.signal.aborted) {
				return;
			}
			const mounted = currentNode();
			if (!mounted) {
				controller.abort(new Error('图片恢复宿主已离开文档'));
				return;
			}
			releaseLifecycle = registerReaderImageRecovery(mounted, {
				currentNode,
				abort: () => controller.abort(new Error('图片恢复宿主已离开文档')),
			});
		});
		try {
			while (recoverSource && recoveryIndex < candidates.length) {
				const candidate = candidates[recoveryIndex]!;
				recoveryIndex += 1;
				try {
					const recovered = String(
						await recoverSource(candidate, controller.signal),
					).trim();
					if (controller.signal.aborted) return;
					const currentImage = imageRef.deref();
					const fallback = currentFallback();
					if (!fallback?.parentNode && !currentImage?.parentNode) return;
					if (!recovered) continue;
					if (fallback?.parentNode && currentImage) {
						fallback.replaceWith(currentImage);
						fallbackRef = null;
					}
					if (!currentImage) return;
					currentImage.src = recovered;
					return;
				} catch {
					if (controller.signal.aborted) return;
					// 当前候选不可恢复时继续使用下一候选，最终保留语义占位。
				}
			}
			const fallback = currentFallback();
			const currentImage = imageRef.deref();
			if (fallback?.parentNode && currentImage) {
				currentImage.removeEventListener('error', advance);
			}
		} finally {
			releaseLifecycle();
			if (activeRecovery === controller) activeRecovery = null;
			recovering = false;
		}
	};
	function advance(): void {
		if (recoverSource) {
			if (!showFallback()) return;
			void recoverNext();
			return;
		}
		const direct = candidates[directIndex];
		directIndex += 1;
		const currentImage = imageRef.deref();
		if (!currentImage) return;
		if (direct) {
			currentImage.src = direct;
			return;
		}
		currentImage.removeEventListener('error', advance);
		showFallback();
	}

	image.addEventListener('error', advance);
	if (recoverSource) {
		const visible = String(visibleSource ?? '').trim();
		if (visible) image.src = visible;
		else if (!showFallback()) return;
		void recoverNext();
	} else {
		advance();
	}
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
