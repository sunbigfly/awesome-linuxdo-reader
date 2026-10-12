import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../extension/background.js', import.meta.url), 'utf8');
const manifest = JSON.parse(await readFile(
	new URL('../manifest.json', import.meta.url),
	'utf8',
));
const userscriptMetadata = await readFile(
	new URL('../lite/userscript.meta.txt', import.meta.url),
	'utf8',
);
assert(manifest.permissions.includes('scripting'));
assert.deepEqual(manifest.optional_host_permissions, ['https://*/*']);
const liteContentScript = manifest.content_scripts.find((entry) =>
	entry.js?.includes('extension/lite-userscript-compat.js') &&
	entry.js?.includes('work/main-lite.standalone.user.js'));
assert(liteContentScript);
const userscriptMatches = [...userscriptMetadata.matchAll(/^\/\/\s+@match\s+(\S+)$/gm)]
	.map((match) => match[1])
	.sort();
assert.deepEqual([...liteContentScript.matches].sort(), userscriptMatches);
const storage = new Map();
const permissions = new Set();
const registered = new Map();
const requestedOrigins = [];
let messageListener = null;

const event = (capture) => ({ addListener: capture });
const chrome = {
  runtime: {
    id: 'test-extension',
    onInstalled: event(() => {}),
    onStartup: event(() => {}),
    onMessage: event((listener) => {
      messageListener = listener;
    }),
  },
  permissions: {
    async contains({ origins }) {
      return origins.every((origin) => permissions.has(origin));
    },
    async request({ origins }) {
      requestedOrigins.push(...origins);
      origins.forEach((origin) => permissions.add(origin));
      return true;
    },
    async remove({ origins }) {
      origins.forEach((origin) => permissions.delete(origin));
      return true;
    },
  },
  scripting: {
    async getRegisteredContentScripts({ ids }) {
      return ids.map((id) => registered.get(id)).filter(Boolean);
    },
    async registerContentScripts(scripts) {
      scripts.forEach((script) => registered.set(script.id, script));
    },
    async updateContentScripts(scripts) {
      scripts.forEach((script) => registered.set(script.id, script));
    },
    async unregisterContentScripts({ ids }) {
      ids.forEach((id) => registered.delete(id));
    },
  },
  storage: {
    local: {
      async get(key) {
        return { [key]: storage.get(key) };
      },
      async set(values) {
        Object.entries(values).forEach(([key, value]) => storage.set(key, value));
      },
    },
    session: {
      async get() { return {}; },
      async set() {},
      async remove() {},
    },
  },
  sidePanel: {
    onClosed: null,
    async setOptions() {},
    async open() {},
  },
  tabs: {
    onRemoved: event(() => {}),
    async sendMessage() {},
  },
};

vm.runInNewContext(source, {
  AbortController,
  URL,
  chrome,
  console,
  fetch,
  setTimeout,
  clearTimeout,
});
assert.equal(typeof messageListener, 'function');

function message(value) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('扩展消息测试超时')), 1_000);
    const keepAlive = messageListener(value, { tab: { id: 1 } }, (response) => {
      clearTimeout(timeout);
      resolve(response);
    });
    assert.equal(keepAlive, true);
  });
}

const added = await message({
  type: 'ldp-site-access-request',
  host: 'Forum.GitLab.com',
});
assert.equal(JSON.stringify(added), JSON.stringify({
  ok: true,
  pattern: 'https://forum.gitlab.com/*',
}));
assert.deepEqual(requestedOrigins, ['https://forum.gitlab.com/*']);
assert.equal(registered.size, 1);
const [registration] = registered.values();
assert.equal(JSON.stringify(registration.matches), JSON.stringify([
  'https://forum.gitlab.com/*',
]));
assert.equal(JSON.stringify(registration.js), JSON.stringify([
  'extension/lite-userscript-compat.js',
  'work/main-lite.standalone.user.js',
]));
assert.equal(registration.persistAcrossSessions, true);

const removed = await message({
  type: 'ldp-site-access-remove',
  host: 'forum.gitlab.com',
});
assert.equal(JSON.stringify(removed), JSON.stringify({ ok: true }));
assert.equal(registered.size, 0);
assert.equal(permissions.has('https://forum.gitlab.com/*'), false);

const rejected = await message({
  type: 'ldp-site-access-request',
  host: 'http://unsafe.example',
});
assert.equal(JSON.stringify(rejected), JSON.stringify({
  ok: false,
  reason: 'invalid-host',
}));

// 端到端桥接断言：compat shim 暴露的全局名必须与 Lite 运行时读取的名字一致，
// 否则设置面板会静默回退到“手动添加用户匹配”，扩展授权流程整体失效。
const shimSource = await readFile(
  new URL('../extension/lite-userscript-compat.js', import.meta.url),
  'utf8',
);
const shimPublishedNames = [...shimSource.matchAll(
  /^\s*(__LDP_EXTENSION_SITE_ACCESS__|readerExtensionSiteAccess)\s*:/gm,
)].map((match) => match[1]);
assert.deepEqual(
  shimPublishedNames,
  ['__LDP_EXTENSION_SITE_ACCESS__'],
  'compat shim 必须发布站点权限桥接全局',
);
const environmentSource = await readFile(
  new URL('../lite/src/userscript/browser-userscript-environment.ts', import.meta.url),
  'utf8',
);
for (const name of shimPublishedNames) {
  assert(
    environmentSource.includes(`this.#userscriptGlobal.${name}`),
    `Lite 运行时必须读取 compat shim 发布的 ${name}`,
  );
}
const builderSource = await readFile(
  new URL('./build-main-lite.mjs', import.meta.url),
  'utf8',
);
assert(
  builderSource.includes('readerExtensionSiteAccess: globalThis.__LDP_EXTENSION_SITE_ACCESS__'),
  'standalone 产物必须把 shim 桥接转接到运行时读取的名字',
);

process.stdout.write('extension site access tests passed\n');
