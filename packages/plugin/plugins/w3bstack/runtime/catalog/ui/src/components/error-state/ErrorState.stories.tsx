import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { ErrorState } from "./ErrorState.tsx";

const meta = {
  title: "Components/Loading/Error State",
  component: ErrorState,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A failure explained: what went wrong, how to fix it, a detail people can copy into a report, and a retry key. It never apologizes and never stays vague.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof ErrorState>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Retrying: Story = {
  render: function RetryDemo() {
    const [retrying, setRetrying] = useState(false);
    return <ErrorState retrying={retrying} onRetry={() => { setRetrying(true); setTimeout(() => setRetrying(false), 1500); }} />;
  },
};

export const Small: Story = { args: { size: "sm", title: "Couldn't load the trace", body: "The run is still recording. Try again in a few seconds.", detail: null } };
