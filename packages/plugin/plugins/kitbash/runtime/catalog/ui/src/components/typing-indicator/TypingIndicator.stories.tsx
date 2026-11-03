import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { TypingIndicator, typingDemoStates, type Typer } from "./TypingIndicator.tsx";

const meta = {
  title: "Components/Multiplayer/Typing Indicator",
  component: TypingIndicator,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Who is composing. People get three small keys pressing in turn; an agent gets the Kitbash mark with its four gates lighting in cobalt, so a person typing and an agent writing never look alike. Names collapse past two (\"Maya and 3 others\"). Inline sits in a line of text; the bar spans the bottom of a thread with faces. The sentence is a polite live region, and with reduced motion the keys rest and the gates stay lit.",
      },
    },
  },
  args: { variant: "inline", autoplay: true },
  argTypes: { variant: { control: "inline-radio", options: ["inline", "bar"] } },
} satisfies Meta<typeof TypingIndicator>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Cycles one person, two, a crowd, an agent, and a person with an agent. */
export const Default: Story = {};

/** Every case, side by side, in both variants. */
export const Variants: Story = {
  render: () => (
    <div className="kb-part" style={{ width: 600, display: "grid", gap: 14, padding: "16px 0 0" }}>
      <div style={{ display: "grid", gap: 10, padding: "0 16px" }}>
        {typingDemoStates.map((typers, i) => (
          <TypingIndicator key={i} typers={typers} />
        ))}
      </div>
      <div>
        <TypingIndicator variant="bar" typers={typingDemoStates[2]} />
        <TypingIndicator variant="bar" typers={typingDemoStates[4]} />
      </div>
    </div>
  ),
};

export const Bar: Story = {
  args: { variant: "bar" },
  decorators: [
    (Story) => (
      <div className="kb-part" style={{ width: 560, paddingTop: 40, overflow: "hidden" }}>
        <Story />
      </div>
    ),
  ],
};

export const Loading: Story = {
  render: () => (
    <div className="kb-part" style={{ display: "grid", gap: 16, width: 560, paddingTop: 16, overflow: "hidden" }}>
      <span style={{ paddingLeft: 16 }}><TypingIndicator loading /></span>
      <TypingIndicator loading variant="bar" />
    </div>
  ),
};

/** Wired to useCachedLoader: the cached typers show at once, then the refreshed list replaces them. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    const cached = typingDemoStates[0] ?? [];
    const fresh = typingDemoStates[4] ?? [];
    useState(() => primeCache<Typer[]>("story:typing", cached, Date.now() - 20_000));
    const q = useCachedLoader("story:typing", () => new Promise<Typer[]>((ok) => setTimeout(() => ok(fresh), 1600)), { maxAge: 5_000 });
    return (
      <div className="kb-part" style={{ width: 560, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "8px 16px" }}>
          <FreshnessBadge status={q.status} updatedAt={q.updatedAt} onRefresh={q.refresh} />
        </div>
        <TypingIndicator variant="bar" typers={q.data ?? []} loading={q.status === "loading"} />
      </div>
    );
  },
};
