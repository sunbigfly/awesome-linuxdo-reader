import {
	DiscourseComposerHostIsolation,
} from '../src/discourse/native-composer.js';
import type { DiscourseHostApiPort } from '../src/discourse/native-host-api.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

type Listener = (payload?: unknown) => void;
const listeners = new Map<string, Set<Listener>>();
const hostEvents: string[] = [];
const appEvents = {
	on(name: string, listener: Listener) {
		const group = listeners.get(name) ?? new Set<Listener>();
		group.add(listener);
		listeners.set(name, group);
	},
	off(name: string, listener: Listener) {
		listeners.get(name)?.delete(listener);
	},
	trigger(name: string, payload?: unknown) {
		hostEvents.push(name);
		for (const listener of listeners.get(name) ?? []) listener(payload);
		return this;
	},
};
const routed: string[] = [];
const routeOwner = {
	routeTo(value: string) {
		routed.push(value);
	},
};
let unsubscribed = 0;
let subscribed = 0;
const topicController = {
	model: { id: 42 },
	unsubscribe() {
		unsubscribed += 1;
	},
	subscribe() {
		subscribed += 1;
	},
};
const host: DiscourseHostApiPort = {
	lookup(name) {
		if (name === 'service:app-events') return appEvents;
		if (name === 'controller:topic') return topicController;
		return null;
	},
	lookupModule(name) {
		return name === 'discourse/lib/url'
			? { default: routeOwner }
			: null;
	},
};
const isolation = new DiscourseComposerHostIsolation({ host });
const readerEvents: string[] = [];
isolation.subscribe((event) => {
	readerEvents.push(`${event.kind}:${event.eventName}`);
});
const originalTrigger = appEvents.trigger;
const originalRouteTo = routeOwner.routeTo;
await isolation.run(42, 'created', async () => {
	appEvents.trigger('composer:created-post', {
		id: 420,
		topic_id: 42,
		post_number: 8,
	});
	appEvents.trigger('post:created', {
		id: 420,
		topic_id: 42,
		post_number: 8,
	});
	appEvents.trigger('post:highlight', 8);
	routeOwner.routeTo('/t/example/42/8');
	routeOwner.routeTo('/t/other/43/2');
	return { id: 420, topic_id: 42, post_number: 8 };
});
assert(
	readerEvents.join(',') ===
		'created:composer:created-post,created:post:created' &&
	hostEvents.length === 0,
	'隔离期 created/highlight 只能通知 Reader canonical consumer，不能泄漏给宿主 app-events',
);
assert(
	routed.join(',') === '/t/other/43/2' &&
	unsubscribed === 1 &&
	subscribed === 0,
	'隔离期必须阻止同 Topic 跳楼并只暂停同 Topic 宿主 controller',
);
assert(
	appEvents.trigger === originalTrigger &&
	routeOwner.routeTo === originalRouteTo,
	'save settle 后必须幂等恢复 app-events trigger 与 routeTo',
);

readerEvents.length = 0;
await isolation.run(42, 'edited', async () => ({
	id: 421,
	topic_id: 42,
	post_number: 7,
}));
assert(
	readerEvents.join(',') === 'edited:composer:edited-post' &&
	unsubscribed === 1,
	'宿主未发事件时必须用 save 返回实体补一次 canonical edited commit，且不得重复 unsubscribe',
);

isolation.destroy();
assert(
	Number(subscribed) === 1,
	'destroy/Reader 关闭必须只恢复一次被暂停的同 Topic controller',
);
