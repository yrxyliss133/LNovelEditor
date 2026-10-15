
/* ============================================================
   视图 4：时间线编辑器（事件列表）
   左：时间（窄）  右：事件文本（宽）
   ============================================================ */

let timelineNode = null;
let tlSaveTimer = null;
let tlTitleTimer = null;
let tlBusy = false;

/** 事件字数合计（时间 + 事件文本） */
function timelineWordCount(node) {
  let n = 0;
  (node.events || []).forEach((ev) => {
    n += countWords(ev.text || '');
  });
  return n;
}

function newEventId() {
  return 'ev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
}

async function openTimeline(nodeId) {
  if (timelineNode && timelineNode.id !== nodeId) {
    tlBusy = true;
    try { await flushTimeline(); } finally { tlBusy = false; }
  }
  const node = await Nodes.get(nodeId);
  if (!node) { toast('时间线不存在'); return; }
  if (!Array.isArray(node.events)) node.events = [];
  timelineNode = node;
  state.chapterId = nodeId;

  $('timeline-title').value = node.title || '';
  renderTimelineEvents();
  showView('timeline');

  if (!node.events.length) {
    setTimeout(() => addEvent(true), 260);
  }
}

function renderTimelineEvents() {
  const list = $('timeline-list');
  list.innerHTML = '';
  const events = (timelineNode && timelineNode.events) || [];

  if (!events.length) {
    const empty = document.createElement('div');
    empty.className = 'tl-empty';
    empty.innerHTML = '<span class="ti">🕰</span>还没有事件<br><span style="font-size:12px">点击右上角 ＋ 创建新事件</span>';
    list.appendChild(empty);
    return;
  }

  events.forEach((ev, i) => {
    const row = document.createElement('div');
    row.className = 'tl-row';
    row.style.animationDelay = Math.min(i * 30, 300) + 'ms';

    const time = document.createElement('input');
    time.className = 'tl-time';
    time.type = 'text';
    time.value = ev.time || '';
    time.placeholder = '时间';
    time.autocomplete = 'off';
    time.spellcheck = false;

    const text = document.createElement('textarea');
    text.className = 'tl-text';
    text.rows = 1;
    text.value = ev.text || '';
    text.placeholder = '发生了什么……';
    text.spellcheck = false;

    const del = document.createElement('button');
    del.className = 'tl-del';
    del.type = 'button';
    del.title = '删除事件';
    del.textContent = '✕';

    // 自适应高度
    const autosize = () => {
      text.style.height = 'auto';
      text.style.height = Math.max(42, text.scrollHeight) + 'px';
    };

    time.addEventListener('input', () => {
      ev.time = time.value;
      scheduleTimelineSave();
    });

    text.addEventListener('input', () => {
      ev.text = text.value;
      autosize();
      scheduleTimelineSave();
    });
    text.addEventListener('blur', () => {
      if (tlBusy) return;
      tlSaveNow();
    });
    text.addEventListener('keydown', (e) => {
      // Enter 新建下一个事件，方便连续录入
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        addEvent(false, i + 1);
      }
    });

    del.addEventListener('click', () => {
      vibrate();
      const preview = (ev.text || '').trim().slice(0, 14) || (ev.time || '').trim() || '这条事件';
      confirmDialog('删除事件', `确定删除「${preview}」吗？此操作无法恢复。`, async () => {
        const idx = timelineNode.events.findIndex((x) => x.id === ev.id);
        if (idx > -1) timelineNode.events.splice(idx, 1);
        await tlSaveNow();
        renderTimelineEvents();
        toast('事件已删除');
      });
    });

    row.appendChild(time);
    row.appendChild(text);
    row.appendChild(del);
    list.appendChild(row);
    autosize();
  });

  const hint = document.createElement('div');
  hint.className = 'tl-hint';
  hint.textContent = '按 Enter 快速添加下一个事件 · Shift+Enter 换行';
  list.appendChild(hint);
}

/** 在指定位置插入新事件并聚焦 */
async function addEvent(focusFirst, atIndex) {
  if (!timelineNode) return;
  timelineNode.events = timelineNode.events || [];
  const ev = { id: newEventId(), time: '', text: '' };
  const idx = (typeof atIndex === 'number') ? atIndex : timelineNode.events.length;
  timelineNode.events.splice(idx, 0, ev);
  renderTimelineEvents();
  await tlSaveNow();

  const rows = document.querySelectorAll('.tl-row');
  const target = rows[focusFirst ? 0 : Math.min(idx, rows.length - 1)];
  if (target) {
    const firstInput = focusFirst ? target.querySelector('.tl-time') : target.querySelector('.tl-text');
    firstInput.focus();
  }
}

function scheduleTimelineSave() {
  clearTimeout(tlSaveTimer);
  tlSaveTimer = setTimeout(tlSaveNow, 600);
}

async function tlSaveNow() {
  if (!timelineNode) return;
  clearTimeout(tlSaveTimer);
  const target = timelineNode.id;
  const events = timelineNode.events || [];
  const words = timelineWordCount({ events });
  const title = $('timeline-title').value.trim() || '新时间线';
  const node = await Nodes.get(target);
  if (!node) return;
  await Nodes.update(target, { events, wordCount: words, title });
  if (timelineNode && timelineNode.id === target) timelineNode.wordCount = words;
  await Books.touch(node.bookId);
}

/** 离开时间线前落库 */
async function flushTimeline() {
  if (!timelineNode) return;
  clearTimeout(tlSaveTimer);
  clearTimeout(tlTitleTimer);
  await tlSaveNow();
}

/* ---- 标题防抖保存 ---- */
$('timeline-title').addEventListener('input', () => {
  if (!timelineNode) return;
  const target = timelineNode.id;
  const val = $('timeline-title').value;
  clearTimeout(tlTitleTimer);
  tlTitleTimer = setTimeout(async () => {
    if (!timelineNode || timelineNode.id !== target) return;
    await Nodes.update(target, { title: val.trim() || '新时间线' });
    const fresh = await Nodes.get(target);
    if (fresh) await Books.touch(fresh.bookId);
  }, 400);
});

$('timeline-title').addEventListener('blur', async () => {
  if (!timelineNode || tlBusy) return;
  clearTimeout(tlTitleTimer);
  let v = $('timeline-title').value.trim();
  if (!v) { v = '新时间线'; $('timeline-title').value = v; }
  await Nodes.update(timelineNode.id, { title: v });
});

$('timeline-title').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const first = document.querySelector('.tl-time');
    if (first) first.focus();
  }
});

/* ---- 顶栏：创建新事件 ---- */
$('btn-new-event').addEventListener('click', async () => {
  vibrate();
  if (!timelineNode) return;
  await addEvent(false);
  toast('已添加事件');
});

/* ---- 返回章节列表 ---- */
$('btn-back-timeline').addEventListener('click', async () => {
  vibrate();
  tlBusy = true;
  try { await flushTimeline(); } finally { tlBusy = false; }
  timelineNode = null;
  state.chapterId = null;
  showView('chapters');
  await renderChapters();
});
