import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  server: {
    proxy: { "/ws": { target: "http://localhost:8787", ws: true } },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // Brand logos must be precached too: they are referenced at runtime by the app
      // (header, card back, empty states) but are NOT auto-globbed into the precache,
      // so without this they load from network only and show a broken "?" when the
      // service worker serves the shell offline or from a stale cache.
      includeAssets: ["favicon.svg", "favicon.ico", "favicon-64.png", "apple-touch-icon.png", "robots.txt", "og-image.png", "logo-mark.png", "logo-lockup.png", "logo-lockup-white.png"],
      workbox: {
        // Defense in depth: cache any image request at runtime so future images are
        // covered too, not just the logos listed above.
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "StaleWhileRevalidate",
            options: {
              cacheName: "images",
              expiration: { maxEntries: 60, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
      manifest: {
        name: "Kicker — Multiplayer Poker",
        short_name: "Kicker",
        description: "Clean Texas Hold'em vs friends, or AI players. Live win odds on every street.",
        theme_color: "#EDEFF2",
        background_color: "#EDEFF2",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        id: "/",
        lang: "en",
        categories: ["games", "entertainment"],
        icons: [
          { "src": "pwa-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any" },
          { "src": "pwa-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any" },
          { "src": "pwa-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
        ]
      }
    })
  ]
});
