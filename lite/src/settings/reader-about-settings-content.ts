import { LifecycleScope } from '../kernel/lifecycle.js';
import { installReaderSiteLogoFallback } from '../components/reader-image-fallback.js';
import {
	settingsElement as element,
	settingsIcon as icon,
} from './reader-settings-dom.js';

export const READER_MANUAL_URL =
	'https://sunbigfly.github.io/awesome-linuxdo-reader/';

const FONT_RENDERING_PROJECT_URL =
	'https://github.com/F9y4ng/GreasyFork-Scripts/';
const FONT_RENDERING_LICENSE_URL =
	'https://github.com/F9y4ng/GreasyFork-Scripts/blob/master/LICENSE';
const BOOST_MENTION_PROJECT_URL =
	'https://greasyfork.org/zh-CN/scripts/580986-linux-do-boost-%E5%A2%9E%E5%BC%BA';

const features = Object.freeze([
	Object.freeze({
		icon: 'layout-grid',
		title: '响应式专注阅读',
		description:
			'同一阅读内核支持浮窗、全屏和左右嵌入，元素随容器宽度自动重排。',
	}),
	Object.freeze({
		icon: 'image',
		title: '完整内容与楼层关系',
		description:
			'二级回复、引用、时间轴、图片、视频、音频和 Markdown 提示块连贯呈现。',
	}),
	Object.freeze({
		icon: 'heart',
		title: '原生社区互动',
		description:
			'回复、点赞、Boost、回应、收藏、通知和帖子编辑无需离开阅读器。',
	}),
	Object.freeze({
		icon: 'rocket',
		title: '长帖数据与性能',
		description:
			'按需加载、缓存和请求节奏控制，并集中管理历史、收藏与回应。',
	}),
]);

export interface ReaderAboutSettingsContentOptions {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly version: string;
	readonly logoUrl?: string;
	readonly brandName?: string;
	readonly manualUrl?: string;
	readonly parentScope?: LifecycleScope;
}

function nonEmpty(value: string, name: string): string {
	const normalized = String(value).trim();
	if (!normalized) throw new Error(`${name} 不能为空`);
	return normalized;
}

function externalLink(
	document: Document,
	url: string,
	label: string,
): HTMLAnchorElement {
	const link = element(document, 'a');
	link.href = url;
	link.target = '_blank';
	link.rel = 'noopener noreferrer';
	link.textContent = label;
	return link;
}

/**
 * “关于”面板的唯一无状态内容 owner。
 *
 * 它只挂到 Settings View 的稳定 about host，项目链接保持普通原生 anchor；不创建第二套
 * 设置弹窗、不复制路由或网络能力，也不持有任何可变偏好。
 */
export class ReaderAboutSettingsContent {
	readonly scope: LifecycleScope;
	readonly root: HTMLElement;

	constructor(options: ReaderAboutSettingsContentOptions) {
		const version = nonEmpty(options.version, 'version');
		const manualUrl = nonEmpty(
			options.manualUrl ?? READER_MANUAL_URL,
			'manualUrl',
		);
		const brandName = nonEmpty(
			options.brandName ?? 'awesome linuxdo reader',
			'brandName',
		);
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.root = element(
			options.document,
			'div',
			'ldp-about-content',
		);

		const hero = element(
			options.document,
			'section',
			'ldp-about-hero',
		);
		const headingId = 'ldp-about-name';
		hero.setAttribute('aria-labelledby', headingId);
		const logoUrl = String(options.logoUrl ?? '').trim();
		if (logoUrl) {
			const logo = element(
				options.document,
				'img',
				'ldp-about-logo',
			);
			installReaderSiteLogoFallback(logo, logoUrl);
			logo.alt = '';
			logo.loading = 'lazy';
			logo.decoding = 'async';
			logo.dataset.ldpSiteLogo = '';
			hero.append(logo);
		}
		const identity = element(
			options.document,
			'div',
			'ldp-about-identity',
		);
		const name = element(
			options.document,
			'h4',
			'ldp-about-name',
		);
		name.id = headingId;
		name.textContent = brandName;
		const tagline = element(
			options.document,
			'p',
			'ldp-about-tagline',
		);
		tagline.textContent =
			'在原站能力之上，提供更连贯、更可控的阅读体验。';
		identity.append(name, tagline);
		const versionBadge = element(
			options.document,
			'span',
			'ldp-about-version',
		);
		versionBadge.textContent = `v${version}`;
		hero.append(identity, versionBadge);

		const links = element(
			options.document,
			'nav',
			'ldp-about-links',
		);
		links.setAttribute('aria-label', '项目链接');
		const manual = externalLink(
			options.document,
			manualUrl,
			'',
		);
		manual.className = 'ldp-about-link';
		const manualIcon = element(
			options.document,
			'span',
			'ldp-about-link-icon',
		);
		manualIcon.append(icon(options.document, 'list-checks'));
		const manualCopy = element(
			options.document,
			'span',
			'ldp-about-link-copy',
		);
		const manualTitle = element(options.document, 'strong');
		manualTitle.textContent = '在线用户手册';
		const manualHint = element(options.document, 'small');
		manualHint.textContent = '无需安装，使用浏览器直接打开';
		manualCopy.append(manualTitle, manualHint);
		manual.append(
			manualIcon,
			manualCopy,
			icon(options.document, 'external-link'),
		);
		links.append(manual);

		const featureList = element(
			options.document,
			'div',
			'ldp-about-features',
		);
		featureList.setAttribute('aria-label', '阅读器核心特性');
		for (const feature of features) {
			const article = element(
				options.document,
				'article',
				'ldp-about-feature',
			);
			const featureIcon = element(
				options.document,
				'span',
				'ldp-about-feature-icon',
			);
			featureIcon.append(icon(options.document, feature.icon));
			const copy = element(
				options.document,
				'div',
				'ldp-about-feature-copy',
			);
			const title = element(options.document, 'strong');
			title.textContent = feature.title;
			const description = element(options.document, 'p');
			description.textContent = feature.description;
			copy.append(title, description);
			article.append(featureIcon, copy);
			featureList.append(article);
		}

		const credits = element(
			options.document,
			'section',
			'ldp-about-credits',
		);
		const creditsTitleId = 'ldp-about-credits-title';
		credits.setAttribute('aria-labelledby', creditsTitleId);
		const creditsTitle = element(options.document, 'strong');
		creditsTitle.id = creditsTitleId;
		creditsTitle.textContent = '特别致谢';
		const fontCredit = element(options.document, 'p');
		fontCredit.append(
			'字体渲染参数与实现思路参考 ',
			externalLink(
				options.document,
				FONT_RENDERING_PROJECT_URL,
				'F9y4ng / GreasyFork-Scripts 的 Font Rendering',
			),
			'；感谢作者的长期维护。上游项目采用 ',
			externalLink(
				options.document,
				FONT_RENDERING_LICENSE_URL,
				'GPL-3.0-only',
			),
			'。',
		);
		const boostCredit = element(options.document, 'p');
		boostCredit.append(
			'Boost 引用与提及交互参考 ',
			externalLink(
				options.document,
				BOOST_MENTION_PROJECT_URL,
				'ccc9527-c 的 Linux.do Boost 增强',
			),
			'；感谢作者以 MIT 许可分享实现思路。',
		);
		credits.append(creditsTitle, fontCredit, boostCredit);

		this.root.append(hero, links, featureList, credits);
		options.host.replaceChildren(this.root);
		this.scope.add(() => this.root.remove());
	}

	destroy(): void {
		this.scope.destroy();
	}
}
