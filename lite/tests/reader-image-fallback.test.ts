import { parseHTML } from 'linkedom';
import {
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
