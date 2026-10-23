import type { Meta, StoryObj } from "@storybook/react-vite";
import { DecisionTree } from "./DecisionTree.tsx";
import type { Decision } from "./DecisionTree.tsx";

const refund: Decision = {
  agent: "Support agent",
  question: "A customer was charged twice for the Team plan. Which fix should I apply?",
  context: "Invoice #48213 and #48214 were both paid on Oct 21 for $1,140. The customer asked for a refund, not a credit.",
  options: [
    {
      id: "refund",
      title: "Refund the duplicate charge",
      pick: true,
      consequences: [
        { kind: "gain", text: "Matches what the customer asked for" },
        { kind: "cost", text: "Takes 5 to 10 days to reach their card" },
      ],
    },
    {
      id: "credit",
      title: "Apply a $1,140 account credit",
      consequences: [
        { kind: "gain", text: "Instant, no card fees" },
        { kind: "cost", text: "Not what they asked for" },
      ],
    },
    {
      id: "cancel",
      title: "Cancel the subscription and refund both",
      risky: true,
      consequences: [
        { kind: "cost", text: "Team loses access to 32 projects today" },
        { kind: "cost", text: "Cannot be undone without a new contract" },
      ],
    },
  ],
};

const meta = {
  title: "Components/Agents/Decision Tree",
  component: DecisionTree,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "An agent stuck on a decision lays out its options as a tree hanging from one runner: what each branch gains and costs, risky branches edged in hazard stripes, its own pick highlighted. Choose a branch with the arrow keys or pointer, or write your own; confirming clips every other branch off the runner.",
      },
    },
  },
} satisfies Meta<typeof DecisionTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Refund: Story = { args: { decision: refund } };
