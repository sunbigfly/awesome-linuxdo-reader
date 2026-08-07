import {
	discourseAuthScope,
	type DiscourseAuthScope,
} from '../discourse/identifiers.js';

export interface ReaderAccountScopedStorageIdentity {
	readonly authScope: DiscourseAuthScope;
	readonly key: string;
	readonly legacyKey: string;
	readonly legacyOwnerKey: string;
	readonly canClaimLegacy: boolean;
}

export interface ReaderAccountScopedStringStoragePort {
	getItem(key: string): string | null;
	setItem(key: string, value: string): void;
}

export interface ReaderAccountScopedValueStoragePort {
	getValue(key: string): unknown | Promise<unknown>;
	setValue(key: string, value: unknown): void | Promise<void>;
}

function baseStorageKey(value: unknown): string {
	const normalized = String(value ?? '').trim();
	if (!normalized) throw new Error('account scoped storage base key 不能为空');
	return normalized;
}

function missing(value: unknown): boolean {
	return value === null || value === undefined;
}

/**
 * 本地用户状态统一账号命名协议。
 *
 * legacyOwnerKey 只声明旧无账号 key 归属首个完成升级的已登录账号；旧值不删除，
 * scoped key 写入空状态后也继续存在，避免清空后再次从 legacy 复活。
 */
export function readerAccountScopedStorageIdentity(
	legacyKeyValue: string,
	authScopeValue: string,
): ReaderAccountScopedStorageIdentity {
	const legacyKey = baseStorageKey(legacyKeyValue);
	const authScope = discourseAuthScope(authScopeValue);
	return Object.freeze({
		authScope,
		key: `${legacyKey}:scope:v2:${encodeURIComponent(authScope)}`,
		legacyKey,
		legacyOwnerKey: `${legacyKey}:legacy-owner:v2`,
		canClaimLegacy: authScope.startsWith('account:'),
	});
}

export function readReaderAccountScopedString(
	storage: ReaderAccountScopedStringStoragePort,
	identity: ReaderAccountScopedStorageIdentity,
): string | null {
	const scoped = storage.getItem(identity.key);
	if (scoped !== null) return scoped;
	if (!identity.canClaimLegacy) return null;
	const legacy = storage.getItem(identity.legacyKey);
	if (legacy === null) return null;
	const owner = storage.getItem(identity.legacyOwnerKey);
	if (owner !== null && owner !== identity.authScope) return null;
	if (owner === null) {
		storage.setItem(identity.legacyOwnerKey, identity.authScope);
		if (storage.getItem(identity.legacyOwnerKey) !== identity.authScope) {
			return null;
		}
	}
	storage.setItem(identity.key, legacy);
	return storage.getItem(identity.key);
}

export async function readReaderAccountScopedValue(
	storage: ReaderAccountScopedValueStoragePort,
	identity: ReaderAccountScopedStorageIdentity,
): Promise<unknown> {
	const scoped = await storage.getValue(identity.key);
	if (!missing(scoped)) return scoped;
	if (!identity.canClaimLegacy) return null;
	const legacy = await storage.getValue(identity.legacyKey);
	if (missing(legacy)) return null;
	const owner = await storage.getValue(identity.legacyOwnerKey);
	if (!missing(owner) && String(owner) !== identity.authScope) return null;
	if (missing(owner)) {
		await storage.setValue(identity.legacyOwnerKey, identity.authScope);
		if (String(await storage.getValue(identity.legacyOwnerKey)) !== identity.authScope) {
			return null;
		}
	}
	await storage.setValue(identity.key, legacy);
	const migrated = await storage.getValue(identity.key);
	return missing(migrated) ? null : migrated;
}
