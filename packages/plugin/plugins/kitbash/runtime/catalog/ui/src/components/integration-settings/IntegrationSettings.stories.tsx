import type { Meta, StoryObj } from "@storybook/react-vite";
import { IntegrationSettings } from "./IntegrationSettings.tsx";

const meta = {
  title: "Components/Inputs/Integration Settings",
  component: IntegrationSettings,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Settings card for a connected service: on/off switch, API key, a site address that is validated and checked for reachability, time zone, and a save bar. Turning the service off unplugs the body into a dimmed, recessed well. Unsaved edits dock a save bar with a decal-yellow edge into the card's bottom seam, because they are waiting on a person.",
      },
    },
  },
} satisfies Meta<typeof IntegrationSettings>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const UnsavedChanges: Story = {
  args: { initialEdits: { timeZone: "Europe/Berlin", site: "northwind-eu" } },
};

export const InvalidFields: Story = {
  args: { initialEdits: { apiKey: "sk_9c41e07b2d8a", site: "Northwind Support" } },
};

export const TurnedOff: Story = {
  args: {
    initial: { enabled: false, apiKey: "fl_test_51b0c2d7e9a84f36b1d2c3e4f5a6b7c8", site: "acme-sandbox", timeZone: "America/New_York" },
  },
};
