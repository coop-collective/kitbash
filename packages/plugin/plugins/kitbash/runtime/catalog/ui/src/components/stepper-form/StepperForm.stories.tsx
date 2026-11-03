import type { Meta, StoryObj } from "@storybook/react-vite";
import { StepperForm } from "./StepperForm.tsx";

const meta = {
  title: "Components/Inputs/Stepper Form",
  component: StepperForm,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Four-step setup for a new agent workspace. Finished steps stay latched in the rail (pressed in, cured green), the current key stands raised, and the groove between keys fills as you advance. Steps slide in, the card glides to each step's height, fields validate inline on blur and on Continue, and the last step turns into a success state. Finished keys are buttons, so you can jump back to edit.",
      },
    },
  },
} satisfies Meta<typeof StepperForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ChoosingModel: Story = {
  args: { initial: { name: "Northwind Support", slug: "northwind-support" }, initialStep: 1 },
};

export const Review: Story = {
  args: {
    initial: { name: "Northwind Support", slug: "northwind-support", model: "sonnet", budget: "1200", invites: "dana@northwind.com, marcus@northwind.com, priya@northwind.com" },
    initialStep: 3,
  },
};

export const Finished: Story = {
  args: {
    initial: { name: "Northwind Support", slug: "northwind-support", model: "sonnet", budget: "1200", invites: "dana@northwind.com, marcus@northwind.com" },
    initialStep: 3,
    initialDone: true,
  },
};
