import type { Meta, StoryObj } from "@storybook/react-vite";
import { Combobox, type ComboOption } from "./Combobox.tsx";

const meta = {
  title: "Components/Inputs/Combobox",
  component: Combobox,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Searchable, grouped picker on the WAI-ARIA combobox pattern: focus stays in the input, arrows move the active option, Enter picks, Escape closes. Picks snap into the recessed well as chips; Backspace on an empty query lifts the last chip and a second Backspace pulls it out, so nothing disappears by accident.",
      },
    },
  },
  decorators: [(Story) => <div style={{ minHeight: 480 }}><Story /></div>],
} satisfies Meta<typeof Combobox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { defaultOpen: true } };

export const Closed: Story = {};

const MODELS: ComboOption[] = [
  { id: "opus", label: "claude-opus-5-5", group: "Anthropic", description: "Hardest reasoning, $15 / M input" },
  { id: "sonnet", label: "claude-sonnet-5", group: "Anthropic", description: "Default for agents, $3 / M input" },
  { id: "haiku", label: "claude-haiku-5", group: "Anthropic", description: "Routing and triage, $0.80 / M input" },
  { id: "local-q", label: "qwen3-32b-instruct", group: "Self-hosted", description: "On the eu-west GPU pool" },
  { id: "local-l", label: "llama-4-scout", group: "Self-hosted", description: "Batch summaries" },
];

export const SingleModel: Story = {
  args: {
    label: "Model for this agent",
    options: MODELS,
    multiple: false,
    defaultValue: ["sonnet"],
    placeholder: "Search models",
    allowCreate: false,
  },
};

export const Searching: Story = {
  args: { defaultOpen: true, defaultQuery: "re" },
};

export const CreateOnTheFly: Story = {
  args: { defaultOpen: true, defaultQuery: "Ines Duarte", defaultValue: ["dana"] },
};
