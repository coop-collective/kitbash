import type { Meta, StoryObj } from "@storybook/react-vite";
import { ExperimentCard } from "./ExperimentCard.tsx";

const meta = {
  title: "Components/Data display/Experiment Card",
  component: ExperimentCard,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "An A/B test in two lines that unfolds on hover or keyboard focus (the chevron keeps it open). Variants are linked to their lines in a tiny chart, the metric switch rolls every figure, and once a metric is past the confidence line the card wears the decal-yellow tag until a person picks a winner, which snaps into its socket.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof ExperimentCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Folded, as it sits in a list. Hover it. */
export const Default: Story = {};

export const Unfolded: Story = {
  args: { defaultOpen: true },
};

export const WinnerPicked: Story = {
  args: { defaultOpen: true, defaultWinner: "b" },
};

export const StillRunning: Story = {
  args: {
    name: "Cite sources inline",
    day: 4,
    defaultOpen: true,
    variants: [
      { id: "a", name: "Control", description: "Sources listed at the end", samples: 1206 },
      { id: "b", name: "Inline citations", description: "Numbered marks after each claim", samples: 1188 },
    ],
    metrics: [
      {
        id: "thumbs",
        label: "Thumbs up rate",
        format: (v) => `${v.toFixed(1)}%`,
        points: true,
        confidence: 0.71,
        series: { a: [62.0, 63.4, 62.8, 63.1], b: [61.2, 64.0, 64.6, 64.4] },
      },
      {
        id: "follow",
        label: "Follow-up questions",
        format: (v) => v.toFixed(2),
        lowerIsBetter: true,
        confidence: 0.58,
        series: { a: [1.42, 1.38, 1.40, 1.39], b: [1.36, 1.35, 1.31, 1.33] },
      },
    ],
  },
};
