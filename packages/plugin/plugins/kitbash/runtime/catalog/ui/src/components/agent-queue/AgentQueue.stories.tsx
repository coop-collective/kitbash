import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentQueue } from "./AgentQueue.tsx";

const meta = {
  title: "Components/Agents/Agent Queue",
  component: AgentQueue,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The work waiting for your agents and how fast it moves. Jobs drop into a recessed hopper, seat into free worker sockets as growing bars, and land in Done or Failed. A rate limit lays a hazard clamp across the sockets; the depth gauge shows the backlog build up behind it and drain when the workers resume. Pause the workers yourself to see the same thing.",
      },
    },
  },
  args: { workers: 4, arrivalRate: 1.15, autoplay: true, rateLimitEvery: 16, rateLimitFor: 5 },
} satisfies Meta<typeof AgentQueue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Six workers, more traffic, no automatic rate limits. */
export const Scaled: Story = { args: { workers: 6, arrivalRate: 2, rateLimitEvery: null } };

/** Frequent long rate limits: the backlog keeps climbing. */
export const Throttled: Story = { args: { rateLimitEvery: 9, rateLimitFor: 6, arrivalRate: 1.6 } };
