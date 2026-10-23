import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProgressTracker, demoTrackerSteps } from "./ProgressTracker.tsx";

const meta = {
  title: "Components/Feedback/Progress Tracker",
  component: ProgressTracker,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Onboarding checklist. Progress is a rail of molded cells, one per step, that clip in with a snap and cure green when the last lands; ticks draw themselves. Steps are checkboxes, so Space toggles them. `autoplay` runs a demo loop that stops the moment someone clicks; with reduced motion it shows the finished state.",
      },
    },
  },
  args: { title: "Get Atlas ready", autoplay: false, interval: 1300 },
} satisfies Meta<typeof ProgressTracker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { defaultDone: ["repo", "key"] },
};

export const Autoplay: Story = {
  args: { autoplay: true, defaultDone: [] },
};

export const Finished: Story = {
  args: { defaultDone: demoTrackerSteps.map((s) => s.id) },
};
