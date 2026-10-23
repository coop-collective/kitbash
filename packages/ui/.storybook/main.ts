import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  stories: ["../src/**/*.mdx", "../src/**/*.stories.@(ts|tsx)"],
  framework: { name: "@storybook/react-vite", options: {} },
  docs: { defaultName: "Docs" },
  core: { disableTelemetry: true },
  // "use client" marks components for React Server Component apps; the Storybook bundle has no server, so the
  // bundler's notice that it ignores the directive is expected and silenced here.
  viteFinal: (config) => ({
    ...config,
    build: {
      ...config.build,
      rolldownOptions: {
        ...config.build?.rolldownOptions,
        onLog(level, log, handler) {
          if (log.code === "MODULE_LEVEL_DIRECTIVE") return;
          handler(level, log);
        },
      },
    },
  }),
};

export default config;
