import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const basePath = "/proto";

export const metadata: Metadata = {
  metadataBase: new URL("https://basilioath-collab.github.io"),
  title: "ORIZON - Planejamento & Performance",
  description: "Planning & Capacity Platform",
  applicationName: "ORIZON",
  manifest: `${basePath}/manifest.webmanifest`,
  icons: {
    icon: [
      { url: `${basePath}/icons/icon-192.png`, sizes: "192x192", type: "image/png" },
      { url: `${basePath}/icons/icon-512.png`, sizes: "512x512", type: "image/png" },
    ],
    apple: `${basePath}/icons/icon-192.png`,
  },
  appleWebApp: {
    capable: true,
    title: "ORIZON",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#050505",
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="pt-BR">
      <body>{children}</body>
    </html>
  );
}
