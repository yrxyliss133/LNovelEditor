
/* ============================================================
   APK 集成层
   - 处理 Android 返回键：按视图层级逐级后退
   - 通知原生层当前状态（可选）
   在浏览器中打开时这些函数为无害的空操作。
   ============================================================ */

/**
 * Android 返回键入口。
 * 返回 true  —— 已在页面内处理（不要退出应用）
 * 返回 false —— 无上层视图，允许系统退出
 */
function handleAndroidBack() {
  const active = document.querySelector('.view.active');
  const id = active ? active.id : '';

  // 正在弹悬浮窗 / 长按菜单：先关掉
  if (!$('modal-overlay').hidden) { Modal.close(); return true; }
  if (!$('sheet-overlay').hidden) { Sheet.close(); return true; }

  switch (id) {
    case 'view-editor':
      // 编辑器 -> 章节列表（先落库）
      $('btn-back-chapters').click();
      return true;
    case 'view-timeline':
      $('btn-back-timeline').click();
      return true;
    case 'view-setting':
      $('btn-back-setting').click();
      return true;
    case 'view-search':
      $('btn-back-search').click();
      return true;
    case 'view-chapters':
      // 章节列表：若在子目录则回上级，否则回书阁
      if (state.folderId) {
        const cur = (state.nodesCache || []).find((n) => n.id === state.folderId);
        state.folderId = (cur && cur.parentId) ? cur.parentId : null;
        renderChapters();
      } else {
        $('btn-back-books').click();
      }
      return true;
    case 'view-books':
    default:
      // 已在首页 —— 允许退出
      return false;
  }
}

/* ---------- 导出：在 APK 中通过原生桥写文件 ---------- */

/**
 * 判断是否运行在 APK 容器里
 */
function isNativeShell() {
  return typeof window.AndroidBridge !== 'undefined' && window.AndroidBridge !== null;
}

/**
 * 把 Blob 交给原生层保存到「下载」目录。
 * 浏览器环境返回 false，由调用方走 <a download> 兜底。
 */
function saveBlobNative(blob, filename) {
  if (!isNativeShell() || !blob) return false;
  try {
    const fr = new FileReader();
    fr.onloadend = function () {
      const s = fr.result || '';
      const i = String(s).indexOf(',');
      if (i > 0) {
        window.AndroidBridge.saveBase64(String(s).substring(i + 1), filename, blob.type || '');
      }
    };
    fr.readAsDataURL(blob);
    return true;
  } catch (e) {
    return false;
  }
}
