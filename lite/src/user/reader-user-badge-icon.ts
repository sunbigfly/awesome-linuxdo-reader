import type { ReaderUserBadge } from './discourse-native-user-port.js';

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

const EXACT_KINDS = Object.freeze<Record<string, string>>({
	种子用户: 'seed',
	龙行龘龘: 'dragon',
	大预言家: 'crystal',
	圆圆满满: 'moon',
	浴火重生: 'fire',
	海纳百川: 'waves',
	一元复始: 'clock',
	蛇来运转: 'snake',
	破界者: 'hammer',
	不二之选: 'star',
	骐骥驰骋: 'horse',
	幸运佬: 'clover',
	金笔杆: 'pencil',
	银笔杆: 'pencil',
	铜笔杆: 'pencil',
	文化宣导员: 'megaphone',
	元气满满: 'gift',
	基本用户: 'user',
	成员: 'user',
	活跃用户: 'fire',
	领导者: 'crown',
	阅读准则: 'book',
	已认证: 'certificate',
	已授权: 'certificate',
	当月最佳新用户: 'star',
	爱好者: 'calendar',
	百尺竿头: 'calendar',
	全年不落: 'calendar',
	周年纪念日: 'calendar',
	推广者: 'userplus',
	活动家: 'userplus',
	拥护者: 'userplus',
	指导顾问: 'check',
	无所不知: 'check',
	解决方案机构: 'check',
});

const KIND_RULES = Object.freeze<readonly (readonly [string, RegExp])[]>([
	['mail', /mail|envelope|电子邮件|邮箱/],
	['flag', /\bflag\b|report|举报/],
	['at', /at-sign|mention|提及/],
	['quote', /quote|引用/],
	['box', /onebox|cube|box/],
	['certificate', /certificate|认证|授权/],
	['code', /code|github|commit|contributor|开源|贡献/],
	['seed', /seed|sprout|幼苗|种子/],
	['hammer', /hammer|gavel|破界/],
	['calendar', /calendar|streak|连续|全年|纪念日/],
	['userplus', /user-plus|invite|邀请|推广者|活动家|拥护者/],
	['megaphone', /bullhorn|megaphone|announcement|公告|推广|广播/],
	['heart', /heart|like|love|赞|爱心|喜爱|谢谢|回馈|善解人意/],
	['eye', /\beye\b|view|reader|阅读|浏览|围观/],
	['pencil', /pencil|edit|write|author|编辑|创作|作者|书写|笔杆|wiki/],
	['document', /file|document|post|topic|article|文件|文档|帖子|主题|文章/],
	['smile', /smile|laugh|emoji|表情|微笑|笑/],
	['crown', /chess|crown|leader|king|领袖|领导|王者/],
	['link', /link|share|链接|分享/],
	['chat', /comment|chat|reply|conversation|回复|讨论|聊天|对话/],
	['check', /check|solution|accepted|认可|解决|采纳|完成|顾问|无所不知/],
	['star', /star|award|medal|荣誉|勋章|明星|精选|尊敬|敬仰|最佳/],
	['shield', /shield|moderator|admin|管理|守护|安全/],
	['clock', /clock|time|anniversary|year|周年|时间|资历/],
	['fire', /fire|hot|active|热门|活跃|热心/],
	['book', /book|learn|guide|tutorial|知识|教程|学习|指南/],
	['gift', /gift|赠送|礼物/],
	['user', /user|person|profile|member|用户|新人|成员|欢迎/],
]);

const GLYPHS = Object.freeze<Record<string, string>>({
	mail: '<path d="M2 5h20v14H2V5zm3 2 7 5 7-5H5zm15 2.3-8 5.5-8-5.5V17h16V9.3z" fill-rule="evenodd"/>',
	flag: '<path d="M4 2h2v20H4V2zm3 2h13l-3 5 3 5H7V4z"/>',
	at: '<path d="M12 2a10 10 0 1 0 5.8 18.2l-1.3-1.7A7.8 7.8 0 1 1 19.8 12v1.2c0 1.2-.5 1.8-1.4 1.8-.8 0-1.3-.5-1.3-1.5V8h-2v1A5 5 0 1 0 16 16c.7.8 1.6 1.2 2.7 1.2 2.1 0 3.3-1.5 3.3-4V12c0-5.5-4.5-10-10-10zm0 12.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5z" fill-rule="evenodd"/>',
	quote: '<path d="M3 5h8v8H7c0 3 1.3 4.8 4 5.5V21c-5.3-.8-8-4.2-8-10V5zm10 0h8v8h-4c0 3 1.3 4.8 4 5.5V21c-5.3-.8-8-4.2-8-10V5z"/>',
	box: '<path d="m12 2 9 5v10l-9 5-9-5V7l9-5zm0 2.8L6.1 8 12 11.2 17.9 8 12 4.8zM5 9.7v6.1l6 3.3V13L5 9.7zm8 9.4 6-3.3V9.7L13 13v6.1z" fill-rule="evenodd"/>',
	certificate: '<path d="M12 2a7 7 0 1 0 0 14 7 7 0 0 0 0-14zm-3 7.2 2 2 4-4 1.5 1.5-5.5 5.5-3.5-3.5L9 9.2zM8 16l-2 6 6-2 6 2-2-6a9 9 0 0 1-8 0z" fill-rule="evenodd"/>',
	code: '<path d="m8.5 6-6 6 6 6 1.7-1.7L5.9 12l4.3-4.3L8.5 6zm7 0-1.7 1.7 4.3 4.3-4.3 4.3 1.7 1.7 6-6-6-6zM13 3 9 21h2l4-18h-2z"/>',
	seed: '<path d="M12 22v-8c-5-.3-8-3.2-8-8 4.8 0 7.2 1.6 8 4.7C12.8 7.6 15.2 6 20 6c0 4.8-3 7.7-8 8v8h-2z"/>',
	hammer: '<path d="m4 3 7 7-3 3-7-7 3-3zm8 5 3-3 4 4-3 3 6 6-4 4-6-6-3 3-4-4 7-7z"/>',
	calendar: '<path d="M3 4h3V2h2v2h8V2h2v2h3v18H3V4zm2 6v10h14V10H5zm0-4v2h14V6H5zm3 7h3v3H8v-3zm5 0h3v3h-3v-3z" fill-rule="evenodd"/>',
	userplus: '<path d="M9 2a5 5 0 1 1 0 10A5 5 0 0 1 9 2zM1 22c0-5 2.8-8 8-8 3.4 0 5.8 1.3 7 3.6V15h2v3h3v2h-3v3h-2v-3.4c-.7-.2-1.5-.3-2.4-.3-1.5 0-2.7.9-3.1 2.7H1z"/>',
	megaphone: '<path d="M3 10v4h3l3 3V7l-3 3H3zm7-3 9-3v16l-9-3V7zm-5 8h2l1.5 5H6.2L5 15z"/>',
	heart: '<path d="M12 20.5 4.2 13C-.5 8.2 6.1 2.1 12 7.2 17.9 2.1 24.5 8.2 19.8 13L12 20.5z"/>',
	eye: '<path d="M1.5 12s3.7-6 10.5-6 10.5 6 10.5 6-3.7 6-10.5 6S1.5 12 1.5 12zm10.5 3.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z" fill-rule="evenodd"/>',
	pencil: '<path d="m4 16.5-.8 4.3 4.3-.8L19.8 7.7l-3.5-3.5L4 16.5zm13.4-13.4 1.4-1.4a1.6 1.6 0 0 1 2.2 0l1.3 1.3a1.6 1.6 0 0 1 0 2.2l-1.4 1.4-3.5-3.5z"/>',
	document: '<path d="M5 2h9l5 5v15H5V2zm9 1.8V8h4.2L14 3.8zM8 12h8v-1.5H8V12zm0 4h8v-1.5H8V16zm0 4h6v-1.5H8V20z" fill-rule="evenodd"/>',
	smile: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-4 7.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm8 0a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3zm-8.2 5h8.4c-.7 2.3-2.1 3.5-4.2 3.5s-3.5-1.2-4.2-3.5z" fill-rule="evenodd"/>',
	crown: '<path d="m3 7 4.5 3L12 4l4.5 6L21 7l-2 12H5L3 7zm3.4 10h11.2l.5-3H5.9l.5 3z" fill-rule="evenodd"/>',
	link: '<path d="M9.5 15.9 7.4 18a3 3 0 0 1-4.2-4.2l4-4a3 3 0 0 1 4.2 0l1 1-1.6 1.6-1-1a.8.8 0 0 0-1.1 0l-4 4a.8.8 0 0 0 1.1 1.1l2.1-2.1 1.6 1.5zm5-7.8L16.6 6a3 3 0 0 1 4.2 4.2l-4 4a3 3 0 0 1-4.2 0l-1-1 1.6-1.6 1 1a.8.8 0 0 0 1.1 0l4-4a.8.8 0 0 0-1.1-1.1l-2.1 2.1-1.6-1.5zM8.8 13.6l4.8-4.8 1.6 1.6-4.8 4.8-1.6-1.6z"/>',
	chat: '<path d="M3 4h18v13H9l-5.5 4v-4H3V4zm4 5h10V7.5H7V9zm0 4h7v-1.5H7V13z" fill-rule="evenodd"/>',
	check: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-2 14.5-4-4 1.8-1.8 2.2 2.2 6.2-6.2L18 8.5l-8 8z" fill-rule="evenodd"/>',
	star: '<path d="m12 2.5 3 6.1 6.7 1-4.9 4.7 1.2 6.7-6-3.2-6 3.2 1.2-6.7-4.9-4.7 6.7-1 3-6.1z"/>',
	shield: '<path d="M12 2 21 5v6c0 5.7-3.7 9.4-9 11-5.3-1.6-9-5.3-9-11V5l9-3zm0 3L6 7v4c0 3.9 2.2 6.5 6 8 3.8-1.5 6-4.1 6-8V7l-6-2z" fill-rule="evenodd"/>',
	clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 5h-2v6l5 3 1-1.7-4-2.3V7z" fill-rule="evenodd"/>',
	fire: '<path d="M13.5 2c1 4-1.5 5.2-1.5 8 0 1.1.7 2 1.7 2 1.8 0 2.5-2.1 2-4.2 3 2.4 4.3 5 3.7 8A7.5 7.5 0 0 1 5 15c-.3-3.4 1.5-6.5 5.1-9.4-.2 3.6 1.3 4.2 2 2.4.6-1.8.1-3.8 1.4-6z"/>',
	book: '<path d="M3 4h7c1.2 0 2.2.4 3 1.2A4.1 4.1 0 0 1 16 4h5v15h-5c-1.2 0-2.2.5-3 1.5A3.8 3.8 0 0 0 10 19H3V4zm9 3.5A2.8 2.8 0 0 0 10 6H5v11h5c.7 0 1.4.2 2 .5v-10zm2 10c.6-.3 1.3-.5 2-.5h3V6h-3c-.8 0-1.5.5-2 1.5v10z" fill-rule="evenodd"/>',
	gift: '<path d="M2 9h20v4h-1v9H3v-9H2V9zm3 4v7h6v-7H5zm8 0v7h6v-7h-6zM7.5 8C4 8 4 3 7 3c2 0 3.5 2.4 5 5H7.5zm9 0H12c1.5-2.6 3-5 5-5 3 0 3 5-.5 5z" fill-rule="evenodd"/>',
	user: '<path d="M12 2a5 5 0 1 1 0 10 5 5 0 0 1 0-10zM3 22c0-5 3.2-8 9-8s9 3 9 8H3z"/>',
	dragon: '<path d="M3 17c2-6 5-10 10-12l-1 4c4-2 7-1 9 2l-4 1 3 3-5 1c-2 4-6 6-12 4l4-2-4-1zm8-4 2 2 2-3-4 1z" fill-rule="evenodd"/>',
	crystal: '<path d="M12 2a8 8 0 0 1 5 14.2L20 22H4l3-5.8A8 8 0 0 1 12 2zm0 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10zm-4 14-1 2h10l-1-2H8z" fill-rule="evenodd"/>',
	moon: '<path d="M16.5 2.5A10 10 0 1 0 21.5 17 8 8 0 0 1 16.5 2.5z"/>',
	waves: '<path d="M2 7c3 0 3 2 6 2s3-2 6-2 3 2 6 2h2v3h-2c-3 0-3-2-6-2s-3 2-6 2-3-2-6-2V7zm0 7c3 0 3 2 6 2s3-2 6-2 3 2 6 2h2v3h-2c-3 0-3-2-6-2s-3 2-6 2-3-2-6-2v-3z"/>',
	snake: '<path d="M18 3c3 0 4 2 4 4 0 3-2 4-5 4h-6c-1.5 0-2 .7-2 1.5S9.5 14 11 14h3c4 0 6 1.8 6 4.5S18 23 14 23H5v-3h9c1.8 0 3-.5 3-1.5S15.8 17 14 17h-3c-3.5 0-5-1.8-5-4.5S7.5 8 11 8h6c1.3 0 2-.4 2-1s-.7-1-2-1h-2V3h3zM4 17l-3-3 3-3v6z"/>',
	horse: '<path d="M6 22v-7l3-4-1-5 5-4 1 4 5 2-1 6-4 2v6h-3v-7l3-2 1-3-4-1-4 7v6H6z"/>',
	clover: '<path d="M12 11C8-1 0 3 5 10-2 8-1 18 8 15c-4 7 6 10 7 2 7 5 11-5 3-7 6-6-3-12-6 1zm0 3 2 8h-4l2-8z" fill-rule="evenodd"/>',
});

function badgeKind(badge: ReaderUserBadge): string {
	const name = badge.name.trim();
	const exact = EXACT_KINDS[name];
	if (exact) return exact;
	const source = `${badge.icon} ${name}`.toLocaleLowerCase();
	return KIND_RULES.find(([, pattern]) => pattern.test(source))?.[0] ?? 'sigil';
}

function badgeHash(badge: ReaderUserBadge): number {
	const identity = `${badge.id ?? ''}|${badge.name}|${badge.icon}`;
	let hash = 2_166_136_261;
	for (let index = 0; index < identity.length; index += 1) {
		hash ^= identity.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return hash >>> 0;
}

function sigilMarkup(badge: ReaderUserBadge): string {
	const hash = badgeHash(badge);
	const points = Array.from({ length: 8 }, (_, index) => {
		const angle = -Math.PI / 2 + index * Math.PI / 4;
		const radius = 7 + ((hash >>> (index * 4)) & 3);
		return `${12 + Math.cos(angle) * radius},${12 + Math.sin(angle) * radius}`;
	}).join(' ');
	const core = 2.5 + ((hash >>> 29) & 3) * .65;
	return `<polygon points="${points}"></polygon><circle cx="12" cy="12" r="${core}" fill="var(--ldp-canvas,var(--secondary,#fff))"></circle><circle cx="12" cy="12" r="${Math.max(1, core - 1.5)}"></circle>`;
}

export function createReaderUserBadgeIcon(
	document: Document,
	badge: ReaderUserBadge,
): SVGSVGElement {
	const kind = badgeKind(badge);
	const svg = document.createElementNS(
		SVG_NAMESPACE,
		'svg',
	) as SVGSVGElement;
	svg.classList.add('ldp-user-card-badge-icon');
	svg.dataset.userBadgeGlyph = kind;
	svg.setAttribute('viewBox', '0 0 24 24');
	svg.setAttribute('aria-hidden', 'true');
	svg.setAttribute('focusable', 'false');
	const group = document.createElementNS(SVG_NAMESPACE, 'g');
	group.setAttribute('transform', 'translate(3 1) scale(.75)');
	group.innerHTML = GLYPHS[kind] ?? sigilMarkup(badge);
	svg.append(group);
	return svg;
}
