/* ============================================================
   db.js — IndexedDB 数据层
   存储结构：
     books      { id, title, intro, createdAt, updatedAt }
     nodes      { id, bookId, parentId, type:'folder'|'chapter',
                  title, content, wordCount, createdAt, updatedAt }
   ============================================================ */

const DB_NAME = 'lavender-novel';
const DB_VERSION = 2;

let _db = null;

function openDB() {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('books')) {
        const bs = db.createObjectStore('books', { keyPath: 'id' });
        bs.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains('nodes')) {
        const ns = db.createObjectStore('nodes', { keyPath: 'id' });
        ns.createIndex('bookId', 'bookId');
        ns.createIndex('parentId', 'parentId');
        ns.createIndex('book_parent', ['bookId', 'parentId']);
      }
      // v2：应用设置（容量上限等）
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db); };
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return openDB().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    try { out = fn(s); } catch (err) { reject(err); return; }
    t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

/** 生成唯一 id */
function uid(prefix) {
  return (prefix || 'id') + '-' + Date.now().toString(36) + '-' +
         Math.random().toString(36).slice(2, 8);
}

/* ---------------- 书本 ---------------- */

const Books = {
  all() {
    return tx('books', 'readonly', (s) => s.getAll()).then((list) =>
      (list || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))
    );
  },
  get(id) {
    return tx('books', 'readonly', (s) => s.get(id));
  },
  add(title, intro) {
    const now = Date.now();
    const book = {
      id: uid('book'),
      title: title || '未命名书本',
      intro: intro || '',
      createdAt: now,
      updatedAt: now
    };
    return tx('books', 'readwrite', (s) => s.add(book)).then(() => book);
  },
  update(id, patch) {
    return tx('books', 'readwrite', (s) => s.get(id)).then((book) => {
      if (!book) throw new Error('书本不存在');
      Object.assign(book, patch, { updatedAt: Date.now() });
      return tx('books', 'readwrite', (s) => s.put(book)).then(() => book);
    });
  },
  touch(id) {
    return tx('books', 'readwrite', (s) => s.get(id)).then((book) => {
      if (!book) return null;
      book.updatedAt = Date.now();
      return tx('books', 'readwrite', (s) => s.put(book)).then(() => book);
    });
  },
  async remove(id) {
    // 级联删除该书所有节点
    const nodes = await Nodes.byBook(id);
    await tx('nodes', 'readwrite', (s) => {
      nodes.forEach((n) => s.delete(n.id));
      return null;
    });
    return tx('books', 'readwrite', (s) => s.delete(id));
  }
};

/* ---------------- 章节 / 文件夹节点 ---------------- */

const Nodes = {
  byBook(bookId) {
    return tx('nodes', 'readonly', (s) => s.index('bookId').getAll(bookId))
      .then((l) => l || []);
  },
  children(bookId, parentId) {
    return this.byBook(bookId).then((list) => (list || [])
      .filter((n) => (n.parentId || null) === (parentId || null))
      .sort((a, b) => {
        // 文件夹在前，其后按创建时间
        if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
        return (a.createdAt || 0) - (b.createdAt || 0);
      }));
  },
  /** 仅纯文本类节点（章节 + 设定 + 大纲），排除文件夹与时间线 */
  isText(type) { return type === 'chapter' || type === 'setting' || type === 'outline'; },
  /** 是否计入小说总字数：只有章节算，设定/大纲/时间线不算 */
  countsTowardTotal(type) { return type === 'chapter'; },
  get(id) {
    return tx('nodes', 'readonly', (s) => s.get(id));
  },
  addFolder(bookId, parentId, title) {
    const now = Date.now();
    const node = {
      id: uid('folder'), bookId, parentId,
      type: 'folder', title: title || '新建文件夹',
      content: '', wordCount: 0,
      createdAt: now, updatedAt: now
    };
    return tx('nodes', 'readwrite', (s) => s.add(node)).then(() => node);
  },
  addChapter(bookId, parentId, title) {
    const now = Date.now();
    const node = {
      id: uid('chapter'), bookId, parentId,
      type: 'chapter', title: title || '新章节',
      content: '', wordCount: 0,
      createdAt: now, updatedAt: now
    };
    return tx('nodes', 'readwrite', (s) => s.add(node)).then(() => node);
  },
  /**
   * 设定节点（分类列表结构）
   * categories: [{ id, name, content }]
   * @param kind 'character' | 'place' | 'world'
   */
  addSetting(bookId, parentId, title, kind) {
    const now = Date.now();
    const node = {
      id: uid('setting'), bookId, parentId,
      type: 'setting', kind: kind || 'character',
      title: title || '新设定',
      categories: [], wordCount: 0,
      createdAt: now, updatedAt: now
    };
    return tx('nodes', 'readwrite', (s) => s.add(node)).then(() => node);
  },
  /** 故事大纲：纯文本 */
  addOutline(bookId, parentId, title) {
    const now = Date.now();
    const node = {
      id: uid('outline'), bookId, parentId,
      type: 'outline', title: title || '故事大纲',
      content: '', wordCount: 0,
      createdAt: now, updatedAt: now
    };
    return tx('nodes', 'readwrite', (s) => s.add(node)).then(() => node);
  },
  /** 时间线：事件列表 [{ id, time, text }] */
  addTimeline(bookId, parentId, title) {
    const now = Date.now();
    const node = {
      id: uid('timeline'), bookId, parentId,
      type: 'timeline', title: title || '时间线',
      events: [], wordCount: 0,
      createdAt: now, updatedAt: now
    };
    return tx('nodes', 'readwrite', (s) => s.add(node)).then(() => node);
  },
  update(id, patch) {
    return tx('nodes', 'readwrite', (s) => s.get(id)).then((node) => {
      if (!node) throw new Error('节点不存在');
      Object.assign(node, patch, { updatedAt: Date.now() });
      return tx('nodes', 'readwrite', (s) => s.put(node)).then(() => node);
    });
  },
  /** 移动：改 parentId（原记录删除后重建，保持数据一致） */
  move(id, newParentId) {
    return tx('nodes', 'readwrite', (s) => s.get(id)).then((node) => {
      if (!node) throw new Error('节点不存在');
      node.parentId = newParentId;
      node.updatedAt = Date.now();
      return tx('nodes', 'readwrite', (s) => s.put(node)).then(() => node);
    });
  },
  /** 直接写入一条已构造好的节点（导入用） */
  putRaw(node) {
    return tx('nodes', 'readwrite', (s) => s.put(node)).then(() => node);
  },
  /** 修复悬空 parentId：父节点不存在的一律挂到根目录 */
  async repairOrphans(bookId) {
    const all = await this.byBook(bookId);
    const ids = new Set(all.map((n) => n.id));
    const broken = all.filter((n) => n.parentId && !ids.has(n.parentId));
    if (!broken.length) return 0;
    await tx('nodes', 'readwrite', (s) => {
      broken.forEach((n) => { n.parentId = null; s.put(n); });
      return null;
    });
    return broken.length;
  },
  /** 递归删除节点及其所有子孙 */
  remove(id) {
    return this.get(id).then((node) => {
      if (!node) return null;
      return Nodes.byBook(node.bookId).then((all) => {
        // 收集子树（含自身）
        const ids = new Set([id]);
        let grew = true;
        while (grew) {
          grew = false;
          all.forEach((n) => {
            if (!ids.has(n.id) && ids.has(n.parentId)) {
              ids.add(n.id); grew = true;
            }
          });
        }
        return tx('nodes', 'readwrite', (s) => {
          ids.forEach((i) => s.delete(i));
          return ids.size;
        });
      });
    });
  },
  /** 该节点是否为 targetId 的祖先（防止把文件夹移入自己的子目录） */
  isAncestorOf(candidateId, targetId, allNodes) {
    let cur = allNodes.find((n) => n.id === targetId);
    const guard = new Set();
    while (cur && cur.parentId) {
      if (cur.parentId === candidateId) return true;
      if (guard.has(cur.parentId)) return false;
      guard.add(cur.parentId);
      cur = allNodes.find((n) => n.id === cur.parentId);
    }
    return false;
  },
  /** 统计文件夹下的字数与条目数（设定单独计数，不计入小说总字数） */
  folderWordCount(folderId, allNodes) {
    const ids = new Set([folderId]);
    let grew = true;
    while (grew) {
      grew = false;
      allNodes.forEach((n) => {
        if (!ids.has(n.id) && n.parentId && ids.has(n.parentId)) { ids.add(n.id); grew = true; }
      });
    }
    let sum = 0, count = 0, settings = 0, settingWords = 0, others = 0;
    allNodes.forEach((n) => {
      if (n.id === folderId || !ids.has(n.id)) return;
      if (n.type === 'chapter') { sum += n.wordCount || 0; count++; }
      else if (n.type === 'setting') { settingWords += n.wordCount || 0; settings++; }
      else if (n.type === 'outline' || n.type === 'timeline') others++;
    });
    return { words: sum, chapters: count, settings, settingWords, others };
  }
};

/* ---------------- 应用设置 ---------------- */

const Settings = {
  get(key, fallback) {
    return tx('settings', 'readonly', (s) => s.get(key)).then((row) =>
      (row && row.value !== undefined) ? row.value : fallback
    );
  },
  set(key, value) {
    return tx('settings', 'readwrite', (s) => s.put({ key, value }));
  }
};

/* ---------------- 字数统计 ---------------- */

/** 中文按字计，英文/数字按词计，空白不计 */
function countWords(text) {
  if (!text) return 0;
  const t = String(text);
  const cjk = t.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/g);
  const cjkCount = cjk ? cjk.length : 0;
  const rest = t
    .replace(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/g, ' ')
    .replace(/[\p{P}\p{S}]/gu, ' ');
  const words = rest.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
  return cjkCount + words.length;
}
