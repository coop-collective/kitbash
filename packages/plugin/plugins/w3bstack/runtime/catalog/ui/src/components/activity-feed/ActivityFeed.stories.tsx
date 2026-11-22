import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { ActivityFeed, defaultActivity, olderActivity, type ActivityItem } from "./ActivityFeed.tsx";

const meta = {
  title: "Components/Multiplayer/Activity Feed",
  component: ActivityFeed,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Recent work in a workspace: edits, comments, approvals, people joining and agent runs. Days are split by seams; consecutive actions by one person or agent hang from a single avatar on a runner, like parts on a sprue, so a burst of work reads as one. Objects link out, times stay relative, comments read as quotes, and agent runs end in a status tag. New items slot in at the top and are announced politely; loading older activity draws skeleton rows where the items will land.",
      },
    },
  },
  args: { autoplay: true },
} satisfies Meta<typeof ActivityFeed>;

export default meta;
type Story = StoryObj<typeof meta>;

/** New activity arrives every few seconds; press "Load older activity" for the next page. */
export const Default: Story = {};

/** The moment older items are on their way. */
export const LoadingOlder: Story = { args: { items: defaultActivity, loadingOlder: true, hasOlder: true, onLoadOlder: () => {} } };

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = { args: { items: [], onInvite: () => {} } };

export const Error: Story = { args: { error: "The activity service returned 503. Nothing is lost; try again in a moment.", onRetry: () => {} } };

/** Wired to useCachedLoader: the cached feed shows at once, the refresh adds what happened since, and older pages load on request. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    useState(() => primeCache<ActivityItem[]>("story:activity", defaultActivity.slice(1), Date.now() - 6 * 60_000));
    const q = useCachedLoader("story:activity", () => new Promise<ActivityItem[]>((ok) => setTimeout(() => ok(defaultActivity), 1600)), { maxAge: 60_000 });
    const [older, setOlder] = useState<ActivityItem[]>([]);
    const [loadingOlder, setLoadingOlder] = useState(false);
    return (
      <ActivityFeed
        items={[...(q.data ?? []), ...older]}
        loading={q.status === "loading"}
        status={q.status}
        updatedAt={q.updatedAt}
        onRefresh={q.refresh}
        loadingOlder={loadingOlder}
        hasOlder={older.length === 0}
        onLoadOlder={() => {
          setLoadingOlder(true);
          setTimeout(() => {
            setOlder(olderActivity);
            setLoadingOlder(false);
          }, 1400);
        }}
      />
    );
  },
};
