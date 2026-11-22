import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentPlan } from "./AgentPlan.tsx";
import type { PlanStep } from "./AgentPlan.tsx";

const migration: PlanStep[] = [
  { id: "m1", title: "Snapshot the invoices table", tool: "db.snapshot", seconds: 1.4 },
  { id: "m2", title: "Add the ledger_entry_id column", tool: "db.migrate", seconds: 1.8 },
  { id: "m3", title: "Backfill 48,210 invoices in batches of 1,000", tool: "db.backfill", seconds: 3 },
  { id: "m4", title: "Compare totals against Stripe for October", tool: "stripe.list_invoices", seconds: 1.6 },
];

const meta = {
  title: "Components/Agents/Agent Plan",
  component: AgentPlan,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "An agent's plan to review before it runs. Rename (double-click or the pencil), reorder (drag, or focus the grip and use the arrow keys), remove and add steps. Run it and the runner on the left fills step by step while each step keeps a live clock; a failed step stops the run and can be retried from there.",
      },
    },
  },
  args: { autoRun: false },
} satisfies Meta<typeof AgentPlan>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Running: Story = { args: { autoRun: true } };

export const Migration: Story = { args: { steps: migration, goal: "Move invoices to the in-house ledger" } };
