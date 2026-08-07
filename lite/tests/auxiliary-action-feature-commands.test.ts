import {
	BookmarkActionFeatureCommands,
} from '../src/post/bookmark-action-feature-commands.js';
import {
	DiscourseActionDescriptors,
} from '../src/post/discourse-action-descriptors.js';
import {
	NotificationActionFeatureCommands,
} from '../src/post/notification-action-feature-commands.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const nativeActions = new DiscourseActionDescriptors();
const notificationEvents: string[] = [];
let notificationRefreshes = 0;
const notifications = new NotificationActionFeatureCommands({
	state: {
		markAllRead(source, observedAt) {
			notificationEvents.push(`all:${source}:${observedAt}`);
		},
		markRead(id, source, observedAt) {
			notificationEvents.push(`${id}:${source}:${observedAt}`);
		},
		async refresh() {
			notificationRefreshes += 1;
		},
	},
	now: () => 400,
});
const markAll = notifications.markAllRead(nativeActions.notificationsMarkRead());
await markAll.commit?.();
const markOne = notifications.markRead(
	8,
	nativeActions.notificationMarkRead({ notificationId: 8 }),
);
await markOne.commit?.();
assert(
	notificationEvents.join(',') ===
	'all:action-response:400,8:action-response:400',
	'通知已读结果必须进入唯一通知状态端口',
);
await markOne.reconcile?.(new Error('local failure'), undefined);
assert(notificationRefreshes === 1, '通知本地归并失败必须刷新');

let removedBookmarks = '';
let bookmarkRefreshes = 0;
const bookmarks = new BookmarkActionFeatureCommands({
	state: {
		removeBookmarks(ids, source, observedAt) {
			removedBookmarks = `${ids.join(',')}:${source}:${observedAt}`;
		},
		async refresh() {
			bookmarkRefreshes += 1;
		},
	},
	now: () => 500,
});
const bulkDelete = bookmarks.bulkDelete(
	[9, 8, 9],
	nativeActions.bookmarkBulkDelete({ bookmarkIds: [9, 8, 9] }),
);
await bulkDelete.commit?.({ deletedBookmarkIds: [8, 9] });
assert(
	removedBookmarks === '8,9:action-response:500',
	'批量收藏删除必须排序去重后提交唯一集合状态',
);
await bulkDelete.reconcile?.(new Error('local failure'), { deletedBookmarkIds: [8, 9] });
assert(bookmarkRefreshes === 1, '收藏本地归并失败必须刷新');
const deleteOne = bookmarks.delete(
	12,
	nativeActions.bookmarkDelete({ bookmarkId: 12 }),
);
await deleteOne.commit?.({ bookmarked: false, bookmarkId: null });
assert(
	String(removedBookmarks) === '12:action-response:500',
	'单条收藏删除必须复用同一集合状态归并端口',
);
let rejectedBulkMismatch = false;
try {
	bookmarks.bulkDelete(
		[8, 9],
		nativeActions.bookmarkBulkDelete({ bookmarkIds: [10, 11] }),
	);
} catch (error) {
	assert(
		error instanceof Error && error.message.includes('contract'),
		'批量删除 descriptor 集合错配诊断错误',
	);
	rejectedBulkMismatch = true;
}
assert(rejectedBulkMismatch, '批量删除命令不得接受另一组 bookmark descriptor');
