import type { Meta, StoryObj } from "@storybook/react-vite";
import { EmptyState } from "./EmptyState.tsx";

const meta = {
  title: "Components/Loading/Empty State",
  component: EmptyState,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "An empty socket in a kit tray: the outline of what belongs here and the one action that puts it there. Copy says what to do next, plainly.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const NoMatches: Story = { args: { title: "No members match \"devon\"", body: "Check the spelling, or invite them to the workspace.", action: { label: "Invite people", icon: "users", onClick: () => {} } } };
export const Small: Story = { args: { size: "sm", title: "No messages", body: "Say hello to start the thread.", action: null } };
