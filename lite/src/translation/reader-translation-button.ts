import { LifecycleScope } from '../kernel/lifecycle.js';
import { renderReaderIcon } from '../components/reader-icon.js';
import type {
	ReaderTranslationController,
	ReaderTranslationMode,
	ReaderTranslationSnapshot,
} from './reader-translation-controller.js';

export interface ReaderTranslationButtonOptions {
	readonly document: Document;
	readonly controller: ReaderTranslationController;
	readonly renderIcon?: (document: Document) => Node;
	readonly onModeChanged?: (mode: ReaderTranslationMode) => void;
	readonly parentScope?: LifecycleScope;
}

export interface ReaderTranslationButton {
	readonly button: HTMLButtonElement;
	readonly scope: LifecycleScope;
	destroy(): void;
}

function label(snapshot: ReaderTranslationSnapshot): string {
	if (!snapshot.active) return '翻译正文';
	return snapshot.mode === 'translation'
		? '正文翻译：全译文'
		: '正文翻译：双语显示';
}

/**
 * 正文翻译 header button 的唯一 DOM adapter。
 *
 * 只投影 controller snapshot 并发送 cycle 命令；不读取帖子、不请求翻译、不直接写偏好。
 */
export function createReaderTranslationButton(
	options: ReaderTranslationButtonOptions,
): ReaderTranslationButton {
	const scope = LifecycleScope.ownedBy(options.parentScope);
	const button = options.document.createElement('button');
	button.className = 'ldp-translate-toggle';
	button.type = 'button';
	button.append(renderReaderIcon(
		options.document,
		'languages',
		options.renderIcon
			? (_name, document) => options.renderIcon?.(document)
			: null,
	));
	const render = (snapshot: ReaderTranslationSnapshot): void => {
		button.hidden = false;
		button.classList.toggle('is-active', snapshot.active);
		button.classList.toggle('is-busy', snapshot.busy);
		button.setAttribute('aria-busy', String(snapshot.busy));
		button.setAttribute('aria-pressed', String(snapshot.active));
		button.setAttribute('aria-label', label(snapshot));
	};
	render(options.controller.snapshot());
	options.controller.changes.subscribe(render, scope);
	scope.listen(button, 'click', (rawEvent) => {
		const event = rawEvent as MouseEvent;
		event.preventDefault();
		event.stopPropagation();
		const mode = options.controller.cycleMode();
		options.onModeChanged?.(mode);
	});
	scope.add(() => {
		button.hidden = true;
		button.classList.remove('is-active', 'is-busy');
		button.remove();
	});
	return Object.freeze({
		button,
		scope,
		destroy: () => scope.destroy(),
	});
}
