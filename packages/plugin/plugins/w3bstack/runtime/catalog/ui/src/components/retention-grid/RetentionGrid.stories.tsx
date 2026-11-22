import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { RetentionGrid, demoRetentionCohorts, type RetentionCohort } from "./RetentionGrid.tsx";

const meta = {
  title: "Components/Analytics/Retention Grid",
  component: RetentionGrid,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Weekly cohort retention as a heatmap that stays a real table for screen readers: one row per signup week, one column per week since, each cell shaded in a single series hue by the share still active. Hover a cell, or focus the grid and use the arrow keys, to read it; its row and column headers light up like a crosshair and the reading is announced. The average row is weighted by cohort size and counts only cohorts old enough to have that week. Switch between percent and head count.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof RetentionGrid>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Head counts instead of percentages. */
export const Counts: Story = { args: { defaultView: "count" } };

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = { args: { cohorts: [] } };

export const Error: Story = { args: { error: "The cohort query timed out after 30s. Try a shorter range, or try again.", errorDetail: "query_timeout after 30.0s, request 91ac5f07", onRetry: () => {} } };

/** Wired to useCachedLoader: last night's cohorts show at once, then this morning's week lands. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    // Seed once, as a server render or an earlier visit would have
    useState(() => primeCache("story:retention", demoRetentionCohorts.slice(0, 8), Date.now() - 9 * 60 * 60_000));
    const q = useCachedLoader("story:retention", () => new Promise<RetentionCohort[]>((ok) => setTimeout(() => ok(demoRetentionCohorts), 1800)), { maxAge: 60_000 });
    return <RetentionGrid cohorts={q.data ?? []} loading={q.status === "loading"} status={q.status} updatedAt={q.updatedAt} onRefresh={q.refresh} />;
  },
};
