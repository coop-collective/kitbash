import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { primeCache, useCachedLoader } from "../../shared/index.ts";
import { DEMO_MEMBERS, UserTable, type WorkspaceMember } from "./UserTable.tsx";

const meta = {
  title: "Components/Users/User Table",
  component: UserTable,
  tags: ["autodocs"],
  parameters: {
    docs: {
      description: {
        component:
          "Workspace members as a ledger in a recessed sheet: search, filter by role, sort any column, select rows for a bulk bar that snaps in over the toolbar. Seats are studs on a plate. The last owner's role is locked so the workspace always keeps one. Invites wait on a person (decal diamond) with a resend link. Agents and service accounts sit in their own tray with square part avatars, cobalt only while working. Pages load lazily: a Load more key or infinite scroll, with skeleton rows where the page lands.",
      },
    },
  },
  args: {},
} satisfies Meta<typeof UserTable>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Three people selected: the bulk bar replaces the toolbar. */
export const Selected: Story = { args: { selected: DEMO_MEMBERS.filter((m) => m.role === "admin" && m.kind !== "agent").map((m) => m.id) } };

/** The next page arrives as the end of the list scrolls into view. */
export const InfiniteScroll: Story = { args: { paging: "infinite", pageSize: 10, maxHeight: 380 } };

export const Loading: Story = { args: { loading: true } };

export const Empty: Story = { args: { members: [] } };

export const Error: Story = { args: { error: "The members API didn't answer in time. Nothing changed; try again.", onRetry: () => {} } };

const SERVER: WorkspaceMember[] = DEMO_MEMBERS;
const fetchPage = (offset: number, limit: number) =>
  new Promise<{ rows: WorkspaceMember[]; total: number }>((ok) =>
    setTimeout(() => {
      const people = SERVER.filter((m) => m.kind !== "agent");
      ok({ rows: [...people.slice(offset, offset + limit), ...(offset === 0 ? SERVER.filter((m) => m.kind === "agent") : [])], total: people.length });
    }, 1200),
  );

/**
 * Wired to useCachedLoader: the first page shows at once from cache and refreshes in the background, and further
 * pages load through onLoadMore with skeleton rows meanwhile.
 */
export const WithCache: Story = {
  render: function WithCacheDemo() {
    // Seed the cache once, before anything subscribes, so the first frame shows a cached copy
    useState(() => primeCache("story:members:0", { rows: SERVER.slice(0, 10).concat(SERVER.filter((m) => m.kind === "agent")), total: 40 }, Date.now() - 8 * 60_000));
    const first = useCachedLoader("story:members:0", () => fetchPage(0, 10), { maxAge: 60_000 });
    const [extra, setExtra] = useState<WorkspaceMember[]>([]);
    const [more, setMore] = useState(false);
    const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
    const base = members ?? [...(first.data?.rows ?? []), ...extra];
    return (
      <UserTable
        members={base}
        total={first.data?.total}
        seats={{ used: 26, total: 40 }}
        pageSize={10}
        loading={first.status === "loading"}
        status={first.status}
        updatedAt={first.updatedAt}
        onRefresh={first.refresh}
        loadingMore={more}
        onMembersChange={(next) => setMembers(next)}
        onLoadMore={() => {
          setMore(true);
          const people = base.filter((m) => m.kind !== "agent").length;
          fetchPage(people, 10).then((r) => {
            setExtra((x) => [...x, ...r.rows]);
            setMembers((m) => (m ? [...m, ...r.rows] : m));
            setMore(false);
          });
        }}
      />
    );
  },
};
