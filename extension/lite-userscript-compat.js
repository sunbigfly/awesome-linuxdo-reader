(() => {
  'use strict';

  const valueListeners = new Map();
  let nextValueListenerId = 0;

  function runtimeMessage(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else resolve(response);
      });
    });
  }

  async function getValue(key, fallback = null) {
    const normalizedKey = String(key);
    const values = await chrome.storage.local.get(normalizedKey);
    return Object.prototype.hasOwnProperty.call(values, normalizedKey)
      ? values[normalizedKey]
      : fallback;
  }

  function setValue(key, value) {
    return chrome.storage.local.set({ [String(key)]: value });
  }

  function addValueChangeListener(key, listener) {
    const id = ++nextValueListenerId;
    valueListeners.set(id, { key: String(key), listener });
    return id;
  }

  function removeValueChangeListener(id) {
    valueListeners.delete(Number(id));
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    for (const { key, listener } of valueListeners.values()) {
      const change = changes[key];
      if (!change) continue;
      try {
        listener(key, change.oldValue, change.newValue, true);
      } catch (error) {
        console.error('[Awesome LinuxDo Reader] 扩展存储监听器执行失败', error);
      }
    }
  });

  function xmlHttpRequest(options) {
    const id = crypto.randomUUID();
    let active = true;
    void runtimeMessage({
      type: 'ldp-http-request',
      id,
      request: {
        method: options.method,
        url: options.url,
        headers: options.headers,
        data: typeof options.data === 'string' ? options.data : undefined,
        anonymous: options.anonymous === true,
        withCredentials: options.withCredentials === true,
        responseType: options.responseType,
        timeout: options.timeout,
      },
    }).then((result) => {
      if (!active) return;
      if (!result?.ok) {
        if (result?.reason === 'timeout') options.ontimeout?.();
        else if (result?.reason === 'aborted') options.onabort?.();
        else options.onerror?.(result);
        return;
      }
      options.onload?.(result.response);
    }).catch((error) => {
      if (active) options.onerror?.({ error: error.message });
    });
    return {
      abort() {
        if (!active) return;
        active = false;
        void runtimeMessage({ type: 'ldp-http-abort', id }).catch(() => {});
        options.onabort?.();
      },
    };
  }

  function addElement(tagName, attributes = {}) {
    const node = document.createElement(String(tagName));
    for (const [name, value] of Object.entries(attributes)) {
      if (value !== undefined && value !== null) {
        node.setAttribute(name, String(value));
      }
    }
    (document.head ?? document.documentElement).append(node);
    return node;
  }

  const siteAccess = Object.freeze({
    async request(host) {
      const response = await runtimeMessage({
        type: 'ldp-site-access-request',
        host: String(host),
      });
      if (response?.ok) return true;
      if (response?.reason === 'permission-denied') return false;
      throw new Error(response?.reason || '浏览器站点权限申请失败');
    },
    async remove(host) {
      const response = await runtimeMessage({
        type: 'ldp-site-access-remove',
        host: String(host),
      });
      if (!response?.ok) {
        throw new Error(response?.reason || '浏览器站点权限移除失败');
      }
    },
  });

  const info = Object.freeze({
    script: Object.freeze({ version: chrome.runtime.getManifest().version }),
    scriptHandler: 'Chrome Extension',
    version: chrome.runtime.getManifest().version,
  });
  const modern = Object.freeze({
    getValue,
    setValue,
    addValueChangeListener,
    removeValueChangeListener,
    xmlHttpRequest,
    addElement,
    info,
  });

  Object.assign(globalThis, {
    unsafeWindow: globalThis,
    GM: modern,
    GM_info: info,
    GM_getValue: getValue,
    GM_setValue: setValue,
    GM_addValueChangeListener: addValueChangeListener,
    GM_removeValueChangeListener: removeValueChangeListener,
    GM_xmlhttpRequest: xmlHttpRequest,
    GM_addElement: addElement,
    __LDP_EXTENSION_SITE_ACCESS__: siteAccess,
  });
})();
