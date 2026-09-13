import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": `${import.meta.dirname}/src/client` },
  },
  server: {
    proxy: {
      "/api": "http://localhost:3000",
      "/events": "http://localhost:3000",
      "/tasks": "http://localhost:3000",
    },
  },
});
