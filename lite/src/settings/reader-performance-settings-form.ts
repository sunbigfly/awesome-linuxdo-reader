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
			'使用 Discourse post_ids[] 批量取得正文；当前批次与下一批预知请求最多双路并行。',
		fields: Object.freeze([
			Object.freeze({
				name: 'pageSize',
				title: '每批正文楼层数',
				description:
					'每个 posts.json 请求携带多少个 post id；自动预知只多准备下一批，不推进阅读游标。',
				help: 'Discourse posts.json 的单批 post_ids 数量。当前批次保持顺序，下一批可作为低优先级预知请求并行下载；两者共享缓存、游标和限流许可。',
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
				help: '在当前屏幕前后额外保留多少屏楼层元素；树内与一级楼层共用同一窗口，并受“同时保留楼层上限”约束。',
				unit: '屏',
				step: 0.05,
				inputMode: 'decimal',
			}),
			Object.freeze({
				name: 'streamMaxItems',
				title: '同时保留楼层上限',
				description:
					'页面同时保留的楼层数量上限；离当前阅读位置较远的楼层会卸载，滚回时再恢复。',
				help: '首次进入、滚动和跳转期间，页面最多同时保留多少个正文楼层元素；必要祖先结构壳不计入预算。远处楼层会从页面结构中卸载，并用等高占位保持滚动位置。',
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
			'提前推进正文批次，并按父楼 post id 调用 replies.json 补齐直接回复。',
		fields: Object.freeze([
			Object.freeze({
				name: 'nestedPrefetchViewports',
				title: 'API 提前加载距离',
				description:
					'正文边缘与树节点在进入屏幕前开始取数；数据进缓存，DOM 仍受页面保留预算约束。',
				help: '同一距离同时用于正文 post_ids 批次提升和父楼 replies.json 候选。树状近邻最多并行两个父楼；增加距离只提前网络取数，不扩大正文 DOM 窗口。',
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
			'正文、树状回复、原站请求和其他阅读器标签共用一份启动账本；这里设置总天花板。',
		fields: Object.freeze([
			Object.freeze({
				name: 'requestMaxConcurrent',
				title: '共享总并发上限',
				description:
					'所有 API 的总天花板；正文与树状车道各最多两路，不会各自占满这个数值。',
				help: '阅读器 API 请求的共享总上限。post_ids 正文与 replies 树状车道各最多两路，交互请求可按优先级插队；跨标签许可、原站活动和服务器限流仍会继续降低实际并发。',
				unit: '路',
				step: 1,
				inputMode: 'numeric',
			}),
			Object.freeze({
				name: 'requestMinInterval',
				title: 'API 启动保护间隔',
				description:
					'正常情况下，两次请求开始之间至少间隔多久；原站繁忙或出现 429 时会自动延长。',
				help: '正常状态下两次阅读器请求开始的最短间隔。自适应调度可以延长它，且不会在恢复后一次性补发积压请求。',
				unit: 'ms',
				step: 10,
				inputMode: 'numeric',
			}),
			Object.freeze({
				name: 'requestRateTarget',
				title: 'API 窗口预算比例',
				description:
					'只使用服务器已探测请求额度的一部分，为原站操作保留余量；比例越低越保守。',
				help: '阅读器计划使用服务器 10 秒与 60 秒请求额度的比例。它只控制请求启动节奏，不改变每次加载楼层数或二级回复数量。',
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
	low: '关闭正文批次并行，树状回复单路进入共享许可；适合省流、低配或原站当前较繁忙的环境。',
	balanced: '按现有 Discourse API 自动采用一批正文预知、两路树状候选和 15% 请求窗口余量；保存后当前与后续帖子立即采用。',
	high: '扩大 post_ids 批次和预知距离，允许四路总并发，但仍经过跨标签预算、宿主计账与 429/Cloudflare 闸门。',
	custom: '表示下面的性能参数已经手动调整。点击它不会自动改值，可直接修改下方各项；保存后当前与后续帖子立即采用。',
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
				? `${changed} 项更改等待统一保存；保存后当前与后续帖子立即采用。`
				: `当前采用${presetLabels[preset]}：正文每批 ${config.pageSize} 楼，` +
					`${config.requestMaxConcurrent >= 3 ? '含下一批预知' : '单批顺序加载'}；` +
					`树状最多 ${config.requestMaxConcurrent >= 3 ? 2 : 1} 路，` +
					`共享预算 ${config.requestRateTarget}%。`;
	}
}
