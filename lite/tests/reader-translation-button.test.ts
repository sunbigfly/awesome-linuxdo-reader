import { parseHTML } from 'linkedom';
import {
	createReaderTranslationButton,
} from '../src/translation/reader-translation-button.js';
import {
	ReaderTranslationController,
} from '../src/translation/reader-translation-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><div class="surface"></div><div class="actions"></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const surface = document.querySelector<HTMLElement>('.surface')!;
const actions = document.querySelector<HTMLElement>('.actions')!;
const controller = new ReaderTranslationController({
	translator: {
		async translate(texts) {
			return texts;
		},
	},
	surfaces: () => [surface],
	initialMode: 'original',
	startupDelayMs: 0,
	delay: async () => {},
});
const modes: string[] = [];
const binding = createReaderTranslationButton({
	document,
	controller,
	renderIcon: (owner) => {
		const icon = owner.createElement('span');
		icon.className = 'ldp-icon';
		return icon;
	},
	onModeChanged: (mode) => modes.push(mode),
});
actions.append(binding.button);
assert(
	binding.button.className === 'ldp-translate-toggle' &&
	binding.button.getAttribute('aria-label') === '翻译正文' &&
	binding.button.getAttribute('aria-pressed') === 'false',
	'翻译按钮必须保持旧 class 与原文状态可访问语义',
);
binding.button.click();
assert(
	binding.button.classList.contains('is-active') &&
	binding.button.getAttribute('aria-label') === '正文翻译：双语显示' &&
	modes[0] === 'bilingual',
	'翻译按钮只能通过 controller cycle 切换双语',
);
binding.button.click();
assert(
	binding.button.getAttribute('aria-label') === '正文翻译：全译文' &&
	surface.classList.contains('ldp-translation-only'),
	'全译文按钮状态必须与 surface 投影同步',
);
binding.destroy();
assert(!actions.firstElementChild, '按钮 adapter 销毁必须释放 DOM/订阅');
controller.destroy();
