import type {
	ActionPermissionRequest,
} from '../src/network/domain-request-gateway.js';
import {
	BrowserDiscourseNativeReadTransport,
} from '../src/network/discourse-native-read-transport.js';
import {
	BoostReportAccessAdapter,
	type BoostReportPermissionPort,
} from '../src/post/boost-report-access-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const captured: ActionPermissionRequest<unknown>[] = [];
const gateway: BoostReportPermissionPort = {
	async loadActionPermission<T>(
		input: ActionPermissionRequest<T>,
	): Promise<T> {
		captured.push(input as ActionPermissionRequest<unknown>);
		const response = await input.transport({
			signal: input.signal,
			attempt: 1,
		});
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		return response.value;
	},
};
let nativePath = '';
const transport = new BrowserDiscourseNativeReadTransport({
	lookup() {
		return null;
	},
	lookupModule(name) {
		if (name !== 'discourse/lib/ajax') return null;
		return {
			ajax(path: string) {
				nativePath = path;
				return Promise.resolve({
					can_flag: true,
					user_flag_status: null,
					available_flags: [
						'notify_moderators',
						' spam ',
						'notify_moderators',
						'',
					],
					user: { username: 'booster' },
				});
			},
		};
	},
});
const adapter = new BoostReportAccessAdapter({
	gateway,
	transport,
	authScope: 'account:viewer',
	signal: new AbortController().signal,
});
const access = await adapter.load(42);
assert(
	captured[0]?.operation === 'boost-report-access' &&
		captured[0]?.targetType === 'boost' &&
		captured[0]?.targetId === 42 &&
		captured[0]?.method === 'GET',
	'Boost 权限必须以完整登录态动作身份进入中央 permission gateway',
);
assert(
	nativePath === '/discourse-boosts/boosts/42.json',
	'Boost 权限只能使用具名 Discourse 插件原生 GET descriptor',
);
assert(
	access.canFlag &&
		!access.alreadyFlagged &&
		access.username === 'booster' &&
		access.availableFlagNames.join(',') ===
			'notify_moderators,spam',
	'Boost 权限响应必须归一化、去重并冻结为领域数据',
);

let invalidIdRejected = false;
try {
	await adapter.load(0);
} catch (cause) {
	invalidIdRejected = cause instanceof RangeError;
}
assert(invalidIdRejected, '非法 Boost id 不得进入中央请求或原生 transport');
