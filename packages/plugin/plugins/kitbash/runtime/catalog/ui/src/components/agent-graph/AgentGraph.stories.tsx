import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentGraph } from "./AgentGraph.tsx";

const meta = {
  title: "Components/Agents/Agent Graph",
  component: AgentGraph,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Agents and the tools they call as a living network. Each call travels out as a pellet and its answer comes back green; the tool's plug presses into its socket when a call lands; links thicken with traffic; working agents breathe. When an agent needs a person it turns decal yellow, stops calling, and asks in the side panel. Select any node, by click or keyboard, to trace its links.",
      },
    },
  },
  args: { autoplay: true, rate: 520, approvalAfter: 4200 },
} satisfies Meta<typeof AgentGraph>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The coder is already waiting for a person when the story opens. */
export const NeedsYou: Story = { args: { approvalAfter: 0 } };

/** Heavy traffic and no approvals. */
export const Busy: Story = { args: { rate: 180, approval: null } };

/** Frozen: no calls in flight, link thickness shows history. */
export const Paused: Story = { args: { autoplay: false, approval: null } };
