import {
	discoursePostNumber,
	discourseTopicId,
	type DiscoursePostNumber,
	type DiscourseTopicId,
} from '../discourse/identifiers.js';
import type {
	ReaderHistoryAnchorPoint,
} from '../history/reader-history-model.js';
import type { ReaderWindowGeometry } from '../shell/reader-workspace.js';
import {
	readReaderAccountScopedValue,
	readerAccountScopedStorageIdentity,
	type ReaderAccountScopedStorageIdentity,
} from '../state/reader-account-scoped-storage.js';

export const READER_TOPIC_CONTEXT_STATE_KEY =
	'linuxdo-enhanced-reader:reply-window:v1';

export interface ReaderTopicContextStateStoragePort {
	getValue(key: string): unknown | Promise<unknown>;
	setValue(key: string, value: unknown): void | Promise<void>;
}

export interface ReaderTopicContextStoredState {
	readonly fullPageGeometry: ReaderWindowGeometry | null;
	readonly views: Readonly<Record<string, Readonly<{
		readonly at: number;
		readonly number: DiscoursePostNumber;
		readonly scrollTop: number;
		readonly scrollLeft: number;
		readonly offset: number;
	}>>>;
}

export interface ReaderTopicContextStateRepositoryOptions {
	readonly storage: ReaderTopicContextStateStoragePort;
	readonly key?: string;
	readonly authScope?: string;
	readonly maxViews?: number;
	readonly onError?: (error: unknown) => void;
}

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	if (typeof value === 'string') {
		try {
			return record(JSON.parse(value));
		} catch {
			return null;
		}
	}
	return value && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}

function finite(value: unknown, fallback = 0): number {
	const numeric = Number(value);
	return Number.isFinite(numeric) ? numeric : fallback;
}

function geometry(value: unknown): ReaderWindowGeometry | null {
	const source = record(value);
	if (!source) return null;
	const width = finite(source.width);
	const height = finite(source.height);
	if (!(width > 0) || !(height > 0)) return null;
	return Object.freeze({
		left: finite(source.left),
		top: finite(source.top),
		width,
		height,
	});
}

function anchorPoint(value: unknown): ReaderHistoryAnchorPoint | null {
	const source = record(value);
	if (!source) return null;
	try {
		return Object.freeze({
			number: discoursePostNumber(source.number),
			scrollTop: Math.max(0, finite(source.scrollTop)),
			scrollLeft: Math.max(0, finite(source.scrollLeft)),
			offset: finite(source.offset, 12),
		});
	} catch {
		return null;
	}
}

function viewKey(
	host: string,
	topicId: DiscourseTopicId,
	rootPostNumber: DiscoursePostNumber,
): string {
	return `${String(host).trim()}:${topicId}:${rootPostNumber}:0`;
}

function normalizedState(
	value: unknown,
	maxViews: number,
): ReaderTopicContextStoredState {
	const source = record(value);
	const entries: Array<readonly [string, Readonly<{
		readonly at: number;
		readonly number: DiscoursePostNumber;
		readonly scrollTop: number;
		readonly scrollLeft: number;
		readonly offset: number;
	}>]> = [];
	for (const [key, rawPoint] of Object.entries(record(source?.views) ?? {})) {
		const point = anchorPoint(rawPoint);
		if (!point) continue;
		entries.push(Object.freeze([
			key,
			Object.freeze({
				...point,
				at: Math.max(0, finite(record(rawPoint)?.at)),
			}),
		]));
	}
	entries.sort((left, right) => left[1].at - right[1].at);
	return Object.freeze({
		fullPageGeometry: geometry(source?.fullPageGeometry),
		views: Object.freeze(Object.fromEntries(entries.slice(-maxViews))),
	});
}

/**
 * 完整讨论窗口状态协议的唯一仓储。
 *
 * 只持久化几何与每个讨论根的视口锚点；帖子、父子关系、分页和请求不得进入该记录。
 */
export class ReaderTopicContextStateRepository {
	readonly #storage: ReaderTopicContextStateStoragePort;
	readonly #key: string;
	readonly #accountStorage: ReaderAccountScopedStorageIdentity | null;
	readonly #maxViews: number;
	readonly #onError: (error: unknown) => void;
	#state: ReaderTopicContextStoredState;
	#write: Promise<void> = Promise.resolve();
	#loadPromise: Promise<ReaderTopicContextStoredState> | null = null;

	constructor(options: ReaderTopicContextStateRepositoryOptions) {
		this.#storage = options.storage;
		this.#accountStorage = options.key === undefined && options.authScope !== undefined
			? readerAccountScopedStorageIdentity(
				READER_TOPIC_CONTEXT_STATE_KEY,
				options.authScope,
			)
			: null;
		this.#key = String(options.key ?? this.#accountStorage?.key ??
			READER_TOPIC_CONTEXT_STATE_KEY).trim();
		if (!this.#key) throw new Error('完整讨论状态 storage key 不能为空');
		const maxViews = Math.floor(Number(options.maxViews ?? 128));
		if (!Number.isSafeInteger(maxViews) || maxViews < 1) {
			throw new RangeError('完整讨论持久锚点上限必须是正整数');
		}
		this.#maxViews = maxViews;
		this.#onError = options.onError ?? (() => {});
		this.#state = normalizedState(null, maxViews);
	}

	get snapshot(): ReaderTopicContextStoredState {
		return this.#state;
	}

	load(): Promise<ReaderTopicContextStoredState> {
		if (this.#loadPromise) return this.#loadPromise;
		this.#loadPromise = (async () => {
			try {
				const loaded = normalizedState(
					this.#accountStorage
						? await readReaderAccountScopedValue(
							this.#storage,
							this.#accountStorage,
						)
						: await this.#storage.getValue(this.#key),
					this.#maxViews,
				);
				const current = this.#state;
				const hasLocalState =
					current.fullPageGeometry !== null ||
					Object.keys(current.views).length > 0;
				this.#state = normalizedState({
					fullPageGeometry:
						current.fullPageGeometry ?? loaded.fullPageGeometry,
					views: {
						...loaded.views,
						...current.views,
					},
				}, this.#maxViews);
				if (hasLocalState) this.#persist();
			} catch (error) {
				this.#onError(error);
			}
			return this.#state;
		})();
		return this.#loadPromise;
	}

	point(
		host: string,
		topicIdValue: number,
		rootPostNumberValue: number,
	): ReaderHistoryAnchorPoint | null {
		const topicId = discourseTopicId(topicIdValue);
		const rootPostNumber = discoursePostNumber(rootPostNumberValue);
		const value = this.#state.views[viewKey(host, topicId, rootPostNumber)];
		return value
			? Object.freeze({
				number: value.number,
				scrollTop: value.scrollTop,
				scrollLeft: value.scrollLeft,
				offset: value.offset,
			})
			: null;
	}

	rememberGeometry(value: ReaderWindowGeometry): void {
		const nextGeometry = geometry(value);
		if (!nextGeometry) return;
		this.#state = Object.freeze({
			...this.#state,
			fullPageGeometry: nextGeometry,
		});
		this.#persist();
	}

	rememberPoint(
		host: string,
		topicIdValue: number,
		rootPostNumberValue: number,
		point: ReaderHistoryAnchorPoint | null,
		now = Date.now(),
	): void {
		if (!point) return;
		const topicId = discourseTopicId(topicIdValue);
		const rootPostNumber = discoursePostNumber(rootPostNumberValue);
		const key = viewKey(host, topicId, rootPostNumber);
		const entries = Object.entries(this.#state.views).filter(
			([entryKey]) => entryKey !== key,
		);
		entries.push([
			key,
			Object.freeze({
				...point,
				at: Math.max(0, finite(now)),
			}),
		]);
		const views = Object.fromEntries(entries);
		this.#state = normalizedState({
			fullPageGeometry: this.#state.fullPageGeometry,
			views,
		}, this.#maxViews);
		this.#persist();
	}

	replaceExternal(value: unknown): ReaderTopicContextStoredState {
		this.#state = normalizedState(value, this.#maxViews);
		this.#persist();
		return this.#state;
	}

	async flush(): Promise<void> {
		await this.#write;
	}

	#persist(): void {
		const state = this.#state;
		this.#write = this.#write
			.catch(() => {})
			.then(async () => {
				try {
					await this.#storage.setValue(
						this.#key,
						state,
					);
				} catch (error) {
					this.#onError(error);
				}
			});
	}
}

export function readerTopicContextWebStorage(
	storage: Pick<Storage, 'getItem' | 'setItem'>,
): ReaderTopicContextStateStoragePort {
	return Object.freeze({
		getValue: (key: string) => storage.getItem(key),
		setValue: (key: string, value: unknown) => {
			storage.setItem(key, JSON.stringify(value));
		},
	});
}
