import type { Meta, StoryObj } from "@storybook/react-vite";
import { SetupGuide, demoSetupGroups } from "./SetupGuide.tsx";

const meta = {
  title: "Components/Feedback/Setup Guide",
  component: SetupGuide,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Onboarding panel with an overall progress groove and collapsible task groups numbered like kit instruction steps. Checking a task scores a line through it from left to right; finishing a group cures its step badge green, folds it away and opens the next unfinished step. Tasks someone else has to do carry the decal waiting tag.",
      },
    },
  },
  args: { title: "Set up Atlas" },
} satisfies Meta<typeof SetupGuide>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const JustStarted: Story = {
  args: { defaultDone: [] },
};

export const AlmostDone: Story = {
  args: { defaultDone: demoSetupGroups.flatMap((g) => g.tasks.map((t) => t.id)).filter((id) => id !== "prod") },
};
