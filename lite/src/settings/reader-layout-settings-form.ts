import { LifecycleScope } from '../kernel/lifecycle.js';
import {
	type ReaderLayoutMode,
	type ReaderLayoutStyleController,
} from '../layout/reader-layout-style-controller.js';
import {
	READER_FULLPAGE_LAYOUT_DEFAULT,
	READER_LAYOUT_DEFAULT,
	READER_LAYOUT_MINIMUM_RATIOS,
	READER_LAYOUT_REGIONS,
	readerLayoutProfileTotal,
	readerLayoutRegionMaximum,
	rebalanceReaderLayoutProfile,
	type ReaderLayoutProfile,
	type ReaderLayoutRegion,
} from '../state/reader-preferences-schema.js';
import type {
	ReaderSettingsController,
	ReaderSettingsDraftAdapter,
} from './reader-settings-controller.js';
import {
	settingsElement as element,
	settingsFooter,
} from './reader-settings-dom.js';
import {
	ReaderNumericSettingsDraft,
} from './reader-numeric-settings-draft.js';

export interface ReaderLayoutSettingsFormOptions<
	TPreferences extends object,
> {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly controller: ReaderSettingsController<TPreferences>;
	readonly layout: ReaderLayoutStyleController<TPreferences>;
	readonly parentScope?: LifecycleScope;
}

const labels = Object.freeze<Record<ReaderLayoutRegion, string>>({
	left: '左侧留白',
	main: '正文区域',
	gap: '正文与时间轴间距',
	timeline: '楼层时间轴',
	right: '右侧留白',
});
const modes = Object.freeze<readonly ReaderLayoutMode[]>([
	'standard',
	'fullpage',
]);
const numericDefinitions = Object.freeze(
	READER_LAYOUT_REGIONS.map((name) => Object.freeze({
		name,
		label: labels[name],
		min: READER_LAYOUT_MINIMUM_RATIOS[name],
		max: readerLayoutRegionMaximum(name),
		decimals: 2,
	})),
);

function modeLabel(mode: ReaderLayoutMode): string {
	return mode === 'fullpage' ? '全屏' : '普通（嵌入/浮窗）';
}

function modeDefault(mode: ReaderLayoutMode): ReaderLayoutProfile {
	return mode === 'fullpage'
		? READER_FULLPAGE_LAYOUT_DEFAULT
		: READER_LAYOUT_DEFAULT;
}

/**
 * 普通/全屏五区布局草稿和实时预览的唯一 form owner。
 *
 * 两种形态各保留一份 draft；当前形态变化只切换投影，不丢另一形态未保存内容。CSS 变量只
 * 交给 ReaderLayoutStyleController，form 不直接操作 Shell 样式。
 */
export class ReaderLayoutSettingsForm<TPreferences extends object> {
	readonly scope: LifecycleScope;
	readonly #controller: ReaderSettingsController<TPreferences>;
	readonly #layout: ReaderLayoutStyleController<TPreferences>;
	readonly #host: HTMLElement;
	readonly #drafts = new Map<
		ReaderLayoutMode,
		ReaderNumericSettingsDraft<ReaderLayoutRegion>
	>();
	readonly #inputs = new Map<ReaderLayoutRegion, HTMLInputElement>();
	readonly #values = new Map<ReaderLayoutRegion, HTMLElement>();
	readonly #status: HTMLElement;
	readonly #reset: HTMLButtonElement;
	#mode: ReaderLayoutMode;
	#syncingLayout = false;

	constructor(options: ReaderLayoutSettingsFormOptions<TPreferences>) {
		this.#controller = options.controller;
		this.#layout = options.layout;
		this.#host = options.host;
		this.#mode = this.#layout.mode;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		for (const mode of modes) {
			this.#drafts.set(
				mode,
				new ReaderNumericSettingsDraft(
					numericDefinitions,
					this.#layout.profile(mode),
				),
			);
		}

		const groups = element(
			options.document,
			'div',
			'ldp-settings-category-groups',
		);
		const group = element(
			options.document,
			'section',
			'ldp-settings-category-group',
		);
		const content = element(
			options.document,
			'div',
			'ldp-settings-category-content',
		);
		const fields = element(
			options.document,
			'div',
			'ldp-settings-fields ldp-layout-fields',
		);
		for (const region of READER_LAYOUT_REGIONS) {
			const row = element(
				options.document,
				'div',
				'ldp-setting-row',
			);
			const label = element(
				options.document,
				'span',
				'ldp-setting-label',
			);
			label.textContent = labels[region];
			const control = element(
				options.document,
				'span',
				'ldp-layout-ratio-control',
			);
			const input = element(options.document, 'input');
			input.type = 'range';
			input.dataset.layoutRegion = region;
			input.min = String(READER_LAYOUT_MINIMUM_RATIOS[region]);
			input.max = String(readerLayoutRegionMaximum(region));
			input.step = '0.1';
			input.setAttribute('aria-valuemin', input.min);
			input.setAttribute('aria-label', `${labels[region]}比例`);
			const value = element(
				options.document,
				'span',
				'ldp-layout-ratio-value',
			);
			value.dataset.layoutValue = region;
			control.append(input, value);
			row.append(label, control);
			fields.append(row);
			this.#inputs.set(region, input);
			this.#values.set(region, value);
			this.scope.listen(input, 'input', () => {
				this.#edit(region, input.value);
			});
		}
		content.append(fields);
		group.append(content);
		groups.append(group);

		const footer = settingsFooter(
			options.document,
			'恢复默认',
			{
				rootClass: 'ldp-layout-footer',
				statusClass: 'ldp-layout-total',
				resetClass: 'ldp-layout-reset',
			},
		);
		this.#status = footer.status;
		this.#reset = footer.reset;
		this.scope.listen(this.#reset, 'click', () => {
			const profile = modeDefault(this.#mode);
			this.#draft().setValues(profile);
			this.#preview(profile, this.#mode);
			this.#sync();
			this.#controller.refresh();
		});
		this.#host.replaceChildren(groups, footer.root);

		const adapter: ReaderSettingsDraftAdapter<TPreferences> = {
			panelId: 'layout',
			changeCount: () => this.#changeCount(),
			validate: () => this.#validate(),
			createPatch: () => {
				const patch: Partial<TPreferences> = {};
				for (const mode of modes) {
					const draft = this.#drafts.get(mode)!;
					if (draft.changeCount() === 0) continue;
					Object.assign(
						patch,
						this.#layout.createPatch(
							draft.read() as ReaderLayoutProfile,
							mode,
						),
					);
				}
				return patch;
			},
			acceptPersisted: (preferences) => {
				this.#accept(preferences);
			},
			discard: (preferences) => {
				this.#accept(preferences);
			},
		};
		this.scope.add(this.#controller.registerDraft(adapter));
		this.#layout.changes.subscribe((snapshot) => {
			if (this.#syncingLayout) return;
			for (const mode of modes) {
				this.#drafts.get(mode)!.rebase(this.#layout.profile(mode));
			}
			this.#mode = snapshot.mode;
			this.#reconcilePreviews();
			this.#sync();
			this.#controller.refresh();
		}, this.scope);
		this.scope.add(() => {
			this.#updateLayout(() => this.#layout.clearPreview());
			this.#inputs.clear();
			this.#values.clear();
			this.#host.replaceChildren();
		});
		this.#sync();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#edit(region: ReaderLayoutRegion, raw: string): void {
		const current = this.#draft().read() as ReaderLayoutProfile;
		const desired = Number(raw);
		const safe = Number.isFinite(desired)
			? Math.min(
				readerLayoutRegionMaximum(region),
				Math.max(READER_LAYOUT_MINIMUM_RATIOS[region], desired),
			)
			: current[region];
		const next = rebalanceReaderLayoutProfile(
			Object.freeze({ ...current, [region]: safe }),
			region,
		);
		this.#draft().setValues(next);
		this.#preview(next, this.#mode);
		this.#sync();
		this.#controller.refresh();
	}

	#accept(preferences: Readonly<TPreferences>): void {
		for (const mode of modes) {
			this.#drafts.get(mode)!.accept(
				this.#layout.readProfile(preferences, mode),
			);
		}
		this.#updateLayout(() => this.#layout.clearPreview());
		this.#sync();
	}

	#preview(
		profile: ReaderLayoutProfile,
		mode: ReaderLayoutMode,
	): void {
		this.#updateLayout(() => this.#layout.preview(profile, mode));
	}

	#reconcilePreviews(): void {
		this.#updateLayout(() => {
			for (const mode of modes) {
				const draft = this.#drafts.get(mode)!;
				const profile = draft.read() as ReaderLayoutProfile | null;
				if (draft.changeCount() > 0 && profile) {
					this.#layout.preview(profile, mode);
				} else {
					this.#layout.clearPreview(mode);
				}
			}
		});
	}

	#updateLayout(update: () => void): void {
		this.#syncingLayout = true;
		try {
			update();
		} finally {
			this.#syncingLayout = false;
		}
	}

	#draft(): ReaderNumericSettingsDraft<ReaderLayoutRegion> {
		return this.#drafts.get(this.#mode)!;
	}

	#changeCount(): number {
		return modes.reduce(
			(total, mode) =>
				total + this.#drafts.get(mode)!.changeCount(),
			0,
		);
	}

	#validate(): readonly string[] {
		const issues = modes.flatMap((mode) => {
			const draft = this.#drafts.get(mode)!;
			const own = [...draft.issues()];
			const profile = draft.read() as ReaderLayoutProfile | null;
			if (profile && readerLayoutProfileTotal(profile) !== 100) {
				own.push(`${modeLabel(mode)}五区比例合计必须为 100%`);
			}
			return own;
		});
		return Object.freeze(issues);
	}

	#sync(): void {
		const draft = this.#draft();
		const profile = draft.read() as ReaderLayoutProfile;
		for (const region of READER_LAYOUT_REGIONS) {
			const raw = draft.rawValue(region);
			const input = this.#inputs.get(region)!;
			input.value = raw;
			input.setAttribute('aria-valuenow', raw);
			this.#values.get(region)!.textContent =
				`${Number(Number(raw).toFixed(1))}%`;
		}
		const changed = this.#changeCount();
		const currentChanged = draft.changeCount() > 0;
		const total = readerLayoutProfileTotal(profile);
		this.#status.classList.toggle('warning', total !== 100);
		this.#status.classList.toggle('balanced', total === 100 && !changed);
		this.#status.textContent = total !== 100
			? `${modeLabel(this.#mode)}五区当前合计 ${total}%，必须为 100% 才能保存。`
			: currentChanged
				? `${modeLabel(this.#mode)}正在实时预览；另一个形态的草稿也会统一保存。`
				: changed > 0
					? `${modeLabel(this.#mode)}当前未改；另一个形态有 ${changed} 项待保存。`
					: `${modeLabel(this.#mode)}当前配置已应用。`;
		const defaults = modeDefault(this.#mode);
		this.#reset.disabled = READER_LAYOUT_REGIONS.every(
			(region) => profile[region] === defaults[region],
		);
	}
}
