import {
	readerLightboxImageOrderMarker,
	readerLightboxImageQuoteRaw,
} from '../src/media/reader-lightbox-image-quote.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const marker = readerLightboxImageOrderMarker(2);
assert(
	/^\u2063[\u200B\u200C]{8}\u2064$/.test(marker),
	'图片顺序必须使用 matcher 可逆识别的隐形二进制标记',
);
const raw = readerLightboxImageQuoteRaw({
	image: {
		key: '10:3:2',
		topicId: 10,
		sourcePostNumber: 3,
		imageOrder: 2,
		originalSrc: 'https://linux.do/a<large>.png',
	},
	username: '@author,\n',
	alt: '图[二]\\',
});
assert(
	raw.startsWith('[quote="author, post:3, topic:10"]\n') &&
	raw.includes('![图\\[二\\]\\\\') &&
	raw.includes('](<https://linux.do/a%3Clarge%3E.png>)') &&
	raw.endsWith('[/quote]\n\n'),
	'图片评论与正文引用必须复用同一安全 Discourse quote raw',
);
