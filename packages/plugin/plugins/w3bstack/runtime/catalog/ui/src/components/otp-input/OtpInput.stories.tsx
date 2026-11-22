import type { Meta, StoryObj } from "@storybook/react-vite";
import { OtpInput } from "./OtpInput.tsx";

const meta = {
  title: "Components/Inputs/OTP Input",
  component: OtpInput,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Verification code field. One real input drawn as recessed cells, so paste and SMS autofill just work; a single focus ring glides to the next cell, a wrong code shakes once, and a right one fuses the cells into one cured part. The demo accepts 428916.",
      },
    },
  },
  args: { length: 6, demoCode: "428916", attempts: 3, resendAfter: 30 },
} satisfies Meta<typeof OtpInput>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PartlyEntered: Story = {
  args: { initialValue: "428", autoFocus: true },
};

export const Verified: Story = {
  args: { initialValue: "428916", initialState: "verified" },
};

export const FourDigits: Story = {
  args: { length: 4, demoCode: "3071", destination: "dana@lattice-ops.com", label: "Email code" },
};
