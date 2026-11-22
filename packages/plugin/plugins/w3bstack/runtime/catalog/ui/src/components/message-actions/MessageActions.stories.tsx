import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { MessageActions } from "./MessageActions.tsx";

const REPLY =
  "The flaky test comes from a TTL change in a3f91c2: tokens now expire after 3,599 seconds, but session.test.ts still advances the fake clock by exactly 3,600. I bumped the test clock to 3,598 and added a boundary case.";

function Message({ children }: { children: ReactNode }) {
  return (
    <div style={{ width: 460, paddingBottom: 150 }}>
      <p style={{ margin: "0 0 6px", lineHeight: 1.55 }}>{REPLY}</p>
      {children}
    </div>
  );
}

const meta = {
  title: "Components/Chat/Message Actions",
  component: MessageActions,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The quiet bar under an AI message. Copy turns into a check, regenerate spins and unfolds a version switcher, thumbs pop and thumbs down asks why, read aloud becomes a tiny equalizer. Toggles latch pressed into the strip rather than filling with color, and the strip only shows its molding when you reach for it.",
      },
    },
  },
  args: { text: REPLY, versions: 1 },
  decorators: [(Story) => <Message><Story /></Message>],
} satisfies Meta<typeof MessageActions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithVersions: Story = {
  name: "With versions",
  args: { versions: 3, defaultFeedback: "up" },
};

export const AskingWhy: Story = {
  name: "Asking why",
  play: async ({ canvasElement }) => {
    canvasElement.querySelector<HTMLButtonElement>('[aria-label="Bad response"]')?.click();
  },
};
