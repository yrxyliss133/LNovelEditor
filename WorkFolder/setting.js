
/* ============================================================
   视图 5：设定编辑器（分类列表）
   每个分类 = 头部（分类名） + 下方内容区
   字数统计只算所有分类的内容
   ============================================================ */

let settingNode = null;
let setSaveTimer = null;
let setTitleTimer = null;
let setBusy = false;

function newCategoryId() {
  return 'cat-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

/** 只统计所有分类的「内容」字数，不含分类名 */
function settingContentWords(node) {
  let n = 0;
  (node.categories || []).forEach((c) => { n += countWords(c.content || ''); });
  return n;
}

async function openSetting(nodeId) {
  if (settingNode && settingNode.id !== nodeId) {
    setBusy = true;
    try { await flushSetting(); } finally { setBusy = false; }
  }
  const node = await Nodes.get(nodeId);
  if (!node) { toast('设定不存在'); return; }
  if (!Array.isArray(node.categories)) node.categories = [];
  settingNode = node;
  state.chapterId = nodeId;

  const kind = node.kind || 'character';
  $('setting-title').value = node.title || '';
  $('setting-title').placeholder = KIND_LABEL[kind] + '名称';
  const tag = $('setting-kind-tag');
  tag.textContent = KIND_ICON[kind] + ' ' + KIND_LABEL[kind] + '设定';

  renderCategories();
  updateSettingCount(settingContentWords(node), false);
  showView('setting');
}

function updateSettingCount(n, pulse) {
  const chip = $('setting-count');
  chip.innerHTML = `<b>${n}</b><span>字</span>`;
  if (pulse) {
    chip.classList.remove('pulse');
    void chip.offsetWidth;
    chip.classList.add('pulse');
  }
}

function renderCategories() {
  const list = $('category-list');
  list.innerHTML = '';
  const cats = (settingNode && settingNode.categories) || [];

  if (!cats.length) {
    const empty = document.createElement('div');
    empty.className = 'set-empty';
    empty.innerHTML = '<span class="si">✿</span>还没有分类<br><span style="font-size:12px">点击右上角 ＋ 创建第一个分类</span>';
    list.appendChild(empty);
    return;
  }

  cats.forEach((cat, i) => {
    const card = document.createElement('div');
    card.className = 'cat-card';
    card.style.animationDelay = Math.min(i * 40, 320) + 'ms';

    // ---- 头部：分类名 ----
    const head = document.createElement('div');
    head.className = 'cat-head';

    const name = document.createElement('input');
    name.className = 'cat-name';
    name.type = 'text';
    name.value = cat.name || '';
    name.placeholder = '分类名称';
    name.autocomplete = 'off';

    const word = document.createElement('span');
    word.className = 'cat-word';
    word.textContent = countWords(cat.content || '') + ' 字';

    const del = document.createElement('button');
    del.className = 'cat-del';
    del.type = 'button';
    del.title = '删除分类';
    del.textContent = '✕';

    head.appendChild(name);
    head.appendChild(word);
    head.appendChild(del);

    // ---- 内容区 ----
    const body = document.createElement('textarea');
    body.className = 'cat-body';
    body.rows = 3;
    body.value = cat.content || '';
    body.placeholder = '在这里写「' + (cat.name || '本分类') + '」的内容……';
    body.spellcheck = false;

    const autosize = () => {
      body.style.height = 'auto';
      body.style.height = Math.max(76, body.scrollHeight) + 'px';
    };

    name.addEventListener('input', () => {
      cat.name = name.value;
      body.placeholder = '在这里写「' + (name.value.trim() || '本分类') + '」的内容……';
      scheduleSettingSave();
    });
    name.addEventListener('blur', () => {
      if (setBusy) return;
      if (!name.value.trim()) {
        name.value = '未命名分类';
        cat.name = name.value;
      }
      setSaveNow();
    });
    name.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); body.focus(); }
    });

    body.addEventListener('input', () => {
      cat.content = body.value;
      const w = countWords(body.value);
      word.textContent = w + ' 字';
      autosize();
      // 实时更新顶栏总字数
      updateSettingCount(settingContentWords(settingNode), true);
      scheduleSettingSave();
    });
    body.addEventListener('blur', () => {
      if (setBusy) return;
      setSaveNow();
    });

    del.addEventListener('click', () => {
      vibrate();
      const label = (cat.name || '').trim() || '本分类';
      confirmDialog('删除分类', `确定删除「${label}」吗？该分类的内容会一并删除，无法恢复。`, async () => {
        const idx = settingNode.categories.findIndex((c) => c.id === cat.id);
        if (idx > -1) settingNode.categories.splice(idx, 1);
        await setSaveNow();
        renderCategories();
        updateSettingCount(settingContentWords(settingNode), true);
        toast('分类已删除');
      });
    });

    card.appendChild(head);
    card.appendChild(body);
    list.appendChild(card);
    autosize();
  });

  const hint = document.createElement('div');
  hint.className = 'set-hint';
  hint.textContent = '字数统计只计入各分类的内容';
  list.appendChild(hint);
}

/** 顶栏「＋」创建分类 */
function createCategoryDialog() {
  if (!settingNode) return;
  const kind = settingNode.kind || 'character';
  promptDialog('创建分类', [
    {
      key: 'name',
      label: '分类名称',
      value: '',
      placeholder: KIND_CAT_HINT[kind]
    }
  ], async (v) => {
    const name = (v.name || '').trim();
    if (!name) { toast('请输入分类名称'); return; }
    settingNode.categories.push({ id: newCategoryId(), name, content: '' });
    await setSaveNow();
    renderCategories();
    // 聚焦到新分类的内容区
    const areas = document.querySelectorAll('.cat-body');
    const target = areas[areas.length - 1];
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
      target.focus();
    }
    toast('分类已创建');
  }, '创建');
}

function scheduleSettingSave() {
  clearTimeout(setSaveTimer);
  setSaveTimer = setTimeout(setSaveNow, 600);
}

async function setSaveNow() {
  if (!settingNode) return;
  clearTimeout(setSaveTimer);
  const target = settingNode.id;
  const categories = settingNode.categories || [];
  const words = settingContentWords({ categories });
  const title = $('setting-title').value.trim() || ('新' + KIND_LABEL[settingNode.kind || 'character']);

  // 分类名称为空的兜底
  categories.forEach((c) => { if (!c.name || !c.name.trim()) c.name = '未命名分类'; });

  const node = await Nodes.get(target);
  if (!node) return;
  await Nodes.update(target, { categories, wordCount: words, title });
  if (settingNode && settingNode.id === target) settingNode.wordCount = words;
  await Books.touch(node.bookId);
  updateSettingCount(words, false);
}

/** 离开设定前落库 */
async function flushSetting() {
  if (!settingNode) return;
  clearTimeout(setSaveTimer);
  clearTimeout(setTitleTimer);
  await setSaveNow();
}

/* ---- 标题防抖保存 ---- */
$('setting-title').addEventListener('input', () => {
  if (!settingNode) return;
  const target = settingNode.id;
  const val = $('setting-title').value;
  clearTimeout(setTitleTimer);
  setTitleTimer = setTimeout(async () => {
    if (!settingNode || settingNode.id !== target) return;
    const fallback = '新' + KIND_LABEL[settingNode.kind || 'character'];
    await Nodes.update(target, { title: val.trim() || fallback });
    const fresh = await Nodes.get(target);
    if (fresh) await Books.touch(fresh.bookId);
  }, 400);
});

$('setting-title').addEventListener('blur', async () => {
  if (!settingNode || setBusy) return;
  clearTimeout(setTitleTimer);
  let v = $('setting-title').value.trim();
  if (!v) { v = '新' + KIND_LABEL[settingNode.kind || 'character']; $('setting-title').value = v; }
  await Nodes.update(settingNode.id, { title: v });
});

$('setting-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const first = document.querySelector('.cat-body');
    if (first) first.focus();
  }
});

/* ---- 顶栏：创建分类 ---- */
$('btn-new-category').addEventListener('click', () => { vibrate(); createCategoryDialog(); });

/* ---- 返回章节列表 ---- */
$('btn-back-setting').addEventListener('click', async () => {
  vibrate();
  setBusy = true;
  try { await flushSetting(); } finally { setBusy = false; }
  settingNode = null;
  state.chapterId = null;
  showView('chapters');
  await renderChapters();
});
