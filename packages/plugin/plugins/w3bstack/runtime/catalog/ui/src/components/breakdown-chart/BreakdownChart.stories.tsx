import type { Meta, StoryObj } from "@storybook/react-vite";
import { BreakdownChart } from "./BreakdownChart.tsx";

const meta = {
  title: "Components/Data display/Breakdown Chart",
  component: BreakdownChart,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Stacked bar chart with measure, slice and segment pickers. Each bar is a stack of molded bricks with seams between them. Point at a bar, or focus the chart and use the arrow keys, to open its breakdown and light the matching column of the linked table; point at a segment or a table row (or use up and down) to pick that segment out in every bar.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof BreakdownChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const TokensByModel: Story = {
  args: { title: "Token use", defaultMeasure: "tokens", defaultSegment: "model" },
};

export const Weekly: Story = {
  args: { title: "Runs per week", defaultMeasure: "runs", defaultSlice: "week" },
};
