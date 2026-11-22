import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { SegmentedControl } from "./SegmentedControl.tsx";

const meta = {
  title: "Components/Navigation/Segmented Control",
  component: SegmentedControl,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Switch between two to six options. A radiogroup: arrow keys, Home and End move and select. The indicator is one molded slider in a recessed track: its leading edge moves first so it stretches a little, it lifts when dragged, and it snaps into the detent it is dropped on. Decal-yellow badges mark an option with something waiting on you.",
      },
    },
  },
  args: {},
  argTypes: {
    variant: { control: "inline-radio", options: ["pill", "underline"] },
    size: { control: "inline-radio", options: ["sm", "md"] },
  },
} satisfies Meta<typeof SegmentedControl>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Underline: Story = {
  args: {
    variant: "underline",
    label: "Agent sections",
    options: [
      { value: "overview", label: "Overview" },
      { value: "runs", label: "Runs", count: 1284 },
      { value: "tools", label: "Tools", count: 12 },
      { value: "memory", label: "Memory" },
      { value: "approvals", label: "Approvals", count: 2, badge: "decal", badgeLabel: "waiting on you" },
      { value: "settings", label: "Settings" },
    ],
  },
};

export const WithIcons: Story = {
  args: {
    label: "View",
    size: "sm",
    options: [
      { value: "list", label: "List", icon: "layers" },
      { value: "board", label: "Board", icon: "chart" },
      { value: "timeline", label: "Timeline", icon: "clock" },
    ],
  },
};

export const IconsOnly: Story = {
  args: {
    label: "Theme",
    size: "sm",
    options: [
      { value: "auto", label: "Match system", icon: "settings", iconOnly: true },
      { value: "light", label: "Styrene", icon: "eye", iconOnly: true },
      { value: "dark", label: "Gunmetal", icon: "eyeOff", iconOnly: true },
    ],
  },
};

export const TwoOptions: Story = {
  args: {
    label: "Autonomy",
    fill: true,
    options: [
      { value: "ask", label: "Ask before acting", icon: "user" },
      { value: "auto", label: "Act on its own", icon: "bolt" },
    ],
  },
  render: (args) => (
    <div style={{ width: 380 }}>
      <SegmentedControl {...args} />
    </div>
  ),
};

export const Controlled: Story = {
  render: function ControlledDemo() {
    const [value, setValue] = useState("review");
    return (
      <div style={{ display: "grid", gap: 12, justifyItems: "start" }}>
        <SegmentedControl value={value} onChange={setValue} />
        <span style={{ color: "var(--kb-ink-2)", fontSize: 13 }}>Showing: {value}</span>
      </div>
    );
  },
};
