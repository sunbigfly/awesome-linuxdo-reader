export const READER_TRANSLATION_THEMES = Object.freeze([
	'quote',
	'plain',
	'weakening',
	'dividing-line',
	'underline',
	'highlight',
	'paper',
] as const);

export type ReaderTranslationTheme =
	(typeof READER_TRANSLATION_THEMES)[number];

export const DEFAULT_READER_TRANSLATION_THEME: ReaderTranslationTheme = 'quote';

export function normalizeReaderTranslationTheme(
	value: unknown,
): ReaderTranslationTheme {
	const theme = String(value ?? '');
	return READER_TRANSLATION_THEMES.includes(
		theme as ReaderTranslationTheme,
	)
		? theme as ReaderTranslationTheme
		: DEFAULT_READER_TRANSLATION_THEME;
}
