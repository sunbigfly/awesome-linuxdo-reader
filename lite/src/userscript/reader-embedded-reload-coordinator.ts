import {
	discourseTopicId,
} from '../discourse/identifiers.js';
import {
	normalizeReaderHistoryAnchorState,
	type ReaderHistoryAnchorState,
} from '../history/reader-history-model.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import type { ReaderWorkspaceMode } from '../shell/reader-workspace.js';

// Keep the 1.0.0 key so embedded reload state survives the spelling migration.
const DEFAULT_STORAGE_KEY = 'ldp:mian-lite:embedded-reload:v1';
const DEFAULT_TTL_MS = 30_000;

type ReaderEmbeddedWorkspaceMode = Extract<
	ReaderWorkspaceMode,
	'embed-left' | 'embed-right'
>;

export interface ReaderEmbeddedReloadCapture {
	readonly mode: ReaderWorkspaceMode;
	readonly topicId: number;
	readonly anchor: ReaderHistoryAnchorState;
	readonly onlyOp: boolean;
}

export interface ReaderEmbeddedReloadState
	extends Omit<ReaderEmbeddedReloadCapture, 'mode'> {
	readonly mode: ReaderEmbeddedWorkspaceMode;
	readonly savedAt: number;
	readonly hostRoute: string;
}

export interface ReaderEmbeddedReloadCoordinatorOptions {
	readonly target: EventTarget;
	readonly storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
	readonly currentHostRoute: () => string;
	readonly navigationType: () => string | null;
	readonly capture: () => ReaderEmbeddedReloadCapture | null;
	readonly restore: (state: ReaderEmbeddedReloadState) => boolean | Promise<boolean>;
	readonly now?: () => number;
	readonly storageKey?: string;
	readonly ttlMs?: number;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (cause: unknown) => void;
}

function embeddedMode(value: unknown): ReaderEmbeddedWorkspaceMode | null {
	return value === 'embed-left' || value === 'embed-right' ? value : null;
}

function stateRecord(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}

/**
 * 嵌入 Reader 跨 reload 状态的唯一生命周期 owner。
 *
 * 本协调器只在 pagehide 保存一个短期事务，并在真实 reload 时消费；Topic 打开、Only-OP
 * 与锚点恢复仍由调用方注入的 canonical runtime 端口完成，不复制导航或缓存实现。
 */
export class ReaderEmbeddedReloadCoordinator {
	readonly scope: LifecycleScope;
	readonly #options: ReaderEmbeddedReloadCoordinatorOptions;
	readonly #storageKey: string;
	readonly #ttlMs: number;
	readonly #now: () => number;
	#restorePromise: Promise<boolean> | null = null;

	constructor(options: ReaderEmbeddedReloadCoordinatorOptions) {
		this.#options = options;
		this.#storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
		this.#ttlMs = Math.max(0, options.ttlMs ?? DEFAULT_TTL_MS);
		this.#now = options.now ?? Date.now;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.scope.listen(options.target, 'pagehide', () => {
			this.save();
		});
	}

	save(): boolean {
		if (this.scope.destroyed) return false;
		let capture: ReaderEmbeddedReloadCapture | null;
		try {
			capture = this.#options.capture();
		} catch (cause) {
			this.#report(cause);
			return false;
		}
		const mode = embeddedMode(capture?.mode);
		if (!capture || !mode) return false;
		const anchor = normalizeReaderHistoryAnchorState(capture.anchor);
		if (!anchor) return false;
		let topicId: number;
		try {
			topicId = Number(discourseTopicId(capture.topicId));
		} catch {
			return false;
		}
		try {
			const state: ReaderEmbeddedReloadState = Object.freeze({
				savedAt: this.#now(),
				hostRoute: String(this.#options.currentHostRoute()),
				mode,
				topicId,
				anchor,
				onlyOp: capture.onlyOp === true,
			});
			this.#options.storage.setItem(
				this.#storageKey,
				JSON.stringify(state),
			);
			return true;
		} catch (cause) {
			this.#report(cause);
			return false;
		}
	}

	restore(): Promise<boolean> {
		if (this.#restorePromise) return this.#restorePromise;
		const transaction = this.#restore();
		this.#restorePromise = transaction;
		void transaction.finally(() => {
			if (this.#restorePromise === transaction) this.#restorePromise = null;
		});
		return transaction;
	}

	destroy(): void {
		this.scope.destroy();
	}

	async #restore(): Promise<boolean> {
		if (this.scope.destroyed) return false;
		const state = this.#consume();
		if (!state) return false;
		try {
			return await this.#options.restore(state);
		} catch (cause) {
			this.#report(cause);
			return false;
		}
	}

	#consume(): ReaderEmbeddedReloadState | null {
		let raw: string | null = null;
		try {
			raw = this.#options.storage.getItem(this.#storageKey);
			this.#options.storage.removeItem(this.#storageKey);
		} catch (cause) {
			this.#report(cause);
			return null;
		}
		if (!raw || this.#options.navigationType() !== 'reload') return null;
		let source: Readonly<Record<string, unknown>> | null;
		try {
			source = stateRecord(JSON.parse(raw));
		} catch {
			return null;
		}
		const savedAt = Number(source?.savedAt);
		const mode = embeddedMode(source?.mode);
		const anchor = normalizeReaderHistoryAnchorState(source?.anchor);
		if (
			!source ||
			!Number.isFinite(savedAt) ||
			this.#now() - savedAt < 0 ||
			this.#now() - savedAt > this.#ttlMs ||
			String(source.hostRoute ?? '') !==
				String(this.#options.currentHostRoute()) ||
			!mode ||
			!anchor
		) return null;
		let topicId: number;
		try {
			topicId = Number(discourseTopicId(source.topicId));
		} catch {
			return null;
		}
		return Object.freeze({
			savedAt,
			hostRoute: String(source.hostRoute),
			mode,
			topicId,
			anchor,
			onlyOp: source.onlyOp === true,
		});
	}

	#report(cause: unknown): void {
		try {
			this.#options.onError?.(cause);
		} catch {
			// 诊断 consumer 失败不能破坏 pagehide 或恢复事务。
		}
	}
}
