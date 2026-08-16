import { parseHTML } from 'linkedom';
import {
	readerEscapeOwnedBy,
	readerFrontmostEscapeSurface,
	readerSurfaceQuery,
	readerSurfaceQueryAll,
} from '../src/shell/reader-escape-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body>' +
	'<section class="ldp-lightbox"></section>' +
	'<section class="ldp-settings-popover"></section>' +
	'<section class="ldp-reader-action-layer"></section>' +
	'</body></html>',
);
const document = parsedDocument as unknown as Document;
const lightbox = document.querySelector<HTMLElement>('.ldp-lightbox')!;
const settings = document.querySelector<HTMLElement>('.ldp-settings-popover')!;
const action = document.querySelector<HTMLElement>('.ldp-reader-action-layer')!;
const portal = document.createElement('div');
portal.dataset.ldpReaderPortal = 'mian-lite';
document.body.append(portal);
const shadowRoot = portal.attachShadow({ mode: 'open' });
shadowRoot.append(lightbox, settings, action);

assert(
	readerFrontmostEscapeSurface(document) === action &&
		readerSurfaceQuery(document, '.ldp-settings-popover') === settings &&
		readerEscapeOwnedBy(document, action) &&
		!readerEscapeOwnedBy(document, settings) &&
		!readerEscapeOwnedBy(document, lightbox),
	'Shadow Portal 内操作对话框、设置和灯箱并存时，第一次 Esc 只能交给声明层级最高的操作对话框',
);

action.remove();
const boost = document.createElement('section');
boost.className = 'ldp-native-boost-menu';
const reactionPicker = document.createElement('section');
reactionPicker.className = 'ldp-reaction-picker';
shadowRoot.append(boost, reactionPicker);
assert(
	readerFrontmostEscapeSurface(document) === boost &&
		readerSurfaceQueryAll(document, '.ldp-reaction-picker').includes(
			reactionPicker,
		) &&
		readerEscapeOwnedBy(document, boost) &&
		!readerEscapeOwnedBy(document, settings),
	'Boost 与设置并存时，第一次 Esc 必须交给层级更高的 Boost 输入浮窗',
);

const discussion = document.createElement('section');
discussion.className = 'ldp-descendant-replies-layer';
discussion.style.zIndex = '30';
reactionPicker.style.zIndex = '31';
discussion.append(reactionPicker);
shadowRoot.append(discussion);
boost.hidden = true;
settings.hidden = true;
lightbox.hidden = true;
assert(
	readerFrontmostEscapeSurface(document) === reactionPicker &&
		readerEscapeOwnedBy(document, reactionPicker) &&
		!readerEscapeOwnedBy(document, discussion),
	'回应 picker 嵌套在完整讨论浮窗内时，第一次 Esc 只能关闭 picker，父浮窗不得凭 contains 越级消费',
);
settings.hidden = false;
lightbox.hidden = false;

const colorPicker = document.createElement('section');
colorPicker.className = 'ldp-color-picker-popover';
shadowRoot.append(colorPicker);
assert(
	readerFrontmostEscapeSurface(document) === colorPicker &&
		readerEscapeOwnedBy(document, colorPicker) &&
		!readerEscapeOwnedBy(document, settings) &&
		!readerEscapeOwnedBy(document, lightbox),
	'调色器作为设置面板 sibling 打开时必须先取得 Esc，不能在 document capture 阶段误关整个设置面板',
);

colorPicker.hidden = true;
const modelMetadata = document.createElement('article');
modelMetadata.className = 'ldp-ai-service-model-metadata';
shadowRoot.append(modelMetadata);
assert(
	readerFrontmostEscapeSurface(document) === modelMetadata &&
		readerEscapeOwnedBy(document, modelMetadata) &&
		!readerEscapeOwnedBy(document, settings),
	'模型详情作为设置面板 sibling 打开时必须先取得 Esc，关闭详情不得连带关闭设置面板',
);

modelMetadata.hidden = true;
reactionPicker.hidden = true;
settings.hidden = true;
discussion.hidden = true;
assert(
	readerFrontmostEscapeSurface(document) === lightbox &&
		readerEscapeOwnedBy(document, lightbox),
	'hidden 的前置面板必须退出竞争，灯箱随后取得唯一 Esc 所有权',
);

lightbox.remove();
assert(
	readerFrontmostEscapeSurface(document) === null &&
		readerEscapeOwnedBy(document, settings),
	'没有可见浮层时不得残留陈旧 Esc owner 阻止 Reader 自身关闭策略',
);
