import { defineConfig } from "astro/config";

// Served from GitHub Pages at https://fladioarmandika.github.io/api-time-machine/
export default defineConfig({
  site: "https://fladioarmandika.github.io",
  base: "/api-time-machine",
  trailingSlash: "ignore",
  build: { format: "directory" },
});
