import {
	createPreferencesStorageSyncStage,
} from '../src/app/reader-application-stages.js';
import { LifecycleScope } from '../src/kernel/lifecycle.js';
import { Signal } from '../src/kernel/signal.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

class FakeWindow extends EventTarget {}

function applicationContext<TPreferences extends object>(
	preferences: Readonly<TPreferences>,
) {
	return {
		preferences,
		readPreferences: () => preferences,
		preferenceChanges: new Signal<Readonly<TPreferences>>(),
		host: { detection: 'native-module' as const },
	};
}

function storageEvent(
	key: string | null,
	oldValue: string | null,
	newValue: string | null,
): Event {
	const event = new Event('storage');
	Object.defineProperties(event, {
		key: { value: key },
		oldValue: { value: oldValue },
		newValue: { value: newValue },
	});
	return event;
}

const windowPort = new FakeWindow() as unknown as Window;
let reloads = 0;
const storageStage = createPreferencesStorageSyncStage({
	key: 'prefs',
	window: windowPort,
	repository: {
		reloadExternal: () => ({
			value: Object.freeze({ enabled: true }),
			revision: ++reloads,
			source: 'external-reload',
		}),
	},
});
const storageScope = new LifecycleScope();
storageStage.setup(
	storageScope,
	applicationContext(Object.freeze({ enabled: true })),
);
windowPort.dispatchEvent(storageEvent('other', null, '1'));
windowPort.dispatchEvent(storageEvent('prefs', '1', '2'));
assert(reloads === 1, 'storage stage 只能响应同一偏好 key 的实际变化');
windowPort.dispatchEvent(storageEvent('', null, null));
assert(reloads === 1, '空字符串 key 不是 localStorage.clear');
windowPort.dispatchEvent(storageEvent(null, null, null));
assert(Number(reloads) === 2, 'localStorage.clear 必须重新加载 defaults');
storageScope.destroy();
windowPort.dispatchEvent(storageEvent('prefs', '2', '3'));
assert(Number(reloads) === 2, 'storage stage 必须随 application scope 解绑');
