import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { TopList, demoTopListRows, type TopListMetric, type TopListRow } from "./TopList.tsx";

const meta = {
  title: "Components/Analytics/Top List",
  component: TopList,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "A ranked list where each row's magnitude is a rail under its name, measured against the leader. Switch the metric and the rows re-rank with a glide, so you can follow where each one went. The change against the previous period is green or crimson by whether it is better or worse for that metric: more handoffs to a person is worse, spend is neither.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof TopList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Ranked by handoffs, all rows shown, rows open a detail view. */
export const ByHandoffs: Story = { args: { defaultMetric: "handoffs", limit: 10, onSelect: () => {} } };

const pageMetrics: TopListMetric[] = [
  { value: "views", label: "Views" },
  { value: "visitors", label: "Visitors" },
];
const page = (path: string, views: [number, number], visitors: [number, number]): TopListRow => ({
  id: path,
  label: path,
  code: true,
  values: { views: { value: views[0], previous: views[1] }, visitors: { value: visitors[0], previous: visitors[1] } },
});

/** Top pages: labels are paths, so they are set in mono. */
export const TopPages: Story = {
  args: {
    title: "Top pages",
    itemLabel: "Page",
    subtitle: "Last 7 days",
    metrics: pageMetrics,
    rows: [
      page("/agents", [18420, 16900], [6120, 5800]),
      page("/agents/new", [9210, 7400], [4980, 3920]),
      page("/runs", [8730, 8810], [2140, 2200]),
      page("/settings/billing", [3120, 2410], [1880, 1460]),
      page("/docs/quickstart", [2950, 3300], [2610, 2900]),
      page("/integrations/github", [1840, 1210], [1320, 910]),
    ],
  },
};

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = { args: { rows: [] } };

export const Error: Story = { args: { error: "The usage rollup for this period hasn't finished. Try again in a few minutes.", errorDetail: "409 rollup_pending, request 58e0b1aa", onRetry: () => {} } };

/** Wired to useCachedLoader: the cached ranking shows at once, then fresh numbers re-rank it. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    // Seed once, as a server render or an earlier visit would have
    useState(() => primeCache("story:top-list", demoTopListRows, Date.now() - 12 * 60_000));
    const q = useCachedLoader(
      "story:top-list",
      () =>
        new Promise<TopListRow[]>((ok) =>
          setTimeout(
            () =>
              ok(
                demoTopListRows.map((r, i) => ({
                  ...r,
                  values: Object.fromEntries(Object.entries(r.values).map(([k, v]) => [k, { ...v, value: Math.round(v.value * (i % 3 === 1 ? 1.6 : 1.02)) }])),
                })),
              ),
            1500,
          ),
        ),
      { maxAge: 60_000 },
    );
    return <TopList rows={q.data ?? []} loading={q.status === "loading"} status={q.status} updatedAt={q.updatedAt} onRefresh={q.refresh} />;
  },
};
