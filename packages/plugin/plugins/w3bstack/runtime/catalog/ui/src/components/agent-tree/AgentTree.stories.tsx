import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentTree } from "./AgentTree.tsx";

const meta = {
  title: "Components/Agents/Agent Tree",
  component: AgentTree,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Who started whom. An orchestrator and its sub-agents hang off sprue runners, each card with status, model, cost and time; every branch shows its rolled-up cost. Fold a branch with its chevron (or Left and Right arrow keys) and it closes to one stacked line carrying the branch total.",
      },
    },
  },
  args: { autoplay: true, speed: 2, startAt: 7 },
} satisfies Meta<typeof AgentTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The finished run, with the research branch folded. */
export const Finished: Story = { args: { autoplay: false, startAt: 40, defaultFolded: ["research"] } };

/** Just started: the orchestrator alone, children appear as it spawns them. */
export const FromStart: Story = { args: { startAt: 0, speed: 3 } };
