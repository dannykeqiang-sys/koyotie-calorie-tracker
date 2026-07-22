// Service Worker - 版本控制 + 移动端优化
const CACHE_VERSION = 'v3.3.0';
const CACHE_NAME = `calorie-tracker-${CACHE_VERSION}`;

// 从 SW 的 scope 动态计算 base 路径（适配 GitHub Pages 子目录部署）
const BASE_PATH = new URL(self.registration?.scope || self.location.origin + '/').pathname;

// 静态资源列表（使用相对路径，相对于 SW 所在位置）
const STATIC_ASSETS = [
  './',
  './manifest.json',
  './icon-192.svg',
  './icon-512.svg',
  './favicon.svg'
];

// 安装阶段：预缓存静态资源（不包含 index.html，确保每次都获取最新版）
self.addEventListener('install', (event) => {
  console.log('[SW] Installing version:', CACHE_VERSION);
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Caching static assets');
      return cache.addAll(STATIC_ASSETS);
    })
  );
  // 立即激活新版本，不等待旧版本卸载
  self.skipWaiting();
});

// 激活阶段：清理所有旧版本缓存
self.addEventListener('activate', (event) => {
  console.log('[SW] Activating version:', CACHE_VERSION);
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Claiming clients');
      return self.clients.claim();
    })
  );
});

// 请求拦截：导航请求强制网络优先，其他资源 Network First
self.addEventListener('fetch', (event) => {
  // 跳过非 GET 请求
  if (event.request.method !== 'GET') return;

  // 导航请求：强制从网络获取（确保用户总是获取最新版）
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request, {
        cache: 'no-cache',  // 强制跳过 HTTP 缓存
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      }).catch(() => {
        // 网络失败时，返回已缓存的 index.html 作为离线回退
        return caches.match('./index.html').then((cached) => {
          return cached || new Response(
            '<!DOCTYPE html><html><head><meta charset="utf-8"><title>离线</title></head><body style="font-family:system-ui;text-align:center;padding:2rem"><h1>🔥 燃烧我的卡路里</h1><p>当前无法连接到网络</p><p>请检查网络连接后刷新页面</p></body></html>',
            {
              status: 503,
              statusText: 'Service Unavailable',
              headers: { 'Content-Type': 'text/html; charset=utf-8' }
            }
          );
        });
      })
    );
    return;
  }

  // 图片请求：Cache First（Unsplash/wsrv.nl URL 稳定，可激进缓存）
  if (event.request.destination === 'image') {
    event.respondWith(
      (async () => {
        const cache = await caches.open(CACHE_NAME);
        // 优先从缓存返回，命中则零延迟
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
          // 后台静默更新缓存（stale-while-revalidate 模式）
          fetch(event.request).then((freshResponse) => {
            if (freshResponse.ok && freshResponse.status === 200) {
              cache.put(event.request, freshResponse);
            }
          }).catch(() => {});
          return cachedResponse;
        }
        // 缓存未命中：走网络并缓存
        try {
          const networkResponse = await fetch(event.request);
          if (networkResponse.ok && networkResponse.status === 200) {
            cache.put(event.request, networkResponse.clone());
          }
          return networkResponse;
        } catch {
          return new Response('', { status: 404, statusText: 'Image offline' });
        }
      })()
    );
    return;
  }

  // 其他资源：Network First 策略
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      try {
        // 1. 尝试从网络获取
        const networkResponse = await fetch(event.request);

        // 2. 如果成功，更新缓存并返回
        if (networkResponse.ok) {
          cache.put(event.request, networkResponse.clone());
          return networkResponse;
        }

        throw new Error('Network response was not ok');
      } catch (error) {
        // 3. 网络失败，尝试从缓存返回
        console.log('[SW] Network failed, trying cache:', event.request.url);
        const cachedResponse = await cache.match(event.request);

        if (cachedResponse) {
          return cachedResponse;
        }

        // 4. 最终失败：返回友好的离线提示
        return new Response(
          JSON.stringify({ error: 'offline', message: '当前无法连接到网络' }),
          {
            status: 503,
            statusText: 'Service Unavailable',
            headers: { 'Content-Type': 'application/json' }
          }
        );
      }
    })()
  );
});

// 监听消息：支持手动清除缓存
self.addEventListener('message', (event) => {
  if (event.data === 'clear-cache') {
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          console.log('[SW] Clearing cache:', name);
          return caches.delete(name);
        })
      );
    }).then(() => {
      event.ports[0].postMessage({ success: true });
    });
  }
});
