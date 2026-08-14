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
			'使用 post_ids[] 补近窗正文缺口；后台空闲单飞，可见缺口提升并复用同一在途请求。',
		fields: Object.freeze([
			Object.freeze({
				name: 'pageSize',
				title: '每批正文楼层目标上限',
				description:
					'每个 posts.json 请求携带的 post id 目标上限；弱设备、省流量或网络受限时，运行时会自动下调。',
				help: 'posts.json 单批 post_ids 目标上限。近窗最多两批；后台单飞，可见缺口复用在途请求。共享许可不变，生效批次见性能记录。',
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
				help: '同一距离提升正文并触发 replies.json 候选；后台单飞，树状最多两路，只提前取数。',
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
			'这里只设置目标上限；后台仍须空闲单飞，并让位于前台、活动请求和共享窗口。',
		fields: Object.freeze([
			Object.freeze({
				name: 'requestMaxConcurrent',
				title: '共享总并发目标上限',
				description:
					'阅读器 API 的共享总并发目标上限；正文与树状车道还有更窄的本地规则。',
				help: '共享总并发目标；后台单飞，可见正文最多两槽，replies 最多两路。设备、网络、多标签、原站活动及 429/Cloudflare 可收紧。',
				unit: '路',
				step: 1,
				inputMode: 'numeric',
			}),
			Object.freeze({
				name: 'requestMinInterval',
				title: 'API 启动保护目标间隔',
				description:
					'正常请求启动目标间隔；后台保护、跨标签账本和原站活动可继续延后。',
				help: '基础启动间隔。后台有固定空闲保护；Retry-After 仅作用于命中的逻辑请求/profile，不改写全局设置。',
				unit: 'ms',
				step: 10,
				inputMode: 'numeric',
			}),
			Object.freeze({
				name: 'requestRateTarget',
				title: 'API 窗口预算比例',
				description:
					'固定 10 秒/60 秒预防上限的使用比例，为原站保留余量。',
				help: '只作用于固定窗口。服务器额度仅诊断，不自动改写设置；429/Cloudflare 仍由请求 profile 和共享硬闸门处理。',
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
	high: '快速预取（实验）',
	custom: '自定义',
});
const presetHelp = Object.freeze<
	Readonly<Record<ReaderPerformancePreset, string>>
>({
	low: '缩小批次、DOM 和总并发；后台单飞。适合省流、低配或原站繁忙。',
	balanced: '48 楼批次、两批近窗、后台单飞、窗口余量 15%；设备与网络可下调。',
	high: '实验档：扩大批次、预知距离和总并发，可能增加卡顿或 429；仍服从共享窗口和请求安全规则。',
	custom: '手动目标；高于自动档时会提示卡顿与 429 风险。保存后仍服从自适应、共享窗口和请求契约。',
});

function performanceConfigExceedsBalanced(
	config: ReaderPerformanceConfig,
): boolean {
	const balanced = READER_PERFORMANCE_PRESETS.balanced;
	return config.pageSize > balanced.pageSize ||
		config.streamOverscanViewports > balanced.streamOverscanViewports ||
		config.streamMaxItems > balanced.streamMaxItems ||
		config.nestedPrefetchViewports > balanced.nestedPrefetchViewports ||
		config.requestMaxConcurrent > balanced.requestMaxConcurrent ||
		config.requestMinInterval < balanced.requestMinInterval ||
		config.requestRateTarget > balanced.requestRateTarget;
}

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
		const risky = config !== null && (
			preset === 'high' ||
			(preset === 'custom' && performanceConfigExceedsBalanced(config))
		);
		for (const [name, button] of this.#presetButtons) {
			const active = name === preset;
			button.classList.toggle('active', active);
			button.setAttribute('aria-pressed', String(active));
			if (name === 'high' || (name === 'custom' && active && risky)) {
				button.dataset.performanceRisk = 'experimental';
			} else {
				delete button.dataset.performanceRisk;
			}
		}
		const changed = this.#changeCount();
		this.#reset.disabled =
			config !== null &&
			readerPerformancePresetForConfig(config) === 'balanced';
		const status = config === null
			? '部分数值无效；不会保存，也不会改变当前运行时。'
			: changed > 0
				? `${changed} 项目标值等待统一保存；保存后当前与后续帖子立即采用，设备与网络仍可自适应下调。`
				: `当前采用${presetLabels[preset]}目标：正文每批不超过 ${config.pageSize} 楼，` +
					`后台请求空闲单飞${config.requestMaxConcurrent >= 2
						? '，总预算允许时可见缺口可用第 2 正文槽'
						: '，总预算仅 1 槽'}；` +
					`树状最多 ${Math.min(2, config.requestMaxConcurrent)} 路，` +
					`共享总并发目标 ${config.requestMaxConcurrent} 路，窗口预算 ${config.requestRateTarget}%。` +
					'设备与网络可下调；其他 owner 可延后或停止请求。生效批次与 DOM 见性能记录，请求实际值见请求记录。';
		this.#status.textContent = risky
			? `${status} 风险提示：高负载目标可能增加卡顿或 429；不确定时请使用自动（推荐）。`
			: status;
		this.#status.classList.toggle('is-risk', risky);
	}
}
