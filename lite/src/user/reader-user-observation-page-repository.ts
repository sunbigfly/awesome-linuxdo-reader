import type {
	ResponseCacheFlightPort,
	ResponseCacheInvalidation,
	ResponseCachePolicy,
	ResponseRepository,
} from '../cache/response-repository.js';
import {
	mergeReaderUserActivityTopicMetadata,
	mergeReaderUserActivityRecord,
	mergeReaderUserTopicMetadata,
	sortReaderUserActivities,
	type ReaderUserActivityKind,
	type ReaderUserActivityRecord,
	type ReaderUserTopicMetadata,
} from './reader-user-observation-model.js';

export interface ReaderUserObservationStoredPage {
	readonly page: number;
	readonly total: number;
	readonly records: readonly ReaderUserActivityRecord[];
}

export type ReaderUserObservationStoredTab =
	| 'all'
	| 'reaction-like'
	| 'other-actions'
	| ReaderUserActivityKind;

export interface ReaderUserObservationStoredSummary {
	readonly total: number;
	readonly pages: number;
	readonly counts: Readonly<Partial<Record<ReaderUserActivityKind, number>>>;
	readonly reactionLikeCount: number;
	readonly complete: boolean;
}

export interface ReaderUserObservationStoredIdentityIndex {
	readonly total: number;
	readonly identities: readonly string[];
	readonly complete: boolean;
}

export interface ReaderUserObservationStoredFacet {
	readonly value: string;
	readonly label: string;
	readonly count: number;
}

export interface ReaderUserObservationStoredWindow {
	readonly generation: string;
	readonly page: number;
	readonly pageSize: number;
	readonly total: number;
	readonly records: readonly ReaderUserActivityRecord[];
}

export interface ReaderUserObservationStoredQuery {
	readonly tab: ReaderUserObservationStoredTab;
	readonly page: number;
	readonly pageSize: number;
	readonly query?: string;
	readonly category?: string;
	readonly tag?: string;
	readonly from?: number | null;
	readonly to?: number | null;
	readonly sort?: 'time' | 'replies' | 'views';
	readonly direction?: 'asc' | 'desc';
}

interface ReaderUserObservationStoredIndexEntry {
	readonly identity: string;
	readonly page: number;
	readonly slot: number;
	readonly kind: ReaderUserActivityKind;
	readonly category: string;
	readonly categoryLabel: string;
	readonly tags: readonly string[];
	readonly tagLabels: readonly string[];
	readonly createdAt: number;
	readonly replies: number | null;
	readonly views: number | null;
	readonly searchText: string;
	/** v2 早期 manifest 没有这两个字段，读取时按未补齐处理。 */
	readonly topicId?: number | null;
	readonly topicMetadataComplete?: boolean;
}

interface ReaderUserObservationStoredManifest {
	readonly schemaVersion: 2;
	readonly username: string;
	readonly generation: string;
	readonly pageSize: number;
	readonly total: number;
	readonly pages: number;
	readonly counts: Readonly<Partial<Record<ReaderUserActivityKind, number>>>;
	readonly reactionLikeCount: number;
	readonly index: readonly ReaderUserObservationStoredIndexEntry[];
	readonly updatedAt: number;
	/** 缺省为 true，兼容引入断点快照前已提交的 v1/v2 manifest。 */
	readonly complete?: boolean;
	/** 只有逐页从 IndexedDB 回读一致后才写为 true。 */
	readonly persistentVerified?: boolean;
}

const PAGE_SIZE = 60;
const IO_BATCH_SIZE = 6;
const POLICY_AGE = Number.MAX_SAFE_INTEGER;
const LEGACY_GENERATION = 'legacy-v1';

function username(value: string): string {
	const result = String(value).trim().replace(/^@/, '').toLocaleLowerCase();
	if (!result) throw new Error('观察用户 username 不能为空');
	return result;
}

function scopeToken(value: string): string {
	const scope = String(value).trim();
	if (!scope) throw new Error('用户观察 authScope 不能为空');
	return encodeURIComponent(scope);
}

function userToken(value: string): string {
	return encodeURIComponent(username(value));
}

function policy(
	authScope: string,
	usernameValue: string,
	part: 'manifest' | 'page',
	page = 0,
	generation = '',
): ResponseCachePolicy {
	const scope = scopeToken(authScope);
	const user = userToken(usernameValue);
	return Object.freeze({
		id: part === 'manifest'
			? `reader-user-observation:manifest:v1:${scope}:${user}`
			: generation === LEGACY_GENERATION
				? `reader-user-observation:page:v1:${scope}:${user}:${page}`
				: `reader-user-observation:page:v2:${scope}:${user}:` +
					`${encodeURIComponent(generation)}:${page}`,
		kind: 'user-observation-history',
		tags: Object.freeze([
			'users',
			'user-observation-history',
			`user-observation-history:scope:${scope}`,
			`user-observation-history:user:${user}`,
		]),
		freshForMs: POLICY_AGE,
		retainForMs: POLICY_AGE,
		persist: true,
		permanent: true,
	});
}

function manifestValue(value: unknown): ReaderUserObservationStoredManifest | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
	const source = value as Partial<ReaderUserObservationStoredManifest>;
	const legacy = Number(source.schemaVersion) === 1;
	if (
		(!legacy && source.schemaVersion !== 2) ||
		typeof source.username !== 'string' ||
		(!legacy && (typeof source.generation !== 'string' || !source.generation)) ||
		source.pageSize !== PAGE_SIZE ||
		!Number.isSafeInteger(source.total) ||
		!Number.isSafeInteger(source.pages) ||
		!Array.isArray(source.index)
	) return null;
	return Object.freeze({
		...source,
		schemaVersion: 2 as const,
		generation: legacy ? LEGACY_GENERATION : source.generation,
		complete: source.complete !== false,
	}) as ReaderUserObservationStoredManifest;
}

function categoryKey(record: ReaderUserActivityRecord): string {
	if (record.categoryId !== null) return `category:${record.categoryId}`;
	const name = record.categoryName.trim().toLocaleLowerCase('zh-CN');
	return name ? `category-name:${name}` : '';
}

function tagKey(value: string): string {
	const tag = value.trim().toLocaleLowerCase('zh-CN');
	return tag ? `tag:${tag}` : '';
}

function storedIndexEntry(
	record: ReaderUserActivityRecord,
	page: number,
	slot: number,
): ReaderUserObservationStoredIndexEntry {
	return Object.freeze({
		identity: record.identity,
		page,
		slot,
		kind: record.kind,
		category: categoryKey(record),
		categoryLabel: record.categoryName ||
			(record.categoryId === null ? '' : `类别 #${record.categoryId}`),
		tags: Object.freeze(record.tags.map(tagKey).filter(Boolean)),
		tagLabels: Object.freeze([...record.tags]),
		createdAt: Date.parse(record.createdAt) || 0,
		replies: record.topicReplyCount,
		views: record.topicViewCount,
		searchText: record.searchText,
		topicId: record.topicId,
		topicMetadataComplete: record.topicMetadataComplete === true,
	});
}

function localDateKey(timestamp: number): string {
	if (!Number.isFinite(timestamp) || timestamp <= 0) return '';
	const date = new Date(timestamp);
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, '0');
	const day = String(date.getDate()).padStart(2, '0');
	return `${year}-${month}-${day}`;
}

export function readerUserObservationStoredTabIncludesKind(
	kind: ReaderUserActivityKind,
	tab: ReaderUserObservationStoredTab,
): boolean {
	if (tab === 'all') return true;
	if (tab === 'reaction-like') {
		return kind === 'reaction' || kind === 'like';
	}
	if (tab === 'other-actions') {
		return [
			'assigned',
			'solved',
			'vote',
			'liked',
			'response',
			'quote',
			'other',
		].includes(kind);
	}
	return kind === tab;
}

function belongsToTab(
	entry: ReaderUserObservationStoredIndexEntry,
	tab: ReaderUserObservationStoredTab,
): boolean {
	return readerUserObservationStoredTabIncludesKind(entry.kind, tab);
}

function yieldMainThread(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * 用户观察已归一化历史的 IndexedDB 分页 owner。
 *
 * 原始 Discourse 响应仍由中央 collection cache 保存；这里仅保存去重、分类和标签已合并
 * 的轻量页面，窗口按页读取，不需要把上万条记录重新装入 session/DOM。
 */
export class ReaderUserObservationPageRepository {
	readonly #responses: ResponseRepository;
	readonly #authScope: string;
	readonly #coordination: Pick<
		ResponseCacheFlightPort,
		'acquireFlight' | 'renewFlight' | 'releaseFlight' | 'waitForFlight'
	> | undefined;
	readonly #writes = new Map<string, Promise<unknown>>();
	readonly #generationNonce = Math.random().toString(36).slice(2);
	#generation = 0;

	constructor(
		responses: ResponseRepository,
		authScope: string,
		coordination?: Pick<
			ResponseCacheFlightPort,
			'acquireFlight' | 'renewFlight' | 'releaseFlight' | 'waitForFlight'
		>,
	) {
		this.#responses = responses;
		this.#authScope = String(authScope).trim();
		if (!this.#authScope) throw new Error('用户观察 authScope 不能为空');
		this.#coordination = coordination;
	}

	write(
		usernameValue: string,
		records: readonly ReaderUserActivityRecord[],
		updatedAt = Date.now(),
		mergeStored = true,
		topicMetadata: readonly ReaderUserTopicMetadata[] = Object.freeze([]),
		complete = true,
	): Promise<void> {
		const owner = username(usernameValue);
		return this.#enqueueMutation(owner, () => this.#commitWrite(
			owner,
			records,
			updatedAt,
			mergeStored,
			topicMetadata,
			complete,
		));
	}

	async #commitWrite(
		owner: string,
		records: readonly ReaderUserActivityRecord[],
		updatedAt: number,
		mergeStored: boolean,
		topicMetadata: readonly ReaderUserTopicMetadata[],
		complete: boolean,
	): Promise<void> {
		const manifestPolicy = policy(this.#authScope, owner, 'manifest');
		this.#responses.forgetMemory({ ids: [manifestPolicy.id] });
		const previousRead = await this.#responses.read<ReaderUserObservationStoredManifest>(
			manifestPolicy,
		);
		const previous = manifestValue(previousRead.value);
		let committedRecords = records;
		if (mergeStored && previous?.pages) {
			const merged = new Map<string, ReaderUserActivityRecord>();
			for (let start = 0; start < previous.pages; start += IO_BATCH_SIZE) {
				const storedPages = await Promise.all(Array.from(
					{ length: Math.min(IO_BATCH_SIZE, previous.pages - start) },
					(_, indexValue) => this.#readPhysicalPage(
						owner,
						previous,
						start + indexValue,
						true,
					),
				));
				for (const storedPage of storedPages) {
					for (const record of storedPage?.records ?? []) {
						merged.set(record.identity, record);
					}
				}
				if (start + IO_BATCH_SIZE < previous.pages) await yieldMainThread();
			}
			for (const record of records) {
				merged.set(
					record.identity,
					mergeReaderUserActivityRecord(merged.get(record.identity), record),
				);
			}
			committedRecords = sortReaderUserActivities([...merged.values()]);
		}
		if (topicMetadata.length) {
			const metadataByTopic = new Map<number, ReaderUserTopicMetadata>();
			for (const metadata of topicMetadata) {
				const topicId = Number(metadata.topicId);
				if (!Number.isSafeInteger(topicId) || topicId < 1) continue;
				metadataByTopic.set(
					topicId,
					mergeReaderUserTopicMetadata(metadataByTopic.get(topicId), metadata),
				);
			}
			committedRecords = committedRecords.map((entry) => {
				const metadata = entry.topicId === null
					? undefined
					: metadataByTopic.get(entry.topicId);
				return metadata
					? mergeReaderUserActivityTopicMetadata(entry, metadata)
					: entry;
			});
		}
		committedRecords = sortReaderUserActivities(committedRecords);
		const generation = `${Math.max(0, Math.floor(updatedAt)).toString(36)}-` +
			`${this.#generationNonce}-` +
			`${(++this.#generation).toString(36)}`;
		const pages = Math.ceil(committedRecords.length / PAGE_SIZE);
		const counts: Partial<Record<ReaderUserActivityKind, number>> = {};
		let reactionLikeCount = 0;
		const index: ReaderUserObservationStoredIndexEntry[] = [];
		for (const [recordIndex, record] of committedRecords.entries()) {
			counts[record.kind] = (counts[record.kind] ?? 0) + 1;
			if (record.kind === 'reaction' || record.kind === 'like') {
				reactionLikeCount += 1;
			}
			index.push(storedIndexEntry(
				record,
				Math.floor(recordIndex / PAGE_SIZE),
				recordIndex % PAGE_SIZE,
			));
		}
		for (let start = 0; start < pages; start += IO_BATCH_SIZE) {
			await Promise.all(Array.from(
				{ length: Math.min(IO_BATCH_SIZE, pages - start) },
				(_, indexValue) => {
					const page = start + indexValue;
					return this.#responses.write(
						policy(this.#authScope, owner, 'page', page, generation),
						Object.freeze({
							schemaVersion: 2 as const,
							generation,
							page,
							records: Object.freeze(committedRecords.slice(
								page * PAGE_SIZE,
								(page + 1) * PAGE_SIZE,
							)),
						}),
						{ publish: false },
					);
				},
			));
			if (start + IO_BATCH_SIZE < pages) await yieldMainThread();
		}
		await this.#responses.write<ReaderUserObservationStoredManifest>(
			manifestPolicy,
			Object.freeze({
				schemaVersion: 2,
				username: owner,
				generation,
				pageSize: PAGE_SIZE,
				total: committedRecords.length,
				pages,
				counts: Object.freeze({ ...counts }),
				reactionLikeCount,
				index: Object.freeze(index),
				updatedAt,
				complete,
				persistentVerified: false,
			}),
		);
		if (previous && previous.generation !== generation && previous.pages > 0) {
			await this.#responses.prune(Object.freeze({
				ids: Object.freeze(Array.from({ length: previous.pages }, (_, page) =>
					policy(
						this.#authScope,
						owner,
						'page',
						page,
						previous.generation,
					).id)),
			}));
		}
	}

	async summary(
		usernameValue: string,
	): Promise<ReaderUserObservationStoredSummary | null> {
		const owner = username(usernameValue);
		const cached = await this.#responses.read<ReaderUserObservationStoredManifest>(
			policy(this.#authScope, owner, 'manifest'),
		);
		const manifest = manifestValue(cached.value);
		return manifest ? Object.freeze({
			total: manifest.total,
			pages: manifest.pages,
			counts: manifest.counts,
			reactionLikeCount: manifest.reactionLikeCount,
			complete: manifest.complete !== false,
		}) : null;
	}

	async identityIndex(
		usernameValue: string,
	): Promise<ReaderUserObservationStoredIdentityIndex | null> {
		const owner = username(usernameValue);
		const cached = await this.#responses.read<ReaderUserObservationStoredManifest>(
			policy(this.#authScope, owner, 'manifest'),
		);
		const manifest = manifestValue(cached.value);
		return manifest ? Object.freeze({
			total: manifest.total,
			identities: Object.freeze(manifest.index.map((entry) => entry.identity)),
			complete: manifest.complete !== false,
		}) : null;
	}

	/**
	 * 只接受 IndexedDB 中可逐页回读的完整世代；当前标签页 memory LRU 命中不能
	 * 代替落盘成功。采集 session 只有通过这里才能提交 ready。
	 */
	persistentIdentityIndex(
		usernameValue: string,
	): Promise<ReaderUserObservationStoredIdentityIndex | null> {
		const owner = username(usernameValue);
		return this.#enqueueMutation(
			owner,
			() => this.#persistentIdentityIndex(owner),
		);
	}

	async #persistentIdentityIndex(
		owner: string,
	): Promise<ReaderUserObservationStoredIdentityIndex | null> {
		const manifestRead = await this.#responses
			.readPersistent<ReaderUserObservationStoredManifest>(
				policy(this.#authScope, owner, 'manifest'),
			);
		const manifest = manifestValue(manifestRead.value);
		if (
			!manifest || manifest.complete === false ||
			manifest.pages !== Math.ceil(manifest.total / PAGE_SIZE) ||
			manifest.index.length !== manifest.total
		) return null;
		const indexedIdentities = manifest.index.map((entry) => entry.identity);
		if (new Set(indexedIdentities).size !== manifest.total) return null;
		if (manifest.persistentVerified === true) {
			return Object.freeze({
				total: manifest.total,
				identities: Object.freeze(indexedIdentities),
				complete: true,
			});
		}
		const identities: string[] = [];
		const uniqueIdentities = new Set<string>();
		const counts: Partial<Record<ReaderUserActivityKind, number>> = {};
		let reactionLikeCount = 0;
		for (let start = 0; start < manifest.pages; start += IO_BATCH_SIZE) {
			const pages = await Promise.all(Array.from(
				{ length: Math.min(IO_BATCH_SIZE, manifest.pages - start) },
				(_, indexValue) => this.#readPhysicalPage(
					owner,
					manifest,
					start + indexValue,
					true,
				),
			));
			for (const [pageOffset, storedPage] of pages.entries()) {
				const page = start + pageOffset;
				const expectedLength = Math.min(
					PAGE_SIZE,
					Math.max(0, manifest.total - page * PAGE_SIZE),
				);
				if (!storedPage || storedPage.records.length !== expectedLength) return null;
				for (const [slot, record] of storedPage.records.entries()) {
					const indexEntry = manifest.index[page * PAGE_SIZE + slot];
					if (
						!indexEntry || indexEntry.identity !== record.identity ||
						indexEntry.page !== page || indexEntry.slot !== slot ||
						indexEntry.kind !== record.kind ||
						uniqueIdentities.has(record.identity)
					) return null;
					uniqueIdentities.add(record.identity);
					identities.push(record.identity);
					counts[record.kind] = (counts[record.kind] ?? 0) + 1;
					if (record.kind === 'reaction' || record.kind === 'like') {
						reactionLikeCount += 1;
					}
				}
			}
			if (start + IO_BATCH_SIZE < manifest.pages) await yieldMainThread();
		}
		const kinds = new Set<ReaderUserActivityKind>([
			...(Object.keys(manifest.counts) as ReaderUserActivityKind[]),
			...(Object.keys(counts) as ReaderUserActivityKind[]),
		]);
		if (
			identities.length !== manifest.total ||
			reactionLikeCount !== manifest.reactionLikeCount ||
			[...kinds].some((kind) =>
				(counts[kind] ?? 0) !== (manifest.counts[kind] ?? 0))
		) return null;
		await this.#responses.write<ReaderUserObservationStoredManifest>(
			policy(this.#authScope, owner, 'manifest'),
			Object.freeze({ ...manifest, persistentVerified: true }),
		);
		const verifiedRead = await this.#responses
			.readPersistent<ReaderUserObservationStoredManifest>(
				policy(this.#authScope, owner, 'manifest'),
			);
		const verified = manifestValue(verifiedRead.value);
		if (
			!verified || verified.generation !== manifest.generation ||
			verified.persistentVerified !== true
		) return null;
		return Object.freeze({
			total: manifest.total,
			identities: Object.freeze(identities),
			complete: true,
		});
	}

	/** 返回仍无法区分“无标签”和“尚未补齐”的 Topic；不读取网络。 */
	async topicMetadataCandidates(
		usernameValue: string,
	): Promise<readonly number[]> {
		const owner = username(usernameValue);
		const cached = await this.#responses.read<ReaderUserObservationStoredManifest>(
			policy(this.#authScope, owner, 'manifest'),
		);
		const manifest = manifestValue(cached.value);
		if (!manifest) return Object.freeze([]);
		const candidates = new Set<number>();
		const indexed = manifest.index.every((entry) =>
			entry.topicId !== undefined &&
			typeof entry.topicMetadataComplete === 'boolean');
		if (indexed) {
			for (const entry of manifest.index) {
				const topicId = Number(entry.topicId);
				if (
					entry.topicMetadataComplete !== true &&
					Number.isSafeInteger(topicId) && topicId > 0
				) candidates.add(topicId);
			}
		} else {
			for (let start = 0; start < manifest.pages; start += IO_BATCH_SIZE) {
				const pages = await Promise.all(Array.from(
					{ length: Math.min(IO_BATCH_SIZE, manifest.pages - start) },
					(_, indexValue) => this.#readPhysicalPage(
						owner,
						manifest,
						start + indexValue,
					),
				));
				for (const page of pages) {
					for (const entry of page?.records ?? []) {
						const topicId = Number(entry.topicId);
						if (
							Number.isSafeInteger(topicId) && topicId > 0 &&
							entry.topicMetadataComplete !== true
						) candidates.add(topicId);
					}
				}
				if (start + IO_BATCH_SIZE < manifest.pages) await yieldMainThread();
			}
		}
		return Object.freeze([...candidates].sort((left, right) => left - right));
	}

	/**
	 * 只改写命中 topicId 的物理页与 manifest 索引；打开一个 Topic 不得重写该用户的
	 * 整份公开历史。记录 identity、顺序和分页代际保持不变。
	 */
	mergeTopicMetadata(
		usernameValue: string,
		metadata: ReaderUserTopicMetadata,
	): Promise<boolean> {
		const owner = username(usernameValue);
		return this.#enqueueMutation(
			owner,
			() => this.#mergeTopicMetadata(owner, metadata),
		);
	}

	async #mergeTopicMetadata(
		owner: string,
		metadata: ReaderUserTopicMetadata,
	): Promise<boolean> {
		const manifestPolicy = policy(this.#authScope, owner, 'manifest');
		this.#responses.forgetMemory({ ids: [manifestPolicy.id] });
		const topicId = Number(metadata.topicId);
		if (!Number.isSafeInteger(topicId) || topicId < 1) return false;
		const manifestRead = await this.#responses.read<ReaderUserObservationStoredManifest>(
			manifestPolicy,
		);
		const manifest = manifestValue(manifestRead.value);
		if (!manifest) return false;
		const indexedTopicIds = manifest.index.every((entry) =>
			entry.topicId !== undefined);
		const pageNumbers = indexedTopicIds
			? [...new Set(manifest.index
				.filter((entry) => entry.topicId === topicId)
				.map((entry) => entry.page))]
			: Array.from({ length: manifest.pages }, (_, page) => page);
		if (!pageNumbers.length) return false;
		const nextIndex = [...manifest.index];
		let changed = false;
		for (let start = 0; start < pageNumbers.length; start += IO_BATCH_SIZE) {
			await Promise.all(pageNumbers.slice(start, start + IO_BATCH_SIZE).map(
				async (page) => {
					const storedPage = await this.#readPhysicalPage(
						owner,
						manifest,
						page,
						true,
					);
					if (!storedPage) return;
					let pageChanged = false;
					const records = storedPage.records.map((record, slot) => {
						if (record.topicId !== topicId) return record;
						const next = mergeReaderUserActivityTopicMetadata(record, metadata);
						if (next === record) return record;
						pageChanged = true;
						changed = true;
						nextIndex[page * PAGE_SIZE + slot] = storedIndexEntry(
							next,
							page,
							slot,
						);
						return next;
					});
					if (!pageChanged) return;
					const legacy = manifest.generation === LEGACY_GENERATION;
					await this.#responses.write(
						policy(this.#authScope, owner, 'page', page, manifest.generation),
						legacy
							? Object.freeze({
								schemaVersion: 1 as const,
								page,
								records: Object.freeze(records),
							})
							: Object.freeze({
								schemaVersion: 2 as const,
								generation: manifest.generation,
								page,
								records: Object.freeze(records),
							}),
					);
				},
			));
			if (start + IO_BATCH_SIZE < pageNumbers.length) await yieldMainThread();
		}
		if (!changed) return false;
		await this.#responses.write<ReaderUserObservationStoredManifest>(
			manifestPolicy,
			Object.freeze({
				...manifest,
				index: Object.freeze(nextIndex),
			}),
		);
		return true;
	}

	async facets(
		usernameValue: string,
		tab: ReaderUserObservationStoredTab,
	): Promise<Readonly<{
		readonly categories: readonly ReaderUserObservationStoredFacet[];
		readonly tags: readonly ReaderUserObservationStoredFacet[];
		readonly days: readonly ReaderUserObservationStoredFacet[];
	}> | null> {
		const owner = username(usernameValue);
		const cached = await this.#responses.read<ReaderUserObservationStoredManifest>(
			policy(this.#authScope, owner, 'manifest'),
		);
		const manifest = manifestValue(cached.value);
		if (!manifest) return null;
		const categories = new Map<string, ReaderUserObservationStoredFacet>();
		const tags = new Map<string, ReaderUserObservationStoredFacet>();
		const days = new Map<string, ReaderUserObservationStoredFacet>();
		for (const entry of manifest.index) {
			if (!belongsToTab(entry, tab)) continue;
			const day = localDateKey(entry.createdAt);
			if (day) {
				const current = days.get(day);
				days.set(day, Object.freeze({
					value: day,
					label: day,
					count: (current?.count ?? 0) + 1,
				}));
			}
			if (entry.category) {
				const current = categories.get(entry.category);
				categories.set(entry.category, Object.freeze({
					value: entry.category,
					label: entry.categoryLabel,
					count: (current?.count ?? 0) + 1,
				}));
			}
			for (const [index, value] of entry.tags.entries()) {
				const current = tags.get(value);
				tags.set(value, Object.freeze({
					value,
					label: entry.tagLabels[index] ?? value.replace(/^tag:/, ''),
					count: (current?.count ?? 0) + 1,
				}));
			}
		}
		const ordered = (values: ReadonlyMap<string, ReaderUserObservationStoredFacet>) =>
			Object.freeze([...values.values()].sort((left, right) =>
				right.count - left.count || left.label.localeCompare(right.label, 'zh-CN')));
		return Object.freeze({
			categories: ordered(categories),
			tags: ordered(tags),
			days: Object.freeze([...days.values()].sort((left, right) =>
				left.value.localeCompare(right.value))),
		});
	}

	async readWindow(
		usernameValue: string,
		query: ReaderUserObservationStoredQuery,
	): Promise<ReaderUserObservationStoredWindow | null> {
		const owner = username(usernameValue);
		const cached = await this.#responses.read<ReaderUserObservationStoredManifest>(
			policy(this.#authScope, owner, 'manifest'),
		);
		const manifest = manifestValue(cached.value);
		if (!manifest) return null;
		const search = String(query.query ?? '').trim().toLocaleLowerCase('zh-CN');
		const category = String(query.category ?? '');
		const tag = String(query.tag ?? '');
		const from = Number.isFinite(query.from) ? Number(query.from) : null;
		const to = Number.isFinite(query.to) ? Number(query.to) : null;
		const sort = query.sort ?? 'time';
		const direction = query.direction ?? 'desc';
		const page = Math.max(0, Math.floor(query.page));
		const pageSize = Math.max(1, Math.min(120, Math.floor(query.pageSize)));
		const filtered = manifest.index.filter((entry) =>
			belongsToTab(entry, query.tab) &&
			(!search || entry.searchText.includes(search)) &&
			(!category || entry.category === category) &&
			(!tag || entry.tags.includes(tag)) &&
			(from === null || entry.createdAt >= from) &&
			(to === null || entry.createdAt < to));
		const metric = (entry: ReaderUserObservationStoredIndexEntry): number | null =>
			sort === 'replies' ? entry.replies : sort === 'views' ? entry.views : entry.createdAt;
		if (sort !== 'time' || direction !== 'desc') {
			filtered.sort((left, right) => {
				const leftMetric = metric(left);
				const rightMetric = metric(right);
				if (leftMetric === null && rightMetric !== null) return 1;
				if (leftMetric !== null && rightMetric === null) return -1;
				if (
					leftMetric !== null && rightMetric !== null &&
					leftMetric !== rightMetric
				) {
					return direction === 'asc'
						? leftMetric - rightMetric
						: rightMetric - leftMetric;
				}
				return right.createdAt - left.createdAt ||
					left.identity.localeCompare(right.identity);
			});
		}
		const refs = filtered.slice(page * pageSize, (page + 1) * pageSize);
		const physicalPages = new Map<number, ReaderUserObservationStoredPage>();
		const referencedPages = [...new Set(refs.map((entry) => entry.page))];
		for (let start = 0; start < referencedPages.length; start += IO_BATCH_SIZE) {
			await Promise.all(referencedPages
				.slice(start, start + IO_BATCH_SIZE)
				.map(async (physicalPage) => {
					const value = await this.#readPhysicalPage(owner, manifest, physicalPage);
					if (value) physicalPages.set(physicalPage, value);
				}));
			if (start + IO_BATCH_SIZE < referencedPages.length) {
				await yieldMainThread();
			}
		}
		return Object.freeze({
			generation: manifest.generation,
			page,
			pageSize,
			total: filtered.length,
			records: Object.freeze(refs.flatMap((entry) => {
				const record = physicalPages.get(entry.page)?.records[entry.slot];
				return record?.identity === entry.identity ? [record] : [];
			})),
		});
	}

	async readPage(
		usernameValue: string,
		pageValue: number,
	): Promise<ReaderUserObservationStoredPage | null> {
		const owner = username(usernameValue);
		const page = Math.max(0, Math.floor(pageValue));
		const manifestRead = await this.#responses.read<ReaderUserObservationStoredManifest>(
			policy(this.#authScope, owner, 'manifest'),
		);
		const manifest = manifestValue(manifestRead.value);
		if (!manifest || page >= manifest.pages) return null;
		return this.#readPhysicalPage(owner, manifest, page);
	}

	async #readPhysicalPage(
		owner: string,
		manifest: ReaderUserObservationStoredManifest,
		page: number,
		persistent = false,
	): Promise<ReaderUserObservationStoredPage | null> {
		const pagePolicy = policy(
			this.#authScope,
			owner,
			'page',
			page,
			manifest.generation,
		);
		const pageRead = await (persistent
			? this.#responses.readPersistent<Readonly<{
				readonly schemaVersion: 1 | 2;
				readonly generation?: string;
				readonly page: number;
				readonly records: readonly ReaderUserActivityRecord[];
			}>>(pagePolicy)
			: this.#responses.read<Readonly<{
			readonly schemaVersion: 1 | 2;
			readonly generation?: string;
			readonly page: number;
			readonly records: readonly ReaderUserActivityRecord[];
		}>>(pagePolicy));
		const value = pageRead.value;
		const legacy = manifest.generation === LEGACY_GENERATION;
		if (
			!value ||
			(legacy ? value.schemaVersion !== 1 : (
				value.schemaVersion !== 2 || value.generation !== manifest.generation
			)) || value.page !== page ||
			!Array.isArray(value.records)
		) return null;
		return Object.freeze({
			page,
			total: manifest.total,
			records: Object.freeze([...value.records]),
		});
	}

	#enqueueMutation<T>(owner: string, operation: () => Promise<T>): Promise<T> {
		const previous = this.#writes.get(owner) ?? Promise.resolve();
		const queued = previous.catch(() => {}).then(() =>
			this.#withWriteLease(owner, operation));
		this.#writes.set(owner, queued);
		void queued.finally(() => {
			if (this.#writes.get(owner) === queued) this.#writes.delete(owner);
		}).catch(() => {});
		return queued;
	}

	async #withWriteLease<T>(
		owner: string,
		operation: () => Promise<T>,
	): Promise<T> {
		const coordination = this.#coordination;
		if (!coordination) return operation();
		const token = `reader-user-observation-write:v1:${
			policy(this.#authScope, owner, 'manifest').id}`;
		while (true) {
			const lease = await coordination.acquireFlight(token);
			if (!lease.producer) {
				await coordination.waitForFlight(token);
				continue;
			}
			const heartbeat = lease.coordinated
				? setInterval(() => {
					void coordination.renewFlight(lease).catch(() => {});
				}, 10_000)
				: null;
			try {
				return await operation();
			} finally {
				if (heartbeat !== null) clearInterval(heartbeat);
				await coordination.releaseFlight(lease);
			}
		}
	}

	remove(usernameValue: string): Promise<void> {
		const owner = username(usernameValue);
		return this.#enqueueMutation(owner, () => this.#responses.invalidate(
			Object.freeze({
				tags: Object.freeze([
					`user-observation-history:user:${userToken(owner)}`,
				]),
			}),
		));
	}

	static cleanupQuery(authScope: string): ResponseCacheInvalidation {
		return Object.freeze({
			tags: Object.freeze([
				`user-observation-history:scope:${scopeToken(authScope)}`,
			]),
		});
	}
}
