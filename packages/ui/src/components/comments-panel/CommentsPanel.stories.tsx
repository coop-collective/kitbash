import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommentsPanel } from "./CommentsPanel.tsx";

const meta = {
  title: "Components/Chat/Comments Panel",
  component: CommentsPanel,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Comment feed for a document with filters, runnable /edit commands, resolve and a composer (type / for commands). Comments waiting on you carry a decal-yellow tab; resolving snaps a card shut into a thin green seam that can be reopened.",
      },
    },
  },
  args: { defaultFilter: "all" },
  argTypes: { defaultFilter: { control: "inline-radio", options: ["all", "open", "you", "resolved"] } },
} satisfies Meta<typeof CommentsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ForYou: Story = {
  name: "For you",
  args: { defaultFilter: "you" },
};

export const EditApplied: Story = {
  name: "Edit applied",
  args: { runMs: 0 },
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>(".kb-cp-run")?.click();
  },
};
