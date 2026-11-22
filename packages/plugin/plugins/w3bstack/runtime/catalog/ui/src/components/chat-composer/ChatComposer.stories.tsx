import type { Meta, StoryObj } from "@storybook/react-vite";
import { ChatComposer } from "./ChatComposer.tsx";

const meta = {
  title: "Components/Chat/Chat Composer",
  component: ChatComposer,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Prompt composer with a model menu, voice dictation, app connections and an approval step. Ask a connected app to write something (try sending the default prompt) and a decal-yellow approval tab slides out of the top seam while the send key locks until a person answers.",
      },
    },
  },
  args: {
    defaultValue: "Summarize the open P1 bugs in Linear and post the list to #launch-crew in Slack",
  },
  decorators: [(Story) => <div style={{ width: 620 }}><Story /></div>],
} satisfies Meta<typeof ChatComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = {
  args: { defaultValue: "", attachments: [] },
};

export const ApprovalPending: Story = {
  name: "Approval pending",
  args: { defaultApproval: { app: "Slack", action: "post a message in #launch-crew" } },
};

export const Dictating: Story = {
  args: { defaultValue: "", defaultRecording: true },
};
