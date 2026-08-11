import type {
	ReaderConfirmRequest,
} from '../shell/reader-feedback-surface.js';

export const READER_SETTINGS_RESET_REMINDER_STORAGE_KEY =
	'linuxdo-enhanced-reader:settings-reset-reminder';

/**
 * 只有需要用户重新确认默认设置的大改动才递增；普通版本更新不改此值。
 */
export const READER_SETTINGS_RESET_REMINDER_CAMPAIGN =
	'settings-contract-2026-08';

export type ReaderSettingsResetReminderResult =
	| 'skipped'
	| 'kept'
	| 'reset'
	| 'failed';

export interface ReaderSettingsResetReminderOptions<
	TPreferences extends object,
> {
	readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
	readonly preferencesStorageKey: string;
	readonly defaults: Readonly<TPreferences>;
	readonly update: (preferences: Readonly<TPreferences>) => void;
	readonly feedback: Readonly<{
		confirm(request: ReaderConfirmRequest): Promise<boolean>;
		show(message: string): void;
	}>;
	readonly campaign?: string;
	readonly reminderStorageKey?: string;
	readonly isActive?: () => boolean;
	readonly onError?: (cause: unknown) => void;
}

function nonEmpty(value: string, name: string): string {
	const normalized = String(value).trim();
	if (!normalized) throw new Error(`${name} 不能为空`);
	return normalized;
}

/**
 * 在 Reader 首次真正显示后调用。当前 campaign 会在展示前锁定；未来大改动只需递增
 * campaign，即可重新解锁一次提示。没有历史偏好的新用户只写入锁，不显示无意义提示。
 */
export async function showReaderSettingsResetReminder<
	TPreferences extends object,
>(
	options: ReaderSettingsResetReminderOptions<TPreferences>,
): Promise<ReaderSettingsResetReminderResult> {
	const campaign = nonEmpty(
		options.campaign ?? READER_SETTINGS_RESET_REMINDER_CAMPAIGN,
		'设置恢复提示 campaign',
	);
	const reminderStorageKey = nonEmpty(
		options.reminderStorageKey ??
			READER_SETTINGS_RESET_REMINDER_STORAGE_KEY,
		'设置恢复提示 storage key',
	);
	const preferencesStorageKey = nonEmpty(
		options.preferencesStorageKey,
		'偏好 storage key',
	);
	let hasStoredPreferences = false;
	try {
		if (options.storage.getItem(reminderStorageKey) === campaign) {
			return 'skipped';
		}
		hasStoredPreferences =
			options.storage.getItem(preferencesStorageKey) !== null;
		options.storage.setItem(reminderStorageKey, campaign);
	} catch (cause) {
		options.onError?.(cause);
		return 'failed';
	}
	if (!hasStoredPreferences) return 'skipped';

	let confirmed = false;
	try {
		confirmed = await options.feedback.confirm({
			title: '设置有较大更新',
			message:
				'本次更新调整了部分设置和默认值，建议恢复默认值，以完整应用新版体验。',
			note:
				'只重置阅读器设置；浏览历史、帖子缓存和账号数据不会删除。此提示仅显示一次。',
			confirmLabel: '恢复默认值',
			cancelLabel: '保留当前设置',
			tone: 'primary',
			icon: 'rotate-ccw',
		});
	} catch (cause) {
		options.onError?.(cause);
		return 'failed';
	}
	if (!confirmed || options.isActive?.() === false) return 'kept';

	try {
		options.update(options.defaults);
		options.feedback.show('全部设置已恢复默认');
		return 'reset';
	} catch (cause) {
		options.onError?.(cause);
		try {
			options.feedback.show('恢复默认设置失败，当前设置保持不变');
		} catch {
			// runtime 已销毁时不再尝试创建第二条提示。
		}
		return 'failed';
	}
}
