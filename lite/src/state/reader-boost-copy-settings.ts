export const BOOST_COPY_MAX_LENGTH = 16;

export type BoostCopyMode = 'counter' | 'text';

export interface BoostCopySettings {
	readonly mode: BoostCopyMode;
	readonly prefix: string;
	readonly counterMarker: string;
	readonly counterStep: number;
	readonly fixedSuffix: string;
}

export const DEFAULT_BOOST_COPY_SETTINGS =
	Object.freeze<BoostCopySettings>({
		mode: 'counter',
		prefix: '',
		counterMarker: '+',
		counterStep: 1,
		fixedSuffix: '',
	});

function boundedText(value: unknown, fallback = ''): string {
	const normalized = String(value == null ? fallback : value)
		.replace(/\s+/g, ' ');
	return [...normalized].slice(0, BOOST_COPY_MAX_LENGTH).join('');
}

export function normalizeBoostCopySettings(
	input: Partial<BoostCopySettings> | null | undefined,
): BoostCopySettings {
	const source = input ?? {};
	const markerInput = boundedText(
		source.counterMarker,
		DEFAULT_BOOST_COPY_SETTINGS.counterMarker,
	).trim();
	const marker = markerInput && !/\d$/.test(markerInput)
		? markerInput
		: DEFAULT_BOOST_COPY_SETTINGS.counterMarker;
	const step = Number(source.counterStep);
	return Object.freeze({
		mode: source.mode === 'text' ? 'text' : 'counter',
		prefix: boundedText(source.prefix),
		counterMarker: marker,
		counterStep: Number.isFinite(step)
			? Math.min(99, Math.max(1, Math.round(step)))
			: DEFAULT_BOOST_COPY_SETTINGS.counterStep,
		fixedSuffix: boundedText(source.fixedSuffix),
	});
}
