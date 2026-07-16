const cacheName = "orizon-next-v1";
const basePath = "/proto";
const appShell = [
  `${basePath}/`,
  `${basePath}/manifest.webmanifest`,
  `${basePath}/icons/icon-192.png`,
  `${basePath}/icons/icon-512.png`,
];

interface ExtendableWorkerEvent extends Event {
  waitUntil(promise: Promise<unknown>): void;
}

interface FetchWorkerEvent extends ExtendableWorkerEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}

interface OrizonWorkerScope {
  addEventListener(type: "install" | "activate", listener: (event: ExtendableWorkerEvent) => void): void;
  addEventListener(type: "fetch", listener: (event: FetchWorkerEvent) => void): void;
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
}

const worker = globalThis as unknown as OrizonWorkerScope;

worker.addEventListener("install", (event) => {
  event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(appShell)));
  void worker.skipWaiting();
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== cacheName).map((key) => caches.delete(key))))
      .then(() => worker.clients.claim()),
  );
});

worker.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          void caches.open(cacheName).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;

        if (event.request.mode === "navigate") {
          return (await caches.match(`${basePath}/`)) ?? Response.error();
        }

        return Response.error();
      }),
  );
});
