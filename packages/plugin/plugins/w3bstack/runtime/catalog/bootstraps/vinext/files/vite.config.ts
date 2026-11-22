import { defineConfig } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  server: { host: "__HOST__", port: __PORT__ },
  plugins: [
    vinext(),
    cloudflare({ viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] } }),
  ],
});
