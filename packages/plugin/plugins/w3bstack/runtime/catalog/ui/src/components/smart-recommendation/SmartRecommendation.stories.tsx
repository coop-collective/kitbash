import type { Meta, StoryObj } from "@storybook/react-vite";
import { SmartRecommendation } from "./SmartRecommendation.tsx";

const meta = {
  title: "Components/Cards/Smart Recommendation",
  component: SmartRecommendation,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A suggestion card with a confidence signal, alternatives to switch to, and accept with undo. Confidence is five molded pips pressed into the card, not a percentage bar; a swapped-in alternative snaps into the main slot. Accepting gives a short undo window before the change applies.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof SmartRecommendation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const SupportTriage: Story = {
  args: {
    context: "Support triage waits 9 minutes on average for a person",
    options: [
      {
        id: "auto-tag",
        title: "Let the agent tag and route tickets on its own",
        detail: "Ask a person only when the agent is unsure or the customer is on an enterprise plan.",
        confidence: 0.72,
        impact: "Cuts first response to about 2 minutes",
        tradeoff: "About 1 in 40 tickets lands in the wrong queue",
      },
      {
        id: "suggest-only",
        title: "Suggest a queue and let a person confirm",
        detail: "The agent pre-fills the queue; triage clicks once to confirm.",
        confidence: 0.66,
        impact: "Cuts first response to about 5 minutes",
        tradeoff: "Still needs someone on triage all day",
      },
    ],
    reasons: ["Agent and triage picked the same queue on 2,412 of 2,480 tickets last month"],
  },
};

export const NoAlternatives: Story = {
  args: {
    context: "The weekly report agent has failed 3 Mondays in a row",
    options: [
      {
        id: "retry",
        title: "Retry the warehouse query with a 10 minute timeout",
        detail: "All three failures were timeouts at the 5 minute limit during the backup window.",
        confidence: 0.91,
        impact: "Report lands on time",
        tradeoff: "Runs can take up to 5 minutes longer",
      },
    ],
  },
};
