import { parseHTML } from 'linkedom';
import {
	ReaderHostTurnstileBackgroundController,
	type ReaderHostTurnstileApi,
} from '../src/network/reader-host-turnstile-background-controller.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window } = parseHTML(
	'<!doctype html><html><body>' +
		'<div class="cf-turnstile" data-sitekey="site-key">' +
		'<input id="cf-chl-widget-widget-1_response" ' +
		'name="cf-turnstile-response" value="ready-token" type="hidden">' +
		'</div></body></html>',
);
const document = parsedDocument as unknown as Document;
let visibility: DocumentVisibilityState = 'visible';
let blocked = false;
let response = 'ready-token';
let removeCount = 0;
let renderCount = 0;
let cancelledCount = 0;
const tasks: Array<{
	readonly callback: () => void;
	cancelled: boolean;
}> = [];
const api: ReaderHostTurnstileApi = {
	getResponse(widgetId) {
		assert(widgetId === 'widget-1', '必须从响应 input 精确提取 widget id');
		return response;
	},
	remove(widgetId) {
		assert(widgetId === 'widget-1', '释放时不得使用其他 widget id');
		removeCount += 1;
		document.querySelector('input[name="cf-turnstile-response"]')?.remove();
	},
	render(container, options) {
		assert(
			container === document.querySelector('body > .cf-turnstile') &&
			options.sitekey === 'site-key',
			'恢复必须复用原 body 直属容器和 sitekey',
		);
		renderCount += 1;
		const input = document.createElement('input');
		input.id = 'cf-chl-widget-widget-1_response';
		input.name = 'cf-turnstile-response';
		input.value = 'restored-token';
		(container as HTMLElement).append(input);
		return 'widget-1';
	},
};
const controller = new ReaderHostTurnstileBackgroundController({
	document,
	enabled: false,
	turnstile: () => api,
	visibility: () => visibility,
	hiddenDelayMs: 30_000,
	hasBlockingInteraction: () => blocked,
	schedule(callback) {
		const task = { callback, cancelled: false };
		tasks.push(task);
		return task;
	},
	cancel(handle) {
		(handle as { cancelled: boolean }).cancelled = true;
		cancelledCount += 1;
	},
});

visibility = 'hidden';
document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event);
assert(
	tasks.length === 0 && controller.snapshot.state === 'idle',
	'默认关闭时后台切换不得接触宿主 Turnstile',
);

controller.applyEnabled(true);
assert(
	Number(tasks.length) === 1 && String(controller.snapshot.state) === 'scheduled',
	'启用后必须先等待后台迟滞，不能在 visibilitychange 同步释放',
);
blocked = true;
tasks[0]!.callback();
assert(
	removeCount === 0 && controller.snapshot.state === 'idle',
	'编辑或支付交互存在时不得暂停宿主验证',
);

blocked = false;
visibility = 'visible';
document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event);
visibility = 'hidden';
document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event);
tasks[1]!.callback();
const container = document.querySelector<HTMLElement>('body > .cf-turnstile')!;
assert(Number(removeCount) === 1, '后台迟滞到期必须调用一次官方 remove');
assert(
	String(controller.snapshot.state) === 'suspended',
	'官方 remove 后 controller 必须进入 suspended',
);
assert(
	container.getAttribute('data-ldp-host-turnstile-suspended') === 'true',
	'暂停后必须写入可观测但不含令牌的诊断标记',
);
assert(
	!container.querySelector('input[name="cf-turnstile-response"]'),
	'暂停后宿主响应字段必须由官方 remove 一并释放',
);

visibility = 'visible';
document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event);
assert(
	renderCount === 1 &&
	controller.snapshot.state === 'idle' &&
	!container.hasAttribute('data-ldp-host-turnstile-suspended') &&
	container.querySelector<HTMLInputElement>(
		'input[name="cf-turnstile-response"]',
	)?.value === 'restored-token',
	'回到前台必须立即用原 sitekey 恢复并清除诊断标记',
);

response = '';
visibility = 'hidden';
document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event);
tasks[2]!.callback();
assert(
	Number(removeCount) === 1 && String(controller.snapshot.state) === 'idle',
	'挑战尚未完成或没有响应时不得中断宿主验证',
);

response = 'ready-token';
visibility = 'visible';
document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event);
visibility = 'hidden';
document.dispatchEvent(new window.Event('visibilitychange') as unknown as Event);
tasks[3]!.callback();
controller.applyEnabled(false);
assert(
	Number(removeCount) === 2 &&
	Number(renderCount) === 2 &&
	!controller.snapshot.enabled &&
	controller.snapshot.state === 'idle',
	'关闭实验设置必须立即恢复已暂停控件',
);

controller.applyEnabled(true);
assert(
	String(controller.snapshot.state) === 'scheduled',
	'重新启用必须重新排队',
);
controller.destroy();
assert(
	cancelledCount >= 1 &&
	tasks.at(-1)?.cancelled === true &&
	controller.scope.destroyed,
	'销毁必须取消尚未执行的后台任务并释放监听',
);
