import type { Meta, StoryObj } from "@storybook/react-vite";
import { PermissionRequest } from "./PermissionRequest.tsx";
import type { PermissionAsk } from "./PermissionRequest.tsx";

const calendar: PermissionAsk = {
  agent: "Scheduling agent",
  right: "edit events on your work calendar",
  resource: "Google Calendar, maya.chen@acme.io",
  icon: "calendar",
  reason: "Three of next week's 1:1s overlap the offsite. It wants to move them to free slots both people share.",
  effects: [
    "Move 3 events from Tue Nov 3 to Thu Nov 5",
    "Send updated invites to Devon, Priya and Sam",
    "Leave every other event untouched",
  ],
  limits: ["It cannot delete events or see private event details."],
};

const meta = {
  title: "Components/Agents/Permission Request",
  component: PermissionRequest,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "An agent asks for one specific right: who, why and exactly what will happen, with what it will never do. Allow once, for an hour or always; the card folds into a key tag on one line with a draining ring and Revoke.",
      },
    },
  },
  args: { hourSeconds: 3600 },
} satisfies Meta<typeof PermissionRequest>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Calendar: Story = { args: { ask: calendar } };

export const GrantedForAnHour: Story = { args: { granted: "hour", hourSeconds: 90 } };

export const Folded: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 8, width: 500 }}>
      <PermissionRequest granted="hour" secondsLeft={2537} />
      <PermissionRequest ask={calendar} granted="always" />
      <PermissionRequest granted="once" />
    </div>
  ),
};
