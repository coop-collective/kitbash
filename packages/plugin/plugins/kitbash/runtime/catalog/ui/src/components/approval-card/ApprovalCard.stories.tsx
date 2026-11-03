import type { Meta, StoryObj } from "@storybook/react-vite";
import { ApprovalCard } from "./ApprovalCard.tsx";
import type { ApprovalRequest } from "./ApprovalCard.tsx";

const deploy: ApprovalRequest = {
  agent: "Release agent",
  action: "Roll back payments-api to v4.18.2 in production",
  reason: "Error rate on /charge rose from 0.2% to 6.1% within nine minutes of the v4.19.0 deploy.",
  risk: "high",
  icon: "refresh",
  preview: {
    title: "Deploy plan",
    fields: [
      ["Service", "payments-api"],
      ["From", "v4.19.0 (a91c3e2)"],
      ["To", "v4.18.2 (77d0b14)"],
      ["Regions", "us-east-1, eu-west-1"],
    ],
  },
};

const label: ApprovalRequest = {
  agent: "Triage agent",
  action: "Add the label needs-repro to 12 issues",
  reason: "None of these issues include steps to reproduce or a version number.",
  risk: "low",
  icon: "flag",
  preview: {
    title: "GitHub, acme/storefront",
    fields: [
      ["Issues", "#2201, #2199, #2196 and 9 more"],
      ["Label", "needs-repro"],
    ],
  },
};

const meta = {
  title: "Components/Agents/Approval Card",
  component: ApprovalCard,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "An agent asks before it acts: risk, reason and a preview of exactly what goes out. Decal tape across the top counts down to an automatic deny and pauses while the pointer or focus is on the card. A approves and D denies. Deciding presses the card in and seats it as one recessed row.",
      },
    },
  },
  args: { timeout: 45 },
} satisfies Meta<typeof ApprovalCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const HighRisk: Story = { args: { request: deploy, approveLabel: "Approve rollback", timeout: 0 } };

export const ShortTimeout: Story = { args: { request: label, approveLabel: "Approve", timeout: 6 } };

export const Resolved: Story = {
  render: () => (
    <div style={{ display: "grid", gap: 8, width: 520 }}>
      <ApprovalCard outcome="approved" />
      <ApprovalCard request={deploy} outcome="denied" />
      <ApprovalCard request={label} outcome="expired" timeout={30} />
    </div>
  ),
};
