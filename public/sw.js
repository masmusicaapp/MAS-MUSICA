/* Service worker de MÃ¡s MÃºsica â€” cache para funcionamiento offline */
const CACHE = 'mas-musica-v100';

const ESTATICOS = [
  './',
  './index.html',
  './terminos.html',
  './styles.css?v=100',
  './app.js?v=100',
  './manifest.webmanifest',
  './assets/logo_musica.png',
  './assets/logo_musica_negro.png',
  './assets/logo_mas.png',
  './assets/icon-app-oscuro-192.png',
  './assets/icon-app-oscuro-512.png',
  './assets/icon-app-claro-192.png',
  './assets/marca-agua.png',
  './assets/marca-agua-negro.png',
  './assets/lugar/sala-1.png',
  './assets/lugar/sala-2.png',
  './assets/lugar/sala-3.png'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(ESTATICOS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.map(k => { if (k !== CACHE) return caches.delete(k); }))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  /* La API nunca se cachea: trae datos privados (sesiÃ³n, reservas, avisos) */
  const reqUrl = new URL(req.url);
  if (reqUrl.pathname.startsWith('/api/')) return;

  /* Red primero: la app necesita el servidor (reservas en tiempo real),
     asÃ­ los cambios llegan al instante. La cachÃ© solo es respaldo offline. */
  event.respondWith(
    fetch(req).then(res => {
      if (res.ok && reqUrl.origin === location.origin) {
        const copy = res.clone();
        caches.open(CACHE).then(cache => cache.put(req, copy));
      }
      return res;
    }).catch(() => caches.match(req))
  );
});
