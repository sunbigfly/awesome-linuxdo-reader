import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	createReaderTranslationButton,
	type ReaderTranslationButton,
} from './reader-translation-button.js';
import {
	ReaderTranslationController,
	type ReaderTranslationMode,
	type ReaderTranslationPostMetadata,
} from './reader-translation-controller.js';
import type { TranslationBatchPort } from './translation-request-adapter.js';

export interface ReaderTranslationFeatureOptions {
	readonly document: Document;
	readonly translator: TranslationBatchPort;
	readonly buttonHost: HTMLElement;
	readonly surfaces: () => readonly HTMLElement[];
	readonly initialMode: ReaderTranslationMode;
	readonly persistMode?: (mode: ReaderTranslationMode) => void;
	readonly readPost?: (post: HTMLElement) => ReaderTranslationPostMetadata;
	readonly renderIcon?: (document: Document) => Node;
	readonly onModeChanged?: (mode: ReaderTranslationMode) => void;
	readonly startupDelayMs?: number;
	readonly delay?: (
		milliseconds: number,
		signal: AbortSignal,
	) => Promise<void>;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
	readonly notify?: (message: string) => void;
}

/**
 * 正文翻译页面纵切的唯一组件组合 owner。
 *
 * controller 继续独占状态/DOM 文本，button 继续只发命令；本 owner 只把它们挂到稳定 Shell
 * header，并向 Topic/PostView 与完整讨论窗口暴露显式 sync 入口，不安装全局 Observer。
 */
export class ReaderTranslationFeature {
	readonly scope: LifecycleScope;
	readonly controller: ReaderTranslationController;
	readonly button: ReaderTranslationButton;

	constructor(options: ReaderTranslationFeatureOptions) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		try {
			this.controller = new ReaderTranslationController({
				translator: options.translator,
				surfaces: options.surfaces,
				initialMode: options.initialMode,
				...(options.persistMode === undefined
					? {}
					: { persistMode: options.persistMode }),
				...(options.readPost === undefined ? {} : { readPost: options.readPost }),
				...(options.startupDelayMs === undefined
					? {}
					: { startupDelayMs: options.startupDelayMs }),
				...(options.delay === undefined ? {} : { delay: options.delay }),
				...(options.onError === undefined ? {} : { onError: options.onError }),
				...(options.notify === undefined ? {} : { notify: options.notify }),
				parentScope: this.scope,
			});
			this.button = createReaderTranslationButton({
				document: options.document,
				controller: this.controller,
				...(options.renderIcon === undefined
					? {}
					: { renderIcon: options.renderIcon }),
				...(options.onModeChanged === undefined
					? {}
					: { onModeChanged: options.onModeChanged }),
				parentScope: this.scope,
			});
			options.buttonHost.append(this.button.button);
			this.controller.start();
		} catch (error) {
			this.scope.destroy();
			throw error;
		}
	}

	syncMountedPosts(): void {
		this.controller.syncMountedPosts();
	}

	syncPost(
		post: HTMLElement,
		metadata?: ReaderTranslationPostMetadata,
	): void {
		if (metadata === undefined) this.controller.syncPost(post);
		else this.controller.syncPost(post, metadata);
	}

	applyMode(mode: ReaderTranslationMode): void {
		if (this.controller.mode === mode) return;
		this.controller.setMode(mode, { persist: false });
	}

	destroy(): void {
		this.scope.destroy();
	}
}
