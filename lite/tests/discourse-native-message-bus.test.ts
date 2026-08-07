import {
	BrowserDiscourseMessageBusPort,
} from '../src/discourse/native-message-bus.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const subscriptions = new Map<string, (message: unknown) => void>();
const service = {
	subscribe(channel: string, handler: (message: unknown) => void) {
		assert(this === service, 'MessageBus subscribe 必须保留 service this');
		subscriptions.set(channel, handler);
	},
	unsubscribe(channel: string, handler: (message: unknown) => void) {
		assert(this === service, 'MessageBus unsubscribe 必须保留 service this');
		if (subscriptions.get(channel) === handler) subscriptions.delete(channel);
	},
};
const lookups: string[] = [];
const port = new BrowserDiscourseMessageBusPort({
	lookup(name) {
		lookups.push(name);
		return name === 'service:message-bus' ? service : null;
	},
	lookupModule() {
		return null;
	},
});
let received: unknown;
const handler = (message: unknown) => {
	received = message;
};
port.subscribe('/topic/10', handler);
subscriptions.get('/topic/10')?.({ type: 'created' });
assert(
	(received as { type?: string } | undefined)?.type === 'created',
	'原生 MessageBus 消息必须原样交给 TopicLiveController',
);
port.unsubscribe('/topic/10', handler);
assert(!subscriptions.size, 'unsubscribe 必须释放相同原生频道 handler');
assert(
	lookups.every((name) => name === 'service:message-bus') &&
	port.nativeBinding === 'service:message-bus',
	'实时端口只能解析原生 service:message-bus',
);

let externalChannelRejected = false;
try {
	port.subscribe('https://example.com/topic/10', handler);
} catch (error) {
	externalChannelRejected = error instanceof Error && error.message.includes('站内');
}
assert(externalChannelRejected, 'MessageBus 端口不得接受 URL 或自建外部频道');

const missing = new BrowserDiscourseMessageBusPort({
	lookup() {
		return null;
	},
	lookupModule() {
		return null;
	},
});
let missingRejected = false;
try {
	missing.subscribe('/topic/10', handler);
} catch (error) {
	missingRejected = error instanceof Error &&
		error.message.includes('service:message-bus 不可用');
}
assert(missingRejected, '原生 MessageBus 缺失时必须显式降级失败');
