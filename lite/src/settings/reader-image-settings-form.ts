import { LifecycleScope } from '../kernel/lifecycle.js';
import type { Signal } from '../kernel/signal.js';
import {
	DEFAULT_READER_IMAGE_PREFERENCES,
	normalizeReaderImagePreferences,
	type ReaderImagePreferenceName,
	type ReaderImagePresentationMode,
	type ReaderImagePreferences,
	type ReaderImagePreferencesAdapter,
} from '../media/reader-image-preferences.js';
import {
	LIGHTBOX_COMMENTS_WIDTH_MAX,
	LIGHTBOX_COMMENTS_WIDTH_MIN,
	LIGHTBOX_DESCRIPTION_HEIGHT_MIN,
	type ReaderImageProfile,
} from '../state/reader-preferences-schema.js';
import { ReaderObjectSettingsDraft } from './reader-object-settings-draft.js';
import type {
	ReaderSettingsController,
	ReaderSettingsDraftAdapter,
} from './reader-settings-controller.js';
import {
	settingsElement as element,
	settingsFooter,
	settingsOption,
	settingsOptionRow,
	settingsSection,
	settingsSwitch,
} from './reader-settings-dom.js';

export interface ReaderImageSettingsFormOptions<TPreferences extends object> {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly controller: ReaderSettingsController<TPreferences>;
	readonly preferences: ReaderImagePreferencesAdapter<TPreferences>;
	readonly readPreferences: () => Readonly<TPreferences>;
	readonly preferenceChanges: Pick<
		Signal<Readonly<TPreferences>>,
		'subscribe'
	>;
	readonly parentScope?: LifecycleScope;
}

const IMAGE_SETTING_NAMES = Object.freeze<readonly ReaderImagePreferenceName[]>([
	'imageProfile',
	'imageProfilesShared',
	'floatingImageProfile',
	'fullpageImageProfile',
	'mobileImageProfile',
	'lightboxOriginalByDefault',
	'lightboxCommentsExpandedByDefault',
	'lightboxDescriptionExpanded',
	'lightboxDescriptionHeight',
	'lightboxCommentsWidthPercent',
]);

function settingEquals(
	left: ReaderImagePreferences[ReaderImagePreferenceName],
	right: ReaderImagePreferences[ReaderImagePreferenceName],
): boolean {
	if (
		typeof left === 'object' &&
		left !== null &&
		typeof right === 'object' &&
		right !== null
	) {
		const leftProfile = left as ReaderImageProfile;
		const rightProfile = right as ReaderImageProfile;
		return leftProfile.preset === rightProfile.preset &&
			leftProfile.custom === rightProfile.custom;
	}
	return Object.is(left, right);
}

/**
 * 图片与灯箱设置的唯一领域表单。
 *
 * 正文缩放、灯箱默认状态和两项布局变量共享一个草稿；表单不扫描媒体、不打开灯箱，也不
 * 直接写 CSS，保存后只由 application preference revision 驱动正式投影。
 */
export class ReaderImageSettingsForm<TPreferences extends object> {
	readonly scope: LifecycleScope;
	readonly #host: HTMLElement;
	readonly #controller: ReaderSettingsController<TPreferences>;
	readonly #preferences: ReaderImagePreferencesAdapter<TPreferences>;
	readonly #draft: ReaderObjectSettingsDraft<
		ReaderImagePreferences,
		ReaderImagePreferenceName
	>;
	readonly #preset: HTMLSelectElement;
	readonly #profileMode: HTMLSelectElement;
	readonly #shared: HTMLInputElement;
	readonly #custom: HTMLInputElement;
	readonly #customOutput: HTMLOutputElement;
	readonly #customRow: HTMLElement;
	readonly #original: HTMLInputElement;
	readonly #comments: HTMLInputElement;
	readonly #description: HTMLInputElement;
	readonly #descriptionHeight: HTMLInputElement;
	readonly #commentsWidth: HTMLInputElement;
	readonly #commentsWidthOutput: HTMLOutputElement;
	readonly #status: HTMLElement;
	readonly #reset: HTMLButtonElement;
	readonly #descriptionMaximum: number;

	constructor(options: ReaderImageSettingsFormOptions<TPreferences>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#host = options.host;
		this.#controller = options.controller;
		this.#preferences = options.preferences;
		this.#draft = new ReaderObjectSettingsDraft(
			IMAGE_SETTING_NAMES,
			this.#preferences.read(options.readPreferences()),
			settingEquals,
		);
		const viewportHeight = Number(
			options.document.defaultView?.innerHeight,
		);
		this.#descriptionMaximum = Math.max(
			LIGHTBOX_DESCRIPTION_HEIGHT_MIN,
			Math.floor(
				(Number.isFinite(viewportHeight) && viewportHeight > 0
					? viewportHeight
					: 900) *
				0.4,
			),
		);
		const document = options.document;
		const groups = element(
			document,
			'div',
			'ldp-settings-category-groups',
		);
		const content = settingsSection(
			document,
			'正文图片',
			'只改变 Reader 内图片的设计比例，不改图片属性和原始资源。',
		);
		this.#profileMode = element(
			document,
			'select',
			'ldp-reader-select ldp-image-profile-mode',
		);
		this.#profileMode.setAttribute('aria-label', '图片比例形态');
		this.#profileMode.append(
			settingsOption(document, 'floating', '浮窗与嵌入'),
			settingsOption(document, 'fullpage', '全屏'),
			settingsOption(document, 'mobile', '移动/紧凑'),
		);
		content.append(settingsOptionRow(
			document,
			'正在编辑的形态',
			'只切换表单视图，不改变当前阅读形态。',
			this.#profileMode,
		));
		const sharedSwitch = settingsSwitch(
			document,
			'三种形态共享图片比例',
			'ldp-image-profiles-shared',
		);
		this.#shared = sharedSwitch.input;
		content.append(settingsOptionRow(
			document,
			'三种形态共享图片比例',
			'开启后任一形态的修改同步到全部形态。',
			sharedSwitch.root,
		));
		this.#preset = element(
			document,
			'select',
			'ldp-reader-select ldp-image-scale-preset',
		);
		this.#preset.setAttribute('aria-label', '正文图片显示比例');
		this.#preset.append(
			settingsOption(document, '50', '50%'),
			settingsOption(document, '100', '100%'),
			settingsOption(document, '125', '125%'),
			settingsOption(document, '150', '150%'),
			settingsOption(document, '200', '200%'),
			settingsOption(document, 'custom', '自定义'),
		);
		content.append(settingsOptionRow(
			document,
			'正文图片显示比例',
			'开启共享时三种阅读形态共用；关闭后只修改当前形态。',
			this.#preset,
		));
		const customControl = element(
			document,
			'span',
			'ldp-setting-range-control',
		);
		this.#custom = element(
			document,
			'input',
			'ldp-image-scale-custom',
		);
		this.#custom.type = 'range';
		this.#custom.min = '50';
		this.#custom.max = '200';
		this.#custom.step = '1';
		this.#customOutput = element(document, 'output');
		customControl.append(this.#custom, this.#customOutput);
		this.#customRow = settingsOptionRow(
			document,
			'自定义图片比例',
			'范围 50%–200%。',
			customControl,
		);
		content.append(this.#customRow);

		const lightbox = settingsSection(
			document,
			'大图查看器',
			'默认状态每次打开时热读；修改后不需要整体刷新。',
		);
		const originalSwitch = settingsSwitch(
			document,
			'默认请求原图',
			'ldp-lightbox-original-default',
		);
		this.#original = originalSwitch.input;
		lightbox.append(settingsOptionRow(
			document,
			'默认请求原图',
			'开启后先请求 original 原图；确认不可用时才按高清候选逐级降级。关闭后仍可复用已有原图缓存或手动查看原图。',
			originalSwitch.root,
		));
		const commentsSwitch = settingsSwitch(
			document,
			'默认展开图片评论',
			'ldp-lightbox-comments-expanded-default',
		);
		this.#comments = commentsSwitch.input;
		lightbox.append(settingsOptionRow(
			document,
			'默认展开图片评论',
			'只控制初始展开状态，不关闭评论能力。',
			commentsSwitch.root,
		));
		const descriptionSwitch = settingsSwitch(
			document,
			'默认展开图片描述',
			'ldp-lightbox-description-expanded-default',
		);
		this.#description = descriptionSwitch.input;
		lightbox.append(settingsOptionRow(
			document,
			'默认展开图片描述',
			'描述取自 canonical 图片条目的替代文本。',
			descriptionSwitch.root,
		));
		this.#descriptionHeight = element(
			document,
			'input',
			'ldp-lightbox-description-height',
		);
		this.#descriptionHeight.type = 'number';
		this.#descriptionHeight.min =
			String(LIGHTBOX_DESCRIPTION_HEIGHT_MIN);
		this.#descriptionHeight.max = String(this.#descriptionMaximum);
		this.#descriptionHeight.step = '1';
		lightbox.append(settingsOptionRow(
			document,
			'图片描述高度',
			`范围 ${LIGHTBOX_DESCRIPTION_HEIGHT_MIN}–${this.#descriptionMaximum}px。`,
			this.#descriptionHeight,
		));
		const commentsWidthControl = element(
			document,
			'span',
			'ldp-setting-range-control',
		);
		this.#commentsWidth = element(
			document,
			'input',
			'ldp-lightbox-comments-width',
		);
		this.#commentsWidth.type = 'range';
		this.#commentsWidth.min = String(LIGHTBOX_COMMENTS_WIDTH_MIN);
		this.#commentsWidth.max = String(LIGHTBOX_COMMENTS_WIDTH_MAX);
		this.#commentsWidth.step = '1';
		this.#commentsWidthOutput = element(document, 'output');
		commentsWidthControl.append(
			this.#commentsWidth,
			this.#commentsWidthOutput,
		);
		lightbox.append(settingsOptionRow(
			document,
			'图片评论宽度',
			`范围 ${LIGHTBOX_COMMENTS_WIDTH_MIN}%–${LIGHTBOX_COMMENTS_WIDTH_MAX}%。`,
			commentsWidthControl,
		));
		groups.append(content, lightbox);
		const footer = settingsFooter(document, '恢复默认');
		this.#status = footer.status;
		this.#reset = footer.reset;
		this.#host.replaceChildren(groups, footer.root);

		this.#listen();
		const adapter: ReaderSettingsDraftAdapter<TPreferences> = {
			panelId: 'image',
			changeCount: () => this.#draft.changeCount(),
			validate: () => this.#validate(),
			createPatch: () => this.#preferences.createPatch(
				normalizeReaderImagePreferences(this.#draft.read()),
			),
			acceptPersisted: (preferences) => this.#accept(preferences),
			discard: (preferences) => this.#accept(preferences),
		};
		this.scope.add(this.#controller.registerDraft(adapter));
		options.preferenceChanges.subscribe((preferences) => {
			if (!this.#draft.rebase(this.#preferences.read(preferences))) {
				return;
			}
			this.#sync();
			this.#controller.refresh();
		}, this.scope);
		this.scope.listen(this.#reset, 'click', () => {
			this.#draft.setValues(DEFAULT_READER_IMAGE_PREFERENCES);
			this.#afterEdit();
		});
		this.scope.add(() => this.#host.replaceChildren());
		this.#sync();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#listen(): void {
		this.scope.listen(this.#profileMode, 'change', () => {
			this.#sync();
		});
		this.scope.listen(this.#shared, 'change', () => {
			const profile = this.#shared.checked
				? this.#currentProfile()
				: null;
			this.#draft.set(
				'imageProfilesShared',
				this.#shared.checked,
			);
			if (profile) this.#writeProfile(profile);
			this.#afterEdit();
		});
		this.scope.listen(this.#preset, 'change', () => {
			const current = this.#currentProfile();
			this.#writeProfile(Object.freeze({
				preset: this.#preset.value as ReaderImageProfile['preset'],
				custom: current.custom,
			}));
			this.#afterEdit();
		});
		this.scope.listen(this.#custom, 'input', () => {
			this.#writeProfile(Object.freeze({
				preset: 'custom',
				custom: Number(this.#custom.value),
			}));
			this.#afterEdit();
		});
		const switches = [
			['lightboxOriginalByDefault', this.#original],
			['lightboxCommentsExpandedByDefault', this.#comments],
			['lightboxDescriptionExpanded', this.#description],
		] as const;
		for (const [name, input] of switches) {
			this.scope.listen(input, 'change', () => {
				this.#draft.set(name, input.checked);
				this.#afterEdit();
			});
		}
		this.scope.listen(this.#descriptionHeight, 'input', () => {
			this.#draft.set(
				'lightboxDescriptionHeight',
				Number(this.#descriptionHeight.value),
			);
			this.#afterEdit();
		});
		this.scope.listen(this.#commentsWidth, 'input', () => {
			this.#draft.set(
				'lightboxCommentsWidthPercent',
				Number(this.#commentsWidth.value),
			);
			this.#afterEdit();
		});
	}

	#afterEdit(): void {
		this.#sync();
		this.#controller.refresh();
	}

	#accept(preferences: Readonly<TPreferences>): void {
		this.#draft.accept(this.#preferences.read(preferences));
		this.#sync();
	}

	#validate(): readonly string[] {
		const value = this.#draft.read();
		const issues: string[] = [];
		if (
			!Number.isFinite(value.lightboxDescriptionHeight) ||
			value.lightboxDescriptionHeight <
				LIGHTBOX_DESCRIPTION_HEIGHT_MIN ||
			value.lightboxDescriptionHeight > this.#descriptionMaximum
		) {
			issues.push(
				`图片描述高度必须是 ${LIGHTBOX_DESCRIPTION_HEIGHT_MIN}–${this.#descriptionMaximum}px`,
			);
		}
		if (
			!Number.isFinite(value.lightboxCommentsWidthPercent) ||
			value.lightboxCommentsWidthPercent <
				LIGHTBOX_COMMENTS_WIDTH_MIN ||
			value.lightboxCommentsWidthPercent >
				LIGHTBOX_COMMENTS_WIDTH_MAX
		) {
			issues.push(
				`图片评论宽度必须是 ${LIGHTBOX_COMMENTS_WIDTH_MIN}%–${LIGHTBOX_COMMENTS_WIDTH_MAX}%`,
			);
		}
		return Object.freeze(issues);
	}

	#sync(): void {
		const value = this.#draft.read();
		const profile = this.#currentProfile();
		for (const option of [...this.#preset.options]) {
			option.selected =
				option.value === profile.preset;
		}
		this.#custom.value = String(profile.custom);
		this.#customOutput.textContent =
			`${Math.round(profile.custom)}%`;
		this.#customRow.hidden = profile.preset !== 'custom';
		this.#shared.checked = value.imageProfilesShared;
		this.#profileMode.disabled = value.imageProfilesShared;
		this.#original.checked = value.lightboxOriginalByDefault;
		this.#comments.checked =
			value.lightboxCommentsExpandedByDefault;
		this.#description.checked =
			value.lightboxDescriptionExpanded;
		this.#descriptionHeight.value = Number.isFinite(
			value.lightboxDescriptionHeight,
		) ? String(value.lightboxDescriptionHeight) : '';
		this.#commentsWidth.value = String(
			value.lightboxCommentsWidthPercent,
		);
		this.#commentsWidthOutput.textContent =
			`${Math.round(value.lightboxCommentsWidthPercent)}%`;
		const count = this.#draft.changeCount();
		this.#status.textContent = count
			? `有 ${count} 项未保存`
			: '已与当前设置同步';
		this.#reset.disabled = IMAGE_SETTING_NAMES.every((name) =>
			settingEquals(
				value[name],
				DEFAULT_READER_IMAGE_PREFERENCES[name],
			));
	}

	#currentMode(): ReaderImagePresentationMode {
		return this.#profileMode.value === 'mobile'
			? 'mobile'
			: this.#profileMode.value === 'fullpage'
				? 'fullpage'
				: 'floating';
	}

	#currentProfile(): ReaderImageProfile {
		const value = this.#draft.read();
		if (value.imageProfilesShared) return value.imageProfile;
		const mode = this.#currentMode();
		return mode === 'mobile'
			? value.mobileImageProfile
			: mode === 'fullpage'
				? value.fullpageImageProfile
				: value.floatingImageProfile;
	}

	#writeProfile(profile: ReaderImageProfile): void {
		const value = this.#draft.read();
		this.#draft.set('imageProfile', profile);
		if (value.imageProfilesShared || this.#shared.checked) {
			this.#draft.set('floatingImageProfile', profile);
			this.#draft.set('fullpageImageProfile', profile);
			this.#draft.set('mobileImageProfile', profile);
			return;
		}
		const mode = this.#currentMode();
		this.#draft.set(
			mode === 'mobile'
				? 'mobileImageProfile'
				: mode === 'fullpage'
					? 'fullpageImageProfile'
					: 'floatingImageProfile',
			profile,
		);
	}
}
