import { parseHTML } from 'linkedom';
import {
	ReaderRateLimitNotice,
	type ReaderRateLimitNoticeSnapshot,
} from '../src/shell/reader-rate-limit-notice.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><div id="notice" hidden><span id="detail"></span><a id="challenge"></a></div></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('#notice');
const detail = document.querySelector<HTMLElement>('#detail');
const challenge = document.querySelector<HTMLAnchorElement>('#challenge');
if (!root || !detail || !challenge) throw new Error('测试 DOM 创建失败');

let snapshot: ReaderRateLimitNoticeSnapshot = {
	challengeState: 'idle',
	challengeOwned: false,
	blockingReason: '',
	nextPermitDelay: 0,
};
let stateChangeListener: (() => void) | null = null;
let stateChangeUnsubscribed = false;
const notice = new ReaderRateLimitNotice({
	document,
	elements: { root, detail, challenge },
	challengeHref:
		'https://linux.do/challenge?redirect=https%3A%2F%2Flinux.do%2Ft%2F1',
	snapshot: async () => snapshot,
	subscribe: (listener) => {
		stateChangeListener = listener;
		return () => {
			stateChangeUnsubscribed = true;
			stateChangeListener = null;
		};
	},
	intervalMs: 60_000,
});
await notice.refresh();
assert(root.hidden, '没有活动验证时不得显示旧式 cooldown 提示');
assert(
	new URL(challenge.href).pathname === '/challenge' &&
		decodeURIComponent(
			new URL(challenge.href).searchParams.get('redirect') ?? '',
		) ===
			'https://linux.do/t/1',
	'手动验证入口必须使用站点原生 GET challenge 并保留同源回跳',
);

snapshot = {
	challengeState: 'required',
	challengeOwned: false,
	blockingReason: 'challenge',
	nextPermitDelay: 1_000,
};
await notice.refresh();
assert(
	!root.hidden &&
		detail.textContent?.includes('已暂停') &&
		detail.textContent?.includes('只打开一个'),
	'后台 Cloudflare 响应必须显示人工验证硬闸门，不能声称浮窗已经自动打开',
);

snapshot = {
	challengeState: 'active',
	challengeOwned: false,
	blockingReason: 'challenge',
	nextPermitDelay: 1_000,
};
await notice.refresh();
assert(
	!root.hidden && detail.textContent?.includes('其他标签页'),
	'共享验证 lease 必须区分其他标签页 owner',
);

snapshot = {
	challengeState: 'active',
	challengeOwned: true,
	blockingReason: 'challenge',
	nextPermitDelay: 1_000,
};
await notice.refresh();
assert(
	!root.hidden && detail.textContent?.includes('本页'),
	'活动验证必须区分本页 owner',
);

snapshot = {
	challengeState: 'passed',
	challengeOwned: false,
	blockingReason: '',
	nextPermitDelay: 0,
};
await notice.refresh();
assert(root.hidden, '验证完成后必须隐藏提示');
assert(
	root.dataset.cooldownSeconds === undefined,
	'隐藏时必须清理陈旧的倒计时 dataset',
);
snapshot = {
	challengeState: 'idle',
	challengeOwned: false,
	blockingReason: 'rate-limit',
	nextPermitDelay: 2_000,
};
stateChangeListener?.();
await Promise.resolve();
await Promise.resolve();
assert(
	!root.hidden &&
		detail.textContent?.includes('所有 Reader 标签页已共享暂停') &&
		challenge.hidden,
	'普通 429 广播必须立即显示共享暂停，并隐藏不适用的 Cloudflare 验证入口',
);
snapshot = {
	challengeState: 'idle',
	challengeOwned: false,
	blockingReason: '',
	nextPermitDelay: 0,
};
stateChangeListener?.();
await Promise.resolve();
await Promise.resolve();
assert(root.hidden, '收到共享恢复广播后必须立即解除普通 429 横幅');
notice.destroy();
assert(stateChangeUnsubscribed, '销毁 429 投影时必须退订共享状态事件');
