import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon, Tag } from "../../shared/index.ts";
import "./integration-picker.css";

export type IntegrationStatus = "idle" | "authorizing" | "connected";

export interface IntegrationService {
  id: string;
  name: string;
  category: string;
  /** Tile color (data, not theme) */
  color: string;
  description: string;
  /** What the agent may do once connected, in plain words */
  scopes: string[];
  /** Account name shown once connected */
  account: string;
  status?: IntegrationStatus;
}

export interface IntegrationPickerProps {
  services?: IntegrationService[];
  /** Workspace the connection is for */
  workspace?: string;
  /** How many agents in the workspace get the connection */
  agentCount?: number;
  /** Id of the service picked first */
  defaultPicked?: string;
  defaultQuery?: string;
  /** Simulate the sign-in window finishing on its own after a short wait */
  demo?: boolean;
  onBack?: () => void;
  onStatusChange?: (id: string, status: IntegrationStatus) => void;
  className?: string;
}

export const DEMO_SERVICES: IntegrationService[] = [
  { id: "github", name: "GitHub", category: "Code", color: "#2b3540", description: "Read repositories, open branches and pull requests for review.", scopes: ["Read code in 4 selected repositories", "Open branches and pull requests", "Comment on reviews it was asked into"], account: "kitbash-bot", status: "connected" },
  { id: "linear", name: "Linear", category: "Issues", color: "#4b4fc4", description: "Turn findings into issues and keep their status in sync.", scopes: ["Create issues in Platform and Evals", "Update status on issues it created", "Read project cycles"], account: "maya@relaylabs.dev" },
  { id: "slack", name: "Slack", category: "Messaging", color: "#8a3f86", description: "Post run summaries and ask for approvals in channels you pick.", scopes: ["Post in #eval-runs and #agent-alerts", "Send approval requests by direct message", "Read threads it started"], account: "Relay Labs" },
  { id: "notion", name: "Notion", category: "Docs", color: "#5b5f66", description: "Write meeting notes and weekly reviews into shared pages.", scopes: ["Edit pages in Agent reviews", "Create pages from templates"], account: "Relay Labs wiki" },
  { id: "drive", name: "Drive", category: "Files", color: "#1f8a5b", description: "Save transcripts and reports to a folder the team owns.", scopes: ["Create files in Research / Evals", "Read files it created"], account: "research@relaylabs.dev" },
  { id: "postgres", name: "Postgres", category: "Data", color: "#2f6a9a", description: "Query the analytics replica with a read-only role.", scopes: ["Run read-only queries on analytics_replica", "Stop any query after 30 seconds"], account: "agent_ro on analytics_replica" },
  { id: "sentry", name: "Sentry", category: "Monitoring", color: "#6b3a8f", description: "Pull error traces into incident triage runs.", scopes: ["Read issues and traces for 3 projects", "Resolve issues it fixed"], account: "relay-labs" },
  { id: "pagerduty", name: "PagerDuty", category: "On-call", color: "#3f7a2a", description: "See who is on call and acknowledge pages from triage.", scopes: ["Read schedules", "Acknowledge incidents assigned to the agent"], account: "Relay on-call" },
];

function monogram(name: string): string {
  const caps = name.replace(/[^A-Z]/g, "");
  if (caps.length >= 2) return caps.slice(0, 2);
  const letters = name.replace(/[^A-Za-z]/g, "");
  return (letters.slice(0, 1).toUpperCase() + letters.slice(1, 2).toLowerCase()) || "?";
}

const STATUS_TEXT: Record<IntegrationStatus, string> = {
  idle: "Not connected",
  authorizing: "Waiting for you",
  connected: "Connected",
};

/**
 * Integrations page of a command menu: a search field over a list of services (combobox + listbox),
 * and the picked service shown on two tiles, the service and your workspace, joined by a molded runner
 * that shows the connection: dashed while open, decal yellow while sign-in waits on a person, cured green once joined.
 */
export function IntegrationPicker({
  services = DEMO_SERVICES,
  workspace = "Research agents",
  agentCount = 3,
  defaultPicked = "linear",
  defaultQuery = "",
  demo = true,
  onBack,
  onStatusChange,
  className,
}: IntegrationPickerProps) {
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(defaultQuery);
  const [status, setStatus] = useState<Record<string, IntegrationStatus>>(() =>
    Object.fromEntries(services.map((s) => [s.id, s.status ?? "idle"])),
  );
  const [pickedId, setPickedId] = useState(defaultPicked);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return services.filter((s) => !q || `${s.name} ${s.category} ${s.description}`.toLowerCase().includes(q));
  }, [services, query]);

  // The picked service follows the filter: if it drops out, the first match is picked.
  const picked = visible.find((s) => s.id === pickedId) ?? visible[0];
  const pickedStatus: IntegrationStatus = picked ? (status[picked.id] ?? "idle") : "idle";
  const optionId = (id: string) => `${uid}-svc-${id}`;

  const setOne = (id: string, next: IntegrationStatus) => {
    setStatus((s) => ({ ...s, [id]: next }));
    onStatusChange?.(id, next);
  };

  // Demo: the sign-in window "finishes" after a moment.
  useEffect(() => {
    if (!demo || !picked || pickedStatus !== "authorizing") return;
    const id = window.setTimeout(() => setOne(picked.id, "connected"), 2400);
    return () => window.clearTimeout(id);
  }, [demo, picked?.id, pickedStatus]);

  const move = (delta: number) => {
    if (!visible.length) return;
    const at = picked ? visible.indexOf(picked) : -1;
    const next = visible[(at + delta + visible.length) % visible.length];
    if (next) setPickedId(next.id);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Enter" && picked && pickedStatus === "idle") {
      event.preventDefault();
      setOne(picked.id, "authorizing");
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (query) setQuery("");
      else onBack?.();
    }
  };

  const connectedCount = services.filter((s) => status[s.id] === "connected").length;

  return (
    <div className={cx("kb-ip", className)}>
      <div className="kb-ip-head">
        <button type="button" className="kb-ip-back" aria-label="Back to commands" onClick={onBack}>
          <Icon name="chevronLeft" size={16} />
        </button>
        <span className="kb-ip-crumb">Integrations</span>
        <div className="kb-ip-field">
          <Icon name="search" size={16} />
          <input
            ref={inputRef}
            role="combobox"
            aria-label="Search integrations"
            aria-expanded="true"
            aria-controls={`${uid}-list`}
            aria-autocomplete="list"
            aria-activedescendant={picked ? optionId(picked.id) : undefined}
            placeholder="Search services"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </div>

      <div className="kb-ip-body">
        <div className="kb-ip-side">
          <div className="kb-ip-count">
            {visible.length} of {services.length} services, {connectedCount} connected
          </div>
          <div className="kb-ip-list" id={`${uid}-list`} role="listbox" aria-label="Services">
            {visible.map((s) => {
              const st = status[s.id] ?? "idle";
              const isPicked = picked?.id === s.id;
              return (
                <div
                  key={s.id}
                  id={optionId(s.id)}
                  role="option"
                  aria-selected={isPicked}
                  className="kb-ip-option"
                  data-picked={isPicked || undefined}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => {
                    setPickedId(s.id);
                    inputRef.current?.focus();
                  }}
                >
                  <span className="kb-ip-mono" style={{ background: s.color }} aria-hidden>{monogram(s.name)}</span>
                  <span className="kb-ip-option-text">
                    <span className="kb-ip-option-name">{s.name}</span>
                    <span className="kb-ip-option-cat">{s.category}</span>
                  </span>
                  <span className="kb-ip-pip" data-status={st} title={STATUS_TEXT[st]} />
                  <span className="kb-sr">, {STATUS_TEXT[st]}</span>
                </div>
              );
            })}
            {visible.length === 0 ? (
              <div className="kb-ip-empty">No service called “{query}” yet. Ask an admin to add a custom connector.</div>
            ) : null}
          </div>
        </div>

        {picked ? (
          <section className="kb-ip-detail" aria-labelledby={`${uid}-title`} data-status={pickedStatus}>
            <div className="kb-ip-title-row">
              <h3 id={`${uid}-title`} className="kb-ip-title">{picked.name}</h3>
              <Tag tone={pickedStatus === "connected" ? "ok" : pickedStatus === "authorizing" ? "decal" : "neutral"} dot live={pickedStatus === "authorizing"}>
                {STATUS_TEXT[pickedStatus]}
              </Tag>
            </div>
            <p className="kb-ip-desc">{picked.description}</p>

            <div className="kb-ip-pair">
              <div className="kb-ip-tile">
                <span className="kb-ip-mono kb-ip-mono-lg" style={{ background: picked.color }} aria-hidden>{monogram(picked.name)}</span>
                <span className="kb-ip-tile-name">{picked.name}</span>
                <span className="kb-ip-tile-sub">
                  {pickedStatus === "connected" ? picked.account : pickedStatus === "authorizing" ? "Sign-in window open" : "No account linked"}
                </span>
              </div>
              <div className="kb-ip-runner" aria-hidden>
                <span className="kb-ip-runner-bar" />
                <span className="kb-ip-runner-gate">
                  {pickedStatus === "connected" ? <Icon name="check" size={14} strokeWidth={2.4} /> : pickedStatus === "authorizing" ? <Icon name="user" size={13} strokeWidth={2.2} /> : <Icon name="link" size={13} />}
                </span>
              </div>
              <div className="kb-ip-tile">
                <span className="kb-ip-ws" aria-hidden><Icon name="robot" size={22} /></span>
                <span className="kb-ip-tile-name">{workspace}</span>
                <span className="kb-ip-tile-sub">{agentCount} agents get access</span>
              </div>
            </div>

            <div className="kb-ip-scopes">
              <div className="kb-ip-scopes-title">What the agents can do</div>
              <ul>
                {picked.scopes.map((scope) => (
                  <li key={scope}>
                    <Icon name="check" size={14} />
                    {scope}
                  </li>
                ))}
              </ul>
            </div>

            <div className="kb-ip-actions" aria-live="polite">
              {pickedStatus === "idle" ? (
                <>
                  <span className="kb-ip-hint">You’ll finish sign-in in a new window.</span>
                  <Button variant="primary" icon="link" onClick={() => setOne(picked.id, "authorizing")}>Connect {picked.name}</Button>
                </>
              ) : pickedStatus === "authorizing" ? (
                <>
                  <span className="kb-ip-hint kb-ip-hint-decal">Approve access in the {picked.name} window to finish.</span>
                  <Button variant="ghost" onClick={() => setOne(picked.id, "idle")}>Cancel</Button>
                </>
              ) : (
                <>
                  <span className="kb-ip-hint">Connected as {picked.account}</span>
                  <Button variant="ghost" icon="x" onClick={() => setOne(picked.id, "idle")}>Disconnect</Button>
                </>
              )}
            </div>
          </section>
        ) : (
          <section className="kb-ip-detail kb-ip-detail-empty">
            <Icon name="search" size={20} />
            <span>Pick a service to see what it connects.</span>
          </section>
        )}
      </div>
    </div>
  );
}
