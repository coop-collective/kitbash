import type { Meta, StoryObj } from "@storybook/react-vite";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { FreshnessBadge } from "./FreshnessBadge.tsx";

const meta = {
  title: "Components/Loading/Freshness Badge",
  component: FreshnessBadge,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "One line that says how fresh the data on screen is: updated a moment ago, refreshing, showing cached data from a given time, or failing to refresh. Feed it the status and updatedAt from useCachedLoader.",
      },
    },
  },
  args: { status: "ready", updatedAt: Date.now() - 2 * 60_000 },
  argTypes: { status: { control: "inline-radio", options: ["loading", "ready", "refreshing", "error"] } },
} satisfies Meta<typeof FreshnessBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
export const Refreshing: Story = { args: { status: "refreshing" } };
export const Cached: Story = { args: { updatedAt: Date.now() - 42 * 60_000, onRefresh: () => {} } };
export const Failed: Story = { args: { status: "error", updatedAt: Date.now() - 9 * 60_000, onRefresh: () => {} } };

/** Wired to useCachedLoader: the cached copy shows at once, then press refresh. */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    primeCache("story:freshness", { runs: 128 }, Date.now() - 6 * 60_000);
    const q = useCachedLoader("story:freshness", () => new Promise<{ runs: number }>((ok) => setTimeout(() => ok({ runs: 131 }), 1400)), { maxAge: 60 * 60_000 });
    return (
      <div className="kb-part" style={{ padding: 16, display: "grid", gap: 8, width: 300 }}>
        <strong style={{ fontSize: 28 }}>{q.data?.runs ?? "–"} runs</strong>
        <FreshnessBadge status={q.status} updatedAt={q.updatedAt} onRefresh={q.refresh} />
      </div>
    );
  },
};
