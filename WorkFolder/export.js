
/* ============================================================
   导出：单个 Markdown 文件
   两种范围：
     full    —— 整本全部内容（章节 + 文件夹 + 设定 + 时间线 + 大纲）
     basic   —— 只导出文件夹和章节两样
   ============================================================ */

/** 文件名净化 */
function safeFileName(name) {
  return String(name || '未命名')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^\s+|\s+$/g, '')
    .slice(0, 80) || '未命名';
}

/** 时间戳 YYYYMMDD-HHmm */
function stamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`;
}

/** 按节点树渲染（递归），返回 markdown 行数组 */
function renderTree(bookId, parentId, all, opts, depth, lines) {
  const kids = all
    .filter((n) => (n.parentId || null) === (parentId || null))
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return (a.createdAt || 0) - (b.createdAt || 0);
    });

  for (const node of kids) {
    if (node.type === 'folder') {
      // 文件夹标题层级：从 ## 开始，每层递进，最深到 #####
      const lvl = Math.min(2 + depth, 5);
      lines.push('');
      lines.push('#'.repeat(lvl) + ' ' + node.title);
      lines.push('');
      renderTree(bookId, node.id, all, opts, depth + 1, lines);

    } else if (node.type === 'chapter') {
      // 章节比同级文件夹深一级；嵌套过深时封顶，避免标题层级失控
      const lvl = Math.min(depth === 0 ? 2 : depth + 2, 4);
      lines.push('');
      lines.push('#'.repeat(lvl) + ' ' + node.title);
      lines.push('');
      const body = (node.content || '').trim();
      lines.push(body || '_（本章暂无内容）_');
      lines.push('');

    } else if (node.type === 'outline' && opts.includeExtras) {
      lines.push('');
      lines.push('#'.repeat(Math.min(depth === 0 ? 2 : depth + 2, 4)) + ' 🧭 ' + node.title + '（故事大纲）');
      lines.push('');
      lines.push((node.content || '').trim() || '_（暂无内容）_');
      lines.push('');

    } else if (node.type === 'timeline' && opts.includeExtras) {
      lines.push('');
      lines.push('#'.repeat(Math.min(depth === 0 ? 2 : depth + 2, 4)) + ' 🕰 ' + node.title + '（时间线）');
      lines.push('');
      const evs = node.events || [];
      if (!evs.length) {
        lines.push('_（暂无事件）_');
      } else {
        evs.forEach((ev) => {
          const t = (ev.time || '').trim() || '—';
          const x = (ev.text || '').trim() || '';
          lines.push(`- **${t}**　${x}`);
        });
      }
      lines.push('');

    } else if (node.type === 'setting' && opts.includeExtras) {
      const kind = KIND_LABEL[node.kind || 'character'];
      lines.push('');
      lines.push('#'.repeat(Math.min(depth === 0 ? 2 : depth + 2, 4)) + ' ' +
        KIND_ICON[node.kind || 'character'] + ' ' + node.title + '（' + kind + '设定）');
      lines.push('');
      const cats = node.categories || [];
      if (!cats.length) {
        lines.push('_（暂无分类）_');
      } else {
        cats.forEach((c) => {
          // 分类名固定为 H5，稳在设定标题之下
          lines.push('##### ' + (c.name || '未命名分类'));
          lines.push('');
          lines.push((c.content || '').trim() || '_（暂无内容）_');
          lines.push('');
        });
      }
      lines.push('');
    }
  }
  return lines;
}

/** 生成整本 markdown */
function buildMarkdown(book, all, opts) {
  const lines = [];
  const now = new Date();
  const p = (n) => String(n).padStart(2, '0');

  lines.push('# ' + book.title);
  lines.push('');
  if (book.intro) {
    lines.push('> ' + book.intro.replace(/\n/g, '\n> '));
    lines.push('');
  }

  // 统计
  const chapters = all.filter((n) => n.type === 'chapter');
  const words = chapters.reduce((s, n) => s + (n.wordCount || 0), 0);
  const meta = [`共 ${chapters.length} 章`, `${words} 字`];
  if (opts.includeExtras) {
    const st = all.filter((n) => n.type === 'setting').length;
    const tl = all.filter((n) => n.type === 'timeline').length;
    const ol = all.filter((n) => n.type === 'outline').length;
    if (st) meta.push(`${st} 条设定`);
    if (tl) meta.push(`${tl} 条时间线`);
    if (ol) meta.push(`${ol} 份大纲`);
  }
  lines.push('*' + meta.join(' · ') + '*');
  lines.push('');
  lines.push(`*导出时间：${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}*`);
  lines.push('');
  lines.push('---');

  renderTree(book.id, null, all, opts, 0, lines);

  // 收尾：折叠多余空行
  let out = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
  return out;
}

/** 选择导出范围 */
function exportDialog(book) {
  Modal.open({
    title: '导出为 Markdown',
    desc: `《${book.title}》导出为单个 .md 文件`,
    choices: [
      {
        icon: '📚', label: '导出整本全部内容',
        hint: '章节 + 文件夹 + 设定 + 时间线 + 大纲',
        onClick: () => doExport(book, { includeExtras: true })
      },
      {
        icon: '📄', label: '只导出文件夹和章节',
        hint: '不含设定、时间线、故事大纲',
        onClick: () => doExport(book, { includeExtras: false })
      }
    ],
    actions: [{ label: '取消', kind: 'ghost' }]
  });
}

/** 执行导出（浏览器下载） */
async function doExport(book, opts) {
  try {
    const all = await Nodes.byBook(book.id);
    if (!all.length) { toast('这本书还是空的'); return; }

    const md = buildMarkdown(book, all, opts);
    const filename = safeFileName(book.title) + (opts.includeExtras ? '' : '-章节') + '-' + stamp() + '.md';
    const blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });

    // APK 环境优先走原生桥（写到系统「下载」目录）
    if (typeof saveBlobNative === 'function' && saveBlobNative(blob, filename)) {
      toast(`已导出 ${filename}`);
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

    toast(`已导出 ${filename}`);
  } catch (e) {
    console.error(e);
    toast('导出失败：' + e.message);
  }
}
