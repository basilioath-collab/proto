const basePath = "/proto";

export async function registerOrizonServiceWorker(): Promise<void> {
  const canRegister =
    "serviceWorker" in navigator &&
    (location.protocol === "https:" ||
      location.hostname === "localhost" ||
      location.hostname === "127.0.0.1");

  if (!canRegister) return;

  try {
    const registration = await navigator.serviceWorker.register(`${basePath}/sw.js`, {
      scope: `${basePath}/`,
    });

    await registration.update().catch(() => undefined);

    let refreshing = false;
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  } catch (error) {
    console.warn("[ORIZON PWA] Service Worker não registrado:", error);
  }
}
