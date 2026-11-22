import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEMO_SERVICES, IntegrationPicker } from "./IntegrationPicker.tsx";

const meta = {
  title: "Components/Navigation/Integration Picker",
  component: IntegrationPicker,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The integrations page of a command menu. Search filters the service list (combobox + listbox: ↑↓ pick, Enter connects, Esc clears then goes back). The picked service and your workspace sit on two tiles joined by a molded runner: dashed while open, decal yellow while sign-in waits on a person, cured green once connected.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof IntegrationPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Connected: Story = {
  args: { defaultPicked: "github" },
};

export const WaitingOnSignIn: Story = {
  args: {
    demo: false,
    defaultPicked: "slack",
    services: DEMO_SERVICES.map((s) => (s.id === "slack" ? { ...s, status: "authorizing" as const } : s)),
  },
};

export const Searching: Story = {
  args: { defaultQuery: "read" },
};
