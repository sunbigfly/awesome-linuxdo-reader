const app = document.querySelector('#app');
const panelParams = new URL(location.href).searchParams;
const tabId = Number(panelParams.get('tabId')) || 0;
const POST_BATCH_SIZE = 30;
const contextStorageKey = `ldp-sidepanel-context:${tabId}`;
let currentContext = null;
let panelLoadInFlight = false;
let panelReloadQueued = false;

function escapeHtml(value) {
  return String(value ?? '').replace(/[<>&"']/g, (char) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;',
  }[char]));
}

function runtimeMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) resolve({ ok: false, reason: chrome.runtime.lastError.message });
      else resolve(response && typeof response === 'object' ? response : { ok: false, reason: 'empty-response' });
    });
  });
}

function absoluteUrl(value, baseUrl) {
  try { return new URL(value, baseUrl).href; }
  catch (error) { return ''; }
}

function safeCookedHtml(value, baseUrl) {
  const template = document.createElement('template');
  const allowedTags = new Set([
    'A', 'B', 'BLOCKQUOTE', 'BR', 'CODE', 'DEL', 'DETAILS', 'DIV', 'EM', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
    'HR', 'I', 'IMG', 'LI', 'OL', 'P', 'PRE', 'S', 'SMALL', 'SPAN', 'STRONG', 'SUB', 'SUMMARY', 'SUP',
    'TABLE', 'TBODY', 'TD', 'TH', 'THEAD', 'TR', 'U', 'UL',
  ]);
  const globalAttributes = new Set(['class', 'title']);
  template.innerHTML = String(value || '');
  template.content.querySelectorAll('script,style,link,iframe,object,embed,form,meta,base,svg,math').forEach((node) => node.remove());
  template.content.querySelectorAll('*').forEach((node) => {
    if (!allowedTags.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      return;
    }
    Array.from(node.attributes).forEach((attribute) => {
      const name = attribute.name.toLowerCase();
      const allowed = globalAttributes.has(name) ||
        (node.tagName === 'A' && name === 'href') ||
        (node.tagName === 'IMG' && ['src', 'alt', 'width', 'height'].includes(name)) ||
        (['TD', 'TH'].includes(node.tagName) && ['colspan', 'rowspan'].includes(name));
      if (!allowed) {
        node.removeAttribute(attribute.name);
        return;
      }
      if (name !== 'href' && name !== 'src') return;
      const url = absoluteUrl(attribute.value, baseUrl);
      if (!/^https?:/i.test(url) && !(name === 'href' && /^mailto:/i.test(url))) {
        node.removeAttribute(attribute.name);
        return;
      }
      node.setAttribute(attribute.name, url);
    });
    if (node.tagName === 'A') {
      node.target = '_blank';
      node.rel = 'noopener noreferrer';
    }
  });
  return template.innerHTML;
}

function formatTime(value) {
  const date = new Date(value || 0);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function topicUrl(topic) {
  const slug = encodeURIComponent(topic.slug || 'topic');
  return `${currentContext.baseUrl}/t/${slug}/${topic.id}`;
}

function renderState(message, isError = false) {
  app.innerHTML = `<div class="panel-empty${isError ? ' panel-error' : ''}">${escapeHtml(message)}</div>`;
}

function finishPanelLoad() {
  panelLoadInFlight = false;
  if (!panelReloadQueued) return;
  panelReloadQueued = false;
  void loadPanel();
}

function requestPanelReload() {
  if (panelLoadInFlight) {
    panelReloadQueued = true;
    return;
  }
  void loadPanel();
}

function postStreamIds(topic) {
  const stream = topic?.post_stream?.stream;
  if (Array.isArray(stream) && stream.length) {
    return Array.from(new Set(stream.map((id) => String(id || '')).filter(Boolean)));
  }
  const posts = Array.isArray(topic?.post_stream?.posts) ? topic.post_stream.posts : [];
  return Array.from(new Set(posts.map((post) => String(post?.id || '')).filter(Boolean)));
}

function loadedPostIds(topic) {
  const posts = Array.isArray(topic?.post_stream?.posts) ? topic.post_stream.posts : [];
  return new Set(posts.map((post) => String(post?.id || '')).filter(Boolean));
}

function postLoadProgress(topic) {
  const streamIds = postStreamIds(topic);
  const loadedIds = loadedPostIds(topic);
  const total = streamIds.length;
  const loaded = total ? streamIds.filter((id) => loadedIds.has(id)).length : loadedIds.size;
  return {
    streamIds,
    loaded,
    total,
    missingIds: streamIds.filter((id) => !loadedIds.has(id)),
  };
}

function appendTopicPosts(topic, posts) {
  if (!topic.post_stream) topic.post_stream = {};
  const current = Array.isArray(topic.post_stream.posts) ? topic.post_stream.posts : [];
  const known = new Set(current.map((post) => String(post?.id || '')).filter(Boolean));
  const additions = (posts || []).filter((post) => {
    const id = String(post?.id || '');
    if (!id || known.has(id)) return false;
    known.add(id);
    return true;
  });
  if (additions.length) {
    topic.post_stream.posts = current.concat(additions).sort((left, right) =>
      Number(left?.post_number || 0) - Number(right?.post_number || 0));
  }
  return additions.length;
}

async function fetchPostBatch(postIds) {
  const query = postIds.map((id) => `post_ids[]=${encodeURIComponent(id)}`).join('&');
  const response = await fetch(`${currentContext.baseUrl}/t/${currentContext.topicId}/posts.json?${query}`, {
    credentials: 'include',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.post_stream?.posts) ? payload.post_stream.posts : [];
}

async function loadNextTopicPostBatch(topic) {
  const initial = postLoadProgress(topic);
  if (!initial.missingIds.length) return { complete: true, ...initial };
  const posts = await fetchPostBatch(initial.missingIds.slice(0, POST_BATCH_SIZE));
  if (!appendTopicPosts(topic, posts)) throw new Error('服务器没有返回所需楼层');
  const progress = postLoadProgress(topic);
  return { complete: !progress.missingIds.length, ...progress };
}

function renderTopic(topic, loadResult = {}) {
  const posts = Array.isArray(topic.post_stream?.posts) ? topic.post_stream.posts : [];
  const selectedPost = Number(currentContext.targetPostNumber) || 0;
  const progress = postLoadProgress(topic);
  const incomplete = progress.missingIds.length > 0;
  const targetPending = selectedPost > 0 && !posts.some((post) => Number(post.post_number) === selectedPost);
  const batchSize = Math.min(POST_BATCH_SIZE, progress.missingIds.length);
  const noticeText = loadResult.error
    ? `已加载 ${progress.loaded}/${progress.total} 楼。${loadResult.error}`
    : targetPending
      ? `目标 #${selectedPost} 尚未加载。已加载 ${progress.loaded}/${progress.total} 楼。`
      : `已加载 ${progress.loaded}/${progress.total} 楼。`;
  const continueLabel = loadResult.error ? '重试加载' : `加载下一批 ${batchSize} 楼`;
  document.title = `${topic.title || 'Linux DO 阅读器'} · Linux DO`;
  app.innerHTML = `<section class="panel-shell">
    <header class="panel-header">
      <div>
        <h1 class="panel-title">${escapeHtml(topic.title || '未命名主题')}</h1>
        <div class="panel-meta">${escapeHtml(`${topic.posts_count || posts.length} 帖 · ${topic.views || 0} 浏览`)}</div>
      </div>
      <div class="panel-actions">
        <button class="panel-button" type="button" data-action="refresh" title="刷新">刷新</button>
        <a class="panel-button" href="${escapeHtml(topicUrl(topic))}" target="_blank" rel="noopener noreferrer">原帖</a>
      </div>
    </header>
    <div class="panel-content">
      ${posts.map((post) => {
        const postUrl = `${topicUrl(topic)}/${Number(post.post_number) || 1}`;
        return `<article class="panel-post" data-post-number="${Number(post.post_number) || 0}">
          <header class="panel-post-head">
            <span class="panel-author">${escapeHtml(post.name || post.username || '未知用户')}</span>
            <time class="panel-date">${escapeHtml(formatTime(post.created_at))}</time>
            <a class="panel-number" href="${escapeHtml(postUrl)}" target="_blank" rel="noopener noreferrer">#${Number(post.post_number) || '?'}</a>
          </header>
          <div class="panel-cooked">${safeCookedHtml(post.cooked, currentContext.baseUrl)}</div>
        </article>`;
      }).join('') || '<div class="panel-empty">该主题暂时没有可显示的楼层。</div>'}
      ${incomplete ? `<div class="panel-load-notice">
        <span>${escapeHtml(noticeText)}</span>
        <button class="panel-button" type="button" data-action="continue">${escapeHtml(continueLabel)}</button>
      </div>` : ''}
    </div>
  </section>`;
  app.querySelector('[data-action="refresh"]')?.addEventListener('click', loadPanel);
  app.querySelector('[data-action="continue"]')?.addEventListener('click', () => loadRemainingPosts(topic));
  if (selectedPost > 0) {
    requestAnimationFrame(() => app.querySelector(`[data-post-number="${selectedPost}"]`)?.scrollIntoView({ block: 'start' }));
  }
}

async function loadRemainingPosts(topic) {
  if (panelLoadInFlight) return;
  panelLoadInFlight = true;
  app.querySelectorAll('[data-action="continue"]').forEach((button) => {
    button.disabled = true;
    button.textContent = '正在加载…';
  });
  try {
    const result = await loadNextTopicPostBatch(topic);
    renderTopic(topic, result);
  } catch (error) {
    renderTopic(topic, { complete: false, error: error?.message || '继续加载失败' });
  } finally {
    finishPanelLoad();
  }
}

async function loadPanel() {
  if (panelLoadInFlight) return;
  panelLoadInFlight = true;
  renderState('正在加载帖子…');
  const contextResult = await runtimeMessage({ type: 'ldp-sidepanel-context', tabId });
  if (!contextResult.ok || !contextResult.context?.topicId || !contextResult.context?.baseUrl) {
    renderState('未找到要在侧边栏打开的帖子。请从 Linux DO 列表重新打开阅读器。', true);
    finishPanelLoad();
    return;
  }
  currentContext = contextResult.context;
  try {
    const targetPostNumber = Number(currentContext.targetPostNumber) || 0;
    const targetQuery = targetPostNumber ? `?post_number=${encodeURIComponent(targetPostNumber)}` : '';
    const response = await fetch(`${currentContext.baseUrl}/t/${currentContext.topicId}.json${targetQuery}`, {
      credentials: 'include',
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const topic = await response.json();
    renderTopic(topic, { complete: !postLoadProgress(topic).missingIds.length });
  } catch (error) {
    renderState(`帖子加载失败：${error?.message || '未知错误'}`, true);
  } finally {
    finishPanelLoad();
  }
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'session' || !changes[contextStorageKey]?.newValue) return;
  requestPanelReload();
});

void loadPanel();
