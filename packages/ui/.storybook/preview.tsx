import type { Preview } from "@storybook/react-vite";
import "../src/tokens.css";

const preview: Preview = {
  globalTypes: {
    theme: {
      description: "Styrene theme",
      toolbar: {
        title: "Theme",
        icon: "mirror",
        items: [
          { value: "light", title: "Styrene (light)" },
          { value: "dark", title: "Gunmetal (dark)" },
        ],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: { theme: "light" },
  parameters: {
    layout: "centered",
    controls: { expanded: true },
    options: {
      storySort: { order: ["Foundations", "Components", ["Agents", "Chat", "Inputs", "Data display", "Feedback", "Navigation", "Cards", "Buttons"]] },
    },
  },
  decorators: [
    (Story, context) => {
      const theme = context.globals.theme === "dark" ? "dark" : "light";
      document.documentElement.dataset.theme = theme;
      return (
        <div className="kb-root kb-stage">
          <Story />
        </div>
      );
    },
  ],
};

export default preview;
