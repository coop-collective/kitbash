import type { Meta, StoryObj } from "@storybook/react-vite";
import { AiAnswer } from "./AiAnswer.tsx";

const meta = {
  title: "Components/Chat/AI Answer",
  component: AiAnswer,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Streamed answer with numbered source cards, citation studs that preview their source, copy, regenerate (with versions), feedback and follow-ups. A stud and its source card behave like a peg and socket: point at either one and the other presses in.",
      },
    },
  },
  args: { autoplay: true },
} satisfies Meta<typeof AiAnswer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Answered: Story = {
  args: { autoplay: false },
};

export const PreviewingASource: Story = {
  name: "Previewing a source",
  args: { autoplay: false },
  play: async ({ canvasElement }) => {
    canvasElement.querySelectorAll<HTMLButtonElement>(".kb-aa-stud")[1]?.focus();
  },
};
