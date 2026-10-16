/* ================================================================
 *  英単語ドリル Service Worker（オフライン対応）
 *  方針：ネット優先 → つながらない・遅いときだけ保存しておいたものを使う
 *  ・先生が index.html を更新すると、生徒が次に開いたとき自動で最新版になる
 *  ・電波がないときも、前回開いたドリルがそのまま使える
 *  ※ ファイル構成を変えたときだけ CACHE の名前（v1 → v2）を変えてください
 * ================================================================ */
const CACHE = 'tango-drill-v2';                         // ドリルごとに別の名前（同じサイト内で混ざらないように）
const PREFIX = CACHE.replace(/v\d+$/, '');
const FILES = ['./', 'index.html', 'manifest.webmanifest', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png'];
const NETWORK_TIMEOUT_MS = 5000;   // これより遅いときは保存済みのものを先に表示

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => Promise.all(FILES.map((f) => cache.add(f).catch(() => {}))))  // 無いファイルがあっても失敗させない
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // 外部サイトは関与しない

  const isPage = req.mode === 'navigate';
  event.respondWith(networkFirst(req, isPage));
});

async function networkFirst(req, isPage) {
  const cache = await caches.open(CACHE);
  const url = new URL(req.url);
  // ページは ?openExternalBrowser=1 などを取り除いたURLで保存する（同じページが何個も保存されないように）
  const key = isPage ? url.origin + url.pathname : req;

  const fromNetwork = fetch(req).then((res) => {
    if (res && res.ok && res.type === 'basic') cache.put(key, res.clone()).catch(() => {});
    return res;
  });
  fromNetwork.catch(() => {});   // オフライン時のエラーは下でまとめて処理

  const cached = () => cache.match(key, { ignoreSearch: true })
    .then((hit) => hit || (isPage && url.pathname.endsWith('/') ? cache.match(url.pathname + 'index.html') : undefined));

  try {
    // 一定時間でネットが返ってこなければ、保存済みのものを使う
    const timeout = new Promise((resolve) => setTimeout(() => resolve('timeout'), NETWORK_TIMEOUT_MS));
    const first = await Promise.race([fromNetwork, timeout]);
    if (first !== 'timeout') return first;
    const hit = await cached();
    return hit || await fromNetwork;
  } catch (e) {
    const hit = await cached();
    if (hit) return hit;
    throw e;
  }
}
