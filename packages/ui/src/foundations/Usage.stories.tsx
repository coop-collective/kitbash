import type { Meta, StoryObj } from "@storybook/react-vite";
import "./foundations.css";

const meta = {
  title: "Foundations/Usage",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component: "How to use @kitbash/ui in a React app: imports, server components, lazy loading, caching and loading states.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

function Code({ children }: { children: string }) {
  return <pre className="kb-fd-code"><code>{children.trim()}</code></pre>;
}

export const Guide: Story = {
  render: () => (
    <div className="kb-fd kb-fd-doc">
      <section>
        <h2>Set up once</h2>
        <p>Import the tokens once at the root of the app, and put <code>kb-root</code> on the element that holds the UI. Dark mode follows <code>data-theme="dark"</code> on <code>html</code>.</p>
        <Code>{`
// app/layout.tsx (vinext or Next app router)
import "@kitbash/ui/tokens.css";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light">
      <body className="kb-root">{children}</body>
    </html>
  );
}`}</Code>
      </section>

      <section>
        <h2>Import a component</h2>
        <p>Every component is its own import path, named after its folder. The package root re-exports everything for convenience, but the per-component path keeps bundles small and is what <code>React.lazy</code> needs.</p>
        <Code>{`
import { ApprovalCard } from "@kitbash/ui/approval-card";
import { ChatThread, type ChatMessage } from "@kitbash/ui/chat-thread";
import { useCachedLoader, LazyMount } from "@kitbash/ui/shared";`}</Code>
      </section>

      <section>
        <h2>Server components</h2>
        <p>Interactive components start with <code>"use client"</code>, so a server component can render them and pass serializable props. Fetch on the server and hand the data down; event handlers belong in a client component of your own.</p>
        <Code>{`
// app/team/page.tsx (a server component)
import { UserTable } from "@kitbash/ui/user-table";

export default async function TeamPage() {
  const members = await db.members.list();
  return <UserTable members={members} />;
}`}</Code>
      </section>

      <section>
        <h2>Cache, then refresh</h2>
        <p><code>useCachedLoader</code> shows cached data at once and refreshes it in the background when it is older than <code>maxAge</code>. Pass its <code>status</code> and <code>updatedAt</code> straight into a component: <code>loading</code> draws the skeleton, and a <code>FreshnessBadge</code> says how old the numbers are.</p>
        <Code>{`
"use client";
import { useCachedLoader } from "@kitbash/ui/shared";
import { StatGrid, type StatMetric } from "@kitbash/ui/stat-grid";

export function Overview({ workspace }: { workspace: string }) {
  const stats = useCachedLoader<StatMetric[]>(\`stats:\${workspace}\`, () => fetch(\`/api/\${workspace}/stats\`).then((r) => r.json()), {
    maxAge: 60_000,
  });
  return (
    <StatGrid
      metrics={stats.data}
      loading={stats.status === "loading"}
      error={stats.status === "error" ? "Couldn't load this workspace's numbers" : null}
      onRetry={stats.refresh}
      status={stats.status}
      updatedAt={stats.updatedAt}
    />
  );
}`}</Code>
        <p>Seed the cache from server-rendered data with <code>primeCache(key, data, updatedAt)</code> so the client hydrates without a loading flash. Call <code>invalidate(key)</code> after a mutation to refresh on the next read.</p>
      </section>

      <section>
        <h2>Lazy load below the fold</h2>
        <p>Split heavy components into their own chunk with <code>React.lazy</code>, and mount them only when they near the viewport with <code>LazyMount</code>. Use the component's own <code>loading</code> state as the fallback so nothing jumps.</p>
        <Code>{`
import { lazy, Suspense } from "react";
import { LazyMount } from "@kitbash/ui/shared";

const TraceWaterfall = lazy(() => import("@kitbash/ui/trace-waterfall").then((m) => ({ default: m.TraceWaterfall })));

<LazyMount fallback={<TraceWaterfall loading />} rootMargin="300px">
  <Suspense fallback={<TraceWaterfall loading />}>
    <TraceWaterfall trace={trace} />
  </Suspense>
</LazyMount>`}</Code>
      </section>

      <section>
        <h2>The loading contract</h2>
        <p>Data components never fetch. They take data as props and share the same states:</p>
        <ul>
          <li><code>loading</code> draws a skeleton shaped like the real layout, inside one <code>SkeletonRegion</code> that announces "Loading" once.</li>
          <li>Empty data shows <code>EmptyState</code> with the one action that fills it.</li>
          <li>A failure shows <code>ErrorState</code> with what happened, a copyable detail, and <code>onRetry</code>.</li>
          <li>Live data shows a <code>FreshnessBadge</code> when given <code>status</code> and <code>updatedAt</code>.</li>
        </ul>
      </section>

      <section>
        <h2>Checks</h2>
        <p><code>pnpm -F @kitbash/ui test</code> renders every component with <code>react-dom/server</code> to prove it is safe to render on the server; <code>validate</code> checks the catalog, the entry points and the agent skill reference.</p>
      </section>
    </div>
  ),
};
