export type ReaderObjectDraftEquality<TValue> = (
	left: TValue,
	right: TValue,
) => boolean;

/**
 * 设置领域共享的浅层对象草稿。
 *
 * 它只拥有 baseline、当前值和逐字段 rebase；不做领域校验、不创建 DOM、不写偏好，
 * 因而外观、字体等对象 form 可以复用同一套“外部更新不覆盖本地脏字段”语义。
 */
export class ReaderObjectSettingsDraft<
	TValue extends object,
	TName extends keyof TValue,
> {
	readonly #names: readonly TName[];
	readonly #equals: ReaderObjectDraftEquality<TValue[TName]>;
	#baseline: Readonly<TValue>;
	#value: Readonly<TValue>;

	constructor(
		names: readonly TName[],
		baseline: Readonly<TValue>,
		equals: ReaderObjectDraftEquality<TValue[TName]> = Object.is,
	) {
		this.#names = Object.freeze([...new Set(names)]);
		this.#equals = equals;
		this.#baseline = Object.freeze({ ...baseline });
		this.#value = Object.freeze({ ...baseline });
	}

	read(): Readonly<TValue> {
		return this.#value;
	}

	baseline(): Readonly<TValue> {
		return this.#baseline;
	}

	set<TCurrentName extends TName>(
		name: TCurrentName,
		value: TValue[TCurrentName],
	): boolean {
		if (this.#equals(
			this.#value[name] as TValue[TName],
			value as TValue[TName],
		)) return false;
		this.#value = Object.freeze({ ...this.#value, [name]: value });
		return true;
	}

	setValues(values: Partial<Pick<TValue, TName>>): boolean {
		let changed = false;
		const next: TValue = { ...this.#value };
		for (const name of this.#names) {
			if (!Object.hasOwn(values, name)) continue;
			const value = values[name] as TValue[TName];
			if (this.#equals(next[name], value)) continue;
			next[name] = value;
			changed = true;
		}
		if (changed) this.#value = Object.freeze(next);
		return changed;
	}

	dirtyNames(): readonly TName[] {
		return Object.freeze(this.#names.filter((name) =>
			!this.#equals(this.#value[name], this.#baseline[name]),
		));
	}

	changeCount(): number {
		return this.dirtyNames().length;
	}

	rebase(external: Readonly<TValue>): boolean {
		const dirty = new Set(this.dirtyNames());
		const next: TValue = { ...this.#value };
		let changed = false;
		for (const name of this.#names) {
			if (dirty.has(name)) {
				if (this.#equals(next[name], external[name])) changed = true;
				continue;
			}
			if (this.#equals(next[name], external[name])) continue;
			next[name] = external[name];
			changed = true;
		}
		this.#baseline = Object.freeze({ ...external });
		if (changed) this.#value = Object.freeze(next);
		return changed;
	}

	accept(persisted: Readonly<TValue>): void {
		this.#baseline = Object.freeze({ ...persisted });
		this.#value = Object.freeze({ ...persisted });
	}
}
