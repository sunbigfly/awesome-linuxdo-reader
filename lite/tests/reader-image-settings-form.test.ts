import { parseHTML } from 'linkedom';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderImagePreferencesProjection,
	readerImagePresentationMode,
	readerPreferencesImageAdapter,
} from '../src/media/reader-image-preferences.js';
import { ReaderImageSettingsForm } from '../src/settings/reader-image-settings-form.js';
import { ReaderSettingsController } from '../src/settings/reader-settings-controller.js';
import {
	createReaderPreferencesDefaults,
	type ReaderPreferences,
} from '../src/state/reader-preferences-schema.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html style="--ldp-lb-comments-width-preferred:30%">' +
	'<body><main class="reader" style="--ldp-image-zoom:.9"></main>' +
	'<section id="settings"></section></body></html>',
);
const document = parsedDocument as unknown as Document;
const reader = document.querySelector<HTMLElement>('.reader')!;
const projection = new ReaderImagePreferencesProjection({
	contentRoot: reader,
	lightboxRoot: document.documentElement,
});
projection.applyMode({
	imageProfile: { preset: 'custom', custom: 125 },
	imageProfilesShared: false,
	floatingImageProfile: { preset: 'custom', custom: 125 },
	fullpageImageProfile: { preset: '100', custom: 100 },
	mobileImageProfile: { preset: '150', custom: 150 },
	lightboxOriginalByDefault: false,
	lightboxCommentsExpandedByDefault: false,
	lightboxDescriptionExpanded: true,
	lightboxDescriptionHeight: 180,
	lightboxCommentsWidthPercent: 35,
}, 'mobile');
assert(
	reader.style.getPropertyValue('--ldp-image-zoom') === '1.5' &&
		document.documentElement.style.getPropertyValue(
			'--ldp-lb-description-height',
		) === '180px' &&
		document.documentElement.style.getPropertyValue(
			'--ldp-lb-comments-width-preferred',
		) === '35%',
	'图片运行投影必须分别写正文比例与灯箱继承变量',
);
projection.destroy();
assert(
	reader.style.getPropertyValue('--ldp-image-zoom') === '.9' &&
		!document.documentElement.style.getPropertyValue(
			'--ldp-lb-description-height',
		) &&
		document.documentElement.style.getPropertyValue(
			'--ldp-lb-comments-width-preferred',
		) === '30%',
	'销毁图片投影必须精确恢复接管前样式，不能污染宿主',
);
assert(
	readerImagePresentationMode({
		viewportWidth: 700,
		presentation: { fullPage: true },
	}) === 'mobile' &&
	readerImagePresentationMode({
		viewportWidth: 1_200,
		presentation: { fullPage: true },
	}) === 'fullpage' &&
	readerImagePresentationMode({
		viewportWidth: 1_200,
		presentation: { fullPage: false },
	}) === 'floating',
	'图片 profile 必须由唯一 workspace snapshot 选择移动、全屏或浮窗形态',
);

let preferences = createReaderPreferencesDefaults({
	viewportWidth: 1_440,
	viewportHeight: 900,
});
const changes = new Signal<Readonly<ReaderPreferences>>();
let updateCount = 0;
const controller = new ReaderSettingsController<ReaderPreferences>({
	preferences: {
		read: () => preferences,
		update(patch) {
			updateCount += 1;
			preferences = Object.freeze({ ...preferences, ...patch });
			changes.emit(preferences);
			return preferences;
		},
	},
	initialPanelId: 'image',
});
const host = document.querySelector<HTMLElement>('#settings')!;
const form = new ReaderImageSettingsForm({
	document,
	host,
	controller,
	preferences: readerPreferencesImageAdapter,
	readPreferences: () => preferences,
	preferenceChanges: changes,
});
assert(
	host.querySelectorAll('.ldp-settings-category-group').length === 2 &&
		[
			'.ldp-lightbox-original-default',
			'.ldp-lightbox-comments-expanded-default',
			'.ldp-lightbox-description-expanded-default',
		].every((selector) => host.querySelector(selector)) &&
		host.querySelector('.ldp-lightbox-description-height')
			?.closest('.ldp-setting-row')?.textContent?.includes(
				'内容较少时自适应',
			) === true &&
		host.querySelector('.ldp-image-scale-preset')
			?.closest('.ldp-setting-row')?.textContent?.includes(
				'关闭后只修改当前形态',
			) === true &&
		Number(controller.snapshot.draftCount) === 0,
	'图片面板必须由单一 form 呈现正文比例和灯箱设置，且共享说明不能误导独立形态',
);
const preset = host.querySelector<HTMLSelectElement>(
	'.ldp-image-scale-preset',
)!;
assert(
	String(preferences.imageProfile.preset) === '100' &&
		host.querySelector<HTMLButtonElement>(
			'.ldp-settings-form-reset',
		)?.disabled === true,
	'图片设置与偏好事实源必须统一以 100% 为默认大小',
);
for (const option of [...preset.options]) {
	option.selected = option.value === 'custom';
}
preset.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
const custom = host.querySelector<HTMLInputElement>(
	'.ldp-image-scale-custom',
)!;
custom.value = '135';
custom.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const original = host.querySelector<HTMLInputElement>(
	'.ldp-lightbox-original-default',
)!;
original.checked = false;
original.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
const descriptionHeight = host.querySelector<HTMLInputElement>(
	'.ldp-lightbox-description-height',
)!;
descriptionHeight.value = '180';
descriptionHeight.dispatchEvent(
	new parsedWindow.Event('input', { bubbles: true }),
);
const commentsWidth = host.querySelector<HTMLInputElement>(
	'.ldp-lightbox-comments-width',
)!;
commentsWidth.value = '38';
commentsWidth.dispatchEvent(
	new parsedWindow.Event('input', { bubbles: true }),
);
assert(
	Number(controller.snapshot.draftCount) === 7 &&
		host.querySelector<HTMLOutputElement>(
			'.ldp-setting-range-control output',
		)?.textContent === '135%',
	'图片控件必须进入同一草稿并同步显示比例预览',
);
const saved = controller.saveAll();
assert(
	saved.kind === 'saved' &&
		saved.count === 7 &&
		updateCount === 1 &&
		preferences.imageProfile.preset === 'custom' &&
		preferences.imageProfile.custom === 135 &&
		preferences.floatingImageProfile.custom === 135 &&
		preferences.fullpageImageProfile.custom === 135 &&
		preferences.mobileImageProfile.custom === 135 &&
		!preferences.lightboxOriginalByDefault &&
		preferences.lightboxDescriptionHeight === 180 &&
		preferences.lightboxCommentsWidthPercent === 38,
	'图片和灯箱设置必须通过一次 application preference revision 保存',
);
const shared = host.querySelector<HTMLInputElement>(
	'.ldp-image-profiles-shared',
)!;
shared.checked = false;
shared.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
const profileMode = host.querySelector<HTMLSelectElement>(
	'.ldp-image-profile-mode',
)!;
Object.defineProperty(profileMode, 'value', {
	value: 'fullpage',
	writable: true,
	configurable: true,
});
profileMode.dispatchEvent(
	new parsedWindow.Event('change', { bubbles: true }),
);
custom.value = '120';
custom.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
const independentSaved = controller.saveAll();
assert(
	independentSaved.kind === 'saved' &&
	independentSaved.count === 3 &&
		Number(updateCount) === 2 &&
		!preferences.imageProfilesShared &&
		Number(preferences.floatingImageProfile.custom) === 135 &&
		Number(preferences.fullpageImageProfile.custom) === 120 &&
		preferences.mobileImageProfile.custom === 135,
	`关闭共享后只能修改当前所选形态 profile，其他形态必须保留原值：` +
		`${independentSaved.kind}/${independentSaved.kind === 'saved' ? independentSaved.count : '-'} ` +
		`${updateCount} ${preferences.imageProfilesShared} ` +
		`${preferences.floatingImageProfile.custom}/` +
		`${preferences.fullpageImageProfile.custom}/` +
		`${preferences.mobileImageProfile.custom}`,
);
custom.value = '150';
custom.dispatchEvent(new parsedWindow.Event('input', { bubbles: true }));
profileMode.value = 'floating';
profileMode.dispatchEvent(
	new parsedWindow.Event('change', { bubbles: true }),
);
shared.checked = true;
shared.dispatchEvent(new parsedWindow.Event('change', { bubbles: true }));
const sharedSaved = controller.saveAll();
assert(
	sharedSaved.kind === 'saved' &&
		sharedSaved.count === 3 &&
		Number(updateCount) === 3 &&
		preferences.imageProfilesShared &&
		preferences.imageProfile.custom === 135 &&
		preferences.floatingImageProfile.custom === 135 &&
		preferences.fullpageImageProfile.custom === 135 &&
		preferences.mobileImageProfile.custom === 135,
	'重新开启共享必须采用当前表单形态，不能继承最后编辑的另一形态 profile',
);

descriptionHeight.value = '999';
descriptionHeight.dispatchEvent(
	new parsedWindow.Event('input', { bubbles: true }),
);
assert(
	controller.saveAll().kind === 'invalid' &&
		Number(updateCount) === 3,
	'越过当前视口 40% 的描述高度必须阻止统一保存并保留草稿',
);
controller.discardAll();
assert(
	Number(controller.snapshot.draftCount) === 0 &&
		descriptionHeight.value === '180',
	'放弃图片设置必须从同一持久偏好恢复全部控件',
);
form.destroy();
controller.destroy();
assert(!host.firstChild, '销毁图片 form 必须释放 DOM 与草稿注册');
