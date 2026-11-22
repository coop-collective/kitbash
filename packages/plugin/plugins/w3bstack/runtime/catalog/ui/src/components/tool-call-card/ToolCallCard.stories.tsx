import type { Meta, StoryObj } from "@storybook/react-vite";
import { sampleToolCalls, ToolCallCard, ToolCallGroup } from "./ToolCallCard.tsx";

const [ok, , failed, running] = sampleToolCalls;

const meta = {
  title: "Components/Agents/Tool Call Card",
  component: ToolCallCard,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "An agent's tool call in one line: a lamp sunk into the part, the tool, a plain summary and a live clock. It folds open to highlighted arguments and result with copy; failed calls offer Retry. `ToolCallGroup` sums a run of calls and draws a runner bar sized by each call's time.",
      },
    },
  },
  args: { demo: true, defaultOpen: false },
} satisfies Meta<typeof ToolCallCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Open: Story = { args: { call: ok, defaultOpen: true } };

export const Running: Story = { args: { call: running, demoSeconds: 4 } };

export const Failed: Story = { args: { call: failed, defaultOpen: true } };

export const Group: Story = {
  render: () => <ToolCallGroup />,
};
