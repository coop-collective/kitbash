import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { InviteMembers } from "./InviteMembers.tsx";

const meta = {
  title: "Components/Users/Invite Members",
  component: InviteMembers,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Invite several people at once. Type or paste addresses: each snaps into the tray as a part, and anything that can't be invited is flagged on its own part (not an email, listed twice, already a member) and left out of the count. Pick a role from three keys, add an optional note, and the footer prices the seats before you send. Sending turns the tray into a result per address: sent, already a member, or failed with the reason and a retry.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof InviteMembers>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** An empty field, ready to type into. */
export const Blank: Story = { args: { defaultEmails: [] } };

/** After sending: one sent, one already joined, one bounced with the reason. */
export const Results: Story = {
  args: {
    defaultResults: [
      { email: "maya@relaylabs.dev", status: "sent" },
      { email: "kenji.ito@relaylabs.dev", status: "member", reason: "Joined through a team link a moment ago" },
      { email: "sofia.marin@globex.io", status: "failed", reason: "Their mail server rejected it (550, sender blocked). Ask them to allow northwind.dev." },
      { email: "theo@relaylabs.dev", status: "sent" },
    ],
  },
};

export const Loading: Story = { args: { loading: true } };

export const Error: Story = { args: { error: "Billing didn't answer, so seat prices are unknown. Nobody has been invited.", onRetry: () => {} } };

/** Seats and existing members come from useCachedLoader: cached at once, refreshed in the background. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    // Seed the cache once, before anything subscribes, so the first frame shows a cached copy
    useState(() => primeCache("story:invite-seats", { used: 25, total: 40, existing: ["ana@northwind.dev", "priya@northwind.dev"] }, Date.now() - 7 * 60_000));
    const q = useCachedLoader(
      "story:invite-seats",
      () => new Promise<{ used: number; total: number; existing: string[] }>((ok) => setTimeout(() => ok({ used: 26, total: 40, existing: ["ana@northwind.dev", "priya@northwind.dev", "marcus@northwind.dev"] }), 1400)),
      { maxAge: 60_000 },
    );
    return (
      <InviteMembers
        loading={q.status === "loading"}
        seats={q.data ? { used: q.data.used, total: q.data.total } : undefined}
        existingEmails={q.data?.existing}
        status={q.status}
        updatedAt={q.updatedAt}
        onRefresh={q.refresh}
        onCancel={() => {}}
      />
    );
  },
};
