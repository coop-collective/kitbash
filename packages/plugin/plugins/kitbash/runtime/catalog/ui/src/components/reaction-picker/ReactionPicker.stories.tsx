import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { ReactionPicker, demoMe, demoReactions, type Reaction, type SkinTone } from "./ReactionPicker.tsx";

const meta = {
  title: "Components/Chat/Reaction Picker",
  component: ReactionPicker,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Reactions on a message as count keys, and the popover that adds one. Your own reactions stay pressed in like a latched switch; press again to release. Hover or focus a key to see who reacted. The popover is a parts tray: frequently used first, a searchable grid you walk with the arrow keys from the search field (Enter reacts, Escape closes), and paint-pot swatches for skin tone. Emoji are Unicode data, not images.",
      },
    },
  },
  args: {},
  decorators: [(Story) => <div style={{ width: 360, minHeight: 440 }}><Story /></div>],
} satisfies Meta<typeof ReactionPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The tray open under the message's reactions. */
export const Default: Story = { args: { defaultOpen: true } };

/** Just the count keys; your 👀 is latched in. */
export const Chips: Story = {};

/** Controlled: the app stores the reactions and the person's skin tone. */
export const Controlled: Story = {
  render: function ControlledDemo() {
    const [reactions, setReactions] = useState<Reaction[]>(demoReactions.slice(0, 2));
    const [tone, setTone] = useState<SkinTone>(3);
    return (
      <div style={{ display: "grid", gap: 12 }}>
        <ReactionPicker reactions={reactions} onChange={setReactions} skinTone={tone} onSkinToneChange={setTone} />
        <code style={{ fontSize: 12, color: "var(--kb-ink-2)" }}>{reactions.map((r) => `${r.emoji} ${r.by.length}`).join("  ")}</code>
      </div>
    );
  },
};

export const Loading: Story = { args: { loading: true } };

/** The emoji set failed to load; the tray explains and offers a retry. */
export const Error: Story = { args: { defaultOpen: true, error: "The emoji index didn't load. Reactions you already added are safe." } };

/** Wired to useCachedLoader: cached reactions show at once, then the refresh brings two new ones. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    useState(() => primeCache("story:reaction-picker", demoReactions.slice(0, 2), Date.now() - 8 * 60_000));
    const q = useCachedLoader(
      "story:reaction-picker",
      () => new Promise<Reaction[]>((ok) => setTimeout(() => ok(demoReactions), 1500)),
      { maxAge: 60_000 },
    );
    return (
      <div style={{ display: "grid", gap: 10 }}>
        <ReactionPicker key={q.updatedAt ?? 0} reactions={q.data} me={demoMe} loading={q.status === "loading"} />
        <FreshnessBadge status={q.status} updatedAt={q.updatedAt} onRefresh={q.refresh} />
      </div>
    );
  },
};
