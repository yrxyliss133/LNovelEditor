
/* ============================================================
   JSON 导出 / 导入 —— 整本书完整备份
   用于备份，或把书搬到其他设备 / 其他浏览器
   ============================================================ */

const BACKUP_FORMAT = 'lavender-novel-book';
const BACKUP_VERSION = 1;

/* ---------------- 导出 ---------------- */

/** 导出整本书为 JSON 文件 */
async function exportJson(book) {
  try {
    const nodes = await Nodes.byBook(book.id);
    const payload = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      book: {
        title: book.title,
        intro: book.intro || '',
        createdAt: book.createdAt || null,
        updatedAt: book.updatedAt || null
      },
      // 保留原始 id，便于导入时还原层级
      nodes
    };

    const json = JSON.stringify(payload, null, 2);
    const filename = safeFileName(book.title) + '-' + stamp() + '.json';
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });

    const chapters = nodes.filter((n) => n.type === 'chapter').length;

    // APK 环境优先走原生桥（写到系统「下载」目录）
    if (typeof saveBlobNative === 'function' && saveBlobNative(blob, filename)) {
      toast(`已导出 ${filename}（${chapters} 章）`);
      return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 4000);

    toast(`已导出 ${filename}（${chapters} 章）`);
  } catch (e) {
    console.error(e);
    toast('导出失败：' + e.message);
  }
}

/* ---------------- 导入 ---------------- */

/** 触发文件选择 */
function pickJsonFile() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.style.display = 'none';
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (file) await handleJsonFile(file);
    document.body.removeChild(input);
  });
  document.body.appendChild(input);
  input.click();
}

/** 校验并预览，再确认导入 */
async function handleJsonFile(file) {
  let payload;
  try {
    const text = await file.text();
    payload = JSON.parse(text);
  } catch (e) {
    confirmDialog('无法读取文件', '这个文件不是有效的 JSON，可能已损坏。', null, '知道了');
    return;
  }

  const err = validateBackup(payload);
  if (err) {
    confirmDialog('备份文件无效', err, null, '知道了');
    return;
  }

  const nodes = payload.nodes || [];
  const chapters = nodes.filter((n) => n.type === 'chapter').length;
  const folders = nodes.filter((n) => n.type === 'folder').length;
  const settings = nodes.filter((n) => n.type === 'setting').length;
  const timelines = nodes.filter((n) => n.type === 'timeline').length;
  const outlines = nodes.filter((n) => n.type === 'outline').length;
  const words = nodes
    .filter((n) => n.type === 'chapter')
    .reduce((s, n) => s + (n.wordCount || 0), 0);

  const bits = [`${chapters} 章`, `${words} 字`];
  if (folders) bits.push(`${folders} 个文件夹`);
  if (settings) bits.push(`${settings} 条设定`);
  if (timelines) bits.push(`${timelines} 条时间线`);
  if (outlines) bits.push(`${outlines} 份大纲`);

  const bookTitle = (payload.book && payload.book.title) || '未命名';
  Modal.open({
    title: '导入书本',
    desc: `《${bookTitle}》\n${bits.join(' · ')}\n\n导入后会作为一本新书加入书阁，原有书本不受影响。`,
    actions: [
      { label: '取消', kind: 'ghost' },
      {
        label: '导入', kind: 'primary',
        onClick: () => doImport(payload)
      }
    ]
  });
}

/** 按实际内容重算整本书的字数（导入后调用，不信任文件里的旧值） */
async function recountBook(bookId) {
  const nodes = await Nodes.byBook(bookId);
  await tx('nodes', 'readwrite', (s) => {
    nodes.forEach((n) => {
      let words = null;
      if (n.type === 'chapter' || n.type === 'outline') {
        words = countWords(n.content || '');
      } else if (n.type === 'setting') {
        words = 0;
        (n.categories || []).forEach((c) => { words += countWords(c.content || ''); });
      } else if (n.type === 'timeline') {
        words = 0;
        (n.events || []).forEach((e) => { words += countWords(e.text || ''); });
      } else if (n.type === 'folder') {
        words = 0;
      }
      if (words !== null && words !== n.wordCount) {
        n.wordCount = words;
        s.put(n);
      }
    });
    return null;
  });
}

/** 校验备份结构，返回错误说明或 null */
function validateBackup(payload) {
  if (!payload || typeof payload !== 'object') return '文件内容为空或格式不对。';
  if (payload.format !== BACKUP_FORMAT) {
    return '这不是本编辑器导出的书本备份文件。';
  }
  if (payload.version > BACKUP_VERSION) {
    return `备份版本（v${payload.version}）比当前应用更新，请升级后再导入。`;
  }
  if (!payload.book || typeof payload.book.title !== 'string') {
    return '备份里缺少书本信息。';
  }
  if (!Array.isArray(payload.nodes)) {
    return '备份里缺少内容节点。';
  }
  return null;
}

/** 执行导入：id 全部重映射，避免与现有数据冲突 */
async function doImport(payload) {
  try {
    const src = payload.nodes || [];
    const validTypes = new Set(['folder', 'chapter', 'setting', 'timeline', 'outline']);

    // 1) 新建书本
    const book = await Books.add(
      payload.book.title + (payload.book.title ? '（导入）' : '未命名（导入）'),
      payload.book.intro || ''
    );

    // 2) 建立 旧id -> 新id 映射
    const idMap = {};
    src.forEach((n) => {
      if (n && n.id) idMap[n.id] = uid('n');
    });

    // 3) 逐个写入，parentId 一并重映射
    const now = Date.now();
    let count = 0;
    for (const n of src) {
      if (!n || !n.id) continue;
      const type = validTypes.has(n.type) ? n.type : 'chapter';
      const node = {
        id: idMap[n.id],
        bookId: book.id,
        parentId: (n.parentId && idMap[n.parentId]) ? idMap[n.parentId] : null,
        type,
        title: typeof n.title === 'string' && n.title ? n.title : '未命名',
        createdAt: n.createdAt || now,
        updatedAt: n.updatedAt || now
      };

      if (type === 'folder') {
        node.content = '';
        node.wordCount = 0;
      } else if (type === 'chapter' || type === 'outline') {
        node.content = typeof n.content === 'string' ? n.content : '';
        node.wordCount = n.wordCount || 0;
      } else if (type === 'setting') {
        node.kind = ['character', 'place', 'world'].includes(n.kind) ? n.kind : 'character';
        node.categories = Array.isArray(n.categories)
          ? n.categories.map((c) => ({
              id: c && c.id ? c.id : uid('cat'),
              name: (c && c.name) || '未命名分类',
              content: (c && c.content) || ''
            }))
          : [];
        node.wordCount = n.wordCount || 0;
      } else if (type === 'timeline') {
        node.events = Array.isArray(n.events)
          ? n.events.map((e) => ({
              id: e && e.id ? e.id : uid('ev'),
              time: (e && e.time) || '',
              text: (e && e.text) || ''
            }))
          : [];
        node.wordCount = n.wordCount || 0;
      }

      await Nodes.putRaw(node);
      count++;
    }

    // 4) 悬空 parentId 兜底：父节点不存在则挂到根目录
    await Nodes.repairOrphans(book.id);

    // 5) 重算字数：不信任备份里的旧值，按实际内容重新统计
    await recountBook(book.id);

    await Books.touch(book.id);
    await renderBooks();
    toast(`已导入《${book.title}》，共 ${count} 项`);
  } catch (e) {
    console.error(e);
    toast('导入失败：' + e.message);
  }
}

$('btn-import-json').addEventListener('click', () => {
  vibrate();
  Modal.open({
    title: '导入书本 JSON',
    desc: '选择之前导出的 .json 备份文件。导入后会作为一本新书加入书阁，不会覆盖现有书本。',
    actions: [
      { label: '取消', kind: 'ghost' },
      { label: '选择文件', kind: 'primary', onClick: () => setTimeout(pickJsonFile, 120) }
    ]
  });
});
