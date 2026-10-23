import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentLanes } from "./AgentLanes.tsx";

const meta = {
  title: "Components/Agents/Agent Lanes",
  component: AgentLanes,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A channel per agent on a live clock, read like a logic analyzer. Running blocks are cobalt and grow into the now line; finished blocks show their duration, a failed run is marked in place, and hand-offs run as directed elbows into the next block. Labels sit inside a block when they fit and outside only where nothing crosses them. The merge approval is an orange key on its own block. The axis fits the run, and the header says whether it is running, waiting on you, or shipped. The demo opens mid-run.",
      },
    },
  },
  args: { autoplay: true, speed: 3, approveAfter: null },
} satisfies Meta<typeof AgentLanes>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Fast forward to the approval, which waits for you. */
export const WaitingOnYou: Story = { args: { speed: 30 } };

/** The demo approves itself after 24 simulated seconds and ships. */
export const HandsOff: Story = { args: { speed: 16, approveAfter: 24 } };

/** While data loads: the same layout as skeleton parts. */
export const Loading: Story = { args: { loading: true } };
