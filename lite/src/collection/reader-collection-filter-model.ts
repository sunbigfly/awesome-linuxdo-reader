export type ReaderCollectionSortDirection = 'desc' | 'asc';

/** 集合日历统一使用浏览器本地日期，避免通知、收藏与历史各自偏移时区。 */
export function readerCollectionDateKey(value: string | number): string {
	const timestamp = typeof value === 'number' ? value : Date.parse(value);
	if (!Number.isFinite(timestamp)) return '';
	const date = new Date(timestamp);
	return [
		date.getFullYear(),
		String(date.getMonth() + 1).padStart(2, '0'),
		String(date.getDate()).padStart(2, '0'),
	].join('-');
}
