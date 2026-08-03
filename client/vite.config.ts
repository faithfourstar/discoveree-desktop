import react from "@vitejs/plugin-react";
import path from "node:path";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5180,
    // The desktop server binds 127.0.0.1:7317; the SPA talks relative /api.
    proxy: {
      "/api": "http://127.0.0.1:7317",
    },
  },
});
