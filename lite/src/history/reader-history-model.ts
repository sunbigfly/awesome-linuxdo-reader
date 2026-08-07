import {
	discoursePostNumber,
	discourseTopicId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';

export interface ReaderHistoryViewport {
	readonly postNumber: DiscoursePostNumber;
	readonly postOffset: number;
	readonly scrollTop: number;
}

export interface ReaderHistoryAnchorPoint {
	readonly number: DiscoursePostNumber;
	readonly scrollTop: number;
	readonly scrollLeft: number;
	readonly offset: number;
}

export interface ReaderHistoryReplyWindowState {
	readonly rootPostNumber: DiscoursePostNumber;
	readonly descendantRootPostNumber?: DiscoursePostNumber;
	readonly point: ReaderHistoryAnchorPoint | null;
}

export interface ReaderHistoryQuoteSourceAnchor {
	readonly viewport: ReaderHistoryViewport;
	readonly replyWindow: ReaderHistoryReplyWindowState | null;
	readonly quoteHighlight: null;
}

export interface ReaderHistoryQuoteSource {
	readonly topicId: DiscourseTopicId;
	readonly postNumber: DiscoursePostNumber;
	readonly parentPostNumber: DiscoursePostNumber | null;
	readonly nested: boolean;
	readonly anchor: ReaderHistoryQuoteSourceAnchor | null;
}

export interface ReaderHistoryQuoteHighlightState {
	readonly postNumber: DiscoursePostNumber;
	readonly text: string;
	readonly source: ReaderHistoryQuoteSource | null;
	readonly active: boolean;
}

export interface ReaderHistoryAnchorState {
	readonly viewport: ReaderHistoryViewport;
	readonly replyWindow: ReaderHistoryReplyWindowState | null;
	readonly quoteHighlight: ReaderHistoryQuoteHighlightState | null;
}

export type ReaderHistoryAnchorStates = Readonly<
	Record<string, ReaderHistoryAnchorState>
>;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}

function finite(value: unknown, fallback: number): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

function nonNegative(value: unknown): number {
	return Math.max(0, finite(value, 0));
}

function optionalPostNumber(value: unknown): DiscoursePostNumber | null {
	try {
		return discoursePostNumber(value);
	} catch {
		return null;
	}
}

export function normalizeReaderHistoryViewport(
	value: unknown,
): ReaderHistoryViewport | null {
	const source: Readonly<Record<string, unknown>> =
		record(value) ?? Object.freeze({ postNumber: value });
	const postNumber = optionalPostNumber(source.postNumber);
	if (postNumber === null) return null;
	return Object.freeze({
		postNumber,
		postOffset: finite(source.postOffset, 0),
		scrollTop: nonNegative(source.scrollTop),
	});
}

export function normalizeReaderHistoryAnchorPoint(
	value: unknown,
): ReaderHistoryAnchorPoint | null {
	const source = record(value);
	const number = optionalPostNumber(source?.number);
	if (number === null) return null;
	return Object.freeze({
		number,
		scrollTop: nonNegative(source?.scrollTop),
		scrollLeft: nonNegative(source?.scrollLeft),
		offset: finite(source?.offset, 12),
	});
}

export function normalizeReaderHistoryReplyWindowState(
	value: unknown,
): ReaderHistoryReplyWindowState | null {
	const source = record(value);
	const rootPostNumber = optionalPostNumber(source?.rootPostNumber);
	if (rootPostNumber === null) return null;
	const descendantRootPostNumber = optionalPostNumber(
		source?.descendantRootPostNumber,
	);
	return Object.freeze({
		rootPostNumber,
		...(descendantRootPostNumber !== null &&
			descendantRootPostNumber !== rootPostNumber
			? { descendantRootPostNumber }
			: {}),
		point: normalizeReaderHistoryAnchorPoint(source?.point),
	});
}

function normalizeReaderHistoryQuoteSource(
	value: unknown,
): ReaderHistoryQuoteSource | null {
	const source = record(value);
	if (!source) return null;
	let topicId: DiscourseTopicId;
	let postNumber: DiscoursePostNumber;
	try {
		topicId = discourseTopicId(source.topicId);
		postNumber = discoursePostNumber(source.postNumber);
	} catch {
		return null;
	}
	const parentPostNumber = optionalPostNumber(source.parentPostNumber);
	const rawAnchor = record(source.anchor);
	const viewport = normalizeReaderHistoryViewport(rawAnchor?.viewport);
	const anchor = viewport === null
		? null
		: Object.freeze({
			viewport,
			replyWindow: normalizeReaderHistoryReplyWindowState(
				rawAnchor?.replyWindow,
			),
			quoteHighlight: null,
		});
	return Object.freeze({
		topicId,
		postNumber,
		parentPostNumber,
		nested: source.nested === true && parentPostNumber !== null,
		anchor,
	});
}

function normalizeReaderHistoryQuoteHighlightState(
	value: unknown,
): ReaderHistoryQuoteHighlightState | null {
	const source = record(value);
	const postNumber = optionalPostNumber(source?.postNumber);
	const text = String(source?.text ?? source?.quoteText ?? '');
	if (postNumber === null || !text) return null;
	return Object.freeze({
		postNumber,
		text,
		source: normalizeReaderHistoryQuoteSource(source?.source),
		active: source?.active !== false,
	});
}

export function normalizeReaderHistoryAnchorState(
	value: unknown,
): ReaderHistoryAnchorState | null {
	const raw = record(value);
	const source: Readonly<Record<string, unknown>> = raw && 'viewport' in raw
		? raw
		: Object.freeze({ viewport: value });
	const viewport = normalizeReaderHistoryViewport(source.viewport);
	if (viewport === null) return null;
	return Object.freeze({
		viewport,
		replyWindow: normalizeReaderHistoryReplyWindowState(source.replyWindow),
		quoteHighlight: normalizeReaderHistoryQuoteHighlightState(
			source.quoteHighlight,
		),
	});
}

export function normalizeReaderHistoryAnchorStates(
	value: unknown,
): ReaderHistoryAnchorStates {
	const source = record(value);
	const states: Record<string, ReaderHistoryAnchorState> = {};
	if (!source) return Object.freeze(states);
	for (const [rawTopicId, rawState] of Object.entries(source)) {
		let topicId: DiscourseTopicId;
		try {
			topicId = discourseTopicId(rawTopicId);
		} catch {
			continue;
		}
		const state = normalizeReaderHistoryAnchorState(rawState);
		if (state) states[String(topicId)] = state;
	}
	return Object.freeze(states);
}
