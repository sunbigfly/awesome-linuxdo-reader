import {
	READER_BUSINESS_REQUEST_DEFAULTS,
	expandReaderBusinessRequestSettings,
	flattenReaderBusinessRequestSettings,
	normalizeReaderBusinessRequestSettings,
	readerBusinessRequestSettingsAreDefault,
	readerBusinessRequestSettingsEqual,
} from '../src/network/reader-business-request-config.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

assert(
	READER_BUSINESS_REQUEST_DEFAULTS['topic-download'].maxConcurrent === 1 &&
		READER_BUSINESS_REQUEST_DEFAULTS['topic-download']
			.backgroundRequestsPerMinute === 24 &&
		READER_BUSINESS_REQUEST_DEFAULTS.notifications.maxConcurrent === 3 &&
		READER_BUSINESS_REQUEST_DEFAULTS.bookmarks.maxConcurrent === 2 &&
		readerBusinessRequestSettingsAreDefault(
			READER_BUSINESS_REQUEST_DEFAULTS,
		),
	'四类业务请求参数必须具有稳定且互相独立的默认值',
);

const normalized = normalizeReaderBusinessRequestSettings({
	'topic-download': {
		maxConcurrent: 99,
		backgroundMinIntervalMs: 1,
		backgroundRequestsPerMinute: 999,
	},
	bookmarks: {
		maxConcurrent: 1,
		backgroundMinIntervalMs: 500,
		backgroundRequestsPerMinute: 12,
	},
});
assert(
	normalized['topic-download'].maxConcurrent === 4 &&
		normalized['topic-download'].backgroundMinIntervalMs === 80 &&
		normalized['topic-download'].backgroundRequestsPerMinute === 120 &&
		normalized['user-observation'].maxConcurrent ===
			READER_BUSINESS_REQUEST_DEFAULTS['user-observation'].maxConcurrent &&
		normalized.bookmarks.backgroundMinIntervalMs === 500,
	'业务请求参数必须逐字段钳制，并为缺失业务保留默认快照',
);

const roundTrip = expandReaderBusinessRequestSettings(
	flattenReaderBusinessRequestSettings(normalized),
);
assert(
	readerBusinessRequestSettingsEqual(normalized, roundTrip) &&
		!readerBusinessRequestSettingsAreDefault(roundTrip) &&
		Object.isFrozen(roundTrip) &&
		Object.values(roundTrip).every(Object.isFrozen),
	'设置表单的扁平草稿必须无损往返唯一嵌套业务参数，并保持只读快照',
);
