import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	createReaderTranslationButton,
	type ReaderTranslationButton,
} from './reader-translation-button.js';
import {
	ReaderTranslationController,
	type ReaderTranslationMode,
	type ReaderTranslationPostMetadata,
	type ReaderTranslationPreloadPost,
} from './reader-translation-controller.js';
import type { TranslationBatchPort } from './translation-request-adapter.js';
import type { ReaderTranslationAnimation } from './reader-translation-config.js';
import type { ReaderTranslationTheme } from
	'./reader-translation-presentation.js';

export interface ReaderTranslationFeatureOptions {
	readonly document: Document;
	readonly translator: TranslationBatchPort;
	readonly buttonHost: HTMLElement;
	readonly surfaces: () => readonly HTMLElement[];
	readonly initialMode: ReaderTranslationMode;
	readonly initialAnimation?: ReaderTranslationAnimation;
	readonly initialTheme?: ReaderTranslationTheme;
	readonly subscribeAnimation?: (
		listener: (animation: ReaderTranslationAnimation) => void,
		scope: LifecycleScope,
	) => void;
	readonly subscribeTheme?: (
		listener: (theme: ReaderTranslationTheme) => void,
		scope: LifecycleScope,
	) => void;
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
	readonly #document: Document;

	constructor(options: ReaderTranslationFeatureOptions) {
		this.#document = options.document;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		try {
			this.controller = new ReaderTranslationController({
				translator: options.translator,
				surfaces: options.surfaces,
				initialMode: options.initialMode,
				...(options.initialAnimation === undefined
					? {}
					: { initialAnimation: options.initialAnimation }),
				...(options.initialTheme === undefined
					? {}
					: { initialTheme: options.initialTheme }),
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
			options.subscribeAnimation?.(
				(animation) => this.controller.setAnimation(animation),
				this.scope,
			);
			options.subscribeTheme?.(
				(theme) => this.controller.setTheme(theme),
				this.scope,
			);
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

	preloadPosts(posts: readonly ReaderTranslationPreloadPost[]): void {
		this.controller.preloadPosts(this.#document, posts);
	}

	activateTopic(topicId: string | number): number {
		return this.controller.activateTopic(topicId);
	}

	updatePreloadWindow(
		topicId: string | number,
		posts: readonly ReaderTranslationPreloadPost[],
		generation?: number,
	): void {
		this.controller.updatePreloadWindow(
			this.#document,
			topicId,
			posts,
			generation,
		);
	}

	deactivateTopic(topicId: string | number, generation?: number): void {
		this.controller.deactivateTopic(topicId, generation);
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

	projectKnownTranslations(root: ParentNode): number {
		return this.controller.projectKnownTranslations(root);
	}

	applyMode(mode: ReaderTranslationMode): void {
		if (this.controller.mode === mode) return;
		this.controller.setMode(mode, { persist: false });
	}

	destroy(): void {
		this.scope.destroy();
	}
}
