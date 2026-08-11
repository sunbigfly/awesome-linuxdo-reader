import { LifecycleScope } from '../kernel/lifecycle.js';
import type { Signal } from '../kernel/signal.js';
import {
	READER_PERFORMANCE_LIMITS,
	READER_PERFORMANCE_PRESETS,
	createReaderPerformancePreferencesPatch,
	readReaderPerformanceConfig,
	readerPerformancePresetForConfig,
	type ReaderPerformanceConfig,
	type ReaderPerformanceName,
	type ReaderPerformancePreset,
	type ReaderPreferences,
} from '../state/reader-preferences-schema.js';
import type {
	ReaderSettingsController,
	ReaderSettingsDraftAdapter,
} from './reader-settings-controller.js';
import {
	settingsCopy,
	settingsElement as element,
	settingsFooter,
} from './reader-settings-dom.js';
import {
	ReaderNumericSettingsDraft,
} from './reader-numeric-settings-draft.js';

export interface ReaderPerformanceSettingsPreferencesAdapter<
	TPreferences extends object,
> {
	readConfig(preferences: Readonly<TPreferences>): ReaderPerformanceConfig;
	createPatch(
		config: ReaderPerformanceConfig,
		preset: ReaderPerformancePreset,
	): Partial<TPreferences>;
}

export const readerPreferencesPerformanceSettingsAdapter:
ReaderPerformanceSettingsPreferencesAdapter<ReaderPreferences> = Object.freeze({
	readConfig: readReaderPerformanceConfig,
	createPatch: createReaderPerformancePreferencesPatch,
});

export interface ReaderPerformanceSettingsFormOptions<
	TPreferences extends object,
> {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly controller: ReaderSettingsController<TPreferences>;
	readonly preferences: ReaderPerformanceSettingsPreferencesAdapter<TPreferences>;
	readonly readPreferences: () => Readonly<TPreferences>;
	readonly preferenceChanges?: Pick<
		Signal<Readonly<TPreferences>>,
		'subscribe'
	>;
	readonly parentScope?: LifecycleScope;
}

interface PerformanceFieldDefinition {
	readonly name: ReaderPerformanceName;
	readonly title: string;
	readonly description: string;
	readonly help: string;
	readonly unit: string;
	readonly step: number;
	readonly inputMode: 'numeric' | 'decimal';
}

interface PerformanceGroupDefinition {
	readonly id: string;
	readonly title: string;
	readonly description: string;
	readonly fields: readonly PerformanceFieldDefinition[];
}

const groups = Object.freeze<readonly PerformanceGroupDefinition[]>([
	Object.freeze({
		id: 'main-request',
		title: '正文批量 API',
		description:
			'使用 Discourse post_ids[] 批量取得正文；后台预知单槽启动，可见缺口会提升并复用同一在途请求，必要时占用第二个正文槽。',
		fields: Object.freeze([
			Object.freeze({
				name: 'pageSize',
				title: '每批正文楼层目标上限',
				description:
					'每个 posts.json 请求携带的 post id 目标上限；弱设备、省流量或网络受限时，运行时会自动下调。',
				help: 'Discourse posts.json 的单批 post_ids 目标上限。进入近窗时最多排入两批最近缺口，后台始终单槽启动；眼前缺口会提升并复用同一请求。缓存、游标与全站限流许可保持共享；当前生效批次见性能记录。',
				unit: '个',
				step: 1,
				inputMode: 'numeric',
			}),
		]),
	}),
	Object.freeze({
		id: 'dom',
		title: '页面楼层保留',
		description:
			'控制当前页面前后保留多少楼层；远处内容会卸载以节省内存，不会因此发起网络请求。',
		fields: Object.freeze([
			Object.freeze({
				name: 'streamOverscanViewports',
				title: '屏幕外预留范围',
				description:
					'在当前可见区域前后额外保留多少屏内容；只控制 DOM 窗口，不会因此发起网络请求。',
				help: '在当前屏幕前后额外保留多少屏楼层元素；树内与一级楼层共用同一窗口，并受“同时保留楼层目标上限”约束。',
				unit: '屏',
				step: 0.05,
				inputMode: 'decimal',
			}),
			Object.freeze({
				name: 'streamMaxItems',
				title: '同时保留楼层目标上限',
				description:
					'页面同时保留的楼层目标上限；运行时可按设备能力下调，远处楼层卸载后滚回时再恢复。',
				help: '首次进入、滚动和跳转期间的正文楼层保留目标上限；必要祖先结构壳不计入预算。远处楼层会从页面结构中卸载，并用等高占位保持滚动位置；弱设备上实际上限可能更低，当前生效上限见性能记录。',
				unit: '个',
				step: 1,
				inputMode: 'numeric',
			}),
		]),
	}),
	Object.freeze({
		id: 'nested',
		title: '正文与树状预知',
		description:
			'同一距离用于提前提升正文缺口，并按父楼 post id 调用 replies.json 补齐直接回复；仅影响取数时机。',
		fields: Object.freeze([
			Object.freeze({
				name: 'nestedPrefetchViewports',
				title: 'API 提前加载距离',
				description:
					'作为正文边缘与树节点提前取数的目标距离；数据进缓存，DOM 仍受页面保留预算约束。',
				help: '同一目标距离用于正文 post_ids 批次提升和父楼 replies.json 候选。后台正文单槽启动，树状车道最多两路；增加距离只提前网络取数，不扩大正文 DOM 窗口，运行时可按网络状态下调，当前生效距离见性能记录。',
				unit: '屏',
				step: 0.05,
				inputMode: 'decimal',
			}),
		]),
	}),
	Object.freeze({
		id: 'request',
		title: '全站 API 安全边界',
		description:
			'这里设置阅读器请求的目标天花板；实际并发和启动间隔还受设备、网络、跨标签许可、原站活动与 429 限制，并在请求记录显示。',
		fields: Object.freeze([
			Object.freeze({
				name: 'requestMaxConcurrent',
				title: '共享总并发目标上限',
				description:
					'阅读器 API 的共享总并发目标上限；正文与树状车道还有更窄的本地规则。',
				help: '阅读器 API 的共享总并发目标上限。后台 post_ids 正文只占一个槽，总预算允许时可见缺口可占第二个正文槽；replies 树状最多两路。设备与网络自适应、跨标签许可、原站活动和服务器限流会继续降低实际并发。',
				unit: '路',
				step: 1,
				inputMode: 'numeric',
			}),
			Object.freeze({
				name: 'requestMinInterval',
				title: 'API 启动保护目标间隔',
				description:
					'正常状态下两次请求开始的目标最短间隔；自适应调度、原站繁忙或 429 会自动延长。',
				help: '正常状态下两次阅读器请求开始的目标最短间隔。设备、网络、跨标签账本和服务器状态可以延长它，且不会在恢复后一次性补发积压请求；生效间隔在请求记录显示。',
				unit: 'ms',
				step: 10,
				inputMode: 'numeric',
			}),
			Object.freeze({
				name: 'requestRateTarget',
				title: 'API 窗口预算比例',
				description:
					'只使用服务器已探测请求额度的一部分，为原站操作保留余量；比例越低越保守。',
				help: '阅读器计划使用服务器 10 秒与 60 秒请求额度的比例。它只控制请求启动节奏，不改变每次加载楼层数或二级回复数量；生效预算与窗口计数在请求记录显示。',
				unit: '%',
				step: 1,
				inputMode: 'numeric',
			}),
		]),
	}),
]);

const fields = Object.freeze(groups.flatMap((group) => group.fields));
const numericDefinitions = Object.freeze(fields.map((field) => Object.freeze({
	name: field.name,
	label: field.title,
	min: READER_PERFORMANCE_LIMITS[field.name].min,
	max: READER_PERFORMANCE_LIMITS[field.name].max,
	...(READER_PERFORMANCE_LIMITS[field.name].integer
		? { integer: true }
		: {}),
	decimals: READER_PERFORMANCE_LIMITS[field.name].integer ? 0 : 2,
})));
const presetLabels = Object.freeze<
	Readonly<Record<ReaderPerformancePreset, string>>
>({
	low: '省流',
	balanced: '自动（推荐）',
	high: '快速预取',
	custom: '自定义',
});
const presetHelp = Object.freeze<
	Readonly<Record<ReaderPerformancePreset, string>>
>({
	low: '缩小批次、DOM 和总并发目标；后台正文仍为单槽，总预算允许时可见缺口可复用第二槽。适合省流、低配或原站繁忙的环境。',
	balanced: '采用 48 楼批次目标、最多两批近窗缺口入队、后台正文单槽和 15% 请求窗口余量；运行时仍会按设备与网络下调。',
	high: '扩大 post_ids 批次与预知距离，总并发目标为四路；这不是四路正文批次，后台正文仍为单槽，并继续经过跨标签预算与 429/Cloudflare 闸门。',
	custom: '表示下面的性能目标已经手动调整。点击它不会自动改值；保存后当前与后续帖子采用，运行时仍可按设备、网络与限流下调。',
});

/**
 * 性能设置字段、草稿和校验的唯一 owner。
 *
 * 表单不接触 scheduler、Topic、DOM window 或 permit；保存后由 application 唯一偏好事件把
 * 同一规范化 snapshot 投到 ReaderPerformancePolicy，避免设置 UI 复制运行时副作用。
 */
export class ReaderPerformanceSettingsForm<TPreferences extends object> {
	readonly scope: LifecycleScope;
	readonly #controller: ReaderSettingsController<TPreferences>;
	readonly #preferences:
		ReaderPerformanceSettingsPreferencesAdapter<TPreferences>;
	readonly #host: HTMLElement;
	readonly #inputs = new Map<ReaderPerformanceName, HTMLInputElement>();
	readonly #presetButtons = new Map<
		ReaderPerformancePreset,
		HTMLButtonElement
	>();
	readonly #status: HTMLElement;
	readonly #reset: HTMLButtonElement;
	readonly #draft: ReaderNumericSettingsDraft<ReaderPerformanceName>;

	constructor(options: ReaderPerformanceSettingsFormOptions<TPreferences>) {
		this.#controller = options.controller;
		this.#preferences = options.preferences;
		this.#host = options.host;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#draft = new ReaderNumericSettingsDraft(
			numericDefinitions,
			this.#preferences.readConfig(options.readPreferences()),
		);

		const presets = element(
			options.document,
			'div',
			'ldp-performance-presets',
		);
		presets.setAttribute('role', 'group');
		presets.setAttribute('aria-label', '性能预设');
		for (const preset of [
			'low',
			'balanced',
			'high',
			'custom',
		] as const) {
			const button = element(
				options.document,
				'button',
				'ldp-performance-preset',
			);
			button.type = 'button';
			button.dataset.performancePreset = preset;
			button.dataset.settingHelp = presetHelp[preset];
			button.textContent = presetLabels[preset];
			this.#presetButtons.set(preset, button);
			presets.append(button);
			this.scope.listen(button, 'click', () => {
				if (preset === 'custom') {
					this.#inputs.values().next().value?.focus({
						preventScroll: true,
					});
					return;
				}
				this.#writeConfig(READER_PERFORMANCE_PRESETS[preset]);
			});
		}

		const categoryGroups = element(
			options.document,
			'div',
			'ldp-settings-category-groups',
		);
		for (const group of groups) {
			const groupNode = element(
				options.document,
				'section',
				'ldp-settings-category-group',
			);
			groupNode.dataset.settingsCategory = `performance-${group.id}`;
			const head = element(
				options.document,
				'div',
				'ldp-settings-category-head',
			);
			const title = element(options.document, 'strong');
			title.textContent = group.title;
			const description = element(options.document, 'small');
			description.textContent = group.description;
			head.append(title, description);
			const content = element(
				options.document,
				'div',
				'ldp-settings-fields ldp-settings-category-list ldp-performance-fields',
			);
			for (const field of group.fields) {
				const row = element(
					options.document,
					'label',
					'ldp-setting-row',
				);
				row.dataset.settingHelp = field.help;
				const copy = settingsCopy(
					options.document,
					'ldp-performance-copy',
					field.title,
					field.description,
				);
				const control = element(
					options.document,
					'span',
					'ldp-performance-control',
				);
				const input = element(options.document, 'input');
				input.type = 'number';
				input.dataset.performanceKey = field.name;
				input.min = String(READER_PERFORMANCE_LIMITS[field.name].min);
				input.max = String(READER_PERFORMANCE_LIMITS[field.name].max);
				input.step = String(field.step);
				input.inputMode = field.inputMode;
				input.setAttribute('aria-label', field.title);
				const unit = element(options.document, 'em');
				unit.textContent = field.unit;
				control.append(input, unit);
				row.append(copy, control);
				content.append(row);
				this.#inputs.set(field.name, input);
				this.scope.listen(input, 'input', () => {
					this.#draft.setRaw(field.name, input.value);
					this.#render();
					this.#controller.refresh();
				});
			}
			groupNode.append(head, content);
			categoryGroups.append(groupNode);
		}

		const footer = settingsFooter(
			options.document,
			'恢复默认',
			{
				rootClass: 'ldp-performance-footer',
				statusClass: 'ldp-performance-status',
				resetClass: 'ldp-performance-reset',
			},
		);
		this.#status = footer.status;
		this.#reset = footer.reset;
		this.scope.listen(this.#reset, 'click', () => {
			this.#writeConfig(READER_PERFORMANCE_PRESETS.balanced);
		});
		this.#host.replaceChildren(presets, categoryGroups, footer.root);
		this.#syncInputs();

		const adapter: ReaderSettingsDraftAdapter<TPreferences> = {
			panelId: 'performance',
			changeCount: () => this.#changeCount(),
			validate: () => this.#validate(),
			createPatch: () => {
				const config = this.#readConfig()!;
				return this.#preferences.createPatch(
					config,
					readerPerformancePresetForConfig(config),
				);
			},
			acceptPersisted: (preferences) => {
				this.#acceptPreferences(preferences);
			},
			discard: (preferences) => {
				this.#acceptPreferences(preferences);
			},
		};
		this.scope.add(this.#controller.registerDraft(adapter));
		options.preferenceChanges?.subscribe((preferences) => {
			this.applyPreferences(preferences);
		}, this.scope);
		this.scope.add(() => {
			this.#inputs.clear();
			this.#presetButtons.clear();
			this.#host.replaceChildren();
		});
		this.#render();
	}

	applyPreferences(preferences: Readonly<TPreferences>): void {
		if (this.scope.destroyed) return;
		this.#draft.rebase(this.#preferences.readConfig(preferences));
		this.#syncInputs();
		this.#render();
		this.#controller.refresh();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#acceptPreferences(preferences: Readonly<TPreferences>): void {
		this.#draft.accept(this.#preferences.readConfig(preferences));
		this.#syncInputs();
		this.#render();
	}

	#writeConfig(config: ReaderPerformanceConfig, refresh = true): void {
		this.#draft.setValues(config);
		this.#syncInputs();
		this.#render();
		if (refresh) this.#controller.refresh();
	}

	#readConfig(): ReaderPerformanceConfig | null {
		return this.#draft.read() as ReaderPerformanceConfig | null;
	}

	#validate(): readonly string[] {
		return this.#draft.issues();
	}

	#changeCount(): number {
		return this.#draft.changeCount();
	}

	#syncInputs(): void {
		for (const field of fields) {
			this.#inputs.get(field.name)!.value =
				this.#draft.rawValue(field.name);
		}
	}

	#render(): void {
		const config = this.#readConfig();
		const preset = config
			? readerPerformancePresetForConfig(config)
			: 'custom';
		for (const [name, button] of this.#presetButtons) {
			const active = name === preset;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
		}
		const changed = this.#changeCount();
		this.#reset.disabled =
			config !== null &&
			readerPerformancePresetForConfig(config) === 'balanced';
		this.#status.textContent = config === null
			? '部分数值无效；不会保存，也不会改变当前运行时。'
			: changed > 0
				? `${changed} 项目标值等待统一保存；保存后当前与后续帖子立即采用，运行时仍可自适应下调。`
				: `当前采用${presetLabels[preset]}目标：正文每批不超过 ${config.pageSize} 楼，` +
					`后台正文单槽${config.requestMaxConcurrent >= 2
						? '，总预算允许时可见缺口可用第 2 正文槽'
						: '，总预算仅 1 槽'}；` +
					`树状最多 ${Math.min(2, config.requestMaxConcurrent)} 路，` +
					`共享总并发目标 ${config.requestMaxConcurrent} 路，窗口预算 ${config.requestRateTarget}%。` +
					'设备、网络与 429 可继续下调；生效批次与 DOM 上限见性能记录，实际并发、间隔和排队见请求记录。';
	}
}
