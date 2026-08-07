import type { PreferencesSnapshot } from '../state/preferences-repository.js';
import type { LifecycleScope } from '../kernel/lifecycle.js';
import type {
	ReaderApplicationStage,
} from './reader-application.js';

export interface PreferencesReloadPort<TPreferences extends object> {
	reloadExternal(): PreferencesSnapshot<TPreferences>;
}

export function createPreferencesStorageSyncStage<TPreferences extends object>(
	options: {
		readonly key: string;
		readonly window?: Window;
		readonly repository: PreferencesReloadPort<TPreferences>;
		readonly onError?: (cause: unknown) => void;
	},
): ReaderApplicationStage<TPreferences> {
	const key = String(options.key).trim();
	if (!key) throw new Error('preferences storage key 不能为空');
	const windowPort = options.window ?? window;
	return Object.freeze({
		name: 'preferences-storage-sync',
		required: false,
		setup: (scope: LifecycleScope) => {
			scope.listen(windowPort, 'storage', (rawEvent: Event) => {
				const event = rawEvent as StorageEvent;
				if (
					(event.key !== key && event.key !== null) ||
					(event.key === key && event.oldValue === event.newValue)
				) return;
				try {
					options.repository.reloadExternal();
				} catch (cause) {
					options.onError?.(cause);
				}
			});
		},
	});
}
