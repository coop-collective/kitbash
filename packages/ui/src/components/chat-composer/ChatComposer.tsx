import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { cx, formatDuration, Icon, useElapsed, useInterval, useReducedMotion } from "../../shared/index.ts";
import "./chat-composer.css";

export interface ComposerApp {
  id: string;
  name: string;
  /** Mark color (data) */
  color: string;
  /** What the assistant may do there, e.g. "Post messages" */
  scope: string;
  connected: boolean;
  /** Write actions in this app wait for a person to approve */
  askFirst?: boolean;
  /** Words in a prompt that mean a write action in this app */
  triggers?: string[];
}

export interface ComposerAttachment {
  name: string;
  size: string;
}

export interface ApprovalRequest {
  app: string;
  action: string;
}

export const DEFAULT_COMPOSER_APPS: ComposerApp[] = [
  { id: "slack", name: "Slack", color: "#4a154b", scope: "Read channels, post messages", connected: true, askFirst: true, triggers: ["post", "slack", "#"] },
  { id: "linear", name: "Linear", color: "#5e6ad2", scope: "Read and file issues", connected: true, askFirst: true, triggers: ["file an issue", "create an issue", "open a ticket"] },
  { id: "github", name: "GitHub", color: "#24292f", scope: "Read repos and pull requests", connected: false },
  { id: "drive", name: "Google Drive", color: "#1a73e8", scope: "Read docs and sheets", connected: false },
];

const MODELS = ["Kestrel", "Kestrel Mini", "Kestrel Max"];
const DICTATION =
  "Summarize the open P1 bugs in Linear and post the list to #launch-crew in Slack before standup";

export interface ChatComposerProps {
  defaultValue?: string;
  placeholder?: string;
  apps?: ComposerApp[];
  attachments?: ComposerAttachment[];
  defaultModel?: string;
  /** Show an approval request already waiting (catalog states) */
  defaultApproval?: ApprovalRequest | null;
  /** Start in voice dictation (catalog states) */
  defaultRecording?: boolean;
  /** Called with the prompt once it is cleared to send */
  onSend?: (prompt: string, context: { model: string; apps: string[] }) => void;
  onApproval?: (request: ApprovalRequest, decision: "once" | "always" | "deny") => void;
  className?: string;
}

/**
 * Prompt composer with a model menu, voice dictation, app connections and an approval step. When a prompt asks a
 * connected app to write something, a decal-yellow approval tab slides out of the composer's top seam and the send
 * key locks until a person answers.
 */
export function ChatComposer({
  defaultValue = "",
  placeholder = "Ask Kitbash to do something",
  apps: initialApps = DEFAULT_COMPOSER_APPS,
  attachments: initialFiles = [{ name: "p1-bugs-oct.csv", size: "18 KB" }],
  defaultModel = "Kestrel",
  defaultApproval = null,
  defaultRecording = false,
  onSend,
  onApproval,
  className,
}: ChatComposerProps) {
  const reduced = useReducedMotion();
  const [value, setValue] = useState(defaultValue);
  const [apps, setApps] = useState(initialApps);
  const [files, setFiles] = useState(initialFiles);
  const [model, setModel] = useState(defaultModel);
  const [menu, setMenu] = useState<"apps" | "model" | null>(null);
  const [approval, setApproval] = useState<ApprovalRequest | null>(defaultApproval);
  const [recording, setRecording] = useState(defaultRecording);
  const [heard, setHeard] = useState(0);
  const [levels, setLevels] = useState<number[]>(() => Array.from({ length: 22 }, () => 0.2));
  const [receipt, setReceipt] = useState<string | null>(null);
  const elapsed = useElapsed(recording);
  const area = useRef<HTMLTextAreaElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const allowRef = useRef<HTMLButtonElement>(null);
  const before = useRef("");

  // Grow the textarea with its content, up to the CSS max-height.
  useLayoutEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  useEffect(() => {
    if (approval) allowRef.current?.focus();
  }, [approval]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest(".kb-cc-pop, .kb-cc-tool")) setMenu(null);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [menu]);

  // Dictation: words arrive one at a time while the level meter moves.
  const words = DICTATION.split(" ");
  useInterval(() => {
    setLevels((l) => [...l.slice(1), 0.15 + Math.random() * 0.85]);
  }, recording && !reduced ? 90 : null);
  useInterval(() => setHeard((h) => Math.min(words.length, h + 1)), recording && !reduced && heard < words.length ? 260 : null);
  useEffect(() => {
    if (!recording) return;
    // Reduced motion: the whole transcript lands at once instead of word by word.
    if (heard < words.length) {
      if (reduced) setHeard(words.length);
      return;
    }
    const id = window.setTimeout(() => stopRecording(true), reduced ? 1200 : 600);
    return () => window.clearTimeout(id);
    // stopRecording reads the same state as these deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording, heard, reduced, words.length]);

  const startRecording = () => {
    before.current = value ? `${value.trimEnd()} ` : "";
    setHeard(reduced ? words.length : 0);
    setRecording(true);
    setMenu(null);
  };
  const stopRecording = (keep: boolean) => {
    setRecording(false);
    if (keep) setValue((before.current + words.slice(0, heard).join(" ")).trim());
    window.requestAnimationFrame(() => area.current?.focus());
  };
  const transcript = before.current + words.slice(0, heard).join(" ");

  const connected = apps.filter((a) => a.connected);
  const needsApproval = (text: string): ApprovalRequest | null => {
    const lower = text.toLowerCase();
    for (const app of connected) {
      if (app.askFirst && app.triggers?.some((t) => lower.includes(t))) {
        const channel = text.match(/#[\w-]+/)?.[0];
        return { app: app.name, action: app.id === "slack" && channel ? `post a message in ${channel}` : `make changes in ${app.name}` };
      }
    }
    return null;
  };

  const finishSend = (prompt: string, note?: string) => {
    onSend?.(prompt, { model, apps: connected.map((a) => a.id) });
    setValue("");
    setFiles([]);
    setReceipt(note ?? `Sent to ${model}`);
    window.setTimeout(() => setReceipt(null), 2600);
  };

  const send = () => {
    const prompt = value.trim();
    if (!prompt || approval || recording) return;
    const request = needsApproval(prompt);
    if (request) setApproval(request);
    else finishSend(prompt);
  };

  const answer = (decision: "once" | "always" | "deny") => {
    if (!approval) return;
    onApproval?.(approval, decision);
    if (decision === "always") setApps((list) => list.map((a) => (a.name === approval.app ? { ...a, askFirst: false } : a)));
    const prompt = value.trim();
    setApproval(null);
    if (decision === "deny") {
      setReceipt(`Not sent. Kitbash won't ${approval.action}.`);
      window.setTimeout(() => setReceipt(null), 2600);
      area.current?.focus();
    } else {
      finishSend(prompt, `Sent. Kitbash may ${approval.action}.`);
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  const locked = Boolean(approval);
  return (
    <div
      className={cx("kb-cc", className)}
      ref={root}
      onKeyDown={(e) => {
        if (e.key === "Escape" && menu) {
          e.stopPropagation();
          setMenu(null);
        }
      }}
    >
      <div className="kb-cc-dock" data-open={approval ? true : undefined}>
        <div className="kb-cc-approval" role="alertdialog" aria-label="Approval needed" inert={!approval}>
          <span className="kb-cc-approval-icon" aria-hidden><Icon name="shield" size={16} /></span>
          <span className="kb-cc-approval-text">
            <strong>Kitbash wants to {approval?.action ?? "act"}</strong>
            <span>Using {approval?.app ?? "an app"} on your behalf</span>
          </span>
          <span className="kb-cc-approval-actions">
            <button type="button" className="kb-cc-deny" onClick={() => answer("deny")}>Deny</button>
            <button type="button" className="kb-cc-always" onClick={() => answer("always")}>Always allow</button>
            <button type="button" ref={allowRef} className="kb-cc-allow" onClick={() => answer("once")}>Allow once</button>
          </span>
        </div>
      </div>

      <div className="kb-cc-frame" data-locked={locked || undefined} data-recording={recording || undefined}>
        {files.length || connected.length ? (
          <div className="kb-cc-context">
            {files.map((f) => (
              <span key={f.name} className="kb-cc-file">
                <Icon name="file" size={14} />
                <span className="kb-cc-file-name">{f.name}</span>
                <span className="kb-cc-file-size">{f.size}</span>
                <button type="button" aria-label={`Remove ${f.name}`} onClick={() => setFiles(files.filter((x) => x !== f))}>
                  <Icon name="x" size={12} />
                </button>
              </span>
            ))}
            {connected.map((a) => (
              <span key={a.id} className="kb-cc-app-chip">
                <AppMark app={a} />
                {a.name}
              </span>
            ))}
          </div>
        ) : null}

        {recording ? (
          <div className="kb-cc-voice" aria-live="polite">
            <p className="kb-cc-transcript">
              {transcript || <span className="kb-cc-listening">Listening</span>}
              <span className="kb-cc-caret" aria-hidden />
            </p>
            <div className="kb-cc-meter" aria-hidden>
              {levels.map((l, i) => <i key={i} style={{ transform: `scaleY(${l})` }} />)}
            </div>
          </div>
        ) : (
          <textarea
            ref={area}
            className="kb-cc-input"
            rows={1}
            value={value}
            placeholder={placeholder}
            aria-label="Message"
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={onKey}
          />
        )}

        <div className="kb-cc-bar">
          <button type="button" className="kb-cc-tool" aria-label="Attach a file" title="Attach a file"
            onClick={() => setFiles([...files, { name: `screenshot-${files.length + 1}.png`, size: "412 KB" }])}>
            <Icon name="paperclip" size={16} />
          </button>
          <div className="kb-cc-anchor">
            <button type="button" className="kb-cc-tool kb-cc-tool-label" aria-haspopup="dialog" aria-expanded={menu === "apps"}
              onClick={() => setMenu(menu === "apps" ? null : "apps")}>
              <span className="kb-cc-marks" aria-hidden>
                {connected.slice(0, 3).map((a) => <AppMark key={a.id} app={a} />)}
              </span>
              Apps
            </button>
            {menu === "apps" ? (
              <div className="kb-cc-pop" role="dialog" aria-label="App connections">
                <p className="kb-cc-pop-title">Connections</p>
                {apps.map((a) => (
                  <div key={a.id} className="kb-cc-app-row">
                    <AppMark app={a} size={26} />
                    <span className="kb-cc-app-text">
                      <span className="kb-cc-app-name">{a.name}</span>
                      <span className="kb-cc-app-scope">{a.connected ? (a.askFirst ? `${a.scope}, asks first` : a.scope) : "Not connected"}</span>
                    </span>
                    <button type="button" role="switch" aria-checked={a.connected} aria-label={`Connect ${a.name}`} className="kb-cc-switch"
                      onClick={() => setApps(apps.map((x) => (x.id === a.id ? { ...x, connected: !x.connected } : x)))}>
                      <span />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
          <div className="kb-cc-anchor">
            <button type="button" className="kb-cc-tool kb-cc-tool-label" aria-haspopup="listbox" aria-expanded={menu === "model"}
              onClick={() => setMenu(menu === "model" ? null : "model")}>
              <Icon name="sparkle" size={15} />
              {model}
              <Icon name="chevronDown" size={14} />
            </button>
            {menu === "model" ? (
              <div className="kb-cc-pop kb-cc-pop-models" role="listbox" aria-label="Model">
                {MODELS.map((m) => (
                  <button key={m} type="button" role="option" aria-selected={m === model} className="kb-cc-model"
                    onClick={() => { setModel(m); setMenu(null); }}>
                    {m}
                    {m === model ? <Icon name="check" size={14} /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <span className="kb-cc-spacer" />
          {recording ? (
            <>
              <span className="kb-cc-time">{formatDuration(elapsed)}</span>
              <button type="button" className="kb-cc-tool" aria-label="Discard dictation" onClick={() => stopRecording(false)}>
                <Icon name="x" size={16} />
              </button>
              <button type="button" className="kb-cc-tool kb-cc-rec" aria-label="Stop and keep dictation" aria-pressed="true" onClick={() => stopRecording(true)}>
                <Icon name="stop" size={14} />
              </button>
            </>
          ) : (
            <button type="button" className="kb-cc-tool" aria-label="Dictate" title="Dictate" onClick={startRecording} disabled={locked}>
              <Icon name="mic" size={16} />
            </button>
          )}
          <button type="button" className="kb-cc-send" onClick={send} disabled={locked || recording || !value.trim()}
            aria-label={locked ? "Waiting for approval" : "Send"} title={locked ? "Waiting for approval" : "Send"}>
            <Icon name={locked ? "lock" : "arrowUp"} size={16} strokeWidth={2} />
          </button>
        </div>
      </div>
      <p className="kb-cc-receipt" role="status" aria-live="polite">{receipt}</p>
    </div>
  );
}

function AppMark({ app, size = 16 }: { app: ComposerApp; size?: number }) {
  return (
    <span className="kb-cc-mark" style={{ background: app.color, width: size, height: size, fontSize: size * 0.5 }} aria-hidden>
      {app.name.charAt(0)}
    </span>
  );
}
