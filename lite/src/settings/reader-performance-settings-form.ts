import { LifecycleScope } from '../kernel/lifecycle.js';
import type { Signal } from '../kernel/signal.js';
import {
	HOST_TOPIC_PREHEAT_POST_COUNT_DEFAULT,
	HOST_TOPIC_PREHEAT_POST_COUNT_MAX,
	HOST_TOPIC_PREHEAT_POST_COUNT_MIN,
	READER_PERFORMANCE_DEFAULT_CONFIG,
	READER_PERFORMANCE_LIMITS,
	createReaderBusinessRequestSettingsPatch,
	createReaderPerformancePreferencesPatch,
	createReaderRequestFlowSettingsPatch,
	readReaderBusinessRequestSettings,
	readReaderPerformanceConfig,
	readReaderRequestFlowSettings,
	readerPerformanceConfigIsDefault,
	type ReaderPerformanceConfig,
	type ReaderPerformanceName,
	type ReaderPreferences,
} from '../state/reader-preferences-schema.js';
import {
	READER_BUSINESS_REQUEST_DEFAULTS,
	READER_BUSINESS_REQUEST_KINDS,
	READER_BUSINESS_REQUEST_PARAMETER_LIMITS,
	READER_BUSINESS_REQUEST_PARAMETER_NAMES,
	expandReaderBusinessRequestSettings,
	flattenReaderBusinessRequestSettings,
	readerBusinessRequestSettingsAreDefault,
	type ReaderBusinessRequestFieldName,
	type ReaderBusinessRequestParameterName,
	type ReaderBusinessRequestSettings,
} from '../network/reader-business-request-config.js';
import {
	READER_REQUEST_FLOW_DEFAULTS,
	READER_REQUEST_FLOW_SETTING_LIMITS,
	READER_REQUEST_FLOW_SETTING_NAMES,
	normalizeReaderRequestFlowSettings,
	readerRequestFlowSettingsAreDefault,
	type ReaderRequestFlowSettingName,
	type ReaderRequestFlowSettings,
} from '../network/reader-request-flow-config.js';
import type {
	ReaderSettingsController,
	ReaderSettingsDraftAdapter,
} from './reader-settings-controller.js';
import {
	READER_BUSINESS_REQUEST_POLICIES,
	readerBusinessRequestPolicySnapshot,
	type ReaderBusinessRequestCacheOwner,
	type ReaderBusinessRequestExecution,
	type ReaderBusinessRequestKind,
} from '../network/reader-business-request-policy.js';
import {
	settingsCopy,
	settingsElement as element,
	settingsFooter,
	settingsOptionRow,
	settingsSwitch,
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
	): Partial<TPreferences>;
	readBusinessRequestSettings?(
		preferences: Readonly<TPreferences>,
	): ReaderBusinessRequestSettings;
	createBusinessRequestSettingsPatch?(
		settings: ReaderBusinessRequestSettings,
	): Partial<TPreferences>;
	readRequestFlowSettings?(
		preferences: Readonly<TPreferences>,
	): ReaderRequestFlowSettings;
	createRequestFlowSettingsPatch?(
		settings: ReaderRequestFlowSettings,
	): Partial<TPreferences>;
	readHostTopicPreheatEnabled?(
		preferences: Readonly<TPreferences>,
	): boolean;
	createHostTopicPreheatEnabledPatch?(
		enabled: boolean,
	): Partial<TPreferences>;
	readHostTopicPreheatPostCount?(
		preferences: Readonly<TPreferences>,
	): number;
	createHostTopicPreheatPostCountPatch?(
		postCount: number,
	): Partial<TPreferences>;
	readSuspendHostTurnstileInBackground?(
		preferences: Readonly<TPreferences>,
	): boolean;
	createSuspendHostTurnstileInBackgroundPatch?(
		enabled: boolean,
	): Partial<TPreferences>;
}

export const readerPreferencesPerformanceSettingsAdapter:
ReaderPerformanceSettingsPreferencesAdapter<ReaderPreferences> = Object.freeze({
	readConfig: readReaderPerformanceConfig,
	createPatch: createReaderPerformancePreferencesPatch,
	readBusinessRequestSettings: readReaderBusinessRequestSettings,
	createBusinessRequestSettingsPatch:
		createReaderBusinessRequestSettingsPatch,
	readRequestFlowSettings: readReaderRequestFlowSettings,
	createRequestFlowSettingsPatch: createReaderRequestFlowSettingsPatch,
	readHostTopicPreheatEnabled: (
		preferences: Readonly<ReaderPreferences>,
	) => preferences.hostTopicPreheatEnabled,
	createHostTopicPreheatEnabledPatch: (enabled: boolean) => ({
		hostTopicPreheatEnabled: enabled,
	}),
	readHostTopicPreheatPostCount: (
		preferences: Readonly<ReaderPreferences>,
	) => preferences.hostTopicPreheatPostCount,
	createHostTopicPreheatPostCountPatch: (postCount: number) => ({
		hostTopicPreheatPostCount: postCount,
	}),
	readSuspendHostTurnstileInBackground: (
		preferences: Readonly<ReaderPreferences>,
	) =>
		preferences.performanceSuspendHostTurnstileInBackground,
	createSuspendHostTurnstileInBackgroundPatch: (enabled: boolean) => ({
		performanceSuspendHostTurnstileInBackground: enabled,
	}),
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
		id: 'read-state',
		title: '已读上报队列',
		description:
			'只限制 /topics/timings：RPM 是请求数/分钟，TPM 是 timings 已读楼层条目数/分钟。',
		fields: Object.freeze([
			Object.freeze({
				name: 'readStateRequestsPerMinute',
				title: '已读请求上限（RPM）',
				description:
					'同账号跨标签滚动 60 秒窗口内最多启动多少次已读请求。',
				help: '默认 10 RPM。Linux Do 未公开该端点专属额度；此值仍服从全站 10 秒/60 秒共享窗口和服务器 Retry-After。',
				unit: '次/分',
				step: 1,
				inputMode: 'numeric',
			}),
			Object.freeze({
				name: 'readStateTimingsPerMinute',
				title: '已读楼层上限（TPM）',
				description:
					'同账号跨标签每分钟最多提交多少个 timings 楼层条目；这里的 T 表示 timing，不是 token。',
				help: '默认 240 TPM；这里的 T 是 timing 条目，不是 token。队列仍按单批最多 20 层合并，达到上限时保留 pending 并等待窗口释放，不把未成功楼层升级为已读。',
				unit: '层/分',
				step: 20,
				inputMode: 'numeric',
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

const BUSINESS_REQUEST_COPY = Object.freeze<Readonly<Record<
	ReaderBusinessRequestKind,
	Readonly<{ readonly title: string; readonly description: string }>
>>>({
	'topic-download': Object.freeze({
		title: 'Topic 下载',
		description:
			'可恢复后台任务；优先复用 canonical Topic 正文，只为真实缺口联网。',
	}),
	'user-observation': Object.freeze({
		title: '用户观察',
		description:
			'打开时读取可见分页，后台补历史时降级为可丢弃请求。',
	}),
	notifications: Object.freeze({
		title: '用户通知',
		description:
			'可见头页优先；实时刷新可批次校验头页，历史分页保持低优先级。',
	}),
	bookmarks: Object.freeze({
		title: '收藏与回应',
		description:
			'各来源可并行组织，单个来源的历史分页保持顺序和持久缓存。',
	}),
});

const PRIORITY_LABELS = Object.freeze<Readonly<Record<string, string>>>({
	critical: '关键',
	interactive: '交互',
	nested: '树状',
	visible: '可见',
	prefetch: '预取',
	background: '后台',
});

const LANE_LABELS = Object.freeze<Readonly<Record<string, string>>>({
	control: '控制',
	'topic-batch': '正文',
	'nested-replies': '回复',
	'user-card': '用户卡片',
	translation: '翻译',
	standard: '标准',
});

const CACHE_OWNER_LABELS: Readonly<Record<
	ReaderBusinessRequestCacheOwner,
	string
>> = Object.freeze({
	'canonical-topic': 'canonical Topic',
	'persistent-pages': '持久分页',
});

const EXECUTION_LABELS: Readonly<Record<
	ReaderBusinessRequestExecution,
	string
>> = Object.freeze({
	'idle-resumable': '空闲启动 · 可恢复',
	'paged-serial': '分页顺序',
	'head-burst-history-serial': '头页批次 · 历史顺序',
	'source-parallel-page-serial': '来源并行 · 分页顺序',
});

const BUSINESS_REQUEST_PARAMETER_COPY: Readonly<Record<
	ReaderBusinessRequestParameterName,
	Readonly<{
		readonly title: string;
		readonly unit: string;
		readonly help: string;
	}>
>> = Object.freeze({
	maxConcurrent: Object.freeze({
		title: '最大并发',
		unit: '路',
		help: '单个 Reader 实例内该业务的活动请求目标上限；车道上限、共享总并发和跨标签许可可以继续收紧。',
	}),
	backgroundMinIntervalMs: Object.freeze({
		title: '后台最小间隔',
		unit: 'ms',
		help: '只限制该业务 prefetch/background 的实际启动间隔；可见请求与写操作仍服从全站共享间隔。',
	}),
	backgroundRequestsPerMinute: Object.freeze({
		title: '后台 RPM',
		unit: '次/分',
		help: '单个 Reader 实例内该业务后台请求的滚动 60 秒启动上限；重试也计入，全站跨标签窗口仍是最终硬边界。',
	}),
});

const businessNumericDefinitions = Object.freeze(
	READER_BUSINESS_REQUEST_KINDS.flatMap((kind) =>
		READER_BUSINESS_REQUEST_PARAMETER_NAMES.map((name) => Object.freeze({
			name: `${kind}.${name}` as ReaderBusinessRequestFieldName,
			label: `${BUSINESS_REQUEST_COPY[kind].title}${BUSINESS_REQUEST_PARAMETER_COPY[name].title}`,
			min: READER_BUSINESS_REQUEST_PARAMETER_LIMITS[name].min,
			max: READER_BUSINESS_REQUEST_PARAMETER_LIMITS[name].max,
			integer: true,
			decimals: 0,
		}))),
);

interface RequestFlowFieldDefinition {
	readonly name: ReaderRequestFlowSettingName;
	readonly title: string;
	readonly description: string;
	readonly help: string;
	readonly unit: string;
	readonly step: number;
}

const REQUEST_FLOW_FIELDS = Object.freeze<readonly RequestFlowFieldDefinition[]>([
	Object.freeze({
		name: 'backgroundIdleIntervalMs',
		title: '后台空闲启动间隔',
		description: '后台请求在让位期使用的额外启动间隔；0 表示只服从全站基础间隔。',
		help: '只作用于 background 优先级；可见、交互和写请求不读取该值，10 秒/60 秒窗口仍是硬边界。',
		unit: 'ms',
		step: 100,
	}),
	Object.freeze({
		name: 'backgroundMaxDeferMs',
		title: '后台最长额外让路',
		description: '持续有前台流量时，后台额外空闲间隔最多维持多久。',
		help: '到期只解除额外空闲间隔；不会越过活动请求、排队优先级、并发或共享窗口。',
		unit: 'ms',
		step: 1_000,
	}),
	Object.freeze({
		name: 'hostPreheatMaxConcurrent',
		title: '宿主 Topic 预热并发目标',
		description: '列表近视口 Topic 最多同时准备多少个；Reader 前台仍最多占一个后台槽。',
		help: '设备能力可以下调；每个 Topic 的楼层数量由“预热楼层数”单独控制。',
		unit: '路',
		step: 1,
	}),
	Object.freeze({
		name: 'queuePrefetchShortLimit',
		title: '阅读队列 10 秒请求目标',
		description: '队列预加载在共享 10 秒账本内允许占用的请求数目标。',
		help: '实际值还受共享窗口预算、后台间隔、业务 RPM 和 Scheduler 收紧；不维护第二份请求账本。',
		unit: '次',
		step: 1,
	}),
	Object.freeze({
		name: 'queuePrefetchLongLimit',
		title: '阅读队列 60 秒请求目标',
		description: '队列预加载在共享 60 秒账本内允许占用的请求数目标。',
		help: '实际值取本目标、Topic 下载后台 RPM 和共享 60 秒预算中的最严格结果。',
		unit: '次',
		step: 1,
	}),
	Object.freeze({
		name: 'bulkBackgroundBudgetPercent',
		title: '批量后台窗口占用比例',
		description: 'Topic 下载等批量后台读取最多使用共享窗口预算的比例。',
		help: '给原站与用户请求保留其余预算；直属回复还受下方 10 秒/60 秒目标收紧。',
		unit: '%',
		step: 1,
	}),
	Object.freeze({
		name: 'nestedBackgroundShortLimit',
		title: '后台直属回复 10 秒目标',
		description: 'Topic 下载补直属回复时在共享 10 秒账本内的请求目标。',
		help: '只收紧后台 replies.json；普通阅读中的可见直属回复仍按车道、全局目标与共享许可执行。',
		unit: '次',
		step: 1,
	}),
	Object.freeze({
		name: 'nestedBackgroundLongLimit',
		title: '后台直属回复 60 秒目标',
		description: 'Topic 下载补直属回复时在共享 60 秒账本内的请求目标。',
		help: '实际值还受 Topic 下载后台 RPM 与共享 60 秒窗口收紧。',
		unit: '次',
		step: 1,
	}),
	Object.freeze({
		name: 'topicBatchMaxConcurrent',
		title: '正文车道并发目标',
		description: 'posts.json 与并行通知头页共用的正文车道目标。',
		help: '仍受共享总并发、业务最大并发和跨标签许可收紧；后台正文继续单飞。',
		unit: '路',
		step: 1,
	}),
	Object.freeze({
		name: 'nestedRepliesMaxConcurrent',
		title: '直属回复车道并发目标',
		description: 'replies.json 同时服务的父楼请求目标。',
		help: '直属回复候选 owner 最多产生两路；共享总并发和跨标签许可仍可下调。',
		unit: '路',
		step: 1,
	}),
	Object.freeze({
		name: 'userCardMaxConcurrent',
		title: '用户卡片车道并发目标',
		description: '交互式用户卡片资源同时请求的目标。',
		help: '只控制用户卡片车道，不改变缓存、profile、429 或 Cloudflare 语义。',
		unit: '路',
		step: 1,
	}),
	Object.freeze({
		name: 'standardMaxConcurrent',
		title: '标准读取车道并发目标',
		description: '集合分页与普通资源读取共用的标准车道目标。',
		help: '业务自身的顺序、最大并发、共享总并发和跨标签许可仍是更高优先级限制。',
		unit: '路',
		step: 1,
	}),
]);

const requestFlowNumericDefinitions = Object.freeze(
	REQUEST_FLOW_FIELDS.map((field) => Object.freeze({
		name: field.name,
		label: field.title,
		min: READER_REQUEST_FLOW_SETTING_LIMITS[field.name].min,
		max: READER_REQUEST_FLOW_SETTING_LIMITS[field.name].max,
		integer: true,
		decimals: 0,
	})),
);

function requestFlowSettingsGroup(input: Readonly<{
	readonly document: Document;
	readonly inputs: Map<ReaderRequestFlowSettingName, HTMLInputElement>;
	readonly onInput: (
		name: ReaderRequestFlowSettingName,
		field: HTMLInputElement,
	) => void;
}>): HTMLElement {
	const group = element(
		input.document,
		'section',
		'ldp-settings-category-group',
	);
	group.dataset.settingsCategory = 'performance-request-flow';
	const head = element(input.document, 'div', 'ldp-settings-category-head');
	const title = element(input.document, 'strong');
	title.textContent = '请求流控制目标';
	const description = element(input.document, 'small');
	description.textContent =
		'调整过去写死的后台让路、预取窗口和车道并发；安全契约仍固定执行。';
	head.append(title, description);
	const content = element(
		input.document,
		'div',
		'ldp-settings-fields ldp-settings-category-list ldp-performance-fields',
	);
	for (const field of REQUEST_FLOW_FIELDS) {
		const row = element(input.document, 'label', 'ldp-setting-row');
		row.dataset.settingHelp = field.help;
		const copy = settingsCopy(
			input.document,
			'ldp-performance-copy',
			field.title,
			field.description,
		);
		const control = element(
			input.document,
			'span',
			'ldp-performance-control',
		);
		const fieldInput = element(input.document, 'input');
		fieldInput.type = 'number';
		fieldInput.inputMode = 'numeric';
		fieldInput.step = String(field.step);
		fieldInput.min = String(
			READER_REQUEST_FLOW_SETTING_LIMITS[field.name].min,
		);
		fieldInput.max = String(
			READER_REQUEST_FLOW_SETTING_LIMITS[field.name].max,
		);
		fieldInput.dataset.requestFlowKey = field.name;
		fieldInput.setAttribute('aria-label', field.title);
		const unit = element(input.document, 'em');
		unit.textContent = field.unit;
		control.append(fieldInput, unit);
		row.append(copy, control);
		content.append(row);
		input.inputs.set(field.name, fieldInput);
		input.onInput(field.name, fieldInput);
	}
	group.append(head, content);
	return group;
}

function businessRequestPolicyGroup(input: Readonly<{
	readonly document: Document;
	readonly inputs: Map<ReaderBusinessRequestFieldName, HTMLInputElement>;
	readonly onInput: (
		name: ReaderBusinessRequestFieldName,
		input: HTMLInputElement,
	) => void;
}>): HTMLElement {
	const { document } = input;
	const group = element(document, 'section', 'ldp-settings-category-group');
	group.dataset.settingsCategory = 'performance-business-requests';
	const head = element(document, 'div', 'ldp-settings-category-head');
	const title = element(document, 'strong');
	title.textContent = '业务请求策略';
	const description = element(document, 'small');
	description.textContent =
		'逐业务调整并发、后台间隔和 RPM；车道目标在“请求流控制目标”设置，profile、缓存与重试契约固定执行。';
	head.append(title, description);
	const content = element(
		document,
		'div',
		'ldp-settings-fields ldp-settings-category-list ldp-performance-policy-list',
	);
	for (const policy of READER_BUSINESS_REQUEST_POLICIES) {
		const snapshot = readerBusinessRequestPolicySnapshot(policy);
		const mutationProfile = 'mutationProfile' in policy
			? policy.mutationProfile
			: undefined;
		const copy = BUSINESS_REQUEST_COPY[policy.kind];
		const row = element(
			document,
			'div',
			'ldp-setting-row ldp-performance-policy-row',
		);
		row.dataset.requestBusiness = policy.kind;
		row.dataset.settingHelp = [
			`业务 ${policy.kind}`,
			`前台 profile ${policy.foregroundProfile}：优先级 ` +
				`${snapshot.foreground.priority}，429 重试 ` +
				`${snapshot.foreground.max429Retries}，过盾重试 ` +
				`${snapshot.foreground.maxChallengeRetries}`,
			`后台 profile ${policy.backgroundProfile}：优先级 ` +
				`${snapshot.background.priority}，` +
				`${snapshot.background.droppable ? '可丢弃' : '不可丢弃'}`,
			...(mutationProfile === undefined || snapshot.mutation === undefined
				? []
				: [
					`写入 profile ${mutationProfile}：优先级 ` +
						`${snapshot.mutation.priority}，429 重试 ` +
						`${snapshot.mutation.max429Retries}`,
				]),
			'所有请求仍共享全局 10 秒/60 秒许可、single-flight、429 Retry-After 与 Cloudflare 恢复。',
		].join('；');
		const rowCopy = settingsCopy(
			document,
			'ldp-performance-copy',
			copy.title,
			copy.description,
		);
		const badges = element(
			document,
			'div',
			'ldp-performance-policy-badges',
		);
		const badgeTexts = [
			`前台 ${PRIORITY_LABELS[snapshot.foreground.priority] ?? snapshot.foreground.priority}`,
			`后台 ${PRIORITY_LABELS[snapshot.background.priority] ?? snapshot.background.priority}` +
				`${snapshot.background.droppable ? ' · 可丢弃' : ''}`,
			...(snapshot.mutation === undefined
				? []
				: [
					`写入 ${PRIORITY_LABELS[snapshot.mutation.priority] ?? snapshot.mutation.priority}` +
						` · 429 重试 ${snapshot.mutation.max429Retries}`,
				]),
			EXECUTION_LABELS[policy.execution],
			'车道硬上限 ' + snapshot.laneCaps.map(({ lane, maxConcurrent }) =>
				`${LANE_LABELS[lane] ?? lane}×${maxConcurrent}`).join(' / '),
			`缓存 ${CACHE_OWNER_LABELS[policy.cacheOwner]}`,
			`429 重试 ${snapshot.foreground.max429Retries}/${snapshot.background.max429Retries}`,
		];
		for (const text of badgeTexts) {
			const badge = element(
				document,
				'span',
				'ldp-performance-policy-badge',
			);
			badge.textContent = text;
			badges.append(badge);
		}
		const controls = element(
			document,
			'div',
			'ldp-performance-policy-controls',
		);
		for (const name of READER_BUSINESS_REQUEST_PARAMETER_NAMES) {
			const fieldName = `${policy.kind}.${name}` as const;
			const fieldCopy = BUSINESS_REQUEST_PARAMETER_COPY[name];
			const field = element(
				document,
				'label',
				'ldp-performance-policy-field',
			);
			field.dataset.settingHelp = fieldCopy.help;
			const fieldTitle = element(document, 'small');
			fieldTitle.textContent = fieldCopy.title;
			const control = element(
				document,
				'span',
				'ldp-performance-control',
			);
			const fieldInput = element(document, 'input');
			fieldInput.type = 'number';
			fieldInput.inputMode = 'numeric';
			fieldInput.step = '1';
			fieldInput.min = String(
				READER_BUSINESS_REQUEST_PARAMETER_LIMITS[name].min,
			);
			fieldInput.max = String(
				READER_BUSINESS_REQUEST_PARAMETER_LIMITS[name].max,
			);
			fieldInput.dataset.requestBusinessKey = fieldName;
			fieldInput.dataset.requestBusinessParameter = name;
			fieldInput.setAttribute(
				'aria-label',
				`${copy.title} ${fieldCopy.title}`,
			);
			const unit = element(document, 'em');
			unit.textContent = fieldCopy.unit;
			control.append(fieldInput, unit);
			field.append(fieldTitle, control);
			controls.append(field);
			input.inputs.set(fieldName, fieldInput);
			input.onInput(fieldName, fieldInput);
		}
		row.append(rowCopy, controls, badges);
		content.append(row);
	}
	group.append(head, content);
	return group;
}

function performanceConfigExceedsDefault(
	config: ReaderPerformanceConfig,
): boolean {
	const defaults = READER_PERFORMANCE_DEFAULT_CONFIG;
	return config.pageSize > defaults.pageSize ||
		config.streamOverscanViewports > defaults.streamOverscanViewports ||
		config.streamMaxItems > defaults.streamMaxItems ||
		config.nestedPrefetchViewports > defaults.nestedPrefetchViewports ||
		config.requestMaxConcurrent > defaults.requestMaxConcurrent ||
		config.requestMinInterval < defaults.requestMinInterval ||
		config.requestRateTarget > defaults.requestRateTarget ||
		config.readStateRequestsPerMinute >
			defaults.readStateRequestsPerMinute ||
		config.readStateTimingsPerMinute > defaults.readStateTimingsPerMinute;
}

function businessRequestSettingsExceedDefault(
	settings: ReaderBusinessRequestSettings,
): boolean {
	return READER_BUSINESS_REQUEST_KINDS.some((kind) => {
		const current = settings[kind];
		const defaults = READER_BUSINESS_REQUEST_DEFAULTS[kind];
		return current.maxConcurrent > defaults.maxConcurrent ||
			current.backgroundMinIntervalMs < defaults.backgroundMinIntervalMs ||
			current.backgroundRequestsPerMinute >
				defaults.backgroundRequestsPerMinute;
	});
}

function requestFlowSettingsExceedDefault(
	settings: ReaderRequestFlowSettings,
): boolean {
	const defaults = READER_REQUEST_FLOW_DEFAULTS;
	return settings.backgroundIdleIntervalMs < defaults.backgroundIdleIntervalMs ||
		settings.backgroundMaxDeferMs < defaults.backgroundMaxDeferMs ||
		settings.hostPreheatMaxConcurrent > defaults.hostPreheatMaxConcurrent ||
		settings.queuePrefetchShortLimit > defaults.queuePrefetchShortLimit ||
		settings.queuePrefetchLongLimit > defaults.queuePrefetchLongLimit ||
		settings.bulkBackgroundBudgetPercent >
			defaults.bulkBackgroundBudgetPercent ||
		settings.nestedBackgroundShortLimit >
			defaults.nestedBackgroundShortLimit ||
		settings.nestedBackgroundLongLimit >
			defaults.nestedBackgroundLongLimit ||
		settings.topicBatchMaxConcurrent > defaults.topicBatchMaxConcurrent ||
		settings.nestedRepliesMaxConcurrent >
			defaults.nestedRepliesMaxConcurrent ||
		settings.userCardMaxConcurrent > defaults.userCardMaxConcurrent ||
		settings.standardMaxConcurrent > defaults.standardMaxConcurrent;
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
	readonly #businessInputs = new Map<
		ReaderBusinessRequestFieldName,
		HTMLInputElement
	>();
	readonly #requestFlowInputs = new Map<
		ReaderRequestFlowSettingName,
		HTMLInputElement
	>();
	readonly #status: HTMLElement;
	readonly #reset: HTMLButtonElement;
	readonly #draft: ReaderNumericSettingsDraft<ReaderPerformanceName>;
	readonly #businessDraft:
		ReaderNumericSettingsDraft<ReaderBusinessRequestFieldName>;
	readonly #requestFlowDraft:
		ReaderNumericSettingsDraft<ReaderRequestFlowSettingName>;
	readonly #hostTopicPreheat: HTMLInputElement;
	readonly #hostTopicPreheatPostCount: HTMLInputElement;
	readonly #hostTopicPreheatPostCountRow: HTMLElement;
	readonly #hostTopicPreheatPostCountSupported: boolean;
	readonly #suspendHostTurnstile: HTMLInputElement;
	#hostTopicPreheatOriginal: boolean;
	#hostTopicPreheatDraft: boolean;
	#hostTopicPreheatPostCountOriginal: number;
	#hostTopicPreheatPostCountDraft: string;
	#suspendHostTurnstileOriginal: boolean;
	#suspendHostTurnstileDraft: boolean;

	constructor(options: ReaderPerformanceSettingsFormOptions<TPreferences>) {
		this.#controller = options.controller;
		this.#preferences = options.preferences;
		this.#host = options.host;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#draft = new ReaderNumericSettingsDraft(
			numericDefinitions,
			this.#preferences.readConfig(options.readPreferences()),
		);
		this.#businessDraft = new ReaderNumericSettingsDraft(
			businessNumericDefinitions,
			flattenReaderBusinessRequestSettings(
				this.#readPersistedBusinessRequestSettings(
					options.readPreferences(),
				),
			),
		);
		this.#requestFlowDraft = new ReaderNumericSettingsDraft(
			requestFlowNumericDefinitions,
			this.#readPersistedRequestFlowSettings(options.readPreferences()),
		);
		this.#hostTopicPreheatOriginal =
			this.#readHostTopicPreheatEnabled(options.readPreferences());
		this.#hostTopicPreheatDraft = this.#hostTopicPreheatOriginal;
		this.#hostTopicPreheatPostCountOriginal =
			this.#readHostTopicPreheatPostCount(options.readPreferences());
		this.#hostTopicPreheatPostCountDraft =
			String(this.#hostTopicPreheatPostCountOriginal);
		this.#suspendHostTurnstileOriginal =
			this.#readSuspendHostTurnstile(options.readPreferences());
		this.#suspendHostTurnstileDraft =
			this.#suspendHostTurnstileOriginal;

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
		categoryGroups.append(requestFlowSettingsGroup({
			document: options.document,
			inputs: this.#requestFlowInputs,
			onInput: (name, requestFlowInput) => {
				this.scope.listen(requestFlowInput, 'input', () => {
					this.#requestFlowDraft.setRaw(name, requestFlowInput.value);
					this.#render();
					this.#controller.refresh();
				});
			},
		}));
		categoryGroups.append(businessRequestPolicyGroup({
			document: options.document,
			inputs: this.#businessInputs,
			onInput: (name, businessInput) => {
				this.scope.listen(businessInput, 'input', () => {
					this.#businessDraft.setRaw(name, businessInput.value);
					this.#render();
					this.#controller.refresh();
				});
			},
		}));
		const hostTopicPreheatSupported =
			typeof this.#preferences.readHostTopicPreheatEnabled === 'function' &&
			typeof this.#preferences.createHostTopicPreheatEnabledPatch === 'function';
		this.#hostTopicPreheatPostCountSupported =
			typeof this.#preferences.readHostTopicPreheatPostCount === 'function' &&
			typeof this.#preferences.createHostTopicPreheatPostCountPatch === 'function';
		const hostTurnstileSupported =
			typeof this.#preferences
				.readSuspendHostTurnstileInBackground === 'function' &&
			typeof this.#preferences
				.createSuspendHostTurnstileInBackgroundPatch === 'function';
		const hostRuntimeGroup = element(
			options.document,
			'section',
			'ldp-settings-category-group',
		);
		hostRuntimeGroup.dataset.settingsCategory = 'performance-host-runtime';
		const hostRuntimeHead = element(
			options.document,
			'div',
			'ldp-settings-category-head',
		);
		const hostRuntimeTitle = element(options.document, 'strong');
		hostRuntimeTitle.textContent = '宿主列表与后台资源';
		const hostRuntimeDescription = element(options.document, 'small');
		hostRuntimeDescription.textContent =
			'控制列表 Topic 预热与 LinuxDo 页面自身的隐藏验证控件。';
		hostRuntimeHead.append(hostRuntimeTitle, hostRuntimeDescription);
		const hostRuntimeContent = element(
			options.document,
			'div',
			'ldp-settings-fields ldp-settings-category-list',
		);
		const hostTopicPreheatSwitch = settingsSwitch(
			options.document,
			'预热宿主 Topic 列表',
			'ldp-performance-host-preheat-input',
		);
		this.#hostTopicPreheat = hostTopicPreheatSwitch.input;
		this.#hostTopicPreheat.dataset.performanceHostKey =
			'hostTopicPreheatEnabled';
		const hostTopicPreheatRow = settingsOptionRow(
			options.document,
			'预热宿主 Topic 列表',
			'列表卡片接近视口时提前准备正文；默认开启。Reader 阅读和滚动期间继续预热其他 Topic，前台最多使用一个后台槽。',
			hostTopicPreheatSwitch.root,
		);
		hostTopicPreheatRow.dataset.settingHelp =
			'关闭后立即停止宿主列表预热并释放交接快照；重新开启后从当前近视口卡片与 canonical 缓存恢复。当前正在阅读的同一 Topic 不重复预热。';
		if (hostTopicPreheatSupported) {
			hostRuntimeContent.append(hostTopicPreheatRow);
			this.scope.listen(this.#hostTopicPreheat, 'change', () => {
				this.#hostTopicPreheatDraft = this.#hostTopicPreheat.checked;
				this.#render();
				this.#controller.refresh();
			});
		}
		const hostTopicPreheatPostCountControl = element(
			options.document,
			'span',
			'ldp-performance-control',
		);
		this.#hostTopicPreheatPostCount = element(options.document, 'input');
		this.#hostTopicPreheatPostCount.type = 'number';
		this.#hostTopicPreheatPostCount.min =
			String(HOST_TOPIC_PREHEAT_POST_COUNT_MIN);
		this.#hostTopicPreheatPostCount.max =
			String(HOST_TOPIC_PREHEAT_POST_COUNT_MAX);
		this.#hostTopicPreheatPostCount.step = '1';
		this.#hostTopicPreheatPostCount.inputMode = 'numeric';
		this.#hostTopicPreheatPostCount.dataset.performanceHostKey =
			'hostTopicPreheatPostCount';
		this.#hostTopicPreheatPostCount.setAttribute('aria-label', '预热楼层数');
		const hostTopicPreheatPostCountUnit = element(options.document, 'em');
		hostTopicPreheatPostCountUnit.textContent = '层';
		hostTopicPreheatPostCountControl.append(
			this.#hostTopicPreheatPostCount,
			hostTopicPreheatPostCountUnit,
		);
		this.#hostTopicPreheatPostCountRow = settingsOptionRow(
			options.document,
			'预热楼层数',
			'每个宿主 Topic 最多准备多少层正文数据；默认 24 层，不创建隐藏 DOM。',
			hostTopicPreheatPostCountControl,
		);
		this.#hostTopicPreheatPostCountRow.dataset.settingHelp =
			'仅在“预热宿主 Topic 列表”开启时生效。围绕历史或链接目标楼层选择连续窗口，所有正文仍进入 canonical 缓存与交接快照，不在宿主列表挂载 Post DOM。';
		if (hostTopicPreheatSupported && this.#hostTopicPreheatPostCountSupported) {
			hostRuntimeContent.append(this.#hostTopicPreheatPostCountRow);
			this.scope.listen(this.#hostTopicPreheatPostCount, 'input', () => {
				this.#hostTopicPreheatPostCountDraft =
					this.#hostTopicPreheatPostCount.value;
				this.#render();
				this.#controller.refresh();
			});
		}
		const hostTurnstileSwitch = settingsSwitch(
			options.document,
			'后台暂停宿主 Turnstile',
			'ldp-performance-host-turnstile-input',
		);
		this.#suspendHostTurnstile = hostTurnstileSwitch.input;
		this.#suspendHostTurnstile.dataset.performanceHostKey =
			'suspendHostTurnstileInBackground';
		const hostTurnstileRow = settingsOptionRow(
			options.document,
			'后台暂停宿主 Turnstile',
			'标签后台停留 30 秒、验证已完成且没有编辑或支付交互时释放隐藏挑战；回到前台立即恢复。默认关闭。',
			hostTurnstileSwitch.root,
		);
		hostTurnstileRow.dataset.settingHelp =
			'实验项：只处理 body 直属、已有有效响应的 LinuxDo 宿主控件；不会读取或保存令牌，也不会处理 Reader Cloudflare 验证窗口。';
		if (hostTurnstileSupported) hostRuntimeContent.append(hostTurnstileRow);
		hostRuntimeGroup.append(hostRuntimeHead, hostRuntimeContent);
		if (hostTopicPreheatSupported || hostTurnstileSupported) {
			categoryGroups.append(hostRuntimeGroup);
		}
		if (hostTurnstileSupported) {
			this.scope.listen(this.#suspendHostTurnstile, 'change', () => {
				this.#suspendHostTurnstileDraft =
					this.#suspendHostTurnstile.checked;
				this.#render();
				this.#controller.refresh();
			});
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
			this.#requestFlowDraft.setValues(READER_REQUEST_FLOW_DEFAULTS);
			this.#businessDraft.setValues(
				flattenReaderBusinessRequestSettings(
					READER_BUSINESS_REQUEST_DEFAULTS,
				),
			);
			this.#hostTopicPreheatDraft = true;
			this.#hostTopicPreheatPostCountDraft =
				String(HOST_TOPIC_PREHEAT_POST_COUNT_DEFAULT);
			this.#suspendHostTurnstileDraft = false;
			this.#writeConfig(READER_PERFORMANCE_DEFAULT_CONFIG);
		});
		this.#host.replaceChildren(categoryGroups, footer.root);
		this.#syncInputs();

		const adapter: ReaderSettingsDraftAdapter<TPreferences> = {
			panelId: 'performance',
			changeCount: () => this.#changeCount(),
			validate: () => this.#validate(),
			createPatch: () => {
				const config = this.#readConfig()!;
				const requestFlowSettings = this.#readRequestFlowSettings()!;
				const businessRequestSettings =
					this.#readBusinessRequestSettings()!;
				return {
					...this.#preferences.createPatch(config),
					...(this.#preferences.createRequestFlowSettingsPatch?.(
						requestFlowSettings,
					) ?? {}),
					...(this.#preferences.createBusinessRequestSettingsPatch?.(
						businessRequestSettings,
					) ?? {}),
					...this.#createHostTopicPreheatEnabledPatch(
						this.#hostTopicPreheatDraft,
					),
					...this.#createHostTopicPreheatPostCountPatch(
						this.#readHostTopicPreheatPostCountDraft()!,
					),
					...this.#createSuspendHostTurnstilePatch(
						this.#suspendHostTurnstileDraft,
					),
				};
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
			this.#requestFlowInputs.clear();
			this.#businessInputs.clear();
			this.#host.replaceChildren();
		});
		this.#render();
	}

	applyPreferences(preferences: Readonly<TPreferences>): void {
		if (this.scope.destroyed) return;
		this.#draft.rebase(this.#preferences.readConfig(preferences));
		this.#requestFlowDraft.rebase(
			this.#readPersistedRequestFlowSettings(preferences),
		);
		this.#businessDraft.rebase(flattenReaderBusinessRequestSettings(
			this.#readPersistedBusinessRequestSettings(preferences),
		));
		const nextHostTopicPreheat =
			this.#readHostTopicPreheatEnabled(preferences);
		if (this.#hostTopicPreheatDraft === this.#hostTopicPreheatOriginal) {
			this.#hostTopicPreheatDraft = nextHostTopicPreheat;
		}
		this.#hostTopicPreheatOriginal = nextHostTopicPreheat;
		const nextHostTopicPreheatPostCount =
			this.#readHostTopicPreheatPostCount(preferences);
		if (
			this.#hostTopicPreheatPostCountDraft ===
			String(this.#hostTopicPreheatPostCountOriginal)
		) {
			this.#hostTopicPreheatPostCountDraft =
				String(nextHostTopicPreheatPostCount);
		}
		this.#hostTopicPreheatPostCountOriginal =
			nextHostTopicPreheatPostCount;
		const nextSuspendHostTurnstile =
			this.#readSuspendHostTurnstile(preferences);
		if (
			this.#suspendHostTurnstileDraft ===
			this.#suspendHostTurnstileOriginal
		) {
			this.#suspendHostTurnstileDraft = nextSuspendHostTurnstile;
		}
		this.#suspendHostTurnstileOriginal = nextSuspendHostTurnstile;
		this.#syncInputs();
		this.#render();
		this.#controller.refresh();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#acceptPreferences(preferences: Readonly<TPreferences>): void {
		this.#draft.accept(this.#preferences.readConfig(preferences));
		this.#requestFlowDraft.accept(
			this.#readPersistedRequestFlowSettings(preferences),
		);
		this.#businessDraft.accept(flattenReaderBusinessRequestSettings(
			this.#readPersistedBusinessRequestSettings(preferences),
		));
		this.#hostTopicPreheatOriginal =
			this.#readHostTopicPreheatEnabled(preferences);
		this.#hostTopicPreheatDraft = this.#hostTopicPreheatOriginal;
		this.#hostTopicPreheatPostCountOriginal =
			this.#readHostTopicPreheatPostCount(preferences);
		this.#hostTopicPreheatPostCountDraft =
			String(this.#hostTopicPreheatPostCountOriginal);
		this.#suspendHostTurnstileOriginal =
			this.#readSuspendHostTurnstile(preferences);
		this.#suspendHostTurnstileDraft =
			this.#suspendHostTurnstileOriginal;
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

	#readBusinessRequestSettings(): ReaderBusinessRequestSettings | null {
		const values = this.#businessDraft.read();
		return values === null
			? null
			: expandReaderBusinessRequestSettings(values);
	}

	#readRequestFlowSettings(): ReaderRequestFlowSettings | null {
		const values = this.#requestFlowDraft.read();
		return values === null
			? null
			: normalizeReaderRequestFlowSettings(values);
	}

	#readPersistedRequestFlowSettings(
		preferences: Readonly<TPreferences>,
	): ReaderRequestFlowSettings {
		return this.#preferences.readRequestFlowSettings?.(preferences) ??
			READER_REQUEST_FLOW_DEFAULTS;
	}

	#readPersistedBusinessRequestSettings(
		preferences: Readonly<TPreferences>,
	): ReaderBusinessRequestSettings {
		return this.#preferences.readBusinessRequestSettings?.(preferences) ??
			READER_BUSINESS_REQUEST_DEFAULTS;
	}

	#readSuspendHostTurnstile(preferences: Readonly<TPreferences>): boolean {
		return this.#preferences.readSuspendHostTurnstileInBackground?.(
			preferences,
		) === true;
	}

	#readHostTopicPreheatEnabled(
		preferences: Readonly<TPreferences>,
	): boolean {
		return this.#preferences.readHostTopicPreheatEnabled?.(preferences) !== false;
	}

	#createHostTopicPreheatEnabledPatch(
		enabled: boolean,
	): Partial<TPreferences> {
		return this.#preferences.createHostTopicPreheatEnabledPatch?.(enabled) ?? {};
	}

	#readHostTopicPreheatPostCount(
		preferences: Readonly<TPreferences>,
	): number {
		const postCount = Number(
			this.#preferences.readHostTopicPreheatPostCount?.(preferences),
		);
		return Number.isSafeInteger(postCount) &&
			postCount >= HOST_TOPIC_PREHEAT_POST_COUNT_MIN &&
			postCount <= HOST_TOPIC_PREHEAT_POST_COUNT_MAX
			? postCount
			: HOST_TOPIC_PREHEAT_POST_COUNT_DEFAULT;
	}

	#readHostTopicPreheatPostCountDraft(): number | null {
		const postCount = Number(this.#hostTopicPreheatPostCountDraft);
		return Number.isSafeInteger(postCount) &&
			postCount >= HOST_TOPIC_PREHEAT_POST_COUNT_MIN &&
			postCount <= HOST_TOPIC_PREHEAT_POST_COUNT_MAX
			? postCount
			: null;
	}

	#createHostTopicPreheatPostCountPatch(
		postCount: number,
	): Partial<TPreferences> {
		if (!this.#hostTopicPreheatPostCountSupported) return {};
		return this.#preferences.createHostTopicPreheatPostCountPatch?.(
			postCount,
		) ?? {};
	}

	#createSuspendHostTurnstilePatch(enabled: boolean): Partial<TPreferences> {
		return this.#preferences.createSuspendHostTurnstileInBackgroundPatch?.(
			enabled,
		) ?? {};
	}

	#validate(): readonly string[] {
		const issues = [
			...this.#draft.issues(),
			...this.#requestFlowDraft.issues(),
			...this.#businessDraft.issues(),
		];
		if (
			this.#hostTopicPreheatPostCountSupported &&
			this.#readHostTopicPreheatPostCountDraft() === null
		) {
			issues.push(
				`预热楼层数必须是 ${HOST_TOPIC_PREHEAT_POST_COUNT_MIN}–` +
				`${HOST_TOPIC_PREHEAT_POST_COUNT_MAX} 的整数`,
			);
		}
		return Object.freeze(issues);
	}

	#changeCount(): number {
		return this.#draft.changeCount() +
			this.#requestFlowDraft.changeCount() +
			this.#businessDraft.changeCount() +
			Number(
				this.#hostTopicPreheatDraft !== this.#hostTopicPreheatOriginal,
			) +
			Number(
				this.#hostTopicPreheatPostCountSupported &&
				this.#hostTopicPreheatPostCountDraft !==
					String(this.#hostTopicPreheatPostCountOriginal),
			) +
			Number(
				this.#suspendHostTurnstileDraft !==
					this.#suspendHostTurnstileOriginal,
			);
	}

	#syncInputs(): void {
		for (const field of fields) {
			this.#inputs.get(field.name)!.value =
				this.#draft.rawValue(field.name);
		}
		for (const name of this.#businessDraft.names) {
			this.#businessInputs.get(name)!.value =
				this.#businessDraft.rawValue(name);
		}
		for (const name of READER_REQUEST_FLOW_SETTING_NAMES) {
			this.#requestFlowInputs.get(name)!.value =
				this.#requestFlowDraft.rawValue(name);
		}
		this.#hostTopicPreheat.checked = this.#hostTopicPreheatDraft;
		this.#hostTopicPreheatPostCount.value =
			this.#hostTopicPreheatPostCountDraft;
		this.#suspendHostTurnstile.checked =
			this.#suspendHostTurnstileDraft;
	}

	#render(): void {
		const config = this.#readConfig();
		const requestFlowSettings = this.#readRequestFlowSettings();
		const businessRequestSettings = this.#readBusinessRequestSettings();
		const preheatPostCount = this.#readHostTopicPreheatPostCountDraft();
		const risky = config !== null &&
			requestFlowSettings !== null &&
			businessRequestSettings !== null &&
			preheatPostCount !== null && (
			performanceConfigExceedsDefault(config) ||
			requestFlowSettingsExceedDefault(requestFlowSettings) ||
			businessRequestSettingsExceedDefault(businessRequestSettings) ||
			(
				this.#hostTopicPreheatDraft &&
				preheatPostCount > HOST_TOPIC_PREHEAT_POST_COUNT_DEFAULT
			)
		);
		this.#hostTopicPreheatPostCountRow.hidden =
			!this.#hostTopicPreheatDraft;
		this.#hostTopicPreheatPostCount.disabled =
			!this.#hostTopicPreheatDraft;
		const changed = this.#changeCount();
		this.#reset.disabled =
			config !== null &&
			readerPerformanceConfigIsDefault(config) &&
			requestFlowSettings !== null &&
			readerRequestFlowSettingsAreDefault(requestFlowSettings) &&
			businessRequestSettings !== null &&
			readerBusinessRequestSettingsAreDefault(businessRequestSettings) &&
			this.#hostTopicPreheatDraft &&
			preheatPostCount === HOST_TOPIC_PREHEAT_POST_COUNT_DEFAULT &&
			!this.#suspendHostTurnstileDraft;
		const status = config === null ||
			requestFlowSettings === null ||
			businessRequestSettings === null ||
			preheatPostCount === null
			? '部分数值无效；不会保存，也不会改变当前运行时。'
			: changed > 0
				? `${changed} 项目标值等待统一保存；保存后当前排队请求与后续请求立即采用，设备、车道和全站许可仍可收紧。`
				: `当前目标：正文每批不超过 ${config.pageSize} 楼，` +
					`后台请求空闲单飞${config.requestMaxConcurrent >= 2
						? '，总预算允许时可见缺口可用第 2 正文槽'
						: '，总预算仅 1 槽'}；` +
					`树状最多 ${Math.min(
						requestFlowSettings.nestedRepliesMaxConcurrent,
						config.requestMaxConcurrent,
					)} 路，` +
					`共享总并发目标 ${config.requestMaxConcurrent} 路，窗口预算 ${config.requestRateTarget}%；` +
					`后台空闲 ${requestFlowSettings.backgroundIdleIntervalMs} ms / ` +
					`最长让路 ${requestFlowSettings.backgroundMaxDeferMs} ms，` +
					`队列窗口 ${requestFlowSettings.queuePrefetchShortLimit}/` +
					`${requestFlowSettings.queuePrefetchLongLimit}；` +
					`已读队列 ${config.readStateRequestsPerMinute} RPM / ` +
					`${config.readStateTimingsPerMinute} TPM，宿主列表预热` +
					`${this.#hostTopicPreheatDraft
						? `开启（每个 Topic 最多 ${preheatPostCount} 层、` +
							`${requestFlowSettings.hostPreheatMaxConcurrent} 路）`
						: '关闭'}；四类业务请求参数均由中央 Scheduler 热应用。` +
					'设备与网络可下调；其他 owner 可延后或停止请求。生效批次与 DOM 见性能记录，请求实际值见请求记录。';
		this.#status.textContent = risky
			? `${status} 风险提示：高于默认值的负载目标可能增加卡顿或 429；不确定时请恢复默认。`
			: status;
		this.#status.classList.toggle('is-risk', risky);
	}
}
