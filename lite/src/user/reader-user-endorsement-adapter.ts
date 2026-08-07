import {
	DiscourseNativeRequests,
} from '../discourse/native-request-descriptors.js';
import type {
	DomainResponseCacheSettings,
	UserResourceRequest,
} from '../network/domain-request-gateway.js';
import type {
	DiscourseNativeReadTransport,
} from '../network/discourse-native-read-transport.js';
import { objectRecord as record } from '../kernel/value-record.js';

export interface ReaderEndorsableCategory {
	readonly id: number;
	readonly name: string;
}

export interface ReaderEndorsementCatalog {
	readonly categories: readonly ReaderEndorsableCategory[];
	readonly remainingEndorsements: number | null;
}

export interface ReaderUserEndorsementGateway {
	loadUserResource<T>(input: UserResourceRequest<T>): Promise<T>;
}

export interface ReaderUserEndorsementAdapterOptions {
	readonly gateway: ReaderUserEndorsementGateway;
	readonly transport: DiscourseNativeReadTransport;
	readonly authScope: string;
}

function username(value: unknown): string {
	const normalized = String(value ?? '').trim().replace(/^@+/, '');
	if (!normalized) throw new Error('username 不能为空');
	return normalized;
}

function project(value: unknown): ReaderEndorsementCatalog {
	const source = record(value);
	const categories = Array.isArray(source?.categories)
		? source.categories
			.map((candidate) => {
				const item = record(candidate);
				const id = Number(item?.id);
				if (!Number.isSafeInteger(id) || id <= 0) return null;
				return Object.freeze({
					id,
					name: String(item?.name ?? `类别 ${id}`).trim() || `类别 ${id}`,
				});
			})
			.filter((item): item is ReaderEndorsableCategory => item !== null)
		: [];
	const remaining = Number(record(source?.extras)?.remaining_endorsements);
	return Object.freeze({
		categories: Object.freeze(categories),
		remainingEndorsements: Number.isFinite(remaining)
			? Math.max(0, Math.trunc(remaining))
			: null,
	});
}

const CACHE: DomainResponseCacheSettings = Object.freeze({
	kind: 'users',
	tags: Object.freeze(['users', 'user-endorsements']),
	freshForMs: 60_000,
	retainForMs: 5 * 60_000,
	persist: false,
});

/**
 * 类别专家候选的唯一读取适配器。
 *
 * endpoint 只能由 DiscourseNativeRequests 创建，执行仍走宿主 ajax；中央 gateway 负责
 * scheduler、timeout、429、single-flight 与 main.js 一致的一分钟内存 fresh cache。
 */
export class ReaderUserEndorsementAdapter {
	readonly #gateway: ReaderUserEndorsementGateway;
	readonly #transport: DiscourseNativeReadTransport;
	readonly #authScope: string;

	constructor(options: ReaderUserEndorsementAdapterOptions) {
		this.#gateway = options.gateway;
		this.#transport = options.transport;
		this.#authScope = String(options.authScope).trim();
		if (!this.#authScope) throw new Error('认可 authScope 不能为空');
	}

	load(
		usernameValue: string,
		signal: AbortSignal,
		refresh = false,
	): Promise<ReaderEndorsementCatalog> {
		const normalized = username(usernameValue);
		const descriptor = DiscourseNativeRequests.endorsableCategories({
			username: normalized,
		});
		return this.#gateway.loadUserResource({
			authScope: this.#authScope,
			username: normalized,
			resource: 'endorsable-categories',
			profile: 'resource-visible',
			input: descriptor.path,
			signal,
			cacheMode: refresh ? 'refresh' : 'default',
			cache: Object.freeze({
				...CACHE,
				tags: Object.freeze([
					...CACHE.tags,
					`user:${normalized.toLocaleLowerCase()}`,
				]),
			}),
			transport: async ({ signal: requestSignal, attempt }) => {
				const response = await this.#transport.request<unknown>({
					descriptor,
					signal: requestSignal,
					attempt,
				});
				return response.ok
					? Object.freeze({ ...response, value: project(response.value) })
					: Object.freeze({
						...response,
						value: undefined as unknown as ReaderEndorsementCatalog,
					});
			},
		});
	}
}
