import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentInbox, sampleInbox } from "./AgentInbox.tsx";

const meta = {
  title: "Components/Agents/Agent Inbox",
  component: AgentInbox,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Every background agent task in one calm list. Tasks that need you sort to the top and carry a decal pull-tab; running rows keep a live clock; filter tabs roll their counts. A row unfolds to its last steps with Approve, Reject, Retry or Open, and glides to its new place when its status changes.",
      },
    },
  },
  args: { demo: true, defaultOpen: "t1" },
} satisfies Meta<typeof AgentInbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FailedOpen: Story = { args: { defaultOpen: "t3" } };

export const AllClear: Story = {
  args: { tasks: sampleInbox.filter((t) => t.status === "done"), defaultOpen: undefined },
};
