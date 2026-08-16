import { parseHTML } from 'linkedom';
import { ReaderActionSurfaceCoordinator } from '../src/shell/reader-action-surface-coordinator.js';
import { ReaderAssignmentFormSurface } from '../src/shell/reader-assignment-form-surface.js';
import { ReaderFeedbackSurface } from '../src/shell/reader-feedback-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body><main></main></body></html>',
);
const document = parsedDocument as unknown as Document;
const root = document.querySelector<HTMLElement>('main')!;
const coordinator = new ReaderActionSurfaceCoordinator();
const feedback = new ReaderFeedbackSurface({
	document,
	root,
	coordinator,
	focusSoon: (callback) => callback(),
});
const assignment = new ReaderAssignmentFormSurface({
	document,
	root,
	coordinator,
	users: { searchUsers: async () => Object.freeze([]) },
	focusSoon: (callback) => callback(),
});

const confirmation = feedback.confirm({
	title: '先打开确认',
	message: '随后应被指定表单原子替换',
});
const assignmentRequest = assignment.open({
	title: '指定负责人',
	intro: '共享主线活动槽',
	submit() {},
});
assert(
	await confirmation === false &&
		root.querySelectorAll('.ldp-reader-action-layer').length === 1 &&
		root.querySelector('.ldp-reader-action-head strong')?.textContent ===
			'指定负责人',
	'跨类型新弹层必须取消旧 Promise，并始终复用 main.js 的单一活动槽',
);

const replacement = feedback.confirm({
	title: '确认接管',
	message: '指定表单应被取消',
});
assert(
	await assignmentRequest === false &&
		coordinator.active &&
		root.querySelectorAll('.ldp-reader-action-layer').length === 1 &&
		root.querySelector('.ldp-reader-confirm-copy strong')?.textContent ===
			'确认接管',
	'确认、举报和指定必须经同一协调器互斥，不能各自留下 layer',
);

assert(
	coordinator.closeActive() &&
		await replacement === false &&
		!coordinator.active &&
		!root.querySelector('.ldp-reader-action-layer'),
	'应用关闭必须能同步释放当前操作弹层及其悬挂 Promise',
);

const finalConfirmation = feedback.confirm({
	title: '销毁确认',
	message: '销毁仍需取消当前事务',
});

coordinator.destroy();
assert(
	await finalConfirmation === false &&
		!root.querySelector('.ldp-reader-action-layer'),
	'共享协调器销毁必须取消当前事务并释放唯一活动 layer',
);
feedback.destroy();
assignment.destroy();
