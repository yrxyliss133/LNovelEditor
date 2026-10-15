
/* ============================================================
   PWA 集成层
   - 检测是否运行于 Fennec F-Droid（或 Firefox for Android）
   - 仅在该浏览器下弹出「持久存储」授权确认
   - 注册内联 Service Worker（单文件，无外部资源）
   - 注入 data: URI 的 web app manifest
   ============================================================ */

/* 图标（PNG base64 data URI）—— 由构建脚本注入 */
const PWA_ICONS = window.__PWA_ICONS__ || {};

const PWA = (() => {

  /** 当前 UA 信息 */
  function uaInfo() {
    const ua = navigator.userAgent || '';
    const isFirefox = /firefox|fxios/i.test(ua);
    const isAndroid = /android/i.test(ua);
    // Firefox for Android 的 UA 形如:
    //   Mozilla/5.0 (Android 10; Mobile; rv:130.0) Gecko/130.0 Firefox/130.0
    // Fennec F-Droid 使用同一内核与 UA，无法从 UA 区分 F-Droid 版与商店版，
    // 因此按「Firefox on Android」处理（这正是 Fennec 的运行环境）。
    const isFennec = isFirefox && isAndroid;
    return { ua, isFirefox, isAndroid, isFennec };
  }

  /** 是否已获得持久存储 */
  async function isPersisted() {
    try {
      if (navigator.storage && navigator.storage.persisted) {
        return await navigator.storage.persisted();
      }
    } catch (e) {}
    return false;
  }

  /** 申请持久存储 */
  async function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        return await navigator.storage.persist();
      }
    } catch (e) {}
    return false;
  }

  /** 估算可用空间（供说明文案用） */
  async function quotaInfo() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const e = await navigator.storage.estimate();
        return { usage: e.usage || 0, quota: e.quota || 0 };
      }
    } catch (e) {}
    return { usage: 0, quota: 0 };
  }

  function fmtBytes(n) {
    if (!n) return '未知';
    const KB = 1024, MB = KB * 1024, GB = MB * 1024;
    if (n < MB) return (n / KB).toFixed(1) + ' KB';
    if (n < GB) return (n / MB).toFixed(0) + ' MB';
    return (n / GB).toFixed(1) + ' GB';
  }

  /**
   * Fennec 下弹窗申请持久存储。
   * 用户点「允许」才真正调用 persist()；否则不打扰。
   */
  async function maybeAskPersist() {
    const info = uaInfo();
    if (!info.isFennec) return;                 // 非 Fennec：不申请

    const already = await isPersisted();
    const q = await quotaInfo();

    // 已经持久化过就不再打扰（除非容量快满，提示一次）
    if (already) {
      if (q.quota && q.usage / q.quota > 0.8) {
        toast('存储空间已用 ' + (q.usage / q.quota * 100).toFixed(0) + '%');
      }
      return;
    }

    Modal.open({
      title: '申请持久存储',
      desc: '检测到你在 Fennec F-Droid 中打开本应用。\n\n' +
            '浏览器默认可能在空间紧张时自动清理网站数据。授权「持久存储」后，' +
            '你的小说会被保留，直到你主动清除数据。\n\n' +
            (q.quota ? '当前可用配额约 ' + fmtBytes(q.quota) + '。' : ''),
      choices: [
        {
          icon: '🔒', label: '允许持久存储', hint: '推荐 · 数据更安全',
          onClick: async () => {
            const ok = await requestPersist();
            if (ok) {
              toast('已获得持久存储授权');
            } else {
              // Firefox 可能不弹窗而直接拒绝，引导手动设置
              Modal.open({
                title: '未能自动授权',
                desc: '浏览器没有授予持久存储。你可以在浏览器中手动开启：\n\n' +
                      '地址栏左侧的锁形图标 → 权限 → 「持久存储」设为「允许」，然后刷新页面。',
                actions: [{ label: '知道了', kind: 'primary' }]
              });
            }
          }
        },
        {
          icon: '⏳', label: '暂不申请', hint: '下次打开会再问一次',
          onClick: () => { /* 什么都不做 */ }
        }
      ],
      actions: [{ label: '关闭', kind: 'ghost' }]
    });
  }

  /**
   * 注册 Service Worker（离线可用 + 可安装）。
   *
   * 注意：Service Worker 脚本必须是「同源的 http(s) 文件」，
   * 不能用 blob: / data: URI（浏览器返回 TypeError）。
   * 本应用是单文件交付，没有独立 .js 可放，因此：
   *   - 若页面目录下存在 lavender-sw.js（用户额外放置），则注册它；
   *   - 否则跳过注册，应用功能不受影响（数据仍由 IndexedDB 持久保存，
   *     manifest 仍可让浏览器「添加到主屏幕」）。
   */
  async function registerSW() {
    if (!('serviceWorker' in navigator)) return null;
    if (!/^https?:$/.test(location.protocol)) return null;

    // 探测同目录下是否有可用的 SW 文件
    const candidates = ['lavender-sw.js', './lavender-sw.js'];
    for (const path of candidates) {
      try {
        const res = await fetch(path, { method: 'GET', cache: 'no-store' });
        if (!res.ok) continue;
        const txt = await res.text();
        if (!/addEventListener/.test(txt)) continue;   // 不是 SW 脚本
        const reg = await navigator.serviceWorker.register(path, { scope: './' });
        console.log('Service Worker 已注册：' + path);
        return reg;
      } catch (e) {
        // 继续尝试下一个
      }
    }
    // 单文件模式下没有 SW 文件，属正常情况
    console.log('未找到可注册的 Service Worker 文件（单文件模式，功能不受影响）');
    return null;
  }

  /** 注入 web app manifest（data URI，无需额外文件） */
  function injectManifest(icons) {
    try {
      const manifest = {
        name: '薰小说编辑器',
        short_name: '薰小说',
        description: '薰衣草夜主题的离线小说写作工具',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#17102A',
        theme_color: '#17102A',
        lang: 'zh-CN',
        dir: 'ltr',
        icons: [
          { src: icons.icon192, sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: icons.icon512, sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: icons.maskable512, sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      };
      const json = JSON.stringify(manifest);
      // 用 base64 承载，避免 URI 转义问题
      const b64 = btoa(unescape(encodeURIComponent(json)));
      const link = document.createElement('link');
      link.rel = 'manifest';
      link.href = 'data:application/manifest+json;base64,' + b64;
      document.head.appendChild(link);

      // 图标（favicon / apple-touch-icon）
      const mk = (rel, href) => {
        const l = document.createElement('link');
        l.rel = rel; l.href = href;
        if (rel === 'apple-touch-icon') l.sizes = '192x192';
        document.head.appendChild(l);
      };
      mk('icon', icons.favicon64);
      mk('apple-touch-icon', icons.icon192);

      const mt = document.createElement('meta');
      mt.name = 'theme-color';
      mt.content = '#17102A';
      document.head.appendChild(mt);

      const am = document.createElement('meta');
      am.name = 'apple-mobile-web-app-capable';
      am.content = 'yes';
      document.head.appendChild(am);
    } catch (e) {
      console.warn('manifest 注入失败：', e && e.message);
    }
  }

  /** 显示环境徽标（便于用户确认检测结果） */
  function envBadge() {
    const info = uaInfo();
    const el = document.getElementById('pwa-badge');
    if (!el) return;
    el.textContent = info.isFennec ? 'Fennec 模式' : '浏览器模式';
    el.title = info.ua;
    el.classList.toggle('fennec', info.isFennec);
    el.hidden = false;
  }

  return {
    uaInfo, isPersisted, requestPersist, quotaInfo, fmtBytes,
    maybeAskPersist, registerSW, injectManifest, envBadge
  };
})();

/* ---------------- 启动 ---------------- */

async function bootPWA() {
  try {
    // 1. 注入 manifest 与图标
    PWA.injectManifest(PWA_ICONS);

    // 2. 注册 Service Worker（离线可用 + 可安装）
    await PWA.registerSW();

    // 3. 显示环境徽标
    PWA.envBadge();

    // 4. 仅 Fennec 下询问持久存储（等首屏渲染完成再弹，避免打扰）
    const info = PWA.uaInfo();
    if (info.isFennec) {
      setTimeout(() => { PWA.maybeAskPersist(); }, 900);
    }
  } catch (e) {
    console.warn('PWA 启动异常：', e && e.message);
  }
}
