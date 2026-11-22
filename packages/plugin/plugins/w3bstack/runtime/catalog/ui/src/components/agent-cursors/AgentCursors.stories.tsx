import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentCursors } from "./AgentCursors.tsx";

const meta = {
  title: "Components/Agents/Agent Cursors",
  component: AgentCursors,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Agents working in a shared document like teammates: named pointers glide to where they work, copy types out letter by letter, a code line gets fixed and a figure resized. Agent edits stay unglued, with a dashed seam in the agent's color, until a person accepts them from the margin note. Notes waiting on you carry the decal edge.",
      },
    },
  },
  args: { autoplay: true, loop: true },
} satisfies Meta<typeof AgentCursors>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Paused before anyone starts: the agents wait at the edge of the page. */
export const Paused: Story = { args: { autoplay: false } };

/** Different agent names and colors, played once. */
export const CustomAgents: Story = {
  args: {
    loop: false,
    agents: [
      { name: "Drafter", color: "#8a3fd6" },
      { name: "Reviewer", color: "#1f7fb8" },
      { name: "Designer", color: "#b8325a" },
    ],
  },
};
