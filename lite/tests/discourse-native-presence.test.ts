import {
	BrowserDiscoursePresencePort,
} from '../src/discourse/native-presence.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

let change: () => void = () => {};
let subscribed = 0;
let unsubscribed = 0;
let detached = 0;
const channel = {
	users: [{
		username: 'alice',
		name: 'Alice',
		avatar_template: '/user_avatar/example/alice/{size}/1.png',
	}],
	on(name: string, listener: () => void) {
		assert(this === channel && name === 'change', 'Presence on 必须保留 channel this');
		change = listener;
	},
	off(name: string, listener: () => void) {
		assert(this === channel && name === 'change', 'Presence off 必须保留 channel this');
		if (change === listener) change = () => {};
		detached += 1;
	},
	subscribe() {
		assert(this === channel, 'Presence subscribe 必须保留 channel this');
		subscribed += 1;
	},
	unsubscribe() {
		assert(this === channel, 'Presence unsubscribe 必须保留 channel this');
		unsubscribed += 1;
	},
};
const lookups: string[] = [];
const channels: string[] = [];
const presence = new BrowserDiscoursePresencePort({
	lookup(name) {
		lookups.push(name);
		return name === 'service:presence'
			? {
				getChannel(nameValue: string) {
					channels.push(nameValue);
					return channel;
				},
			}
			: null;
	},
	lookupModule() {
		return null;
	},
});
let users: readonly { readonly username: string }[] = [];
const cleanup = presence.watchReplying(42, (next) => {
	users = next;
});
await Promise.resolve();
assert(
	subscribed === 1 &&
	channels[0] === '/discourse-presence/reply/42' &&
	users[0]?.username === 'alice',
	'Presence 必须订阅 Discourse 原生 reply channel 并归一化用户',
);
channel.users = [{
	username: 'bob',
	name: '',
	avatar_template: '',
}];
change();
assert(
	String(users[0]?.username) === 'bob',
	'Presence change 必须更新同一监听器',
);
cleanup();
await Promise.resolve();
assert(
	detached === 1 &&
	unsubscribed === 1 &&
	lookups.every((name) => name === 'service:presence'),
	'Presence cleanup 必须解绑原生 change 与 subscribe 生命周期',
);

let missingCount = -1;
new BrowserDiscoursePresencePort({
	lookup() {
		return null;
	},
	lookupModule() {
		return null;
	},
}).watchReplying(1, (next) => {
	missingCount = next.length;
})();
assert(
	Number(missingCount) === 0,
	'可选 Presence service 缺失时必须安静降级为空集合',
);
