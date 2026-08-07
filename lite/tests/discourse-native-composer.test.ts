import { parseHTML } from 'linkedom';
import {
	DiscourseComposerCoordinator,
	DiscourseComposerHostIsolation,
} from '../src/discourse/native-composer.js';
import type { DiscourseHostApiPort } from '../src/discourse/native-host-api.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

type TestModel = Record<string, unknown> & {
	get(key: string): unknown;
	set(key: string, value: unknown): void;
};

function model(attributes: Record<string, unknown>): TestModel {
	return {
		...attributes,
		get(key: string) {
			return this[key as keyof typeof this];
		},
		set(key: string, value: unknown) {
			(this as Record<string, unknown>)[key] = value;
		},
	};
}

const draftCalls: string[] = [];
const openOptions: Record<string, unknown>[] = [];
const inserted: string[] = [];
const saveCalls: unknown[][] = [];
const routed: string[] = [];
const privateMessageOpenOptions: Record<string, unknown>[] = [];
let closeCalls = 0;
let discardDraftCalls = 0;
let discardCloseCalls = 0;
let clearStateCalls = 0;
const service = {
	model: null as ReturnType<typeof model> | null,
	appEvents: {
		on() {},
		off() {},
		trigger(name: string, value: string) {
			inserted.push(`${name}:${value}`);
		},
	},
	async save(...args: readonly unknown[]) {
		saveCalls.push([...args]);
		return { id: 22, topic_id: 10, post_number: 4 };
	},
	async open(options: Record<string, unknown>) {
		openOptions.push(options);
		this.model = model({
			...options,
			topic: (options.post as TestModel | undefined)?.topic ??
				options.topic,
			viewOpen: true,
			composeState: 'open',
		});
	},
	async openNewMessage(options: Record<string, unknown>) {
		privateMessageOpenOptions.push(options);
		this.model = model({
			action: 'privateMessage',
			targetRecipients: options.recipients,
			viewOpen: true,
			composeState: 'open',
		});
	},
	async destroyDraft() {
		discardDraftCalls += 1;
	},
	close() {
		discardCloseCalls += 1;
		if (this.model) {
			this.model.viewOpen = false;
			this.model.composeState = 'closed';
		}
	},
};
const modelFactory = {
	create(attributes: Record<string, unknown>) {
		return model(attributes);
	},
};
const modules: Record<string, unknown> = {
	'discourse/models/composer': {
		default: { REPLY: 'reply', EDIT: 'edit' },
	},
	'discourse/models/topic': { default: modelFactory },
	'discourse/models/post': {
		default: {
			...modelFactory,
			munge(attributes: unknown) {
				return attributes;
			},
		},
	},
	'discourse/models/draft': {
		default: {
			async get(key: string) {
				draftCalls.push(key);
				return {
					draft: JSON.stringify({ reply: '已有草稿', whisper: false }),
					draft_sequence: 4,
				};
			},
		},
	},
	'discourse/lib/url': {
		default: {
			async routeTo(route: string) {
				routed.push(route);
			},
		},
	},
};
const host: DiscourseHostApiPort = {
	lookup(name) {
		return name === 'service:composer'
			? service
			: name === 'service:app-events'
				? service.appEvents
				: null;
	},
	lookupModule(name) {
		return modules[name] ?? null;
	},
};
const topic = {
	id: 10,
	title: 'Topic',
	slug: 'topic',
	draft_key: 'topic_10',
	draft_sequence: 3,
	post_stream: { stream: [20] },
};
const post = {
	id: 20,
	topic_id: 10,
	post_number: 2,
	username: 'author',
	actions_summary: [],
};
const errors: unknown[] = [];
const { document: composerWindowDocument } = parseHTML(
	'<!doctype html><html><body><section id="reply-control" class="closed"></section></body></html>',
);
const presentedComposerWindows: HTMLElement[] = [];
const coordinator = new DiscourseComposerCoordinator({
	host,
	document: composerWindowDocument as unknown as Document,
	composerOpenTimeoutMs: 1,
	waitForDelay: async () => {},
	onError: (error) => errors.push(error),
});
coordinator.bindWindow({
	open(element) {
		if (element) presentedComposerWindows.push(element);
		return Boolean(element);
	},
});
assert(
	coordinator.warmReply() &&
		Number(draftCalls.length) === 0 &&
		Number(openOptions.length) === 0 &&
		Reflect.get(service, 'model') === null &&
		Number(presentedComposerWindows.length) === 0,
	'回复预热只能解析宿主 service/module，不能读取 draft、打开 Composer 或创建窗口',
);
composerWindowDocument.querySelector('#reply-control')?.classList.remove('closed');
const [opened, sameOpened] = await Promise.all([
	coordinator.openReply({ topic, post, initialRaw: '图片引用' }),
	coordinator.openReply({ topic, post, initialRaw: '图片引用' }),
]);
assert(
	opened === sameOpened &&
	!opened.reused &&
	opened.parentPostNumber === 2 &&
	draftCalls.join(',') === 'topic_10' &&
	openOptions.length === 1 &&
	openOptions[0]?.reply === '已有草稿\n图片引用' &&
	openOptions[0]?.draftSequence === 4 &&
	presentedComposerWindows.length === 1,
	'并发普通/灯箱回复必须 single-flight，并通过 Discourse Draft/model/composer 打开',
);
const reused = await coordinator.openReply({
	topic,
	post: { ...post, id: 21, post_number: 3 },
	initialRaw: '第二张图',
});
assert(
	reused.reused &&
	reused.parentPostNumber === 3 &&
	inserted.join(',') === 'composer:insert-block:第二张图' &&
	service.model?.post &&
	(service.model.post as TestModel).post_number === 3,
	'同 Topic 已打开回复必须复用原生 composer 并更新目标/插入块',
);
assert(
	Number(presentedComposerWindows.length) === 2,
	'复用已打开 Composer 时也必须显式把原生窗口交给唯一浮窗 owner，不能等待偶发 DOM mutation',
);
const replaced = await coordinator.openReply({
	topic,
	post,
	initialRaw: '灯箱内联评论正文',
	replaceRaw: true,
});
assert(
	replaced.reused &&
	service.model?.reply === '灯箱内联评论正文' &&
	inserted.join(',') === 'composer:insert-block:第二张图',
	'内联评论提交必须原子替换原生 composer raw，不能混入已有草稿或重复 insert-block',
);
const priorReplyModel = service.model;
const postTopicOnlyModel = model({
	action: 'reply',
	post: model({ id: 21, topic: model({ id: 10 }) }),
	viewOpen: true,
	composeState: 'open',
});
service.model = postTopicOnlyModel;
const reusedPostTopicReply = await coordinator.openReply({ topic, post });
assert(
	reusedPostTopicReply.reused &&
		reusedPostTopicReply.model === postTopicOnlyModel,
	'私信或楼层回复的 Topic 只挂在 composer.model.post.topic 时也必须识别为当前 Topic 并复用浮窗',
);
service.model = priorReplyModel;
const { document: parsedDocument, window: parsedWindow } = parseHTML(`
	<!doctype html><html><body><div id="reply-control">
		<button class="toggle-save-and-close"></button>
		<button class="discard-button"></button>
	</div></body></html>
`);
const document = parsedDocument as unknown as Document;
const closeNotices: string[] = [];
let closeGuardEnabled = true;
const resetDiscardModel = (): void => {
	service.model = model({
		action: 'reply',
		topic: model({ id: 10 }),
		viewOpen: true,
		composeState: 'open',
		clearState() {
			clearStateCalls += 1;
		},
	});
};
resetDiscardModel();
coordinator.installCloseGuard({
	document,
	enabled: () => closeGuardEnabled,
	notify: (message) => closeNotices.push(message),
});
const dispatchClick = (selector: string): Event => {
	const event = new parsedWindow.Event('click', {
		bubbles: true,
		cancelable: true,
	});
	document.querySelector<HTMLElement>(selector)!.dispatchEvent(event);
	return event;
};
assert(
	dispatchClick('.toggle-save-and-close').defaultPrevented &&
		dispatchClick('.discard-button').defaultPrevented &&
		dispatchClick('.discard-button').defaultPrevented &&
		closeNotices.join(',') ===
			'再点一次关闭回复窗口,再点一次舍弃回复',
	'Composer owner 必须按独立 action key 保护关闭/舍弃，不能由阅读队列监听原生按钮',
);
await Promise.resolve();
await Promise.resolve();
assert(
	discardDraftCalls === 1 &&
		discardCloseCalls === 1 &&
		clearStateCalls === 1,
	'二次确认舍弃必须由 Composer owner 删除草稿后关闭，不得先落入宿主关闭链',
);
const dispatchEscape = (): Event => {
	const event = new parsedWindow.Event('keydown', {
		bubbles: true,
		cancelable: true,
	});
	Object.defineProperty(event, 'key', { value: 'Escape' });
	document.querySelector<HTMLElement>('#reply-control')!.dispatchEvent(event);
	return event;
};
resetDiscardModel();
assert(
	dispatchEscape().defaultPrevented &&
		dispatchEscape().defaultPrevented,
	'已打开 Composer 的 Esc 必须由 Composer owner 在期限内二次确认',
);
await Promise.resolve();
await Promise.resolve();
assert(
	Number(discardDraftCalls) === 2 &&
	Number(discardCloseCalls) === 2 &&
	Number(clearStateCalls) === 2,
	'Esc 确认后必须直接舍弃草稿，不能让宿主先最小化 Composer',
);
assert(
	dispatchClick('.toggle-save-and-close').defaultPrevented,
	'启用关闭确认时首次关闭必须建立新的独立确认期限',
);
closeGuardEnabled = false;
assert(
	!dispatchClick('.toggle-save-and-close').defaultPrevented,
	'关闭确认偏好关闭后必须把原生 Composer 事件完整放行',
);
resetDiscardModel();
assert(
	dispatchClick('.discard-button').defaultPrevented,
	'关闭确认偏好关闭后，单击舍弃仍必须由 Composer owner 删除草稿',
);
await Promise.resolve();
await Promise.resolve();
assert(
	Number(discardDraftCalls) === 3 &&
	Number(discardCloseCalls) === 3 &&
	Number(clearStateCalls) === 3,
	'单击舍弃必须执行 destroyDraft、clearState 和 close',
);
closeGuardEnabled = true;
assert(
	dispatchClick('.toggle-save-and-close').defaultPrevented,
	'关闭确认偏好重新启用后不得继承停用前的确认期限',
);
service.model = priorReplyModel;
service.model.viewOpen = true;
service.model.composeState = 'open';
Reflect.deleteProperty(service, 'close');
const [firstConcurrent, secondConcurrent] = await Promise.all([
	coordinator.openReply({ topic, post, initialRaw: '并发引用 A' }),
	coordinator.openReply({
		topic,
		post: { ...post, id: 21, post_number: 3 },
		initialRaw: '并发引用 B',
	}),
]);
assert(
	firstConcurrent !== secondConcurrent &&
	inserted.slice(-2).join(',') ===
		'composer:insert-block:并发引用 A,composer:insert-block:并发引用 B' &&
	(service.model?.post as TestModel).post_number === 3,
	'不同目标的并发 composer 请求必须按序执行，不能被全局 single-flight 静默合并',
);
assert(errors.length === 0, '正常原生 composer 路径不得产生诊断');

const { document: staleParsedDocument } = parseHTML(
	'<!doctype html><html><body><section id="reply-control" class="d-none"></section></body></html>',
);
const staleDocument = staleParsedDocument as unknown as Document;
const staleService = {
	model: model({
		action: 'reply',
		topic: model({ id: 99 }),
		post: model({ id: 20, post_number: 2 }),
		viewOpen: true,
		composeState: 'open',
	}),
	appEvents: service.appEvents,
	close() {
		closeCalls += 1;
		this.model = model({ viewOpen: false, composeState: 'closed' });
		staleDocument.querySelector('#reply-control')?.remove();
	},
	async open(options: Record<string, unknown>) {
		openOptions.push(options);
		this.model = model({
			...options,
			topic: (options.post as TestModel | undefined)?.topic ?? options.topic,
			viewOpen: true,
			composeState: 'open',
		});
		staleDocument.body.innerHTML =
			'<div id="reply-control"><textarea class="d-editor-input"></textarea></div>';
	},
};
const staleHost: DiscourseHostApiPort = {
	lookup(name) {
		return name === 'service:composer'
			? staleService
			: name === 'service:app-events'
				? staleService.appEvents
				: null;
	},
	lookupModule(name) {
		return modules[name] ?? null;
	},
};
const nativeDateNow = Date.now;
let composerClock = 0;
Date.now = () => composerClock;
const staleCoordinator = new DiscourseComposerCoordinator({
	host: staleHost,
	document: staleDocument,
	waitForDelay: async (milliseconds) => {
		composerClock += milliseconds;
	},
});
const staleOpenOptionsBefore = openOptions.length;
const recoveredStaleComposer = await staleCoordinator.openReply({ topic, post });
Date.now = nativeDateNow;
assert(
	!recoveredStaleComposer.reused &&
		closeCalls === 1 &&
		openOptions.length === staleOpenOptionsBefore + 1 &&
		staleDocument.querySelector('#reply-control textarea.d-editor-input'),
	'原生 model 声称已打开但回复 DOM 已隐藏时，必须关闭陈旧状态并重新调用 Discourse composer.open',
);
staleCoordinator.destroy();

service.model = null;
const editablePost = { ...post, raw: '最新 raw' };
const editOpenOptionsBefore = openOptions.length;
const [edited, sameEdited] = await Promise.all([
	coordinator.openEdit({ topic, post: editablePost }),
	coordinator.openEdit({ topic, post: editablePost }),
]);
assert(
	edited === sameEdited &&
	!edited.reused &&
	edited.parentPostNumber === 2 &&
	openOptions.length === editOpenOptionsBefore + 1 &&
	openOptions.at(-1)?.action === 'edit' &&
	(openOptions.at(-1)?.post as TestModel).raw === '最新 raw' &&
	openOptions.at(-1)?.draftKey === 'topic_10' &&
	openOptions.at(-1)?.draftSequence === 3,
	'编辑必须 single-flight，并用最新 canonical Post model 打开原生 Composer.EDIT',
);
const reusedEdit = await coordinator.openEdit({ topic, post: editablePost });
assert(
	reusedEdit.reused &&
	reusedEdit.model === service.model,
	'同一楼层已打开的原生 edit composer 必须安全复用',
);

const { document: missingEditParsedDocument } = parseHTML(
	'<!doctype html><html><body><section id="reply-control" class="closed"></section></body></html>',
);
const missingEditService = {
	model: null as ReturnType<typeof model> | null,
	async open(options: Record<string, unknown>) {
		this.model = model({
			...options,
			topic: (options.post as TestModel | undefined)?.topic ?? options.topic,
			viewOpen: true,
			composeState: 'open',
		});
	},
};
const missingEditHost: DiscourseHostApiPort = {
	lookup(name) {
		return name === 'service:composer' ? missingEditService : null;
	},
	lookupModule(name) {
		return modules[name] ?? null;
	},
};
const missingEditCoordinator = new DiscourseComposerCoordinator({
	host: missingEditHost,
	document: missingEditParsedDocument as unknown as Document,
	composerOpenTimeoutMs: 1,
	waitForDelay: async () => {},
});
let missingEditError: unknown = null;
try {
	await missingEditCoordinator.openEdit({ topic, post: editablePost });
} catch (error) {
	missingEditError = error;
}
assert(
	missingEditError instanceof Error &&
		missingEditError.message.includes('编辑浮窗未显示'),
	'composer.open 未产生可见编辑浮窗时必须失败，不能让调用方误报编辑器已打开',
);
missingEditCoordinator.destroy();

service.model = null;
const privateMessageWindowCount = presentedComposerWindows.length;
const composerDefaultView = composerWindowDocument.defaultView as Window & {
	getComputedStyle?: (element: Element) => CSSStyleDeclaration;
};
const nativeGetComputedStyle = composerDefaultView.getComputedStyle;
Object.defineProperty(composerDefaultView, 'getComputedStyle', {
	configurable: true,
	value: () => ({
		display: 'block',
		visibility: 'hidden',
	}) as CSSStyleDeclaration,
});
const [privateMessage, samePrivateMessage] = await Promise.all([
	coordinator.openPrivateMessage('@Alice Smith'),
	coordinator.openPrivateMessage('Alice Smith'),
]);
assert(
	privateMessage === samePrivateMessage &&
		privateMessage.username === 'Alice Smith' &&
		privateMessageOpenOptions.length === 1 &&
		privateMessageOpenOptions[0]?.recipients === 'Alice Smith' &&
		presentedComposerWindows.length === privateMessageWindowCount + 1 &&
		presentedComposerWindows.at(-1) ===
			composerWindowDocument.querySelector('#reply-control'),
	'私信必须 single-flight 调用原生 composer.openNewMessage，并在宿主浮窗出现后交给 Reader Composer window',
);
if (nativeGetComputedStyle) {
	Object.defineProperty(composerDefaultView, 'getComputedStyle', {
		configurable: true,
		value: nativeGetComputedStyle,
	});
} else {
	Reflect.deleteProperty(composerDefaultView, 'getComputedStyle');
}
service.model = null;
composerWindowDocument.querySelector('#reply-control')?.classList.add('closed');
const missingPrivateMessageCoordinator = new DiscourseComposerCoordinator({
	host,
	document: composerWindowDocument as unknown as Document,
	composerOpenTimeoutMs: 1,
	waitForDelay: async () => {},
});
let missingPrivateMessageError: unknown = null;
try {
	await missingPrivateMessageCoordinator.openPrivateMessage('alice');
} catch (error) {
	missingPrivateMessageError = error;
}
assert(
	missingPrivateMessageError instanceof Error &&
		missingPrivateMessageError.message.includes('私信浮窗未显示'),
	'composer.openNewMessage 未产生宿主私信浮窗时必须失败，不能让用户卡误报成功并关闭',
);
missingPrivateMessageCoordinator.destroy();
composerWindowDocument.querySelector('#reply-control')?.classList.remove('closed');

const { document: unownedPrivateMessageParsedDocument } = parseHTML(
	'<!doctype html><html><body><section id="reply-control"><textarea></textarea></section></body></html>',
);
let unownedPrivateMessageCloseCalls = 0;
const unownedPrivateMessageService = {
	model: null as ReturnType<typeof model> | null,
	async openNewMessage(options: Record<string, unknown>) {
		this.model = model({
			action: 'privateMessage',
			targetRecipients: options.recipients,
			viewOpen: true,
			composeState: 'open',
		});
	},
	close() {
		unownedPrivateMessageCloseCalls += 1;
		this.model = model({ viewOpen: false, composeState: 'closed' });
	},
};
const unownedPrivateMessageCoordinator = new DiscourseComposerCoordinator({
	host: {
		lookup(name) {
			return name === 'service:composer'
				? unownedPrivateMessageService
				: null;
		},
		lookupModule: () => null,
	},
	document: unownedPrivateMessageParsedDocument as unknown as Document,
});
let unownedPrivateMessageError: unknown = null;
try {
	await unownedPrivateMessageCoordinator.openPrivateMessage('alice');
} catch (error) {
	unownedPrivateMessageError = error;
}
assert(
	unownedPrivateMessageError instanceof Error &&
		unownedPrivateMessageError.message.includes('Reader 私信浮窗未接管') &&
		unownedPrivateMessageCloseCalls === 1,
	'Reader 窗口 owner 未接管私信 Composer 时必须关闭底部原生浮窗并报告失败',
);
unownedPrivateMessageCoordinator.destroy();

service.model = model({
	action: 'edit',
	topic: model({ id: 10 }),
	post: model({ id: 99 }),
	viewOpen: true,
});
try {
	await coordinator.openReply({ topic, post });
	throw new Error('不得覆盖正在进行的原生 edit composer');
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('另一项编辑'),
		'冲突的原生 composer 必须显式拒绝，不能丢失用户草稿',
	);
}
coordinator.destroy();

service.model = null;
document.body.innerHTML = `
	<div id="reply-control">
		<div class="save-or-cancel"><button class="create">回复</button></div>
	</div>
`;
const isolation = new DiscourseComposerHostIsolation({ host });
const guardedCoordinator = new DiscourseComposerCoordinator({
	host,
	isolation,
});
await guardedCoordinator.openReply({ topic, post });
guardedCoordinator.installSubmitGuard({ document });
const submit = dispatchClick('.save-or-cancel button.create');
await Promise.resolve();
await Promise.resolve();
assert(
	submit.defaultPrevented &&
		saveCalls.length === 1 &&
		saveCalls[0]?.[0] === true &&
		(saveCalls[0]?.[1] as { jump?: unknown }).jump === false,
	'Reader 打开的原生 Composer 提交按钮必须由唯一隔离 owner 截获并用 jump:false 保存',
);
guardedCoordinator.destroy();
isolation.destroy();

const earlyHost: DiscourseHostApiPort = {
	lookup: () => null,
	lookupModule: () => null,
};
const earlyIsolation = new DiscourseComposerHostIsolation({ host: earlyHost });
let earlyEvents = 0;
const stopEarlyEvents = earlyIsolation.subscribe(() => {
	earlyEvents += 1;
});
stopEarlyEvents();
earlyIsolation.destroy();
assert(
	earlyEvents === 0,
	'document-start 尚无 app-events 时只读 Composer 订阅必须局部降级，不能阻断 Reader 启动',
);
