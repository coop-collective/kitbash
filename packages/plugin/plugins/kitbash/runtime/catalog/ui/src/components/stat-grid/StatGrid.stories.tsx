import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { StatGrid, demoStatMetrics, type StatMetric } from "./StatGrid.tsx";

const meta = {
  title: "Components/Analytics/Stat Grid",
  component: StatGrid,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Three to six metrics read as one instrument panel: cells are hairline-divided parts of a single frame, with every value on one baseline and one type size. The change against the comparison period is green or crimson by whether it is better or worse for that metric (run time going down is good), and each sparkline draws the comparison period dotted beneath it. Pick a cell to make it the current metric, e.g. for a chart below.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof StatGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { defaultSelected: "runs" } };

/** Four metrics in a single row, without a header. */
export const SingleRow: Story = { args: { title: null, metrics: demoStatMetrics.slice(0, 4), readOnly: true } };

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = { args: { metrics: [] } };

export const Error: Story = {
  args: { error: "The metrics service didn't answer in time. Numbers are safe; try again.", errorDetail: "504 Gateway Timeout, request 3e9d17b2", onRetry: () => {} },
};

const nudge = (ms: StatMetric[], k: number): StatMetric[] =>
  ms.map((m) => ({ ...m, value: m.format === "percent" ? m.value : Math.round(m.value * k), series: m.series?.map((v, i, a) => (i === a.length - 1 ? v * k : v)) }));

/** Wired to useCachedLoader: last hour's numbers show at once from cache, then the refresh lands. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    const [n, setN] = useState(0);
    // Seed once, as a server render or an earlier visit would have
    useState(() => primeCache("story:stat-grid", demoStatMetrics, Date.now() - 48 * 60_000));
    const q = useCachedLoader(
      "story:stat-grid",
      () => new Promise<StatMetric[]>((ok) => setTimeout(() => ok(nudge(demoStatMetrics, 1.01 + n * 0.004)), 1600)),
      { maxAge: 60_000 },
    );
    return (
      <StatGrid
        metrics={q.data ?? []}
        loading={q.status === "loading"}
        status={q.status}
        updatedAt={q.updatedAt}
        onRefresh={() => {
          setN((x) => x + 1);
          q.refresh();
        }}
        defaultSelected="teams"
      />
    );
  },
};
