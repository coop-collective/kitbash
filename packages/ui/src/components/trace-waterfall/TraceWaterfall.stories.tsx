import type { Meta, StoryObj } from "@storybook/react-vite";
import { TraceWaterfall } from "./TraceWaterfall.tsx";

const meta = {
  title: "Components/Agents/Trace Waterfall",
  component: TraceWaterfall,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Where the time and money of an agent run go, read like a profiler: hairline rows with tree guides, a dotted time grid that ends at the run's total, and every duration in one place, right of its bar. Bars are cobalt only while they run, with a now line; finished model calls and tool calls take their own paint. The slowest call is named once the run is over. Fold a sub-agent to press its calls into its bracket as seams.",
      },
    },
  },
  args: { autoplay: true, speed: 1.4 },
} satisfies Meta<typeof TraceWaterfall>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The finished trace. */
export const Finished: Story = { args: { autoplay: false } };

/** The refund sub-agent folded into one seamed bar. */
export const Folded: Story = { args: { autoplay: false, defaultFolded: ["refund"] } };

/** While data loads: the same layout as skeleton parts. */
export const Loading: Story = { args: { loading: true } };
