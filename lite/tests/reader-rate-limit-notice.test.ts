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
};
const notice = new ReaderRateLimitNotice({
	document,
	elements: { root, detail, challenge },
	challengeHref:
		'https://linux.do/challenge?redirect=https%3A%2F%2Flinux.do%2Ft%2F1',
	snapshot: async () => snapshot,
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
};
await notice.refresh();
assert(
	!root.hidden && detail.textContent?.includes('其他标签页'),
	'共享验证 lease 必须区分其他标签页 owner',
);

snapshot = {
	challengeState: 'active',
	challengeOwned: true,
};
await notice.refresh();
assert(
	!root.hidden && detail.textContent?.includes('本页'),
	'活动验证必须区分本页 owner',
);

snapshot = {
	challengeState: 'passed',
	challengeOwned: false,
};
await notice.refresh();
assert(root.hidden, '验证完成后必须隐藏提示');
assert(
	root.dataset.cooldownSeconds === undefined,
	'隐藏时必须清理陈旧的倒计时 dataset',
);
notice.destroy();
