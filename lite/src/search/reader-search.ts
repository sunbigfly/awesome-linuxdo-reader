export type ReaderSearchFormsPort = (
	value: string,
) => readonly string[];

export function normalizeReaderSearchText(value: unknown): string {
	return String(value ?? '')
		.toLocaleLowerCase()
		.replace(/\s+/g, '')
		.trim();
}

export function readerSearchMatches(
	value: string,
	queryValue: unknown,
	searchForms: ReaderSearchFormsPort,
	onError: (cause: unknown) => void = () => {},
): boolean {
	const query = normalizeReaderSearchText(queryValue);
	if (!query) return true;
	let forms: readonly string[];
	try {
		forms = searchForms(value);
	} catch (cause) {
		onError(cause);
		forms = Object.freeze([value]);
	}
	return forms.some((form) =>
		normalizeReaderSearchText(form).includes(query));
}
