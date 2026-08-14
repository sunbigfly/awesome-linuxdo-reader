import type { DiscourseHostApiPort } from './native-host-api.js';

export interface DiscourseMessageBusPort {
	subscribe(channel: string, handler: (message: unknown) => void): void;
	unsubscribe(channel: string, handler: (message: unknown) => void): void;
}

interface ResolvedMessageBus {
	readonly owner: object;
	readonly subscribe: (
		channel: string,
		handler: (message: unknown) => void,
	) => void;
	readonly unsubscribe: (
		channel: string,
		handler: (message: unknown) => void,
	) => void;
}

function channelName(value: string): string {
	const channel = String(value).trim();
	if (!channel.startsWith('/') || channel.includes('://')) {
		throw new Error('Discourse MessageBus channel 必须是站内 /channel');
	}
	return channel;
}

function resolveMessageBus(host: DiscourseHostApiPort): ResolvedMessageBus {
	const service = host.lookup('service:message-bus');
	if (
		!service ||
		typeof service !== 'object' ||
		typeof (service as { subscribe?: unknown }).subscribe !== 'function' ||
		typeof (service as { unsubscribe?: unknown }).unsubscribe !== 'function'
	) {
		throw new Error('Discourse 原生 service:message-bus 不可用');
	}
	const owner = service as object;
	return {
		owner,
		subscribe: (service as ResolvedMessageBus).subscribe,
		unsubscribe: (service as ResolvedMessageBus).unsubscribe,
	};
}

/**
 * Discourse 站内实时消息的唯一浏览器端口。
 *
 * Topic live 与通知变更信号都只调用原生 `service:message-bus`；不得回退到自建
 * WebSocket、EventSource、fetch 长轮询或用户脚本外部频道。
 */
export class BrowserDiscourseMessageBusPort implements DiscourseMessageBusPort {
	readonly nativeBinding = 'service:message-bus' as const;
	readonly #host: DiscourseHostApiPort;

	constructor(host: DiscourseHostApiPort) {
		this.#host = host;
	}

	subscribe(channelValue: string, handler: (message: unknown) => void): void {
		const channel = channelName(channelValue);
		if (typeof handler !== 'function') throw new TypeError('MessageBus handler 必须是函数');
		const resolved = resolveMessageBus(this.#host);
		resolved.subscribe.call(resolved.owner, channel, handler);
	}

	unsubscribe(channelValue: string, handler: (message: unknown) => void): void {
		const channel = channelName(channelValue);
		if (typeof handler !== 'function') throw new TypeError('MessageBus handler 必须是函数');
		const resolved = resolveMessageBus(this.#host);
		resolved.unsubscribe.call(resolved.owner, channel, handler);
	}
}
