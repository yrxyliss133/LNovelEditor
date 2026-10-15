
/* ============================================================
   IndexedDB 容量显示
   左：进度条   右：已用 / 上限
   条最右：容量切换按钮 → 8 档可选
   ============================================================ */

const CAPACITY_KEY = 'capacityLimit';
const DEFAULT_CAPACITY = 128 * 1024 * 1024;   // 128 MB

/** 可选容量档位 */
const CAPACITY_OPTIONS = [
  { label: '16 MB',  bytes: 16  * 1024 * 1024 },
  { label: '64 MB',  bytes: 64  * 1024 * 1024 },
  { label: '128 MB', bytes: 128 * 1024 * 1024, note: '默认' },
  { label: '256 MB', bytes: 256 * 1024 * 1024 },
  { label: '512 MB', bytes: 512 * 1024 * 1024 },
  { label: '1 GB',   bytes: 1024 * 1024 * 1024 },
  { label: '2 GB',   bytes: 2 * 1024 * 1024 * 1024 },
  { label: '4 GB',   bytes: 4 * 1024 * 1024 * 1024 }
];

let capacityLimit = DEFAULT_CAPACITY;

/** 人类可读体积 */
function fmtBytes(n) {
  if (!n || n < 0) n = 0;
  const KB = 1024, MB = KB * 1024, GB = MB * 1024;
  if (n < KB) return n + ' B';
  if (n < MB) return (n / KB).toFixed(n / KB < 10 ? 1 : 0) + ' KB';
  if (n < GB) {
    const v = n / MB;
    return (v < 10 ? v.toFixed(1) : Math.round(v)) + ' MB';
  }
  const v = n / GB;
  return (v < 10 ? v.toFixed(2) : v.toFixed(1)) + ' GB';
}

/** 估算本应用的 IndexedDB 已用空间（字节） */
async function estimateUsage() {
  // 优先用浏览器配额 API
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const est = await navigator.storage.estimate();
      if (est && typeof est.usage === 'number') return est.usage;
    } catch (e) { /* 退回到自行统计 */ }
  }
  return measureOwnUsage();
}

/** 自行统计：把所有书本与节点的数据编码后量长度 */
async function measureOwnUsage() {
  let total = 0;
  try {
    const books = await Books.all();
    total += JSON.stringify(books).length;
    for (const b of books) {
      const nodes = await Nodes.byBook(b.id);
      total += JSON.stringify(nodes).length;
    }
  } catch (e) { /* ignore */ }
  // UTF-8 中文按 3 字节估算：粗略乘以 1.6 贴近实际
  return Math.round(total * 1.6);
}

/** 刷新容量条 */
async function refreshStorage() {
  try {
    const used = await estimateUsage();
    capacityLimit = await Settings.get(CAPACITY_KEY, DEFAULT_CAPACITY);
    if (typeof capacityLimit !== 'number' || capacityLimit <= 0) capacityLimit = DEFAULT_CAPACITY;

    const pct = Math.min(100, capacityLimit ? (used / capacityLimit) * 100 : 0);
    const fill = $('sb-fill');
    const text = $('sb-text');

    fill.style.width = pct.toFixed(2) + '%';

    const level = pct >= 90 ? 'danger' : pct >= 70 ? 'warn' : '';
    fill.classList.remove('warn', 'danger');
    text.classList.remove('warn', 'danger');
    if (level) { fill.classList.add(level); text.classList.add(level); }

    text.innerHTML = `<b>${fmtBytes(used)}</b> / ${fmtBytes(capacityLimit)}`;
    $('sb-track').title = `已用 ${fmtBytes(used)} · 上限 ${fmtBytes(capacityLimit)}（${pct.toFixed(1)}%）`;
  } catch (e) {
    console.error(e);
  }
}

/** 打开容量选择 */
async function openCapacityDialog() {
  const current = await Settings.get(CAPACITY_KEY, DEFAULT_CAPACITY);

  Modal.open({
    title: '存储容量上限',
    desc: '用于容量条显示与用量提醒。修改后立即生效。',
    fields: [{
      key: '__cap',
      label: '',
      type: 'custom',
      render: (wrap) => {
        const list = document.createElement('div');
        list.className = 'cap-list';
        CAPACITY_OPTIONS.forEach((opt) => {
          const isCur = opt.bytes === current;
          const item = document.createElement('button');
          item.className = 'cap-item' + (isCur ? ' current' : '');
          item.type = 'button';
          item.innerHTML = `<span class="cap-val">${opt.label}</span>
            ${opt.note ? `<span class="cap-note">${opt.note}</span>` : ''}
            <span class="cap-check" ${isCur ? '' : 'hidden'}>✓</span>`;
          item.addEventListener('click', async () => {
            vibrate();
            Modal.close();
            await Settings.set(CAPACITY_KEY, opt.bytes);
            capacityLimit = opt.bytes;
            await refreshStorage();
            toast(`容量上限已设为 ${opt.label}`);
          });
          list.appendChild(item);
        });
        wrap.appendChild(list);
      }
    }],
    actions: [{ label: '取消', kind: 'ghost' }]
  });
}

$('sb-cap-btn').addEventListener('click', () => { vibrate(); openCapacityDialog(); });

// 页面可见性变化时刷新（其他标签页写入后回来能同步）
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) refreshStorage();
});
