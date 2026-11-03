import type { Meta, StoryObj } from "@storybook/react-vite";
import { ProjectCard } from "./ProjectCard.tsx";

const meta = {
  title: "Components/Cards/Project Card",
  component: ProjectCard,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A two-line project summary that unfolds on hover or keyboard focus (the chevron keeps it open). The progress ring is made of snap-fit arc parts, one per subtask: green when done, ultramarine while an agent works on it, decal yellow when it waits on a person. Pointing at a person, a ring part or a row lights the others; people filter the list and the status picker works with arrow keys.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof ProjectCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Folded, as it sits in a list. Hover it. */
export const Default: Story = {};

export const Unfolded: Story = {
  args: { defaultOpen: true },
};

export const AtRisk: Story = {
  args: {
    name: "Ship the onboarding copilot",
    due: "Mon, Oct 26",
    defaultStatus: "at-risk",
    defaultOpen: true,
    people: [
      { id: "ari", name: "Ari Novak" },
      { id: "sam", name: "Sam Okafor" },
      { id: "bot", name: "Onboarding agent", agent: true },
    ],
    subtasks: [
      { id: "o1", title: "Draft welcome flow prompts", owner: "bot", state: "done" },
      { id: "o2", title: "Review tone with support leads", owner: "ari", state: "waiting" },
      { id: "o3", title: "Connect workspace import tool", owner: "bot", state: "active" },
      { id: "o4", title: "Sign off on data retention", owner: "sam", state: "waiting" },
      { id: "o5", title: "Run a pilot with ten teams", owner: "ari", state: "todo" },
    ],
  },
};
