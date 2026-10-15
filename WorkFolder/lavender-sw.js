/* ============================================================
   lavender-sw.js —— 可选的 Service Worker
   ------------------------------------------------------------
   为什么单独一个文件？
     Service Worker 脚本必须是同源 http(s) 文件，浏览器不接受
     blob:/data: URI（会抛 TypeError）。单文件 HTML 无法自带 SW，
     因此把它作为「可选配件」。

   怎么用？
     把本文件与 lavender-novel-pwa.html 放在同一目录（重命名为
     index.html），通过 http(s) 访问，应用会自动发现并注册它，
     从而获得离线可用与更完整的 PWA 安装体验。

   不放也没关系：应用照常工作，IndexedDB 数据同样持久保存。
   ============================================================ */

const CACHE = 'lavender-novel-v1';
const SHELL = ['./', './index.html', './lavender-novel-pwa.html'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (err) { return; }
  if (url.origin !== self.location.origin) return;

  // 导航请求：网络优先，离线回退缓存
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html')))
    );
    return;
  }

  // 其他同源资源：缓存优先
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});
