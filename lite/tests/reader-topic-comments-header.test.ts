import { parseHTML } from 'linkedom';
import { PostView } from '../src/dom/post-view.js';
import { Signal } from '../src/kernel/signal.js';
import {
	ReaderTopicCommentsHeader,
} from '../src/topic/reader-topic-comments-header.js';
import type { TopicSessionCommit } from '../src/topic/topic-session.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument } = parseHTML(
	'<!doctype html><html><body></body></html>',
);
const document = parsedDocument as unknown as Document;
const changes = new Signal<TopicSessionCommit>();
const topic = { posts_count: 3, highest_post_number: 3 };
const posts = [
	{ id: 10, post_number: 1, username: 'op' },
	{ id: 11, post_number: 2, username: 'alice' },
	{ id: 12, post_number: 3, username: 'bob' },
];
let presenceListener:
	(users: readonly {
		readonly username: string;
		readonly name: string;
		readonly avatarTemplate: string;
	}[]) => void = () => {};
let presenceCleanups = 0;
const feature = new ReaderTopicCommentsHeader({
	document,
	topicId: 9,
	session: {
		topic,
		changes,
		cachedPosts: () => posts,
	},
	presence: {
		watchReplying(topicId, listener) {
			assert(topicId === 9, '评论区 Presence 必须绑定当前 Topic');
			presenceListener = listener;
			return () => {
				presenceCleanups += 1;
			};
		},
	},
	presentation: {
		avatarSource(template, size) {
			return template.replace('{size}', String(size));
		},
		categoryHref: () => '',
		tagHref: () => '',
		userHref: (username) => `/u/${username}`,
	},
	currentUsername: 'me',
	renderIcon(_name, iconDocument) {
		return iconDocument.createElement('svg');
	},
});
const rootPost = new PostView(document, {
	postId: 10,
	postNumber: 1,
	username: 'op',
});
feature.afterRender(posts[0]!, rootPost);
const header = rootPost.slots.root.querySelector<HTMLElement>(
	':scope > .ldp-comments-header',
);
assert(
	rootPost.slots.root.isConnected === false &&
	header?.previousElementSibling === rootPost.slots.replyTree &&
	header.nextElementSibling === null &&
	header.querySelector('.ldp-comments-count')?.textContent === '（2）',
	'评论区标题必须在 PostView 挂载前投影 canonical 总数，并锚定在楼主树状子回复之后',
);
document.body.append(rootPost.slots.root);
presenceListener([
	{
		username: 'me',
		name: 'Me',
		avatarTemplate: '',
	},
	{
		username: 'alice',
		name: 'Alice',
		avatarTemplate: '/avatar/{size}.png',
	},
]);
const presence = header.querySelector<HTMLElement>('.ldp-topic-presence');
assert(
	presence?.hidden === false &&
	presence.querySelectorAll('.ldp-topic-presence-user').length === 1 &&
	presence.querySelector<HTMLAnchorElement>('a')?.href.endsWith('/u/alice') &&
	presence.querySelector<HTMLImageElement>('img')?.src.endsWith('/avatar/24.png'),
	'评论区 Presence 必须过滤自己并复用原生用户/头像展示端口',
);
topic.posts_count = 5;
changes.emit({ changedPostNumbers: [] } as unknown as TopicSessionCommit);
assert(
	header.querySelector('.ldp-comments-count')?.textContent === '（4）',
	'TopicSession 更新必须实时刷新评论总数',
);

const reply = new PostView(document, {
	postId: 11,
	postNumber: 2,
	username: 'alice',
});
document.body.append(reply.slots.root);
feature.afterRender(posts[1]!, reply);
assert(
	!reply.slots.root.querySelector('.ldp-comments-header'),
	'普通回复不得复制主帖评论分隔组件',
);
feature.destroy();
assert(presenceCleanups === 1, '评论区销毁必须释放 Presence 订阅');
rootPost.destroy();
reply.destroy();
