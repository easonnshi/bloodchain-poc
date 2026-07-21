import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// The /api proxy points at the local BloodChain API server (server/index.js),
// which holds the Hedera keys. Mirror-node reads go straight from the browser
// to https://testnet.mirrornode.hedera.com - no proxy, that's the point:
// the public ledger is readable without trusting our stack.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:4000",
    },
  },
});
