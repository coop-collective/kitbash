"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "../button/Button.tsx";
import { EmptyState } from "../empty-state/EmptyState.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { Skeleton, SkeletonCircle, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { Avatar, Icon, Tag, cx, relativeTime, useNow, type LoadStatus } from "../../shared/index.ts";
import "./user-table.css";

export type MemberRole = "owner" | "admin" | "member" | "viewer";
export type MemberStatus = "active" | "invited" | "suspended";

export interface WorkspaceMember {
  id: string;
  name: string;
  email: string;
  role: MemberRole;
  status: MemberStatus;
  /** ms since epoch; null when they never signed in */
  lastActiveAt: number | null;
  /** Agents and service accounts are listed in their own section */
  kind?: "person" | "agent";
  /** Agents: the person responsible for it */
  ownerName?: string;
  /** Agents: true while it is running a task */
  working?: boolean;
  avatarUrl?: string;
}

export type MemberChange = { type: "role"; ids: string[]; role: MemberRole } | { type: "remove"; ids: string[] };

export type MemberSortKey = "name" | "role" | "status" | "lastActive";

export interface UserTableProps {
  members?: WorkspaceMember[];
  /** Makes the member list controlled: role changes and removals are reported here instead of applied inside */
  onMembersChange?: (next: WorkspaceMember[], change: MemberChange) => void;
  /** The signed-in person, marked "You" */
  currentUserId?: string;
  workspaceName?: string;
  /** Seats on the plan. `used` defaults to loaded people holding a paid seat (everyone but viewers and suspended);
   *  pass it when pages are still to load */
  seats?: { used?: number; total: number };
  /** People on the server, when it holds more than `members` */
  total?: number;
  pageSize?: number;
  /** "button": a Load more key; "infinite": the next page loads as the end of the list scrolls into view */
  paging?: "button" | "infinite";
  /** Load the next page. Without it the component pages through `members` itself (demo) */
  onLoadMore?: () => void;
  loadingMore?: boolean;
  selected?: string[];
  onSelectedChange?: (ids: string[]) => void;
  onInvite?: () => void;
  onResend?: (id: string) => void;
  /** Height of the scrolling list, px */
  maxHeight?: number;
  loading?: boolean;
  /** Load failure; shows ErrorState */
  error?: string | null;
  onRetry?: () => void;
  status?: LoadStatus;
  updatedAt?: number | null;
  onRefresh?: () => void;
  className?: string;
}

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const T0 = Date.now();

const FIRST = ["Ben", "Chloe", "Dev", "Elif", "Farid", "Grace", "Hugo", "Ines", "Jonah", "Kai", "Malik", "Nora", "Oscar", "Pia", "Quinn", "Rosa", "Sami", "Tess", "Uma", "Victor", "Wren", "Yusuf", "Zara", "Aiko", "Bruno", "Carmen", "Dmitri", "Esme", "Femi", "Greta", "Hamid", "Iris", "Jules", "Kofi"];
const LAST = ["Ruiz", "Adeyemi", "Lindqvist", "Patel", "Kaya", "Haddad", "Okoro", "Moreau", "Silva", "Brandt", "Nakamura", "Fischer", "Osei", "Kowalski", "Reyes", "Novak", "Tanaka", "Mensah", "Larsen", "Costa"];

function demoPerson(i: number): WorkspaceMember {
  const first = FIRST[i % FIRST.length] ?? "Alex";
  const last = LAST[(i * 7 + 3) % LAST.length] ?? "Lee";
  const roles: MemberRole[] = ["member", "member", "member", "viewer", "admin", "member", "viewer"];
  const role = roles[i % roles.length] ?? "member";
  const status: MemberStatus = i % 11 === 5 ? "invited" : i % 17 === 9 ? "suspended" : "active";
  return {
    id: `u_${(4100 + i * 37).toString(36)}`,
    name: `${first} ${last}`,
    email: `${first.toLowerCase()}.${last.toLowerCase()}@northwind.dev`,
    role,
    status,
    lastActiveAt: status === "invited" ? null : T0 - ((i * i * 7919 * MIN) % (9 * DAY)) - 4 * MIN,
  };
}

export const DEMO_MEMBERS: WorkspaceMember[] = [
  { id: "u_ana", name: "Ana Ruiz", email: "ana@northwind.dev", role: "owner", status: "active", lastActiveAt: T0 - 3 * MIN },
  { id: "u_priya", name: "Priya Shah", email: "priya@northwind.dev", role: "admin", status: "active", lastActiveAt: T0 - 42 * MIN },
  { id: "u_marcus", name: "Marcus Webb", email: "marcus@northwind.dev", role: "member", status: "active", lastActiveAt: T0 - 5 * HOUR },
  { id: "u_lena", name: "Lena Fischer", email: "lena.fischer@northwind.dev", role: "member", status: "invited", lastActiveAt: null },
  { id: "u_tomas", name: "Tomás Herrera", email: "tomas@northwind.dev", role: "viewer", status: "active", lastActiveAt: T0 - 2 * DAY },
  { id: "u_june", name: "June Park", email: "june@contractor.io", role: "member", status: "suspended", lastActiveAt: T0 - 19 * DAY },
  ...Array.from({ length: 34 }, (_, i) => demoPerson(i + 1)),
  { id: "a_triage", name: "Triage agent", email: "svc_triage", role: "member", status: "active", kind: "agent", ownerName: "Priya Shah", working: true, lastActiveAt: T0 - 20_000 },
  { id: "a_release", name: "Release notes bot", email: "svc_release_notes", role: "viewer", status: "active", kind: "agent", ownerName: "Marcus Webb", lastActiveAt: T0 - 3 * HOUR },
  { id: "a_ci", name: "CI deploy key", email: "svc_ci_deploy", role: "admin", status: "suspended", kind: "agent", ownerName: "Ana Ruiz", lastActiveAt: T0 - 12 * DAY },
];

const ROLES: Array<{ id: MemberRole; label: string }> = [
  { id: "owner", label: "Owner" },
  { id: "admin", label: "Admin" },
  { id: "member", label: "Member" },
  { id: "viewer", label: "Viewer" },
];
const ROLE_RANK: Record<MemberRole, number> = { owner: 0, admin: 1, member: 2, viewer: 3 };
const STATUS_RANK: Record<MemberStatus, number> = { active: 0, invited: 1, suspended: 2 };
const roleLabel = (r: MemberRole) => ROLES.find((x) => x.id === r)?.label ?? r;

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Workspace members as a ledger: who is in, what they can do, and who is still waiting to accept. Owners are guarded
 * so the workspace always keeps one; agents and service accounts sit in their own section with square part avatars,
 * and seats show as studs on a plate. Pages load lazily, with skeleton rows where the next page will land.
 */
export function UserTable({
  members: membersProp = DEMO_MEMBERS,
  onMembersChange,
  currentUserId = "u_ana",
  workspaceName = "Northwind",
  seats = { total: 40 },
  total: totalProp,
  pageSize = 25,
  paging = "button",
  onLoadMore,
  loadingMore: loadingMoreProp = false,
  selected: selectedProp,
  onSelectedChange,
  onInvite = () => {},
  onResend,
  maxHeight = 520,
  loading = false,
  error = null,
  onRetry,
  status,
  updatedAt = null,
  onRefresh,
  className,
}: UserTableProps) {
  const now = useNow(30_000);
  const [inner, setInner] = useState(membersProp);
  const members = onMembersChange ? membersProp : inner;

  const [innerSel, setInnerSel] = useState<string[]>([]);
  const selected = selectedProp ?? innerSel;
  const setSelected = (ids: string[]) => {
    if (!selectedProp) setInnerSel(ids);
    onSelectedChange?.(ids);
  };

  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState<MemberRole | "all">("all");
  const [sort, setSort] = useState<{ key: MemberSortKey; dir: 1 | -1 }>({ key: "role", dir: 1 });
  const [note, setNote] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [resent, setResent] = useState<Set<string>>(() => new Set());

  // Demo paging: without onLoadMore the component reveals `members` a page at a time
  const [shown, setShown] = useState(pageSize);
  const [demoLoading, setDemoLoading] = useState(false);
  const demoTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (demoTimer.current) window.clearTimeout(demoTimer.current);
  }, []);

  const allPeople = members.filter((m) => m.kind !== "agent");
  const agents = members.filter((m) => m.kind === "agent");
  const loadedPeople = onLoadMore ? allPeople : allPeople.slice(0, shown);
  const totalPeople = onLoadMore ? Math.max(totalProp ?? allPeople.length, allPeople.length) : allPeople.length;
  const remaining = totalPeople - loadedPeople.length;
  const loadingMore = onLoadMore ? loadingMoreProp : demoLoading;

  const loadMore = () => {
    if (loadingMore || remaining <= 0) return;
    if (onLoadMore) return onLoadMore();
    setDemoLoading(true);
    demoTimer.current = window.setTimeout(() => {
      setShown((s) => s + pageSize);
      setDemoLoading(false);
    }, 900);
  };
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  // Infinite paging: a sentinel at the end of the list asks for the next page as it nears view
  const scroller = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (paging !== "infinite" || typeof IntersectionObserver === "undefined") return;
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) loadMoreRef.current();
    }, { root: scroller.current, rootMargin: "120px" });
    io.observe(el);
    return () => io.disconnect();
  }, [paging, loading, error]);

  const owners = members.filter((m) => m.role === "owner" && m.kind !== "agent");
  const lastOwnerId = owners.length === 1 ? owners[0]?.id : undefined;
  const seatsUsed = seats.used ?? allPeople.filter((m) => m.role !== "viewer" && m.status !== "suspended").length;

  const visible = (list: WorkspaceMember[]) => {
    const q = query.trim().toLowerCase();
    const rows = list.filter((m) => (roleFilter === "all" || m.role === roleFilter) && (!q || m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)));
    const val = (m: WorkspaceMember): number | string =>
      sort.key === "name" ? m.name.toLowerCase() : sort.key === "role" ? ROLE_RANK[m.role] : sort.key === "status" ? STATUS_RANK[m.status] : -(m.lastActiveAt ?? -Infinity);
    return [...rows].sort((a, b) => {
      const x = val(a);
      const y = val(b);
      if (x === y) return a.name.localeCompare(b.name);
      return (x < y ? -1 : 1) * sort.dir;
    });
  };
  const peopleRows = visible(loadedPeople);
  const agentRows = visible(agents);
  const rowIds = [...peopleRows, ...agentRows].map((m) => m.id);
  const selectedVisible = rowIds.filter((id) => selected.includes(id));
  const allChecked = rowIds.length > 0 && selectedVisible.length === rowIds.length;

  const headCheck = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (headCheck.current) headCheck.current.indeterminate = selectedVisible.length > 0 && !allChecked;
  });

  const apply = (change: MemberChange) => {
    const ids = new Set(change.ids);
    const next =
      change.type === "remove"
        ? members.filter((m) => !ids.has(m.id))
        : members.map((m) => (ids.has(m.id) ? { ...m, role: change.role } : m));
    if (onMembersChange) onMembersChange(next, change);
    else setInner(next);
  };

  /** Drops the one remaining owner from a change that would leave the workspace without one, and says so */
  const guard = (ids: string[], leavesOwner: boolean) => {
    const ownerIds = owners.map((o) => o.id);
    if (!leavesOwner || !ownerIds.every((id) => ids.includes(id))) return ids;
    const keep = owners[0];
    if (!keep) return ids;
    setNote(`Kept ${keep.name} as owner. A workspace needs at least one.`);
    return ids.filter((id) => id !== keep.id);
  };

  const changeRole = (ids: string[], role: MemberRole) => {
    setNote(null);
    const safe = guard(ids, role !== "owner");
    if (safe.length) apply({ type: "role", ids: safe, role });
  };
  const remove = (ids: string[]) => {
    setNote(null);
    const safe = guard(ids, true);
    if (safe.length) apply({ type: "remove", ids: safe });
    setSelected(selected.filter((id) => !safe.includes(id)));
    setConfirmRemove(false);
  };

  const toggle = (id: string) => setSelected(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id]);
  const toggleAll = () => setSelected(allChecked ? selected.filter((id) => !rowIds.includes(id)) : [...new Set([...selected, ...rowIds])]);

  const sortBy = (key: MemberSortKey) => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }));
  const resend = (id: string) => {
    onResend?.(id);
    setResent((r) => new Set(r).add(id));
  };

  const known = !error && members.length > 0;
  const head = (
    <header className="kb-ut-head">
      <div className="kb-ut-title">
        <h3>Members</h3>
        <p>{known ? `${plural(totalPeople, "person", "people")} and ${plural(agents.length, "agent")} in ${workspaceName}` : workspaceName}</p>
      </div>
      {known ? <Seats used={seatsUsed} total={seats.total} /> : null}
      {status ? <FreshnessBadge status={status} updatedAt={updatedAt} onRefresh={onRefresh} /> : null}
      {members.length > 0 ? <Button variant="primary" icon="plus" onClick={onInvite}>Invite people</Button> : null}
    </header>
  );

  if (loading) {
    return (
      <section className={cx("kb-ut", className)} aria-label="Members">
        <SkeletonRegion label="Loading members">
          <div className="kb-ut-head">
            <div className="kb-ut-title">
              <Skeleton width={96} height={14} />
              <Skeleton width={220} height={10} style={{ marginTop: 8 }} />
            </div>
            <Skeleton width={160} height={22} />
            <Skeleton width={128} height={36} radius="control" />
          </div>
          <div className="kb-ut-tools">
            <Skeleton width={260} height={32} radius="control" />
            <Skeleton width={130} height={32} radius="control" />
          </div>
          <div className="kb-ut-skel-rows">
            {Array.from({ length: 7 }, (_, i) => <SkeletonRow key={i} />)}
          </div>
        </SkeletonRegion>
      </section>
    );
  }

  if (error) {
    return (
      <section className={cx("kb-ut", className)} aria-label="Members">
        {head}
        <div className="kb-ut-state">
          <ErrorState title="Couldn't load members" body={error} onRetry={onRetry} />
        </div>
      </section>
    );
  }

  if (members.length === 0) {
    return (
      <section className={cx("kb-ut", className)} aria-label="Members">
        {head}
        <div className="kb-ut-state">
          <EmptyState title="No members yet" body="Invite teammates to review runs, approve actions and share agents." action={{ label: "Invite people", icon: "users", onClick: onInvite }} />
        </div>
      </section>
    );
  }

  const bulk = selectedVisible.length > 0;
  const nothing = peopleRows.length === 0 && agentRows.length === 0;

  return (
    <section className={cx("kb-ut", className)} aria-label="Members">
      {head}

      {bulk ? (
        <div className="kb-ut-tools kb-ut-bulk" role="toolbar" aria-label="Selected members">
          <strong>{selectedVisible.length} selected</strong>
          {confirmRemove ? (
            <>
              <span className="kb-ut-confirm">Remove {plural(selectedVisible.length, "member")}? They lose access right away.</span>
              <span className="kb-ut-grow" />
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(false)}>Cancel</Button>
              <Button size="sm" variant="danger" icon="trash" onClick={() => remove(selectedVisible)} autoFocus>Remove {selectedVisible.length}</Button>
            </>
          ) : (
            <>
              <label className="kb-ut-field">
                <span className="kb-sr">Change role of selected</span>
                <select
                  value=""
                  onChange={(e) => {
                    if (e.target.value) changeRole(selectedVisible, e.target.value as MemberRole);
                  }}
                >
                  <option value="" disabled>Change role</option>
                  {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </label>
              <Button size="sm" icon="trash" onClick={() => setConfirmRemove(true)}>Remove</Button>
              <span className="kb-ut-grow" />
              <Button size="sm" variant="ghost" onClick={() => { setSelected([]); setNote(null); }}>Clear selection</Button>
            </>
          )}
        </div>
      ) : (
        <div className="kb-ut-tools">
          <label className="kb-ut-search">
            <Icon name="search" size={15} />
            <span className="kb-sr">Search members</span>
            <input type="search" placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} />
          </label>
          <label className="kb-ut-field">
            <span className="kb-sr">Filter by role</span>
            <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as MemberRole | "all")}>
              <option value="all">All roles</option>
              {ROLES.map((r) => <option key={r.id} value={r.id}>{r.label}s</option>)}
            </select>
          </label>
        </div>
      )}
      <p className="kb-ut-note" role="status">{note ? <><Icon name="lock" size={14} />{note}</> : null}</p>

      <div className="kb-ut-scroll" ref={scroller} style={{ maxHeight }} tabIndex={-1}>
        <table className="kb-ut-table">
          <colgroup>
            <col style={{ width: 44 }} />
            <col />
            <col style={{ width: 148 }} />
            <col style={{ width: 170 }} />
            <col style={{ width: 116 }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col" className="kb-ut-check">
                <input ref={headCheck} type="checkbox" checked={allChecked} onChange={toggleAll} aria-label={allChecked ? "Deselect all shown" : "Select all shown"} disabled={rowIds.length === 0} />
              </th>
              <SortHead label="Member" k="name" sort={sort} onSort={sortBy} />
              <SortHead label="Role" k="role" sort={sort} onSort={sortBy} />
              <SortHead label="Status" k="status" sort={sort} onSort={sortBy} />
              <SortHead label="Last active" k="lastActive" sort={sort} onSort={sortBy} />
            </tr>
          </thead>
          <tbody>
            {peopleRows.map((m) => (
              <Row
                key={m.id}
                m={m}
                now={now}
                you={m.id === currentUserId}
                checked={selected.includes(m.id)}
                onCheck={() => toggle(m.id)}
                locked={m.id === lastOwnerId}
                onRole={(r) => changeRole([m.id], r)}
                resent={resent.has(m.id)}
                onResend={() => resend(m.id)}
              />
            ))}
            {loadingMore ? Array.from({ length: 3 }, (_, i) => (
              <tr key={`sk${i}`} className="kb-ut-skel" aria-hidden>
                <td colSpan={5}><SkeletonRow /></td>
              </tr>
            )) : null}
          </tbody>
          {agentRows.length ? (
            <tbody className="kb-ut-agents">
              <tr className="kb-ut-section">
                <th scope="rowgroup" colSpan={5}>
                  Agents and service accounts <span>{agentRows.length}</span>
                </th>
              </tr>
              {agentRows.map((m) => (
                <Row key={m.id} m={m} now={now} checked={selected.includes(m.id)} onCheck={() => toggle(m.id)} onRole={(r) => changeRole([m.id], r)} />
              ))}
            </tbody>
          ) : null}
        </table>
        {nothing ? (
          <div className="kb-ut-state">
            <EmptyState
              size="sm"
              title={query ? `No members match "${query}"` : `No ${roleLabel(roleFilter as MemberRole).toLowerCase()}s yet`}
              body={remaining > 0 ? "More people are still to load. Load them, or invite someone new." : "Check the spelling, or invite them to the workspace."}
              action={{ label: "Clear filters", icon: "x", onClick: () => { setQuery(""); setRoleFilter("all"); } }}
            />
          </div>
        ) : null}
        <div ref={sentinel} className="kb-ut-sentinel" />
      </div>

      <footer className="kb-ut-foot">
        <span>
          Showing {loadedPeople.length} of {plural(totalPeople, "person", "people")}
        </span>
        <span className="kb-sr" role="status">{loadingMore ? "Loading more members" : ""}</span>
        {remaining > 0 ? (
          paging === "button" ? (
            <Button size="sm" icon="chevronDown" onClick={loadMore} loading={loadingMore} loadingLabel="Loading">
              Load {Math.min(pageSize, remaining)} more
            </Button>
          ) : (
            <span className="kb-ut-more">{loadingMore ? "Loading the next page" : "Scroll for more"}</span>
          )
        ) : (
          <span className="kb-ut-more">Everyone is loaded</span>
        )}
      </footer>
    </section>
  );
}

function SortHead({ label, k, sort, onSort }: { label: string; k: MemberSortKey; sort: { key: MemberSortKey; dir: 1 | -1 }; onSort: (k: MemberSortKey) => void }) {
  const on = sort.key === k;
  return (
    <th scope="col" aria-sort={on ? (sort.dir === 1 ? "ascending" : "descending") : "none"}>
      <button type="button" className="kb-ut-sort" data-on={on || undefined} onClick={() => onSort(k)}>
        {label}
        <Icon name={on && sort.dir === -1 ? "arrowUp" : "arrowDown"} size={13} />
      </button>
    </th>
  );
}

function Seats({ used, total }: { used: number; total: number }) {
  const shown = Math.min(total, 40);
  const filled = Math.round((Math.min(used, total) / total) * shown);
  return (
    <div className="kb-ut-seats">
      <span className="kb-ut-studs" role="meter" aria-label="Seats used" aria-valuemin={0} aria-valuemax={total} aria-valuenow={used} aria-valuetext={`${used} of ${total} seats used`}>
        {Array.from({ length: shown }, (_, i) => <i key={i} data-on={i < filled || undefined} />)}
      </span>
      <span className="kb-ut-seat-text"><code>{used}</code> of <code>{total}</code> seats</span>
    </div>
  );
}

function AgentMark() {
  return (
    <span className="kb-ut-agent-mark" aria-hidden>
      <Icon name="robot" size={16} />
    </span>
  );
}

interface RowProps {
  m: WorkspaceMember;
  now: number | null;
  you?: boolean;
  checked: boolean;
  onCheck: () => void;
  locked?: boolean;
  onRole: (r: MemberRole) => void;
  resent?: boolean;
  onResend?: () => void;
}

function Row({ m, now, you, checked, onCheck, locked, onRole, resent, onResend }: RowProps) {
  const agent = m.kind === "agent";
  const roleOptions = agent ? ROLES.filter((r) => r.id !== "owner") : ROLES;
  const lockId = `kb-ut-lock-${m.id}`;
  return (
    <tr data-selected={checked || undefined} data-status={m.status}>
      <td className="kb-ut-check">
        <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select ${m.name}`} />
      </td>
      <td>
        <div className="kb-ut-who">
          {agent ? <AgentMark /> : <Avatar name={m.name} size={30} src={m.avatarUrl} />}
          <div className="kb-ut-name">
            <span>
              <strong>{m.name}</strong>
              {you ? <span className="kb-ut-you">You</span> : null}
            </span>
            {agent ? (
              <span className="kb-ut-sub"><code>{m.email}</code> owned by {m.ownerName ?? "nobody"}</span>
            ) : (
              <span className="kb-ut-sub">{m.email}</span>
            )}
          </div>
        </div>
      </td>
      <td>
        <label className="kb-ut-role" data-locked={locked || undefined}>
          <span className="kb-sr">Role for {m.name}</span>
          <select value={m.role} onChange={(e) => onRole(e.target.value as MemberRole)} disabled={locked} aria-describedby={locked ? lockId : undefined}>
            {roleOptions.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
          {locked ? (
            <span id={lockId} className="kb-ut-lock" title="The only owner. Make someone else owner first.">
              <Icon name="lock" size={13} />
              <span className="kb-sr">The only owner. Make someone else owner first.</span>
            </span>
          ) : null}
        </label>
      </td>
      <td>
        <div className="kb-ut-status">
          {m.working ? (
            <Tag tone="agent" live>Working</Tag>
          ) : m.status === "active" ? (
            <Tag tone="ok">Active</Tag>
          ) : m.status === "invited" ? (
            <Tag tone="decal">Invited</Tag>
          ) : (
            <Tag tone="neutral">Suspended</Tag>
          )}
          {m.status === "invited" && onResend ? (
            resent ? (
              <span className="kb-ut-resent"><Icon name="check" size={13} />Resent</span>
            ) : (
              <button type="button" className="kb-ut-link" onClick={onResend} aria-label={`Resend invite to ${m.email}`}>Resend</button>
            )
          ) : null}
        </div>
      </td>
      <td className="kb-ut-when">
        {m.lastActiveAt === null ? <span className="kb-ut-never">Never</span> : now ? relativeTime(m.lastActiveAt, now) : null}
      </td>
    </tr>
  );
}

function SkeletonRow() {
  return (
    <div className="kb-ut-skel-row">
      <Skeleton width={14} height={14} />
      <SkeletonCircle size={30} />
      <span className="kb-ut-skel-name">
        <Skeleton width="38%" height={11} />
        <Skeleton width="56%" height={9} style={{ marginTop: 7 }} />
      </span>
      <Skeleton width={110} height={26} radius="control" />
      <Skeleton width={84} height={11} />
      <Skeleton width={60} height={11} />
    </div>
  );
}
