import {
	sharedCacheIdToken,
} from '../src/cache/cache-identity.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

assert(sharedCacheIdToken('id:42') === 'r5ykwk', 'FNV token 与 main.js 不兼容');
