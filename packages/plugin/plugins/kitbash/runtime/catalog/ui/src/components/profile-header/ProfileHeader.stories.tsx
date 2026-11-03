import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { DEMO_AGENT_HEADER, DEMO_PERSON_HEADER, ProfileHeader, type PersonHeaderProfile } from "./ProfileHeader.tsx";

const meta = {
  title: "Components/Profiles/Profile Header",
  component: ProfileHeader,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "The top of a profile page on one flat panel: avatar, name, role and team, location and local time, a short bio, and the person's record under a seam. Follow is the one orange key; once you follow, it latches down in gunmetal like a switch. The agent variant swaps the disc for a square part with the Kitbash mark and shows the model, the owner, and a permissions summary in three trays: what it can read, what it does on its own, and what it asks a person about first.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof ProfileHeader>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Following: Story = { args: { following: true } };

export const Agent: Story = { args: { profile: DEMO_AGENT_HEADER } };

export const Loading: Story = { args: { loading: true } };

export const Error: Story = { args: { error: "The profile service didn't answer. Nothing changed; try again.", onRetry: () => {} } };

/** Stats come from useCachedLoader: the cached record shows at once, then refreshes. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    // Seed the cache once, before anything subscribes, so the first frame shows a cached copy
    useState(() => primeCache("story:profile:priya", DEMO_PERSON_HEADER, Date.now() - 9 * 60_000));
    const q = useCachedLoader<PersonHeaderProfile>(
      "story:profile:priya",
      () => new Promise((ok) => setTimeout(() => ok({ ...DEMO_PERSON_HEADER, runsApproved: 1291, reviews: 314 }), 1500)),
      { maxAge: 60_000 },
    );
    return <ProfileHeader profile={q.data} loading={q.status === "loading"} status={q.status} updatedAt={q.updatedAt} onRefresh={q.refresh} />;
  },
};
