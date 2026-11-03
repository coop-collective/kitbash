import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { PresenceStack, defaultPresenceMembers, type PresenceMember } from "./PresenceStack.tsx";

const meta = {
  title: "Components/Multiplayer/Presence Stack",
  component: PresenceStack,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Who is here right now. Faces sit overlapped in a recessed tray, people as round discs and agents as square parts carrying the Kitbash mark. A shoulder light says the state: green for an active person, cobalt for an agent at work, a hollow ring when idle; away faces dim. Active people lead, then agents, then idle and away. The overflow is a key: press it for everyone, with what they have open and how long they have been here, and follow anyone (the followed face takes the gunmetal ring). Arrow keys move through the list; Escape closes it.",
      },
    },
  },
  decorators: [
    (Story) => (
      <div style={{ width: 420, minHeight: 540 }}>
        <Story />
      </div>
    ),
  ],
  args: {},
} satisfies Meta<typeof PresenceStack>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** The full list, following Dev. */
export const Open: Story = {
  render: function OpenDemo(args) {
    const [following, setFollowing] = useState<string | null>("dev");
    return <PresenceStack {...args} defaultOpen following={following} onFollow={setFollowing} />;
  },
};

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = { args: { members: [], defaultOpen: true, onInvite: () => {} } };

export const Error: Story = {
  args: { error: "The presence socket closed. Faces come back when it reconnects.", defaultOpen: true, onRetry: () => {} },
};

const fresher: PresenceMember[] = defaultPresenceMembers.map((m) =>
  m.id === "priya" ? { ...m, state: "active", viewing: "Rollout plan" } : m.id === "reviewer" ? { ...m, state: "active", viewing: "Reviewing Dev's edit" } : m,
);

/** Wired to useCachedLoader: the cached roster shows at once, then the refreshed one replaces it. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    useState(() => primeCache("story:presence", defaultPresenceMembers, Date.now() - 4 * 60_000));
    const q = useCachedLoader("story:presence", () => new Promise<PresenceMember[]>((ok) => setTimeout(() => ok(fresher), 1600)), { maxAge: 60_000 });
    return <PresenceStack members={q.data ?? []} loading={q.status === "loading"} status={q.status} updatedAt={q.updatedAt} onRefresh={q.refresh} defaultOpen />;
  },
};
