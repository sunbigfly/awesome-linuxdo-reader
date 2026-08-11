import {
	DiscourseApplicationCacheInvalidationCoordinator,
} from '../src/cache/discourse-application-cache-invalidation.js';
import type {
	DiscourseComposerEventSource,
	DiscourseComposerSaveEvent,
} from '../src/discourse/native-composer.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

type AppListener = (payload?: unknown) => void;
const appListeners = new Map<string, Set<AppListener>>();
const appEvents = {
	on(name: string, _owner: unknown, listener: AppListener) {
		const group = appListeners.get(name) ?? new Set<AppListener>();
		group.add(listener);
		appListeners.set(name, group);
	},
	off(name: string, _owner: unknown, listener: AppListener) {
		appListeners.get(name)?.delete(listener);
	},
	trigger(name: string, payload?: unknown) {
		for (const listener of appListeners.get(name) ?? []) listener(payload);
	},
};
const composerListeners = new Set<(
	event: DiscourseComposerSaveEvent,
) => void>();
const composerEvents: DiscourseComposerEventSource = {
	subscribe(listener) {
		composerListeners.add(listener);
		return () => composerListeners.delete(listener);
	},
};
const invalidations: string[][] = [];
const postChanges: Readonly<Record<string, unknown>>[] = [];
const errors: unknown[] = [];
const coordinator = new DiscourseApplicationCacheInvalidationCoordinator({
	host: {
		lookup: (name) => name === 'service:app-events' ? appEvents : null,
		lookupModule: () => null,
	},
	composerEvents,
	cache: {
		async invalidate({ tags }) {
			invalidations.push([...tags]);
		},
	},
	currentTopicId: () => 77,
	onPostChanged: (post) => postChanges.push(post),
	onError: (cause) => errors.push(cause),
});

appEvents.trigger('discourse-reactions:reaction-toggled', {
	post: { id: 420, topic_id: 42 },
});
for (const listener of composerListeners) {
	listener(Object.freeze({
		kind: 'created',
		eventName: 'post:created',
		payload: { id: 421, topic: { id: 43 } },
	}));
	listener(Object.freeze({
		kind: 'edited',
		eventName: 'composer:edited-post',
		payload: undefined,
	}));
}
await coordinator.flush();
assert(
	invalidations.length === 1 &&
		invalidations[0]?.join(',') ===
			'post:420,post:421,reactions-given,topic:42,topic:43,topic:77',
	'application owner 必须把 reaction/created/edited 同 tick 合并成任意 Topic 的精确 cache tags',
);
assert(
	postChanges.length === 1 &&
	Number(postChanges[0]?.id) === 420 &&
	Number(postChanges[0]?.topic_id) === 42,
	'携带完整 post model 的宿主回应事件必须同步交给当前 Topic canonical owner，不能只失效缓存',
);
assert(errors.length === 0, '正常 cache invalidation 不得产生诊断');

coordinator.destroy();
appEvents.trigger('discourse-reactions:reaction-toggled', {
	post: { id: 999, topic_id: 99 },
});
for (const listener of composerListeners) {
	listener(Object.freeze({
		kind: 'created',
		eventName: 'post:created',
		payload: { id: 999, topic_id: 99 },
	}));
}
await coordinator.flush();
assert(
	invalidations.length === 1 &&
	postChanges.length === 1 &&
	composerListeners.size === 0,
	'destroy 必须同时解除 app-events 与私有 Composer event source',
);
