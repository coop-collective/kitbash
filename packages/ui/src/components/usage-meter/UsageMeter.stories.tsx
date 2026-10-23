import type { Meta, StoryObj } from "@storybook/react-vite";
import { UsageMeter } from "./UsageMeter.tsx";

const meta = {
  title: "Components/Data display/Usage Meter",
  component: UsageMeter,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Plan usage and AI credits: a stacked meter by category seated in a recessed tray, a daily sparkline and the plan limit. Past the warning line the limit tab and the action turn decal yellow and the footer says when credits run out at the current pace.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof UsageMeter>;

export default meta;
type Story = StoryObj<typeof meta>;

/** 87% used with eight days left: the meter asks for a decision. */
export const Default: Story = {};

export const Comfortable: Story = {
  args: { limit: 100_000, warnAt: 0.8 },
};

export const Live: Story = {
  args: {
    demo: true,
    limit: 40_000,
    categories: [
      { id: "agents", label: "Agent runs", used: 14_200 },
      { id: "chat", label: "Chat", used: 8_100 },
      { id: "search", label: "Web search", used: 3_900 },
      { id: "embed", label: "Embeddings", used: 1_800 },
    ],
  },
};

export const OutOfCredits: Story = {
  args: {
    limit: 34_760,
    daysLeft: 3,
    resetLabel: "Resets Oct 26",
  },
};
