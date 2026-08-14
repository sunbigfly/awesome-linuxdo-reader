import {
	renderReaderIcon,
	type ReaderIconRenderer,
} from '../components/reader-icon.js';
import { eventPathIncludes } from '../dom/event-target.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	readerCollectionDateKey,
	type ReaderCollectionSortDirection,
} from './reader-collection-filter-model.js';

export type ReaderPopoverFilterName =
	| 'notification'
	| 'history'
	| 'bookmarks';
export type ReaderTaxonomyFilterName = 'category' | 'tag';
export type ReaderPopoverSortDirection = ReaderCollectionSortDirection;

export interface ReaderPopoverFilterDisclosureSnapshot {
	readonly active: boolean;
	readonly date: string;
	readonly sort: string;
	readonly direction: ReaderPopoverSortDirection;
	readonly dayCounts: ReadonlyMap<string, number>;
}

export interface ReaderFilterOption {
	readonly value: string;
	readonly label: string;
	readonly count: number;
}

export interface ReaderPopoverSearchControl {
	readonly root: HTMLLabelElement;
	readonly input: HTMLInputElement;
	readonly clear: HTMLButtonElement;
}

export interface ReaderPopoverSearchTools {
	readonly root: HTMLDivElement;
	readonly search: ReaderPopoverSearchControl;
	readonly filters: HTMLDivElement;
	readonly filterToggle: HTMLButtonElement;
	readonly category: HTMLSelectElement;
	readonly tag: HTMLSelectElement;
	readonly calendarToggle: HTMLButtonElement;
	readonly calendar: HTMLDivElement;
	readonly sort: HTMLSelectElement;
	readonly sortDirection: HTMLButtonElement;
	readonly reset: HTMLButtonElement;
}

function ownerLabel(owner: ReaderPopoverFilterName): string {
	if (owner === 'notification') return '消息';
	if (owner === 'history') return '浏览历史';
	return '收藏与回应';
}

function monthStart(value = new Date()): Date {
	return new Date(value.getFullYear(), value.getMonth(), 1);
}

function closestTarget<T extends Element>(event: Event, selector: string): T | null {
	const target = event.target as (EventTarget & {
		closest?: (value: string) => Element | null;
	}) | null;
	return typeof target?.closest === 'function'
		? target.closest(selector) as T | null
		: null;
}

function taxonomyLabel(name: ReaderTaxonomyFilterName): string {
	return name === 'category' ? '类别' : '标签';
}

export function createReaderPopoverSearch(
	document: Document,
	name: ReaderPopoverFilterName,
	placeholder: string,
	label: string,
	clearLabel: string,
	renderIcon?: ReaderIconRenderer<'search' | 'x' | 'header-settings'> | null,
): ReaderPopoverSearchControl {
	const root = document.createElement('label');
	root.className = 'ldp-popover-search';
	root.append(renderReaderIcon(document, 'search', renderIcon));
	const input = document.createElement('input');
	input.className = `ldp-popover-search-input ldp-${name}-search`;
	input.type = 'search';
	input.autocomplete = 'off';
	input.spellcheck = false;
	input.placeholder = placeholder;
	input.setAttribute('aria-label', label);
	const clear = document.createElement('button');
	clear.className = `ldp-popover-search-clear ldp-${name}-search-clear`;
	clear.type = 'button';
	clear.setAttribute('aria-label', clearLabel);
	clear.append(renderReaderIcon(document, 'x', renderIcon));
	clear.hidden = true;
	root.append(input, clear);
	return Object.freeze({ root, input, clear });
}

export function createReaderTaxonomyFilter(
	document: Document,
	owner: ReaderPopoverFilterName,
	name: ReaderTaxonomyFilterName,
): HTMLSelectElement {
	const label = taxonomyLabel(name);
	const select = document.createElement('select');
	select.className = [
		'ldp-reader-select',
		'ldp-popover-taxonomy-filter',
		`ldp-${owner}-taxonomy-filter`,
		`ldp-${owner}-${name}-filter`,
	].join(' ');
	select.setAttribute('aria-label', `按${label}筛选${ownerLabel(owner)}`);
	const all = document.createElement('option');
	all.value = '';
	all.textContent = label;
	select.append(all);
	return select;
}

export function createReaderPopoverSearchTools(
	document: Document,
	owner: ReaderPopoverFilterName,
	placeholder: string,
	label: string,
	clearLabel: string,
	renderIcon?: ReaderIconRenderer<
		| 'search'
		| 'x'
		| 'header-settings'
		| 'clock'
		| 'chevron-left'
		| 'chevron-right'
		| 'chevron-down'
	> | null,
): ReaderPopoverSearchTools {
	const search = createReaderPopoverSearch(
		document,
		owner,
		placeholder,
		label,
		clearLabel,
		renderIcon,
	);
	const category = createReaderTaxonomyFilter(
		document,
		owner,
		'category',
	);
	const tag = createReaderTaxonomyFilter(document, owner, 'tag');
	const calendarToggle = document.createElement('button');
	calendarToggle.type = 'button';
	calendarToggle.className = 'ldp-user-observation-calendar-toggle';
	calendarToggle.setAttribute('aria-label', `按日期筛选${ownerLabel(owner)}`);
	calendarToggle.setAttribute('aria-haspopup', 'dialog');
	calendarToggle.setAttribute('aria-expanded', 'false');
	calendarToggle.append(
		renderReaderIcon(document, 'clock', renderIcon),
		document.createTextNode('活动日历'),
	);
	const calendar = document.createElement('div');
	calendar.className = 'ldp-user-observation-calendar';
	calendar.hidden = true;
	calendar.setAttribute('role', 'dialog');
	calendar.setAttribute('aria-label', `${ownerLabel(owner)}活动日历`);
	const calendarHeader = document.createElement('div');
	calendarHeader.className = 'ldp-user-observation-calendar-head';
	const previousMonth = document.createElement('button');
	previousMonth.type = 'button';
	previousMonth.dataset.userObservationCalendarMonth = '-1';
	previousMonth.setAttribute('aria-label', '上个月');
	previousMonth.append(renderReaderIcon(document, 'chevron-left', renderIcon));
	const calendarTitle = document.createElement('strong');
	calendarTitle.className = 'ldp-user-observation-calendar-title';
	const nextMonth = document.createElement('button');
	nextMonth.type = 'button';
	nextMonth.dataset.userObservationCalendarMonth = '1';
	nextMonth.setAttribute('aria-label', '下个月');
	nextMonth.append(renderReaderIcon(document, 'chevron-right', renderIcon));
	const today = document.createElement('button');
	today.type = 'button';
	today.dataset.userObservationCalendarToday = '';
	today.textContent = '今天';
	const clearDate = document.createElement('button');
	clearDate.type = 'button';
	clearDate.dataset.userObservationCalendarClear = '';
	clearDate.textContent = '清除';
	calendarHeader.append(previousMonth, calendarTitle, nextMonth, today, clearDate);
	const weekdays = document.createElement('div');
	weekdays.className = 'ldp-user-observation-calendar-weekdays';
	weekdays.setAttribute('aria-hidden', 'true');
	for (const text of ['一', '二', '三', '四', '五', '六', '日']) {
		const weekday = document.createElement('span');
		weekday.textContent = text;
		weekdays.append(weekday);
	}
	const calendarGrid = document.createElement('div');
	calendarGrid.className = 'ldp-user-observation-calendar-grid';
	calendar.append(calendarHeader, weekdays, calendarGrid);
	const sort = document.createElement('select');
	sort.className = 'ldp-reader-select ldp-user-observation-sort-filter';
	sort.setAttribute('aria-label', `${ownerLabel(owner)}排序字段`);
	const sortOptions = owner === 'history'
		? Object.freeze([
			['recent-viewed', '最近查看时间'],
			['first-viewed', '首次查看时间'],
		] as const)
		: Object.freeze([['time', '时间排序']] as const);
	for (const [value, text] of sortOptions) {
		const option = document.createElement('option');
		option.value = value;
		option.textContent = text;
		sort.append(option);
	}
	const sortDirection = document.createElement('button');
	sortDirection.type = 'button';
	sortDirection.className = 'ldp-user-observation-sort-direction';
	sortDirection.append(
		renderReaderIcon(document, 'chevron-down', renderIcon),
		document.createTextNode('降序'),
	);
	const reset = document.createElement('button');
	reset.type = 'button';
	reset.className = 'ldp-user-observation-filter-reset';
	reset.textContent = '重置';
	const filters = document.createElement('div');
	filters.className =
		'ldp-popover-taxonomy-filters ldp-user-observation-filter-panel ' +
		`ldp-user-observation-taxonomy-filters ldp-${owner}-taxonomy-filters`;
	filters.hidden = true;
	filters.append(
		category,
		tag,
		calendarToggle,
		sort,
		sortDirection,
		reset,
		calendar,
	);
	const filterToggle = document.createElement('button');
	filterToggle.type = 'button';
	filterToggle.className =
		`ldp-user-observation-filter-toggle ldp-${owner}-filter-toggle`;
	filterToggle.setAttribute('aria-label', '综合筛选与排序');
	filterToggle.setAttribute('aria-expanded', 'false');
	filterToggle.title = '综合筛选与排序';
	filterToggle.append(renderReaderIcon(
		document,
		'header-settings',
		renderIcon,
	));
	const root = document.createElement('div');
	root.className =
		'ldp-popover-search-tools ldp-user-observation-detail-tools ' +
		`ldp-${owner}-search-tools`;
	search.root.classList.add('ldp-user-observation-search', 'is-detail');
	root.append(search.root, filterToggle, filters);
	return Object.freeze({
		root,
		search,
		filters,
		filterToggle,
		category,
		tag,
		calendarToggle,
		calendar,
		sort,
		sortDirection,
		reset,
	});
}

/** 三类集合搜索栏共用的用户观察式折叠筛选 owner。 */
export class ReaderPopoverFilterDisclosure {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #toggle: HTMLButtonElement;
	readonly #panel: HTMLElement;
	readonly #calendarToggle: HTMLButtonElement;
	readonly #calendar: HTMLElement;
	readonly #calendarTitle: HTMLElement;
	readonly #calendarGrid: HTMLElement;
	readonly #sort: HTMLSelectElement;
	readonly #sortDirection: HTMLButtonElement;
	readonly #reset: HTMLButtonElement;
	readonly #onDateChange: (value: string) => void;
	readonly #onSortChange: (value: string) => void;
	readonly #onDirectionChange: (value: ReaderPopoverSortDirection) => void;
	readonly #onReset: () => void;
	#date = '';
	#direction: ReaderPopoverSortDirection = 'desc';
	#dayCounts: ReadonlyMap<string, number> = new Map();
	#calendarMonth = monthStart();

	constructor(options: Readonly<{
		search: HTMLInputElement;
		onDateChange: (value: string) => void;
		onSortChange: (value: string) => void;
		onDirectionChange: (value: ReaderPopoverSortDirection) => void;
		onReset: () => void;
		parentScope?: LifecycleScope;
	}>) {
		const tools = options.search.closest<HTMLElement>(
			'.ldp-popover-search-tools',
		);
		const toggle = tools?.querySelector<HTMLButtonElement>(
			'.ldp-user-observation-filter-toggle',
		);
		const panel = tools?.querySelector<HTMLElement>(
			'.ldp-user-observation-filter-panel',
		);
		const calendarToggle = tools?.querySelector<HTMLButtonElement>(
			'.ldp-user-observation-calendar-toggle',
		);
		const calendar = tools?.querySelector<HTMLElement>(
			'.ldp-user-observation-calendar',
		);
		const calendarTitle = calendar?.querySelector<HTMLElement>(
			'.ldp-user-observation-calendar-title',
		);
		const calendarGrid = calendar?.querySelector<HTMLElement>(
			'.ldp-user-observation-calendar-grid',
		);
		const sort = tools?.querySelector<HTMLSelectElement>(
			'.ldp-user-observation-sort-filter',
		);
		const sortDirection = tools?.querySelector<HTMLButtonElement>(
			'.ldp-user-observation-sort-direction',
		);
		const reset = tools?.querySelector<HTMLButtonElement>(
			'.ldp-user-observation-filter-reset',
		);
		if (
			!toggle || !panel || !calendarToggle || !calendar ||
			!calendarTitle || !calendarGrid || !sort || !sortDirection || !reset
		) throw new Error('集合搜索缺少完整筛选控件');
		this.#document = options.search.ownerDocument;
		this.#toggle = toggle;
		this.#panel = panel;
		this.#calendarToggle = calendarToggle;
		this.#calendar = calendar;
		this.#calendarTitle = calendarTitle;
		this.#calendarGrid = calendarGrid;
		this.#sort = sort;
		this.#sortDirection = sortDirection;
		this.#reset = reset;
		this.#onDateChange = options.onDateChange;
		this.#onSortChange = options.onSortChange;
		this.#onDirectionChange = options.onDirectionChange;
		this.#onReset = options.onReset;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.listen(toggle, 'click', () => {
			const expanded = this.#panel.hidden === true;
			this.#panel.hidden = !expanded;
			this.#toggle.setAttribute('aria-expanded', String(expanded));
			this.#toggle.classList.toggle('is-open', expanded);
			if (!expanded) this.#setCalendarExpanded(false);
		});
		this.scope.listen(calendarToggle, 'click', () => {
			this.#setCalendarExpanded(this.#calendar.hidden === true);
		});
		this.scope.listen(calendar, 'click', (event) => {
			this.#onCalendarClick(event as MouseEvent);
		});
		this.scope.listen(sort, 'change', () => {
			this.#onSortChange(this.#sort.value);
		});
		this.scope.listen(sortDirection, 'click', () => {
			this.#onDirectionChange(this.#direction === 'desc' ? 'asc' : 'desc');
		});
		this.scope.listen(this.#reset, 'click', () => {
			this.#setCalendarExpanded(false);
			this.#onReset();
		});
		this.scope.listen(this.#document, 'pointerdown', (event) => {
			if (
				this.#calendar.hidden ||
				eventPathIncludes(event, this.#calendar) ||
				eventPathIncludes(event, this.#calendarToggle)
			) return;
			this.#setCalendarExpanded(false);
		}, true);
	}

	sync(snapshot: ReaderPopoverFilterDisclosureSnapshot): void {
		this.#date = snapshot.date;
		this.#direction = snapshot.direction;
		this.#dayCounts = snapshot.dayCounts;
		for (const option of this.#sort.options) {
			option.selected = option.value === snapshot.sort;
		}
		this.#toggle.classList.toggle('has-active-filter', snapshot.active);
		this.#syncCalendarToggle();
		this.#syncSortDirectionButton();
		if (!this.#calendar.hidden) this.#renderCalendar();
	}

	#setCalendarExpanded(expanded: boolean): void {
		this.#calendar.hidden = !expanded;
		this.#calendarToggle.setAttribute('aria-expanded', String(expanded));
		this.#calendarToggle.classList.toggle('is-open', expanded);
		if (expanded) {
			if (this.#date) {
				const selected = new Date(`${this.#date}T00:00:00`);
				if (Number.isFinite(selected.getTime())) this.#calendarMonth = monthStart(selected);
			}
			this.#renderCalendar();
			this.#positionCalendar();
			return;
		}
		for (const property of [
			'top',
			'left',
			'transform',
			'--ldp-user-observation-calendar-anchor-x',
		]) this.#calendar.style.removeProperty(property);
		this.#calendar.removeAttribute('data-placement');
	}

	#positionCalendar(): void {
		const boundary = this.#panel.closest<HTMLElement>(
			'.ldp-reader-floating-window-body',
		)?.getBoundingClientRect();
		const panel = this.#panel.getBoundingClientRect();
		const toggle = this.#calendarToggle.getBoundingClientRect();
		const calendar = this.#calendar.getBoundingClientRect();
		if (!boundary || [
			boundary.top, boundary.right, boundary.bottom, boundary.left,
			panel.top, panel.bottom, toggle.left, toggle.right,
			calendar.width, calendar.height,
		].some((value) => !Number.isFinite(value)) ||
			boundary.width <= 0 || boundary.height <= 0 ||
			calendar.width <= 0 || calendar.height <= 0
		) return;
		const inset = 8;
		const gap = 6;
		const boundaryTop = boundary.top + inset;
		const boundaryBottom = boundary.bottom - inset;
		const belowTop = panel.bottom + gap;
		const aboveTop = panel.top - gap - calendar.height;
		const belowSpace = boundaryBottom - belowTop;
		const aboveSpace = panel.top - gap - boundaryTop;
		const placeAbove = belowSpace < calendar.height && aboveSpace > belowSpace;
		const maximumTop = Math.max(boundaryTop, boundaryBottom - calendar.height);
		const viewportTop = Math.min(
			Math.max(placeAbove ? aboveTop : belowTop, boundaryTop),
			maximumTop,
		);
		const minimumLeft = boundary.left + inset;
		const maximumLeft = Math.max(
			minimumLeft,
			boundary.right - inset - calendar.width,
		);
		const toggleCenter = (toggle.left + toggle.right) / 2;
		const viewportLeft = Math.min(
			Math.max(toggleCenter - calendar.width / 2, minimumLeft),
			maximumLeft,
		);
		const anchorX = Math.min(
			Math.max(toggleCenter - viewportLeft, 14),
			calendar.width - 14,
		);
		this.#calendar.style.top = `${Math.round(viewportTop - panel.top)}px`;
		this.#calendar.style.left = `${Math.round(viewportLeft - panel.left)}px`;
		this.#calendar.style.transform = 'none';
		this.#calendar.style.setProperty(
			'--ldp-user-observation-calendar-anchor-x',
			`${Math.round(anchorX)}px`,
		);
		this.#calendar.dataset.placement = placeAbove ? 'top' : 'bottom';
	}

	#onCalendarClick(event: MouseEvent): void {
		const target = closestTarget<HTMLElement>(event,
			'[data-user-observation-calendar-month],' +
			'[data-user-observation-calendar-day],' +
			'[data-user-observation-calendar-today],' +
			'[data-user-observation-calendar-clear]');
		if (!target) return;
		const monthOffset = target.dataset.userObservationCalendarMonth;
		if (monthOffset !== undefined) {
			const offset = Number(monthOffset);
			if (!Number.isInteger(offset) || offset === 0) return;
			this.#calendarMonth = new Date(
				this.#calendarMonth.getFullYear(),
				this.#calendarMonth.getMonth() + offset,
				1,
			);
			this.#renderCalendar();
			return;
		}
		if (target.dataset.userObservationCalendarToday !== undefined) {
			const now = new Date();
			this.#calendarMonth = monthStart(now);
			const day = readerCollectionDateKey(now.getTime());
			if ((this.#dayCounts.get(day) ?? 0) > 0) {
				this.#onDateChange(day);
			} else {
				this.#renderCalendar();
			}
			return;
		}
		if (target.dataset.userObservationCalendarClear !== undefined) {
			this.#onDateChange('');
			return;
		}
		const day = target.dataset.userObservationCalendarDay;
		if (day && (this.#dayCounts.get(day) ?? 0) > 0) {
			this.#onDateChange(day);
		}
	}

	#syncCalendarToggle(): void {
		const label = this.#date || '活动日历';
		const span = this.#document.createElement('span');
		span.textContent = label;
		this.#calendarToggle.replaceChildren(
			renderReaderIcon(this.#document, 'clock'),
			span,
		);
		this.#calendarToggle.title = this.#date
			? `当前筛选 ${this.#date}`
			: '按当前分类查看每月活跃程度';
	}

	#syncSortDirectionButton(): void {
		const ascending = this.#direction === 'asc';
		this.#sortDirection.replaceChildren(
			renderReaderIcon(
				this.#document,
				ascending ? 'chevron-up' : 'chevron-down',
			),
			this.#document.createTextNode(ascending ? '升序' : '降序'),
		);
		this.#sortDirection.setAttribute(
			'aria-label',
			ascending ? '切换为降序' : '切换为升序',
		);
		this.#sortDirection.title = ascending ? '当前升序' : '当前降序';
	}

	#renderCalendar(): void {
		const year = this.#calendarMonth.getFullYear();
		const month = this.#calendarMonth.getMonth();
		const today = readerCollectionDateKey(Date.now());
		this.#calendarTitle.textContent =
			`${year}年${String(month + 1).padStart(2, '0')}月`;
		const firstWeekday = (new Date(year, month, 1).getDay() + 6) % 7;
		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const monthPrefix = `${year}-${String(month + 1).padStart(2, '0')}-`;
		const maximum = Math.max(
			0,
			...[...this.#dayCounts]
				.filter(([day]) => day.startsWith(monthPrefix))
				.map(([, count]) => count),
		);
		const cells: Element[] = [];
		for (let index = 0; index < 42; index += 1) {
			const dayNumber = index - firstWeekday + 1;
			if (dayNumber < 1 || dayNumber > daysInMonth) {
				const empty = this.#document.createElement('span');
				empty.className = 'ldp-user-observation-calendar-empty';
				empty.setAttribute('aria-hidden', 'true');
				cells.push(empty);
				continue;
			}
			const day = `${monthPrefix}${String(dayNumber).padStart(2, '0')}`;
			const count = this.#dayCounts.get(day) ?? 0;
			const level = count === 0 || maximum === 0
				? 0
				: Math.max(1, Math.ceil(count / maximum * 4));
			const button = this.#document.createElement('button');
			button.type = 'button';
			button.className = 'ldp-user-observation-calendar-day';
			button.dataset.userObservationCalendarDay = day;
			button.dataset.activityLevel = String(level);
			button.disabled = count <= 0;
			button.classList.toggle('is-selected', day === this.#date);
			button.setAttribute('aria-pressed', String(day === this.#date));
			button.setAttribute(
				'aria-label',
				`${month + 1}月${dayNumber}日，${count} 条当前分类记录`,
			);
			if (day === today) button.setAttribute('aria-current', 'date');
			const dayLabel = this.#document.createElement('span');
			dayLabel.textContent = String(dayNumber);
			const countLabel = this.#document.createElement('small');
			countLabel.textContent = count ? String(count) : '';
			button.append(dayLabel, countLabel);
			cells.push(button);
		}
		this.#calendarGrid.replaceChildren(...cells);
		const clear = this.#calendar.querySelector<HTMLButtonElement>(
			'[data-user-observation-calendar-clear]',
		);
		if (clear) clear.disabled = !this.#date;
	}

	destroy(): void {
		this.scope.destroy();
	}
}

export function syncReaderFilterOptions(
	select: HTMLSelectElement,
	allLabel: string,
	emptyLabel: string,
	options: readonly ReaderFilterOption[],
	selected: string,
): void {
	const signature = JSON.stringify(options);
	if (select.dataset.optionSignature !== signature) {
		const all = select.ownerDocument.createElement('option');
		all.value = '';
		all.textContent = options.length ? allLabel : emptyLabel;
		select.replaceChildren(all, ...options.map((entry) => {
			const option = select.ownerDocument.createElement('option');
			option.value = entry.value;
			option.textContent = `${entry.label} · ${entry.count}`;
			return option;
		}));
		select.dataset.optionSignature = signature;
	}
	select.disabled = options.length === 0;
	let matched = false;
	for (const option of select.options) {
		const active = !matched && option.value === selected;
		option.selected = active;
		if (active) matched = true;
	}
	if (!matched && select.options[0]) select.options[0].selected = true;
}
