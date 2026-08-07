import type {
	DiscourseNativeTopicEditCategory,
	DiscourseNativeTopicEditTag,
} from '../discourse/native-host-api.js';
import { htmlElement } from '../dom/html-element.js';
import type { LifecycleScope } from '../kernel/lifecycle.js';
import {
	ReaderActionFormSurfaceHost,
	renderReaderActionIcon,
	type ReaderActionFormFrame,
	type ReaderActionFormTimingOptions,
} from './reader-action-form-support.js';

export interface ReaderTopicEditSubmission {
	readonly title: string;
	readonly category: DiscourseNativeTopicEditCategory;
	readonly tags: readonly DiscourseNativeTopicEditTag[];
}

export interface ReaderTopicEditRequest {
	readonly title: string;
	readonly categoryId: number;
	readonly tags: readonly DiscourseNativeTopicEditTag[];
	readonly categories: readonly DiscourseNativeTopicEditCategory[];
	readonly signal?: AbortSignal;
	readonly searchTags: (request: Readonly<{
		readonly query: string;
		readonly categoryId: number;
		readonly selected: readonly DiscourseNativeTopicEditTag[];
	}>) => Promise<readonly DiscourseNativeTopicEditTag[]>;
	readonly submit: (
		submission: ReaderTopicEditSubmission,
	) => void | Promise<void>;
}

export interface ReaderTopicEditFormPort {
	open(request: ReaderTopicEditRequest): Promise<boolean>;
}

export interface ReaderTopicEditFormSurfaceOptions
	extends ReaderActionFormTimingOptions {
	readonly document: Document;
	readonly root: HTMLElement;
	readonly renderIcon?: (name: string, document: Document) => Node | null;
	readonly parentScope?: LifecycleScope;
}

function tagKey(value: unknown): string {
	return String(value ?? '').trim().toLocaleLowerCase();
}

function categorySearchText(
	category: DiscourseNativeTopicEditCategory,
	byId: ReadonlyMap<number, DiscourseNativeTopicEditCategory>,
): string {
	const parent = category.parentCategoryId
		? byId.get(category.parentCategoryId)
		: null;
	return `${parent?.name ?? ''} ${category.name}`.trim().toLocaleLowerCase();
}

/**
 * Header Topic 编辑的唯一 Shell surface。
 *
 * 组件只拥有 dialog、分类 picker、标签 chips、校验、焦点与关闭竞态；分类/标签数据和
 * Topic mutation 都由外部原生端口与领域协调器提供。
 */
export class ReaderTopicEditFormSurface implements ReaderTopicEditFormPort {
	readonly scope: LifecycleScope;
	readonly #host: ReaderActionFormSurfaceHost;

	constructor(options: ReaderTopicEditFormSurfaceOptions) {
		this.#host = new ReaderActionFormSurfaceHost({
			...options,
			label: 'ReaderTopicEditFormSurface',
		});
		this.scope = this.#host.scope;
	}

	get #document(): Document {
		return this.#host.document;
	}

	open(request: ReaderTopicEditRequest): Promise<boolean> {
		if (request.signal?.aborted) return Promise.resolve(false);
		const categories = request.categories.filter((category) =>
			Number.isSafeInteger(category.id) && category.id > 0 &&
			String(category.name).trim());
		if (!categories.length) {
			return Promise.reject(new Error('原站分类数据尚未就绪，请稍后重试'));
		}
		const categoryById = new Map(categories.map((category) => [
			category.id,
			category,
		]));
		let selectedCategoryId = categoryById.has(request.categoryId)
			? request.categoryId
			: categories[0]!.id;
		const availableTags = new Map<string, DiscourseNativeTopicEditTag>();
		const selectedTagKeys = new Set<string>();
		for (const tag of request.tags) {
			const key = tagKey(tag.name);
			if (!key) continue;
			availableTags.set(key, tag);
			selectedTagKeys.add(key);
		}

		const { id, previousFocus } = this.#host.prepare();
		const layer = htmlElement(
			this.#document,
			'div',
			'ldp-reader-action-layer ldp-topic-edit-layer',
		);
		const dialog = htmlElement(
			this.#document,
			'section',
			'ldp-reader-action-dialog ldp-topic-edit-dialog',
		);
		dialog.setAttribute('role', 'dialog');
		dialog.setAttribute('aria-modal', 'true');
		const titleId = `ldp-topic-edit-dialog-title-${id}`;
		dialog.setAttribute('aria-labelledby', titleId);

		const head = htmlElement(this.#document, 'div', 'ldp-reader-action-head');
		const heading = htmlElement(this.#document, 'strong', '', '编辑帖子信息');
		heading.id = titleId;
		const close = this.#iconButton(
			'ldp-reader-action-close ldp-topic-edit-close',
			'关闭编辑弹层',
			'x',
		);
		close.dataset.topicEditClose = '';
		head.append(heading, close);

		const form = htmlElement(
			this.#document,
			'form',
			'ldp-reader-action-form ldp-topic-edit-form',
		);
		const body = htmlElement(
			this.#document,
			'div',
			'ldp-reader-action-body ldp-topic-edit-body',
		);
		const titleField = htmlElement(
			this.#document,
			'label',
			'ldp-topic-edit-field ldp-topic-edit-title',
		);
		const titleLabel = htmlElement(this.#document, 'span', '', '标题');
		const titleInput = this.#document.createElement('input');
		titleInput.name = 'title';
		titleInput.type = 'text';
		titleInput.maxLength = 255;
		titleInput.required = true;
		titleInput.value = String(request.title ?? '').trim();
		titleField.append(titleLabel, titleInput);

		const categoryField = htmlElement(
			this.#document,
			'div',
			'ldp-topic-edit-field',
		);
		const categoryLabel = htmlElement(this.#document, 'span', '', '类别');
		categoryLabel.id = `ldp-topic-edit-category-label-${id}`;
		const categoryRoot = htmlElement(
			this.#document,
			'div',
			'ldp-topic-edit-category',
		);
		const categoryTrigger = htmlElement(
			this.#document,
			'button',
			'ldp-topic-edit-category-trigger ldp-picker-trigger',
		);
		categoryTrigger.type = 'button';
		categoryTrigger.setAttribute('aria-haspopup', 'listbox');
		categoryTrigger.setAttribute('aria-expanded', 'false');
		categoryTrigger.setAttribute('aria-labelledby', categoryLabel.id);
		const categoryValue = htmlElement(
			this.#document,
			'span',
			'ldp-topic-edit-category-value',
		);
		categoryTrigger.append(categoryValue, this.#icon('chevron-right'));
		const categoryMenu = htmlElement(
			this.#document,
			'div',
			'ldp-topic-edit-category-menu',
		);
		categoryMenu.hidden = true;
		const categorySearchLabel = htmlElement(
			this.#document,
			'label',
			'ldp-topic-edit-category-search ldp-picker-search',
		);
		categorySearchLabel.append(this.#icon('search'));
		const categorySearch = this.#document.createElement('input');
		categorySearch.name = 'category-search';
		categorySearch.type = 'search';
		categorySearch.autocomplete = 'off';
		categorySearch.placeholder = '搜索类别';
		categorySearch.setAttribute('aria-label', '搜索类别');
		categorySearchLabel.append(categorySearch);
		const categoryOptions = htmlElement(
			this.#document,
			'div',
			'ldp-topic-edit-category-options ldp-picker-options',
		);
		categoryOptions.setAttribute('role', 'listbox');
		categoryOptions.setAttribute('aria-labelledby', categoryLabel.id);
		categoryMenu.append(categorySearchLabel, categoryOptions);
		categoryRoot.append(categoryTrigger, categoryMenu);
		categoryField.append(categoryLabel, categoryRoot);

		const tagField = htmlElement(this.#document, 'label', 'ldp-topic-edit-field');
		const tagLabel = htmlElement(this.#document, 'span', '', 'label');
		const tagControl = htmlElement(
			this.#document,
			'span',
			'ldp-topic-edit-label-control',
		);
		const tagValues = htmlElement(
			this.#document,
			'span',
			'ldp-topic-edit-label-values',
		);
		const tagInput = htmlElement(
			this.#document,
			'input',
			'ldp-topic-edit-label-input',
		);
		tagInput.name = 'tag-search';
		tagInput.type = 'text';
		tagInput.autocomplete = 'off';
		tagInput.placeholder = '搜索 label';
		tagInput.setAttribute('aria-label', '添加 label');
		const tagOptionsId = `ldp-topic-edit-label-options-${id}`;
		tagInput.setAttribute('list', tagOptionsId);
		const tagOptions = htmlElement(
			this.#document,
			'datalist',
			'ldp-topic-edit-label-options',
		);
		tagOptions.id = tagOptionsId;
		tagControl.append(tagValues, tagInput);
		tagField.append(tagLabel, tagControl, tagOptions);

		const status = htmlElement(this.#document, 'p', 'ldp-topic-edit-status');
		status.setAttribute('role', 'status');
		status.setAttribute('aria-live', 'polite');
		body.append(titleField, categoryField, tagField, status);

		const footer = htmlElement(
			this.#document,
			'div',
			'ldp-reader-action-footer ldp-topic-edit-actions',
		);
		const submit = this.#iconButton(
			'ldp-topic-edit-save',
			'保存帖子信息',
			'check',
		);
		submit.type = 'submit';
		const cancel = this.#iconButton(
			'ldp-topic-edit-cancel',
			'取消编辑',
			'x',
		);
		cancel.dataset.topicEditCancel = '';
		footer.append(submit, cancel);
		form.append(body, footer);
		dialog.append(head, form);
		layer.append(dialog);

		{
			let busy = false;
			let searchTimer: ReturnType<typeof setTimeout> | null = null;
			let searchSequence = 0;
			const selectedTags = (): readonly DiscourseNativeTopicEditTag[] =>
				Object.freeze([...selectedTagKeys]
					.map((key) => availableTags.get(key))
					.filter((tag): tag is DiscourseNativeTopicEditTag => Boolean(tag)));
			const clearSearch = (): void => {
				searchSequence += 1;
				if (searchTimer !== null) clearTimeout(searchTimer);
				searchTimer = null;
			};
			const frame: ReaderActionFormFrame = {
				layer: layer as HTMLDivElement,
				dialog,
				form: form as HTMLFormElement,
				body: body as HTMLDivElement,
				status: status as HTMLParagraphElement,
				cancel,
				submit,
			};
			const session = this.#host.start({
				frame,
				previousFocus,
				closeSelector: '[data-topic-edit-close]',
				cancelSelector: '[data-topic-edit-cancel]',
				signal: request.signal,
				onSettled: clearSearch,
			});
			const closeCategoryMenu = (restoreFocus = false): void => {
				categoryMenu.hidden = true;
				categoryTrigger.setAttribute('aria-expanded', 'false');
				if (restoreFocus && !categoryTrigger.disabled) {
					categoryTrigger.focus({ preventScroll: true });
				}
			};
			const setBusy = (value: boolean): void => {
				busy = value;
				session.setBusy(value);
				titleInput.disabled = value;
				categoryTrigger.disabled = value;
				categorySearch.disabled = value;
				tagInput.disabled = value;
				submit.disabled = value;
				cancel.disabled = value;
				close.disabled = value;
				form.setAttribute('aria-busy', String(value));
				if (value) closeCategoryMenu();
			};
			const syncCategory = (): void => {
				const selected = categoryById.get(selectedCategoryId);
				const parent = selected?.parentCategoryId
					? categoryById.get(selected.parentCategoryId)
					: null;
				categoryValue.textContent = selected
					? `${parent ? `${parent.name} / ` : ''}${selected.name}`
					: '请选择类别';
				for (const option of categoryOptions.querySelectorAll<HTMLElement>(
					'.ldp-topic-edit-category-option',
				)) {
					option.setAttribute(
						'aria-selected',
						String(Number(option.dataset.categoryId) === selectedCategoryId),
					);
				}
			};
			const renderCategories = (): void => {
				const fragment = this.#document.createDocumentFragment();
				for (const category of categories) {
					const parent = category.parentCategoryId
						? categoryById.get(category.parentCategoryId)
						: null;
					const option = htmlElement(
						this.#document,
						'button',
						'ldp-topic-edit-category-option ldp-picker-option',
					);
					option.type = 'button';
					option.dataset.categoryId = String(category.id);
					option.dataset.searchText = categorySearchText(
						category,
						categoryById,
					);
					option.setAttribute('role', 'option');
					const dot = htmlElement(
						this.#document,
						'span',
						'ldp-topic-edit-category-dot',
					);
					if (/^[0-9a-f]{6}$/i.test(category.color)) {
						dot.style.setProperty(
							'--ldp-category-color',
							`#${category.color}`,
						);
					}
					const copy = htmlElement(
						this.#document,
						'span',
						'ldp-topic-edit-category-copy ldp-picker-option-copy',
					);
					const name = htmlElement(
						this.#document,
						'strong',
						'',
						category.name,
					);
					const level = htmlElement(
						this.#document,
						'small',
						'',
						parent?.name ?? '一级类别',
					);
					copy.append(name, level);
					option.append(dot, copy);
					fragment.append(option);
				}
				categoryOptions.replaceChildren(fragment);
				syncCategory();
			};
			const scheduleTagSearch = (): void => {
				clearSearch();
				const sequence = searchSequence;
				searchTimer = setTimeout(() => {
					searchTimer = null;
					void request.searchTags({
						query: tagInput.value.trim(),
						categoryId: selectedCategoryId,
						selected: selectedTags(),
					}).then((tags) => {
						if (!session.active || sequence !== searchSequence) return;
						for (const tag of tags) {
							const key = tagKey(tag.name);
							if (key) availableTags.set(key, tag);
						}
						tagOptions.replaceChildren(...tags.map((tag) => {
							const option = htmlElement(this.#document, 'option');
							option.value = tag.name;
							return option;
						}));
						status.textContent = '';
					}).catch((cause) => {
						if (!session.active || sequence !== searchSequence) return;
						status.textContent = cause instanceof Error
							? cause.message
							: '标签搜索失败，请重试';
					});
				}, 300);
			};
			const renderTags = (): void => {
				tagValues.replaceChildren(...selectedTags().map((tag) => {
					const chip = htmlElement(
						this.#document,
						'span',
						'ldp-topic-edit-label-chip',
					);
					const copy = htmlElement(this.#document, 'span', '', tag.name);
					const remove = this.#iconButton(
						'ldp-topic-edit-label-remove',
						`移除 label ${tag.name}`,
						'x',
					);
					remove.dataset.labelKey = tagKey(tag.name);
					chip.append(copy, remove);
					return chip;
				}));
			};
			const commitTagInput = (showError = true): boolean => {
				const raw = tagInput.value.replace(/[,，]\s*$/, '').trim();
				if (!raw) {
					tagInput.value = '';
					return true;
				}
				const key = tagKey(raw);
				const tag = availableTags.get(key);
				if (!tag) {
					if (showError) status.textContent = `没有找到 label“${raw}”`;
					return false;
				}
				selectedTagKeys.add(key);
				tagInput.value = '';
				status.textContent = '';
				renderTags();
				scheduleTagSearch();
				return true;
			};

			layer.addEventListener('click', (event) => {
				const target = event.target as Element | null;
				if (!target) return;
				if (!target.closest('.ldp-topic-edit-category')) {
					closeCategoryMenu();
				}
			});
			layer.addEventListener('keydown', (event) => {
				const keyboard = event as KeyboardEvent;
				if (keyboard.key === 'Escape' && !categoryMenu.hidden && !busy) {
					keyboard.preventDefault();
					keyboard.stopImmediatePropagation();
					closeCategoryMenu(true);
					return;
				}
				if (keyboard.key === 'Escape' && !busy) {
					keyboard.stopPropagation();
				}
			});
			categoryTrigger.addEventListener('click', () => {
				if (busy) return;
				if (!categoryMenu.hidden) {
					closeCategoryMenu(true);
					return;
				}
				categoryMenu.hidden = false;
				categoryTrigger.setAttribute('aria-expanded', 'true');
				categorySearch.value = '';
				for (const option of categoryOptions.children) {
					(option as HTMLElement).hidden = false;
				}
				categorySearch.focus({ preventScroll: true });
			});
			categoryTrigger.addEventListener('keydown', (event) => {
				if ((event as KeyboardEvent).key !== 'ArrowDown') return;
				event.preventDefault();
				categoryTrigger.click();
			});
			categorySearch.addEventListener('input', () => {
				const query = categorySearch.value.trim().toLocaleLowerCase();
				for (const option of categoryOptions.querySelectorAll<HTMLElement>(
					'.ldp-topic-edit-category-option',
				)) {
					option.hidden = Boolean(
						query && !String(option.dataset.searchText).includes(query),
					);
				}
			});
			categoryOptions.addEventListener('click', (event) => {
				const option = (event.target as Element | null)?.closest<HTMLElement>(
					'.ldp-topic-edit-category-option',
				);
				if (!option || busy) return;
				selectedCategoryId = Number(option.dataset.categoryId);
				syncCategory();
				closeCategoryMenu(true);
				scheduleTagSearch();
			});
			tagInput.addEventListener('input', scheduleTagSearch);
			tagInput.addEventListener('change', () => commitTagInput(false));
			tagInput.addEventListener('keydown', (event) => {
				const key = (event as KeyboardEvent).key;
				if (!['Enter', ',', '，'].includes(key)) return;
				event.preventDefault();
				commitTagInput();
			});
			tagValues.addEventListener('click', (event) => {
				const remove = (event.target as Element | null)?.closest<HTMLElement>(
					'.ldp-topic-edit-label-remove',
				);
				if (!remove || busy) return;
				selectedTagKeys.delete(String(remove.dataset.labelKey));
				renderTags();
				scheduleTagSearch();
				tagInput.focus({ preventScroll: true });
			});
			form.addEventListener('submit', (event) => {
				event.preventDefault();
				if (busy || !commitTagInput()) return;
				const nextTitle = titleInput.value.trim();
				const category = categoryById.get(selectedCategoryId);
				if (!nextTitle) {
					status.textContent = '标题不能为空';
					titleInput.focus({ preventScroll: true });
					return;
				}
				if (!category) {
					status.textContent = '请选择类别';
					categoryTrigger.focus({ preventScroll: true });
					return;
				}
				setBusy(true);
				status.textContent = '正在保存…';
				void new Promise<void>((resolve) => {
					resolve(request.submit(Object.freeze({
						title: nextTitle,
						category,
						tags: selectedTags(),
					})));
				}).then(() => {
					if (!session.active) return;
					session.settle(true);
				}).catch((cause) => {
					if (!session.active) return;
					status.textContent = cause instanceof Error
						? cause.message
						: '保存失败，请重试';
					setBusy(false);
				});
			});

			renderCategories();
			renderTags();
			session.mount(() => {
				titleInput.focus({ preventScroll: true });
				titleInput.select();
			});
			scheduleTagSearch();
			return session.result;
		}
	}

	destroy(): void {
		this.#host.destroy();
	}

	#icon(name: string): Node {
		return renderReaderActionIcon(
			this.#document,
			name,
			this.#host.renderIcon,
		);
	}

	#iconButton(className: string, label: string, icon: string): HTMLButtonElement {
		const button = htmlElement(this.#document, 'button', className);
		button.type = 'button';
		button.setAttribute('aria-label', label);
		button.append(this.#icon(icon));
		return button;
	}
}
