import { discoursePostId } from '../discourse/identifiers.js';
import type { CanonicalActionPost } from '../post/post-action-feature-commands.js';

export interface ReaderPollPostInput extends CanonicalActionPost {
	readonly user_id?: unknown;
	readonly polls?: unknown;
	readonly polls_votes?: unknown;
}

export interface ReaderPollViewer {
	readonly id: number | null;
	readonly username: string | null;
	readonly staff: boolean;
	readonly groups: readonly string[];
}

export interface ReaderPollOptionSnapshot {
	readonly id: string;
	readonly html: string;
	readonly votes: number | null;
	readonly percent: number;
	readonly selected: boolean;
}

export interface ReaderPollSnapshot {
	readonly postId: number;
	readonly name: string;
	readonly title: string;
	readonly type: string;
	readonly options: readonly ReaderPollOptionSnapshot[];
	readonly savedVotes: readonly string[];
	readonly draftVotes: readonly string[];
	readonly voters: number;
	readonly min: number;
	readonly max: number;
	readonly closed: boolean;
	readonly canVote: boolean;
	readonly canShowResults: boolean;
	readonly showResults: boolean;
	readonly validDraft: boolean;
	readonly note: string;
}

export interface ReaderPollSnapshotOptions {
	readonly viewer: ReaderPollViewer;
	readonly topicArchived: boolean;
	readonly now?: number;
	readonly showResults?: boolean;
	readonly draftVotes?: readonly string[];
}

interface PollRecord {
	readonly [key: string]: unknown;
}

function record(value: unknown): PollRecord {
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as PollRecord
		: {};
}

function pollName(value: unknown): string {
	const normalized = String(value ?? 'poll').trim();
	return normalized || 'poll';
}

export function readerPollNames(post: ReaderPollPostInput): readonly string[] {
	const polls = Array.isArray(post.polls) ? post.polls : [];
	return Object.freeze(polls.map((poll) => pollName(record(poll).name)));
}

function pollByName(post: ReaderPollPostInput, name: string): PollRecord {
	const polls = Array.isArray(post.polls) ? post.polls : [];
	const found = polls
		.map(record)
		.find((poll) => pollName(poll.name) === name);
	if (!found) throw new Error(`post ${post.id} 缺少 poll ${name}`);
	return found;
}

function normalizedVotes(value: unknown, allowed: ReadonlySet<string>): readonly string[] {
	if (!Array.isArray(value)) return Object.freeze([]);
	return Object.freeze(
		[...new Set(value.map(String).map((entry) => entry.trim()))]
			.filter((entry) => Boolean(entry) && allowed.has(entry)),
	);
}

function nonNegative(value: unknown): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function isClosed(poll: PollRecord, topicArchived: boolean, now: number): boolean {
	if (topicArchived || String(poll.status ?? '') === 'closed') return true;
	if (!poll.close) return false;
	const closeAt = Date.parse(String(poll.close));
	return Number.isFinite(closeAt) && closeAt <= now;
}

function viewerCanVote(poll: PollRecord, viewer: ReaderPollViewer): boolean {
	if (!viewer.username) return false;
	const required = String(poll.groups ?? '')
		.split(',')
		.map((group) => group.trim().toLocaleLowerCase())
		.filter(Boolean);
	if (!required.length) return true;
	const groups = new Set(
		viewer.groups.map(String).map((group) => group.trim().toLocaleLowerCase()),
	);
	return required.some((group) => groups.has(group));
}

export function readerPollSnapshot(
	post: ReaderPollPostInput,
	nameInput: string,
	options: ReaderPollSnapshotOptions,
): ReaderPollSnapshot {
	const postId = Number(discoursePostId(post.id));
	const name = pollName(nameInput);
	const poll = pollByName(post, name);
	const rawOptions = Array.isArray(poll.options) ? poll.options.map(record) : [];
	const ids = new Set<string>();
	const normalizedOptions = rawOptions.flatMap((option, index) => {
		const id = String(option.id ?? '').trim();
		if (!id || ids.has(id)) return [];
		ids.add(id);
		const hasVotes = option.votes !== null && option.votes !== undefined;
		return [{
			id,
			html: String(option.html ?? `选项 ${index + 1}`),
			votes: hasVotes ? nonNegative(option.votes) : null,
		}];
	});
	const votesRecord = record(post.polls_votes);
	const savedVotes = normalizedVotes(votesRecord[name], ids);
	const draftVotes = normalizedVotes(options.draftVotes ?? savedVotes, ids);
	const type = String(poll.type ?? 'regular');
	const closed = isClosed(poll, options.topicArchived, options.now ?? Date.now());
	const groupAllowed = viewerCanVote(poll, options.viewer);
	const canVote = !closed && groupAllowed && type !== 'ranked_choice';
	const voters = nonNegative(poll.voters);
	const configuredMin = Math.max(
		1,
		Number.parseInt(String(poll.min ?? ''), 10) || 1,
	);
	const parsedMax = Number.parseInt(String(poll.max ?? ''), 10);
	const min = type === 'multiple' ? configuredMin : 1;
	const max = type === 'multiple'
		? Math.max(
			min,
			Math.min(
				normalizedOptions.length,
				Number.isFinite(parsedMax) ? parsedMax : normalizedOptions.length,
			),
		)
		: 1;
	const hasResults = normalizedOptions.some((option) => option.votes !== null);
	const resultRule = String(poll.results ?? 'always');
	let canShowResults = hasResults;
	if (resultRule === 'on_close' && !closed) canShowResults = false;
	if (resultRule === 'staff_only' && !options.viewer.staff) canShowResults = false;
	if (resultRule === 'on_vote' && !savedVotes.length) {
		canShowResults = options.viewer.id !== null &&
			Number(post.user_id) === options.viewer.id;
	}
	const requestedResults = options.showResults ??
		(savedVotes.length > 0 || closed);
	const showResults = canShowResults && requestedResults;
	let note = '';
	if (type === 'ranked_choice') note = '排序投票请在原页面参与。';
	else if (closed) note = '投票已结束。';
	else if (!options.viewer.username) note = '登录后可参与投票。';
	else if (!groupAllowed) note = '你不在该投票允许参与的用户组中。';
	const selected = new Set(draftVotes);
	return Object.freeze({
		postId,
		name,
		title: String(poll.title ?? ''),
		type,
		options: Object.freeze(normalizedOptions.map((option) => Object.freeze({
			...option,
			percent: voters > 0 && option.votes !== null
				? Math.min(100, Math.round(option.votes / voters * 100))
				: 0,
			selected: selected.has(option.id),
		}))),
		savedVotes,
		draftVotes,
		voters,
		min,
		max,
		closed,
		canVote,
		canShowResults,
		showResults,
		validDraft: canVote &&
			draftVotes.length >= min &&
			draftVotes.length <= max,
		note,
	});
}
