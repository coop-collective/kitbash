import type { Meta, StoryObj } from "@storybook/react-vite";
import { WritingAssistant } from "./WritingAssistant.tsx";

const meta = {
  title: "Components/Chat/Writing Assistant",
  component: WritingAssistant,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "AI writing card with suggestions, streamed rewrites you can drop into the draft, and live voice dictation. Instead of a decorative gradient glow, the rim is edge-lit like clear acrylic: it lights ultramarine only while the assistant is writing or listening.",
      },
    },
  },
  args: { demo: true },
} satisfies Meta<typeof WritingAssistant>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Idle: Story = {
  args: { demo: false },
};

export const Dictating: Story = {
  args: { demo: false, defaultListening: true },
};
