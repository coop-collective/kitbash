import type { Meta, StoryObj } from "@storybook/react-vite";
import { KpiChart } from "./KpiChart.tsx";

const meta = {
  title: "Components/Data display/KPI Chart",
  component: KpiChart,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Metric card with a multi-line chart, labeled where each line ends instead of in a legend; the end labels show each line's value and hide or show it. Shaded bands explain the shape of the data (here, weekends). Point at the chart (or focus it and use the arrow keys) and a seam pin snaps to the nearest day; the headline rolls to that day's total and a tooltip lists each line.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof KpiChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Spend: Story = {
  args: {
    title: "Model spend",
    lowerIsBetter: true,
    format: (v) => `$${Math.round(v).toLocaleString("en-US")}`,
    series: [
      { id: "opus", label: "Large model", values: [182, 190, 176, 120, 114, 205, 221, 214, 236, 229, 131, 122, 248, 262] },
      { id: "fast", label: "Fast model", values: [64, 70, 66, 41, 38, 77, 80, 79, 83, 85, 44, 40, 91, 96] },
    ],
  },
};

export const SingleLine: Story = {
  args: {
    title: "Runs needing a person",
    lowerIsBetter: true,
    series: [{ id: "hitl", label: "Escalated runs", values: [18, 22, 19, 9, 7, 24, 21, 17, 15, 14, 6, 5, 12, 11] }],
  },
};

/** While data loads: the same layout as skeleton parts. */
export const Loading: Story = { args: { loading: true } };
