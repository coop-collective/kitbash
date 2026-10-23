import type { Meta, StoryObj } from "@storybook/react-vite";
import { DEMO_TIPS, TipsPanel } from "./TipsPanel.tsx";

const meta = {
  title: "Components/Cards/Tips Panel",
  component: TipsPanel,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A grid of short tips with one action each. Taking a tip presses its card down into the panel: it goes from a raised part to a recessed, cured-green socket with a check, so the tips still to do stand up off the surface. The count rolls as tips are taken.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof TipsPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const FreshWorkspace: Story = {
  args: { tips: DEMO_TIPS.map((t) => ({ ...t, done: false })) },
};

export const AllDone: Story = {
  args: { tips: DEMO_TIPS.map((t) => ({ ...t, done: true })) },
};

export const ThreeTips: Story = {
  args: { title: "Before your first run", tips: DEMO_TIPS.slice(1, 4).map((t) => ({ ...t, done: false })) },
};
