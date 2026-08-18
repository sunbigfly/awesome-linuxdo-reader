import { readerFontFamilyCss } from './reader-font-style-controller.js';

export const READER_FONT_OPTION_PREVIEW = '中文预览 · Aa 0123';

const READER_LOCAL_FONT_CHINESE_NAMES = Object.freeze(new Map<string, string>([
	['alibaba puhuiti', '阿里巴巴普惠体'],
	['dengxian', '等线'],
	['dfkai-sb', '标楷体'],
	['fangsong', '仿宋'],
	['fzshuti', '方正舒体'],
	['fzyaoti', '方正姚体'],
	['harmonyos sans sc', '鸿蒙黑体'],
	['heiti sc', '黑体-简'],
	['hiragino sans gb', '冬青黑体简体中文'],
	['kaiti', '楷体'],
	['kaiti sc', '楷体-简'],
	['lisu', '隶书'],
	['lxgw wenkai', '霞鹜文楷'],
	['microsoft jhenghei', '微软正黑体'],
	['microsoft jhenghei ui', '微软正黑体 UI'],
	['microsoft yahei', '微软雅黑'],
	['microsoft yahei ui', '微软雅黑 UI'],
	['mingliu', '细明体'],
	['nsimsun', '新宋体'],
	['pingfang sc', '苹方-简'],
	['pmingliu', '新细明体'],
	['simhei', '黑体'],
	['simsun', '宋体'],
	['songti sc', '宋体-简'],
	['source han sans sc', '思源黑体'],
	['source han serif sc', '思源宋体'],
	['stcaiyun', '华文彩云'],
	['stfangsong', '华文仿宋'],
	['stheiti', '华文黑体'],
	['sthupo', '华文琥珀'],
	['stkaiti', '华文楷体'],
	['stliti', '华文隶书'],
	['stsong', '华文宋体'],
	['stxihei', '华文细黑'],
	['stxingkai', '华文行楷'],
	['stxinwei', '华文新魏'],
	['stzhongsong', '华文中宋'],
	['youyuan', '幼圆'],
]));

export interface ReaderLocalFontPresentation {
	readonly family: string;
	readonly label: string;
	readonly fontFamilyCss: string;
	readonly searchText: string;
}

export function readerLocalFontPresentation(
	value: string,
): ReaderLocalFontPresentation {
	const family = String(value ?? '').trim();
	const chineseName = READER_LOCAL_FONT_CHINESE_NAMES.get(
		family.toLocaleLowerCase('en-US'),
	);
	const label = chineseName ? `${chineseName}（${family}）` : family;
	return Object.freeze({
		family,
		label,
		fontFamilyCss: readerFontFamilyCss('custom', family),
		searchText: chineseName ? `${chineseName} ${family}` : family,
	});
}
