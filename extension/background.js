const SIDE_PANEL_PATH = 'extension/sidepanel.html';
const contextKey = (tabId) => `ldp-sidepanel-context:${tabId}`;
const CUSTOM_SITE_STORAGE_KEY = 'ldp-extension-custom-sites:v1';
const CUSTOM_SCRIPT_PREFIX = 'ldp-custom-site-';
const pendingRequests = new Map();

function normalizeCustomSiteHost(value) {
  const source = String(value || '').trim();
  if (!source) return '';
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(source)
      ? source
      : `https://${source}`);
    return url.protocol === 'https:' && !url.username && !url.password &&
      url.port === ''
      ? url.hostname.toLowerCase()
      : '';
  } catch {
    return '';
  }
}

function customSitePattern(host) {
  return `https://${host}/*`;
}

function customSiteScriptId(host) {
  let hash = 2166136261;
  for (const character of host) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `${CUSTOM_SCRIPT_PREFIX}${(hash >>> 0).toString(16)}`;
}

async function storedCustomSites() {
  const stored = await chrome.storage.local.get(CUSTOM_SITE_STORAGE_KEY);
  const values = stored[CUSTOM_SITE_STORAGE_KEY];
  return Array.isArray(values)
    ? [...new Set(values.map(normalizeCustomSiteHost).filter(Boolean))].sort()
    : [];
}

async function persistCustomSites(sites) {
  await chrome.storage.local.set({
    [CUSTOM_SITE_STORAGE_KEY]: [...new Set(sites)].sort(),
  });
}

async function registerCustomSite(host) {
  const pattern = customSitePattern(host);
  if (!await chrome.permissions.contains({ origins: [pattern] })) {
    throw new Error('permission-denied');
  }
  const id = customSiteScriptId(host);
  const descriptor = {
    id,
    matches: [pattern],
    js: [
      'extension/lite-userscript-compat.js',
      'work/main-lite.standalone.user.js',
    ],
    runAt: 'document_start',
    persistAcrossSessions: true,
    allFrames: false,
  };
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) await chrome.scripting.updateContentScripts([descriptor]);
  else await chrome.scripting.registerContentScripts([descriptor]);
  const sites = await storedCustomSites();
  if (!sites.includes(host)) await persistCustomSites([...sites, host]);
}

async function removeCustomSite(host) {
  const id = customSiteScriptId(host);
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
  if (existing.length) await chrome.scripting.unregisterContentScripts({ ids: [id] });
  const pattern = customSitePattern(host);
  if (await chrome.permissions.contains({ origins: [pattern] })) {
    await chrome.permissions.remove({ origins: [pattern] });
  }
  await persistCustomSites((await storedCustomSites()).filter((site) => site !== host));
}

async function reconcileCustomSites() {
  for (const host of await storedCustomSites()) {
    const pattern = customSitePattern(host);
    if (await chrome.permissions.contains({ origins: [pattern] })) {
      await registerCustomSite(host);
    } else {
      const id = customSiteScriptId(host);
      const existing = await chrome.scripting.getRegisteredContentScripts({ ids: [id] });
      if (existing.length) {
        await chrome.scripting.unregisterContentScripts({ ids: [id] });
      }
    }
  }
}

async function externalRequest(message) {
  const request = message.request;
  const url = new URL(String(request?.url || ''));
  if (url.protocol !== 'https:') throw new Error('仅允许 HTTPS 请求');
  const method = String(request?.method || 'GET').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'PROPFIND'].includes(method)) {
    throw new Error('不支持的请求方法');
  }
  const controller = new AbortController();
  pendingRequests.set(String(message.id), controller);
  const timeoutMs = Math.max(1_000, Math.min(60_000, Number(request.timeout) || 15_000));
  const timeout = setTimeout(() => controller.abort('timeout'), timeoutMs);
  try {
    const response = await fetch(url.href, {
      method,
      headers: request.headers || {},
      body: ['GET', 'DELETE'].includes(method) ? undefined : request.data,
      credentials: request.anonymous === true || request.withCredentials !== true
        ? 'omit'
        : 'include',
      redirect: 'follow',
      signal: controller.signal,
    });
    const responseText = await response.text();
    let body = responseText;
    if (request.responseType === 'json') {
      try {
        body = responseText ? JSON.parse(responseText) : null;
      } catch {
        body = null;
      }
    }
    return {
      ok: true,
      response: {
        status: response.status,
        statusText: response.statusText,
        response: body,
        responseText,
        responseHeaders: [...response.headers.entries()]
          .map(([name, value]) => `${name}: ${value}`)
          .join('\r\n'),
        finalUrl: response.url,
      },
    };
  } catch (error) {
    if (controller.signal.aborted) {
      return {
        ok: false,
        reason: controller.signal.reason === 'timeout' ? 'timeout' : 'aborted',
      };
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    pendingRequests.delete(String(message.id));
  }
}

async function sendPanelState(tabId, active) {
  if (!Number.isInteger(tabId)) return;
  try {
    await chrome.tabs.sendMessage(tabId, { type: 'ldp-sidepanel-state', active });
  } catch (error) {
    // The content script may not be ready yet or the tab may already be gone.
  }
}

async function openPanelForTab(tabId, context) {
  const path = `${SIDE_PANEL_PATH}?tabId=${encodeURIComponent(tabId)}`;
  await chrome.storage.session.set({ [contextKey(tabId)]: context });
  await chrome.sidePanel.setOptions({ tabId, path, enabled: true });
  await chrome.sidePanel.open({ tabId });
  await sendPanelState(tabId, true);
}

async function closePanelForTab(tabId) {
  if (!Number.isInteger(tabId)) return false;

  let closed = false;
  if (typeof chrome.sidePanel.close === 'function') {
    try {
      await chrome.sidePanel.close({ tabId });
      closed = true;
    } catch (error) {
      // Older Chrome builds can reject when this tab has no tab-scoped panel open.
    }
  }

  try {
    await chrome.sidePanel.setOptions({ tabId, enabled: false });
    closed = true;
  } catch (error) {
    // Keep the cleanup below so stale context cannot reopen this panel accidentally.
  }

  await chrome.storage.session.remove(contextKey(tabId));
  await sendPanelState(tabId, false);
  return closed;
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});
  reconcileCustomSites().catch((error) => {
    console.error('[Awesome LinuxDo Reader] 自定义站点注册恢复失败', error);
  });
});

chrome.runtime.onStartup.addListener(() => {
  reconcileCustomSites().catch((error) => {
    console.error('[Awesome LinuxDo Reader] 自定义站点注册恢复失败', error);
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const respond = async () => {
    if (!message || typeof message.type !== 'string') return { ok: false, reason: 'invalid-message' };

    if (message.type === 'ldp-site-access-request') {
      const host = normalizeCustomSiteHost(message.host);
      if (!host) return { ok: false, reason: 'invalid-host' };
      const pattern = customSitePattern(host);
      const granted = await chrome.permissions.request({ origins: [pattern] });
      if (!granted) return { ok: false, reason: 'permission-denied' };
      try {
        await registerCustomSite(host);
      } catch (error) {
        await chrome.permissions.remove({ origins: [pattern] });
        throw error;
      }
      return { ok: true, pattern };
    }

    if (message.type === 'ldp-site-access-remove') {
      const host = normalizeCustomSiteHost(message.host);
      if (!host) return { ok: false, reason: 'invalid-host' };
      await removeCustomSite(host);
      return { ok: true };
    }

    if (message.type === 'ldp-http-request') {
      return externalRequest(message);
    }

    if (message.type === 'ldp-http-abort') {
      pendingRequests.get(String(message.id))?.abort('aborted');
      return { ok: true };
    }

    if (message.type === 'ldp-sidepanel-open') {
      const tabId = sender.tab?.id;
      const topicId = Number(message.topicId) || 0;
      if (!Number.isInteger(tabId) || !topicId) return { ok: false, reason: 'missing-tab-or-topic' };
      const baseUrl = String(message.baseUrl || 'https://linux.do').replace(/\/+$/, '');
      if (baseUrl !== 'https://linux.do') return { ok: false, reason: 'unsupported-origin' };
      await openPanelForTab(tabId, {
        topicId,
        targetPostNumber: Number(message.targetPostNumber) || 0,
        baseUrl,
      });
      return { ok: true };
    }

    if (message.type === 'ldp-sidepanel-close') {
      return { ok: await closePanelForTab(sender.tab?.id) };
    }

    if (message.type === 'ldp-sidepanel-context') {
      const tabId = Number(message.tabId);
      if (!Number.isInteger(tabId)) return { ok: false, reason: 'missing-tab' };
      const stored = await chrome.storage.session.get(contextKey(tabId));
      return { ok: true, context: stored[contextKey(tabId)] || null };
    }

    return { ok: false, reason: 'unsupported-message' };
  };

  respond().then(sendResponse).catch((error) => {
    sendResponse({ ok: false, reason: error?.message || 'sidepanel-operation-failed' });
  });
  return true;
});

if (chrome.sidePanel.onClosed) {
  chrome.sidePanel.onClosed.addListener(({ tabId }) => {
    if (!Number.isInteger(tabId)) return;
    chrome.storage.session.remove(contextKey(tabId)).catch(() => {});
    sendPanelState(tabId, false);
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(contextKey(tabId)).catch(() => {});
});
