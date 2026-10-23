import type { Meta, StoryObj } from "@storybook/react-vite";
import { ContextWindow } from "./ContextWindow.tsx";

const meta = {
  title: "Components/Agents/Context Window",
  component: ContextWindow,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "What fills the model's context, drawn as a memory dump: one cell per thousand tokens, fifty to a line, each line addressed by the token offset it starts at. Hover or focus a part to light its cells. Remove a file and its cells clear; compact the conversation and its cells shimmer, clear, and a short summary takes their place. The conversation keeps growing while the demo runs.",
      },
    },
  },
  args: { autoplay: true, limit: 200000, perCell: 1000, compactTo: 6400 },
} satisfies Meta<typeof ContextWindow>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Nearly full: the reading turns red and compaction becomes the primary action. */
export const NearlyFull: Story = {
  args: {
    autoplay: false,
    parts: [
      { id: "sys", kind: "system", label: "System prompt", tokens: 3200 },
      { id: "tools", kind: "tools", label: "Tool definitions", tokens: 14800, detail: "23 tools" },
      { id: "f3", kind: "file", label: "payments-sdk.md", tokens: 22600 },
      { id: "f4", kind: "file", label: "openapi.yaml", tokens: 31200 },
      { id: "conv", kind: "conversation", label: "Conversation", tokens: 115900, detail: "88 turns" },
    ],
  },
};

/** A small 32k model: each cell is 160 tokens, so each line covers 8k. */
export const SmallModel: Story = {
  args: {
    autoplay: false,
    limit: 32000,
    perCell: 160,
    compactTo: 1800,
    parts: [
      { id: "sys", kind: "system", label: "System prompt", tokens: 1400 },
      { id: "tools", kind: "tools", label: "Tool definitions", tokens: 3900, detail: "6 tools" },
      { id: "f1", kind: "file", label: "README.md", tokens: 2600 },
      { id: "conv", kind: "conversation", label: "Conversation", tokens: 11800, detail: "19 turns" },
    ],
  },
};
