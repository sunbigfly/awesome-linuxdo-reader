import { parseHTML } from 'linkedom';
import { discourseTopicId } from '../src/discourse/identifiers.js';
import {
	ReaderHostTopicSourceCoordinator,
} from '../src/userscript/reader-host-topic-source-coordinator.js';
import type {
	ReaderUserscriptInterceptedTarget,
} from '../src/userscript/reader-userscript-target-adapter.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(`
	<!doctype html>
	<html>
		<body>
			<div class="d-header-icons">
				<button class="search-dropdown" aria-expanded="true"></button>
				<button class="current-user" aria-expanded="true" aria-controls="user-menu"></button>
			</div>
			<table>
				<tbody>
					<tr class="topic-list-item" data-topic-id="42">
						<td><a id="topic" href="/t/example/42">主题</a></td>
					</tr>
				</tbody>
			</table>
			<div class="search-menu">
				<div class="fk-d-menu" data-identifier="search">
					<a id="menu-topic" href="/t/example/43">搜索主题</a>
				</div>
			</div>
			<div id="user-menu" class="menu-panel user-menu">用户菜单</div>
			<div id="reader-root"><button id="reader-control">Reader 控件</button></div>
		</body>
	</html>
`);
const document = parsedDocument as unknown as Document;
const window = parsedWindow as unknown as Window;
const row = document.querySelector<HTMLElement>('.topic-list-item')!;
let rowTop = 100;
Object.defineProperty(row, 'getBoundingClientRect', {
	value: () => ({
		left: 20,
		top: rowTop,
		right: 620,
		bottom: rowTop + 40,
		width: 600,
		height: 40,
		x: 20,
		y: rowTop,
		toJSON: () => ({}),
	}) as DOMRect,
});
const scrollDeltas: number[] = [];
(window as unknown as {
	scrollBy(options: ScrollToOptions): void;
}).scrollBy = (options) => {
	scrollDeltas.push(Number(options.top) || 0);
};

let menuCloseCalls = 0;
let userMenuCloseCalls = 0;
let embedded = false;
const menu = document.querySelector<HTMLElement>('.fk-d-menu')!;
const userMenu = document.querySelector<HTMLElement>('#user-menu')!;
const userMenuTrigger = document.querySelector<HTMLButtonElement>(
	'.current-user',
)!;
userMenuTrigger.addEventListener('click', () => {
	userMenuCloseCalls += 1;
	userMenu.hidden = true;
	userMenuTrigger.setAttribute('aria-expanded', 'false');
});
const host = {
	lookup(name: string): unknown {
		return name === 'service:menu'
			? {
				close(identifier: string) {
					assert(
						identifier === 'search',
						'宿主菜单必须使用真实 identifier 关闭',
					);
					menuCloseCalls += 1;
					menu.hidden = true;
				},
			}
			: null;
	},
	lookupModule(): unknown {
		return null;
	},
};
const coordinator = new ReaderHostTopicSourceCoordinator({
	document,
	host,
	readerRoot: document.querySelector<HTMLElement>('#reader-root')!,
	isEmbedded: () => embedded,
});

const target = Object.freeze({
	request: Object.freeze({
		topicId: discourseTopicId(42),
		source: 'link' as const,
	}),
	anchor: document.querySelector('#topic')!,
	sourceElement: null,
	pointer: Object.freeze({
		clientY: 120,
		detail: 1,
	}),
}) satisfies ReaderUserscriptInterceptedTarget;
await coordinator.prepare(target);
assert(
	document.documentElement.classList.contains(
		'ldp-reader-host-anchor-restoring',
	),
	'捕获宿主 Topic 指针锚点后必须在 workspace 切换前抑制宿主 transition',
);
rowTop = 180;
assert(
	await coordinator.settle(target, true) &&
		row.dataset.ldpReaderActiveTopic === 'true' &&
		scrollDeltas.join(',') === '80' &&
		!document.documentElement.classList.contains(
			'ldp-reader-host-anchor-restoring',
		),
	'打开成功后必须按同一 Topic 行与点击点恢复宿主滚动锚点，并在下一帧释放 transition 抑制',
);
await coordinator.prepare(target);
assert(
	document.documentElement.classList.contains(
		'ldp-reader-host-anchor-restoring',
	) &&
	!await coordinator.settle(target, false) &&
	!document.documentElement.classList.contains(
		'ldp-reader-host-anchor-restoring',
	) &&
	scrollDeltas.length === 1,
	'打开失败必须释放同一 transition 抑制且不得伪造第二次宿主滚动恢复',
);

const menuTarget = Object.freeze({
	request: Object.freeze({
		topicId: discourseTopicId(43),
		source: 'link' as const,
	}),
	anchor: document.querySelector('#menu-topic')!,
	sourceElement: null,
	pointer: null,
}) satisfies ReaderUserscriptInterceptedTarget;
await coordinator.prepare(menuTarget);
assert(
	menuCloseCalls === 1 &&
		menu.hidden &&
		!await coordinator.settle(menuTarget, false),
	'宿主搜索浮层必须优先走 Discourse menu service，失败打开不得恢复伪锚点',
);

menu.hidden = false;
document.querySelector<HTMLElement>('#reader-control')!.dispatchEvent(
	new parsedWindow.Event('pointerdown', { bubbles: true }),
);
await Promise.resolve();
assert(
	menuCloseCalls === 1 && !menu.hidden && !userMenu.hidden,
	'非嵌入态 Reader 交互不得改写宿主临时浮层生命周期',
);
embedded = true;
document.querySelector<HTMLElement>('#reader-control')!.dispatchEvent(
	new parsedWindow.Event('pointerdown', { bubbles: true }),
);
await coordinator.closeOpenSurfaces();
assert(
	Number(menuCloseCalls) === 2 && menu.hidden &&
	userMenuCloseCalls === 1 && userMenu.hidden,
	'嵌入态切回 Reader 交互必须通过宿主 service 或原生 trigger 收起搜索与头像浮层',
);

coordinator.destroy();
