/* ============================================================
   app.js — 薰衣草夜 · 小说编辑器
   ============================================================ */

const $ = (id) => document.getElementById(id);

const state = {
  bookId: null,          // 当前书本
  folderId: null,        // 当前所在文件夹（null = 根目录）
  chapterId: null,       // 当前编辑章节
  clipboard: null,       // 移动剪贴板 { id, type } —— 移动=复制+粘贴后删除
  nodesCache: []         // 当前书本全部节点缓存
};

/* ---------------- 工具 ---------------- */

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

let toastTimer = null;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 260);
  }, 1900);
}

function vibrate(ms) {
  if (navigator.vibrate) { try { navigator.vibrate(ms || 12); } catch (e) {} }
}

/* ---------------- 悬浮窗系统 ---------------- */

const Modal = {
  _onKey: null,

  /**
   * open({ title, desc, fields, actions })
   *  fields:  [{ key, label, type:'text'|'textarea', value, placeholder }]
   *  actions: [{ label, kind:'primary'|'danger'|'ghost', onClick(values, close) }]
   *  返回 close 回调
   */
  open(opts) {
    const ov = $('modal-overlay');
    const fieldsWrap = $('modal-fields');
    const actionsWrap = $('modal-actions');

    $('modal-title').textContent = opts.title || '';
    const descEl = $('modal-desc');
    if (opts.desc) { descEl.textContent = opts.desc; descEl.hidden = false; }
    else { descEl.textContent = ''; descEl.hidden = true; }

    fieldsWrap.innerHTML = '';
    const inputs = {};

    if (opts.choices && opts.choices.length) {
      const list = document.createElement('div');
      list.className = 'choice-list';
      opts.choices.forEach((c) => {
        const item = document.createElement('button');
        item.className = 'choice-item';
        item.type = 'button';
        item.innerHTML = `<span class="ci-icon">${c.icon || '✿'}</span>
          <span class="ci-text"><b>${esc(c.label)}</b>${c.hint ? `<span>${esc(c.hint)}</span>` : ''}</span>`;
        item.addEventListener('click', () => {
          vibrate();
          Modal.close();
          c.onClick();
        });
        list.appendChild(item);
      });
      fieldsWrap.appendChild(list);
    }

    (opts.fields || []).forEach((f) => {
      const wrap = document.createElement('div');
      wrap.className = 'field';

      // 自定义渲染：不生成 label/input，完全交给调用方
      if (f.type === 'custom' && typeof f.render === 'function') {
        wrap.classList.add('field-custom');
        fieldsWrap.appendChild(wrap);
        f.render(wrap);
        return;
      }

      const lab = document.createElement('label');
      lab.textContent = f.label || '';
      const inp = document.createElement(f.type === 'textarea' ? 'textarea' : 'input');
      if (f.type !== 'textarea') inp.type = 'text';
      inp.value = f.value != null ? f.value : '';
      inp.placeholder = f.placeholder || '';
      if (f.maxLength) inp.maxLength = f.maxLength;
      inp.autocomplete = 'off';
      inp.autocapitalize = 'off';
      inp.spellcheck = false;
      lab.setAttribute('for', '');
      wrap.appendChild(lab);
      wrap.appendChild(inp);
      fieldsWrap.appendChild(wrap);
      inputs[f.key] = inp;

      inp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && f.type !== 'textarea') {
          e.preventDefault();
          const primary = actionsWrap.querySelector('.btn.primary');
          if (primary) primary.click();
        }
      });
    });

    actionsWrap.innerHTML = '';
    (opts.actions || []).forEach((a) => {
      const btn = document.createElement('button');
      btn.className = 'btn ' + (a.kind || '');
      btn.type = 'button';
      btn.textContent = a.label;
      btn.addEventListener('click', () => {
        vibrate();
        const values = {};
        Object.keys(inputs).forEach((k) => { values[k] = inputs[k].value.trim(); });
        const r = a.onClick ? a.onClick(values, Modal.close) : undefined;
        if (r !== false && a.autoClose !== false) Modal.close();
      });
      actionsWrap.appendChild(btn);
    });

    ov.hidden = false;
    const first = Object.values(inputs)[0];
    if (first) setTimeout(() => { first.focus(); if (first.select) first.select(); }, 60);

    this._onKey = (e) => { if (e.key === 'Escape') Modal.close(); };
    document.addEventListener('keydown', this._onKey);
    return Modal.close;
  },

  close() {
    const ov = $('modal-overlay');
    if (ov.hidden) return;
    ov.hidden = true;
    $('modal-fields').innerHTML = '';
    $('modal-actions').innerHTML = '';
    if (this._onKey) { document.removeEventListener('keydown', this._onKey); this._onKey = null; }
  }
};

$('modal-overlay').addEventListener('click', (e) => {
  if (e.target === $('modal-overlay')) Modal.close();
});

/* ---------------- 便捷弹窗 ---------------- */

function confirmDialog(title, desc, onConfirm, confirmLabel) {
  Modal.open({
    title,
    desc,
    actions: [
      { label: '取消', kind: 'ghost' },
      { label: confirmLabel || '确认删除', kind: 'danger', onClick: onConfirm }
    ]
  });
}

function promptDialog(title, fields, onConfirm, confirmLabel) {
  Modal.open({
    title,
    fields,
    actions: [
      { label: '取消', kind: 'ghost' },
      { label: confirmLabel || '确认', kind: 'primary', onClick: (vals) => onConfirm(vals) }
    ]
  });
}

/* ---------------- 长按菜单 ---------------- */

const Sheet = {
  open(headTitle, headSub, items) {
    const ov = $('sheet-overlay');
    const head = $('sheet-head');
    head.innerHTML = `<b>${esc(headTitle)}</b>${headSub ? `<span>${esc(headSub)}</span>` : ''}`;

    const wrap = $('sheet-items');
    wrap.innerHTML = '';
    items.forEach((it) => {
      const btn = document.createElement('button');
      btn.className = 'sheet-item ' + (it.kind || '');
      btn.type = 'button';
      btn.innerHTML = `<span class="si-icon">${it.icon || '•'}</span><span>${esc(it.label)}</span>` +
        (it.sub ? `<span class="si-sub">${esc(it.sub)}</span>` : '');
      btn.addEventListener('click', () => {
        vibrate();
        Sheet.close();
        setTimeout(() => it.onClick(), 40);
      });
      wrap.appendChild(btn);
    });

    const cancel = document.createElement('button');
    cancel.className = 'sheet-cancel';
    cancel.type = 'button';
    cancel.textContent = '取消';
    cancel.addEventListener('click', () => Sheet.close());
    wrap.appendChild(cancel);

    ov.hidden = false;
  },
  close() { $('sheet-overlay').hidden = true; }
};

$('sheet-overlay').addEventListener('click', (e) => {
  if (e.target === $('sheet-overlay')) Sheet.close();
});

/**
 * 绑定长按（触屏 + 鼠标），800ms 触发；触发后抑制随后的 click
 */
function bindLongPress(el, handler) {
  let timer = null, fired = false, startX = 0, startY = 0, moved = false;

  const start = (x, y) => {
    fired = false; moved = false;
    startX = x; startY = y;
    clearTimeout(timer);
    timer = setTimeout(() => {
      fired = true;
      vibrate(26);
      handler({ el, longPress: true });
    }, 520);
  };
  const move = (x, y) => {
    if (Math.abs(x - startX) > 12 || Math.abs(y - startY) > 12) {
      moved = true;
      clearTimeout(timer);
    }
  };
  const cancel = () => { clearTimeout(timer); };

  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    start(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  el.addEventListener('touchmove', (e) => {
    if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY);
  }, { passive: true });
  el.addEventListener('touchend', (e) => {
    cancel();
    if (fired) { e.preventDefault(); }
  });
  el.addEventListener('touchcancel', cancel);

  // 鼠标（桌面 / 预览）
  el.addEventListener('mousedown', (e) => { if (e.button === 0) start(e.clientX, e.clientY); });
  el.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
  el.addEventListener('mouseup', cancel);
  el.addEventListener('mouseleave', cancel);

  // 长按触发后拦截 click
  el.addEventListener('click', (e) => {
    if (fired) { e.preventDefault(); e.stopPropagation(); fired = false; }
  }, true);

  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    vibrate(26);
    handler({ el, longPress: true });
  });
}

/* ---------------- 视图切换 ---------------- */

function showView(name) {
  document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
  $('view-' + name).classList.add('active');
  Sheet.close();
  Modal.close();
}

/* ============================================================
   视图 1：主页 — 书本列表
   ============================================================ */

async function renderBooks() {
  const books = await Books.all();
  const wrap = $('books-list');
  const empty = $('books-empty');
  wrap.innerHTML = '';

  // 书本列表变化时同步刷新容量条
  if (typeof refreshStorage === 'function') refreshStorage();

  if (!books.length) {
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  const allNodes = [];
  for (const b of books) {
    const ns = await Nodes.byBook(b.id);
    allNodes.push(...ns);
  }

  books.forEach((b, i) => {
    const ns = allNodes.filter((n) => n.bookId === b.id);
    // 总字数只统计章节；设定另有计数，不计入小说正文总字数
    const chapters = ns.filter((n) => n.type === 'chapter');
    const settings = ns.filter((n) => n.type === 'setting');
    const words = chapters.reduce((s, n) => s + (n.wordCount || 0), 0);
    const settingWords = settings.reduce((s, n) => s + (n.wordCount || 0), 0);

    const card = document.createElement('div');
    card.className = 'book-card';
    card.style.animationDelay = Math.min(i * 45, 400) + 'ms';
    card.innerHTML = `
      <div class="book-spine">${esc((b.title || '书').trim().charAt(0) || '书')}</div>
      <div class="book-info">
        <h3>${esc(b.title)}</h3>
        <p class="${b.intro ? '' : 'placeholder'}">${esc(b.intro || '还没有介绍，长按卡片可以修改')}</p>
        <div class="book-meta">
          <span>${chapters.length} 章</span>
          <span class="dot"></span>
          <span>${words} 字</span>
          ${settings.length ? `<span class="dot"></span><span class="meta-setting">${settings.length} 条设定 · ${settingWords} 字</span>` : ''}
          <span class="dot"></span>
          <span>${fmtTime(b.updatedAt)}</span>
        </div>
      </div>`;

    card.addEventListener('click', () => openBook(b.id));
    bindLongPress(card, () => bookMenu(b));
    wrap.appendChild(card);
  });
}

function bookMenu(book) {
  Sheet.open(book.title, '书本操作', [
    {
      label: '修改标题与介绍', icon: '✎',
      onClick: () => editBookDialog(book)
    },
    {
      label: '导出为 Markdown', icon: '⬇', sub: '整本 / 仅章节',
      onClick: () => exportDialog(book)
    },
    {
      label: '导出 JSON 备份', icon: '📦', sub: '完整数据 · 可搬设备',
      onClick: () => exportJson(book)
    },
    {
      label: '删除书本', icon: '🗑', kind: 'danger',
      onClick: () => {
        confirmDialog(
          '删除书本',
          `确定删除《${book.title}》吗？该书的所有章节与文件夹都会一并删除，且无法恢复。`,
          async () => {
            await Books.remove(book.id);
            toast('已删除');
            renderBooks();
          }
        );
      }
    }
  ]);
}

function createBookDialog() {
  Modal.open({
    title: '创建小说书本',
    fields: [
      { key: 'title', label: '书名', placeholder: '例如：薰衣草色的夜晚' },
      { key: 'intro', label: '介绍', type: 'textarea', placeholder: '写一句话介绍这个故事…' }
    ],
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: '创建', kind: 'primary',
        onClick: async (v) => {
          if (!v.title) { toast('请输入书名'); return false; }
          await Books.add(v.title, v.intro);
          toast('书本已创建');
          renderBooks();
        }
      }
    ]
  });
}

function editBookDialog(book) {
  Modal.open({
    title: '修改书本信息',
    fields: [
      { key: 'title', label: '书名', value: book.title },
      { key: 'intro', label: '介绍', type: 'textarea', value: book.intro || '' }
    ],
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: '保存', kind: 'primary',
        onClick: async (v) => {
          if (!v.title) { toast('书名不能为空'); return false; }
          await Books.update(book.id, { title: v.title, intro: v.intro });
          toast('已保存');
          renderBooks();
        }
      }
    ]
  });
}

$('btn-new-book').addEventListener('click', () => { vibrate(); createBookDialog(); });

/* ============================================================
   视图 2：章节管理 — 文件管理器
   ============================================================ */

async function openBook(bookId) {
  state.bookId = bookId;
  state.folderId = null;
  const book = await Books.get(bookId);
  if (!book) { toast('书本不存在'); return; }
  $('chapter-book-title').textContent = book.title;
  showView('chapters');
  await renderChapters();
}

function renderChapterActions() {
  const wrap = $('chapter-actions');
  wrap.innerHTML = '';

  // 搜索
  const searchBtn = document.createElement('button');
  searchBtn.className = 'icon-btn';
  searchBtn.id = 'btn-search';
  searchBtn.title = '搜索';
  searchBtn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="2" fill="none"/><path d="M16 16l5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
  searchBtn.addEventListener('click', () => { vibrate(); openSearch(); });
  wrap.appendChild(searchBtn);

  // 创建
  const btn = document.createElement('button');
  btn.className = 'icon-btn accent';
  btn.title = '创建';
  btn.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/></svg>';
  btn.addEventListener('click', () => { vibrate(); createDialog(); });
  wrap.appendChild(btn);
}

async function renderChapters() {
  renderChapterActions();
  const all = await Nodes.byBook(state.bookId);
  state.nodesCache = all;

  const list = $('chapter-list');
  list.innerHTML = '';

  // 面包屑
  const crumbs = buildCrumbs(all);
  const bar = document.createElement('div');
  bar.className = 'breadcrumb-bar';
  crumbs.forEach((c, i) => {
    if (i > 0) {
      const sep = document.createElement('span');
      sep.className = 'crumb-sep';
      sep.textContent = '›';
      bar.appendChild(sep);
    }
    const el = document.createElement('span');
    el.className = 'crumb' + (i === crumbs.length - 1 ? ' current' : '');
    el.textContent = c.label;
    el.addEventListener('click', () => {
      state.folderId = c.id;
      renderChapters();
    });
    bar.appendChild(el);
  });
  if (state.clipboard) {
    const tag = document.createElement('span');
    tag.className = 'crumb-sep';
    tag.style.marginLeft = 'auto';
    tag.textContent = '📋 待移动';
    bar.appendChild(tag);
  }
  list.appendChild(bar);

  const children = all
    .filter((n) => n.parentId === state.folderId)
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

  const parentIsRoot = state.folderId === null;

  if (!children.length) {
    const hint = document.createElement('div');
    hint.style.cssText = 'text-align:center;padding:52px 20px;color:var(--text-3);font-size:13px;';
    hint.innerHTML = `<div style="font-size:38px;opacity:.5;margin-bottom:10px">✿</div>
      这里还空着<br><span style="font-size:12px">点击右上角 ＋ 创建文件夹、章节或设定</span>`;
    list.appendChild(hint);
  }

  children.forEach((node, i) => {
    const row = document.createElement('div');
    row.className = 'fm-row fm-' + node.type;
    if (state.clipboard && state.clipboard.id === node.id) row.classList.add('move-pending');
    row.style.animationDelay = Math.min(i * 35, 350) + 'ms';

    const isFolder = node.type === 'folder';
    const isSetting = node.type === 'setting';
    const isTimeline = node.type === 'timeline';

    let sub = '';
    let tail = '';
    if (isFolder) {
      const st = Nodes.folderWordCount(node.id, all);
      const bits = [];
      if (st.chapters) bits.push(`${st.chapters} 章`);
      if (st.settings) bits.push(`${st.settings} 条设定`);
      if (st.others) bits.push(`${st.others} 份资料`);
      sub = bits.length ? bits.join(' · ') : '空文件夹';
      tail = st.words ? st.words + ' 字' : '';
    } else if (isSetting) {
      // 设定不计入小说总字数，尾部标注「设定」；显示分类条数
      const cats = (node.categories || []).length;
      sub = KIND_LABEL[node.kind || 'character'] + ' · ' + (cats ? `${cats} 个分类` : '暂无分类');
      tail = (node.wordCount || 0) + ' 字 · 设定';
    } else if (isTimeline) {
      const n = (node.events || []).length;
      sub = `${n} 个事件 · ` + fmtTime(node.updatedAt);
      tail = n ? `${n} 事件` : '暂无事件';
    } else if (node.type === 'outline') {
      sub = '故事大纲 · ' + fmtTime(node.updatedAt);
      tail = (node.wordCount || 0) + ' 字 · 大纲';
    } else {
      sub = fmtTime(node.updatedAt);
      tail = (node.wordCount || 0) + ' 字';
    }

    row.innerHTML = `
      ${state.clipboard && state.clipboard.id === node.id ? '<span class="fm-move-tag">待移动</span>' : ''}
      <span class="fm-icon">${nodeIcon(node)}</span>
      <span class="fm-main">
        <span class="fm-name">${esc(node.title)}</span>
        <span class="fm-sub">${esc(sub)}</span>
      </span>
      <span class="fm-tail">${esc(tail)}</span>
      ${isFolder
        ? '<span class="fm-chevron">›</span>'
        : '<span class="fm-chevron" style="color:var(--purple-soft);opacity:.85">✎</span>'}`;

    row.addEventListener('click', () => {
      if (isFolder) {
        state.folderId = node.id;
        renderChapters();
      } else if (isTimeline) {
        openTimeline(node.id);
      } else if (isSetting) {
        openSetting(node.id);
      } else {
        openChapter(node.id);
      }
    });
    bindLongPress(row, () => nodeMenu(node, all));
    list.appendChild(row);
  });
}

/* 设定类别元数据 */
const KIND_LABEL = { character: '人物', place: '地点', world: '世界观' };
const KIND_ICON  = { character: '👤', place: '📍', world: '🌐' };
const KIND_DESC  = {
  character: '人物档案、性格、关系',
  place: '城池、场景、地理',
  world: '规则、历史、体系'
};
/** 各类别新建分类时的建议名 */
const KIND_CAT_HINT = {
  character: '例如：性格、外貌、背景、人物关系',
  place: '例如：环境、风物、重要场景',
  world: '例如：世界规则、历史、力量体系'
};
/** 各类别新建分类的默认名 */
const KIND_CAT_DEFAULT = {
  character: '新分类',
  place: '新分类',
  world: '新分类'
};

/** 节点类型图标：文件夹 / 章节 / 设定 / 时间线 / 故事大纲 */
function nodeIcon(node) {
  switch (node.type) {
    case 'folder':   return '📁';
    case 'setting':  return KIND_ICON[node.kind || 'character'];
    case 'timeline': return '🕰';
    case 'outline':  return '🧭';
    default:         return '📄';
  }
}

/** 类型中文名 */
function typeLabel(node) {
  switch (node.type) {
    case 'folder':   return '文件夹';
    case 'setting':  return `${KIND_LABEL[node.kind || 'character']}设定`;
    case 'timeline': return '时间线';
    case 'outline':  return '故事大纲';
    default:         return '章节';
  }
}

/** 标题为空时的兜底名（按节点类型） */
function defaultTitle(node) {
  if (!node) return '未命名';
  switch (node.type) {
    case 'setting':  return '新' + KIND_LABEL[node.kind || 'character'];
    case 'folder':   return '新建文件夹';
    case 'timeline': return '新时间线';
    case 'outline':  return '新大纲';
    default:         return '未命名章节';
  }
}

function buildCrumbs(all) {
  const crumbs = [{ id: null, label: '根目录' }];
  if (state.folderId) {
    const chain = [];
    let cur = all.find((n) => n.id === state.folderId);
    const guard = new Set();
    while (cur && !guard.has(cur.id)) {
      guard.add(cur.id);
      chain.unshift({ id: cur.id, label: cur.title });
      cur = cur.parentId ? all.find((n) => n.id === cur.parentId) : null;
    }
    crumbs.push(...chain);
  }
  return crumbs;
}

/* ---------------- 创建（文件夹 / 章节 / 设定 / 时间线 / 大纲） ---------------- */

function createDialog() {
  const inFolder = state.folderId
    ? (state.nodesCache.find((n) => n.id === state.folderId) || {}).title
    : '根目录';
  Modal.open({
    title: '创建',
    desc: `创建位置：${inFolder}`,
    choices: [
      {
        icon: '📝', label: '章节', hint: '直接创建「新章节」，进入写作',
        onClick: async () => {
          const node = await Nodes.addChapter(state.bookId, state.folderId, '新章节');
          await Books.touch(state.bookId);
          toast('已创建章节');
          await renderChapters();
          openChapter(node.id);
        }
      },
      {
        icon: '👤', label: '设定', hint: '角色 · 地点 · 世界观',
        onClick: () => settingKindDialog()
      },
      {
        icon: '🕰', label: '时间线', hint: '事件列表：时间 + 事件',
        onClick: () => {
          promptDialog('创建时间线', [
            { key: 'title', label: '时间线名称', value: '新时间线', placeholder: '例如：主线纪年' }
          ], async (v) => {
            const title = (v.title || '').trim();
            if (!title) { toast('请输入名称'); return; }
            const node = await Nodes.addTimeline(state.bookId, state.folderId, title);
            await Books.touch(state.bookId);
            toast('时间线已创建');
            await renderChapters();
            openTimeline(node.id);
          }, '创建');
        }
      },
      {
        icon: '🧭', label: '故事大纲', hint: '纯文本，梳理整体脉络',
        onClick: () => {
          promptDialog('创建故事大纲', [
            { key: 'title', label: '大纲名称', value: '新大纲', placeholder: '例如：全书大纲' }
          ], async (v) => {
            const title = (v.title || '').trim();
            if (!title) { toast('请输入名称'); return; }
            const node = await Nodes.addOutline(state.bookId, state.folderId, title);
            await Books.touch(state.bookId);
            toast('故事大纲已创建');
            await renderChapters();
            openChapter(node.id);
          }, '创建');
        }
      },
      {
        icon: '📁', label: '文件夹', hint: '先输入名字，用于整理章节',
        onClick: () => {
          promptDialog('创建文件夹', [
            { key: 'title', label: '文件夹名称', placeholder: '例如：第一卷 · 夜的开端' }
          ], async (v) => {
            if (!v.title) { toast('请输入名称'); return; }
            await Nodes.addFolder(state.bookId, state.folderId, v.title);
            await Books.touch(state.bookId);
            toast('文件夹已创建');
            renderChapters();
          }, '创建');
        }
      }
    ],
    actions: [{ label: '取消', kind: 'ghost' }]
  });
}

/** 选择设定类型：人物 / 地点 / 世界观 */
function settingKindDialog() {
  Modal.open({
    title: '创建设定',
    desc: '选择设定的类型',
    choices: ['character', 'place', 'world'].map((k) => ({
      icon: KIND_ICON[k],
      label: KIND_LABEL[k],
      hint: KIND_DESC[k],
      onClick: () => createSettingDialog(k)
    })),
    actions: [{ label: '取消', kind: 'ghost' }]
  });
}

/** 设定命名 -> 创建并进入分类编辑器 */
function createSettingDialog(kind) {
  const label = KIND_LABEL[kind];
  promptDialog(`新建${label}设定`, [
    {
      key: 'title',
      label: `${label}名称`,
      value: '新' + label,
      placeholder: kind === 'character' ? '例如：林砚' : kind === 'place' ? '例如：紫雾巷' : '例如：香料体系'
    }
  ], async (v) => {
    const title = (v.title || '').trim();
    if (!title) { toast('请输入名称'); return; }
    const node = await Nodes.addSetting(state.bookId, state.folderId, title, kind);
    await Books.touch(state.bookId);
    toast(`${label}设定已创建`);
    await renderChapters();
    openSetting(node.id);
  }, '创建');
}

/* ---------------- 长按菜单 ---------------- */

function nodeMenu(node, all) {
  const items = [
    {
      label: '重命名', icon: '✎',
      onClick: () => {
        promptDialog('重命名', [
          { key: 'title', label: node.type === 'folder' ? '文件夹名称'
              : node.type === 'setting' ? KIND_LABEL[node.kind || 'character'] + '名称'
              : node.type === 'timeline' ? '时间线名称'
              : node.type === 'outline' ? '大纲名称'
              : '章节标题', value: node.title }
        ], async (v) => {
          if (!v.title) { toast('名称不能为空'); return; }
          await Nodes.update(node.id, { title: v.title });
          toast('已重命名');
          renderChapters();
        }, '保存');
      }
    },
    {
      label: '移动', icon: '✂', sub: '复制到剪贴板',
      onClick: () => {
        state.clipboard = { id: node.id, type: node.type };
        toast(`已剪切「${node.title}」，长按目标文件夹粘贴`);
        renderChapters();
      }
    }
  ];

  // 粘贴：仅文件夹长按菜单上显示，且必须存在移动剪贴板
  if (node.type === 'folder' && state.clipboard) {
    const clip = state.clipboard;
    const src = all.find((n) => n.id === clip.id);
    const illegal =
      !src ||
      src.id === node.id ||                              // 不能粘贴到自己
      Nodes.isAncestorOf(src.id, node.id, all) ||        // 不能粘贴进自己的子目录
      src.parentId === node.id;                          // 已在目标目录内

    items.push({
      label: '粘贴', icon: '📋', kind: 'paste',
      sub: src ? `移动「${src.title}」到此处` : '',
      onClick: async () => {
        if (illegal) { toast('无法移动到该位置'); return; }
        await Nodes.move(clip.id, node.id);
        state.clipboard = null;
        await Books.touch(state.bookId);
        toast(`已移动到「${node.title}」`);
        renderChapters();
      }
    });
  }

  items.push({
    label: '删除', icon: '🗑', kind: 'danger',
    onClick: () => {
      const extra = node.type === 'folder' ? '文件夹内的所有内容也会一并删除。' : '';
      confirmDialog(
        '确认删除',
        `确定删除「${node.title}」吗？${extra}此操作无法恢复。`,
        async () => {
          await Nodes.remove(node.id);
          if (state.clipboard && state.clipboard.id === node.id) state.clipboard = null;
          await Books.touch(state.bookId);
          toast('已删除');
          renderChapters();
        }
      );
    }
  });

  Sheet.open(node.title, typeLabel(node), items);
}

$('btn-back-books').addEventListener('click', () => {
  vibrate();
  state.bookId = null;
  state.folderId = null;
  state.clipboard = null;
  showView('books');
  renderBooks();
});

/* ============================================================
   视图 3：写作编辑器
   ============================================================ */

let editorNode = null;
let saveTimer = null;
let titleSaveTimer = null;
let editorBusy = false;   // 正在切换节点时抑制 blur 写入

/** 切换节点前，把当前编辑内容落库（避免丢失 / 写错对象） */
async function flushEditor() {
  if (!editorNode) return;
  clearTimeout(saveTimer);
  clearTimeout(titleSaveTimer);
  const target = editorNode.id;
  const text = $('editor-body').value;
  const n = countWords(text);
  const rawTitle = $('editor-title').value.trim();
  const title = rawTitle || defaultTitle(editorNode);
  const node = await Nodes.get(target);
  if (!node) return;
  await Nodes.update(target, { content: text, wordCount: n, title });
  await Books.touch(node.bookId);
}

async function openChapter(nodeId) {
  // 若已打开另一个节点，先保存它，再切换
  if (editorNode && editorNode.id !== nodeId) {
    editorBusy = true;
    try { await flushEditor(); } finally { editorBusy = false; }
  }
  const node = await Nodes.get(nodeId);
  if (!node) { toast('内容不存在'); return; }
  // 时间线与设定走各自的独立编辑器
  if (node.type === 'timeline') { openTimeline(nodeId); return; }
  if (node.type === 'setting') { openSetting(nodeId); return; }

  editorNode = node;
  state.chapterId = nodeId;

  $('editor-title').value = node.title || '';
  $('editor-title').placeholder = node.type === 'outline' ? '大纲名称' : '章节标题';
  $('editor-body').placeholder = node.type === 'outline'
    ? '全书脉络、分卷结构、关键转折、结局走向……'
    : '在这里写下你的故事……\n\n夜色如薰衣草般铺开。';
  $('editor-body').value = node.content || '';

  // 顶栏标示当前类型
  const tag = $('editor-kind-tag');
  if (node.type === 'outline') {
    tag.textContent = '🧭 故事大纲';
    tag.hidden = false;
  } else {
    tag.hidden = true;
  }

  updateEditorCount(node.wordCount || 0);
  setEditorStatus('已保存');
  showView('editor');

  // 进入时若标题仍是默认值，选中方便直接覆盖
  setTimeout(() => {
    const body = $('editor-body');
    if (!body.value) body.focus();
  }, 120);
}

function updateEditorCount(n) {
  const chip = $('editor-count');
  chip.innerHTML = `<b>${n}</b><span>字</span>`;
  chip.classList.remove('pulse');
  void chip.offsetWidth;
  chip.classList.add('pulse');
}

function setEditorStatus(text) {
  const el = $('editor-status');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(setEditorStatus._t);
  setEditorStatus._t = setTimeout(() => el.classList.remove('show'), 1600);
}

/* ---- 正文输入：实时字数 + 自动保存 ---- */
$('editor-body').addEventListener('input', () => {
  if (!editorNode) return;
  const target = editorNode.id;          // 快照节点，防止切换后写错对象
  const text = $('editor-body').value;
  const n = countWords(text);
  $('editor-count').innerHTML = `<b>${n}</b><span>字</span>`;

  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    if (!editorNode || editorNode.id !== target) return;
    await Nodes.update(target, { content: text, wordCount: n });
    if (editorNode && editorNode.id === target) {
      editorNode.content = text;
      editorNode.wordCount = n;
    }
    const fresh = await Nodes.get(target);
    if (fresh) await Books.touch(fresh.bookId);
    if (editorNode && editorNode.id === target) {
      setEditorStatus('已自动保存 · ' + fmtTime(Date.now()).slice(11));
    }
  }, 600);
});

/* ---- 正文失焦立即保存 ---- */
$('editor-body').addEventListener('blur', async () => {
  if (!editorNode || editorBusy) return;
  // 快照当前节点，异步过程中若已切走则放弃，避免把空内容写到新节点
  const target = editorNode.id;
  clearTimeout(saveTimer);
  const text = $('editor-body').value;
  const n = countWords(text);
  await Nodes.update(target, { content: text, wordCount: n });
  if (editorNode && editorNode.id === target) {
    editorNode.content = text;
    editorNode.wordCount = n;
    setEditorStatus('已保存');
  }
});

/* ---- 标题输入：内外同步（延迟写库，返回列表即在） ---- */
$('editor-title').addEventListener('input', () => {
  if (!editorNode) return;
  const target = editorNode.id;
  const title = $('editor-title').value;
  clearTimeout(titleSaveTimer);
  titleSaveTimer = setTimeout(async () => {
    if (!editorNode || editorNode.id !== target) return;
    const v = title.trim() || defaultTitle(editorNode);
    await Nodes.update(target, { title: v });
    if (editorNode && editorNode.id === target) {
      editorNode.title = v;
      setEditorStatus('标题已保存');
    }
  }, 400);
});

$('editor-title').addEventListener('blur', async () => {
  if (!editorNode) return;
  clearTimeout(titleSaveTimer);
  let title = $('editor-title').value.trim();
  if (!title) { title = defaultTitle(editorNode); $('editor-title').value = title; }
  await Nodes.update(editorNode.id, { title });
  editorNode.title = title;
  await Books.touch(editorNode.bookId);
});

$('editor-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); $('editor-body').focus(); }
});

/* ---- 返回章节列表：先落库，保证字数同步 ---- */
$('btn-back-chapters').addEventListener('click', async () => {
  vibrate();
  await flushEditor();
  editorNode = null;
  state.chapterId = null;
  showView('chapters');
  await renderChapters();
});

/* ============================================================
   初始化
   ============================================================ */

window.addEventListener('beforeunload', () => {
  if (editorNode) {
    const text = $('editor-body').value;
    const n = countWords(text);
    Nodes.update(editorNode.id, { content: text, wordCount: n });
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && editorNode) {
    const text = $('editor-body').value;
    const n = countWords(text);
    Nodes.update(editorNode.id, { content: text, wordCount: n });
  }
});

(async function init() {
  try {
    await openDB();
    await renderBooks();
    await refreshStorage();
  } catch (e) {
    console.error(e);
    toast('数据库初始化失败：' + e.message);
  }
})();
