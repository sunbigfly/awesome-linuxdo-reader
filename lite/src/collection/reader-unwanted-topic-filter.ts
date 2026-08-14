import type { LifecycleScope, Cleanup } from '../kernel/lifecycle.js';
import type { ReaderPreferences } from '../state/reader-preferences-schema.js';

export interface ReaderUnwantedTopicFilterPreferences {
	readonly enabled: boolean;
	readonly categories: readonly string[];
	readonly labels: readonly string[];
	readonly topicAuthors: readonly string[];
	readonly topicFields: readonly string[];
	readonly postAuthors: readonly string[];
}

export interface ReaderUnwantedTopicFilterPreferencesAdapter<
	TPreferences extends object,
> {
	read(preferences: Readonly<TPreferences>): ReaderUnwantedTopicFilterPreferences;
	createPatch(
		preferences: ReaderUnwantedTopicFilterPreferences,
	): Partial<TPreferences>;
}

export interface ReaderUnwantedTopicFilterPreferencesPort {
	read(): ReaderUnwantedTopicFilterPreferences;
	update?(
		preferences: ReaderUnwantedTopicFilterPreferences,
	): void | Promise<void>;
	subscribe(
		listener: (preferences: ReaderUnwantedTopicFilterPreferences) => void,
		scope?: LifecycleScope,
	): Cleanup;
}

export interface ReaderUnwantedTopicFilterInput {
	readonly topicId: number;
	readonly title: string;
	readonly categoryId?: number | null;
	readonly categoryName?: string;
	readonly categorySlug?: string;
	readonly labels?: readonly string[];
	readonly authorUsername?: string;
}

export interface ReaderUnwantedTopicFilterMatchReason {
	readonly kind: 'category' | 'label' | 'topic-author' | 'topic-field';
	readonly rule: string;
	readonly label: string;
}

export interface ReaderUnwantedTopicFilterMatch
	extends ReaderUnwantedTopicFilterMatchReason {
	readonly matches: readonly ReaderUnwantedTopicFilterMatchReason[];
}

export const DEFAULT_READER_UNWANTED_TOPIC_FILTER_PREFERENCES =
	Object.freeze<ReaderUnwantedTopicFilterPreferences>({
		enabled: false,
		categories: Object.freeze([]),
		labels: Object.freeze([]),
		topicAuthors: Object.freeze([]),
		topicFields: Object.freeze([]),
		postAuthors: Object.freeze([]),
	});

export const readerPreferencesUnwantedTopicFilterAdapter = Object.freeze<
	ReaderUnwantedTopicFilterPreferencesAdapter<ReaderPreferences>
>({
	read: (preferences) => normalizeReaderUnwantedTopicFilterPreferences({
		enabled: preferences.unwantedTopicFilterEnabled,
		categories: preferences.unwantedTopicFilterCategories,
		labels: preferences.unwantedTopicFilterLabels,
		topicAuthors: preferences.unwantedTopicFilterTopicAuthors,
		topicFields: preferences.unwantedTopicFilterTopicFields,
		postAuthors: preferences.unwantedTopicFilterPostAuthors,
	}),
	createPatch: (preferences) => Object.freeze({
		unwantedTopicFilterEnabled: preferences.enabled,
		unwantedTopicFilterCategories: preferences.categories,
		unwantedTopicFilterLabels: preferences.labels,
		unwantedTopicFilterTopicAuthors: preferences.topicAuthors,
		unwantedTopicFilterTopicFields: preferences.topicFields,
		unwantedTopicFilterPostAuthors: preferences.postAuthors,
	}),
});

function text(value: unknown, maximum = 80): string {
	return String(value ?? '')
		.replace(/[\r\n\t]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, maximum);
}

function values(
	value: unknown,
	transform: (entry: string) => string = (entry) => entry,
): readonly string[] {
	const source = Array.isArray(value)
		? value
		: String(value ?? '').split(/[\n,，]+/);
	const result = new Map<string, string>();
	for (const item of source) {
		const entry = transform(text(item));
		const key = entry.toLocaleLowerCase('zh-CN');
		if (key && !result.has(key)) result.set(key, entry);
		if (result.size >= 100) break;
	}
	return Object.freeze([...result.values()]);
}

function userValues(value: unknown): readonly string[] {
	return values(value, (entry) => entry.replace(/^@+/, '').trim());
}

function labelValues(value: unknown): readonly string[] {
	return values(value, (entry) => entry.replace(/^[#＃]+/, '').trim());
}

export function normalizeReaderUnwantedTopicFilterPreferences(
	value: Partial<ReaderUnwantedTopicFilterPreferences> | null | undefined,
): ReaderUnwantedTopicFilterPreferences {
	return Object.freeze({
		enabled: value?.enabled === true,
		categories: values(value?.categories),
		labels: labelValues(value?.labels),
		topicAuthors: userValues(value?.topicAuthors),
		topicFields: values(value?.topicFields),
		postAuthors: userValues(value?.postAuthors),
	});
}

export function readerUnwantedTopicFilterPreferencesEqual(
	left: ReaderUnwantedTopicFilterPreferences,
	right: ReaderUnwantedTopicFilterPreferences,
): boolean {
	return left.enabled === right.enabled && [
		'categories',
		'labels',
		'topicAuthors',
		'topicFields',
		'postAuthors',
	].every((name) => {
		const key = name as Exclude<
			keyof ReaderUnwantedTopicFilterPreferences,
			'enabled'
		>;
		return left[key].length === right[key].length &&
			left[key].every((entry, index) => entry === right[key][index]);
	});
}

function comparisonKey(value: unknown): string {
	return text(value).toLocaleLowerCase('zh-CN');
}

function matchingSet(
	values: readonly string[],
	candidates: readonly unknown[],
): readonly string[] {
	const candidateKeys = new Set(candidates.map(comparisonKey).filter(Boolean));
	return Object.freeze(values.filter((value) =>
		candidateKeys.has(comparisonKey(value))));
}

function fieldValue(
	name: string,
	input: ReaderUnwantedTopicFilterInput,
): string {
	if (name === 'title' || name === '标题') return input.title;
	if (name === 'category' || name === '类别' || name === '分类') {
		return [input.categoryId, input.categoryName, input.categorySlug]
			.filter((value) => value !== null && value !== undefined)
			.join(' ');
	}
	if (name === 'label' || name === 'tag' || name === '标签') {
		return (input.labels ?? []).join(' ');
	}
	if (name === 'user' || name === 'author' || name === '用户' || name === '作者') {
		return input.authorUsername ?? '';
	}
	if (name === 'topic' || name === 'id') return String(input.topicId);
	return '';
}

function topicFieldMatch(
	rule: string,
	input: ReaderUnwantedTopicFilterInput,
): boolean {
	const separator = rule.indexOf(':');
	if (separator < 1) {
		return topicFieldValueMatches(rule, input.title);
	}
	const name = comparisonKey(rule.slice(0, separator));
	const expected = rule.slice(separator + 1).trim();
	return Boolean(expected && topicFieldValueMatches(
		expected,
		fieldValue(name, input),
	));
}

function topicFieldRegularExpression(value: string): RegExp | null | false {
	const source = value.trim();
	if (!source.startsWith('/')) return null;
	const match = source.match(/^\/([\s\S]*)\/([imsu]*)$/);
	if (!match) return false;
	try {
		return new RegExp(match[1] ?? '', match[2] ?? '');
	} catch {
		return false;
	}
}

function topicFieldValueMatches(expected: string, actual: string): boolean {
	const expression = topicFieldRegularExpression(expected);
	if (expression === false) return false;
	return expression
		? expression.test(actual)
		: comparisonKey(actual).includes(comparisonKey(expected));
}

export function readerUnwantedTopicFieldRuleIsValid(ruleValue: unknown): boolean {
	const rule = text(ruleValue);
	if (!rule) return false;
	const separator = rule.indexOf(':');
	const expected = separator < 1 ? rule : rule.slice(separator + 1).trim();
	if (!expected) return false;
	return topicFieldRegularExpression(expected) !== false;
}

export function readerUnwantedTopicFilterMatch(
	preferencesValue: ReaderUnwantedTopicFilterPreferences,
	input: ReaderUnwantedTopicFilterInput,
): ReaderUnwantedTopicFilterMatch | null {
	const preferences = normalizeReaderUnwantedTopicFilterPreferences(
		preferencesValue,
	);
	if (!preferences.enabled) return null;
	const matches: ReaderUnwantedTopicFilterMatchReason[] = [];
	for (const category of matchingSet(preferences.categories, [
		input.categoryId,
		input.categoryName,
		input.categorySlug,
	])) matches.push(Object.freeze({
		kind: 'category',
		rule: category,
		label: `类别：${input.categoryName || input.categorySlug || category}`,
	}));
	for (const label of matchingSet(preferences.labels, input.labels ?? [])) {
		matches.push(Object.freeze({
			kind: 'label',
			rule: label,
			label: `标签：${label}`,
		}));
	}
	for (const author of matchingSet(
		preferences.topicAuthors,
		[input.authorUsername],
	)) matches.push(Object.freeze({
		kind: 'topic-author',
		rule: author,
		label: `OP：@${author}`,
	}));
	for (const field of preferences.topicFields.filter((rule) =>
		topicFieldMatch(rule, input))) matches.push(Object.freeze({
		kind: 'topic-field',
		rule: field,
		label: `字段：${field}`,
	}));
	const first = matches[0];
	if (!first) return null;
	return Object.freeze({
		...first,
		label: matches.map((match) => match.label).join('；'),
		matches: Object.freeze(matches),
	});
}

export function readerUnwantedPostAuthorMatches(
	preferencesValue: ReaderUnwantedTopicFilterPreferences,
	username: unknown,
): boolean {
	const preferences = normalizeReaderUnwantedTopicFilterPreferences(
		preferencesValue,
	);
	if (!preferences.enabled) return false;
	const candidate = comparisonKey(String(username ?? '').replace(/^@+/, ''));
	return Boolean(candidate && preferences.postAuthors.some((entry) =>
		comparisonKey(entry) === candidate));
}
