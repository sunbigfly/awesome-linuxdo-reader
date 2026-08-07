export function sharedCacheIdToken(value: string): string {
	const source = String(value);
	let hash = 2_166_136_261;
	for (let index = 0; index < source.length; index += 1) {
		hash ^= source.charCodeAt(index);
		hash = Math.imul(hash, 16_777_619);
	}
	return (hash >>> 0).toString(36);
}
