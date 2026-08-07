import type { Cleanup } from '../kernel/lifecycle.js';
import {
	valueRecord as record,
	type UnknownRecord,
} from '../kernel/value-record.js';
import type { DiscourseHostApiPort } from './native-host-api.js';

export interface DiscoursePresenceUser {
	readonly username: string;
	readonly name: string;
	readonly avatarTemplate: string;
}

export interface DiscoursePresencePort {
	watchReplying(
		topicId: number,
		listener: (users: readonly DiscoursePresenceUser[]) => void,
		onError?: (error: unknown) => void,
	): Cleanup;
}

interface NativePresenceChannel extends UnknownRecord {
	readonly users?: unknown;
	readonly on?: unknown;
	readonly off?: unknown;
	readonly subscribe?: unknown;
	readonly unsubscribe?: unknown;
}

function modelValue(value: unknown, key: string): unknown {
	const source = record(value);
	if (!source) return undefined;
	const getter = source.get;
	if (typeof getter === 'function') {
		try {
			const result = getter.call(value, key);
			if (result !== undefined) return result;
		} catch {
			// Plain object fallback remains valid for tests and newer models.
		}
	}
	return source[key];
}

function normalizeUsers(value: unknown): readonly DiscoursePresenceUser[] {
	let source: readonly unknown[] = [];
	if (Array.isArray(value)) source = value;
	else {
		const toArray = record(value)?.toArray;
		if (typeof toArray === 'function') {
			try {
				const result = toArray.call(value);
				if (Array.isArray(result)) source = result;
			} catch {
				source = [];
			}
		} else if (value && typeof (value as Iterable<unknown>)[Symbol.iterator] === 'function') {
			source = [...value as Iterable<unknown>];
		}
	}
	const users = source
		.map((candidate) => {
			const username = String(
				modelValue(candidate, 'username') ?? '',
			).trim();
			if (!username) return null;
			return Object.freeze({
				username,
				name: String(
					modelValue(candidate, 'name') ?? username,
				).trim() || username,
				avatarTemplate: String(
					modelValue(candidate, 'avatar_template') ??
					modelValue(candidate, 'avatarTemplate') ??
					'',
				).trim(),
			});
		})
		.filter((user): user is DiscoursePresenceUser => user !== null);
	return Object.freeze(users);
}

function topicIdentifier(value: number): number {
	const topicId = Number(value);
	if (!Number.isSafeInteger(topicId) || topicId < 1) {
		throw new RangeError('Presence topicId 必须是正安全整数');
	}
	return topicId;
}

/**
 * Discourse 回复在线状态的唯一浏览器端口。
 *
 * 只复用 `service:presence.getChannel()` 和原生 channel 生命周期；缺少可选 Presence
 * service 时返回空集合，不创建轮询、MessageBus 旁路或自建请求。
 */
export class BrowserDiscoursePresencePort implements DiscoursePresencePort {
	readonly nativeBinding = 'service:presence' as const;
	readonly #host: DiscourseHostApiPort;

	constructor(host: DiscourseHostApiPort) {
		this.#host = host;
	}

	watchReplying(
		topicIdValue: number,
		listener: (users: readonly DiscoursePresenceUser[]) => void,
		onError: (error: unknown) => void = () => {},
	): Cleanup {
		const topicId = topicIdentifier(topicIdValue);
		if (typeof listener !== 'function') {
			throw new TypeError('Presence listener 必须是函数');
		}
		const service = record(this.#host.lookup('service:presence'));
		const getChannel = service?.getChannel;
		if (typeof getChannel !== 'function') {
			listener(Object.freeze([]));
			return () => {};
		}
		let channel: NativePresenceChannel | null = null;
		try {
			channel = record(
				getChannel.call(
					service,
					`/discourse-presence/reply/${topicId}`,
				),
			) as NativePresenceChannel | null;
		} catch (error) {
			onError(error);
		}
		if (
			!channel ||
			typeof channel.subscribe !== 'function' ||
			typeof channel.unsubscribe !== 'function'
		) {
			listener(Object.freeze([]));
			return () => {};
		}
		const nativeChannel = channel;
		const subscribe = nativeChannel.subscribe as () => unknown;
		const unsubscribe = nativeChannel.unsubscribe as () => unknown;
		let active = true;
		let subscriptionSettled = false;
		let unsubscribeIssued = false;
		const publish = (): void => {
			if (!active) return;
			try {
				listener(normalizeUsers(modelValue(nativeChannel, 'users')));
			} catch (error) {
				onError(error);
			}
		};
		const change = (): void => publish();
		if (typeof nativeChannel.on === 'function') {
			try {
				nativeChannel.on.call(nativeChannel, 'change', change);
			} catch (error) {
				onError(error);
			}
		}
		const issueUnsubscribe = (): void => {
			if (unsubscribeIssued) return;
			unsubscribeIssued = true;
			try {
				void Promise.resolve(
					unsubscribe.call(nativeChannel),
				).catch(onError);
			} catch (error) {
				onError(error);
			}
		};
		try {
			void Promise.resolve(
				subscribe.call(nativeChannel),
			).then(() => {
				subscriptionSettled = true;
				if (!active) issueUnsubscribe();
				else publish();
			}).catch((error) => {
				subscriptionSettled = true;
				if (active) {
					onError(error);
					listener(Object.freeze([]));
				}
				issueUnsubscribe();
			});
		} catch (error) {
			subscriptionSettled = true;
			onError(error);
			listener(Object.freeze([]));
			issueUnsubscribe();
		}
		return () => {
			if (!active) return;
			active = false;
			if (typeof nativeChannel.off === 'function') {
				try {
					nativeChannel.off.call(nativeChannel, 'change', change);
				} catch (error) {
					onError(error);
				}
			}
			if (subscriptionSettled) issueUnsubscribe();
		};
	}
}
