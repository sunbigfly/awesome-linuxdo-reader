import {
	consumeReaderNativeBypass,
	consumeReaderNativeTabBypass,
	openReaderNativeTopicTab,
	READER_NATIVE_BYPASS_TAB_KEY,
	readerNativeBypassCleanHref,
	readerNativeTopicHref,
} from '../src/topic/reader-native-topic-route.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const base = 'https://linux.do/latest';
const nativeHref = readerNativeTopicHref(
	'/t/example/42?value=1#post_7',
	base,
);
assert(
	nativeHref ===
		'https://linux.do/t/example/42?value=1&ldp_native=1#post_7',
	'原生主题入口必须保留既有 query/hash，并只追加唯一绕过参数',
);
assert(
	readerNativeTopicHref('https://example.com/t/42', base) === '' &&
	readerNativeTopicHref('javascript:alert(1)', base) === '',
	'跨源和非 HTTP(S) 地址不得进入原生主题入口',
);
assert(
	readerNativeBypassCleanHref(nativeHref, base) ===
		'https://linux.do/t/example/42?value=1#post_7' &&
	readerNativeBypassCleanHref('/t/42', base) === null,
	'消费绕过参数时必须恢复干净原生 URL，普通 URL 不得误判',
);

const replacements: string[] = [];
assert(
	consumeReaderNativeBypass(nativeHref, base, (href) => {
		replacements.push(href);
	}) &&
	replacements.length === 1 &&
	replacements[0] ===
		'https://linux.do/t/example/42?value=1#post_7',
	'启动前必须只消费一次绕过标记并交给唯一 history replace 端口',
);
assert(
	!consumeReaderNativeBypass('/t/42', base, () => {
		throw new Error('普通 URL 不得触发 replace');
	}),
	'普通 Topic URL 必须继续进入 Reader',
);

const tabStorage = new Map<string, string>();
let openedUrl = '';
let opener: unknown = {};
const nativeTab = {
	sessionStorage: {
		getItem: (key: string) => tabStorage.get(key) ?? null,
		setItem: (key: string, value: string) => tabStorage.set(key, value),
		removeItem: (key: string) => tabStorage.delete(key),
	},
	open(value: string, target: string) {
		assert(value === 'about:blank' && target === '_blank',
			'原生入口必须同步创建独立空白标签');
		return {
			sessionStorage: this.sessionStorage,
			get opener() {
				return opener;
			},
			set opener(value: unknown) {
				opener = value;
			},
			location: {
				href: '',
				replace(value: string) {
					openedUrl = value;
				},
			},
		};
	},
};
assert(
	openReaderNativeTopicTab(nativeTab, nativeHref) &&
	openedUrl === nativeHref &&
	opener === null &&
	tabStorage.get(READER_NATIVE_BYPASS_TAB_KEY) === '1',
	'打开原帖必须先在目标标签写入一次性绕过信号，再隔离 opener 并导航',
);
assert(
	consumeReaderNativeTabBypass(nativeTab) &&
	!tabStorage.has(READER_NATIVE_BYPASS_TAB_KEY) &&
	!consumeReaderNativeTabBypass(nativeTab),
	'目标标签必须只消费一次 sessionStorage 绕过信号，后续普通导航恢复 Reader',
);
