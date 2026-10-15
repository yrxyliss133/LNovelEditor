
/* ============================================================
   全局搜索（书本内）
   模式：
     name —— 只命中文件名
     full —— 命中文件名 + 正文内容
   ============================================================ */

let searchMode = 'name';
let searchBookId = null;
let searchTimer = null;
let searchNodes = [];

/** 取节点的可搜索正文（按类型展开） */
function nodeSearchText(node) {
  switch (node.type) {
    case 'chapter':
    case 'outline':
      return node.content || '';
    case 'setting': {
      const parts = [];
      (node.categories || []).forEach((c) => {
        parts.push(c.name || '');
        parts.push(c.content || '');
      });
      return parts.join('\n');
    }
    case 'timeline': {
      const parts = [];
      (node.events || []).forEach((e) => {
        parts.push(e.time || '');
        parts.push(e.text || '');
      });
      return parts.join('\n');
    }
    default:
      return '';
  }
}

/** 转义正则特殊字符 */
function reEscape(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 高亮命中片段（HTML 已转义后再插标记） */
function highlight(text, query) {
  const safe = esc(text);
  if (!query) return safe;
  const re = new RegExp('(' + reEscape(esc(query)) + ')', 'gi');
  return safe.replace(re, '<span class="hit">$1</span>');
}

/** 节点类型中文名 */
function shortTypeLabel(node) {
  return typeLabel(node);
}

/** 计算某节点在树中的路径，如「第一卷 / 第一章组」 */
function nodePath(node, all) {
  const parts = [];
  let cur = node;
  const guard = new Set();
  while (cur && cur.parentId && !guard.has(cur.parentId)) {
    guard.add(cur.parentId);
    const p = all.find((n) => n.id === cur.parentId);
    if (!p) break;
    parts.unshift(p.title);
    cur = p;
  }
  return parts.length ? parts.join(' / ') : '根目录';
}

/** 截取命中附近的文本片段 */
function makeSnippet(text, query, radius) {
  const t = String(text || '');
  const q = String(query || '');
  if (!t) return '';
  const lower = t.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  const r = radius || 42;
  if (idx < 0) return t.slice(0, r * 2);
  const start = Math.max(0, idx - r);
  const end = Math.min(t.length, idx + q.length + r);
  return (start > 0 ? '…' : '') + t.slice(start, end).replace(/\s+/g, ' ') + (end < t.length ? '…' : '');
}

/* ---------------- 打开 / 关闭 ---------------- */

async function openSearch() {
  searchBookId = state.bookId;
  if (!searchBookId) return;
  searchNodes = await Nodes.byBook(searchBookId);
  const book = await Books.get(searchBookId);
  $('search-input').placeholder = `在《${book ? book.title : ''}》中搜索…`;
  showView('search');
  setTimeout(() => $('search-input').focus(), 160);
  renderSearchResults();
}

function closeSearch() {
  $('search-input').value = '';
  $('search-status').textContent = '';
  showView('chapters');
  renderChapters();
}

function setSearchMode(mode) {
  searchMode = mode;
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  renderSearchResults();
  $('search-input').focus();
}

/* ---------------- 匹配 ---------------- */

/** 对单个节点做匹配，返回 { node, nameHit, textHit, snippet } 或 null */
function matchNode(node, query) {
  const nameHit = (node.title || '').toLowerCase().includes(query);
  if (searchMode === 'name') {
    return nameHit ? { node, nameHit: true, textHit: false, snippet: '' } : null;
  }
  // 全文模式
  const text = nodeSearchText(node);
  const textHit = text.toLowerCase().includes(query);
  if (!nameHit && !textHit) return null;
  return {
    node,
    nameHit,
    textHit,
    snippet: textHit ? makeSnippet(text, query) : ''
  };
}

/** 排序：文件名命中优先，其次类型权重，再按更新时间 */
function resultWeight(r) {
  let w = 0;
  if (r.nameHit) w -= 100;
  if (r.node.type === 'folder') w -= 20;
  if (r.node.type === 'chapter') w -= 10;
  return w;
}

/* ---------------- 渲染 ---------------- */

function renderSearchResults() {
  const raw = $('search-input').value || '';
  const query = raw.trim().toLowerCase();
  const list = $('search-results');
  const status = $('search-status');
  list.innerHTML = '';

  $('btn-clear-search').hidden = !raw;

  if (!query) {
    status.textContent = '';
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.innerHTML = `<span class="se-icon">🔍</span>
      ${searchMode === 'name'
        ? '输入关键词，搜索文件夹与各类文件名'
        : '输入关键词，搜索文件名与正文内容'}<br>
      <span style="font-size:12px;opacity:.75">当前模式：${searchMode === 'name' ? '文件名搜索' : '全文搜索'}</span>`;
    list.appendChild(empty);
    return;
  }

  const results = [];
  for (const node of searchNodes) {
    const r = matchNode(node, query);
    if (r) results.push(r);
  }
  results.sort((a, b) => {
    const d = resultWeight(a) - resultWeight(b);
    return d !== 0 ? d : (b.node.updatedAt || 0) - (a.node.updatedAt || 0);
  });

  status.textContent = results.length
    ? `找到 ${results.length} 项 · ${searchMode === 'name' ? '文件名搜索' : '全文搜索'}`
    : '';

  if (!results.length) {
    const empty = document.createElement('div');
    empty.className = 'search-empty';
    empty.innerHTML = `<span class="se-icon">✿</span>
      没有找到「${esc(raw.trim())}」<br>
      <span style="font-size:12px;opacity:.75">${searchMode === 'name'
        ? '试试切换到「全文搜索」，连正文一起找'
        : '换个关键词试试'}</span>`;
    list.appendChild(empty);
    return;
  }

  results.forEach((r, i) => {
    const node = r.node;
    const row = document.createElement('div');
    row.className = 'sr-row';
    row.style.animationDelay = Math.min(i * 28, 300) + 'ms';

    const path = nodePath(node, searchNodes);
    let tail = '';
    if (node.type === 'folder') {
      const st = Nodes.folderWordCount(node.id, searchNodes);
      const bits = [];
      if (st.chapters) bits.push(`${st.chapters} 章`);
      if (st.settings) bits.push(`${st.settings} 设定`);
      if (st.others) bits.push(`${st.others} 资料`);
      tail = bits.length ? bits.join(' · ') : '空';
    } else if (node.type === 'timeline') {
      tail = `${(node.events || []).length} 事件`;
    } else {
      tail = `${node.wordCount || 0} 字`;
    }

    // 名字命中高亮
    const nameHtml = r.nameHit ? highlight(node.title, raw.trim()) : esc(node.title);

    // 全文模式下正文命中的片段
    let snippetHtml = '';
    if (searchMode === 'full' && r.textHit && r.snippet) {
      snippetHtml = `<div class="sr-snippet">${highlight(r.snippet, raw.trim())}</div>`;
    }

    const badge = (searchMode === 'full' && r.textHit && !r.nameHit)
      ? '<span class="sr-badge">正文命中</span>'
      : (searchMode === 'full' && r.nameHit ? '<span class="sr-badge name-only">文件名命中</span>' : '');

    row.innerHTML = `
      <span class="sr-icon">${nodeIcon(node)}</span>
      <span class="sr-main">
        <span class="sr-name">${nameHtml}</span>
        <span class="sr-path">${esc(shortTypeLabel(node))} · ${esc(path)}</span>
        ${snippetHtml}
        ${badge}
      </span>
      <span class="sr-tail">${esc(tail)}</span>`;

    row.addEventListener('click', () => openSearchResult(node));
    list.appendChild(row);
  });
}

/** 点击结果：章节/大纲/设定打开编辑器；文件夹进入该目录 */
async function openSearchResult(node) {
  if (node.type === 'folder') {
    state.folderId = node.id;
    $('search-input').value = '';
    showView('chapters');
    await renderChapters();
    return;
  }
  $('search-input').value = '';
  showView('chapters');   // 先回章节视图，编辑器/时间线会再切
  if (node.type === 'timeline') {
    await openTimeline(node.id);
  } else if (node.type === 'setting') {
    await openSetting(node.id);
  } else {
    await openChapter(node.id);
  }
}

/* ---------------- 事件绑定 ---------------- */

$('search-input').addEventListener('input', () => {
  $('btn-clear-search').hidden = !$('search-input').value;
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderSearchResults, 180);
});

$('search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    clearTimeout(searchTimer);
    renderSearchResults();
    const first = document.querySelector('.sr-row');
    if (first) first.click();
  }
});

$('mode-name').addEventListener('click', () => { vibrate(); setSearchMode('name'); });
$('mode-full').addEventListener('click', () => { vibrate(); setSearchMode('full'); });

$('btn-clear-search').addEventListener('click', () => {
  $('search-input').value = '';
  $('btn-clear-search').hidden = true;
  renderSearchResults();
  $('search-input').focus();
});

$('btn-back-search').addEventListener('click', () => { vibrate(); closeSearch(); });
