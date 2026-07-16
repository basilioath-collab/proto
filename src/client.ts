import { bootstrapOrizon } from "./legacy/app";
import { registerOrizonServiceWorker } from "./lib/register-service-worker";

declare global {
  interface Window {
    __orizonBootstrapped?: boolean;
  }
}

function startOrizon(): void {
  if (window.__orizonBootstrapped) return;

  bootstrapOrizon();
  window.__orizonBootstrapped = true;
  void registerOrizonServiceWorker();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startOrizon, { once: true });
} else {
  startOrizon();
}
