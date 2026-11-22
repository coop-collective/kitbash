import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "./Button.tsx";

const meta = {
  title: "Components/Buttons/Button",
  component: Button,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Molded push button. Raised at rest, pressed in while held; loading swaps the label for the eight-ray spinner without changing width.",
      },
    },
  },
  args: { children: "Run agent", variant: "primary", size: "md" },
  argTypes: {
    variant: { control: "inline-radio", options: ["primary", "secondary", "ghost", "danger"] },
    size: { control: "inline-radio", options: ["sm", "md", "lg"] },
  },
} satisfies Meta<typeof Button>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Playground: Story = {};

export const Variants: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
      <Button variant="primary" icon="play">Run agent</Button>
      <Button variant="secondary" icon="copy">Duplicate</Button>
      <Button variant="ghost" icon="edit">Rename</Button>
      <Button variant="danger" icon="trash">Delete run</Button>
    </div>
  ),
};

export const Sizes: Story = {
  render: () => (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
      <Button size="md" icon="more" aria-label="More actions" />
    </div>
  ),
};

export const Loading: Story = {
  render: function LoadingDemo() {
    const [loading, setLoading] = useState(false);
    return (
      <Button
        variant="primary"
        icon="send"
        loading={loading}
        loadingLabel="Sending"
        onClick={() => {
          setLoading(true);
          window.setTimeout(() => setLoading(false), 1800);
        }}
      >
        Send draft
      </Button>
    );
  },
};
