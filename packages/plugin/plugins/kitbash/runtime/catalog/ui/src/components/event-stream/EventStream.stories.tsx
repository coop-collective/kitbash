import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { EventStream, demoEvent, demoEvents, type ProductEvent } from "./EventStream.tsx";

const meta = {
  title: "Components/Analytics/Event Stream",
  component: EventStream,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A live feed of product events read like a serial monitor: how long ago, who, the event name in mono and its properties on one line. New events slide in at the top. Pause and the list holds still while new events queue behind a key that counts them; press it to let them in. Filter by event name, and open a row to read its properties as key/value pairs on a recessed plate.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof EventStream>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Paused with a fast stream: events queue behind the "new" key. One row is open. */
export const Paused: Story = { args: { defaultPaused: true, interval: 250, defaultExpanded: ["evt_12"] } };

/** Only finished runs. */
export const Filtered: Story = { args: { defaultFilter: "run_finished" } };

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = { args: { events: [], autoplay: false } };

export const Error: Story = { args: { error: "Lost the connection to the event stream. Events sent meanwhile are kept and will appear when it reconnects.", errorDetail: "WebSocket closed 1006, session es_7f3c9a", onRetry: () => {} } };

/** Wired to useCachedLoader: the last batch shows at once from cache, then the newest page lands. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    // Seed once, as a server render or an earlier visit would have
    useState(() => primeCache("story:events", demoEvents.slice(4), Date.now() - 3 * 60_000));
    const q = useCachedLoader(
      "story:events",
      () => new Promise<ProductEvent[]>((ok) => setTimeout(() => ok([demoEvent(40, Date.now()), demoEvent(41, Date.now() - 2000), ...demoEvents]), 1500)),
      { maxAge: 60_000 },
    );
    return <EventStream events={q.data ?? []} autoplay={false} loading={q.status === "loading"} status={q.status} updatedAt={q.updatedAt} onRefresh={q.refresh} />;
  },
};
