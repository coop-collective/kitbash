import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { LiveCursors, type CursorPosition } from "./LiveCursors.tsx";

const meta = {
  title: "Components/Multiplayer/Live Cursors",
  component: LiveCursors,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "People working on one surface together. Each pointer is a decal in its owner's kit paint with a name flag; text they select is washed in that paint with a caret at the end and the flag hanging from the line. Cursors glide between updates (they jump with reduced motion), and anyone who stops moving fades to a ghost and folds their flag until they move again. An agent can join too, drawn in cobalt with the Kitbash mark on its flag. The legend under the page is the keyboard path: it says where everyone is and pings their cursor. For agents making edits, see Agent Cursors.",
      },
    },
  },
  args: { autoplay: true },
} satisfies Meta<typeof LiveCursors>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Two people and no agent. */
export const PeopleOnly: Story = {
  args: {
    participants: [
      { id: "maya", name: "Maya Chen", kind: "person", color: "var(--kb-series-5)" },
      { id: "dev", name: "Dev Patel", kind: "person", color: "var(--kb-series-3)" },
    ],
  },
};

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = { args: { participants: [], onInvite: () => {} } };

export const Error: Story = {
  args: { error: "The connection to the room dropped. Your edits are saved; cursors return when it reconnects.", onRetry: () => {} },
};

/** Wired to useCachedLoader: the last cursor snapshot shows at once, then the fresh one glides in. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    // Prime once per mount, not on every render
    useState(() => {
      const at = Date.now();
      primeCache<CursorPosition[]>(
        "story:cursors",
        [
          { id: "maya", x: 0.3, y: 0.3, lastActiveAt: at - 4 * 60_000 },
          { id: "dev", x: 0.6, y: 0.62, lastActiveAt: at - 4 * 60_000 },
          { id: "priya", x: 0.85, y: 0.15, lastActiveAt: at - 4 * 60_000 },
          { id: "kitbash", x: 0.4, y: 0.9, lastActiveAt: at - 4 * 60_000 },
        ],
        at - 4 * 60_000,
      );
    });
    const q = useCachedLoader(
      "story:cursors",
      () =>
        new Promise<CursorPosition[]>((ok) =>
          setTimeout(() => {
            const now = Date.now();
            ok([
              { id: "maya", x: 0, y: 0, selection: { block: "p1", text: "keep their price for one renewal cycle" }, lastActiveAt: now },
              { id: "dev", x: 0, y: 0, selection: { block: "p2", text: "under 0.5%" }, lastActiveAt: now },
              { id: "priya", x: 0.85, y: 0.15, lastActiveAt: now - 60_000 },
              { id: "kitbash", x: 0.55, y: 0.88, lastActiveAt: now },
            ]);
          }, 1600),
        ),
      { maxAge: 60_000 },
    );
    return <LiveCursors cursors={q.data ?? []} loading={q.status === "loading"} status={q.status} updatedAt={q.updatedAt} onRefresh={q.refresh} />;
  },
};
