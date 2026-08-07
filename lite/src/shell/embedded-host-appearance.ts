import { LifecycleScope } from '../kernel/lifecycle.js';
import type { Signal } from '../kernel/signal.js';
import type { ReaderAppearanceProfile } from '../state/reader-preferences-schema.js';
import {
	READER_HOST_MIN_WIDTH,
	type ReaderWorkspaceModel,
} from './reader-workspace.js';

export interface EmbeddedHostResolvedAppearance {
	readonly profile: ReaderAppearanceProfile;
	readonly theme: 'light' | 'dark';
	readonly defaultDividerLineColor: string;
	readonly defaultDividerLineWidth: number;
}

export interface EmbeddedHostAppearanceControllerOptions {
	readonly workspace: ReaderWorkspaceModel;
	readonly pageRoot: HTMLElement;
	readonly overlay: HTMLElement;
	readonly readAppearance: () => EmbeddedHostResolvedAppearance;
	readonly appearanceChanges?: Signal<EmbeddedHostResolvedAppearance>;
	readonly measureRowHeight?: () => number;
	readonly hostMinWidth?: number;
	readonly parentScope?: LifecycleScope;
}

const STYLE_PROPERTIES = Object.freeze([
	'--ldp-reader-host-min-width',
	'--ldp-reader-native-row-height',
]);
const ROOT_STYLE_PROPERTIES = Object.freeze([
	'--ldp-reader-list-zebra-color',
	'--ldp-divider-line-color',
	'--ldp-divider-line-width',
]);

export function measureEmbeddedHostTopicRowHeight(
	documentPort: Document,
	overlay: Element,
): number {
	const heights = [...documentPort.querySelectorAll(
		'tr.topic-list-item,.topic-list-item,.latest-topic-list-item',
	)]
		.filter((node) => !node.closest('.ldp-overlay') && !overlay.contains(node))
		.map((node) => {
			const rect = node.getBoundingClientRect();
			return rect.width > 0 && rect.height >= 48 && rect.height <= 320
				? Math.round(rect.height)
				: 0;
		})
		.filter((height) => height > 0)
		.sort((left, right) => left - right);
	return heights.length ? heights[Math.floor((heights.length - 1) / 2)]! : 0;
}

/**
 * resolved appearance 到 embedded 宿主 page root/overlay 的唯一 DOM 投影。
 */
export class EmbeddedHostAppearanceController {
	readonly scope: LifecycleScope;
	readonly #workspace: ReaderWorkspaceModel;
	readonly #pageRoot: HTMLElement;
	readonly #overlay: HTMLElement;
	readonly #readAppearance: () => EmbeddedHostResolvedAppearance;
	readonly #measureRowHeight: () => number;
	readonly #hostMinWidth: number;
	#active = false;
	#rowHeight = 0;
	#destroyed = false;

	constructor(options: EmbeddedHostAppearanceControllerOptions) {
		this.#workspace = options.workspace;
		this.#pageRoot = options.pageRoot;
		this.#overlay = options.overlay;
		this.#readAppearance = options.readAppearance;
		this.#measureRowHeight = options.measureRowHeight ??
			(() => measureEmbeddedHostTopicRowHeight(
				this.#pageRoot.ownerDocument,
				this.#overlay,
			));
		this.#hostMinWidth = Math.max(
			1,
			Math.round(options.hostMinWidth ?? READER_HOST_MIN_WIDTH),
		);
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#workspace.changes.subscribe(() => this.#syncActivation(), this.scope);
		options.appearanceChanges?.subscribe(() => {
			if (this.#active) this.#applyAppearance();
		}, this.scope);
		this.scope.add(() => this.#clear());
		this.#syncActivation();
	}

	destroy(): void {
		if (this.#destroyed) return;
		this.#destroyed = true;
		this.scope.destroy();
	}

	#syncActivation(): void {
		if (this.#destroyed) return;
		const active = this.#workspace.snapshot.presentation.embedded;
		if (active && !this.#active) {
			this.#active = true;
			this.#rowHeight = Math.max(0, Math.round(this.#measureRowHeight()));
			this.#applyAppearance();
		} else if (!active && this.#active) {
			this.#active = false;
			this.#clear();
		}
	}

	#applyAppearance(): void {
		const appearance = this.#readAppearance();
		const profile = appearance.profile;
		const dark = appearance.theme === 'dark';
		const zebraColor = dark ? profile.listZebraColorDark : profile.listZebraColor;
		const dividerColor = dark ? profile.dividerLineColorDark : profile.dividerLineColor;
		for (const target of [this.#pageRoot, this.#overlay]) {
			target.style.setProperty(
				'--ldp-reader-host-min-width',
				`${this.#hostMinWidth}px`,
			);
			if (this.#rowHeight) {
				target.style.setProperty(
					'--ldp-reader-native-row-height',
					`${this.#rowHeight}px`,
				);
			} else {
				target.style.removeProperty('--ldp-reader-native-row-height');
			}
		}
		this.#pageRoot.style.setProperty('--ldp-reader-list-zebra-color', zebraColor);
		this.#pageRoot.classList.toggle(
			'ldp-structure-colors-disabled',
			!profile.structureColorsEnabled,
		);
		if (
			!profile.structureColorsEnabled ||
			dividerColor === appearance.defaultDividerLineColor
		) {
			this.#pageRoot.style.removeProperty('--ldp-divider-line-color');
		} else {
			this.#pageRoot.style.setProperty('--ldp-divider-line-color', dividerColor);
		}
		if (profile.dividerLineWidth === appearance.defaultDividerLineWidth) {
			this.#pageRoot.style.removeProperty('--ldp-divider-line-width');
		} else {
			this.#pageRoot.style.setProperty(
				'--ldp-divider-line-width',
				`${profile.dividerLineWidth}px`,
			);
		}
	}

	#clear(): void {
		for (const target of [this.#pageRoot, this.#overlay]) {
			for (const property of STYLE_PROPERTIES) target.style.removeProperty(property);
		}
		for (const property of ROOT_STYLE_PROPERTIES) {
			this.#pageRoot.style.removeProperty(property);
		}
		this.#pageRoot.classList.remove('ldp-structure-colors-disabled');
		this.#rowHeight = 0;
	}
}
