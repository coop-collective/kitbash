import type { Meta, StoryObj } from "@storybook/react-vite";
import { DataTable } from "./DataTable.tsx";

const meta = {
  title: "Components/Data display/Data Table",
  component: DataTable,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Spreadsheet-style table. Click, drag or Shift with the arrow keys to select a range; Enter, F2, double-click or just typing edits a cell; copy, cut and paste move tab-separated text in and out (a single value fills the whole range); undo and redo keep fifty steps; headers sort. The selected range sinks into the sheet while the active cell stays raised, and cells changed this session carry an accent notch.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof DataTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const ReadOnlyIds: Story = {
  args: {
    caption: "Eval results",
    columns: [
      { key: "case", label: "Case", width: 110, readOnly: true },
      { key: "prompt", label: "Prompt", width: 260 },
      { key: "score", label: "Score", type: "number", width: 80, format: (v) => v.toFixed(2) },
      { key: "tokens", label: "Tokens", type: "number", width: 90, format: (v) => v.toLocaleString("en-US") },
      { key: "verdict", label: "Verdict", width: 110 },
    ],
    rows: [
      { id: "e1", case: "refund-014", prompt: "Customer asks for a refund after 45 days", score: 0.92, tokens: 1840, verdict: "Pass" },
      { id: "e2", case: "refund-022", prompt: "Refund on a gift card purchase", score: 0.61, tokens: 2210, verdict: "Review" },
      { id: "e3", case: "ship-003", prompt: "Package marked delivered but missing", score: 0.88, tokens: 1530, verdict: "Pass" },
      { id: "e4", case: "acct-118", prompt: "Change account email without access to the old one", score: 0.34, tokens: 2960, verdict: "Fail" },
      { id: "e5", case: "bill-041", prompt: "Charged twice for one subscription", score: 0.95, tokens: 1290, verdict: "Pass" },
    ],
  },
};
