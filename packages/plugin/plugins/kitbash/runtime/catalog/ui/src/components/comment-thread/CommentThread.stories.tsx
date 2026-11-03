import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommentThread } from "./CommentThread.tsx";

const meta = {
  title: "Components/Chat/Comment Thread",
  component: CommentThread,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "One comment with replies on a molded spine. The assistant reports what it did in a work receipt that folds down on a hinge; anything waiting on a person carries a decal-yellow stripe. Type @ in the reply box to mention someone, and @Kitbash answers in the thread.",
      },
    },
  },
  args: { autoplay: true },
} satisfies Meta<typeof CommentThread>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Settled: Story = {
  args: { autoplay: false },
};

export const MentionSuggestions: Story = {
  name: "Mention suggestions",
  args: { autoplay: false },
  play: async ({ canvasElement }) => {
    const box = canvasElement.querySelector<HTMLTextAreaElement>(".kb-ct-input");
    if (!box) return;
    box.focus();
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(box, "Thanks! @K");
    box.setSelectionRange(10, 10);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  },
};
