import type { DiscourseHostDescriptor } from '../app/reader-application.js';
import {
	normalizeReaderCustomSiteHost,
	readerBuiltinDiscourseHost,
	type ReaderCustomSiteRepository,
} from './reader-custom-site-repository.js';

export interface ReaderDetectedSiteFeedbackPort {
	confirm(request: Readonly<{
		readonly title: string;
		readonly message: string;
		readonly note: string;
		readonly confirmLabel: string;
		readonly cancelLabel: string;
		readonly tone: 'primary';
		readonly icon: string;
	}>): Promise<boolean>;
	show(message: string): void;
}

export interface ReaderDetectedSiteOnboardingOptions {
	readonly hostname: unknown;
	readonly detection: DiscourseHostDescriptor['detection'];
	readonly repository: ReaderCustomSiteRepository;
	readonly feedback: ReaderDetectedSiteFeedbackPort;
}

export type ReaderDetectedSiteOnboardingResult =
	| 'not-needed'
	| 'already-added'
	| 'unavailable'
	| 'declined'
	| 'added';

/**
 * 已获脚本管理器运行许可的非内置站点，在本地原生/DOM 证据确认后询问是否保存。
 *
 * 本 owner 不探测网络、不扩大 userscript @match，也不把“自定义站点”误作浏览器授权；
 * 持久化仍须由用户在统一确认浮窗中明确同意。
 */
export async function onboardDetectedDiscourseSite(
	options: ReaderDetectedSiteOnboardingOptions,
): Promise<ReaderDetectedSiteOnboardingResult> {
	const host = normalizeReaderCustomSiteHost(options.hostname);
	if (
		!host ||
		readerBuiltinDiscourseHost(host) ||
		options.detection === 'verified-site'
	) {
		return 'not-needed';
	}
	const sites = await options.repository.load();
	if (sites.includes(host)) return 'already-added';
	if (!options.repository.writable) {
		options.feedback.show(`已识别 ${host} 为 Discourse，但当前无法保存站点`);
		return 'unavailable';
	}
	const confirmed = await options.feedback.confirm({
		title: '发现新的 Discourse 社区',
		message: `已通过当前页面的 Discourse 证据确认 ${host}。是否加入自定义站点？`,
		note: '保存只作为站点识别兜底；脚本管理器仍需单独允许此域名运行。',
		confirmLabel: '加入自定义站点',
		cancelLabel: '暂不添加',
		tone: 'primary',
		icon: 'plus',
	});
	if (!confirmed) return 'declined';
	await options.repository.add(host);
	options.feedback.show(`已将 ${host} 加入自定义站点`);
	return 'added';
}
