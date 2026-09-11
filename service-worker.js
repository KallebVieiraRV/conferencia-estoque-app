// Service Worker do PWA de contagem — cache-first só pro "app shell" estático
// (HTML/CSS/JS/ícones/manifest). Chamadas ao Apps Script (script.google.com)
// NUNCA passam pelo cache daqui — vão direto pra rede; a persistência offline
// dos dados de área é responsabilidade do IndexedDB (app/js/data/db.js e
// sync-queue.js, Fase 10), não deste Service Worker.
//
// Bump manual do CACHE_NAME a cada release que mude algum asset estático —
// o `activate` limpa qualquer cache com nome antigo automaticamente.

const CACHE_NAME = 'conf-estoque-v8';

// Lista viva: cresce nas próximas fases conforme mais telas entrarem.
const STATIC_ASSETS = [
  './',
  './index.html',
  './import.html',
  './manifest.json',
  './css/styles.css',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-512-maskable.png',
  './js/vendor/xlsx.full.min.js',
  './js/core/area.js',
  './js/core/xls-parser.js',
  './js/core/grouping.js',
  './js/core/compare.js',
  './js/core/proportional-split.js',
  './js/data/api-client.js',
  './js/data/db.js',
  './js/data/sync-queue.js',
  './js/ui/screen-import.js',
  './js/ui/screen-counting.js',
  './js/ui/sync-status-badge.js',
  './js/ui/dom-utils.js',
];

self.addEventListener('install', (evento) => {
  evento.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)),
  );
  self.skipWaiting();
});

self.addEventListener('activate', (evento) => {
  evento.waitUntil(
    caches.keys().then((nomesDeCache) =>
      Promise.all(
        nomesDeCache
          .filter((nome) => nome !== CACHE_NAME)
          .map((nome) => caches.delete(nome)),
      ),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (evento) => {
  const requisicao = evento.request;

  // Só intercepta GET de mesma origem. Chamadas ao Apps Script (outra
  // origem — script.google.com) passam direto pela rede, sem cache nenhum.
  const ehMesmaOrigem = new URL(requisicao.url).origin === self.location.origin;
  if (requisicao.method !== 'GET' || !ehMesmaOrigem) return;

  evento.respondWith(
    caches.match(requisicao).then((respostaEmCache) => respostaEmCache || fetch(requisicao)),
  );
});
