import type { Meta, StoryObj } from "@storybook/react-vite";
import { CitedAnswer } from "./CitedAnswer.tsx";

const meta = {
  title: "Components/Chat/Cited Answer",
  component: CitedAnswer,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "An AI answer wired to its sources. Point at (or tab to) a citation and its sentence and source light up together; click it and the quoted passage opens as a recessed well cut into the answer, with the matching words embossed. Escape closes the well.",
      },
    },
  },
  args: { defaultOpen: "0-1-0" },
} satisfies Meta<typeof CitedAnswer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Closed: Story = {
  args: { defaultOpen: null },
};

export const ResearchQuestion: Story = {
  name: "Research question",
  args: {
    defaultOpen: "0-0-0",
    question: "Does batching embeddings change retrieval quality?",
    sources: [
      { title: "Eval run 0412", domain: "wandb.ai", color: "#ffbe00", passage: "Batch size 256 vs 16: recall@10 0.842 vs 0.844, within run-to-run noise (±0.004)." },
      { title: "Embedding API notes", domain: "docs.internal", color: "#3b3fd6", passage: "Requests are tokenized and embedded independently; batching only affects throughput and rate-limit accounting." },
    ],
    paragraphs: [
      [
        { text: "No measurable change: recall at 10 moved by 0.002, which is inside the noise between runs.", cites: [{ source: 0, quote: "within run-to-run noise" }] },
        { text: "That matches how the API works, since each input is embedded on its own.", cites: [{ source: 1, quote: "embedded independently" }] },
      ],
    ],
  },
};
