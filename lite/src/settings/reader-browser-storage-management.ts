import { READER_CACHE_COORDINATION_STORAGE_KEY } from
	'../app/reader-data-runtime.js';
import { LifecycleScope } from '../kernel/lifecycle.js';
import { READER_REQUEST_PERMIT_STORAGE_KEY } from
	'../network/browser-shared-request-permit.js';
import type {
	ReaderChoiceRequest,
	ReaderConfirmChoice,
	ReaderConfirmRequest,
} from '../shell/reader-feedback-surface.js';
import {
	settingsButton,
	settingsCopy,
	settingsElement,
	settingsSection,
} from './reader-settings-dom.js';

export const READER_LOCAL_STORAGE_PROBE_PREFIX =
	'linuxdo-enhanced-reader:storage-probe:v1:';
export const READER_LOCAL_STORAGE_STALE_AFTER_MS = 24 * 60 * 60 * 1_000;
export const READER_LOCAL_STORAGE_REMAINING_PROBE_MAX_BYTES =
	16 * 1_024 * 1_024;
export const READER_LOCAL_STORAGE_STARTUP_HEADROOM_BYTES = 64 * 1_024;

export type ReaderLocalStorageHealth =
	| 'available'
	| 'quota-exceeded'
	| 'access-denied'
	| 'unavailable';

export interface ReaderLocalStorageEntry {
	readonly key: string;
	readonly bytes: number;
	readonly readerOwned: boolean;
	readonly stale: boolean;
}

export interface ReaderLocalStorageSnapshot {
	readonly health: ReaderLocalStorageHealth;
	readonly cause?: unknown;
	readonly entries: readonly ReaderLocalStorageEntry[];
	readonly bytes: number;
	readonly readerBytes: number;
	readonly staleBytes: number;
	readonly staleCount: number;
	readonly originUsage: number | null;
	readonly originQuota: number | null;
	readonly persistent: boolean | null;
	readonly storageAccess: boolean | null;
}

export interface ReaderLocalStorageRemaining {
	readonly bytes: number;
	readonly capped: boolean;
	readonly cause?: unknown;
}

export interface ReaderBrowserStorageAccessPort {
	readonly hasAccess?: () => boolean | Promise<boolean>;
	readonly requestAccess?: () => unknown | Promise<unknown>;
}

export interface ReaderOriginStoragePort {
	readonly estimate?: () => Promise<Readonly<{
		readonly usage?: number;
		readonly quota?: number;
	}>>;
	readonly persisted?: () => Promise<boolean>;
	readonly persist?: () => Promise<boolean>;
}

export interface ReaderBrowserStorageSnapshotOptions {
	readonly storage: Storage;
	readonly initialAccessError?: unknown;
	readonly storageAccess?: ReaderBrowserStorageAccessPort;
	readonly originStorage?: ReaderOriginStoragePort;
	readonly now?: () => number;
	readonly onError?: (cause: unknown) => void;
}

export interface ReaderBrowserStorageManagementOptions
extends ReaderBrowserStorageSnapshotOptions {
	readonly document: Document;
	readonly host: HTMLElement;
	readonly confirm: (request: ReaderConfirmRequest) => Promise<boolean>;
	readonly choose?: (
		request: ReaderChoiceRequest,
	) => Promise<ReaderConfirmChoice>;
	readonly notify?: (message: string) => void;
	readonly openSettings?: () => void;
	readonly reload?: () => void;
	readonly remainingProbeMaxBytes?: number;
	readonly parentScope?: LifecycleScope;
}

interface LocalStorageReadResult {
	readonly entries: readonly ReaderLocalStorageEntry[];
	readonly bytes: number;
	readonly readerBytes: number;
	readonly staleBytes: number;
	readonly staleCount: number;
}

let probeSequence = 0;

function record(value: unknown): Readonly<Record<string, unknown>> | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as Readonly<Record<string, unknown>>
		: null;
}

function finite(value: unknown): number | null {
	const normalized = Number(value);
	return Number.isFinite(normalized) && normalized >= 0
		? normalized
		: null;
}

function quotaError(cause: unknown): boolean {
	const error = cause as Readonly<{
		readonly name?: unknown;
		readonly code?: unknown;
	}> | null;
	return error?.name === 'QuotaExceededError' ||
		error?.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
		error?.code === 22 ||
		error?.code === 1014;
}

function accessDeniedError(cause: unknown): boolean {
	const name = String(
		(cause as Readonly<{ readonly name?: unknown }> | null)?.name ?? '',
	);
	return name === 'SecurityError' ||
		name === 'NotAllowedError' ||
		name === 'InvalidStateError';
}

function healthFromError(cause: unknown): ReaderLocalStorageHealth {
	if (quotaError(cause)) return 'quota-exceeded';
	if (accessDeniedError(cause)) return 'access-denied';
	return 'unavailable';
}

function approximateStorageBytes(key: string, value: string): number {
	// Web Storage 的键和值按 UTF-16 字符串保存；浏览器实现可能另有少量元数据开销。
	return Math.max(0, (key.length + value.length) * 2);
}

function readerOwnedKey(key: string): boolean {
	return key.startsWith('linuxdo-enhanced-reader:') ||
		key.startsWith('awesome-linuxdo-reader:') ||
		key.startsWith('ldp:mian-lite:') ||
		key.endsWith(':mian-lite:v1');
}

function liveExpiryEntries(value: unknown, now: number): boolean {
	return Array.isArray(value) && value.some((entry) => {
		const source = record(entry);
		if (!source) return false;
		return [source.expiresAt, source.retryAt, source.probeExpiresAt]
			.some((timestamp) => (finite(timestamp) ?? 0) > now);
	});
}

function staleRequestPermit(value: string, now: number): boolean {
	let source: Readonly<Record<string, unknown>> | null = null;
	try {
		source = record(JSON.parse(value));
	} catch {
		return false;
	}
	if (!source || source.schemaVersion !== 1) return false;
	const updatedAt = finite(source.updatedAt);
	if (
		updatedAt === null ||
		updatedAt + READER_LOCAL_STORAGE_STALE_AFTER_MS > now
	) return false;
	const recentWindowEvent = Array.isArray(source.events) &&
		source.events.some((timestamp) =>
			(finite(timestamp) ?? 0) + 60_000 > now);
	const challenge = record(source.challenge);
	const liveChallenge = challenge !== null &&
		String(challenge.state ?? '') !== 'passed' &&
		(finite(challenge.expiresAt) ?? 0) > now;
	return !recentWindowEvent &&
		!liveChallenge &&
		!liveExpiryEntries(source.intents, now) &&
		!liveExpiryEntries(source.active, now) &&
		!liveExpiryEntries(source.policies, now) &&
		!liveExpiryEntries(source.rateLimits, now);
}

function staleCacheCoordination(value: string, now: number): boolean {
	let source: Readonly<Record<string, unknown>> | null = null;
	try {
		source = record(JSON.parse(value));
	} catch {
		return false;
	}
	if (!source || source.schemaVersion !== 1) return false;
	const updatedAt = finite(source.updatedAt);
	return updatedAt !== null &&
		updatedAt + READER_LOCAL_STORAGE_STALE_AFTER_MS <= now &&
		!liveExpiryEntries(source.flights, now) &&
		!liveExpiryEntries(source.failures, now);
}

function staleReaderEntry(key: string, value: string, now: number): boolean {
	if (key.startsWith(READER_LOCAL_STORAGE_PROBE_PREFIX)) return true;
	if (key === READER_REQUEST_PERMIT_STORAGE_KEY) {
		return staleRequestPermit(value, now);
	}
	if (key === READER_CACHE_COORDINATION_STORAGE_KEY) {
		return staleCacheCoordination(value, now);
	}
	return false;
}

function readLocalStorage(
	storage: Storage,
	now: number,
): LocalStorageReadResult {
	const entries: ReaderLocalStorageEntry[] = [];
	let bytes = 0;
	let readerBytes = 0;
	let staleBytes = 0;
	for (let index = 0; index < storage.length; index += 1) {
		const key = storage.key(index);
		if (key === null) continue;
		const owned = readerOwnedKey(key);
		if (!owned) continue;
		const value = storage.getItem(key) ?? '';
		const entryBytes = approximateStorageBytes(key, value);
		const stale = staleReaderEntry(key, value, now);
		bytes += entryBytes;
		readerBytes += entryBytes;
		if (stale) staleBytes += entryBytes;
		entries.push(Object.freeze({
			key,
			bytes: entryBytes,
			readerOwned: true,
			stale,
		}));
	}
	entries.sort((left, right) =>
		right.bytes - left.bytes || left.key.localeCompare(right.key));
	return Object.freeze({
		entries: Object.freeze(entries),
		bytes,
		readerBytes,
		staleBytes,
		staleCount: entries.filter((entry) => entry.stale).length,
	});
}

function probeKey(now: number): string {
	probeSequence += 1;
	return `${READER_LOCAL_STORAGE_PROBE_PREFIX}${now}-${probeSequence}`;
}

function verifyWritable(storage: Storage, now: number): void {
	const key = probeKey(now);
	try {
		storage.setItem(
			key,
			'1'.repeat(READER_LOCAL_STORAGE_STARTUP_HEADROOM_BYTES / 2),
		);
	} finally {
		storage.removeItem(key);
	}
}

function safeMetric(value: unknown): number | null {
	const normalized = Number(value);
	return Number.isFinite(normalized) && normalized >= 0
		? normalized
		: null;
}

export async function readReaderBrowserStorageSnapshot(
	options: ReaderBrowserStorageSnapshotOptions,
): Promise<ReaderLocalStorageSnapshot> {
	const now = options.now ?? Date.now;
	let storageAccess: boolean | null = null;
	let health: ReaderLocalStorageHealth = 'available';
	let cause: unknown = options.initialAccessError;
	let local: LocalStorageReadResult = Object.freeze({
		entries: Object.freeze([]),
		bytes: 0,
		readerBytes: 0,
		staleBytes: 0,
		staleCount: 0,
	});
	if (options.storageAccess?.hasAccess) {
		try {
			storageAccess = await options.storageAccess.hasAccess();
			if (!storageAccess && cause === undefined) {
				health = 'access-denied';
				cause = new DOMException('站点存储访问未授权', 'NotAllowedError');
			}
		} catch (error) {
			options.onError?.(error);
		}
	}
	if (cause !== undefined) health = healthFromError(cause);
	if (health === 'available') {
		try {
			local = readLocalStorage(options.storage, now());
			verifyWritable(options.storage, now());
		} catch (error) {
			health = healthFromError(error);
			cause = error;
		}
	}

	let originUsage: number | null = null;
	let originQuota: number | null = null;
	let persistent: boolean | null = null;
	if (options.originStorage?.estimate) {
		try {
			const estimate = await options.originStorage.estimate();
			originUsage = safeMetric(estimate.usage);
			originQuota = safeMetric(estimate.quota);
		} catch (error) {
			options.onError?.(error);
		}
	}
	if (options.originStorage?.persisted) {
		try {
			persistent = await options.originStorage.persisted();
		} catch (error) {
			options.onError?.(error);
		}
	}
	return Object.freeze({
		health,
		...(cause === undefined ? {} : { cause }),
		...local,
		originUsage,
		originQuota,
		persistent,
		storageAccess,
	});
}

export function measureReaderLocalStorageRemaining(
	storage: Storage,
	options: Readonly<{
		readonly now?: () => number;
		readonly maxBytes?: number;
	}> = {},
): ReaderLocalStorageRemaining {
	const now = options.now ?? Date.now;
	const maxBytes = Math.max(
		2,
		Math.floor(
			Number(options.maxBytes ??
				READER_LOCAL_STORAGE_REMAINING_PROBE_MAX_BYTES),
		),
	);
	const maxCharacters = Math.max(1, Math.floor(maxBytes / 2));
	const key = probeKey(now());
	let low = 0;
	let high = maxCharacters;
	let capped = false;
	let unexpected: unknown;
	const write = (characters: number): boolean => {
		try {
			storage.setItem(key, '0'.repeat(characters));
			return true;
		} catch (cause) {
			if (!quotaError(cause)) unexpected = cause;
			return false;
		}
	};
	try {
		if (write(maxCharacters)) {
			low = maxCharacters;
			capped = true;
		} else if (unexpected === undefined) {
			while (low + 1 < high) {
				const middle = low + Math.floor((high - low) / 2);
				if (write(middle)) low = middle;
				else {
					high = middle;
					if (unexpected !== undefined) break;
				}
			}
		}
	} finally {
		try {
			storage.removeItem(key);
		} catch (cause) {
			unexpected ??= cause;
		}
	}
	return Object.freeze({
		bytes: low * 2,
		capped,
		...(unexpected === undefined ? {} : { cause: unexpected }),
	});
}

function formatBytes(rawBytes: number): string {
	const bytes = Math.max(0, Number(rawBytes) || 0);
	if (bytes < 1_024) return `${bytes} B`;
	if (bytes < 1_048_576) return `${(bytes / 1_024).toFixed(1)} KB`;
	return `${(bytes / 1_048_576).toFixed(1)} MB`;
}

function healthLabel(health: ReaderLocalStorageHealth): string {
	if (health === 'available') return '可读写';
	if (health === 'quota-exceeded') return '空间已满或余量不足';
	if (health === 'access-denied') return '存储访问被拒绝';
	return '当前环境不可用';
}

/**
 * 设置“数据管理”里的浏览器 localStorage 控制面。
 *
 * 只显示 Reader 键名与近似大小，不读取到 UI 或日志中的值，也不列出或删除原站和
 * 其他脚本的数据。原始键删除必须二次确认并立即刷新页面；默认久远清理只处理过期
 * 的 Reader 协调状态和遗留探针，永不猜测设置、历史或阅读队列是否可以删除。
 */
export class ReaderBrowserStorageManagementSurface {
	readonly scope: LifecycleScope;
	readonly #options: ReaderBrowserStorageManagementOptions;
	readonly #section: HTMLElement;
	readonly #summary: HTMLElement;
	readonly #picker: HTMLDetailsElement;
	readonly #pickerSummary: HTMLElement;
	readonly #selectAll: HTMLInputElement;
	readonly #list: HTMLElement;
	readonly #status: HTMLElement;
	readonly #refreshButton: HTMLButtonElement;
	readonly #permissionButton: HTMLButtonElement;
	readonly #staleButton: HTMLButtonElement;
	readonly #clearButton: HTMLButtonElement;
	readonly #selects = new Map<string, HTMLInputElement>();
	#snapshot: ReaderLocalStorageSnapshot | null = null;
	#remaining: ReaderLocalStorageRemaining | null = null;
	#refreshToken = 0;
	#busy = false;
	#startupChecked = false;

	constructor(options: ReaderBrowserStorageManagementOptions) {
		this.#options = options;
		this.scope = LifecycleScope.ownedBy(options.parentScope);
		const document = options.document;
		this.#section = settingsSection(
			document,
			'Reader localStorage',
			'查看余量，按需清理 Reader 数据。',
			true,
		);
		this.#section.dataset.settingCategory = 'browser-local-storage';
		const content = settingsElement(
			document,
			'div',
			'ldp-settings-category-content ldp-local-storage-body',
		);
		this.#summary = settingsElement(
			document,
			'small',
			'ldp-cache-note ldp-local-storage-summary',
		);
		this.#summary.role = 'status';
		this.#summary.setAttribute('aria-live', 'polite');
		const actions = settingsElement(
			document,
			'div',
			'ldp-config-actions ldp-local-storage-actions',
		);
		this.#refreshButton = settingsButton(
			document,
			'ldp-config-action ldp-local-storage-refresh',
			'',
			'rotate-ccw',
			'检测余量',
		);
		this.#permissionButton = settingsButton(
			document,
			'ldp-config-action ldp-local-storage-permission',
			'',
			'database',
			'申请持久保存',
		);
		this.#staleButton = settingsButton(
			document,
			'ldp-config-action ldp-local-storage-stale',
			'',
			'trash',
			'清理久远',
		);
		actions.append(
			this.#refreshButton,
			this.#permissionButton,
			this.#staleButton,
		);
		const guide = settingsElement(
			document,
			'details',
			'ldp-cache-note ldp-local-storage-boundary',
		);
		const guideSummary = settingsElement(
			document,
			'summary',
			'ldp-local-storage-boundary-summary',
		);
		guideSummary.textContent = '空间仍不足？查看浏览器清理方法';
		const guideCopy = settingsElement(document, 'small');
		guideCopy.textContent =
			'这里只列出和清理 Reader 数据，不会读取或删除原站及其他脚本数据。若站点总空间仍不足，请从地址栏左侧的站点信息进入“网站设置”，再查看或清理该站点数据；清理整个站点可能退出登录并重置站点设置。';
		guide.append(guideSummary, guideCopy);
		this.#picker = settingsElement(
			document,
			'details',
			'ldp-local-storage-picker',
		);
		this.#pickerSummary = settingsElement(
			document,
			'summary',
			'ldp-local-storage-picker-summary',
		);
		this.#pickerSummary.textContent = 'Reader 数据（暂无）';
		const pickerControls = settingsElement(
			document,
			'div',
			'ldp-local-storage-picker-controls',
		);
		const selectAllLabel = settingsElement(
			document,
			'label',
			'ldp-local-storage-select-all-label',
		);
		this.#selectAll = settingsElement(
			document,
			'input',
			'ldp-local-storage-select-all',
		);
		this.#selectAll.type = 'checkbox';
		const selectAllCopy = settingsElement(document, 'span');
		selectAllCopy.textContent = '全选';
		selectAllLabel.append(this.#selectAll, selectAllCopy);
		pickerControls.append(selectAllLabel);
		this.#list = settingsElement(
			document,
			'div',
			'ldp-cache-list ldp-local-storage-list',
		);
		this.#picker.append(this.#pickerSummary, pickerControls, this.#list);
		this.#clearButton = settingsButton(
			document,
			'ldp-cache-clear ldp-local-storage-clear',
			'',
			'trash',
			'删除已选项',
		);
		this.#status = settingsElement(
			document,
			'small',
			'ldp-cache-note ldp-local-storage-status',
		);
		this.#status.role = 'status';
		this.#status.setAttribute('aria-live', 'polite');
		content.append(
			this.#summary,
			actions,
			guide,
			this.#picker,
			this.#clearButton,
			this.#status,
		);
		this.#section.append(content);
		options.host.append(this.#section);
		this.scope.add(() => this.#section.remove());
		this.scope.listen(this.#refreshButton, 'click', () => {
			void this.refresh({ measureRemaining: true });
		});
		this.scope.listen(this.#permissionButton, 'click', () => {
			void this.#requestStoragePermission();
		});
		this.scope.listen(this.#staleButton, 'click', () => {
			void this.#clearStale(true);
		});
		this.scope.listen(this.#clearButton, 'click', () => {
			void this.#clearSelected();
		});
		this.scope.listen(this.#selectAll, 'change', () => {
			if (this.#busy) return;
			for (const input of this.#selects.values()) {
				input.checked = this.#selectAll.checked;
			}
			this.#syncButtons();
		});
		this.scope.listen(this.#list, 'change', () => this.#syncButtons());
		this.#syncButtons();
		void this.refresh();
	}

	async refresh(
		options: Readonly<{ readonly measureRemaining?: boolean }> = {},
	): Promise<ReaderLocalStorageSnapshot | null> {
		const token = ++this.#refreshToken;
		this.#setBusy(true);
		this.#status.textContent = options.measureRemaining
			? '正在读取 localStorage 并检测可追加余量…'
			: '正在读取 localStorage…';
		try {
			const snapshot = await readReaderBrowserStorageSnapshot(this.#options);
			if (token !== this.#refreshToken || this.scope.destroyed) return null;
			this.#snapshot = snapshot;
			if (options.measureRemaining && snapshot.health === 'available') {
				this.#remaining = measureReaderLocalStorageRemaining(
					this.#options.storage,
					{
						...(this.#options.now ? { now: this.#options.now } : {}),
						...(this.#options.remainingProbeMaxBytes === undefined
							? {}
							: { maxBytes: this.#options.remainingProbeMaxBytes }),
					},
				);
				if (this.#remaining.cause !== undefined) {
					this.#options.onError?.(this.#remaining.cause);
				}
			}
			this.#render();
			this.#status.textContent = snapshot.health === 'available'
				? ''
				: 'localStorage 当前不可写；请先处理权限或空间后再刷新。';
			return snapshot;
		} catch (cause) {
			if (token !== this.#refreshToken || this.scope.destroyed) return null;
			this.#options.onError?.(cause);
			this.#status.textContent = 'localStorage 统计失败，请稍后重试。';
			return null;
		} finally {
			if (token === this.#refreshToken) this.#setBusy(false);
		}
	}

	async warnAtStartup(): Promise<boolean> {
		if (this.#startupChecked) return false;
		this.#startupChecked = true;
		const snapshot = await this.refresh();
		if (
			!snapshot ||
			snapshot.health === 'available' ||
			!this.#options.choose ||
			this.scope.destroyed
		) return false;
		const canRequestAccess = snapshot.health === 'access-denied' &&
			Boolean(this.#options.storageAccess?.requestAccess);
		const canClearStale = snapshot.staleCount > 0;
		const choice = await this.#options.choose({
			title: '浏览器本地存储不可写',
			message:
				'阅读器无法写入当前站点的 localStorage，请求协调、设置或本地记录可能保存失败。',
			note:
				'“打开数据管理”可查看占用、检测余量、申请可用权限并选择清理；持久保存不会扩大 localStorage 配额。',
			confirmLabel: '打开数据管理',
			cancelLabel: '稍后处理',
			...(canRequestAccess
				? { secondaryLabel: '请求存储访问' }
				: canClearStale
					? { secondaryLabel: '清理久远数据' }
					: {}),
			tone: 'danger',
			icon: 'database',
				details: Object.freeze([
				Object.freeze({
					label: 'Reader localStorage',
					value: healthLabel(snapshot.health),
				}),
				Object.freeze({
					label: 'Reader 已知占用',
					value: formatBytes(snapshot.readerBytes),
				}),
			]),
		});
		if (choice === 'confirm') {
			this.#options.openSettings?.();
		} else if (choice === 'secondary') {
			if (canRequestAccess) await this.#requestStoragePermission();
			else if (canClearStale) await this.#clearStale(false);
		}
		return true;
	}

	destroy(): void {
		this.scope.destroy();
	}

	#render(): void {
		const snapshot = this.#snapshot;
		if (!snapshot) return;
		const checked = new Set(
			[...this.#selects]
				.filter(([, input]) => input.checked)
				.map(([key]) => key),
		);
		this.#selects.clear();
		this.#list.replaceChildren();
		for (const entry of snapshot.entries) {
			const row = settingsElement(
				this.#options.document,
				'label',
				`ldp-cache-row ldp-local-storage-row${
					entry.stale ? ' is-stale' : ''
				}`,
			);
			row.dataset.settingHelp = entry.readerOwned
				? entry.stale
					? 'Reader 24 小时以上未更新且已无有效租约的临时协调数据；可使用“清理久远数据”安全移除。'
					: 'Reader 本地数据。原始删除可能重置设置、历史或阅读队列；优先使用上方对应的配置或缓存入口。'
				: '';
			const input = settingsElement(
				this.#options.document,
				'input',
				'ldp-cache-select ldp-local-storage-select',
			);
			input.type = 'checkbox';
			input.value = entry.key;
			input.checked = checked.has(entry.key);
			input.disabled = this.#busy;
			const copy = settingsCopy(
				this.#options.document,
				'ldp-local-storage-key-copy',
				entry.key,
				entry.readerOwned
					? entry.stale
						? 'Reader 临时项 · 久远可清理'
						: 'Reader 数据'
					: '',
			);
			const size = settingsElement(this.#options.document, 'em');
			size.textContent = formatBytes(entry.bytes);
			row.append(input, copy, size);
			this.#list.append(row);
			this.#selects.set(entry.key, input);
		}
		if (!snapshot.entries.length) {
			const empty = settingsElement(
				this.#options.document,
				'small',
				'ldp-cache-note ldp-local-storage-empty',
			);
			empty.textContent = snapshot.health === 'available'
				? '暂无 Reader localStorage 数据。'
				: '当前无法读取 Reader localStorage。';
			this.#list.append(empty);
		}
		const remaining = this.#remaining
			? this.#remaining.cause === undefined
				? `${this.#remaining.capped ? '至少 ' : '约 '}${
					formatBytes(this.#remaining.bytes)
				}`
				: '检测失败'
			: '尚未检测';
		const persistent = snapshot.persistent === null
			? ''
			: snapshot.persistent
				? ' · 已持久保存'
				: ' · 未持久保存';
		const health = snapshot.health === 'available'
			? ''
			: `${healthLabel(snapshot.health)} · `;
		this.#summary.textContent =
			`${health}已用 ${formatBytes(snapshot.readerBytes)} · ` +
			`可追加 ${remaining}${persistent}`;
		this.#permissionButton.querySelector('span')!.textContent =
			snapshot.storageAccess === false &&
			this.#options.storageAccess?.requestAccess
				? '请求存储访问'
				: snapshot.persistent
					? '已持久保存'
					: '申请持久保存';
		this.#syncButtons();
	}

	async #requestStoragePermission(): Promise<void> {
		if (this.#busy) return;
		const snapshot = this.#snapshot ?? await this.refresh();
		if (!snapshot || this.scope.destroyed) return;
		this.#setBusy(true);
		try {
			if (
				snapshot.storageAccess === false &&
				this.#options.storageAccess?.requestAccess
			) {
				this.#status.textContent = '正在请求当前站点的存储访问…';
				await this.#options.storageAccess.requestAccess();
				this.#options.notify?.('已取得存储访问，正在刷新页面');
				this.#status.textContent = '已取得存储访问，正在刷新页面…';
				this.#options.reload?.();
				return;
			}
			if (!this.#options.originStorage?.persist) {
				this.#status.textContent =
					'浏览器未提供网页内申请入口；请在浏览器站点设置中允许 Cookie 与站点数据。';
				return;
			}
			this.#status.textContent = '正在申请浏览器持久保存…';
			const granted = await this.#options.originStorage.persist();
			this.#options.notify?.(granted
				? '浏览器已授予持久保存'
				: '浏览器未授予持久保存');
			this.#status.textContent = granted
				? '已授予持久保存；浏览器会尽量避免自动回收站点数据，但 localStorage 配额不会扩大。'
				: '浏览器未授予持久保存；这不会改变 localStorage 当前配额。';
			await this.refresh();
		} catch (cause) {
			this.#options.onError?.(cause);
			this.#status.textContent = accessDeniedError(cause)
				? '存储权限请求被浏览器拒绝；请检查站点 Cookie 与站点数据权限。'
				: '存储权限请求失败，请稍后重试。';
		} finally {
			this.#setBusy(false);
		}
	}

	async #clearStale(confirm: boolean): Promise<void> {
		if (this.#busy) return;
		const snapshot = this.#snapshot ?? await this.refresh();
		const stale = snapshot?.entries.filter((entry) => entry.stale) ?? [];
		if (!stale.length) {
			this.#status.textContent = '没有可安全自动清理的久远 Reader 临时数据。';
			return;
		}
		this.#setBusy(true);
		try {
			if (confirm) {
				const accepted = await this.#options.confirm({
					title: '清理久远 Reader 数据？',
					message:
						`将删除 ${stale.length} 项、约 ${formatBytes(
							stale.reduce((sum, entry) => sum + entry.bytes, 0),
						)} 的过期协调状态或遗留探针。`,
					note:
						'不会删除设置、历史、阅读队列、缓存正文、原站登录或 WebDAV 数据；完成后页面会刷新。',
					confirmLabel: '清理久远数据',
					tone: 'danger',
					icon: 'trash',
				});
				if (!accepted) {
					this.#status.textContent = '已取消久远数据清理。';
					return;
				}
			}
			for (const entry of stale) this.#options.storage.removeItem(entry.key);
			this.#options.notify?.(`已清理 ${stale.length} 项久远 Reader 数据`);
			this.#status.textContent = '久远数据已清理，正在刷新页面…';
			this.#options.reload?.();
			if (!this.#options.reload) await this.refresh({ measureRemaining: true });
		} catch (cause) {
			this.#options.onError?.(cause);
			this.#status.textContent = '久远数据清理失败，未完成的项目仍会保留。';
		} finally {
			this.#setBusy(false);
		}
	}

	async #clearSelected(): Promise<void> {
		if (this.#busy || !this.#snapshot) return;
		const selected = this.#snapshot.entries.filter(
			(entry) => entry.readerOwned &&
				this.#selects.get(entry.key)?.checked === true,
		);
		if (!selected.length) return;
		this.#setBusy(true);
		try {
			const accepted = await this.#options.confirm({
				title: '删除所选 localStorage 项？',
				message:
					`将删除 ${selected.length} 项、约 ${formatBytes(
						selected.reduce((sum, entry) => sum + entry.bytes, 0),
					)}，随后立即刷新页面。`,
				note:
					'这里只会删除 Reader 数据，不会删除原站或其他脚本数据。Reader 设置、历史或队列删除后可能恢复默认，已同步数据之后也可能从 WebDAV 重新合并。',
				confirmLabel: '删除并刷新',
				tone: 'danger',
				icon: 'trash',
				details: Object.freeze(selected.slice(0, 5).map((entry) =>
					Object.freeze({
						label: entry.key,
						value: formatBytes(entry.bytes),
					}))),
			});
			if (!accepted) {
				this.#status.textContent = '已取消 localStorage 删除。';
				return;
			}
			const failures: string[] = [];
			for (const entry of selected) {
				try {
					this.#options.storage.removeItem(entry.key);
				} catch (cause) {
					failures.push(entry.key);
					this.#options.onError?.(cause);
				}
			}
			if (failures.length) {
				this.#status.textContent =
					`已删除 ${selected.length - failures.length} 项；${failures.length} 项删除失败并保留。`;
				await this.refresh({ measureRemaining: true });
				return;
			}
			this.#options.notify?.(`已删除 ${selected.length} 项 localStorage 数据`);
			this.#status.textContent = '所选 localStorage 已删除，正在刷新页面…';
			this.#options.reload?.();
			if (!this.#options.reload) await this.refresh({ measureRemaining: true });
		} catch (cause) {
			this.#options.onError?.(cause);
			this.#status.textContent = 'localStorage 删除失败，未完成的项目仍会保留。';
		} finally {
			this.#setBusy(false);
		}
	}

	#setBusy(busy: boolean): void {
		this.#busy = busy;
		for (const input of this.#selects.values()) input.disabled = busy;
		this.#syncButtons();
	}

	#syncButtons(): void {
		const snapshot = this.#snapshot;
		const selectedCount = [...this.#selects.values()].filter(
			(input) => input.checked,
		).length;
		const totalCount = this.#selects.size;
		this.#pickerSummary.textContent = totalCount
			? `Reader 数据（${selectedCount} / ${totalCount}）`
			: 'Reader 数据（暂无）';
		this.#selectAll.checked = totalCount > 0 && selectedCount === totalCount;
		this.#selectAll.indeterminate = selectedCount > 0 &&
			selectedCount < totalCount;
		this.#selectAll.disabled = this.#busy || totalCount === 0;
		this.#picker.classList.toggle('has-selection', selectedCount > 0);
		this.#clearButton.hidden = selectedCount === 0;
		this.#clearButton.querySelector('span')!.textContent =
			`删除已选 ${selectedCount} 项`;
		this.#refreshButton.disabled = this.#busy;
		const canRequestAccess = snapshot?.storageAccess === false &&
			Boolean(this.#options.storageAccess?.requestAccess);
		const canPersist = !snapshot?.persistent &&
			Boolean(this.#options.originStorage?.persist);
		this.#permissionButton.hidden = !(canRequestAccess || canPersist);
		this.#permissionButton.disabled = this.#busy ||
			Boolean(snapshot?.persistent) ||
			(
				!this.#options.originStorage?.persist &&
				!(snapshot?.storageAccess === false &&
					this.#options.storageAccess?.requestAccess)
			);
		this.#staleButton.disabled = this.#busy ||
			!snapshot?.staleCount;
		this.#staleButton.hidden = !snapshot?.staleCount;
		this.#clearButton.disabled = this.#busy || selectedCount === 0;
	}
}
