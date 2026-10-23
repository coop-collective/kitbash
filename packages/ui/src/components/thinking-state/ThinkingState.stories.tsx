import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThinkingState } from "./ThinkingState.tsx";

const meta = {
  title: "Components/Chat/Thinking State",
  component: ThinkingState,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "AI working panel: a live timer in the header, searched sources that drop in one by one, and thinking steps that seat on a recessed rail. The rail fills down its channel as the agent works and each finished step gets a green peg; the header folds the panel open or shut.",
      },
    },
  },
  args: { autoplay: true, loop: true, defaultOpen: true },
} satisfies Meta<typeof ThinkingState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Finished: Story = {
  args: { autoplay: false, loop: false },
};

export const FoldsWhenDone: Story = {
  name: "Folds when done",
  args: { loop: false, collapseOnDone: true, stepMs: 900 },
};

export const CodeTask: Story = {
  name: "Code task",
  args: {
    sources: [
      { domain: "github.com", title: "kitbash/api#1184 flaky auth test", color: "#24292f" },
      { domain: "sentry.io", title: "TokenExpiredError, 341 events", color: "#362d59" },
      { domain: "nodejs.org", title: "Timers and fake clocks", color: "#3c873a" },
    ],
    steps: [
      { label: "Reading src/auth/session.test.ts", detail: "Test advances the clock 3,600s but the token TTL is 3,599s" },
      { label: "Checking recent changes to session.ts", detail: "TTL changed in a3f91c2 two days ago" },
      { label: "Writing a fix and rerunning the suite" },
    ],
  },
};
