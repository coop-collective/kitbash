import type { Meta, StoryObj } from "@storybook/react-vite";
import { DateRangePicker } from "./DateRangePicker.tsx";

const meta = {
  title: "Components/Inputs/Date Range Picker",
  component: DateRangePicker,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Presets and two calendars for picking a reporting period, with a hover or focus preview while the second end is open and an optional comparison period. Keyboard follows the WAI-ARIA date grid (arrows, Home/End, PageUp/PageDown, Shift for a year). The range is drawn as one continuous molded bar; the comparison period sits as a recessed groove under its days.",
      },
    },
  },
  decorators: [(Story) => <div style={{ minHeight: 520, minWidth: 760 }}><Story /></div>],
} satisfies Meta<typeof DateRangePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { defaultOpen: true } };

export const Closed: Story = {
  decorators: [(Story) => <div style={{ minHeight: 0, minWidth: 0 }}><Story /></div>],
};

export const CompareWithLastYear: Story = {
  args: {
    defaultOpen: true,
    defaultCompare: "year",
    defaultValue: { start: new Date(2026, 8, 1), end: new Date(2026, 8, 30) },
  },
};

export const NoComparison: Story = {
  args: {
    defaultOpen: true,
    defaultCompare: "none",
    defaultValue: { start: new Date(2026, 9, 12), end: new Date(2026, 9, 18) },
  },
};
