import { parseHTML } from 'linkedom';
import {
	installReaderImageSourceFallback,
	installReaderSiteLogoFallback,
	replaceImageWithFallbackOnError,
} from '../src/components/reader-image-fallback.js';

function assert(condition: unknown, message: string): asserts condition {
	if (!condition) throw new Error(message);
}

const { document: parsedDocument, window: parsedWindow } = parseHTML(
	'<!doctype html><html><body><span id="host"></span></body></html>',
);
const document = parsedDocument as unknown as Document;
const host = document.querySelector<HTMLElement>('#host')!;
const image = document.createElement('img');
replaceImageWithFallbackOnError(image, () => {
	const fallback = document.createElement('span');
	fallback.className = 'semantic-avatar-fallback';
	fallback.textContent = 'A';
	return fallback;
});
host.append(image);
image.dispatchEvent(new parsedWindow.Event('error'));
assert(
	host.querySelector('img') === null &&
	host.querySelector('.semantic-avatar-fallback')?.textContent === 'A',
	'共享图片失败链必须原位替换为调用方语义回退',
);

const recoveryHost = document.createElement('span');
const recoveryImage = document.createElement('img');
let recoverySignal: AbortSignal | undefined;
installReaderImageSourceFallback(
	recoveryImage,
	['https://linux.do/avatar/recovery.png'],
	() => document.createElement('span'),
	(_source, signal) => {
		recoverySignal = signal;
		return new Promise<string>((_resolve, reject) => {
			signal?.addEventListener('abort', () => reject(signal.reason), {
				once: true,
			});
		});
	},
	'https://linux.do/avatar/visible.png',
);
recoveryHost.append(recoveryImage);
document.body.append(recoveryHost);
await Promise.resolve();
recoveryHost.remove();
await Promise.resolve();
await Promise.resolve();
assert(
	recoverySignal?.aborted === true,
	'头像宿主离开 Document 或 ShadowRoot 后必须取消该 DOM 的恢复消费者，不能由在途请求继续保留 detached DOM',
);

const siteLogo = document.createElement('img');
installReaderSiteLogoFallback(
	siteLogo,
	'https://cdn.example.com/missing-logo.png',
);
host.append(siteLogo);
siteLogo.dispatchEvent(new parsedWindow.Event('error'));
assert(
	siteLogo.src === 'https://cdn.example.com/favicon.ico',
	'站点 Logo 主候选失败后必须先尝试同源 favicon',
);
siteLogo.dispatchEvent(new parsedWindow.Event('error'));
assert(
	siteLogo.src.startsWith('data:image/svg+xml,'),
	'站点 favicon 仍失败时必须使用内联占位图，不能留下坏图',
);
