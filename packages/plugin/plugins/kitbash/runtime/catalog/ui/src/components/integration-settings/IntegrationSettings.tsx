"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon, Spinner, Tag } from "../../shared/index.ts";
import "./integration-settings.css";

export interface IntegrationConfig {
  enabled: boolean;
  apiKey: string;
  site: string;
  timeZone: string;
}

export interface IntegrationSettingsProps {
  /** Service display name */
  service?: string;
  /** What the agent does with it, one line */
  purpose?: string;
  /** Domain the site address lives under */
  domain?: string;
  /** Accepted key prefixes */
  keyPrefixes?: string[];
  initial?: IntegrationConfig;
  /** Start with unsaved edits on top of `initial` (for docs) */
  initialEdits?: Partial<IntegrationConfig>;
  timeZones?: string[];
  /** Resolve to save; reject or throw to show an error */
  onSave?: (config: IntegrationConfig) => Promise<void> | void;
  className?: string;
}

const DEFAULT_CONFIG: IntegrationConfig = {
  enabled: true,
  apiKey: "fl_live_9c41e07b2d8a4f6e93b15c7d0a2e3f9a",
  site: "northwind-support",
  timeZone: "America/Los_Angeles",
};

const ZONES = ["America/Los_Angeles", "America/New_York", "Europe/London", "Europe/Berlin", "Asia/Singapore", "Australia/Sydney"];

function zoneLabel(zone: string) {
  const time = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).format(new Date());
  const city = zone.split("/").pop()!.replace(/_/g, " ");
  return `${city} (${time} now)`;
}

/** Field-level checks; empty string means valid */
function validate(c: IntegrationConfig, prefixes: string[]) {
  const errors: Partial<Record<keyof IntegrationConfig, string>> = {};
  if (!c.apiKey.trim()) errors.apiKey = "Paste the API key from your admin settings.";
  else if (!prefixes.some((p) => c.apiKey.startsWith(p))) errors.apiKey = `Keys start with ${prefixes.join(" or ")}.`;
  else if (c.apiKey.length < 24) errors.apiKey = "That key looks cut off. It should be at least 24 characters.";
  if (!c.site.trim()) errors.site = "Enter your site address.";
  else if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(c.site)) errors.site = "Use lowercase letters, numbers and dashes only.";
  else if (c.site.length < 3) errors.site = "Site addresses are at least 3 characters.";
  return errors;
}

/**
 * Settings card for a connected service: an on/off switch, API key, validated site address, time zone and a save bar.
 * Turning it off unplugs the body (it sinks into a dimmed, recessed well). Unsaved edits dock a save bar into the
 * card's bottom seam with a decal-yellow edge, because they are waiting on a person.
 */
export function IntegrationSettings({
  service = "Frontline Helpdesk",
  purpose = "Lets the support agent read tickets, draft replies and tag conversations.",
  domain = "frontline.help",
  keyPrefixes = ["fl_live_", "fl_test_"],
  initial = DEFAULT_CONFIG,
  initialEdits,
  timeZones = ZONES,
  onSave,
  className,
}: IntegrationSettingsProps) {
  const id = useId();
  const [saved, setSaved] = useState(initial);
  const [draft, setDraft] = useState<IntegrationConfig>({ ...initial, ...initialEdits });
  const [touched, setTouched] = useState<Partial<Record<keyof IntegrationConfig, boolean>>>(() =>
    Object.fromEntries(Object.keys(initialEdits ?? {}).map((k) => [k, true])),
  );
  const [reveal, setReveal] = useState(Boolean(initialEdits?.apiKey));
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [reach, setReach] = useState<"idle" | "checking" | "ok">("ok");

  const errors = useMemo(() => validate(draft, keyPrefixes), [draft, keyPrefixes]);
  const changed = (Object.keys(draft) as Array<keyof IntegrationConfig>).filter((k) => draft[k] !== saved[k]);
  const dirty = changed.length > 0;
  const hasErrors = Object.keys(errors).length > 0;
  const testMode = draft.apiKey.startsWith("fl_test_");

  // Simulated reachability check for the site address once it is valid
  useEffect(() => {
    if (errors.site) {
      setReach("idle");
      return;
    }
    setReach("checking");
    const t = window.setTimeout(() => setReach("ok"), 650);
    return () => window.clearTimeout(t);
  }, [draft.site, errors.site]);

  function set<K extends keyof IntegrationConfig>(k: K, v: IntegrationConfig[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    setJustSaved(false);
    setSaveError("");
  }

  async function save() {
    setTouched({ apiKey: true, site: true });
    if (hasErrors) return;
    setSaving(true);
    try {
      await (onSave ? onSave(draft) : new Promise((r) => window.setTimeout(r, 900)));
      setSaved(draft);
      setJustSaved(true);
      window.setTimeout(() => setJustSaved(false), 1800);
    } catch {
      setSaveError("Couldn't save. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  function discard() {
    setDraft(saved);
    setTouched({});
    setSaveError("");
  }

  const showErr = (k: keyof IntegrationConfig) => (touched[k] ? errors[k] : undefined);
  const masked = draft.apiKey.length > 12 ? `${draft.apiKey.slice(0, 8)}${"•".repeat(16)}${draft.apiKey.slice(-4)}` : draft.apiKey;

  return (
    <section className={cx("kb-root kb-is kb-part", className)} aria-labelledby={`${id}-title`} data-off={!draft.enabled || undefined}>
      <header className="kb-is-head">
        <span className="kb-is-logo" aria-hidden>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v6a3 3 0 0 1-3 3h-5l-5 4v-4H7a3 3 0 0 1-3-3z" />
            <path d="M9 10h6" />
          </svg>
        </span>
        <div className="kb-is-title">
          <h3 id={`${id}-title`}>{service}</h3>
          <p>{purpose}</p>
        </div>
        <div className="kb-is-switch-wrap">
          <span className="kb-is-switch-state" aria-hidden>{draft.enabled ? "On" : "Off"}</span>
          <button
            type="button"
            role="switch"
            aria-checked={draft.enabled}
            aria-label={`Connect ${service}`}
            className="kb-is-switch"
            onClick={() => set("enabled", !draft.enabled)}
          >
            <span className="kb-is-thumb" />
          </button>
        </div>
      </header>

      <div className="kb-is-body" aria-disabled={!draft.enabled || undefined}>
        {!draft.enabled ? (
          <p className="kb-is-paused">
            <Icon name="pause" size={14} />
            Paused. The support agent won't read or reply to tickets until you turn this back on.
          </p>
        ) : null}

        <div className="kb-is-field">
          <div className="kb-is-label-row">
            <label htmlFor={`${id}-key`}>API key</label>
            {testMode ? <Tag tone="info">Test mode</Tag> : null}
          </div>
          <div className="kb-is-well" data-invalid={showErr("apiKey") ? "" : undefined}>
            <Icon name="key" size={15} className="kb-is-well-icon" />
            <input
              id={`${id}-key`}
              className="kb-is-input kb-is-mono"
              type="text"
              value={reveal ? draft.apiKey : masked}
              readOnly={!reveal}
              disabled={!draft.enabled}
              onChange={(e) => set("apiKey", e.target.value.trim())}
              onBlur={() => setTouched((t) => ({ ...t, apiKey: true }))}
              aria-invalid={!!showErr("apiKey") || undefined}
              aria-describedby={`${id}-key-msg`}
              spellCheck={false}
              autoComplete="off"
            />
            <button type="button" className="kb-is-inline-btn" onClick={() => setReveal((r) => !r)} disabled={!draft.enabled}>
              <Icon name={reveal ? "eyeOff" : "eye"} size={14} />
              {reveal ? "Hide" : "Show and edit"}
            </button>
          </div>
          <p className="kb-is-msg" id={`${id}-key-msg`} data-tone={showErr("apiKey") ? "danger" : undefined}>
            {showErr("apiKey") ?? "Stored encrypted. Only the last four characters are shown."}
          </p>
        </div>

        <div className="kb-is-field">
          <label htmlFor={`${id}-site`}>Site address</label>
          <div className="kb-is-well" data-invalid={showErr("site") ? "" : undefined}>
            <span className="kb-is-affix">https://</span>
            <input
              id={`${id}-site`}
              className="kb-is-input"
              value={draft.site}
              disabled={!draft.enabled}
              onChange={(e) => set("site", e.target.value.toLowerCase())}
              onBlur={() => setTouched((t) => ({ ...t, site: true }))}
              aria-invalid={!!showErr("site") || undefined}
              aria-describedby={`${id}-site-msg`}
              spellCheck={false}
              autoComplete="off"
            />
            <span className="kb-is-affix">.{domain}</span>
            <span className="kb-is-reach" aria-hidden>
              {reach === "checking" ? <Spinner size={12} label="Checking" /> : reach === "ok" && !errors.site ? <Icon name="check" size={14} strokeWidth={2.25} /> : null}
            </span>
          </div>
          <p className="kb-is-msg" id={`${id}-site-msg`} data-tone={showErr("site") ? "danger" : reach === "ok" && !errors.site ? "ok" : undefined} aria-live="polite">
            {showErr("site") ?? (reach === "checking" ? "Checking the address" : reach === "ok" && !errors.site ? `Reachable at ${draft.site}.${domain}` : "Your workspace's address")}
          </p>
        </div>

        <div className="kb-is-field">
          <label htmlFor={`${id}-tz`}>Time zone</label>
          <div className="kb-is-well kb-is-select-well">
            <Icon name="clock" size={15} className="kb-is-well-icon" />
            <select id={`${id}-tz`} data-own-arrow className="kb-is-input kb-is-select" value={draft.timeZone} disabled={!draft.enabled} onChange={(e) => set("timeZone", e.target.value)} aria-describedby={`${id}-tz-msg`}>
              {timeZones.map((z) => (
                <option key={z} value={z}>{zoneLabel(z)}</option>
              ))}
            </select>
            <Icon name="chevronDown" size={15} className="kb-is-well-icon" />
          </div>
          <p className="kb-is-msg" id={`${id}-tz-msg`}>Business hours and SLA timers follow this zone.</p>
        </div>
      </div>

      <div className="kb-is-dock" data-show={dirty || justSaved || undefined} data-saved={justSaved || undefined} aria-hidden={!(dirty || justSaved)}>
        <div className="kb-is-bar" role="region" aria-label="Unsaved changes">
          {justSaved && !dirty ? (
            <p className="kb-is-bar-text" role="status">
              <Icon name="check" size={15} strokeWidth={2.25} />
              Saved. The agent picks this up on its next run.
            </p>
          ) : (
            <>
              <p className="kb-is-bar-text" role="status">
                {saveError || (hasErrors && (touched.apiKey || touched.site) ? `Fix the highlighted ${Object.keys(errors).length === 1 ? "field" : "fields"} to save.` : `${changed.length} unsaved ${changed.length === 1 ? "change" : "changes"}`)}
              </p>
              <Button size="sm" variant="ghost" onClick={discard} disabled={saving} tabIndex={dirty ? 0 : -1}>Discard</Button>
              <Button size="sm" variant="primary" onClick={save} loading={saving} loadingLabel="Saving" tabIndex={dirty ? 0 : -1}>Save changes</Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
