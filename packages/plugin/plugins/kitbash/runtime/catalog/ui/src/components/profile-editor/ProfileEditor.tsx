"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "../button/Button.tsx";
import { ErrorState } from "../error-state/ErrorState.tsx";
import { Skeleton, SkeletonCircle, SkeletonRegion } from "../skeleton/Skeleton.tsx";
import { Avatar, Icon, Spinner, cx, useNow } from "../../shared/index.ts";
import "./profile-editor.css";

export interface EditableProfile {
  name: string;
  handle: string;
  title: string;
  /** IANA time zone */
  timeZone: string;
  bio: string;
  /** Image URL or data URL; null for initials */
  avatarUrl: string | null;
}

export interface ProfileEditorProps {
  /** The saved profile. When it changes, the form resets to it */
  profile?: EditableProfile;
  /** Save the edited profile; reject with an Error to show its message. Without it a demo save waits briefly */
  onSave?: (next: EditableProfile) => Promise<void>;
  /** Resolve true when a handle is free. Without it a demo lookup treats a few handles as taken */
  checkHandle?: (handle: string) => Promise<boolean>;
  /** Time zones to offer */
  timeZones?: string[];
  /** Start with unsaved edits on top of `profile` (demos, or restoring a draft) */
  defaultChanges?: Partial<EditableProfile>;
  /** Open the crop step on this image, e.g. to show the cropper without picking a file */
  defaultCropSrc?: string;
  /** Base of the public profile URL shown under the handle */
  profileBase?: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  className?: string;
}

export const DEMO_PROFILE: EditableProfile = {
  name: "Priya Shah",
  handle: "priya",
  title: "Staff engineer, agent platform",
  timeZone: "Asia/Kolkata",
  bio: "I build the guardrails our agents run inside: permission scopes, approval routing and replay tooling.",
  avatarUrl: null,
};

export const DEMO_TIME_ZONES = [
  "America/Los_Angeles",
  "America/Denver",
  "America/Chicago",
  "America/New_York",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Berlin",
  "Africa/Lagos",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
  "Pacific/Auckland",
];

/** A drawn stand-in portrait for the crop demo */
export const DEMO_CROP_SRC =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480" viewBox="0 0 640 480"><rect width="640" height="480" fill="#7d8f9c"/><rect y="330" width="640" height="150" fill="#5d6f7c"/><circle cx="520" cy="90" r="46" fill="#c9d3da"/><path d="M200 480c0-90 50-150 120-150s120 60 120 150z" fill="#2f4858"/><circle cx="320" cy="225" r="78" fill="#b9785a"/><path d="M240 215c0-60 40-92 82-92s78 30 78 88c-20-26-52-40-82-40s-56 18-78 44z" fill="#1d2830"/></svg>`,
  );

const HANDLE = /^[a-z0-9_]{3,20}$/;
const BIO_MAX = 160;
const TAKEN = ["admin", "support", "priyashah", "kitbash", "agent", "root", "team"];

export function demoCheckHandle(handle: string): Promise<boolean> {
  return new Promise((ok) => setTimeout(() => ok(!TAKEN.includes(handle)), 650));
}
const demoSave = () => new Promise<void>((ok) => setTimeout(ok, 900));

type HandleState = "idle" | "checking" | "available" | "taken" | "error";
type Field = "name" | "handle" | "bio";

function validate(p: EditableProfile, handleState: HandleState, savedHandle: string): Partial<Record<Field, string>> {
  const e: Partial<Record<Field, string>> = {};
  if (!p.name.trim()) e.name = "Add your name so teammates know who approved what.";
  else if (p.name.length > 60) e.name = "Keep it under 60 characters.";
  if (!HANDLE.test(p.handle)) e.handle = "Use 3 to 20 lowercase letters, numbers or underscores.";
  else if (p.handle !== savedHandle && handleState === "taken") e.handle = `@${p.handle} is taken. Try another.`;
  if (p.bio.length > BIO_MAX) e.bio = `Trim ${p.bio.length - BIO_MAX} characters.`;
  return e;
}

const zoneLabel = (z: string) => z.split("/").pop()?.replace(/_/g, " ") ?? z;

function clockIn(timeZone: string, now: number) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, hour: "2-digit", minute: "2-digit", hour12: false }).format(now).replace(/^24/, "00");
  } catch {
    return "--:--";
  }
}

/**
 * Edit your own profile. The photo goes through a crop step (drag or arrow keys to move, a ribbed slider to zoom)
 * with live previews at the sizes people will see; the handle is checked as you type; and a save bar snaps up
 * from the bottom only while there are changes, then confirms once they're saved.
 */
export function ProfileEditor({
  profile = DEMO_PROFILE,
  onSave = demoSave,
  checkHandle = demoCheckHandle,
  timeZones = DEMO_TIME_ZONES,
  defaultChanges,
  defaultCropSrc,
  profileBase = "northwind.kitbash.dev/@",
  loading = false,
  error = null,
  onRetry,
  className,
}: ProfileEditorProps) {
  const id = useId();
  const now = useNow(30_000);
  const [saved, setSaved] = useState(profile);
  const [draft, setDraft] = useState(() => ({ ...profile, ...defaultChanges }));
  const prevProfile = useRef(profile);
  useEffect(() => {
    if (prevProfile.current === profile) return;
    prevProfile.current = profile;
    setSaved(profile);
    setDraft(profile);
  }, [profile]);

  const [touched, setTouched] = useState<Partial<Record<Field, boolean>>>(() => Object.fromEntries(Object.keys(defaultChanges ?? {}).map((k) => [k, true])));
  const [tried, setTried] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  // Handle availability: debounced lookup, ignoring answers to handles no longer in the field
  const [handleState, setHandleState] = useState<HandleState>("idle");
  useEffect(() => {
    const h = draft.handle;
    if (h === saved.handle || !HANDLE.test(h)) return setHandleState("idle");
    setHandleState("checking");
    let live = true;
    const t = window.setTimeout(() => {
      checkHandle(h).then(
        (free) => live && setHandleState(free ? "available" : "taken"),
        () => live && setHandleState("error"),
      );
    }, 400);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [draft.handle, saved.handle]); // eslint-disable-line react-hooks/exhaustive-deps

  const savedTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (savedTimer.current) window.clearTimeout(savedTimer.current);
  }, []);

  // Crop step
  const [cropSrc, setCropSrc] = useState<string | null>(defaultCropSrc ?? null);
  const objectUrl = useRef<string | null>(null);
  useEffect(() => () => {
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
  }, []);
  const fileInput = useRef<HTMLInputElement>(null);

  const errors = validate(draft, handleState, saved.handle);
  const show = (f: Field) => (tried || touched[f] ? errors[f] : undefined);
  const changed = (Object.keys(draft) as Array<keyof EditableProfile>).filter((k) => draft[k] !== saved[k]);
  const dirty = changed.length > 0;

  const set = <K extends keyof EditableProfile>(k: K, v: EditableProfile[K]) => {
    setDraft((d) => ({ ...d, [k]: v }));
    setJustSaved(false);
    setSaveError(null);
  };

  const pickFile = (file: File | undefined) => {
    if (!file || !file.type.startsWith("image/")) return;
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    objectUrl.current = URL.createObjectURL(file);
    setCropSrc(objectUrl.current);
  };

  const discard = () => {
    setDraft(saved);
    setTouched({});
    setTried(false);
    setSaveError(null);
  };

  const save = async () => {
    setTried(true);
    const first = (Object.keys(errors) as Field[])[0];
    if (first || handleState === "checking") {
      if (first) document.getElementById(`${id}-${first}`)?.focus();
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await onSave(draft);
      setSaved(draft);
      setTried(false);
      setTouched({});
      setJustSaved(true);
      if (savedTimer.current) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setJustSaved(false), 2600);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className={cx("kb-pe", className)} aria-label="Edit profile">
        <SkeletonRegion label="Loading your profile">
          <div className="kb-pe-head">
            <Skeleton width={140} height={16} />
            <Skeleton width={300} height={10} style={{ marginTop: 9 }} />
          </div>
          <div className="kb-pe-photo">
            <SkeletonCircle size={72} />
            <Skeleton width={120} height={36} radius="control" />
          </div>
          <div className="kb-pe-grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i}>
                <Skeleton width={70} height={10} />
                <Skeleton height={36} radius="control" style={{ marginTop: 9 }} />
              </div>
            ))}
            <div className="kb-pe-wide">
              <Skeleton width={70} height={10} />
              <Skeleton height={84} radius="control" style={{ marginTop: 9 }} />
            </div>
          </div>
        </SkeletonRegion>
      </section>
    );
  }

  if (error) {
    return (
      <section className={cx("kb-pe", className)} aria-label="Edit profile">
        <div className="kb-pe-state">
          <ErrorState title="Couldn't load your profile" body={error} onRetry={onRetry} />
        </div>
      </section>
    );
  }

  const handleNote =
    show("handle") ??
    (handleState === "checking" ? null : handleState === "available" ? `@${draft.handle} is free` : handleState === "error" ? "Couldn't check right now; we'll check again when you save." : null);

  return (
    <section className={cx("kb-pe", className)} aria-labelledby={`${id}-title`}>
      <header className="kb-pe-head">
        <h3 id={`${id}-title`}>Your profile</h3>
        <p>Teammates see this on runs you approve, comments and reviews.</p>
      </header>

      <div className="kb-pe-photo">
        <Avatar name={draft.name || "?"} size={72} src={draft.avatarUrl ?? undefined} />
        <div className="kb-pe-photo-actions">
          <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp" className="kb-sr" tabIndex={-1} aria-hidden onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
          <Button icon="upload" onClick={() => fileInput.current?.click()}>{draft.avatarUrl ? "Replace photo" : "Upload photo"}</Button>
          {draft.avatarUrl ? <Button variant="ghost" icon="trash" onClick={() => set("avatarUrl", null)}>Remove</Button> : null}
          <span className="kb-pe-hint">PNG, JPG or WebP. Square works best.</span>
        </div>
      </div>

      {cropSrc ? (
        <Cropper
          src={cropSrc}
          name={draft.name}
          onCancel={() => setCropSrc(null)}
          onApply={(url) => {
            set("avatarUrl", url);
            setCropSrc(null);
          }}
        />
      ) : null}

      <div className="kb-pe-grid">
        <div className="kb-pe-field" data-invalid={show("name") ? true : undefined}>
          <label htmlFor={`${id}-name`}>Name</label>
          <input
            id={`${id}-name`}
            value={draft.name}
            autoComplete="name"
            onChange={(e) => set("name", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            aria-invalid={!!show("name")}
            aria-describedby={show("name") ? `${id}-name-msg` : undefined}
          />
          {show("name") ? <p id={`${id}-name-msg`} className="kb-pe-msg">{show("name")}</p> : null}
        </div>

        <div className="kb-pe-field" data-invalid={show("handle") ? true : undefined}>
          <label htmlFor={`${id}-handle`}>Handle</label>
          <div className="kb-pe-handle">
            <span aria-hidden>@</span>
            <input
              id={`${id}-handle`}
              value={draft.handle}
              autoComplete="username"
              spellCheck={false}
              onChange={(e) => set("handle", e.target.value.toLowerCase().replace(/\s/g, ""))}
              onBlur={() => setTouched((t) => ({ ...t, handle: true }))}
              aria-invalid={!!show("handle")}
              aria-describedby={`${id}-handle-msg`}
            />
            <span className="kb-pe-check" data-state={handleState}>
              {handleState === "checking" ? <Spinner size={12} label="Checking" /> : handleState === "available" ? <Icon name="check" size={15} /> : null}
            </span>
          </div>
          <p id={`${id}-handle-msg`} className={cx("kb-pe-msg", !show("handle") && "kb-pe-sub")} aria-live="polite">
            {handleState === "checking" ? "Checking" : handleNote ?? <code>{profileBase}{draft.handle}</code>}
          </p>
        </div>

        <div className="kb-pe-field">
          <label htmlFor={`${id}-title-in`}>Title</label>
          <input id={`${id}-title-in`} value={draft.title} placeholder="What you do here" onChange={(e) => set("title", e.target.value)} />
        </div>

        <div className="kb-pe-field">
          <label htmlFor={`${id}-tz`}>Time zone</label>
          <select id={`${id}-tz`} value={draft.timeZone} onChange={(e) => set("timeZone", e.target.value)} aria-describedby={`${id}-tz-msg`}>
            {(timeZones.includes(draft.timeZone) ? timeZones : [draft.timeZone, ...timeZones]).map((z) => <option key={z} value={z}>{zoneLabel(z)}</option>)}
          </select>
          <p id={`${id}-tz-msg`} className="kb-pe-msg kb-pe-sub">{now ? <>It's <code>{clockIn(draft.timeZone, now)}</code> there now</> : " "}</p>
        </div>

        <div className="kb-pe-field kb-pe-wide" data-invalid={show("bio") ? true : undefined}>
          <div className="kb-pe-label-row">
            <label htmlFor={`${id}-bio`}>Bio</label>
            <span className="kb-pe-count" data-over={draft.bio.length > BIO_MAX || undefined} aria-live="polite">{draft.bio.length}/{BIO_MAX}</span>
          </div>
          <textarea
            id={`${id}-bio`}
            rows={3}
            value={draft.bio}
            placeholder="What you work on, and what people can ask you about"
            onChange={(e) => set("bio", e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, bio: true }))}
            aria-invalid={!!show("bio")}
            aria-describedby={show("bio") ? `${id}-bio-msg` : undefined}
          />
          {show("bio") ? <p id={`${id}-bio-msg`} className="kb-pe-msg">{show("bio")}</p> : null}
        </div>
      </div>

      {dirty || saving || justSaved ? (
        <div className="kb-pe-bar" data-state={justSaved && !dirty ? "saved" : "dirty"} role="region" aria-label="Save changes">
          {justSaved && !dirty ? (
            <p className="kb-pe-saved" role="status"><Icon name="check" size={16} />Profile saved</p>
          ) : (
            <>
              <p className="kb-pe-dirty" role="status">
                {saveError ? <><i className="kb-pe-fail" aria-hidden />{saveError}</> : tried && Object.keys(errors).length ? `Fix ${Object.keys(errors).length === 1 ? "1 field" : `${Object.keys(errors).length} fields`} before saving` : `${changed.length === 1 ? "1 unsaved change" : `${changed.length} unsaved changes`}`}
              </p>
              <Button variant="ghost" onClick={discard} disabled={saving}>Discard</Button>
              <Button variant="primary" onClick={save} loading={saving} loadingLabel="Saving">Save changes</Button>
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

interface CropperProps {
  src: string;
  name: string;
  onApply: (dataUrl: string) => void;
  onCancel: () => void;
}

const FRAME = 200;

/** Square crop with a round mask: drag or arrow keys move the photo, the slider (or + and -) zooms. */
function Cropper({ src, name, onApply, onCancel }: CropperProps) {
  const id = useId();
  const img = useRef<HTMLImageElement>(null);
  const [nat, setNat] = useState<{ w: number; h: number } | null>(null);
  const [zoom, setZoom] = useState(1.2);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null);

  const base = nat ? FRAME / Math.min(nat.w, nat.h) : 1;
  const s = base * zoom;
  const W = nat ? nat.w * s : FRAME;
  const H = nat ? nat.h * s : FRAME;
  const clamp = (p: { x: number; y: number }) => ({ x: Math.min(0, Math.max(FRAME - W, p.x)), y: Math.min(0, Math.max(FRAME - H, p.y)) });
  const at = clamp(pos);

  // Center on load and keep the point under the frame's middle steady while zooming
  const zoomTo = (z: number) => {
    const nz = Math.min(3, Math.max(1, z));
    if (!nat) return setZoom(nz);
    const ratio = nz / zoom;
    const c = FRAME / 2;
    setPos(clamp({ x: c - (c - at.x) * ratio, y: c - (c - at.y) * ratio }));
    setZoom(nz);
  };

  const onLoad = () => {
    const el = img.current;
    if (!el) return;
    const n = { w: el.naturalWidth || FRAME, h: el.naturalHeight || FRAME };
    setNat(n);
    const sc = (FRAME / Math.min(n.w, n.h)) * zoom;
    setPos({ x: (FRAME - n.w * sc) / 2, y: (FRAME - n.h * sc) / 2 });
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, px: at.x, py: at.y };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (d) setPos(clamp({ x: d.px + e.clientX - d.x, y: d.py + e.clientY - d.y }));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 20 : 5;
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] };
    const m = moves[e.key];
    if (m) {
      e.preventDefault();
      setPos(clamp({ x: at.x + m[0], y: at.y + m[1] }));
    } else if (e.key === "+" || e.key === "=") zoomTo(zoom + 0.1);
    else if (e.key === "-") zoomTo(zoom - 0.1);
    else if (e.key === "Escape") onCancel();
  };

  const apply = () => {
    const el = img.current;
    if (!el || !nat) return onApply(src);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = canvas.height = 256;
      const ctx = canvas.getContext("2d");
      if (!ctx) return onApply(src);
      ctx.drawImage(el, -at.x / s, -at.y / s, FRAME / s, FRAME / s, 0, 0, 256, 256);
      onApply(canvas.toDataURL("image/png"));
    } catch {
      onApply(src);
    }
  };

  const imgStyle = { width: W, height: H, transform: `translate(${at.x}px, ${at.y}px)` };
  const preview = (size: number) => {
    const k = size / FRAME;
    return (
      <span className="kb-pe-preview" style={{ width: size, height: size }}>
        <img src={src} alt="" style={{ width: W * k, height: H * k, transform: `translate(${at.x * k}px, ${at.y * k}px)` }} />
      </span>
    );
  };

  return (
    <div className="kb-pe-crop" role="group" aria-labelledby={`${id}-crop`}>
      <div
        className="kb-pe-frame"
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onKeyDown={key}
        aria-label="Photo position. Drag, or use arrow keys to move and plus or minus to zoom."
        aria-describedby={`${id}-crop`}
      >
        <img ref={img} src={src} alt="" draggable={false} onLoad={onLoad} style={imgStyle} />
        <span className="kb-pe-mask" aria-hidden />
      </div>
      <div className="kb-pe-crop-side">
        <h4 id={`${id}-crop`}>Crop your photo</h4>
        <p>Drag to move it, or use the arrow keys. It shows as a circle everywhere.</p>
        <label className="kb-pe-zoom">
          <span>Zoom</span>
          <input type="range" min={1} max={3} step={0.01} value={zoom} onChange={(e) => zoomTo(Number(e.target.value))} />
        </label>
        <div className="kb-pe-previews" aria-label={`Previews of ${name || "your"} photo`}>
          {preview(48)}
          {preview(32)}
          {preview(24)}
        </div>
        <div className="kb-pe-crop-actions">
          <Button variant="ghost" onClick={onCancel}>Cancel</Button>
          <Button icon="check" onClick={apply}>Use photo</Button>
        </div>
      </div>
    </div>
  );
}
