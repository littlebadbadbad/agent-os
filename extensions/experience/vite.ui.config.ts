import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));

const outDir = process.env.PLUGIN_OUT_DIR
  ? resolve(process.env.PLUGIN_OUT_DIR, "ui")
  : resolve(__dirname, "..", "..", "plugins", "experience", "ui");

export default defineConfig({
  root: resolve(__dirname, "ui"),
  base: "./",
  resolve: {
    alias: {
      "@agent-type": resolve(__dirname, "..", "..", "agent-type", "index.ts"),
    },
  },
  build: {
    outDir,
    emptyOutDir: true,
    target: "es2022",
  },
  plugins: [react()],
});
