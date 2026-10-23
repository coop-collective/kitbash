import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmailDraft } from "./EmailDraft.tsx";

const meta = {
  title: "Components/Cards/Email Draft",
  component: EmailDraft,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "An agent-written email waiting for review. Switch the recipient and tone, edit the subject and body in place, remove the attachment, then send or discard with a five-second undo. The recipient the agent guessed wears a decal-yellow ring until a person confirms or changes it; after sending, the card folds into a strip with a burning fuse.",
      },
    },
  },
  args: {},
  argTypes: {
    defaultTone: { control: "inline-radio", options: ["friendly", "direct", "formal"] },
  },
} satisfies Meta<typeof EmailDraft>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const DirectTone: Story = {
  args: { defaultTone: "direct" },
};

export const NoAttachment: Story = {
  args: { attachment: null, defaultTone: "formal" },
};

export const LongUndo: Story = {
  args: { undoSeconds: 10 },
};
