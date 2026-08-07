import { LifecycleScope } from '../kernel/lifecycle.js';
import type { ReaderImageProfile } from '../state/reader-preferences-schema.js';

export const READER_IMAGE_SCALE_MIN = 50;
export const READER_IMAGE_SCALE_MAX = 200;
export const READER_IMAGE_SCALE_PROPERTY = '--ldp-image-zoom';

function boundedPercent(value: unknown, fallback = 100): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return fallback;
	return Math.min(
		READER_IMAGE_SCALE_MAX,
		Math.max(READER_IMAGE_SCALE_MIN, Math.round(numeric)),
	);
}

export function readerImageScalePercent(profile: ReaderImageProfile): number {
	return profile.preset === 'custom'
		? boundedPercent(profile.custom)
		: boundedPercent(profile.preset);
}

export interface ReaderImageScaleProjectionOptions {
	readonly root: HTMLElement;
	readonly parentScope?: LifecycleScope;
}

/**
 * 正文图片比例的唯一 CSS 变量投影。
 *
 * 只写 Reader root 的设计变量；不扫描图片、不改宽高属性、不重新组织 PostView，也不持有
 * 设置存储。销毁时恢复接管前的 inline value/priority。
 */
export class ReaderImageScaleProjection {
	readonly scope: LifecycleScope;
	readonly #root: HTMLElement;
	readonly #previousValue: string;
	readonly #previousPriority: string;
	#percent = 100;
	#destroyed = false;

	constructor(options: ReaderImageScaleProjectionOptions) {
		this.#root = options.root;
		this.#previousValue = this.#root.style.getPropertyValue(
			READER_IMAGE_SCALE_PROPERTY,
		);
		const style = this.#root.style as CSSStyleDeclaration & {
			getPropertyPriority?: (property: string) => string;
		};
		this.#previousPriority = typeof style.getPropertyPriority === 'function'
			? style.getPropertyPriority(READER_IMAGE_SCALE_PROPERTY)
			: '';
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.add(() => {
			this.#destroyed = true;
			if (this.#previousValue) {
				this.#root.style.setProperty(
					READER_IMAGE_SCALE_PROPERTY,
					this.#previousValue,
					this.#previousPriority,
				);
			} else {
				this.#root.style.removeProperty(READER_IMAGE_SCALE_PROPERTY);
			}
		});
	}

	get percent(): number {
		return this.#percent;
	}

	apply(profile: ReaderImageProfile): number {
		this.#assertActive();
		const percent = readerImageScalePercent(profile);
		this.#percent = percent;
		this.#root.style.setProperty(
			READER_IMAGE_SCALE_PROPERTY,
			String(percent / 100),
		);
		return percent;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#assertActive(): void {
		if (this.#destroyed || this.scope.destroyed) {
			throw new Error('ReaderImageScaleProjection 已销毁');
		}
	}
}
