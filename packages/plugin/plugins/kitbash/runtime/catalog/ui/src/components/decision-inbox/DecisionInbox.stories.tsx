import type { Meta, StoryObj } from "@storybook/react-vite";
import { DecisionInbox, demoDecisions } from "./DecisionInbox.tsx";

const meta = {
  title: "Components/Feedback/Decision Inbox",
  component: DecisionInbox,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Questions agents are blocked on, each with two quick answers molded as one rocker. The chosen half presses in and locks, the row's decal-yellow edge cures green, the outcome shows with an undo, and then the row folds away. Focus moves to the next open decision so a keyboard user can work through the queue.",
      },
    },
  },
  args: { title: "Waiting on you", confirmFor: 2200 },
} satisfies Meta<typeof DecisionInbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SingleDecision: Story = {
  args: { decisions: demoDecisions.slice(1, 2) },
};

export const Empty: Story = {
  args: { decisions: [] },
};
