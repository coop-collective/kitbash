import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChangeSummary } from "./ChangeSummary.tsx";

const meta = {
  title: "Components/Data display/Change Summary",
  component: ChangeSummary,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "What moved since last time. One metric per row with its current value, a trend colored by whether the move is good for that metric, and detent notches for how far it moved. A bad move past a metric's alert line gets the decal-yellow flag until someone marks it as seen.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof ChangeSummary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AllQuiet: Story = {
  args: {
    title: "Overnight",
    baselines: ["Yesterday"],
    metrics: [
      { id: "runs", label: "Agent runs", now: 3120, before: [3096] },
      { id: "fail", label: "Failed runs", now: 14, before: [17], lowerIsBetter: true, alertAt: 0.2 },
      { id: "queue", label: "Approvals waiting", now: 2, before: [2], lowerIsBetter: true },
    ],
  },
};

export const SpendSpike: Story = {
  args: {
    title: "Weekly cost check",
    baselines: ["Last week", "4 weeks ago"],
    metrics: [
      { id: "spend", label: "Model spend", now: 2840, before: [1910, 1720], lowerIsBetter: true, alertAt: 0.25, format: (v) => `$${v.toLocaleString("en-US")}` },
      { id: "tokens", label: "Tokens per task", now: 18.4, before: [12.1, 11.8], lowerIsBetter: true, alertAt: 0.3, format: (v) => `${v.toFixed(1)}k` },
      { id: "tasks", label: "Tasks completed", now: 9120, before: [8840, 8010] },
    ],
  },
};
