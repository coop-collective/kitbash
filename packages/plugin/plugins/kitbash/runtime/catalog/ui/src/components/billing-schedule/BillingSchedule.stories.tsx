import type { Meta, StoryObj } from "@storybook/react-vite";
import { BillingSchedule, PRODUCT_CATALOG } from "./BillingSchedule.tsx";

const meta = {
  title: "Components/Inputs/Billing Schedule",
  component: BillingSchedule,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Builds one billing phase: start date, length, products with how often and when they bill, a discount and a minimum commitment, with totals that roll as you type. Below the table the phase is a row of month parts, each sized by its invoice, so yearly and one-time charges stand out where they land; a minimum true-up shows as a decal-yellow cap because someone has to agree to it.",
      },
    },
  },
} satisfies Meta<typeof BillingSchedule>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const MinimumMet: Story = {
  args: {
    title: "Phase 2",
    customer: "Lattice Ops, renewal",
    initial: {
      start: "2027-01-01",
      months: 6,
      discount: 0,
      minimum: 10000,
      lines: [
        { ...PRODUCT_CATALOG[0]!, id: "a", quantity: 60 },
        { ...PRODUCT_CATALOG[4]!, id: "b" },
        { ...PRODUCT_CATALOG[5]!, id: "c" },
      ],
    },
  },
};

export const PilotQuarter: Story = {
  args: {
    title: "Pilot",
    customer: "Harbor Health, 90-day pilot",
    initial: {
      start: "2026-11-15",
      months: 3,
      discount: 25,
      minimum: 0,
      lines: [
        { ...PRODUCT_CATALOG[0]!, id: "a", quantity: 8 },
        { ...PRODUCT_CATALOG[2]!, id: "b", price: 2500 },
      ],
    },
  },
};
