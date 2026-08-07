import type { ReaderPreferences } from '../state/reader-preferences-schema.js';
import {
	BOOST_COPY_MAX_LENGTH,
	normalizeBoostCopySettings,
	type BoostCopySettings,
} from '../state/reader-boost-copy-settings.js';
export {
	BOOST_COPY_MAX_LENGTH,
	DEFAULT_BOOST_COPY_SETTINGS,
	normalizeBoostCopySettings,
	type BoostCopyMode,
	type BoostCopySettings,
} from '../state/reader-boost-copy-settings.js';

export interface BoostCopyPreferencesAdapter<TPreferences extends object> {
	read(preferences: Readonly<TPreferences>): BoostCopySettings;
	createPatch(settings: BoostCopySettings): Partial<TPreferences>;
}

export const readerPreferencesBoostCopyAdapter = Object.freeze<
	BoostCopyPreferencesAdapter<ReaderPreferences>
>({
	read: (preferences) => normalizeBoostCopySettings({
		mode: preferences.boostCopyMode,
		prefix: preferences.boostCopyPrefix,
		counterMarker: preferences.boostCopyCounterMarker,
		counterStep: preferences.boostCopyCounterStep,
		fixedSuffix: preferences.boostCopyFixedSuffix,
	}),
	createPatch: (settings) => {
		const normalized = normalizeBoostCopySettings(settings);
		return Object.freeze({
			boostCopyMode: normalized.mode,
			boostCopyPrefix: normalized.prefix,
			boostCopyCounterMarker: normalized.counterMarker,
			boostCopyCounterStep: normalized.counterStep,
			boostCopyFixedSuffix: normalized.fixedSuffix,
		});
	},
});

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fitParts(prefix: string, base: string, suffix: string): string {
	const suffixChars = [...suffix].slice(0, BOOST_COPY_MAX_LENGTH);
	const prefixChars = [...prefix].slice(
		0,
		BOOST_COPY_MAX_LENGTH - suffixChars.length,
	);
	const baseChars = [...base].slice(
		0,
		BOOST_COPY_MAX_LENGTH - suffixChars.length - prefixChars.length,
	);
	return `${prefixChars.join('')}${baseChars.join('')}${suffixChars.join('')}`;
}

/**
 * Boost 气泡复制文本的唯一纯规则。
 *
 * 输入只接受气泡正文纯文本；不读 DOM、不写剪贴板、不维护计数器。递增数字从传入文本
 * 的既有尾巴推导，因此离屏回屏、重复挂载和不同 PostView 不会产生第二份状态。
 */
export function applyBoostCopyRule(
	raw: unknown,
	settings: BoostCopySettings,
): string {
	const config = normalizeBoostCopySettings(settings);
	let base = String(raw ?? '').replace(/\s+/g, ' ').trim();
	if (config.prefix && base.startsWith(config.prefix)) {
		base = base.slice(config.prefix.length);
	}
	let suffix = config.fixedSuffix;
	if (config.mode === 'counter') {
		const pattern = new RegExp(
			`^(.*)${escapeRegExp(config.counterMarker)}(\\d+)$`,
		);
		const match = base.match(pattern);
		const current = match ? Number(match[2]) : 0;
		const next = Number.isSafeInteger(current)
			? current + config.counterStep
			: config.counterStep;
		if (match) base = match[1] ?? '';
		suffix = `${config.counterMarker}${next}`;
	} else if (suffix && base.endsWith(suffix)) {
		base = base.slice(0, -suffix.length);
	}
	return fitParts(config.prefix, base, suffix);
}
