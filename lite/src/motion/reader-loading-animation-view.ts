import { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderLoadingAnimation,
} from '../state/reader-preferences-schema.js';
import {
	READER_LOADING_ANIMATION_KEYS,
} from '../state/reader-preferences-schema.js';
import type {
	ReaderShell,
	ReaderShellState,
} from '../shell/reader-shell.js';

export type ReaderLoadingAnimationKey = Exclude<
	ReaderLoadingAnimation,
	'random'
>;

export interface ReaderLoadingAnimationDefinition {
	readonly key: ReaderLoadingAnimationKey;
	readonly label: string;
	readonly markup: string;
}

export interface ReaderLoadingAnimationViewOptions<TContext> {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly shell: ReaderShell<TContext>;
	readonly preference: ReaderLoadingAnimation;
	readonly siteName: string;
	readonly random?: () => number;
	readonly parentScope?: LifecycleScope;
}

export type ReaderLoadingPhase =
	| 'prepare'
	| 'cache'
	| 'network'
	| 'render';

export interface ReaderLoadingProgress {
	readonly topicId: number;
	readonly phase: ReaderLoadingPhase;
	readonly targetPostNumber?: number;
	readonly cachedCount?: number;
	readonly missingCount?: number;
}

export interface ReaderLoadingProgressPort {
	begin(topicId: number, targetPostNumber?: number): () => void;
	update(progress: ReaderLoadingProgress): void;
}

const definitions = Object.freeze<readonly ReaderLoadingAnimationDefinition[]>([
	Object.freeze({
		key: 'portal',
		label: '主题开卷',
		markup: '<div class="ldp-loading-visual-inner ldp-loader-portal"><span data-copy="TOPIC"></span><span data-copy="#1"></span><span></span><span></span><span></span><span></span></div>',
	}),
	Object.freeze({
		key: 'constellation',
		label: '回帖脉络',
		markup: '<div class="ldp-loading-visual-inner ldp-loader-thread-index"><span data-user="OP" data-floor="#1"></span><span data-user="↳ 回帖" data-floor="#2"></span><span data-user="↳ 二级回复" data-floor="#6"></span><span data-user="↳ 回帖" data-floor="#9"></span><span data-user="↳ 二级回复" data-floor="#12"></span><span data-user="↳ 继续回复" data-floor="#18"></span></div>',
	}),
	Object.freeze({
		key: 'corridor',
		label: '楼层时间轴',
		markup: '<div class="ldp-loading-visual-inner ldp-loader-floor-reel"><span data-floor="#01" data-time="首帖"></span><span data-floor="#02" data-time="回复"></span><span data-floor="#03" data-time="当前"></span><span data-floor="#04" data-time="回复"></span><span data-floor="#05" data-time="最新"></span></div>',
	}),
	Object.freeze({
		key: 'typewave',
		label: 'Markdown 解析',
		markup: '<div class="ldp-loading-visual-inner ldp-loader-typewave"><span data-source="# 标题"></span><span data-source="**重点**"></span><span data-source="> 引用"></span><span data-render="标题"></span><span data-render="重点"></span><span data-render="引用内容"></span></div>',
	}),
	Object.freeze({
		key: 'crystal',
		label: '缓存回环',
		markup: '<div class="ldp-loading-visual-inner ldp-loader-cache-lanes"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>',
	}),
	Object.freeze({
		key: 'marginalia',
		label: '只看楼主',
		markup: '<div class="ldp-loading-visual-inner ldp-loader-marginalia"><span data-user="OP" data-floor="#1"></span><span data-user="佬友" data-floor="#2"></span><span data-user="OP" data-floor="#7"></span><span data-user="佬友" data-floor="#8"></span><span data-user="OP" data-floor="#16"></span></div>',
	}),
	Object.freeze({
		key: 'chapters',
		label: '分类标签',
		markup: '<div class="ldp-loading-visual-inner ldp-loader-index-fan"><span data-index="01" data-tag="类别"></span><span data-index="02" data-tag="标签"></span><span data-index="03" data-tag="楼主"></span><span data-index="04" data-tag="楼层"></span><span data-index="05" data-tag="回复"></span></div>',
	}),
	Object.freeze({
		key: 'quoteecho',
		label: '社区信条',
		markup: '<div class="ldp-loading-visual-inner ldp-loader-quoteecho"><span data-word="真诚"></span><span data-word="友善"></span><span data-word="团结"></span><span data-word="专业"></span></div>',
	}),
	Object.freeze({
		key: 'footnotes',
		label: '新回复抵达',
		markup: '<div class="ldp-loading-visual-inner ldp-loader-inbox-rain"><span data-floor="#128"></span><span data-floor="#129"></span><span data-floor="#130"></span><span data-floor="#131"></span><span data-floor="#132"></span></div>',
	}),
	Object.freeze({
		key: 'inkverse',
		label: '互动汇流',
		markup: '<div class="ldp-loading-visual-inner ldp-loader-inkverse"><span data-action="赞"></span><span data-action="Boost"></span><span data-action="回应"></span><span data-action="收藏"></span></div>',
	}),
]);

export const READER_LOADING_ANIMATION_DEFINITIONS = definitions;

const definitionByKey = new Map(
	definitions.map((definition) => [definition.key, definition] as const),
);

if (
	definitions.length !== READER_LOADING_ANIMATION_KEYS.length ||
	READER_LOADING_ANIMATION_KEYS.some((key) => !definitionByKey.has(key))
) {
	throw new Error('加载动画目录与偏好 schema 不一致');
}

function normalizePreference(
	value: ReaderLoadingAnimation,
): ReaderLoadingAnimation {
	return value === 'random' || definitionByKey.has(value)
		? value
		: 'quoteecho';
}

export function selectReaderLoadingAnimation(
	preference: ReaderLoadingAnimation,
	random: () => number = Math.random,
	excludedKey?: ReaderLoadingAnimationKey,
): ReaderLoadingAnimationDefinition {
	const normalized = normalizePreference(preference);
	if (normalized !== 'random') return definitionByKey.get(normalized)!;
	const candidates = excludedKey
		? definitions.filter((definition) => definition.key !== excludedKey)
		: definitions;
	const unit = Math.min(0.999_999, Math.max(0, Number(random()) || 0));
	return candidates[Math.floor(unit * candidates.length)] ?? definitions[0]!;
}

export function renderReaderLoadingVisual(
	document: Document,
	definition: ReaderLoadingAnimationDefinition,
): HTMLElement {
	const visual = document.createElement('div');
	visual.className = 'ldp-loading-visual';
	visual.dataset.animation = definition.key;
	visual.setAttribute('aria-hidden', 'true');
	visual.innerHTML = definition.markup;
	return visual;
}

function createLoadingStage(
	document: Document,
	siteName: string,
): Readonly<{
	readonly root: HTMLElement;
	readonly visual: HTMLElement;
	readonly mode: HTMLElement;
	readonly stage: HTMLElement;
	readonly status: HTMLElement;
	readonly target: HTMLElement;
	readonly detail: HTMLElement;
}> {
	const root = document.createElement('div');
	root.className = 'ldp-loadmask';
	root.hidden = true;
	const stage = document.createElement('div');
	stage.className = 'ldp-loading-stage';
	stage.role = 'status';
	stage.setAttribute('aria-live', 'polite');
	stage.setAttribute('aria-atomic', 'true');
	stage.setAttribute('aria-label', '正在载入');
	const visual = document.createElement('div');
	visual.className = 'ldp-loading-visual';
	const copy = document.createElement('div');
	copy.className = 'ldp-loading-copy';
	const mode = document.createElement('div');
	mode.className = 'ldp-loading-mode';
	const status = document.createElement('div');
	status.className = 'ldp-loading-status';
	const statusText = document.createElement('span');
	statusText.textContent = '正在载入帖子';
	const target = document.createElement('strong');
	target.className = 'ldp-loading-target';
	status.append(statusText, target);
	const detail = document.createElement('div');
	detail.className = 'ldp-loading-detail';
	detail.textContent = '正在准备阅读现场…';
	copy.append(mode, status, detail);
	stage.append(visual, copy);
	root.append(stage);
	mode.dataset.siteName = siteName.trim().toUpperCase() || 'DISCOURSE';
	return Object.freeze({
		root,
		visual,
		mode,
		stage,
		status: statusText,
		target,
		detail,
	});
}

/**
 * Shell 打开状态与加载视觉的唯一 owner。
 *
 * 只订阅稳定 Shell state；不观察楼层 DOM、不发请求、不创建计时器。随机样式仅在每次
 * opening/switching 起点抽取，并避开上一次结果。
 */
export class ReaderLoadingAnimationView<TContext>
	implements ReaderLoadingProgressPort {
	readonly scope: LifecycleScope;
	readonly #shell: ReaderShell<TContext>;
	readonly #random: () => number;
	readonly #root: HTMLElement;
	readonly #mode: HTMLElement;
	readonly #stage: HTMLElement;
	readonly #status: HTMLElement;
	readonly #target: HTMLElement;
	readonly #detail: HTMLElement;
	#visual: HTMLElement;
	#preference: ReaderLoadingAnimation;
	#lastRandomKey: ReaderLoadingAnimationKey | undefined;
	#visible = false;
	#shellState: ReaderShellState;
	#held = false;
	#transaction = 0;
	#topicId = 0;
	#targetPostNumber = 0;

	constructor(options: ReaderLoadingAnimationViewOptions<TContext>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#shell = options.shell;
		this.#random = options.random ?? Math.random;
		this.#preference = normalizePreference(options.preference);
		this.#shellState = this.#shell.state;
		const stage = createLoadingStage(options.document, options.siteName);
		this.#root = stage.root;
		this.#visual = stage.visual;
		this.#mode = stage.mode;
		this.#stage = stage.stage;
		this.#status = stage.status;
		this.#target = stage.target;
		this.#detail = stage.detail;
		options.host.append(this.#root);
		this.#shell.changes.subscribe(
			(state) => this.#applyState(state),
			this.scope,
		);
		this.scope.add(() => {
			this.#shell.view.root.removeAttribute('aria-busy');
			this.#shell.view.modal.classList.remove('ldp-loadmask-visible');
			this.#root.remove();
		});
		this.#applyState(this.#shell.state);
	}

	apply(preference: ReaderLoadingAnimation): void {
		if (this.scope.destroyed) return;
		const normalized = normalizePreference(preference);
		if (normalized === this.#preference) return;
		this.#preference = normalized;
		if (this.#visible) this.#render();
	}

	begin(topicId: number, targetPostNumber = 0): () => void {
		if (this.scope.destroyed) return () => {};
		const normalizedTopicId = Math.max(0, Math.floor(Number(topicId) || 0));
		const normalizedTarget = Math.max(
			0,
			Math.floor(Number(targetPostNumber) || 0),
		);
		const transaction = ++this.#transaction;
		this.#topicId = normalizedTopicId;
		this.#targetPostNumber = normalizedTarget;
		this.#held = true;
		this.#syncVisibility();
		this.update({
			topicId: normalizedTopicId,
			phase: 'prepare',
			...(normalizedTarget > 1
				? { targetPostNumber: normalizedTarget }
				: {}),
		});
		return () => {
			if (this.scope.destroyed || transaction !== this.#transaction) return;
			this.#held = false;
			this.#syncVisibility();
		};
	}

	update(progress: ReaderLoadingProgress): void {
		if (this.scope.destroyed) return;
		const topicId = Math.max(0, Math.floor(Number(progress.topicId) || 0));
		if (topicId !== this.#topicId) {
			if (
				this.#held ||
				(this.#shellState !== 'opening' && this.#shellState !== 'switching')
			) return;
			this.#topicId = topicId;
			this.#targetPostNumber = 0;
		}
		if (progress.targetPostNumber !== undefined) {
			this.#targetPostNumber = Math.max(
				0,
				Math.floor(Number(progress.targetPostNumber) || 0),
			);
		}
		const target = this.#targetPostNumber > 1;
		const cachedCount = Math.max(0, Math.floor(
			Number(progress.cachedCount) || 0,
		));
		const missingCount = Math.max(0, Math.floor(
			Number(progress.missingCount) || 0,
		));
		const copy = progress.phase === 'prepare'
			? {
				status: target ? '正在准备目标楼层' : '正在准备帖子数据',
				detail: '正在检查帖子缓存…',
			}
			: progress.phase === 'cache'
				? {
					status: target ? '正在读取目标楼层缓存' : '正在读取帖子缓存',
					detail: cachedCount
						? `已读取 ${cachedCount} 条缓存，正在恢复楼层…`
						: '正在恢复已缓存楼层…',
				}
				: progress.phase === 'network'
					? {
						status: target
							? '正在请求目标楼层'
							: cachedCount
								? '正在补全帖子数据'
								: '正在请求帖子数据',
						detail: cachedCount
							? `已读取 ${cachedCount} 条缓存，正在下载 ${missingCount} 条缺失楼层…`
							: missingCount
								? `正在下载 ${missingCount} 条缺失楼层…`
								: '正在下载缺失楼层…',
					}
					: {
						status: '正在渲染帖子',
						detail: '正在生成页面…',
					};
		this.#status.textContent = copy.status;
		this.#detail.textContent = copy.detail;
		this.#target.textContent = target
			? `#${this.#targetPostNumber}`
			: '';
		this.#stage.setAttribute(
			'aria-label',
			`${copy.status}，${copy.detail.replace('…', '')}`,
		);
	}

	destroy(): void {
		this.scope.destroy();
	}

	#applyState(state: ReaderShellState): void {
		this.#shellState = state;
		this.#syncVisibility();
	}

	#syncVisibility(): void {
		const visible = this.#held ||
			this.#shellState === 'opening' ||
			this.#shellState === 'switching';
		if (visible && !this.#visible) this.#render();
		this.#visible = visible;
		this.#shell.view.modal.classList.toggle(
			'ldp-loadmask-visible',
			visible,
		);
		if (visible) {
			this.#shell.view.root.setAttribute('aria-busy', 'true');
		} else {
			this.#shell.view.root.removeAttribute('aria-busy');
		}
		this.#root.hidden = !visible;
	}

	#render(): void {
		const excluded = this.#preference === 'random'
			? this.#lastRandomKey
			: undefined;
		const definition = selectReaderLoadingAnimation(
			this.#preference,
			this.#random,
			excluded,
		);
		if (this.#preference === 'random') {
			this.#lastRandomKey = definition.key;
		}
		const visual = renderReaderLoadingVisual(
			this.#root.ownerDocument,
			definition,
		);
		this.#visual.replaceWith(visual);
		this.#visual = visual;
		this.#mode.textContent =
			`${this.#mode.dataset.siteName} READER · ${definition.label}`;
	}
}
