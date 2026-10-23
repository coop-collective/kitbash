import type { Meta, StoryObj } from "@storybook/react-vite";
import { FilterMenu } from "./FilterMenu.tsx";

const meta = {
  title: "Components/Inputs/Filter Menu",
  component: FilterMenu,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Filters for a run list. The menu follows the WAI-ARIA menu pattern with collapsible checkbox groups: arrows move, Right and Left open and fold a group, Space toggles, letters jump, Escape closes. Counts are real facets over the demo runs. Active filters show as one molded part per group with a seam between values, so each value can be pulled out on its own; Clear all empties everything.",
      },
    },
  },
  decorators: [(Story) => <div style={{ minHeight: 640 }}><Story /></div>],
} satisfies Meta<typeof FilterMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { defaultOpen: true } };

export const Closed: Story = {
  decorators: [(Story) => <div style={{ minHeight: 0 }}><Story /></div>],
};

export const NoFilters: Story = {
  args: { defaultValue: {}, defaultCollapsed: [] },
  decorators: [(Story) => <div style={{ minHeight: 0 }}><Story /></div>],
};
