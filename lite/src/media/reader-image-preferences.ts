import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	IMAGE_PROFILE_DEFAULT,
	LIGHTBOX_COMMENTS_WIDTH_DEFAULT,
	LIGHTBOX_DESCRIPTION_HEIGHT_DEFAULT,
	normalizeImageProfile,
	type ReaderImageProfile,
} from '../state/reader-preferences-schema.js';
import {
	ReaderImageScaleProjection,
} from './reader-image-scale.js';
import {
	READER_COMPACT_MAX_WIDTH,
} from '../shell/reader-workspace.js';

export interface ReaderImagePreferences {
	readonly imageProfile: ReaderImageProfile;
	readonly imageProfilesShared: boolean;
	readonly floatingImageProfile: ReaderImageProfile;
	readonly fullpageImageProfile: ReaderImageProfile;
	readonly mobileImageProfile: ReaderImageProfile;
	readonly lightboxOriginalByDefault: boolean;
	readonly lightboxCommentsExpandedByDefault: boolean;
	readonly lightboxDescriptionExpanded: boolean;
	readonly lightboxDescriptionHeight: number;
	readonly lightboxCommentsWidthPercent: number;
}

export type ReaderImagePreferenceName = keyof ReaderImagePreferences;
export type ReaderImagePresentationMode =
	| 'floating'
	| 'fullpage'
	| 'mobile';

export function readerImagePresentationMode(
	workspace: Readonly<{
		readonly viewportWidth: number;
		readonly presentation: Readonly<{
			readonly fullPage: boolean;
		}>;
	}>,
): ReaderImagePresentationMode {
	if (workspace.viewportWidth <= READER_COMPACT_MAX_WIDTH) {
		return 'mobile';
	}
	return workspace.presentation.fullPage ? 'fullpage' : 'floating';
}

export interface ReaderImagePreferencesAdapter<TPreferences extends object> {
	read(preferences: Readonly<TPreferences>): ReaderImagePreferences;
	createPatch(value: ReaderImagePreferences): Partial<TPreferences>;
}

export const DEFAULT_READER_IMAGE_PREFERENCES =
	Object.freeze<ReaderImagePreferences>({
		imageProfile: IMAGE_PROFILE_DEFAULT,
		imageProfilesShared: true,
		floatingImageProfile: IMAGE_PROFILE_DEFAULT,
		fullpageImageProfile: IMAGE_PROFILE_DEFAULT,
		mobileImageProfile: IMAGE_PROFILE_DEFAULT,
		lightboxOriginalByDefault: true,
		lightboxCommentsExpandedByDefault: true,
		lightboxDescriptionExpanded: false,
		lightboxDescriptionHeight: LIGHTBOX_DESCRIPTION_HEIGHT_DEFAULT,
		lightboxCommentsWidthPercent: LIGHTBOX_COMMENTS_WIDTH_DEFAULT,
	});

export function normalizeReaderImagePreferences(
	value: Partial<ReaderImagePreferences>,
): ReaderImagePreferences {
	const descriptionHeight = Math.round(
		Number(value.lightboxDescriptionHeight),
	);
	const commentsWidth = Number(value.lightboxCommentsWidthPercent);
	const imageProfile = normalizeImageProfile(value.imageProfile);
	const imageProfilesShared = value.imageProfilesShared !== false;
	return Object.freeze({
		imageProfile,
		imageProfilesShared,
		floatingImageProfile: imageProfilesShared
			? imageProfile
			: normalizeImageProfile(
				value.floatingImageProfile ?? imageProfile,
			),
		fullpageImageProfile: imageProfilesShared
			? imageProfile
			: normalizeImageProfile(
				value.fullpageImageProfile ?? imageProfile,
			),
		mobileImageProfile: imageProfilesShared
			? imageProfile
			: normalizeImageProfile(
				value.mobileImageProfile ?? imageProfile,
			),
		lightboxOriginalByDefault:
			value.lightboxOriginalByDefault === true,
		lightboxCommentsExpandedByDefault:
			value.lightboxCommentsExpandedByDefault === true,
		lightboxDescriptionExpanded:
			value.lightboxDescriptionExpanded === true,
		lightboxDescriptionHeight: Number.isFinite(descriptionHeight)
			? descriptionHeight
			: LIGHTBOX_DESCRIPTION_HEIGHT_DEFAULT,
		lightboxCommentsWidthPercent: Number.isFinite(commentsWidth)
			? commentsWidth
			: LIGHTBOX_COMMENTS_WIDTH_DEFAULT,
	});
}

export const readerPreferencesImageAdapter:
	ReaderImagePreferencesAdapter<ReaderImagePreferences> =
	Object.freeze({
		read: (preferences: Readonly<ReaderImagePreferences>) =>
			normalizeReaderImagePreferences(preferences),
		createPatch: (value: ReaderImagePreferences) =>
			normalizeReaderImagePreferences(value),
	});

interface PreviousStyleProperty {
	readonly property: string;
	readonly value: string;
	readonly priority: string;
}

function captureProperty(
	style: CSSStyleDeclaration,
	property: string,
): PreviousStyleProperty {
	const priorityReader = style as CSSStyleDeclaration & {
		getPropertyPriority?: (name: string) => string;
	};
	return Object.freeze({
		property,
		value: style.getPropertyValue(property),
		priority:
			typeof priorityReader.getPropertyPriority === 'function'
				? priorityReader.getPropertyPriority(property)
				: '',
	});
}

function restoreProperty(
	style: CSSStyleDeclaration,
	previous: PreviousStyleProperty,
): void {
	if (previous.value) {
		style.setProperty(
			previous.property,
			previous.value,
			previous.priority,
		);
	} else style.removeProperty(previous.property);
}

export interface ReaderImagePreferencesProjectionOptions {
	readonly contentRoot: HTMLElement;
	readonly lightboxRoot: HTMLElement;
	readonly parentScope?: LifecycleScope;
}

/**
 * 图片设置到设计变量的唯一运行投影。
 *
 * 正文比例只写 Reader root；灯箱说明高度与评论宽度写 lightbox 的继承根。它不扫描图片、
 * 不改变 PostView，也不保存偏好，销毁时精确恢复接管前的 inline 属性。
 */
export class ReaderImagePreferencesProjection {
	readonly scope: LifecycleScope;
	readonly #imageScale: ReaderImageScaleProjection;
	readonly #lightboxRoot: HTMLElement;
	readonly #previousLightbox: readonly PreviousStyleProperty[];

	constructor(options: ReaderImagePreferencesProjectionOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#imageScale = new ReaderImageScaleProjection({
			root: options.contentRoot,
			parentScope: this.scope,
		});
		this.#lightboxRoot = options.lightboxRoot;
		this.#previousLightbox = Object.freeze([
			captureProperty(
				this.#lightboxRoot.style,
				'--ldp-lb-description-height',
			),
			captureProperty(
				this.#lightboxRoot.style,
				'--ldp-lb-comments-width-preferred',
			),
		]);
		this.scope.add(() => {
			for (const previous of this.#previousLightbox) {
				restoreProperty(this.#lightboxRoot.style, previous);
			}
		});
	}

	apply(preferences: ReaderImagePreferences): void {
		this.applyMode(preferences, 'floating');
	}

	applyMode(
		preferences: ReaderImagePreferences,
		mode: ReaderImagePresentationMode,
	): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderImagePreferencesProjection 已销毁');
		}
		const value = normalizeReaderImagePreferences(preferences);
		const profile = value.imageProfilesShared
			? value.imageProfile
			: mode === 'mobile'
				? value.mobileImageProfile
				: mode === 'fullpage'
					? value.fullpageImageProfile
					: value.floatingImageProfile;
		this.#imageScale.apply(profile);
		this.#lightboxRoot.style.setProperty(
			'--ldp-lb-description-height',
			`${Math.round(value.lightboxDescriptionHeight)}px`,
		);
		this.#lightboxRoot.style.setProperty(
			'--ldp-lb-comments-width-preferred',
			`${Number(value.lightboxCommentsWidthPercent)}%`,
		);
	}

	destroy(): void {
		this.scope.destroy();
	}
}
