import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { ConversationList, demoConversations, type Conversation } from "./ConversationList.tsx";

const meta = {
  title: "Components/Chat/Conversation List",
  component: ConversationList,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Channels, direct messages and agents in one sidebar. Unread conversations read in a heavier weight; mentions get a stamped gunmetal count, so each state has one signal. People show presence on the avatar's corner; agents show the library's status shapes, a cobalt pulse while working and a decal diamond when waiting on you. Type to filter, use the arrow keys to walk the list and Enter to open; folding a section keeps its mention count visible.",
      },
    },
  },
  args: { onCreate: () => {} },
} satisfies Meta<typeof ConversationList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Controlled: the app stores the open conversation and clears its unread state. */
export const Controlled: Story = {
  render: function ControlledDemo(args) {
    const [items, setItems] = useState<Conversation[]>(demoConversations);
    const [selected, setSelected] = useState<string | null>("d-priya");
    return (
      <ConversationList
        {...args}
        conversations={items}
        selected={selected}
        onSelect={(id) => {
          setSelected(id);
          setItems((xs) => xs.map((c) => (c.id === id ? { ...c, unread: 0, mentions: 0 } : c)));
        }}
      />
    );
  },
};

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = { args: { conversations: [] } };

/** A search with no matches. */
export const NoMatches: Story = { args: { query: "deploy freeze", onQueryChange: () => {} } };

export const Error: Story = { args: { error: "The workspace didn't answer in time. Your messages are safe; try again.", onRetry: () => {} } };

/** Wired to useCachedLoader: the cached list shows at once, the refresh brings a new DM from Devon. */
export const WithCache: Story = {
  render: function WithCacheDemo(args) {
    useState(() => primeCache("story:conversation-list", demoConversations, Date.now() - 7 * 60_000));
    const q = useCachedLoader(
      "story:conversation-list",
      () =>
        new Promise<Conversation[]>((ok) =>
          setTimeout(
            () =>
              ok(
                demoConversations.map((c) =>
                  c.id === "d-devon" ? { ...c, lastAuthor: "Devon Okafor", lastMessage: "Back online, want to pair now?", lastAt: Date.now(), unread: 1, presence: "active" as const } : c,
                ),
              ),
            1500,
          ),
        ),
      { maxAge: 60_000 },
    );
    return <ConversationList {...args} conversations={q.data} loading={q.status === "loading"} status={q.status} updatedAt={q.updatedAt} onRefresh={q.refresh} />;
  },
};
