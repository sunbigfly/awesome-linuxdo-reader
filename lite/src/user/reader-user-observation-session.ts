import type {
	CoordinatedRequestResume,
} from '../network/coordinated-request-client.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import {
	readReaderAccountScopedString,
	readerAccountScopedStorageIdentity,
	type ReaderAccountScopedStorageIdentity,
} from '../state/reader-account-scoped-storage.js';
import type {
	ReaderUserProfileResource,
} from './discourse-native-user-port.js';
import type {
	ReaderUserActivityRecord,
	ReaderUserTopicMetadata,
} from './reader-user-observation-model.js';
import {
	mergeReaderUserActivityTopicMetadata,
	mergeReaderUserActivityRecord,
	mergeReaderUserTopicMetadata,
	readerUserTopicMetadataFromActivity,
	sortReaderUserActivities,
} from './reader-user-observation-model.js';
import type {
	ReaderUserObservationCachedPageBatchRequest,
	ReaderUserObservationPage,
	ReaderUserObservationPageRequest,
	ReaderUserObservationStream,
	ReaderUserObservationTopicMetadataRequest,
} from './discourse-user-observation-adapter.js';
import {
	READER_USER_OBSERVATION_STREAMS,
	readerUserObservationStreamLabel,
} from './discourse-user-observation-adapter.js';
import type {
	ReaderUserObservationPageRepository,
} from './reader-user-observation-page-repository.js';

export const READER_USER_OBSERVATION_STORAGE_KEY =
	'linuxdo-enhanced-reader:user-observation:v1';

export type ReaderUserObservationPhase =
	| 'idle'
	| 'queued'
	| 'loading'
	| 'waiting-rate-limit'
	| 'waiting-challenge'
	| 'ready'
	| 'error';

export type ReaderUserObservationRecoveryKind =
	| 'rate-limit'
	| 'cloudflare-challenge';

export type ReaderSelfObservationStream =
	| 'account-notifications'
	| 'account-collections';

export type ReaderUserObservationProgressStream =
	| ReaderUserObservationStream
	| ReaderSelfObservationStream;

export type ReaderSelfObservationStreamStatus =
	| 'idle'
	| 'loading'
	| 'waiting'
	| 'complete'
	| 'error';

export interface ReaderSelfObservationStreamSnapshot {
	readonly stream: ReaderSelfObservationStream;
	readonly label: string;
	readonly status: ReaderSelfObservationStreamStatus;
	readonly progress: number;
	readonly detail: string;
	readonly error: string;
	readonly retryAt: number | null;
}

export interface ReaderSelfObservationSnapshot {
	readonly records: readonly ReaderUserActivityRecord[];
	readonly streams: readonly ReaderSelfObservationStreamSnapshot[];
}

export interface ReaderUserObservationProgressStreamSnapshot {
	readonly stream: ReaderUserObservationProgressStream;
	readonly label: string;
	readonly status: ReaderSelfObservationStreamStatus;
	readonly progress: number;
	readonly detail: string;
}

export interface ReaderObservedUserIdentity {
	readonly username: string;
	readonly name: string;
	readonly avatarTemplate: string;
}

export interface ReaderUserObservationEntrySnapshot
	extends ReaderObservedUserIdentity {
	readonly isSelf: boolean;
	readonly phase: ReaderUserObservationPhase;
	readonly addedAt: number;
	readonly completedAt: number;
	readonly pages: number;
	readonly currentStream: ReaderUserObservationStream | null;
	readonly completedStreams: number;
	readonly totalStreams: number;
	readonly streams: readonly ReaderUserObservationProgressStreamSnapshot[];
	readonly recordCount: number;
	/** 已提交到分页仓库、可按 Tab 和筛选窗口读取的记录数。 */
	readonly storedRecordCount: number;
	readonly records: readonly ReaderUserActivityRecord[];
	/** 账号私有记录只驻留当前登录账号的运行期投影，不写入公开观察分页仓库。 */
	readonly privateRecords: readonly ReaderUserActivityRecord[];
	readonly privateRecordCount: number;
	readonly detail: string;
	readonly error: string;
	readonly recoveryKind: ReaderUserObservationRecoveryKind | null;
}

export interface ReaderUserObservationSnapshot {
	readonly entries: readonly ReaderUserObservationEntrySnapshot[];
	readonly activeUsername: string;
	readonly topicMetadataRevision: number;
	readonly revision: number;
}

export interface ReaderUserObservationStoragePort {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
	removeItem?(key: string): void;
}

export interface ReaderUserObservationRequestPort {
	loadPage(
		request: ReaderUserObservationPageRequest,
	): Promise<ReaderUserObservationPage>;
	loadCachedPage?(
		request: ReaderUserObservationPageRequest,
	): Promise<ReaderUserObservationPage | null>;
	loadCachedPages?(
		request: ReaderUserObservationCachedPageBatchRequest,
	): Promise<readonly (ReaderUserObservationPage | null)[] | null>;
	loadTopicMetadata?(
		request: ReaderUserObservationTopicMetadataRequest,
	): Promise<readonly ReaderUserTopicMetadata[]>;
}

export interface ReaderUserObservationSessionOptions {
	readonly requests: ReaderUserObservationRequestPort;
	readonly storage: ReaderUserObservationStoragePort;
	readonly pages?: Pick<
		ReaderUserObservationPageRepository,
		'write' | 'remove' | 'identityIndex' | 'persistentIdentityIndex' |
		'topicMetadataCandidates' | 'mergeTopicMetadata'
	>;
	readonly authScope: string;
	readonly requestResume?: (
		cause: unknown,
	) => CoordinatedRequestResume | null;
	readonly notify?: (message: string) => void;
	readonly onError?: (cause: unknown) => void;
	readonly now?: () => number;
	readonly parentScope?: LifecycleScope;
}

const EMPTY_SELF_OBSERVATION = Object.freeze({
	records: Object.freeze([]),
	streams: Object.freeze([]),
}) satisfies ReaderSelfObservationSnapshot;

interface ObservationEntry {
	username: string;
	name: string;
	avatarTemplate: string;
	phase: ReaderUserObservationPhase;
	addedAt: number;
	completedAt: number;
	pages: number;
	currentStream: ReaderUserObservationStream | null;
	completedStreams: number;
	lastRecordCount: number;
	storedRecordCount: number;
	streamCheckpoints: Partial<Record<
		ReaderUserObservationStream,
		ObservationStreamCheckpoint
	>>;
	knownIdentities: ReadonlySet<string>;
	records: readonly ReaderUserActivityRecord[];
	detail: string;
	error: string;
	recoveryKind: ReaderUserObservationRecoveryKind | null;
	epoch: number;
	controller: AbortController | null;
}

interface ObservationJob {
	readonly username: string;
	readonly refresh: boolean;
	readonly notify: boolean;
	readonly restoreCache: boolean;
	readonly continueFromCheckpoint: boolean;
}

interface ObservationStreamCheckpoint {
	readonly page: number;
	readonly offset: number;
	readonly complete: boolean;
}

const MAX_OBSERVED_USERS = 32;
const RATE_LIMIT_RESUME_LIMIT = 8;
const CHALLENGE_RESUME_LIMIT = 3;
const RECORD_PROJECTION_BATCH_PAGES = 12;
const CACHE_REPLAY_BATCH_PAGES = 12;
const SESSION_RECORD_WINDOW = 120;
const TOPIC_METADATA_BATCH_SIZE = 100;

function normalizedUsername(value: unknown): string {
	const username = String(value ?? '')
		.trim()
		.replace(/^@/, '')
		.toLocaleLowerCase();
	if (!username) throw new Error('观察用户 username 不能为空');
	return username;
}

function nonNegativeInteger(value: unknown): number {
	const numeric = Math.floor(Number(value));
	return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : 0;
}

function persistedIdentity(value: unknown): Readonly<{
	username: string;
	name: string;
	avatarTemplate: string;
	addedAt: number;
	completedAt: number;
	lastRecordCount: number;
	pages: number;
	streamCheckpoints: Partial<Record<
		ReaderUserObservationStream,
		ObservationStreamCheckpoint
	>>;
}> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const source = value as Readonly<Record<string, unknown>>;
	let username: string;
	try {
		username = normalizedUsername(source.username);
	} catch {
		return null;
	}
	const streamCheckpoints: Partial<Record<
		ReaderUserObservationStream,
		ObservationStreamCheckpoint
	>> = {};
	const rawCheckpoints = source.streamCheckpoints;
	if (rawCheckpoints && typeof rawCheckpoints === 'object' && !Array.isArray(
		rawCheckpoints,
	)) {
		const checkpoints = rawCheckpoints as Readonly<Record<string, unknown>>;
		for (const stream of READER_USER_OBSERVATION_STREAMS) {
			const value = checkpoints[stream];
			if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
			const checkpoint = value as Readonly<Record<string, unknown>>;
			const page = nonNegativeInteger(checkpoint.page);
			const offset = nonNegativeInteger(checkpoint.offset);
			streamCheckpoints[stream] = Object.freeze({
				page,
				offset,
				complete: checkpoint.complete === true,
			});
		}
	}
	return Object.freeze({
		username,
		name: String(source.name ?? '').trim(),
		avatarTemplate: String(source.avatarTemplate ?? '').trim(),
		addedAt: nonNegativeInteger(source.addedAt) || Date.now(),
		completedAt: nonNegativeInteger(source.completedAt),
		lastRecordCount: nonNegativeInteger(source.lastRecordCount),
		pages: nonNegativeInteger(source.pages),
		streamCheckpoints: Object.freeze(streamCheckpoints),
	});
}

function identityFromProfile(
	profile: ReaderUserProfileResource | ReaderObservedUserIdentity,
): ReaderObservedUserIdentity {
	if ('identity' in profile) {
		return Object.freeze({
			username: normalizedUsername(profile.identity.username),
			name: String(profile.identity.name ?? '').trim(),
			avatarTemplate: String(profile.identity.avatarTemplate ?? '').trim(),
		});
	}
	return Object.freeze({
		username: normalizedUsername(profile.username),
		name: String(profile.name ?? '').trim(),
		avatarTemplate: String(profile.avatarTemplate ?? '').trim(),
	});
}

function mergePageIdentity(
	entry: ObservationEntry,
	identity: ReaderUserObservationPage['identity'],
): boolean {
	if (!identity) return false;
	let username: string;
	try {
		username = normalizedUsername(identity.username);
	} catch {
		return false;
	}
	if (username !== entry.username) return false;
	const name = String(identity.name ?? '').trim();
	const avatarTemplate = String(identity.avatarTemplate ?? '').trim();
	let changed = false;
	if (name && name !== entry.name) {
		entry.name = name;
		changed = true;
	}
	if (avatarTemplate && avatarTemplate !== entry.avatarTemplate) {
		entry.avatarTemplate = avatarTemplate;
		changed = true;
	}
	return changed;
}

function statusOf(cause: unknown): number | null {
	if (!cause || typeof cause !== 'object') return null;
	const status = Number((cause as Readonly<Record<string, unknown>>).status);
	return Number.isSafeInteger(status) ? status : null;
}

function schedulerYielded(cause: unknown): boolean {
	if (!cause || typeof cause !== 'object') return false;
	const source = cause as Readonly<Record<string, unknown>>;
	return source.name === 'AbortError' && source.code === 'cancelled';
}

function isActivePhase(phase: ReaderUserObservationPhase): boolean {
	return [
		'queued',
		'loading',
		'waiting-rate-limit',
		'waiting-challenge',
	].includes(phase);
}

function cloudflareMitigated(cause: unknown): boolean {
	return !!cause && typeof cause === 'object' &&
		'cloudflareMitigated' in cause && cause.cloudflareMitigated === true;
}

function errorMessage(cause: unknown): string {
	if (cloudflareMitigated(cause)) {
		return 'Cloudflare 验证尚未恢复，断点已保留，可稍后继续';
	}
	if (statusOf(cause) === 429) {
		return 'HTTP 429 自动续传已达上限，断点已保留，可稍后重试';
	}
	const message = cause && typeof cause === 'object' && 'message' in cause
		? String(cause.message ?? '').trim()
		: '';
	return message || '公开历史采集失败，请稍后重试';
}

function recoveryKind(cause: unknown): ReaderUserObservationRecoveryKind | null {
	if (cloudflareMitigated(cause)) return 'cloudflare-challenge';
	if (statusOf(cause) === 429) return 'rate-limit';
	return null;
}

function recordBelongsToStream(
	record: ReaderUserActivityRecord,
	stream: ReaderUserObservationStream,
): boolean {
	if (stream === 'topics') return record.kind === 'topic';
	if (stream === 'assigned') return record.kind === 'assigned';
	if (stream === 'boosts') return record.kind === 'boost';
	if (stream === 'reactions') return record.kind === 'reaction';
	if (stream === 'solved') return record.kind === 'solved';
	if (stream === 'votes') return record.kind === 'vote';
	return !['boost', 'reaction', 'vote'].includes(record.kind);
}

/**
 * 用户观察名单、后台串行分页和 429/Cloudflare 断点续传的唯一状态 owner。
 *
 * 名单及完成摘要按账号持久化；历史正文仍由中央 response cache 持久化，本 session
 * 只保留当前运行期的冻结投影，避免把大体积活动流再次塞进 localStorage。
 */
export class ReaderUserObservationSession {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderUserObservationSnapshot>();
	readonly #requests: ReaderUserObservationRequestPort;
	readonly #storage: ReaderUserObservationStoragePort;
	readonly #pages: ReaderUserObservationSessionOptions['pages'];
	readonly #storageIdentity: ReaderAccountScopedStorageIdentity;
	readonly #requestResume: NonNullable<
		ReaderUserObservationSessionOptions['requestResume']
	>;
	readonly #notify: (message: string) => void;
	readonly #onError: (cause: unknown) => void;
	readonly #now: () => number;
	readonly #entries = new Map<string, ObservationEntry>();
	readonly #topicMetadata = new Map<number, ReaderUserTopicMetadata>();
	#pageMetadataWrite = Promise.resolve();
	readonly #jobs: ObservationJob[] = [];
	#selfUsername = '';
	#selfObservation: ReaderSelfObservationSnapshot = EMPTY_SELF_OBSERVATION;
	#retrySelfObservation: (() => void) | null = null;
	#draining = false;
	#activeUsername = '';
	#topicMetadataRevision = 0;
	#revision = 0;

	constructor(options: ReaderUserObservationSessionOptions) {
		this.#requests = options.requests;
		this.#storage = options.storage;
		this.#pages = options.pages;
		this.#storageIdentity = readerAccountScopedStorageIdentity(
			READER_USER_OBSERVATION_STORAGE_KEY,
			options.authScope,
		);
		this.#requestResume = options.requestResume ?? (() => null);
		this.#notify = options.notify ?? (() => {});
		this.#onError = options.onError ?? (() => {});
		this.#now = options.now ?? Date.now;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#restore();
		this.scope.add(() => {
			for (const entry of this.#entries.values()) {
				entry.controller?.abort(
					new DOMException('用户观察 session 已关闭', 'AbortError'),
				);
			}
			this.#jobs.length = 0;
			this.changes.clear();
		});
	}

	get snapshot(): ReaderUserObservationSnapshot {
		return this.#snapshot();
	}

	isObserved(usernameValue: string): boolean {
		try {
			return this.#entries.has(normalizedUsername(usernameValue));
		} catch {
			return false;
		}
	}

	entry(usernameValue: string): ReaderUserObservationEntrySnapshot | null {
		const username = normalizedUsername(usernameValue);
		const entry = this.#entries.get(username);
		return entry ? this.#entrySnapshot(entry) : null;
	}

	/**
	 * 当前账号复用普通观察名单与采集队列；私有来源只绑定到这一条 identity。
	 * application 启动只注册 identity 并恢复本地投影，公开历史必须等待用户显式刷新，
	 * 避免每个标签页刷新时同时重放七类历史和 Topic 元数据请求。
	 */
	observeSelf(
		profile: ReaderObservedUserIdentity,
		retryPrivate?: () => void,
	): ReaderUserObservationEntrySnapshot {
		const identity = identityFromProfile(profile);
		this.#selfUsername = identity.username;
		this.#retrySelfObservation = retryPrivate ?? null;
		this.observe(identity, { allowNetwork: false });
		this.#emit();
		return this.entry(identity.username)!;
	}

	updateSelfObservation(snapshot: ReaderSelfObservationSnapshot): void {
		if (!this.#selfUsername || this.scope.destroyed) return;
		this.#selfObservation = Object.freeze({
			records: sortReaderUserActivities(snapshot.records.filter((record) =>
				Boolean(record.selfStream))),
			streams: Object.freeze(snapshot.streams.map((stream) => Object.freeze({
				...stream,
				progress: Math.max(0, Math.min(1, Number(stream.progress) || 0)),
			}))),
		});
		this.#emit();
	}

	projectTopicMetadata(
		records: readonly ReaderUserActivityRecord[],
	): readonly ReaderUserActivityRecord[] {
		let changed = false;
		const projected = records.map((record) => {
			if (record.topicId === null) return record;
			const metadata = this.#topicMetadata.get(record.topicId);
			if (!metadata) return record;
			const next = mergeReaderUserActivityTopicMetadata(record, metadata);
			if (next !== record) changed = true;
			return next;
		});
		return changed ? Object.freeze(projected) : records;
	}

	/**
	 * 已打开 Topic 的 canonical 元数据回流入口。不发请求；同一 topicId 的内存投影与
	 * 已完成分页缓存一起更新，让所有 Activity Tab 立即共享类别、标签与 Topic 副标题。
	 */
	rememberTopicMetadata(metadata: ReaderUserTopicMetadata): boolean {
		const topicId = Number(metadata.topicId);
		if (!Number.isSafeInteger(topicId) || topicId < 1 || this.scope.destroyed) {
			return false;
		}
		const previous = this.#topicMetadata.get(topicId);
		const merged = mergeReaderUserTopicMetadata(previous, metadata);
		this.#topicMetadata.set(topicId, merged);
		const metadataChanged = merged !== previous;
		let recordsChanged = false;
		const persistentEntries: ObservationEntry[] = [];
		for (const entry of this.#entries.values()) {
			let entryChanged = false;
			const records = entry.records.map((record) => {
				const next = mergeReaderUserActivityTopicMetadata(record, merged);
				if (next !== record) entryChanged = true;
				return next;
			});
			if (entryChanged) {
				entry.records = sortReaderUserActivities(records);
				entry.lastRecordCount = Math.max(
					entry.lastRecordCount,
					entry.records.length,
				);
				recordsChanged = true;
			}
			if (!isActivePhase(entry.phase)) {
				persistentEntries.push(entry);
			}
		}
		if (metadataChanged) this.#topicMetadataRevision += 1;
		if (metadataChanged || recordsChanged) this.#emit();
		if (this.#pages && persistentEntries.length) {
			const persist = async (): Promise<void> => {
				const changed = await Promise.all(persistentEntries.map((candidate) =>
					this.#pages!.mergeTopicMetadata(candidate.username, merged)));
				if (changed.some(Boolean) && !this.scope.destroyed) {
					this.#topicMetadataRevision += 1;
					this.#emit();
				}
			};
			const queued = this.#enqueuePageMutation(persist);
			void queued.catch((cause) => {
				this.#onError(cause);
				this.#notify('用户观察 Topic 元数据缓存更新失败');
			});
		}
		return metadataChanged || recordsChanged;
	}

	#enqueuePageMutation(operation: () => Promise<void>): Promise<void> {
		const queued = this.#pageMetadataWrite.then(operation, operation);
		this.#pageMetadataWrite = queued;
		return queued;
	}

	resume(options: Readonly<{ readonly allowNetwork?: boolean }> = {}): void {
		const allowNetwork = options.allowNetwork !== false;
		for (const entry of this.#entries.values()) {
			if (entry.phase === 'idle' && entry.records.length === 0) {
				void this.#resumeEntry(entry, allowNetwork);
			}
		}
	}

	async #resumeEntry(entry: ObservationEntry, allowNetwork: boolean): Promise<void> {
		try {
			const storedIndex = await this.#pages?.identityIndex(entry.username);
			const identityIndex = storedIndex?.complete
				? await this.#pages?.persistentIdentityIndex(entry.username)
				: storedIndex;
			if (
				storedIndex?.complete && !identityIndex &&
				this.#entries.get(entry.username) === entry
			) {
				entry.knownIdentities = new Set(storedIndex.identities);
				entry.lastRecordCount = Math.max(
					entry.lastRecordCount,
					storedIndex.total,
				);
				entry.storedRecordCount = storedIndex.total;
				entry.phase = 'error';
				entry.detail = '已保留本地断点索引';
				entry.error = '本地分页缓存完整性校验失败，不能标记采集完成；' +
					'可从断点重试';
				this.#emit();
				return;
			}
			if (identityIndex && this.#entries.get(entry.username) === entry) {
				entry.knownIdentities = new Set(identityIndex.identities);
				entry.lastRecordCount = Math.max(
					entry.lastRecordCount,
					identityIndex.total,
				);
				entry.storedRecordCount = identityIndex.total;
				entry.phase = identityIndex.complete ? 'ready' : 'idle';
				entry.detail = identityIndex.complete
					? `已索引 ${identityIndex.total} 条本地分页缓存`
					: `已恢复 ${identityIndex.total} 条断点索引`;
				entry.error = '';
				this.#emit();
				if (!identityIndex.complete && allowNetwork) {
					this.#enqueue(entry.username, false, false, false, true);
				}
				return;
			}
		} catch (cause) {
			this.#onError(cause);
		}
		if (
			allowNetwork &&
			this.#entries.get(entry.username) === entry &&
			entry.phase === 'idle'
		) {
			this.#enqueue(entry.username, false, false, true);
		}
	}

	observe(
		profile: ReaderUserProfileResource | ReaderObservedUserIdentity,
		options: Readonly<{ readonly allowNetwork?: boolean }> = {},
	): Readonly<{ added: boolean; entry: ReaderUserObservationEntrySnapshot }> {
		if (this.scope.destroyed) throw new Error('用户观察 session 已关闭');
		const identity = identityFromProfile(profile);
		let entry = this.#entries.get(identity.username);
		const added = !entry;
		if (!entry) {
			entry = {
				...identity,
				phase: 'idle',
				addedAt: this.#now(),
				completedAt: 0,
				pages: 0,
				currentStream: null,
				completedStreams: 0,
				lastRecordCount: 0,
				storedRecordCount: 0,
				streamCheckpoints: {},
				knownIdentities: new Set<string>(),
				records: Object.freeze([]),
				detail: '',
				error: '',
				recoveryKind: null,
				epoch: 0,
				controller: null,
			};
			this.#entries.set(identity.username, entry);
			this.#trim();
		} else {
			entry.name = identity.name || entry.name;
			entry.avatarTemplate = identity.avatarTemplate || entry.avatarTemplate;
		}
		this.#persist();
		this.#emit();
		if (
			options.allowNetwork !== false &&
			(added || (entry.records.length === 0 && entry.phase !== 'loading'))
		) {
			this.#enqueue(identity.username, false, true);
		}
		return Object.freeze({ added, entry: this.#entrySnapshot(entry) });
	}

	refresh(usernameValue: string): void {
		const username = normalizedUsername(usernameValue);
		const entry = this.#entries.get(username);
		if (!entry || this.scope.destroyed) return;
		if (username === this.#selfUsername) this.#retrySelfObservation?.();
		if ([
			'queued',
			'loading',
			'waiting-rate-limit',
			'waiting-challenge',
		].includes(entry.phase)) return;
		entry.epoch += 1;
		entry.controller?.abort(new DOMException('增量更新用户历史', 'AbortError'));
		entry.controller = null;
		entry.detail = entry.records.length
			? '准备增量更新最近活动'
			: '准备采集公开活动';
		entry.error = '';
		entry.recoveryKind = null;
		this.#jobs.splice(0, this.#jobs.length, ...this.#jobs.filter(
			(job) => job.username !== username,
		));
		this.#enqueue(username, true, true);
	}

	/** 失败后只从已提交的来源分页断点续采；不会切换成刷新或重放旧网络页。 */
	retry(usernameValue: string): void {
		const username = normalizedUsername(usernameValue);
		const entry = this.#entries.get(username);
		if (!entry || this.scope.destroyed) return;
		if (username === this.#selfUsername) this.#retrySelfObservation?.();
		if (
			isActivePhase(entry.phase) ||
			(entry.phase !== 'error' && entry.phase !== 'idle')
		) return;
		entry.epoch += 1;
		entry.controller?.abort(new DOMException('续传用户历史', 'AbortError'));
		entry.controller = null;
		entry.detail = entry.pages > 0
			? `准备从第 ${entry.pages + 1} 个缓存断点续传`
			: '准备从缓存断点恢复';
		entry.error = '';
		entry.recoveryKind = null;
		this.#jobs.splice(0, this.#jobs.length, ...this.#jobs.filter(
			(job) => job.username !== username,
		));
		this.#enqueue(username, false, true, true, true);
	}

	/** 共享请求闸门恢复后，只重排对应失败类型，并沿已提交来源断点续传。 */
	resumeRecoverable(kind: ReaderUserObservationRecoveryKind): number {
		if (this.scope.destroyed) return 0;
		const usernames = [...this.#entries.values()]
			.filter((entry) =>
				entry.phase === 'error' && entry.recoveryKind === kind)
			.map((entry) => entry.username);
		for (const username of usernames) this.retry(username);
		return usernames.length;
	}

	remove(usernameValue: string): boolean {
		const username = normalizedUsername(usernameValue);
		if (username === this.#selfUsername) return false;
		const entry = this.#entries.get(username);
		if (!entry) return false;
		entry.epoch += 1;
		entry.controller?.abort(new DOMException('用户已移出观察名单', 'AbortError'));
		this.#entries.delete(username);
		this.#jobs.splice(0, this.#jobs.length, ...this.#jobs.filter(
			(job) => job.username !== username,
		));
		if (this.#activeUsername === username) this.#activeUsername = '';
		this.#persist();
		this.#emit();
		void this.#pages?.remove(username).catch(this.#onError);
		return true;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#enqueue(
		username: string,
		refresh: boolean,
		notify: boolean,
		restoreCache = false,
		continueFromCheckpoint = false,
	): void {
		const entry = this.#entries.get(username);
		if (!entry || this.scope.destroyed) return;
		const queued = this.#jobs.findIndex((job) => job.username === username);
		if (queued >= 0) {
			const current = this.#jobs[queued]!;
			this.#jobs[queued] = Object.freeze({
				username,
				refresh: current.refresh || refresh,
				notify: current.notify || notify,
				restoreCache: current.restoreCache || restoreCache,
				continueFromCheckpoint:
					current.continueFromCheckpoint || continueFromCheckpoint,
			});
			return;
		}
		if (
			this.#activeUsername === username &&
			entry.controller !== null &&
			!entry.controller.signal.aborted
		) return;
		entry.phase = 'queued';
		entry.detail = refresh && entry.records.length
			? '等待后台增量更新'
			: '等待后台串行采集';
		entry.error = '';
		this.#jobs.push(Object.freeze({
			username,
			refresh,
			notify,
			restoreCache,
			continueFromCheckpoint,
		}));
		this.#emit();
		void this.#drain();
	}

	async #drain(): Promise<void> {
		if (this.#draining || this.scope.destroyed) return;
		this.#draining = true;
		try {
			while (!this.scope.destroyed && this.#jobs.length) {
				const job = this.#jobs.shift()!;
				if (!this.#entries.has(job.username)) continue;
				this.#activeUsername = job.username;
				this.#emit();
				await this.#run(job);
				if (this.#activeUsername === job.username) {
					this.#activeUsername = '';
					this.#emit();
				}
			}
		} finally {
			this.#activeUsername = '';
			this.#draining = false;
		}
	}

	async #run(job: ObservationJob): Promise<void> {
		const entry = this.#entries.get(job.username);
		if (!entry) return;
		const epoch = ++entry.epoch;
		const controller = new AbortController();
		entry.controller = controller;
		entry.phase = 'loading';
		entry.recoveryKind = null;
		if (!job.continueFromCheckpoint) {
			/*
			 * 刷新/新采集开启新的来源断点世代。否则上一轮已完成的 checkpoint
			 * 会让本轮中途失败后的 retry 误判为全部完成，只更新摘要而不续采。
			 */
			entry.streamCheckpoints = {};
		}
		const knownIdentities = new Set(entry.knownIdentities);
		for (const record of entry.records) knownIdentities.add(record.identity);
		const incremental = job.refresh && knownIdentities.size > 0;
		const previousPages = entry.pages;
		const firstPendingStream = job.continueFromCheckpoint
			? READER_USER_OBSERVATION_STREAMS.findIndex((stream) =>
				entry.streamCheckpoints[stream]?.complete !== true)
			: 0;
		const replayCheckpointCache = Boolean(
			job.restoreCache &&
			job.continueFromCheckpoint &&
			entry.records.length === 0 &&
			knownIdentities.size === 0 &&
			this.#requests.loadCachedPage,
		);
		const startingStreamIndex = replayCheckpointCache
			? 0
			: firstPendingStream < 0
				? READER_USER_OBSERVATION_STREAMS.length
				: firstPendingStream;
		entry.currentStream = READER_USER_OBSERVATION_STREAMS[startingStreamIndex] ?? null;
		entry.completedStreams = startingStreamIndex;
		entry.detail = incremental
			? `正在增量读取最近活动 · 第 1/${READER_USER_OBSERVATION_STREAMS.length} 类`
			: `后台采集中 · 第 1/${READER_USER_OBSERVATION_STREAMS.length} 类`;
		entry.error = '';
		this.#emit();
		let totalPages = 0;
		let networkPages = 0;
		let rateLimitResumes = 0;
		let challengeResumes = 0;
		const records = new Map(
			entry.records.map((record) => [record.identity, record] as const),
		);
		const identitiesByTopic = new Map<number, Set<string>>();
		for (const record of records.values()) {
			if (record.topicId === null) continue;
			const identities = identitiesByTopic.get(record.topicId) ?? new Set<string>();
			identities.add(record.identity);
			identitiesByTopic.set(record.topicId, identities);
		}
		let projectedPages = 0;
		const projectRecords = (force = false): void => {
			const projectionInterval = records.size >= 10_000
				? RECORD_PROJECTION_BATCH_PAGES * 8
				: records.size >= 3_000
					? RECORD_PROJECTION_BATCH_PAGES * 4
					: RECORD_PROJECTION_BATCH_PAGES;
			if (!force && totalPages - projectedPages < projectionInterval) {
				entry.lastRecordCount = Math.max(entry.lastRecordCount, records.size);
				return;
			}
			const projectedRecords = sortReaderUserActivities([...records.values()]);
			entry.records = this.#pages &&
				(entry.storedRecordCount > 0 || replayCheckpointCache) &&
				projectedRecords.length > SESSION_RECORD_WINDOW
				? Object.freeze(projectedRecords.slice(0, SESSION_RECORD_WINDOW))
				: projectedRecords;
			entry.lastRecordCount = Math.max(
				entry.lastRecordCount,
				projectedRecords.length,
			);
			projectedPages = totalPages;
		};
		const checkpointChanged = (forceProjection = false): void => {
			this.#persist();
			projectRecords(forceProjection);
			this.#emit();
		};
		let checkpointSnapshotSize = 0;
		const persistNormalizedCheckpoint = async (): Promise<void> => {
			if (!this.#pages || records.size <= checkpointSnapshotSize) return;
			const snapshotSize = records.size;
			try {
				await this.#enqueuePageMutation(() => this.#pages!.write(
					entry.username,
					Object.freeze([...records.values()]),
					this.#now(),
					true,
					Object.freeze([...this.#topicMetadata.values()]),
					false,
				));
				const identityIndex = await this.#pages.identityIndex(entry.username);
				if (
					identityIndex &&
					this.#entries.get(entry.username) === entry &&
					entry.epoch === epoch
				) {
					entry.storedRecordCount = identityIndex.total;
					entry.lastRecordCount = Math.max(
						entry.lastRecordCount,
						identityIndex.total,
					);
					if (entry.records.length > SESSION_RECORD_WINDOW) {
						entry.records = Object.freeze(entry.records.slice(
							0,
							SESSION_RECORD_WINDOW,
						));
					}
					this.#emit();
				}
				checkpointSnapshotSize = snapshotSize;
			} catch (cause) {
				this.#onError(cause);
			}
		};
		const enrichTopicMetadata = async (): Promise<void> => {
			const loadTopicMetadata = this.#requests.loadTopicMetadata;
			if (!loadTopicMetadata) return;
			const candidates = new Set<number>();
			for (const record of records.values()) {
				if (
					record.topicId !== null &&
					record.topicMetadataComplete !== true
				) candidates.add(record.topicId);
			}
			try {
				for (const topicId of await this.#pages?.topicMetadataCandidates(
					entry.username,
				) ?? []) candidates.add(topicId);
			} catch (cause) {
				this.#onError(cause);
			}
			const topicIds = [...candidates]
				.filter((topicId) =>
					this.#topicMetadata.get(topicId)?.complete !== true)
				.sort((left, right) => left - right);
			if (!topicIds.length) return;
			const batches = Array.from(
				{ length: Math.ceil(topicIds.length / TOPIC_METADATA_BATCH_SIZE) },
				(_, index) => topicIds.slice(
					index * TOPIC_METADATA_BATCH_SIZE,
					(index + 1) * TOPIC_METADATA_BATCH_SIZE,
				),
			);
			entry.phase = 'loading';
			entry.currentStream = null;
			entry.completedStreams = READER_USER_OBSERVATION_STREAMS.length;
			entry.detail = `主题元数据更新中 · 0/${batches.length} 批`;
			this.#emit();
			let resolved = 0;
			for (const [batchIndex, topicIdBatch] of batches.entries()) {
				let metadata: readonly ReaderUserTopicMetadata[];
				while (true) {
					controller.signal.throwIfAborted();
					try {
						metadata = await loadTopicMetadata.call(this.#requests, {
							topicIds: topicIdBatch,
							signal: controller.signal,
							background: true,
							refresh: job.refresh,
						});
						break;
					} catch (cause) {
						controller.signal.throwIfAborted();
						if (schedulerYielded(cause)) {
							entry.phase = 'queued';
							entry.detail = '主题元数据已为前台请求让路 · 等待自动续传';
							this.#emit();
							continue;
						}
						const resume = this.#requestResume(cause);
						if (!resume) throw cause;
						const limit = resume.kind === 'rate-limit'
							? RATE_LIMIT_RESUME_LIMIT
							: CHALLENGE_RESUME_LIMIT;
						const used = resume.kind === 'rate-limit'
							? ++rateLimitResumes
							: ++challengeResumes;
						if (used > limit) throw cause;
						entry.phase = resume.kind === 'rate-limit'
							? 'waiting-rate-limit'
							: 'waiting-challenge';
						entry.detail = resume.kind === 'rate-limit'
							? `主题元数据限流等待 · 第 ${batchIndex + 1} 批 · ` +
								`${Math.max(0, Math.ceil(resume.waitMs / 1_000))} 秒后自动续传`
							: `主题元数据等待验证 · 第 ${batchIndex + 1} 批 · ` +
								'通过后自动续传';
						this.#emit();
						await Promise.all([
							resume.wait(controller.signal),
							persistNormalizedCheckpoint(),
						]);
						controller.signal.throwIfAborted();
						entry.phase = 'loading';
						entry.detail = `主题元数据更新中 · ${batchIndex}/` +
							`${batches.length} 批`;
						this.#emit();
					}
				}
				for (const value of metadata) {
					if (this.#mergeTopicMetadata(records, identitiesByTopic, value)) {
						resolved += 1;
					}
				}
				projectRecords(true);
				entry.phase = 'loading';
				entry.detail = `主题元数据更新中 · ${batchIndex + 1}/` +
					`${batches.length} 批 · 已补齐 ${resolved}/${topicIds.length} 个主题`;
				this.#emit();
			}
		};
		const finish = async (restoredFromCache = false): Promise<void> => {
			const completedRecords = sortReaderUserActivities([...records.values()]);
			if (this.#pages) {
				await this.#enqueuePageMutation(() => this.#pages!.write(
					entry.username,
					completedRecords,
					this.#now(),
					true,
					Object.freeze([...this.#topicMetadata.values()]),
				));
				entry.detail = '正在验证本地分页缓存完整性';
				this.#emit();
				const identityIndex = await this.#pages.persistentIdentityIndex(
					entry.username,
				);
				if (!identityIndex?.complete) {
					throw new Error(
						'公开历史已采集，但本地分页缓存完整性校验失败；' +
						'断点已保留，可重试',
					);
				}
				entry.storedRecordCount = identityIndex.total;
			} else {
				entry.storedRecordCount = completedRecords.length;
			}
			entry.phase = 'ready';
			entry.completedAt = this.#now();
			entry.currentStream = null;
			entry.completedStreams = READER_USER_OBSERVATION_STREAMS.length;
			const added = completedRecords.filter(
				(record) => !knownIdentities.has(record.identity),
			).length;
			entry.detail = restoredFromCache
				? `已从本地缓存恢复 ${completedRecords.length} 条公开活动`
				: incremental
					? `最近活动已更新 · 新增 ${added} 条`
					: '公开历史采集完成';
			entry.error = '';
			entry.recoveryKind = null;
			entry.controller = null;
			entry.knownIdentities = new Set([
				...knownIdentities,
				...completedRecords.map((record) => record.identity),
			]);
			entry.lastRecordCount = Math.max(
				entry.lastRecordCount,
				entry.knownIdentities.size,
			);
			entry.records = this.#pages && completedRecords.length > SESSION_RECORD_WINDOW
				? Object.freeze(completedRecords.slice(
					0,
					SESSION_RECORD_WINDOW,
				))
				: completedRecords;
			this.#persist();
			this.#emit();
			if (job.notify) {
				this.#notify(
					incremental
						? `@${job.username} 最近活动更新完成，新增 ${added} 条`
						: `@${job.username} 历史采集完成，共 ` +
							`${entry.lastRecordCount} 条`,
				);
			}
		};
		try {
			if (startingStreamIndex >= READER_USER_OBSERVATION_STREAMS.length) {
				await enrichTopicMetadata();
				await finish(true);
				return;
			}
			for (
				let streamIndex = startingStreamIndex;
				streamIndex < READER_USER_OBSERVATION_STREAMS.length;
				streamIndex += 1
			) {
				const stream = READER_USER_OBSERVATION_STREAMS[streamIndex]!;
				const streamLabel = readerUserObservationStreamLabel(stream);
				const knownStreamIdentities = knownIdentities.size
					? knownIdentities
					: new Set(entry.records
						.filter((record) => recordBelongsToStream(record, stream))
						.map((record) => record.identity));
				const checkpoint = job.continueFromCheckpoint
					? entry.streamCheckpoints[stream]
					: undefined;
				let page = checkpoint?.page ?? 0;
				let offset = checkpoint?.offset ?? 0;
				const seenOffsets = new Set<number>([offset]);
				let streamComplete = false;
				entry.phase = 'loading';
				entry.currentStream = stream;
				entry.completedStreams = streamIndex;
				entry.detail = `${incremental ? '增量更新' : '后台采集中'} · ` +
					`${streamLabel} · ${streamIndex + 1}/` +
					`${READER_USER_OBSERVATION_STREAMS.length}`;
				this.#emit();

				if (
					job.restoreCache &&
					(!job.continueFromCheckpoint || replayCheckpointCache) &&
					this.#requests.loadCachedPage
				) {
					const checkpointPage = page;
					let cachePage = job.continueFromCheckpoint ? 0 : page;
					let cacheOffset = job.continueFromCheckpoint ? 0 : offset;
					let cacheStopped = false;
					while (
						!cacheStopped &&
						(!job.continueFromCheckpoint || cachePage < checkpointPage)
					) {
						controller.signal.throwIfAborted();
						const pageCount = job.continueFromCheckpoint
							? Math.min(CACHE_REPLAY_BATCH_PAGES, checkpointPage - cachePage)
							: CACHE_REPLAY_BATCH_PAGES;
						const batch = await this.#requests.loadCachedPages?.({
							username: job.username,
							stream,
							startPage: cachePage,
							pageCount,
							signal: controller.signal,
							background: true,
						}) ?? Object.freeze([
							await this.#requests.loadCachedPage({
								username: job.username,
								stream,
								page: cachePage,
								offset: cacheOffset,
								signal: controller.signal,
								background: true,
								refresh: false,
							}),
						]);
						if (!batch.length) break;
						for (const cached of batch) {
							if (!cached) {
								cacheStopped = true;
								break;
							}
							if (mergePageIdentity(entry, cached.identity)) this.#persist();
							this.#mergeRecords(records, cached.records, identitiesByTopic);
							cachePage += 1;
							totalPages += 1;
							cacheOffset = cached.nextOffset;
							if (!job.continueFromCheckpoint) {
								page = cachePage;
								offset = cacheOffset;
							}
							entry.pages = Math.max(previousPages, totalPages);
							if (!job.continueFromCheckpoint) {
								entry.streamCheckpoints[stream] = Object.freeze({
									page,
									offset,
									complete: cached.complete,
								});
							}
							projectRecords();
							entry.detail = `缓存恢复 · ${streamLabel} · ` +
								`${streamIndex + 1}/${READER_USER_OBSERVATION_STREAMS.length} · ` +
								`${records.size} 条 · ${entry.pages} 页`;
							if (
								cached.complete ||
								totalPages % RECORD_PROJECTION_BATCH_PAGES === 0
							) checkpointChanged();
							if (cached.complete) {
								streamComplete = true;
								page = cachePage;
								offset = cacheOffset;
								cacheStopped = true;
								break;
							}
						}
					}
					if (
						job.continueFromCheckpoint &&
						!streamComplete &&
						cachePage < checkpointPage
					) {
						/*
						 * 检查点之前出现缓存缺页时，从最早缺页重取；不能跳过缺失
						 * 数据直接使用更靠后的持久断点。
						 */
						page = cachePage;
						offset = cacheOffset;
						entry.streamCheckpoints[stream] = Object.freeze({
							page,
							offset,
							complete: false,
						});
						this.#persist();
					} else if (job.continueFromCheckpoint && !streamComplete) {
						streamComplete = checkpoint?.complete === true;
					}
					if (
						replayCheckpointCache &&
						streamIndex === firstPendingStream &&
						records.size > 0
					) await persistNormalizedCheckpoint();
				}

				while (!streamComplete) {
					controller.signal.throwIfAborted();
					let loaded: ReaderUserObservationPage;
					try {
						loaded = await this.#requests.loadPage({
							username: job.username,
							stream,
							page,
							offset,
							signal: controller.signal,
							background: true,
							refresh: job.refresh,
						});
						networkPages += 1;
					} catch (cause) {
						controller.signal.throwIfAborted();
						if (schedulerYielded(cause)) {
							entry.phase = 'queued';
							entry.detail = `${streamLabel} 已为前台请求让路 · ` +
								`第 ${page + 1} 页等待自动续传`;
							this.#emit();
							continue;
						}
						const resume = this.#requestResume(cause);
						if (!resume) {
							if (
								stream !== 'activity' &&
								!cloudflareMitigated(cause) &&
								[403, 404].includes(statusOf(cause) ?? 0)
							) {
								entry.phase = 'loading';
								entry.detail = `${streamLabel} 当前不可用，继续下一类`;
								this.#emit();
								streamComplete = true;
								break;
							}
							throw cause;
						}
						const limit = resume.kind === 'rate-limit'
							? RATE_LIMIT_RESUME_LIMIT
							: CHALLENGE_RESUME_LIMIT;
						const used = resume.kind === 'rate-limit'
							? ++rateLimitResumes
							: ++challengeResumes;
						if (used > limit) throw cause;
						entry.phase = resume.kind === 'rate-limit'
							? 'waiting-rate-limit'
							: 'waiting-challenge';
						entry.detail = resume.kind === 'rate-limit'
							? `${streamLabel} 限流等待 · 第 ${page + 1} 页 · ` +
								`${Math.max(0, Math.ceil(resume.waitMs / 1_000))} 秒后自动续传`
							: `${streamLabel} 等待验证 · 第 ${page + 1} 页 · 通过后自动续传`;
						this.#emit();
						await Promise.all([
							resume.wait(controller.signal),
							persistNormalizedCheckpoint(),
						]);
						controller.signal.throwIfAborted();
						entry.phase = 'loading';
						entry.detail = `恢复中 · ${streamLabel} 第 ${page + 1} 页`;
						this.#emit();
						continue;
					}
					if (
						this.#entries.get(job.username) !== entry ||
						entry.epoch !== epoch
					) return;
					if (mergePageIdentity(entry, loaded.identity)) this.#persist();
					const reachedKnownRecord = incremental && loaded.records.some(
						(activity) => knownStreamIdentities.has(activity.identity),
					);
					if (
						!loaded.complete && !reachedKnownRecord &&
						(!Number.isSafeInteger(loaded.nextOffset) ||
							loaded.nextOffset < 0 || seenOffsets.has(loaded.nextOffset))
					) {
						throw new Error(`${streamLabel} 分页游标未前进，已停止重复请求`);
					}
					this.#mergeRecords(records, loaded.records, identitiesByTopic);
					page += 1;
					totalPages += 1;
					offset = loaded.nextOffset;
					seenOffsets.add(offset);
					entry.pages = incremental || job.continueFromCheckpoint
						? Math.max(previousPages, totalPages)
						: totalPages;
					streamComplete = loaded.complete || reachedKnownRecord;
					entry.streamCheckpoints[stream] = Object.freeze({
						page,
						offset,
						complete: streamComplete,
					});
					entry.detail = `${incremental ? '增量更新' : '后台采集中'} · ` +
						`${streamLabel} · ${streamIndex + 1}/` +
						`${READER_USER_OBSERVATION_STREAMS.length} · ` +
						`${records.size} 条 · ${entry.pages} 页`;
					checkpointChanged(streamComplete);
				}
				entry.completedStreams = streamIndex + 1;
				entry.streamCheckpoints[stream] = Object.freeze({
					page,
					offset,
					complete: true,
				});
				this.#persist();
			}
			await enrichTopicMetadata();
			await finish(job.restoreCache && networkPages === 0 && totalPages > 0);
		} catch (cause) {
			if (
				controller.signal.aborted ||
				this.scope.destroyed ||
				this.#entries.get(job.username) !== entry ||
				entry.epoch !== epoch
			) return;
			projectRecords(true);
			entry.phase = 'error';
			entry.error = errorMessage(cause);
			entry.recoveryKind = recoveryKind(cause);
			entry.detail = entry.records.length
				? `已保留 ${entry.records.length} 条断点数据`
				: '';
			entry.controller = null;
			this.#persist();
			this.#emit();
			await persistNormalizedCheckpoint();
			this.#notify(`@${job.username} 历史采集失败：${entry.error}`);
			this.#onError(cause);
		}
	}

	#mergeRecords(
		records: Map<string, ReaderUserActivityRecord>,
		incoming: readonly ReaderUserActivityRecord[],
		identitiesByTopic: Map<number, Set<string>>,
	): void {
		for (const activity of incoming) {
			let merged = mergeReaderUserActivityRecord(
				records.get(activity.identity),
				activity,
			);
			if (merged.topicId !== null) {
				const identities = identitiesByTopic.get(merged.topicId) ?? new Set<string>();
				identities.add(merged.identity);
				identitiesByTopic.set(merged.topicId, identities);
			}
			const metadata = readerUserTopicMetadataFromActivity(merged);
			if (metadata) {
				this.#mergeTopicMetadata(records, identitiesByTopic, metadata);
			}
			if (merged.topicId !== null) {
				const known = this.#topicMetadata.get(merged.topicId);
				if (known) merged = mergeReaderUserActivityTopicMetadata(merged, known);
			}
			records.set(merged.identity, merged);
		}
	}

	#mergeTopicMetadata(
		records: Map<string, ReaderUserActivityRecord>,
		identitiesByTopic: Map<number, Set<string>>,
		metadata: ReaderUserTopicMetadata,
	): boolean {
		const previous = this.#topicMetadata.get(metadata.topicId);
		const next = mergeReaderUserTopicMetadata(previous, metadata);
		this.#topicMetadata.set(metadata.topicId, next);
		let changed = next !== previous;
		for (const identity of identitiesByTopic.get(metadata.topicId) ?? []) {
			const current = records.get(identity);
			if (!current) continue;
			const enriched = mergeReaderUserActivityTopicMetadata(current, next);
			if (enriched === current) continue;
			records.set(identity, enriched);
			changed = true;
		}
		return changed;
	}

	#restore(): void {
		try {
			const raw = readReaderAccountScopedString(
				this.#storage,
				this.#storageIdentity,
			);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Readonly<Record<string, unknown>>;
			if (Number(parsed.schemaVersion) !== 1 || !Array.isArray(parsed.users)) {
				return;
			}
			for (const value of parsed.users.slice(0, MAX_OBSERVED_USERS)) {
				const identity = persistedIdentity(value);
				if (!identity || this.#entries.has(identity.username)) continue;
				this.#entries.set(identity.username, {
					...identity,
					streamCheckpoints: { ...identity.streamCheckpoints },
					knownIdentities: new Set<string>(),
					phase: 'idle',
					pages: identity.pages,
					currentStream: null,
					completedStreams: 0,
					storedRecordCount: 0,
					records: Object.freeze([]),
					detail: identity.completedAt
						? '等待从中央缓存恢复'
						: '等待后台采集',
					error: '',
					recoveryKind: null,
					epoch: 0,
					controller: null,
				});
			}
		} catch (cause) {
			this.#onError(cause);
		}
	}

	#trim(): void {
		const ordered = [...this.#entries.values()].sort((left, right) =>
			right.addedAt - left.addedAt);
		const removable = ordered.filter((entry) =>
			entry.username !== this.#selfUsername);
		const keepOthers = Math.max(0, MAX_OBSERVED_USERS - (
			this.#selfUsername && this.#entries.has(this.#selfUsername) ? 1 : 0
		));
		for (const entry of removable.slice(keepOthers)) {
			entry.controller?.abort(
				new DOMException('观察名单超过安全上限', 'AbortError'),
			);
			this.#entries.delete(entry.username);
		}
	}

	#persist(): void {
		try {
			const users = [...this.#entries.values()]
				.sort((left, right) => right.addedAt - left.addedAt)
				.map((entry) => Object.freeze({
					username: entry.username,
					name: entry.name,
					avatarTemplate: entry.avatarTemplate,
					addedAt: entry.addedAt,
					completedAt: entry.completedAt,
					lastRecordCount: entry.lastRecordCount,
					pages: entry.pages,
					streamCheckpoints: entry.streamCheckpoints,
				}));
			this.#storage.setItem(this.#storageIdentity.key, JSON.stringify({
				schemaVersion: 1,
				users,
			}));
		} catch (cause) {
			this.#onError(cause);
			this.#notify('用户观察名单保存失败');
		}
	}

	#entrySnapshot(entry: ObservationEntry): ReaderUserObservationEntrySnapshot {
		const isSelf = entry.username === this.#selfUsername;
		const privateObservation = isSelf
			? this.#selfObservation
			: EMPTY_SELF_OBSERVATION;
		const publicStreams: readonly ReaderUserObservationProgressStreamSnapshot[] =
			Object.freeze(READER_USER_OBSERVATION_STREAMS.map((stream) => {
				const complete = entry.streamCheckpoints[stream]?.complete === true ||
					entry.phase === 'ready';
				const current = entry.currentStream === stream;
				const status: ReaderSelfObservationStreamStatus = complete
					? 'complete'
					: current && [
						'waiting-rate-limit',
						'waiting-challenge',
					].includes(entry.phase)
						? 'waiting'
						: current ? 'loading' : 'idle';
				return Object.freeze({
					stream,
					label: readerUserObservationStreamLabel(stream),
					status,
					progress: complete ? 1 : current ? 0.5 : 0,
					detail: current ? entry.detail : '',
				});
			}));
		const privateStreams: readonly ReaderUserObservationProgressStreamSnapshot[] =
			Object.freeze(privateObservation.streams.map((stream) => Object.freeze({
				stream: stream.stream,
				label: stream.label,
				status: stream.status,
				progress: stream.progress,
				detail: stream.detail,
			})));
		const streams = Object.freeze([...publicStreams, ...privateStreams]);
		const privateCurrent = privateObservation.streams.find((stream) =>
			stream.status !== 'complete');
		const privateError = privateObservation.streams.find((stream) =>
			stream.status === 'error' && stream.error)?.error ?? '';
		let phase = entry.phase;
		if (!isActivePhase(phase) && phase !== 'error' && privateCurrent) {
			phase = privateCurrent.status === 'error'
				? 'error'
				: privateCurrent.status === 'waiting'
					? 'waiting-rate-limit'
					: privateCurrent.status === 'idle' ? 'queued' : 'loading';
		}
		return Object.freeze({
			username: entry.username,
			name: entry.name,
			avatarTemplate: entry.avatarTemplate,
			isSelf,
			phase,
			addedAt: entry.addedAt,
			completedAt: entry.completedAt,
			pages: entry.pages,
			currentStream: entry.currentStream,
			completedStreams: streams.filter((stream) =>
				stream.status === 'complete').length,
			totalStreams: streams.length,
			streams,
			recordCount: Math.max(entry.lastRecordCount, entry.records.length),
			storedRecordCount: entry.storedRecordCount,
			records: entry.records,
			privateRecords: privateObservation.records,
			privateRecordCount: privateObservation.records.length,
			detail: !isActivePhase(entry.phase) && privateCurrent?.detail
				? privateCurrent.detail
				: entry.detail,
			error: entry.error || privateError,
			recoveryKind: entry.recoveryKind,
		});
	}

	#snapshot(): ReaderUserObservationSnapshot {
		return Object.freeze({
			entries: Object.freeze([...this.#entries.values()]
				.sort((left, right) => {
					if (left.username === this.#selfUsername) return -1;
					if (right.username === this.#selfUsername) return 1;
					return right.addedAt - left.addedAt;
				})
				.map((entry) => this.#entrySnapshot(entry))),
			activeUsername: this.#activeUsername,
			topicMetadataRevision: this.#topicMetadataRevision,
			revision: this.#revision,
		});
	}

	#emit(): void {
		this.#revision += 1;
		for (const cause of this.changes.emit(this.#snapshot())) {
			this.#onError(cause);
		}
	}
}
