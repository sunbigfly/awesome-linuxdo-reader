import { parseHTML } from 'linkedom';
import {
	ReaderShellRecoveryView,
} from '../src/shell/reader-shell-recovery-view.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><main id="host"></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const host = document.querySelector<HTMLElement>('#host')!;
let retries = 0;
let closes = 0;
let retryFails = true;
const view = new ReaderShellRecoveryView({
	document,
	host,
	onRetry: async () => {
		retries += 1;
		if (retryFails) throw new Error('temporary retry failure');
		return true;
	},
	onClose: () => {
		closes += 1;
	},
});
view.show({
	kind: 'cloudflare',
	message: '验证未完成',
	detail: '楼层仍保持未读。',
	challengeHref: 'https://linux.do/',
});
assert(
	view.visible &&
		host.querySelector('.ldp-error')?.getAttribute('data-failure-kind') ===
			'cloudflare' &&
		host.querySelector<HTMLAnchorElement>('.ldp-error-challenge')?.href ===
			'https://linux.do/' &&
		host.querySelector('.ldp-error')?.textContent?.includes(
			'楼层仍保持未读',
		),
	'恢复 UI 必须投影分类错误、手动验证入口和真实未读边界',
);
host.querySelector<HTMLButtonElement>('.ldp-error-retry')?.click();
await Promise.resolve();
await Promise.resolve();
assert(
	retries === 1 &&
		view.visible &&
		host.querySelector('.ldp-error-detail')?.textContent?.includes(
			'当前状态已保留',
		),
	'手动重试异常必须留在同一恢复 UI，不得产生未处理 Promise',
);
retryFails = false;
host.querySelector<HTMLButtonElement>('.ldp-error-retry')?.click();
await Promise.resolve();
await Promise.resolve();
assert(
	Number(retries) === 2 && !view.visible,
	'手动重试成功必须收起同一恢复 UI',
);
view.show({
	kind: 'network',
	message: '网络暂时不可用',
	detail: '可手动重试。',
});
assert(
	host.querySelector<HTMLAnchorElement>('.ldp-error-challenge')?.hidden,
	'普通错误不得显示 Cloudflare 入口',
);
host.querySelector<HTMLButtonElement>('.ldp-error-close')?.click();
await Promise.resolve();
assert(closes === 1 && !view.visible, '关闭必须释放恢复 UI 并调用 Shell close');
view.destroy();
assert(host.childElementCount === 0, '恢复 UI 销毁不得遗留 DOM');
