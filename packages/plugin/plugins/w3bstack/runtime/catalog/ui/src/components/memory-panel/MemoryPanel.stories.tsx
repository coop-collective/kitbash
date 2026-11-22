import type { Meta, StoryObj } from "@storybook/react-vite";
import { MemoryPanel } from "./MemoryPanel.tsx";

const meta = {
  title: "Components/Agents/Memory Panel",
  component: MemoryPanel,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "What the assistant remembers about you, grouped by category and editable. The master switch turns memory off; filters narrow the list; each memory can be edited in place (Enter saves, Esc cancels), paused, which presses it down into the panel, or forgotten, which slides up a tray with Undo.",
      },
    },
  },
  args: { defaultEnabled: true, undoSeconds: 6 },
} satisfies Meta<typeof MemoryPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const MemoryOff: Story = { args: { defaultEnabled: false } };

export const Empty: Story = { args: { memories: [] } };
