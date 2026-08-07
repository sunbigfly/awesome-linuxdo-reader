import { LifecycleScope } from '../kernel/lifecycle.js';
import { Signal } from '../kernel/signal.js';
import type {
	ReaderLightboxController,
	ReaderLightboxItem,
} from './reader-lightbox-controller.js';

export interface ReaderLightboxBatchSnapshot {
	readonly open: boolean;
	readonly scope: 'loaded' | 'all';
	readonly items: readonly ReaderLightboxItem[];
	readonly selectedKeys: ReadonlySet<string>;
	readonly selectedItems: readonly ReaderLightboxItem[];
	readonly allSelected: boolean;
	readonly busy: boolean;
	readonly loadingAll: boolean;
	readonly canLoadAll: boolean;
	readonly allComplete: boolean;
	readonly completed: number;
	readonly total: number;
	readonly phase: 'idle' | 'fetching' | 'archiving' | 'saved';
	readonly status: string;
	readonly archiveName: string;
}

export interface ReaderLightboxBatchCatalogResult {
	readonly items: readonly ReaderLightboxItem[];
	readonly complete: boolean;
	readonly failedBatchCount?: number;
}

export interface ReaderLightboxBatchCatalogPort {
	readonly changes?: {
		subscribe(
			listener: (snapshot: ReaderLightboxBatchCatalogResult) => void,
			scope?: LifecycleScope,
		): () => void;
	};
	loadAll(): Promise<ReaderLightboxBatchCatalogResult>;
}

export interface ReaderLightboxBatchControllerOptions {
	readonly sequence: ReaderLightboxController;
	readonly archiveName: string;
	readonly imageCatalog?: ReaderLightboxBatchCatalogPort;
	readonly parentScope?: LifecycleScope;
	readonly onError?: (error: unknown) => void;
}

function archiveName(value: string): string {
	const normalized = String(value).trim().replace(/\.zip$/i, '');
	return normalized || '帖子图片';
}

/**
 * 批量选择/进度的唯一状态 owner。
 *
 * 图片仍引用 Lightbox sequence，不复制 Blob、Topic、post 或请求状态。
 */
export class ReaderLightboxBatchController {
	readonly scope: LifecycleScope;
	readonly changes = new Signal<ReaderLightboxBatchSnapshot>();
	readonly #sequence: ReaderLightboxController;
	readonly #onError: (error: unknown) => void;
	readonly #imageCatalog: ReaderLightboxBatchCatalogPort | null;
	readonly #selected = new Set<string>();
	readonly #loadedKeys = new Set<string>();
	#open = false;
	#busy = false;
	#loadingAll = false;
	#allComplete = false;
	#scope: ReaderLightboxBatchSnapshot['scope'] = 'loaded';
	#allLoadPromise: Promise<boolean> | null = null;
	#completed = 0;
	#total = 0;
	#phase: ReaderLightboxBatchSnapshot['phase'] = 'idle';
	#status = '请选择要打包的图片';
	#archiveName: string;

	constructor(options: ReaderLightboxBatchControllerOptions) {
		this.#sequence = options.sequence;
		this.#imageCatalog = options.imageCatalog ?? null;
		this.#archiveName = archiveName(options.archiveName);
		this.#onError = options.onError ?? (() => {});
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		this.#sequence.changes.subscribe(() => {
			const keys = new Set(this.#scopeItems().map((item) => item.key));
			let changed = false;
			for (const key of this.#selected) {
				if (keys.has(key)) continue;
				this.#selected.delete(key);
				changed = true;
			}
			if (this.#open || changed) this.#emit();
		}, this.scope);
		this.#imageCatalog?.changes?.subscribe((snapshot) => {
			const complete = snapshot.complete === true;
			if (complete === this.#allComplete) return;
			this.#allComplete = complete;
			if (this.#open) this.#emit();
		}, this.scope);
		this.scope.add(() => this.changes.clear());
	}

	snapshot(): ReaderLightboxBatchSnapshot {
		const items = this.#scopeItems();
		const selectedItems = items.filter((item) => this.#selected.has(item.key));
		return Object.freeze({
			open: this.#open,
			scope: this.#scope,
			items,
			selectedKeys: new Set(this.#selected),
			selectedItems: Object.freeze(selectedItems),
			allSelected: items.length > 0 && selectedItems.length === items.length,
			busy: this.#busy,
			loadingAll: this.#loadingAll,
			canLoadAll: this.#imageCatalog !== null,
			allComplete: this.#allComplete,
			completed: this.#completed,
			total: this.#total,
			phase: this.#phase,
			status: this.#status,
			archiveName: this.#archiveName,
		});
	}

	open(): void {
		this.#assertActive();
		if (this.#open) return;
		this.#open = true;
		this.#scope = 'loaded';
		this.#loadedKeys.clear();
		for (const item of this.#sequence.snapshot().items) {
			this.#loadedKeys.add(item.key);
		}
		this.#selected.clear();
		this.#resetProgress();
		this.#emit();
	}

	selectScope(scope: ReaderLightboxBatchSnapshot['scope']): Promise<boolean> {
		this.#assertActive();
		if (scope === 'loaded') {
			this.#scope = 'loaded';
			this.#selected.clear();
			this.#status = '请选择要打包的图片';
			this.#emit();
			return Promise.resolve(true);
		}
		if (!this.#imageCatalog) {
			this.#status = '完整楼层列表尚不可用';
			this.#emit();
			return Promise.resolve(false);
		}
		this.#scope = 'all';
		this.#selected.clear();
		if (this.#allComplete && this.#imageCatalog.changes) {
			this.#status = `已扫描全部帖子，共找到 ${this.#scopeItems().length} 张图片`;
			this.#emit();
			return Promise.resolve(true);
		}
		if (this.#allLoadPromise) {
			this.#emit();
			return this.#allLoadPromise;
		}
		this.#loadingAll = true;
		this.#status = '正在补齐全部楼层并建立图片索引…';
		this.#emit();
		const request = this.#imageCatalog.loadAll()
			.then((result) => {
				if (this.scope.destroyed) return false;
				this.#sequence.merge(result.items);
				this.#allComplete = result.complete;
				const failures = Math.max(
					0,
					Math.trunc(Number(result.failedBatchCount) || 0),
				);
				this.#status = result.complete
					? `已扫描全部帖子，共找到 ${this.#scopeItems().length} 张图片`
					: failures
						? `全帖扫描仍缺失 ${failures} 个请求批次，可重试`
						: '全帖楼层尚未完整，可重试';
				return result.complete;
			})
			.catch((error) => {
				if (this.scope.destroyed) return false;
				this.#status =
					`全帖扫描中断：${error instanceof Error ? error.message : '请重试'}`;
				this.#onError(error);
				return false;
			})
			.finally(() => {
				if (this.#allLoadPromise === request) this.#allLoadPromise = null;
				if (this.scope.destroyed) return;
				this.#loadingAll = false;
				this.#emit();
			});
		this.#allLoadPromise = request;
		return request;
	}

	close(): boolean {
		this.#assertActive();
		if (!this.#open || this.#busy) return false;
		this.#open = false;
		this.#selected.clear();
		this.#resetProgress();
		this.#emit();
		return true;
	}

	toggle(key: string): void {
		this.#assertMutable();
		const normalized = String(key).trim();
		if (!this.#scopeItems().some((item) => item.key === normalized)) {
			throw new Error(`批量图片 ${normalized || '(empty)'} 不在当前序列`);
		}
		if (this.#selected.has(normalized)) this.#selected.delete(normalized);
		else this.#selected.add(normalized);
		this.#emit();
	}

	toggleAll(): void {
		this.#assertMutable();
		const items = this.#scopeItems();
		const allSelected = items.length > 0 &&
			items.every((item) => this.#selected.has(item.key));
		this.#selected.clear();
		if (!allSelected) {
			for (const item of items) this.#selected.add(item.key);
		}
		this.#emit();
	}

	setArchiveName(value: string): void {
		this.#assertMutable();
		const next = archiveName(value);
		if (next === this.#archiveName) return;
		this.#archiveName = next;
		this.#emit();
	}

	begin(): ReaderLightboxBatchSnapshot {
		this.#assertMutable();
		const snapshot = this.snapshot();
		if (!snapshot.selectedItems.length) throw new Error('请先选择图片');
		this.#busy = true;
		this.#completed = 0;
		this.#total = snapshot.selectedItems.length;
		this.#phase = 'fetching';
		this.#status = '正在准备图片…';
		this.#emit();
		return this.snapshot();
	}

	progress(
		completed: number,
		total: number,
		phase: Exclude<ReaderLightboxBatchSnapshot['phase'], 'idle'>,
	): void {
		this.#assertActive();
		if (!this.#busy) return;
		this.#completed = Math.max(0, Math.min(total, Math.trunc(completed)));
		this.#total = Math.max(1, Math.trunc(total));
		this.#phase = phase;
		this.#status = phase === 'fetching'
			? `已处理 ${this.#completed} / ${this.#total} 张`
			: phase === 'archiving'
				? '正在生成 ZIP 文件…'
				: '下载已开始';
		this.#emit();
	}

	finish(status: string): void {
		this.#assertActive();
		this.#busy = false;
		this.#phase = 'saved';
		this.#completed = this.#total;
		this.#status = String(status).trim() || '批量下载完成';
		this.#emit();
	}

	fail(error: unknown): void {
		this.#assertActive();
		this.#busy = false;
		this.#phase = 'idle';
		this.#status = `打包失败：${error instanceof Error ? error.message : '请重试'}`;
		this.#onError(error);
		this.#emit();
	}

	cancel(): void {
		this.#assertActive();
		this.#busy = false;
		this.#phase = 'idle';
		this.#completed = 0;
		this.#total = 0;
		this.#status = '批量下载已取消';
		this.#emit();
	}

	destroy(): void {
		this.scope.destroy();
	}

	#resetProgress(): void {
		this.#busy = false;
		this.#completed = 0;
		this.#total = 0;
		this.#phase = 'idle';
		this.#status = '请选择要打包的图片';
	}

	#emit(): void {
		for (const error of this.changes.emit(this.snapshot())) this.#onError(error);
	}

	#assertMutable(): void {
		this.#assertActive();
		if (this.#busy) throw new Error('批量下载进行中');
		if (this.#loadingAll) throw new Error('正在建立全帖图片索引');
	}

	#scopeItems(): readonly ReaderLightboxItem[] {
		const items = this.#sequence.snapshot().items;
		return this.#scope === 'all'
			? items
			: Object.freeze(items.filter((item) => this.#loadedKeys.has(item.key)));
	}

	#assertActive(): void {
		if (this.scope.destroyed) {
			throw new Error('ReaderLightboxBatchController 已销毁');
		}
	}
}
