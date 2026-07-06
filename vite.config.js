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
      includeAssets: ["favicon.svg", "favicon.ico", "favicon-64.png", "apple-touch-icon.png", "robots.txt", "og-image.png"],
      manifest: {
        name: "Kicker — Mobile Poker",
        short_name: "Kicker",
        description: "Clean Texas Hold'em against four AI players. Live win odds on every street.",
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
