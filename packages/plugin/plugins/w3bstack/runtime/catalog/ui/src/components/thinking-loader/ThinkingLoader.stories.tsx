import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../button/Button.tsx";
import { ThinkingLoader } from "./ThinkingLoader.tsx";

const meta = {
  title: "Components/Chat/Thinking Loader",
  component: ThinkingLoader,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Working pill for AI replies. The eight-ray spinner turns in a recessed socket while a shimmering label clicks through phases like a counter drum; on finish the rays retract and a green check stud snaps in with the elapsed time.",
      },
    },
  },
  args: { autoplay: true, loop: true, size: "md", showTimer: true },
  argTypes: {
    size: { control: "inline-radio", options: ["sm", "md"] },
  },
} satisfies Meta<typeof ThinkingLoader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Settled: Story = {
  args: { autoplay: false, done: true, doneLabel: "Thought for 6.8s" },
};

export const HeldOnAPhase: Story = {
  name: "Held on a phase",
  args: { autoplay: false, phase: 1, phases: ["Searching 12 sources", "Comparing refund policies", "Drafting reply"] },
};

export const Small: Story = {
  args: { size: "sm", phases: ["Calling github.search_issues", "Reading 3 results"] },
};

export const DrivenByARequest: Story = {
  name: "Driven by a request",
  render: function Driven() {
    const [phase, setPhase] = useState(0);
    const [done, setDone] = useState(false);
    const phases = ["Opening invoice INV-2291", "Matching 14 line items", "Flagging 2 mismatches"];
    return (
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <ThinkingLoader autoplay={false} phases={phases} phase={phase} done={done} />
        <Button
          size="sm"
          onClick={() => {
            if (done) { setPhase(0); setDone(false); }
            else if (phase < phases.length - 1) setPhase(phase + 1);
            else setDone(true);
          }}
        >
          {done ? "Start over" : "Next phase"}
        </Button>
      </div>
    );
  },
};
