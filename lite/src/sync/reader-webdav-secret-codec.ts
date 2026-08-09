const READER_WEBDAV_SECRET_FORMAT =
	'awesome-linuxdo-reader-lite-aes-gcm' as const;
const READER_WEBDAV_SECRET_VERSION = 1 as const;
const PBKDF2_ITERATIONS = 210_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const MAX_CIPHERTEXT_BYTES = 1024 * 1024;

export interface ReaderWebDavEncryptedSecret {
	readonly format: typeof READER_WEBDAV_SECRET_FORMAT;
	readonly version: typeof READER_WEBDAV_SECRET_VERSION;
	readonly kdf: 'PBKDF2-SHA-256';
	readonly iterations: number;
	readonly salt: string;
	readonly cipher: 'AES-256-GCM';
	readonly iv: string;
	readonly ciphertext: string;
}

type UnknownRecord = Readonly<Record<string, unknown>>;

function record(value: unknown): UnknownRecord | null {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? value as UnknownRecord
		: null;
}

function cryptoPort(): Crypto {
	const crypto = globalThis.crypto;
	if (!crypto?.subtle || !crypto.getRandomValues) {
		throw new Error('浏览器缺少 Web Crypto，无法加密 WebDAV 翻译设置');
	}
	return crypto;
}

function base64Url(bytes: Uint8Array): string {
	let binary = '';
	for (const byte of bytes) binary += String.fromCharCode(byte);
	return btoa(binary)
		.replaceAll('+', '-')
		.replaceAll('/', '_')
		.replace(/=+$/u, '');
}

function fromBase64Url(
	value: unknown,
	maximum: number,
): Uint8Array<ArrayBuffer> {
	const source = String(value ?? '');
	if (!source || source.length > Math.ceil(maximum * 4 / 3) + 4) {
		throw new Error('WebDAV 加密载荷长度无效');
	}
	const base64 = source.replaceAll('-', '+').replaceAll('_', '/');
	const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
	const binary = atob(padded);
	if (binary.length > maximum) throw new Error('WebDAV 加密载荷超过安全上限');
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

async function encryptionKey(
	secret: string,
	salt: Uint8Array<ArrayBuffer>,
	iterations: number,
	usage: KeyUsage,
): Promise<CryptoKey> {
	if (!secret) throw new Error('WebDAV 应用密码为空，无法加密翻译设置');
	const crypto = cryptoPort();
	const material = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		'PBKDF2',
		false,
		['deriveKey'],
	);
	return crypto.subtle.deriveKey(
		{
			name: 'PBKDF2',
			hash: 'SHA-256',
			salt: salt as Uint8Array<ArrayBuffer>,
			iterations,
		},
		material,
		{ name: 'AES-GCM', length: 256 },
		false,
		[usage],
	);
}

export async function encryptReaderWebDavSecret(
	value: unknown,
	secret: string,
	associatedData: string,
): Promise<ReaderWebDavEncryptedSecret> {
	const crypto = cryptoPort();
	const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
	const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
	const key = await encryptionKey(secret, salt, PBKDF2_ITERATIONS, 'encrypt');
	const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
		{
			name: 'AES-GCM',
			iv,
			additionalData: new TextEncoder().encode(associatedData),
		},
		key,
		new TextEncoder().encode(JSON.stringify(value)),
	));
	if (ciphertext.length > MAX_CIPHERTEXT_BYTES) {
		throw new Error('翻译 API Key 加密后超过 WebDAV 安全上限');
	}
	return Object.freeze({
		format: READER_WEBDAV_SECRET_FORMAT,
		version: READER_WEBDAV_SECRET_VERSION,
		kdf: 'PBKDF2-SHA-256',
		iterations: PBKDF2_ITERATIONS,
		salt: base64Url(salt),
		cipher: 'AES-256-GCM',
		iv: base64Url(iv),
		ciphertext: base64Url(ciphertext),
	});
}

export async function decryptReaderWebDavSecret(
	value: unknown,
	secret: string,
	associatedData: string,
): Promise<unknown> {
	try {
		const source = record(value);
		if (
			source?.format !== READER_WEBDAV_SECRET_FORMAT ||
			source.version !== READER_WEBDAV_SECRET_VERSION ||
			source.kdf !== 'PBKDF2-SHA-256' ||
			source.cipher !== 'AES-256-GCM'
		) throw new Error('unsupported envelope');
		const iterations = Number(source.iterations);
		if (iterations < 100_000 || iterations > 1_000_000) {
			throw new Error('invalid iterations');
		}
		const salt = fromBase64Url(source.salt, SALT_BYTES);
		const iv = fromBase64Url(source.iv, IV_BYTES);
		if (salt.length !== SALT_BYTES || iv.length !== IV_BYTES) {
			throw new Error('invalid nonce');
		}
		const ciphertext = fromBase64Url(
			source.ciphertext,
			MAX_CIPHERTEXT_BYTES,
		);
		const key = await encryptionKey(secret, salt, iterations, 'decrypt');
		const plaintext = await cryptoPort().subtle.decrypt(
			{
				name: 'AES-GCM',
				iv,
				additionalData: new TextEncoder().encode(associatedData),
			},
			key,
			ciphertext,
		);
		return JSON.parse(new TextDecoder().decode(plaintext)) as unknown;
	} catch {
		throw new Error(
			'WebDAV 翻译 API Key 解密失败；请确认应用密码与加密时一致',
		);
	}
}
