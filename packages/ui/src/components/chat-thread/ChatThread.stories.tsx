import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { ChatThread, demoChatMessages, type ChatMessage } from "./ChatThread.tsx";

const meta = {
  title: "Components/Chat/Chat Thread",
  component: ChatThread,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A channel where people and agents talk. Messages group under one byline per sender, a hairline seam splits the days, and small faces show where each person stopped reading. Reactions are latching keys, threads fold into a reply count, and agents wear a square badge instead of a round face. Your messages go out at once as sending, then sent, or failed with a retry. Scroll to the top and older messages load in under a skeleton without moving what you were reading; while you are scrolled up, new messages wait behind a Jump to latest key that counts them.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof ChatThread>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Scrolled up while the rollout continues: three new messages wait behind the jump key. */
export const NewWhileScrolledUp: Story = {
  args: { demo: true, hasOlder: false },
  render: function ScrolledUp(args) {
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
      const id = window.setTimeout(() => {
        const log = box.current?.querySelector<HTMLElement>(".kb-ct-log");
        if (log) log.scrollTop = 120;
      }, 300);
      return () => window.clearTimeout(id);
    }, []);
    return (
      <div ref={box}>
        <ChatThread {...args} />
      </div>
    );
  },
};

/** Delivery fails: the message stays in place with a crimson square, a retry and a delete. */
export const SendFails: Story = {
  args: {
    typing: [],
    onSend: () => new Promise<void>((_, fail) => setTimeout(() => fail(new globalThis.Error("503 Service Unavailable")), 900)),
    messages: [
      ...demoChatMessages,
      { id: "f-1", authorId: "u-sam", at: Date.now() - 30_000, text: "Rolling back to 25% while I check the refund path.", state: "failed" },
    ],
  },
  render: function SendFailsDemo(args) {
    return <ChatThread {...args} />;
  },
};

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = { args: { messages: [], reads: [], typing: [], hasOlder: false, channel: "billing-migration", topic: "Moving invoices to the new ledger" } };

export const Error: Story = { args: { error: "The message service didn't answer in time. Nothing you sent was lost.", onRetry: () => {} } };

/** Wired to useCachedLoader: the cached thread shows at once, then the refresh adds Atlas's latest numbers. */
export const WithCache: Story = {
  render: function WithCacheDemo(args) {
    useState(() => primeCache("story:chat-thread", demoChatMessages, Date.now() - 6 * 60_000));
    const q = useCachedLoader(
      "story:chat-thread",
      () =>
        new Promise<ChatMessage[]>((ok) =>
          setTimeout(
            () => ok([...demoChatMessages, { id: "r-1", authorId: "a-atlas", at: Date.now(), text: "Flag is at 50%. Error rate 0.14% over 10 minutes." }]),
            1600,
          ),
        ),
      { maxAge: 60_000 },
    );
    return (
      <ChatThread
        {...args}
        typing={q.status === "refreshing" ? ["a-atlas"] : []}
        messages={q.data}
        loading={q.status === "loading"}
        status={q.status}
        updatedAt={q.updatedAt}
        onRefresh={q.refresh}
      />
    );
  },
};
