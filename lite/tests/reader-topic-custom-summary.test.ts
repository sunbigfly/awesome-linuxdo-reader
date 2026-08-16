import { parseHTML } from 'linkedom';
import { ReplyTreeTopology } from '../src/dom/reply-tree.js';
import {
	buildReaderTopicSummaryTree,
	parseReaderTopicSummaryFloorRange,
	ReaderTopicCustomSummaryRequestAdapter,
	readerTopicSummaryContextBudget,
	readerTopicSummarySystemPrompt,
	type ReaderTopicCustomSummaryPost,
} from '../src/post/reader-topic-custom-summary.js';
import type {
	TranslationAiCompletionInput,
} from '../src/translation/translation-request-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;
const posts: readonly ReaderTopicCustomSummaryPost[] = Object.freeze([
	Object.freeze({
		post_number: 1,
		reply_to_post_number: null,
		username: 'alice',
		cooked: '<p>楼主提出一个需要讨论的问题。</p>',
		reply_count: 1,
	}),
	Object.freeze({
		post_number: 2,
		reply_to_post_number: 1,
		username: 'bob',
		cooked: '<aside class="quote">重复楼主正文</aside><p>Bob 表示赞同。</p>',
		reply_count: 2,
	}),
	Object.freeze({
		post_number: 3,
		reply_to_post_number: 2,
		username: 'alice',
		cooked: '<p>楼主进一步澄清限制条件。</p>',
		reply_count: 0,
	}),
	Object.freeze({
		post_number: 4,
		reply_to_post_number: 2,
		username: 'charlie',
		cooked: '<p>Charlie 提出不同意见。</p>',
		reply_count: 0,
	}),
]);
const topology = new ReplyTreeTopology();
topology.commit([
	{ postNumber: 1, parentPostNumber: null },
	{ postNumber: 2, parentPostNumber: 1 },
	{ postNumber: 3, parentPostNumber: 2 },
	{ postNumber: 4, parentPostNumber: 2 },
]);

const full = buildReaderTopicSummaryTree({
	document,
	baseUrl: 'https://linux.do/t/example/42',
	posts,
	topology,
	scope: 'all',
	coverageComplete: true,
});
assert(
	full.thread[0]?.floor === 1 &&
	full.thread[0]?.replies[0]?.floor === 2 &&
	full.thread[0]?.replies[0]?.replies.map((node) => node.floor).join(',') === '3,4' &&
	full.thread[0]?.replies[0]?.text === 'Bob 表示赞同。' &&
	full.thread[0]?.replies[0]?.author.profileUrl === 'https://linux.do/u/bob',
	'全文总结 JSON 必须按 canonical topology 嵌套，并剔除重复引用正文',
);

const owner = buildReaderTopicSummaryTree({
	document,
	baseUrl: 'https://linux.do/t/example/42',
	posts,
	topology,
	scope: 'owner',
	coverageComplete: true,
});
const ownerContext = owner.thread[0]?.replies[0];
assert(
	owner.includedContentPostCount === 2 &&
	ownerContext?.floor === 2 &&
	ownerContext.contextOnly &&
	ownerContext.text === undefined &&
	ownerContext.replies.length === 1 &&
	ownerContext.replies[0]?.floor === 3,
	'只看楼主必须保留非楼主祖先占位以表达“楼主回复了谁”，但不得带入其正文',
);

const range = buildReaderTopicSummaryTree({
	document,
	baseUrl: 'https://linux.do/t/example/42',
	posts,
	topology,
	scope: 'range',
	floorRange: '#3-#4',
	coverageComplete: true,
});
assert(
	range.includedContentPostCount === 2 &&
	range.thread[0]?.floor === 1 &&
	range.thread[0]?.contextOnly &&
	range.thread[0]?.replies[0]?.floor === 2 &&
	range.thread[0]?.replies[0]?.contextOnly &&
	range.thread[0]?.replies[0]?.replies.map((node) => node.floor).join(',') ===
		'3,4' &&
	parseReaderTopicSummaryFloorRange('#4-#2, #9').floors.join(',') ===
		'2,3,4,9',
	'自定义楼层范围必须支持区间与散点，并把范围外祖先保留为关系占位节点',
);

const manyPosts = Array.from({ length: 260 }, (_, index) => Object.freeze({
	post_number: index + 1,
	reply_to_post_number: index === 0 ? null : 1,
	username: index === 0 ? 'owner' : `user${index}`,
	cooked: `<p>第 ${index + 1} 楼内容</p>`,
	reply_count: index % 17,
}));
const manyTopology = new ReplyTreeTopology();
manyTopology.commit(manyPosts.map((post) => ({
	postNumber: Number(post.post_number),
	parentPostNumber: post.reply_to_post_number,
})));
const bounded = buildReaderTopicSummaryTree({
	document,
	baseUrl: 'https://linux.do/t/example/43',
	posts: manyPosts,
	topology: manyTopology,
	scope: 'all',
	coverageComplete: true,
});
const fallbackBudget = readerTopicSummaryContextBudget();
assert(
	bounded.truncated &&
	bounded.includedContentPostCount === fallbackBudget.maxContentPosts &&
	bounded.contextBudget.contextWindowTokens === 128_000 &&
	!bounded.contextBudget.metadataBased &&
	bounded.selectionRule.includes(
		`前 ${Math.floor(fallbackBudget.maxContentPosts / 4)}、后`,
	) &&
	bounded.thread[0]?.floor === 1,
	'模型元数据缺失时，全文必须按默认安全上下文选择首尾与高回复代表楼层',
);
const metadataBounded = buildReaderTopicSummaryTree({
	document,
	baseUrl: 'https://linux.do/t/example/43',
	posts: manyPosts,
	topology: manyTopology,
	scope: 'all',
	coverageComplete: true,
	modelContextTokens: 256_000,
});
assert(
	!metadataBounded.truncated &&
	metadataBounded.includedContentPostCount === manyPosts.length &&
	metadataBounded.contextBudget.contextWindowTokens === 256_000 &&
	metadataBounded.contextBudget.metadataBased &&
	metadataBounded.contextBudget.bestPracticeInputTokens === 192_000 &&
	metadataBounded.contextBudget.maxContentPosts > 96,
	'全文上限必须读取模型元数据，并用 75% 最佳实践窗口决定是否全量纳入',
);

const purposePrompts = [
	'general',
	'problem',
	'tutorial',
	'debate',
	'decision',
	'resources',
	'progress',
].map((purpose) => readerTopicSummarySystemPrompt('all', false, '', {
	purpose: purpose as 'general' | 'problem' | 'tutorial' | 'debate' |
		'decision' | 'resources' | 'progress',
}));
assert(
	readerTopicSummarySystemPrompt('all', false).includes(
		'不得强制增加固定的“参与者评价”章节',
	) &&
	readerTopicSummarySystemPrompt('owner', false).includes('不得臆造其他用户评价') &&
	readerTopicSummarySystemPrompt('range', false).includes('用户指定楼层') &&
	readerTopicSummarySystemPrompt('starter', true).includes('用户主动选择的图片') &&
	readerTopicSummarySystemPrompt('all', false, '', {
		purpose: 'tutorial',
		length: 'concise',
	}).includes('`## 操作步骤`') &&
	readerTopicSummarySystemPrompt('all', false, '', {
		purpose: 'problem',
	}).includes('`## 排查与判断`') &&
	readerTopicSummarySystemPrompt('all', false, '', {
		purpose: 'debate',
		length: 'detailed',
	}).includes('`## 主要分歧`') &&
	readerTopicSummarySystemPrompt('all', false, '', {
		purpose: 'decision',
	}).includes('`## 比较维度`') &&
	readerTopicSummarySystemPrompt('all', false, '', {
		purpose: 'resources',
	}).includes('`## 资源清单`') &&
	readerTopicSummarySystemPrompt('all', false, '', {
		purpose: 'resources',
		length: 'standard',
	}).includes('阅读目标而非硬上限') &&
	readerTopicSummarySystemPrompt('all', false, '', {
		purpose: 'progress',
	}).includes('`## 当前状态`') &&
	readerTopicSummarySystemPrompt('all', false).includes(
		'不得固定套用“主题概述 / 参与者评价与分歧”',
	) &&
	new Set(purposePrompts).size === 7,
	'范围、图片和七种总结结构必须给出互不相同的输出蓝图，而非固定两段模板',
);
assert(
	readerTopicSummaryContextBudget({
		modelContextTokens: 128_000,
		summaryLength: 'detailed',
	}).maxOutputTokens === 1_800 &&
	readerTopicSummaryContextBudget({
		modelContextTokens: 128_000,
		summaryLength: 'concise',
	}).maxOutputTokens === 700,
	'总结长度档位必须同时调整输出预算，并继续受模型上下文总预算约束',
);

let ensureCalls = 0;
const completionInputs: TranslationAiCompletionInput[] = [];
let completionText = '主题结论明确。\n\n@alice 的补充澄清了限制。';
const requestAdapter = new ReaderTopicCustomSummaryRequestAdapter({
	document,
	baseUrl: 'https://linux.do/t/example/42',
	session: {
		topic: Object.freeze({ id: 42 }),
		cachedPosts: () => posts,
		postStreamCoverage: () => Object.freeze({ complete: true }),
		async ensurePostStream() {
			ensureCalls += 1;
			return Object.freeze({
				posts,
				complete: true,
				missingPostIds: Object.freeze([]),
			});
		},
	},
	topology,
	completion: {
		async complete(input) {
			completionInputs.push(input);
			return Object.freeze({
				text: completionText,
				model: 'test-summary-model',
			});
		},
	},
	signal: new AbortController().signal,
	now: () => Date.parse('2026-08-15T02:00:00.000Z'),
});
const progressMessages: string[] = [];
const requestInput = Object.freeze({
	model: Object.freeze({
		baseUrl: 'https://api.example.com/v1/',
		model: 'summary-model',
	}),
	modelContextTokens: 256_000,
	scope: 'all' as const,
	length: 'standard' as const,
	purpose: 'tutorial' as const,
	customPrompt: '优先说明最终可执行结论',
	images: Object.freeze([Object.freeze({
		key: '42:2:0:image',
		sourcePostNumber: 2,
		alt: '测速截图',
		dataUrl: 'data:image/png;base64,cG5n',
	})]),
	onProgress: (_stage: string, message: string) => progressMessages.push(message),
});
const first = await requestAdapter.request(requestInput);
const second = await requestAdapter.request(requestInput);
assert(
	ensureCalls === 0 &&
	completionInputs.length === 1 &&
	progressMessages.some((message) => message.includes('完整楼层缓存')) &&
	progressMessages.some((message) => message.includes('总结缓存')) &&
	completionInputs[0]?.model.baseUrl === 'https://api.example.com/v1/' &&
	completionInputs[0]?.model.model === 'summary-model' &&
	completionInputs[0]?.images?.length === 1 &&
	completionInputs[0]?.userPrompt.includes('"replies"') &&
	completionInputs[0]?.userPrompt.includes('"contextWindowTokens":256000') &&
	completionInputs[0]?.userPrompt.includes(
		'"requestedOutput":{"structure":"tutorial","length":"standard"}',
	) &&
	completionInputs[0]?.maxOutputTokens === 1_200 &&
	completionInputs[0]?.operationKey === 'topic-summary:all:tutorial:standard' &&
	completionInputs[0]?.systemPrompt.includes('`## 操作步骤`') &&
	first === second &&
	first.source === 'custom' &&
	first.scope === 'all' &&
	first.summarizedText.includes('[@alice](https://linux.do/u/alice)'),
	'请求前必须优先复用楼层与总结缓存，未命中时才调用共享 AI，并保留可点击用户链接',
);
const refreshed = await requestAdapter.request(Object.freeze({
	...requestInput,
	refresh: true,
}));
assert(
	Number(completionInputs.length) === 2 &&
	completionInputs[1]?.bypassCache === true &&
	refreshed !== second,
	'用户主动重新生成自定义总结时必须绕过当前主题缓存与持久化 AI 缓存',
);
completionText = `资料清单：${'关键资料与用途说明。'.repeat(90)}`;
const resourceSummary = await requestAdapter.request(Object.freeze({
	...requestInput,
	purpose: 'resources' as const,
	refresh: true,
}));
assert(
	resourceSummary.summarizedText.length > 650 &&
	!resourceSummary.summarizedText.endsWith('…') &&
	completionInputs.at(-1)?.systemPrompt.includes('不得因卡字数截断或遗漏'),
	'资源整理必须把长度视为阅读目标，不得在返回后按字符数硬截断资料',
);
