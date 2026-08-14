import { LifecycleScope } from '../kernel/lifecycle.js';
import { eventPathIncludes } from '../dom/event-target.js';

const SELECTOR = [
	'select.ldp-reader-select',
	'select.ldp-cache-select',
	'select.ldp-collection-scope',
	'select.ldp-font-weight-select',
].join(',');

export const READER_SELECT_DISMISS_EVENT = 'ldp-reader-select-dismiss';

function eventElement(event: Event): Element | null {
	const target = event.target as Element | null;
	return target && typeof target.closest === 'function' ? target : null;
}

/**
 * Reader 内单选下拉的唯一视觉 owner。
 *
 * 原生 select 继续保存值、表单语义和既有 change listener；本类只接管展开层，
 * 避免不同浏览器把同一设置渲染成互不一致的系统菜单。
 */
export class ReaderSelectSurface {
	readonly scope: LifecycleScope;
	readonly #document: Document;
	readonly #root: HTMLElement;
	readonly #states = new Map<HTMLSelectElement, HTMLElement>();
	#openSelect: HTMLSelectElement | null = null;

	constructor(options: Readonly<{
		readonly document: Document;
		readonly root: HTMLElement;
		readonly parentScope?: LifecycleScope;
	}>) {
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#document = options.document;
		this.#root = options.root;
		this.#scan(options.root);
		const Observer = options.document.defaultView?.MutationObserver ??
			(globalThis.MutationObserver as typeof MutationObserver | undefined);
		if (typeof Observer === 'function') {
			const observer = new Observer((mutations) => {
				for (const mutation of mutations) {
					for (const added of mutation.addedNodes) {
						const element = added as Element;
						if (added.nodeType === 1) this.#scan(element);
					}
				}
				this.#prune();
			});
			this.scope.observe(observer, options.root, {
				childList: true,
				subtree: true,
			});
		}
		this.scope.listen(options.root, 'pointerdown', (event) =>
			this.#pointerDown(event as PointerEvent));
		this.scope.listen(options.root, 'mousedown', (event) =>
			this.#mouseDown(event as MouseEvent));
		this.scope.listen(options.root, 'click', (event) => this.#click(event));
		this.scope.listen(options.root, 'keydown', (event) =>
			this.#keydown(event as KeyboardEvent));
		this.scope.listen(options.root, 'change', (event) => {
			const select = eventElement(event)?.closest<HTMLSelectElement>(SELECTOR);
			if (select) this.#sync(select);
		});
		this.scope.listen(options.root, READER_SELECT_DISMISS_EVENT, () => {
			this.#close();
		});
		this.scope.listen(options.document, 'pointerdown', (event) => {
			const select = this.#openSelect;
			if (!select) return;
			const wrapper = this.#states.get(select);
			if (!eventPathIncludes(event, wrapper ?? null)) this.#close();
		}, true);
		const viewport = options.document.defaultView;
		if (viewport) {
			this.scope.listen(viewport, 'resize', () => this.#positionOpenMenu());
		}
		for (const type of [
			'ldp-reader-window-change',
			'ldp-reader-workspace-change',
		]) {
			this.scope.listen(options.root, type, () => this.#positionOpenMenu());
		}
		this.scope.add(() => {
			this.#close();
			for (const [select, wrapper] of this.#states) {
				select.removeAttribute('aria-expanded');
				select.removeAttribute('aria-haspopup');
				select.removeAttribute('data-reader-select-enhanced');
				wrapper.replaceWith(select);
			}
			this.#states.clear();
		});
	}

	destroy(): void {
		this.scope.destroy();
	}

	#scan(root: Element): void {
		if (root.matches(SELECTOR)) this.#enhance(root as HTMLSelectElement);
		for (const select of root.querySelectorAll<HTMLSelectElement>(SELECTOR)) {
			this.#enhance(select);
		}
	}

	#enhance(select: HTMLSelectElement): void {
		if (
			select.multiple ||
			select.dataset.readerSelectEnhanced ||
			!select.parentNode
		) return;
		const wrapper = this.#document.createElement('span');
		wrapper.className = 'ldp-select-surface';
		const indicator = this.#document.createElement('span');
		indicator.className = 'ldp-select-indicator';
		indicator.setAttribute('aria-hidden', 'true');
		const menu = this.#document.createElement('span');
		menu.className = 'ldp-select-menu ldp-picker-options';
		menu.setAttribute('role', 'presentation');
		menu.hidden = true;
		select.parentNode.insertBefore(wrapper, select);
		wrapper.append(select, indicator, menu);
		select.dataset.readerSelectEnhanced = '1';
		select.setAttribute('aria-haspopup', 'listbox');
		select.setAttribute('aria-expanded', 'false');
		this.#states.set(select, wrapper);
	}

	#prune(): void {
		for (const [select] of this.#states) {
			if (select.isConnected) continue;
			if (this.#openSelect === select) this.#openSelect = null;
			this.#states.delete(select);
		}
	}

	#pointerDown(event: PointerEvent): void {
		if (event.button !== 0) return;
		const select = eventElement(event)?.closest<HTMLSelectElement>(SELECTOR);
		if (!select || !this.#root.contains(select) || select.disabled) return;
		event.preventDefault();
		select.focus({ preventScroll: true });
		if (this.#openSelect === select) this.#close();
		else this.#open(select);
	}

	#mouseDown(event: MouseEvent): void {
		const select = eventElement(event)?.closest<HTMLSelectElement>(SELECTOR);
		if (select && this.#states.has(select)) event.preventDefault();
	}

	#click(event: Event): void {
		const target = eventElement(event);
		const option = target?.closest<HTMLButtonElement>('[data-reader-select-value]');
		if (option) {
			const select = this.#openSelect;
			if (!select || !this.#states.get(select)?.contains(option)) return;
			event.preventDefault();
			if (option.disabled) return;
			const value = option.dataset.readerSelectValue ?? '';
			const changed = select.value !== value;
			let matched = false;
			for (const nativeOption of select.options) {
				const selected = !matched && nativeOption.value === value;
				nativeOption.selected = selected;
				if (selected) matched = true;
			}
			this.#sync(select);
			this.#close();
			select.focus({ preventScroll: true });
			if (changed) {
				const EventConstructor = this.#document.defaultView?.Event ?? Event;
				select.dispatchEvent(new EventConstructor('input', { bubbles: true }));
				select.dispatchEvent(new EventConstructor('change', { bubbles: true }));
			}
			return;
		}
		const select = target?.closest<HTMLSelectElement>(SELECTOR);
		if (select && this.#states.has(select)) event.preventDefault();
	}

	#keydown(event: KeyboardEvent): void {
		const target = eventElement(event);
		const search = target?.closest<HTMLInputElement>('.ldp-select-search');
		if (search && this.#openSelect) {
			if (event.key === 'Escape') {
				event.preventDefault();
				this.#close(true);
				return;
			}
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				this.#enabledOptions(this.#openSelect)[0]?.focus();
			}
			return;
		}
		const option = target?.closest<HTMLButtonElement>('[data-reader-select-value]');
		if (option && this.#openSelect) {
			const buttons = this.#enabledOptions(this.#openSelect);
			const index = buttons.indexOf(option);
			if (event.key === 'Escape') {
				event.preventDefault();
				this.#close(true);
				return;
			}
			if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
				event.preventDefault();
				const delta = event.key === 'ArrowDown' ? 1 : -1;
				buttons[(index + delta + buttons.length) % buttons.length]?.focus();
			}
			return;
		}
		const select = target?.closest<HTMLSelectElement>(SELECTOR);
		if (!select || !this.#states.has(select) || select.disabled) return;
		if (event.key === 'Escape' && this.#openSelect === select) {
			event.preventDefault();
			this.#close(true);
			return;
		}
		if (['Enter', ' ', 'F4'].includes(event.key) ||
			(event.altKey && ['ArrowDown', 'ArrowUp'].includes(event.key))) {
			event.preventDefault();
			if (this.#openSelect === select) this.#close();
			else this.#open(select, true);
		}
	}

	#open(select: HTMLSelectElement, focusSelected = false): void {
		this.#close();
		const wrapper = this.#states.get(select);
		const menu = wrapper?.querySelector<HTMLElement>('.ldp-select-menu');
		if (!wrapper || !menu) return;
		const options = this.#document.createElement('span');
		options.className = 'ldp-select-options';
		options.setAttribute('role', 'listbox');
		options.setAttribute(
			'aria-label',
			select.getAttribute('aria-label') || '下拉选项',
		);
		options.replaceChildren(...[...select.options].map((nativeOption) => {
			const option = this.#document.createElement('button');
			option.type = 'button';
			option.className = 'ldp-select-option ldp-picker-option';
			option.dataset.readerSelectValue = nativeOption.value;
			option.textContent = nativeOption.label || nativeOption.textContent || '';
			option.disabled = nativeOption.disabled;
			option.hidden = nativeOption.hidden;
			option.setAttribute('role', 'option');
			option.setAttribute('aria-selected', String(nativeOption.selected));
			return option;
		}));
		if (select.dataset.readerSelectSearchable === 'true') {
			const search = this.#document.createElement('input');
			search.type = 'search';
			search.className = 'ldp-select-search';
			search.placeholder = '搜索字体';
			search.setAttribute('aria-label', '搜索字体');
			const empty = this.#document.createElement('span');
			empty.className = 'ldp-select-empty';
			empty.textContent = '没有匹配的字体';
			empty.hidden = true;
			search.addEventListener('input', () => {
				const query = search.value.trim().toLocaleLowerCase();
				let visible = 0;
				for (const option of options.querySelectorAll<HTMLButtonElement>(
					'[data-reader-select-value]',
				)) {
					const matches = !query || (option.textContent ?? '')
						.toLocaleLowerCase().includes(query);
					option.hidden = !matches;
					if (matches) visible += 1;
				}
				empty.hidden = visible > 0;
			});
			menu.replaceChildren(search, options, empty);
		} else {
			menu.replaceChildren(options);
		}
		this.#openSelect = select;
		select.setAttribute('aria-expanded', 'true');
		menu.hidden = false;
		this.#positionOpenMenu();
		const search = menu.querySelector<HTMLInputElement>('.ldp-select-search');
		if (search) {
			search.focus({ preventScroll: true });
		} else if (focusSelected) {
			this.#enabledOptions(select).find((option) =>
				option.dataset.readerSelectValue === select.value)?.focus();
		}
	}

	#positionOpenMenu(): void {
		const select = this.#openSelect;
		const wrapper = select ? this.#states.get(select) : null;
		const menu = wrapper?.querySelector<HTMLElement>('.ldp-select-menu');
		const viewport = this.#document.defaultView;
		if (!select || !wrapper || !menu || menu.hidden || !viewport) return;
		menu.style.removeProperty('left');
		menu.style.removeProperty('max-height');
		menu.style.removeProperty('max-width');
		wrapper.classList.remove('is-menu-above');
		const selectRect = select.getBoundingClientRect();
		const menuRect = menu.getBoundingClientRect();
		const menuWidth = menuRect.width || menu.offsetWidth;
		const menuHeight = menuRect.height || menu.offsetHeight;
		const margin = 12;
		const gap = 6;
		const collisionSurface = select.closest<HTMLElement>(
			'.ldp-unwanted-topic-filter-content,' +
				'.ldp-settings-popover,.ldp-reader-floating-window,' +
				'.ldp-notifications-popover,.ldp-history-popover,' +
				'.ldp-bookmarks-popover',
		);
		const collisionRect = collisionSurface?.getBoundingClientRect();
		const bounds = Object.freeze({
			left: Math.max(margin, (collisionRect?.left ?? 0) + margin),
			right: Math.min(
				viewport.innerWidth - margin,
				(collisionRect?.right ?? viewport.innerWidth) - margin,
			),
			top: Math.max(margin, (collisionRect?.top ?? 0) + margin),
			bottom: Math.min(
				viewport.innerHeight - margin,
				(collisionRect?.bottom ?? viewport.innerHeight) - margin,
			),
		});
		if (menuWidth > 0) {
			const availableWidth = Math.max(1, bounds.right - bounds.left);
			const positionedWidth = Math.min(menuWidth, availableWidth);
			if (menuWidth > availableWidth) {
				menu.style.maxWidth = `${Math.floor(availableWidth)}px`;
			}
			const maxLeft = Math.max(bounds.left, bounds.right - positionedWidth);
			const left = Math.max(
				bounds.left,
				Math.min(maxLeft, menuRect.left),
			);
			menu.style.left = `${Math.round(left - menuRect.left)}px`;
		}
		const spaceBelow = Math.max(
			0,
			bounds.bottom - selectRect.bottom - gap,
		);
		const spaceAbove = Math.max(
			0,
			selectRect.top - bounds.top - gap,
		);
		const menuAbove = menuHeight > spaceBelow && spaceAbove > spaceBelow;
		wrapper.classList.toggle('is-menu-above', menuAbove);
		const availableHeight = menuAbove ? spaceAbove : spaceBelow;
		if (menuHeight > availableHeight) {
			menu.style.maxHeight = `${Math.max(1, Math.floor(availableHeight))}px`;
		}
	}

	#sync(select: HTMLSelectElement): void {
		const wrapper = this.#states.get(select);
		wrapper?.classList.toggle('is-disabled', select.disabled);
		for (const option of wrapper?.querySelectorAll<HTMLButtonElement>(
			'[data-reader-select-value]',
		) ?? []) {
			option.setAttribute(
				'aria-selected',
				String(option.dataset.readerSelectValue === select.value),
			);
		}
	}

	#enabledOptions(select: HTMLSelectElement): HTMLButtonElement[] {
		return [...(this.#states.get(select)?.querySelectorAll<HTMLButtonElement>(
			'[data-reader-select-value]:not(:disabled)',
		) ?? [])].filter((option) => !option.hidden);
	}

	#close(restoreFocus = false): void {
		const select = this.#openSelect;
		if (!select) return;
		this.#openSelect = null;
		select.setAttribute('aria-expanded', 'false');
		const wrapper = this.#states.get(select);
		wrapper?.classList.remove('is-menu-above');
		const menu = wrapper?.querySelector<HTMLElement>('.ldp-select-menu');
		if (menu) {
			menu.hidden = true;
			menu.style.removeProperty('left');
			menu.style.removeProperty('max-height');
			menu.style.removeProperty('max-width');
		}
		if (restoreFocus) select.focus({ preventScroll: true });
	}
}
