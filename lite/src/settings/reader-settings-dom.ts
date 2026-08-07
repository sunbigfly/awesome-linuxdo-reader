export function settingsElement<K extends keyof HTMLElementTagNameMap>(
	document: Document,
	tagName: K,
	className = '',
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tagName);
	node.className = className;
	return node;
}

export function settingsIcon(
	document: Document,
	name: string,
): SVGSVGElement {
	return createReaderIcon(document, name);
}

export function settingsOption(
	document: Document,
	value: string,
	label: string,
): HTMLOptionElement {
	const option = settingsElement(document, 'option');
	option.value = value;
	option.textContent = label;
	return option;
}

export function settingsButton(
	document: Document,
	className: string,
	ariaLabel = '',
	iconName = '',
	text = '',
): HTMLButtonElement {
	const button = settingsElement(document, 'button', className);
	button.type = 'button';
	if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
	if (iconName) button.append(settingsIcon(document, iconName));
	if (text) {
		const label = settingsElement(document, 'span');
		label.textContent = text;
		button.append(label);
	}
	return button;
}

export function settingsCopy(
	document: Document,
	className: string,
	titleText: string,
	descriptionText = '',
): HTMLElement {
	const copy = settingsElement(document, 'span', className);
	const title = settingsElement(document, 'strong');
	title.textContent = titleText;
	copy.append(title);
	if (descriptionText) {
		const description = settingsElement(document, 'small');
		description.textContent = descriptionText;
		copy.append(description);
	}
	return copy;
}

export interface ReaderSettingsSwitch {
	readonly root: HTMLElement;
	readonly input: HTMLInputElement;
}

export function settingsSwitch(
	document: Document,
	label: string,
	className = '',
): ReaderSettingsSwitch {
	const root = settingsElement(document, 'span', 'ldp-setting-switch');
	const input = settingsElement(document, 'input', className);
	input.type = 'checkbox';
	input.role = 'switch';
	input.setAttribute('aria-label', label);
	const track = settingsElement(
		document,
		'span',
		'ldp-setting-switch-track',
	);
	track.setAttribute('aria-hidden', 'true');
	root.append(input, track);
	return Object.freeze({ root, input });
}

export function settingsOptionRow(
	document: Document,
	titleText: string,
	descriptionText: string,
	control: HTMLElement,
	extraClass = '',
): HTMLElement {
	const row = settingsElement(
		document,
		control.tagName === 'BUTTON' ? 'div' : 'label',
		`ldp-setting-row ldp-setting-option-row ${extraClass}`.trim(),
	);
	const copy = settingsCopy(
		document,
		'ldp-setting-option-copy',
		titleText,
		descriptionText,
	);
	row.append(copy, control);
	return row;
}

export function settingsSection(
	document: Document,
	titleText: string,
	descriptionText: string,
	wrapCopy = false,
): HTMLElement {
	const section = settingsElement(
		document,
		'section',
		'ldp-settings-category-group',
	);
	const head = settingsElement(
		document,
		'header',
		'ldp-settings-category-head',
	);
	const copy = wrapCopy
		? settingsElement(document, 'span', 'ldp-settings-category-head-copy')
		: head;
	const title = settingsElement(document, 'strong');
	title.textContent = titleText;
	const description = settingsElement(document, 'small');
	description.textContent = descriptionText;
	copy.append(title, description);
	if (copy !== head) head.append(copy);
	section.append(head);
	return section;
}

export interface ReaderSettingsFooter {
	readonly root: HTMLElement;
	readonly status: HTMLElement;
	readonly reset: HTMLButtonElement;
}

export function settingsFooter(
	document: Document,
	resetLabel: string,
	options: Readonly<{
		readonly rootClass?: string;
		readonly statusClass?: string;
		readonly resetClass?: string;
	}> = {},
): ReaderSettingsFooter {
	const root = settingsElement(
		document,
		'div',
		`ldp-settings-form-footer ${options.rootClass ?? ''}`.trim(),
	);
	const status = settingsElement(
		document,
		'span',
		options.statusClass ?? 'ldp-flash-status',
	);
	status.role = 'status';
	status.setAttribute('aria-live', 'polite');
	const reset = settingsButton(
		document,
		`ldp-settings-form-reset ${options.resetClass ?? ''}`.trim(),
		'',
		'rotate-ccw',
		resetLabel,
	);
	root.append(status, reset);
	return Object.freeze({ root, status, reset });
}
import { createReaderIcon } from '../components/reader-icon.js';
