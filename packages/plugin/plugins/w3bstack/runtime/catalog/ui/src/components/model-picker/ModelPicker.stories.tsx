import type { Meta, StoryObj } from "@storybook/react-vite";
import { ModelPicker } from "./ModelPicker.tsx";

const meta = {
  title: "Components/Chat/Model Picker",
  component: ModelPicker,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The model menu of an AI chat. Point at a model (or arrow through the list) and its speed, quality and cost click in as rows of molded pips; extended thinking unfolds an effort selector, and the tray rolls the first-token time and price for what you have pointed at.",
      },
    },
  },
  args: { defaultOpen: true },
  decorators: [(Story) => <div style={{ width: 560, minHeight: 480 }}><Story /></div>],
} satisfies Meta<typeof ModelPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ThinkingOn: Story = {
  name: "Thinking on",
  args: { defaultModel: "kestrel-max", defaultThinking: true, defaultEffort: "high" },
};

export const Closed: Story = {
  args: { defaultOpen: false, defaultThinking: true },
  decorators: [(Story) => <div style={{ minHeight: 0 }}><Story /></div>],
};
