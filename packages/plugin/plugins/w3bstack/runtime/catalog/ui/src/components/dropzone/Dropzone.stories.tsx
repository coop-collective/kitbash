import type { Meta, StoryObj } from "@storybook/react-vite";
import { Dropzone } from "./Dropzone.tsx";

const meta = {
  title: "Components/Inputs/Dropzone",
  component: Dropzone,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Drop files in and watch them upload. Hovering files fan a stack of documents out of the well; each file gets a colored type badge and its progress fills a recessed channel like plastic injecting into a mold, then cures green with a snapped-in check. Errors say what went wrong and offer Retry when a retry can help. Browse files is the keyboard path.",
      },
    },
  },
} satisfies Meta<typeof Dropzone>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Empty: Story = { args: { initialFiles: [] } };

export const AllUploaded: Story = {
  args: {
    initialFiles: [
      { id: "a", name: "incident-2026-10-14-timeline.md", size: 14_000, progress: 1, status: "done" },
      { id: "b", name: "refund-policy-v4.pdf", size: 2_300_000, progress: 1, status: "done" },
      { id: "c", name: "churned-accounts-q3.csv", size: 6_800_000, progress: 1, status: "done" },
    ],
  },
};

export const Errors: Story = {
  args: {
    initialFiles: [
      { id: "a", name: "pricing-faq.docx", size: 820_000, progress: 0.62, status: "error", error: "Connection dropped at 62%", retryable: true },
      { id: "b", name: "eval-results-run-2291.json", size: 31_400_000, progress: 0, status: "error", error: "Over the 25 MB limit" },
      { id: "c", name: "screen-recording.mov", size: 48_000_000, progress: 0, status: "error", error: "MOV files aren't supported" },
    ],
  },
};
