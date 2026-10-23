import type { Meta, StoryObj } from "@storybook/react-vite";
import { CompactBreakdown } from "./CompactBreakdown.tsx";

const meta = {
  title: "Components/Data display/Compact Breakdown",
  component: CompactBreakdown,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A total split into its parts in one small card. Switch the period (arrow keys work on the switch) and the figures roll, the parts glide along their recessed runner, and ranked rows trade places with a brief chevron to show who moved.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof CompactBreakdown>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Tokens: Story = {
  args: {
    title: "Tokens by model",
    periods: ["Today", "This week", "This month"],
    defaultPeriod: 0,
    format: (v) => `${(v / 1000).toFixed(1)}k`,
    parts: [
      { id: "large", label: "Large reasoning", values: [412_300, 2_804_100, 11_920_400] },
      { id: "fast", label: "Fast chat", values: [688_900, 3_120_700, 10_210_900] },
      { id: "embed", label: "Embeddings", values: [221_000, 3_460_200, 15_330_000] },
      { id: "other", label: "Everything else", values: [12_400, 80_100, 301_000] },
    ],
  },
};
