import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEMO_STEPS, ProfileMenu } from "./ProfileMenu.tsx";

const meta = {
  title: "Components/Navigation/Profile Menu",
  component: ProfileMenu,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Account card for the signed-in person: who they are, menu actions and profile setup progress. Setup is a parts tray, one slot per step: finished steps are parts seated in green, and the next step waiting on the person is marked in decal yellow. ↑↓ move through the card, Esc closes it and returns focus to the trigger.",
      },
    },
  },
  args: { defaultOpen: true },
  decorators: [
    (Story) => (
      <div style={{ height: 540, width: 340 }}>
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ProfileMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const JustSignedUp: Story = {
  args: { steps: DEMO_STEPS.map((s, i) => ({ ...s, done: i === 0 })) },
};

export const SetupComplete: Story = {
  args: { steps: DEMO_STEPS.map((s) => ({ ...s, done: true })) },
};

export const Closed: Story = {
  args: { defaultOpen: false },
};
