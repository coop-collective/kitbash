import type { Meta, StoryObj } from "@storybook/react-vite";
import { CommandMenu } from "./CommandMenu.tsx";

const meta = {
  title: "Components/Navigation/Command Menu",
  component: CommandMenu,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Search and run anything from one field. Tool actions carry their service tile and ⌘1–⌘5; everyday commands carry an icon and keycaps. Combobox + listbox: focus stays in the field while ↑↓ move one slider part that snaps from row to row, Enter runs, Esc clears. Firing a shortcut presses its keycaps in.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof CommandMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Filtered: Story = {
  args: { defaultQuery: "post" },
};

export const NoResults: Story = {
  args: { defaultQuery: "deploy to prod" },
};

export const ToolsOnly: Story = {
  args: { commands: [], placeholder: "Run a tool action" },
};
