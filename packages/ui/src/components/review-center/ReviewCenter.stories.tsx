import type { Meta, StoryObj } from "@storybook/react-vite";
import { ReviewCenter, sampleReviews } from "./ReviewCenter.tsx";

const meta = {
  title: "Components/Agents/Review Center",
  component: ReviewCenter,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A focused workspace for what your agents want to do. The queue is sorted by risk; one item is shown at a time with the spans the agent is unsure of marked in decal (hover or focus for the reason). Focus the panel and use A approve, E edit, R reject, S skip. Each decision presses a stamp into the card before it leaves and the next item rises in.",
      },
    },
  },
} satisfies Meta<typeof ReviewCenter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const LowRiskOnly: Story = { args: { items: sampleReviews.filter((r) => r.risk === "low") } };

export const QueueClear: Story = { args: { items: [] } };
