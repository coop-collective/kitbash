import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { FunnelChart, demoFunnelSegments, type FunnelSegment } from "./FunnelChart.tsx";

const meta = {
  title: "Components/Analytics/Funnel Chart",
  component: FunnelChart,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Conversion through product milestones as bars on one scale. Each bar keeps the previous step's length as a hatched offcut, so the drop-off is literally the part cut away. Hover or focus a step (arrow keys move between steps) to open its drop-off: how many stopped, the median time to reach the step, and a sample of who stopped with the last event they sent. The step that loses the most is open first. Switch segments to compare self-serve and sales-led teams.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof FunnelChart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Sales-led teams, opened on the upgrade step. */
export const SalesLed: Story = { args: { defaultSegment: "sales", activeStep: "upgrade" } };

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = { args: { segments: [{ value: "all", label: "All teams", steps: [] }] } };

export const Error: Story = { args: { error: "The events warehouse is still catching up on the last hour. Try again in a minute.", errorDetail: "503 warehouse_lagging, request 2b81c0d4", onRetry: () => {} } };

/** Wired to useCachedLoader: yesterday's cached funnel shows at once, then today's numbers land. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    const [segment, setSegment] = useState("all");
    // Seed once, as a server render or an earlier visit would have
    useState(() => primeCache("story:funnel", demoFunnelSegments, Date.now() - 20 * 60_000));
    const q = useCachedLoader(
      "story:funnel",
      () =>
        new Promise<FunnelSegment[]>((ok) =>
          setTimeout(() => ok(demoFunnelSegments.map((s) => ({ ...s, steps: s.steps.map((st, i) => ({ ...st, count: Math.round(st.count * (1 + 0.02 * (i + 1))) })) }))), 1500),
        ),
      { maxAge: 60_000 },
    );
    return (
      <FunnelChart
        segments={q.data ?? []}
        loading={q.status === "loading"}
        status={q.status}
        updatedAt={q.updatedAt}
        onRefresh={q.refresh}
        segment={segment}
        onSegmentChange={setSegment}
      />
    );
  },
};
