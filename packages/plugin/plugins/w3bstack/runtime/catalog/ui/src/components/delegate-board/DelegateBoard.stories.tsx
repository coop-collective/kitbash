import type { Meta, StoryObj } from "@storybook/react-vite";
import { DelegateBoard } from "./DelegateBoard.tsx";

const meta = {
  title: "Components/Agents/Delegate Board",
  component: DelegateBoard,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Hand work to agents by dragging it onto them. Each agent's load is a rail of task parts on a shared hour scale; while you hold a task over an agent, a hatched ghost part snaps onto the end of its rail and the new busy-until shows with the added minutes. Auto sends every new task to whoever frees up first. Keyboard: Enter picks a task up, Tab to an agent to preview, Enter drops, Escape puts it back.",
      },
    },
  },
  args: { autoplay: true, defaultAuto: false },
} satisfies Meta<typeof DelegateBoard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Auto: new tasks are placed as they arrive. */
export const Auto: Story = { args: { defaultAuto: true } };

/** Clock stopped, so you can try dragging without the rails moving. */
export const Still: Story = { args: { autoplay: false } };
