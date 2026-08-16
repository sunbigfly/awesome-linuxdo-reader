import {
	READER_SETTINGS_RESET_REMINDER_CAMPAIGN,
	READER_SETTINGS_RESET_REMINDER_STORAGE_KEY,
	showReaderSettingsResetReminder,
} from '../src/settings/reader-settings-reset-reminder.js';
import type {
	ReaderConfirmRequest,
} from '../src/shell/reader-feedback-surface.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class MemoryStorage implements Pick<Storage, 'getItem' | 'setItem'> {
	readonly values = new Map<string, string>();

	getItem(key: string): string | null {
		return this.values.get(key) ?? null;
	}

	setItem(key: string, value: string): void {
		this.values.set(key, value);
	}
}

const preferencesStorageKey = 'reader-preferences';
const defaults = Object.freeze({ theme: 'system', depth: 3 });

assert(
	READER_SETTINGS_RESET_REMINDER_CAMPAIGN === 'settings-contract-2026-08-r3',
	'1.5.0 设置契约必须递增恢复提醒锚点，重新覆盖已消费 r2 的已有用户',
);

const freshStorage = new MemoryStorage();
let freshConfirmations = 0;
const freshResult = await showReaderSettingsResetReminder({
	storage: freshStorage,
	preferencesStorageKey,
	defaults,
	update: () => {
		throw new Error('新用户不得恢复设置');
	},
	feedback: {
		confirm: async () => {
			freshConfirmations += 1;
			return true;
		},
		show: () => {},
	},
});
assert(
	freshResult === 'skipped' &&
	freshConfirmations === 0 &&
	freshStorage.getItem(READER_SETTINGS_RESET_REMINDER_STORAGE_KEY) ===
		READER_SETTINGS_RESET_REMINDER_CAMPAIGN,
	'新用户必须静默锁定当前 campaign，不能在首次安装时提示恢复默认',
);

const storage = new MemoryStorage();
storage.setItem(preferencesStorageKey, JSON.stringify({ depth: 8 }));
storage.setItem(
	READER_SETTINGS_RESET_REMINDER_STORAGE_KEY,
	'settings-contract-2026-08-r2',
);
const confirmations: ReaderConfirmRequest[] = [];
const updates: Readonly<typeof defaults>[] = [];
const notices: string[] = [];
let confirm = false;
const options = {
	storage,
	preferencesStorageKey,
	defaults,
	update: (preferences: Readonly<typeof defaults>) => {
		updates.push(preferences);
	},
	feedback: {
		confirm: async (request: ReaderConfirmRequest) => {
			confirmations.push(request);
			return confirm;
		},
		show: (message: string) => notices.push(message),
	},
};

assert(
	await showReaderSettingsResetReminder(options) === 'kept' &&
	confirmations.length === 1 &&
	confirmations[0]?.message?.includes('完整应用新版体验') === true &&
	confirmations[0]?.note?.includes('阅读队列图标位置') === true &&
	confirmations[0]?.note?.includes('队列条目') === true &&
	confirmations[0]?.confirmLabel === '恢复默认值' &&
	confirmations[0]?.cancelLabel === '保留当前设置' &&
	storage.getItem(READER_SETTINGS_RESET_REMINDER_STORAGE_KEY) ===
		READER_SETTINGS_RESET_REMINDER_CAMPAIGN &&
	updates.length === 0,
	'已消费 r2 的老用户升级到 r3 后必须只再收到一次可保留当前设置的体验提示',
);
assert(
	await showReaderSettingsResetReminder(options) === 'skipped' &&
	confirmations.length === 1,
	'同一 campaign 后续启动必须保持锁定，不能重复提示',
);

confirm = true;
assert(
	await showReaderSettingsResetReminder({
		...options,
		campaign: `${READER_SETTINGS_RESET_REMINDER_CAMPAIGN}-next`,
	}) === 'reset' &&
	Number(confirmations.length) === 2 &&
	Number(updates.length) === 1 &&
	updates[0] === defaults &&
	notices.at(-1) === '全部设置已恢复默认',
	'递增 campaign 必须为下一次大改动解锁提示，并在确认后写入同一份 schema 默认值',
);
