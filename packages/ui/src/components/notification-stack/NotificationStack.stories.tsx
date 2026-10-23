import type { Meta, StoryObj } from "@storybook/react-vite";
import { NotificationStack, demoNotices } from "./NotificationStack.tsx";

const meta = {
  title: "Components/Feedback/Notification Stack",
  component: NotificationStack,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Notice cards stacked one behind another. The cards behind show only their colored molding lip, so a decal-yellow edge warns that something needs a person before you reach it. Dismiss the front card (button, Escape or Delete while it has focus) and it slides off as the next card snaps up into its socket.",
      },
    },
  },
  args: { peek: 3 },
} satisfies Meta<typeof NotificationStack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PersonNeededBehind: Story = {
  args: { notices: [demoNotices[2], demoNotices[0], demoNotices[3]].filter((n) => n !== undefined) },
};

export const LastOne: Story = {
  args: { notices: demoNotices.slice(2, 3) },
};

export const CaughtUp: Story = {
  args: { notices: [] },
};
