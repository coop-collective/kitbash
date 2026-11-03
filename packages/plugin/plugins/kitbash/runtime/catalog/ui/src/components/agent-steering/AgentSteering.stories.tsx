import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentSteering } from "./AgentSteering.tsx";

const meta = {
  title: "Components/Agents/Agent Steering",
  component: AgentSteering,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Steer an agent while it works. A queued note clips onto the seam after the running step; when the agent finishes that step it picks the note up and the note snaps into the plan as its own step. Interrupt stops the running step on the spot, runs your note first, and puts the stopped step back after it. Enter queues, Cmd or Ctrl+Enter interrupts.",
      },
    },
  },
  args: { autoplay: true },
} satisfies Meta<typeof AgentSteering>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Nothing queued yet: type a note to steer. */
export const Empty: Story = { args: { initialNotes: [] } };

/** Two notes waiting while the agent is early in the run. */
export const TwoQueued: Story = {
  args: {
    autoplay: false,
    startAt: [0, 0.6],
    initialNotes: ["Use the existing rate limiter on the new endpoint", "Name the feature flag passkeys_v1"],
  },
};
