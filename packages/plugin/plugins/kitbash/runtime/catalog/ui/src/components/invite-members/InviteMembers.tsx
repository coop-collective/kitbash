"use client";

import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { Button } from "../button/Button.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { FreshnessBadge } from "../freshness-badge/FreshnessBadge.tsx";
import { Skeleton, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { Icon, Spinner, Tag, cx, type LoadStatus } from "../../shared/index.ts";
import "./invite-members.css";

export type InviteRole = "admin" | "member" | "viewer";

export interface InviteResult {
  email: string;
  status: "sent" | "member" | "failed";
  /** Why it failed, in words a person can act on */
  reason?: string;
}

/** Problems an address can carry before sending */
export type AddressFlag = "invalid" | "duplicate" | "member";

export interface InviteMembersProps {
  /** Addresses in the field; with onEmailsChange the field is controlled */
  emails?: string[];
  onEmailsChange?: (emails: string[]) => void;
  defaultEmails?: string[];
  role?: InviteRole;
  onRoleChange?: (role: InviteRole) => void;
  /** Emails already in the workspace, flagged instead of invited */
  existingEmails?: string[];
  workspaceName?: string;
  seats?: { used: number; total: number };
  /** Price of one paid seat per month; viewers are free */
  seatPrice?: number;
  /** Sends one invite. Without it a demo sender answers after a short delay */
  sendInvite?: (email: string, role: InviteRole, message: string) => Promise<InviteResult>;
  /** Start on the result list, e.g. to show what happened to an earlier send */
  defaultResults?: InviteResult[];
  /** Called once every address has an answer */
  onSent?: (results: InviteResult[]) => void;
  onCancel?: () => void;
  /** Seat and member data still loading */
  loading?: boolean;
  /** Seat and member data failed to load */
  error?: string | null;
  onRetry?: () => void;
  status?: LoadStatus;
  updatedAt?: number | null;
  onRefresh?: () => void;
  className?: string;
}

export const DEMO_EXISTING = ["ana@northwind.dev", "priya@northwind.dev", "marcus@northwind.dev", "lena.fischer@northwind.dev"];
export const DEMO_EMAILS = ["maya@relaylabs.dev", "kenji.ito@relaylabs.dev", "sofia.marin@globex.io", "priya@northwind.dev", "devon@relaylabs", "maya@relaylabs.dev"];

const ROLES: Array<{ id: InviteRole; label: string; detail: string; paid: boolean }> = [
  { id: "admin", label: "Admin", detail: "Manage members, billing and agent permissions", paid: true },
  { id: "member", label: "Member", detail: "Run agents and approve what they do", paid: true },
  { id: "viewer", label: "Viewer", detail: "Read runs, traces and reports. Free", paid: false },
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MESSAGE_MAX = 280;

/** Demo sender: Globex's mail server bounces, one address joined from another invite meanwhile */
export function demoSendInvite(email: string): Promise<InviteResult> {
  const delay = 500 + ((email.length * 137) % 900);
  return new Promise((ok) =>
    setTimeout(() => {
      if (email.endsWith("@globex.io")) ok({ email, status: "failed", reason: "Their mail server rejected it (550, sender blocked). Ask them to allow northwind.dev." });
      else if (email.startsWith("kenji")) ok({ email, status: "member", reason: "Joined through a team link a moment ago" });
      else ok({ email, status: "sent" });
    }, delay),
  );
}

export function flagsFor(emails: string[], existing: string[]): Array<AddressFlag | null> {
  const seen = new Set<string>();
  const members = new Set(existing.map((e) => e.toLowerCase()));
  return emails.map((raw) => {
    const e = raw.toLowerCase();
    const flag: AddressFlag | null = !EMAIL.test(e) ? "invalid" : seen.has(e) ? "duplicate" : members.has(e) ? "member" : null;
    seen.add(e);
    return flag;
  });
}

const FLAG_TEXT: Record<AddressFlag, string> = { invalid: "Not an email", duplicate: "Listed twice", member: "Already a member" };

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * Invite several people at once. Addresses snap into the field as parts; anything that can't be invited is flagged
 * on its own part (not an email, listed twice, already a member) and left out of the count. The footer prices the
 * seats before you send, and sending turns the field into a per-address result list.
 */
export function InviteMembers({
  emails: emailsProp,
  onEmailsChange,
  defaultEmails = DEMO_EMAILS,
  role: roleProp,
  onRoleChange,
  existingEmails = DEMO_EXISTING,
  workspaceName = "Northwind",
  seats = { used: 26, total: 40 },
  seatPrice = 16,
  sendInvite = demoSendInvite,
  defaultResults,
  onSent,
  onCancel,
  loading = false,
  error = null,
  onRetry,
  status,
  updatedAt = null,
  onRefresh,
  className,
}: InviteMembersProps) {
  const id = useId();
  const [innerEmails, setInnerEmails] = useState(defaultEmails);
  const emails = emailsProp ?? innerEmails;
  const setEmails = (next: string[]) => {
    if (!emailsProp) setInnerEmails(next);
    onEmailsChange?.(next);
  };
  const [innerRole, setInnerRole] = useState<InviteRole>("member");
  const role = roleProp ?? innerRole;
  const setRole = (r: InviteRole) => {
    if (!roleProp) setInnerRole(r);
    onRoleChange?.(r);
  };

  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const [hint, setHint] = useState("");
  const [results, setResults] = useState<Array<InviteResult | { email: string; status: "pending" }> | null>(defaultResults ?? null);
  const input = useRef<HTMLInputElement>(null);
  const alive = useRef(true);
  useEffect(() => () => {
    alive.current = false;
  }, []);

  const flags = flagsFor(emails, existingEmails);
  const ready = emails.filter((_, i) => !flags[i]);
  const flagged = flags.filter(Boolean).length;
  const paid = ROLES.find((r) => r.id === role)?.paid ?? true;
  const added = paid ? ready.length : 0;
  const after = seats.used + added;

  const add = (text: string) => {
    const parts = text.split(/[\s,;<>]+/).map((s) => s.trim().replace(/^mailto:/i, "")).filter(Boolean);
    if (!parts.length) return;
    setEmails([...emails, ...parts]);
    setHint(parts.length > 1 ? `Added ${parts.length} addresses` : `Added ${parts[0]}`);
  };
  const commit = () => {
    if (draft.trim()) add(draft);
    setDraft("");
  };
  const removeAt = (i: number) => {
    const gone = emails[i];
    setEmails(emails.filter((_, j) => j !== i));
    setHint(gone ? `Removed ${gone}` : "");
    input.current?.focus();
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "," || e.key === ";" || (e.key === " " && draft.includes("@")) || (e.key === "Tab" && draft.trim())) {
      if (draft.trim()) {
        e.preventDefault();
        commit();
      } else if (e.key === "Enter") e.preventDefault();
    } else if (e.key === "Backspace" && !draft && emails.length) {
      e.preventDefault();
      const last = emails[emails.length - 1] ?? "";
      setEmails(emails.slice(0, -1));
      setDraft(last);
      setHint(`Editing ${last}`);
    }
  };
  const onPaste = (e: ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData("text");
    if (/[\s,;]/.test(text.trim())) {
      e.preventDefault();
      add(draft + text);
      setDraft("");
    }
  };

  const send = () => {
    const list = ready;
    if (!list.length) return;
    setResults(list.map((email) => ({ email, status: "pending" as const })));
    const done: InviteResult[] = [];
    list.forEach((email, i) => {
      sendInvite(email, role, message)
        .catch((err: unknown): InviteResult => ({ email, status: "failed", reason: err instanceof Error ? err.message : "Couldn't reach the mail service" }))
        .then((r) => {
          if (!alive.current) return;
          done.push(r);
          setResults((rs) => (rs ? rs.map((x, j) => (j === i ? r : x)) : rs));
          if (done.length === list.length) onSent?.(done);
        });
    });
  };
  const sending = results?.some((r) => r.status === "pending") ?? false;
  const failed = results?.filter((r): r is InviteResult => r.status === "failed") ?? [];
  const sentCount = results?.filter((r) => r.status === "sent").length ?? 0;

  const retryFailed = () => {
    const again = failed.map((f) => f.email);
    setEmails(again);
    setResults(null);
    setHint(`${plural(again.length, "address", "addresses")} back in the list`);
  };
  const startOver = () => {
    setEmails([]);
    setMessage("");
    setResults(null);
    setHint("");
  };

  const cost = (
    <p className="kb-im-cost" aria-live="polite">
      {added > 0 ? (
        <>
          <strong>{plural(added, "seat")}, <code>${(added * seatPrice).toLocaleString("en-US")}</code>/month more</strong>
          <span>{after > seats.total ? `${after} seats, ${after - seats.total} over your plan's ${seats.total}` : `${after} of ${seats.total} seats after this`}</span>
        </>
      ) : ready.length > 0 ? (
        <>
          <strong>No extra cost</strong>
          <span>Viewers don't take a seat</span>
        </>
      ) : (
        <>
          <strong>Add someone to invite</strong>
          <span><code>{seats.used}</code> of <code>{seats.total}</code> seats in use</span>
        </>
      )}
    </p>
  );

  const header = (
    <header className="kb-im-head">
      <div>
        <h3 id={`${id}-title`}>Invite people to {workspaceName}</h3>
        <p>They get an email with a link that expires in 7 days.</p>
      </div>
      {status ? <FreshnessBadge status={status} updatedAt={updatedAt} onRefresh={onRefresh} /> : null}
    </header>
  );

  if (loading) {
    return (
      <section className={cx("kb-im", className)} aria-label="Invite people">
        <SkeletonRegion label="Loading seats and members">
          <div className="kb-im-head">
            <div>
              <Skeleton width={240} height={14} />
              <Skeleton width={300} height={10} style={{ marginTop: 9 }} />
            </div>
          </div>
          <div className="kb-im-body">
            <Skeleton height={96} radius="control" />
            <div className="kb-im-skel-roles">
              {[0, 1, 2].map((i) => <Skeleton key={i} height={54} radius="control" />)}
            </div>
            <Skeleton height={72} radius="control" />
          </div>
          <div className="kb-im-foot">
            <Skeleton width={200} height={12} />
            <Skeleton width={140} height={36} radius="control" />
          </div>
        </SkeletonRegion>
      </section>
    );
  }

  if (error) {
    return (
      <section className={cx("kb-im", className)} aria-label="Invite people">
        {header}
        <div className="kb-im-state">
          <ErrorState title="Couldn't load your seats" body={error} onRetry={onRetry} detail={undefined} />
        </div>
      </section>
    );
  }

  return (
    <section className={cx("kb-im", className)} aria-labelledby={`${id}-title`}>
      {header}

      {results ? (
        <div className="kb-im-body">
          <ul className="kb-im-results" aria-label="Invite results" aria-live="polite">
            {results.map((r) => (
              <li key={r.email} data-status={r.status}>
                <span className="kb-im-addr">{r.email}</span>
                <span className="kb-im-res">
                  {r.status === "pending" ? (
                    <span className="kb-im-pending"><Spinner size={12} label={`Sending to ${r.email}`} />Sending</span>
                  ) : r.status === "sent" ? (
                    <Tag tone="ok">Sent</Tag>
                  ) : r.status === "member" ? (
                    <Tag tone="neutral">Already a member</Tag>
                  ) : (
                    <Tag tone="danger">Failed</Tag>
                  )}
                </span>
                {"reason" in r && r.reason ? <span className="kb-im-reason">{r.reason}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <div className="kb-im-body">
          <div className="kb-im-label-row">
            <label htmlFor={`${id}-input`} className="kb-im-label">Email addresses</label>
            {flagged ? (
              <button type="button" className="kb-im-clean" onClick={() => setEmails(emails.filter((_, i) => !flags[i]))}>
                Remove {flagged} flagged
              </button>
            ) : null}
          </div>
          <div className="kb-im-field" onClick={(e) => e.target === e.currentTarget && input.current?.focus()}>
            <ul className="kb-im-chips" aria-label="Addresses to invite">
              {emails.map((email, i) => {
                const flag = flags[i];
                return (
                  <li key={`${email}-${i}`} className="kb-im-chip" data-flag={flag ?? undefined}>
                    {flag === "invalid" ? <i className="kb-im-mark" aria-hidden /> : null}
                    <span className="kb-im-chip-text">{email}</span>
                    {flag ? <span className="kb-im-flag">{FLAG_TEXT[flag]}</span> : null}
                    <button type="button" className="kb-im-x" onClick={() => removeAt(i)} aria-label={`Remove ${email}${flag ? `, ${FLAG_TEXT[flag].toLowerCase()}` : ""}`}>
                      <Icon name="x" size={12} />
                    </button>
                  </li>
                );
              })}
            </ul>
            <input
              ref={input}
              id={`${id}-input`}
              className="kb-im-input"
              type="text"
              inputMode="email"
              autoComplete="off"
              spellCheck={false}
              placeholder={emails.length ? "Add another" : "name@company.com, or paste a list"}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onKey}
              onPaste={onPaste}
              onBlur={commit}
              aria-describedby={`${id}-help`}
            />
          </div>
          <p id={`${id}-help`} className="kb-im-help">
            {ready.length ? `${plural(ready.length, "person", "people")} ready to invite` : "Nobody ready to invite yet"}
            {flagged ? `, ${flagged} flagged and left out` : ""}. Press Enter after each address, or paste a list.
          </p>
          <span className="kb-sr" role="status">{hint}</span>

          <fieldset className="kb-im-roles">
            <legend className="kb-im-label">Role</legend>
            <div className="kb-im-role-grid">
              {ROLES.map((r) => (
                <label key={r.id} className="kb-im-role" data-on={role === r.id || undefined}>
                  <input type="radio" name={`${id}-role`} value={r.id} checked={role === r.id} onChange={() => setRole(r.id)} />
                  <span className="kb-im-role-name">{r.label}</span>
                  <span className="kb-im-role-detail">{r.detail}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="kb-im-msg">
            <div className="kb-im-label-row">
              <label htmlFor={`${id}-msg`} className="kb-im-label">Message <span>optional</span></label>
              <span className="kb-im-count" data-over={message.length > MESSAGE_MAX - 20 || undefined}>{message.length}/{MESSAGE_MAX}</span>
            </div>
            <textarea
              id={`${id}-msg`}
              rows={2}
              maxLength={MESSAGE_MAX}
              placeholder="We're moving support triage to agents. Come help review the first runs."
              value={message}
              onChange={(e) => setMessage(e.target.value)}
            />
          </div>
        </div>
      )}

      <footer className="kb-im-foot">
        {results ? (
          <>
            <p className="kb-im-cost" aria-live="polite">
              <strong>{sending ? `Sending ${plural(results.length, "invite")}` : `${sentCount} sent${failed.length ? `, ${failed.length} failed` : ""}`}</strong>
              <span>{sending ? "You can close this; sending continues." : failed.length ? "Fix the failed addresses and try them again." : "They'll show as invited until they accept."}</span>
            </p>
            <div className="kb-im-actions">
              {failed.length && !sending ? <Button icon="refresh" onClick={retryFailed}>Retry failed</Button> : null}
              <Button variant={failed.length ? "ghost" : "secondary"} onClick={startOver} disabled={sending}>Invite more</Button>
            </div>
          </>
        ) : (
          <>
            {cost}
            <div className="kb-im-actions">
              {onCancel ? <Button variant="ghost" onClick={onCancel}>Cancel</Button> : null}
              <Button variant="primary" icon="send" onClick={send} disabled={!ready.length}>
                {ready.length ? `Send ${plural(ready.length, "invite")}` : "Send invites"}
              </Button>
            </div>
          </>
        )}
      </footer>
    </section>
  );
}
