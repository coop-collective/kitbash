import type { Meta, StoryObj } from "@storybook/react-vite";
import { PromptLibrary } from "./PromptLibrary.tsx";

const meta = {
  title: "Components/Inputs/Prompt Library",
  component: PromptLibrary,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Saved prompt templates with variables. Type straight into the sentence: empty blanks are decal-yellow slots because they wait on a person, filled ones snap in as molded parts, and the finished prompt assembles in the well below. Use unlocks once every blank is filled; pressing it early jumps to the first empty blank.",
      },
    },
  },
} satisfies Meta<typeof PromptLibrary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ReadyToUse: Story = {
  args: {
    defaultSelected: "notes",
    defaultValues: { notes: { version: "v4.18.0", last_tag: "v4.17.2", grouping: "customer impact", words: "20" } },
  },
};

export const Empty: Story = {
  args: { defaultSelected: "triage", defaultValues: {} },
};
