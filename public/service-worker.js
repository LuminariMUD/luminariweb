const CACHE_NAME = 'luminari-web-shell-v1';
/**
 * Onboarding media is versioned in its own path segment and kept in its own
 * cache, so a deploy that bumps the media version can drop the old bytes
 * without touching the application shell. Nothing here caches a password, a
 * terminal transcript, an account name, or role-play text: only files served
 * from the versioned static media directory are eligible.
 */
const MEDIA_CACHE_PREFIX = 'luminari-web-media-';
const MEDIA_VERSION = 'v1';
const MEDIA_CACHE_NAME = `${MEDIA_CACHE_PREFIX}${MEDIA_VERSION}`;
const MEDIA_PATH_PREFIX = `/media/onboarding/${MEDIA_VERSION}/`;
const PRECACHE_URLS = ['/', '/index.html', '/manifest.webmanifest'];
const STATIC_ASSET_EXTENSIONS = new Set([
  '.css',
  '.html',
  '.ico',
  '.js',
  '.png',
  '.svg',
  '.webmanifest',
  '.webp',
  '.woff',
  '.woff2',
]);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((cacheNames) =>
        Promise.all(
          cacheNames
            .filter((cacheName) => cacheName !== CACHE_NAME && cacheName !== MEDIA_CACHE_NAME)
            .map((cacheName) => caches.delete(cacheName)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (shouldBypassRequest(event.request)) {
    return;
  }

  const url = new URL(event.request.url);
  if (isVersionedMediaPath(url.pathname)) {
    event.respondWith(fetchVersionedMedia(event.request));
    return;
  }

  event.respondWith(fetchStaticAsset(event.request));
});

/** Versioned media is immutable, so cache-first is safe and saves bytes. */
async function fetchVersionedMedia(request) {
  const cache = await caches.open(MEDIA_CACHE_NAME);
  const cachedResponse = await cache.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);
  await putInCache(cache, request, response);
  return response;
}

/**
 * Storing a response must never break the request that produced it. A partial
 * (206) response cannot be cached at all, and quota or storage failures are
 * not the caller's problem: media elements treat a rejected fetch as an
 * undecodable source and go silent.
 */
async function putInCache(cache, request, response) {
  if (!isCacheableResponse(response)) {
    return;
  }

  try {
    await cache.put(request, response.clone());
  } catch (error) {
    // Nothing to do: the live response is still returned to the caller.
  }
}

function isVersionedMediaPath(pathname) {
  return pathname.startsWith(MEDIA_PATH_PREFIX);
}

async function fetchStaticAsset(request) {
  const cache = await caches.open(CACHE_NAME);

  try {
    const response = await fetch(request);
    await putInCache(cache, request, response);
    return response;
  } catch (error) {
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
      return cachedResponse;
    }

    if (request.mode === 'navigate') {
      const cachedShell = await cache.match('/');
      if (cachedShell) {
        return cachedShell;
      }
    }

    throw error;
  }
}

function shouldBypassRequest(request) {
  if (request.method !== 'GET') {
    return true;
  }

  if ((request.headers.get('upgrade') || '').toLowerCase() === 'websocket') {
    return true;
  }

  // Media elements seek with Range requests. The Cache API cannot represent a
  // partial response, and answering one with a full body makes audio and video
  // fail to decode, so these always go straight to the network.
  if (request.headers.has('range')) {
    return true;
  }

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) {
    return true;
  }

  if (isApiRoute(url.pathname) || isWebSocketRoute(url.pathname)) {
    return true;
  }

  if (isVersionedMediaPath(url.pathname)) {
    return false;
  }

  return !isStaticShellPath(url.pathname);
}

function isCacheableResponse(response) {
  // Only a complete 200 body is storable; 206 partials throw on cache.put().
  return response.status === 200 && response.type === 'basic';
}

function isApiRoute(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/');
}

function isWebSocketRoute(pathname) {
  return pathname === '/ws' || pathname.startsWith('/ws/');
}

function isStaticShellPath(pathname) {
  if (pathname === '/' || pathname === '/index.html') {
    return true;
  }

  if (pathname.startsWith('/assets/')) {
    return Boolean(getStaticExtension(pathname));
  }

  return STATIC_ASSET_EXTENSIONS.has(getStaticExtension(pathname));
}

function getStaticExtension(pathname) {
  const extensionStart = pathname.lastIndexOf('.');
  return extensionStart >= 0 ? pathname.slice(extensionStart).toLowerCase() : '';
}
