import type { Meta, StoryObj } from "@storybook/react-vite";
import { AutonomyDial } from "./AutonomyDial.tsx";
import type { AutonomyAction } from "./AutonomyDial.tsx";

const support: AutonomyAction[] = [
  { id: "lookup", label: "Look up order history", icon: "search", risk: 0 },
  { id: "draft", label: "Draft replies", icon: "edit", risk: 0 },
  { id: "tag", label: "Tag and route tickets", icon: "flag", risk: 1 },
  { id: "reply", label: "Send replies to customers", icon: "send", risk: 1 },
  { id: "refund", label: "Refund up to $50", icon: "credit", risk: 2 },
  { id: "close", label: "Close accounts", icon: "trash", risk: 2, locked: true },
];

const meta = {
  title: "Components/Agents/Autonomy Dial",
  component: AutonomyDial,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "How much an agent may do on its own. Turn the knurled knob (drag, click a label, or use the arrow keys) and it clicks between three detents; the agent's real actions glide between \"Runs on its own\" and \"Asks you first\". The lock on any action pins it to asking.",
      },
    },
  },
  args: { defaultLevel: 1 },
  argTypes: { defaultLevel: { control: "inline-radio", options: [0, 1, 2] } },
} satisfies Meta<typeof AutonomyDial>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const AsksFirst: Story = { args: { defaultLevel: 0 } };

export const OnItsOwn: Story = { args: { defaultLevel: 2 } };

export const SupportAgent: Story = { args: { agent: "Support agent", actions: support, defaultLevel: 1 } };
