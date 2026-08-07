export interface StoredZipEntry {
	readonly name: string;
	readonly bytes: Uint8Array;
}

export interface StoredZipOptions {
	readonly modifiedAt?: Date;
}

let crcTable: Uint32Array | null = null;

function table(): Uint32Array {
	if (crcTable) return crcTable;
	const values = new Uint32Array(256);
	for (let index = 0; index < values.length; index += 1) {
		let value = index;
		for (let bit = 0; bit < 8; bit += 1) {
			value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1;
		}
		values[index] = value >>> 0;
	}
	crcTable = values;
	return values;
}

export function storedZipCrc32(bytes: Uint8Array): number {
	const values = table();
	let crc = 0xffffffff;
	for (const byte of bytes) {
		crc = values[(crc ^ byte) & 0xff]! ^ crc >>> 8;
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(value: Date): Readonly<{ date: number; time: number }> {
	const year = Math.max(1980, Math.min(2107, value.getFullYear()));
	return Object.freeze({
		time: value.getHours() << 11 |
			value.getMinutes() << 5 |
			value.getSeconds() >> 1,
		date: year - 1980 << 9 |
			value.getMonth() + 1 << 5 |
			value.getDate(),
	});
}

function uint32(value: number, name: string): number {
	if (!Number.isSafeInteger(value) || value < 0 || value > 0xffffffff) {
		throw new RangeError(`${name} 超出 ZIP32 范围`);
	}
	return value;
}

/**
 * 零依赖 STORE-only ZIP32 构造器；单图与批量下载只维护这一份归档算法。
 */
export function createStoredZip(
	entries: readonly StoredZipEntry[],
	options: StoredZipOptions = {},
): Blob {
	if (!entries.length) throw new Error('ZIP 至少需要一个条目');
	if (entries.length > 0xffff) throw new RangeError('ZIP32 条目数不能超过 65535');
	const encoder = new TextEncoder();
	const localParts: BlobPart[] = [];
	const centralParts: BlobPart[] = [];
	const { date, time } = dosDateTime(options.modifiedAt ?? new Date());
	let localOffset = 0;
	let centralSize = 0;
	for (const entry of entries) {
		const name = encoder.encode(String(entry.name).trim());
		if (!name.length) throw new Error('ZIP 条目名不能为空');
		if (name.length > 0xffff) throw new RangeError('ZIP 条目名过长');
		const bytes = entry.bytes;
		const size = uint32(bytes.byteLength, 'ZIP 条目');
		const crc = storedZipCrc32(bytes);
		const local = new Uint8Array(30 + name.length);
		const localView = new DataView(local.buffer);
		localView.setUint32(0, 0x04034b50, true);
		localView.setUint16(4, 20, true);
		localView.setUint16(6, 0x0800, true);
		localView.setUint16(8, 0, true);
		localView.setUint16(10, time, true);
		localView.setUint16(12, date, true);
		localView.setUint32(14, crc, true);
		localView.setUint32(18, size, true);
		localView.setUint32(22, size, true);
		localView.setUint16(26, name.length, true);
		local.set(name, 30);
		const central = new Uint8Array(46 + name.length);
		const centralView = new DataView(central.buffer);
		centralView.setUint32(0, 0x02014b50, true);
		centralView.setUint16(4, 20, true);
		centralView.setUint16(6, 20, true);
		centralView.setUint16(8, 0x0800, true);
		centralView.setUint16(10, 0, true);
		centralView.setUint16(12, time, true);
		centralView.setUint16(14, date, true);
		centralView.setUint32(16, crc, true);
		centralView.setUint32(20, size, true);
		centralView.setUint32(24, size, true);
		centralView.setUint16(28, name.length, true);
		centralView.setUint32(42, uint32(localOffset, 'ZIP local offset'), true);
		central.set(name, 46);
		localParts.push(local, new Uint8Array(bytes));
		centralParts.push(central);
		localOffset = uint32(localOffset + local.length + size, 'ZIP local size');
		centralSize = uint32(centralSize + central.length, 'ZIP central size');
	}
	const end = new Uint8Array(22);
	const endView = new DataView(end.buffer);
	endView.setUint32(0, 0x06054b50, true);
	endView.setUint16(8, entries.length, true);
	endView.setUint16(10, entries.length, true);
	endView.setUint32(12, centralSize, true);
	endView.setUint32(16, localOffset, true);
	return new Blob([...localParts, ...centralParts, end], {
		type: 'application/zip',
	});
}
