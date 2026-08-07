export interface ReaderNumericSettingDefinition<TName extends string> {
	readonly name: TName;
	readonly label: string;
	readonly min: number;
	readonly max: number;
	readonly integer?: boolean;
	readonly decimals?: number;
}

function formatNumber<TName extends string>(
	definition: ReaderNumericSettingDefinition<TName>,
	value: number,
): string {
	if (definition.integer) return String(Math.round(value));
	const decimals = Math.max(0, Math.floor(definition.decimals ?? 2));
	return String(Number(value.toFixed(decimals)));
}

/**
 * 数值设置的共享草稿模型。
 *
 * 它只拥有 raw/baseline、范围校验、语义变更计数和外部 rebase；不创建 DOM、不写偏好、
 * 不执行 preview。领域 form 负责字段编排和副作用端口。
 */
export class ReaderNumericSettingsDraft<TName extends string> {
	readonly #definitions: readonly ReaderNumericSettingDefinition<TName>[];
	readonly #definitionByName = new Map<
		TName,
		ReaderNumericSettingDefinition<TName>
	>();
	readonly #baseline = new Map<TName, number>();
	readonly #raw = new Map<TName, string>();

	constructor(
		definitions: readonly ReaderNumericSettingDefinition<TName>[],
		baseline: Readonly<Record<TName, number>>,
	) {
		if (!definitions.length) {
			throw new Error('数值设置定义不能为空');
		}
		this.#definitions = Object.freeze([...definitions]);
		for (const definition of this.#definitions) {
			if (this.#definitionByName.has(definition.name)) {
				throw new Error(`重复数值设置字段：${definition.name}`);
			}
			if (
				!Number.isFinite(definition.min) ||
				!Number.isFinite(definition.max) ||
				definition.min > definition.max
			) {
				throw new RangeError(`${definition.name} 的范围无效`);
			}
			this.#definitionByName.set(definition.name, definition);
		}
		this.accept(baseline);
	}

	get names(): readonly TName[] {
		return this.#definitions.map((definition) => definition.name);
	}

	rawValue(name: TName): string {
		this.#assertName(name);
		return this.#raw.get(name)!;
	}

	baselineValue(name: TName): number {
		this.#assertName(name);
		return this.#baseline.get(name)!;
	}

	setRaw(name: TName, value: unknown): void {
		this.#assertName(name);
		this.#raw.set(name, String(value ?? ''));
	}

	setValues(values: Readonly<Record<TName, number>>): void {
		for (const definition of this.#definitions) {
			this.#raw.set(
				definition.name,
				formatNumber(definition, values[definition.name]),
			);
		}
	}

	accept(values: Readonly<Record<TName, number>>): void {
		for (const definition of this.#definitions) {
			const value = Number(values[definition.name]);
			if (!Number.isFinite(value)) {
				throw new TypeError(`${definition.name} baseline 必须是有限数值`);
			}
			this.#baseline.set(definition.name, value);
			this.#raw.set(
				definition.name,
				formatNumber(definition, value),
			);
		}
	}

	rebase(
		values: Readonly<Record<TName, number>>,
		preserveChanged = true,
	): void {
		const changed = new Set(
			preserveChanged
				? this.#definitions
					.filter((definition) => this.#changed(definition.name))
					.map((definition) => definition.name)
				: [],
		);
		for (const definition of this.#definitions) {
			const value = Number(values[definition.name]);
			if (!Number.isFinite(value)) {
				throw new TypeError(`${definition.name} baseline 必须是有限数值`);
			}
			this.#baseline.set(definition.name, value);
			if (!changed.has(definition.name)) {
				this.#raw.set(
					definition.name,
					formatNumber(definition, value),
				);
			}
		}
	}

	read(): Readonly<Record<TName, number>> | null {
		if (this.issues().length > 0) return null;
		return Object.freeze(Object.fromEntries(
			this.#definitions.map((definition) => [
				definition.name,
				Number(this.#raw.get(definition.name)),
			]),
		)) as Readonly<Record<TName, number>>;
	}

	issues(): readonly string[] {
		const issues: string[] = [];
		for (const definition of this.#definitions) {
			const raw = this.#raw.get(definition.name) ?? '';
			const numeric = Number(raw);
			if (!raw.trim() || !Number.isFinite(numeric)) {
				issues.push(`${definition.label}必须填写有效数字`);
			} else if (
				numeric < definition.min ||
				numeric > definition.max
			) {
				issues.push(
					`${definition.label}必须在 ${definition.min}–${definition.max} 之间`,
				);
			} else if (
				definition.integer &&
				!Number.isInteger(numeric)
			) {
				issues.push(`${definition.label}必须是整数`);
			}
		}
		return Object.freeze(issues);
	}

	changeCount(): number {
		return this.#definitions.reduce(
			(total, definition) =>
				total + (this.#changed(definition.name) ? 1 : 0),
			0,
		);
	}

	#changed(name: TName): boolean {
		const raw = this.#raw.get(name) ?? '';
		const numeric = Number(raw);
		return (
			!raw.trim() ||
			!Number.isFinite(numeric) ||
			numeric !== this.#baseline.get(name)
		);
	}

	#assertName(name: TName): void {
		if (!this.#definitionByName.has(name)) {
			throw new RangeError(`未知数值设置字段：${name}`);
		}
	}
}
