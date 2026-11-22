import type { Meta, StoryObj } from "@storybook/react-vite";
import { InlineDiff } from "./InlineDiff.tsx";
import type { DiffPart } from "./InlineDiff.tsx";

const release: DiffPart[] = [
  "This release ",
  { id: "r1", del: "fixes a bunch of issues with", ins: "fixes three bugs in", why: "Says how many" },
  " the export flow. CSV exports over 50,000 rows no longer time out, ",
  { id: "r2", del: "and also the date columns", ins: "date columns", why: "Cuts filler" },
  " keep the ",
  { id: "r3", del: "right time zone", ins: "workspace time zone instead of UTC", why: "Makes the fix concrete" },
  ", and the progress bar ",
  { id: "r4", del: "doesn't get stuck anymore", ins: "no longer stalls at 99%", why: "Matches the bug report" },
  ".",
];

const meta = {
  title: "Components/Agents/Inline Diff",
  component: InlineDiff,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "AI edits shown inline in prose. Each pending edit sits on decal tape because it is waiting on you. Hover, click or tab to an edit for its reason and the choice; Y accepts, N keeps the original, J and K move, Cmd/Ctrl+Z undoes. Accept all and Reject all decide the rest in one step.",
      },
    },
  },
} satisfies Meta<typeof InlineDiff>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const PartlyReviewed: Story = {
  args: { defaultDecisions: { e1: "accepted", e2: "accepted", e4: "rejected" }, defaultActive: "e3" },
};

export const ReleaseNotes: Story = { args: { parts: release, title: "Release notes, v2.14" } };
