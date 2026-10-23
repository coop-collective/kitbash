import { useId, useRef, useState } from "react";
import type { DragEvent } from "react";
import { cx, Icon, useInterval } from "../../shared/index.ts";
import "./dropzone.css";

export type UploadStatus = "uploading" | "done" | "error";

export interface UploadItem {
  id: string;
  name: string;
  /** Bytes */
  size: number;
  /** 0..1 */
  progress: number;
  status: UploadStatus;
  error?: string;
  /** Simulated throughput, bytes per second */
  speed?: number;
  /** Simulated drop: fails once at this progress, then succeeds on retry */
  failAt?: number;
  /** Whether a retry makes sense (not for files over the limit) */
  retryable?: boolean;
}

export const DEMO_UPLOADS: UploadItem[] = [
  { id: "u1", name: "q3-vendor-contracts.pdf", size: 4_200_000, progress: 0.36, status: "uploading", speed: 520_000 },
  { id: "u2", name: "support-tickets-sept.csv", size: 18_700_000, progress: 0.08, status: "uploading", speed: 1_900_000 },
  { id: "u3", name: "pricing-faq.docx", size: 820_000, progress: 0.3, status: "uploading", speed: 90_000, failAt: 0.62, retryable: true },
  { id: "u4", name: "onboarding-flow.png", size: 1_140_000, progress: 1, status: "done" },
  { id: "u5", name: "eval-results-run-2291.json", size: 31_400_000, progress: 0, status: "error", error: "Over the 25 MB limit" },
];

export interface DropzoneProps {
  /** Files already in the tray, with their upload state */
  initialFiles?: UploadItem[];
  /** Extensions shown in the hint and accepted by Browse */
  accept?: string[];
  /** Bytes */
  maxSize?: number;
  /** Run the simulated uploads (stops on unmount) */
  demo?: boolean;
  /** Called with the real File objects someone drops or browses */
  onFiles?: (files: File[]) => void;
  className?: string;
}

const TYPE_COLORS: Record<string, string> = {
  pdf: "#cf2a40",
  csv: "#23885c",
  xlsx: "#23885c",
  docx: "#1f7fb8",
  md: "#4d5b66",
  txt: "#4d5b66",
  png: "#8a3fd6",
  jpg: "#8a3fd6",
  json: "#c2571a",
};

const ext = (name: string) => (name.includes(".") ? name.split(".").pop()!.toLowerCase() : "file");

export function formatBytes(n: number) {
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${Math.round(n / 1000)} KB`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`;
}

function timeLeft(item: UploadItem) {
  const speed = item.speed ?? 600_000;
  const s = Math.ceil(((1 - item.progress) * item.size) / speed);
  if (s <= 1) return "Almost done";
  if (s < 60) return `${s}s left`;
  return `About ${Math.round(s / 60)} min left`;
}

/**
 * Drop files in and watch them upload. Dragging over the well fans out a stack of documents; each file gets a
 * colored type badge, and its progress fills a recessed channel like plastic injecting into a mold. When it
 * finishes, the channel cures and a check snaps in. Errors explain themselves and offer Retry where it helps.
 */
export function Dropzone({
  initialFiles = DEMO_UPLOADS,
  accept = ["pdf", "csv", "docx", "md", "png", "json"],
  maxSize = 25_000_000,
  demo = true,
  onFiles,
  className,
}: DropzoneProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<UploadItem[]>(initialFiles);
  const [dragging, setDragging] = useState(false);
  const [announce, setAnnounce] = useState("");
  const depth = useRef(0);

  const anyUploading = files.some((f) => f.status === "uploading");

  useInterval(
    () => {
      setFiles((list) =>
        list.map((f) => {
          if (f.status !== "uploading") return f;
          const step = ((f.speed ?? 600_000) * 0.2) / f.size;
          const next = Math.min(1, f.progress + step);
          if (f.failAt !== undefined && next >= f.failAt) {
            setAnnounce(`${f.name} failed: connection dropped`);
            return { ...f, progress: f.failAt, status: "error", error: `Connection dropped at ${Math.round(f.failAt * 100)}%`, failAt: undefined };
          }
          if (next >= 1) {
            setAnnounce(`${f.name} uploaded`);
            return { ...f, progress: 1, status: "done" };
          }
          return { ...f, progress: next };
        }),
      );
    },
    demo && anyUploading ? 200 : null,
  );

  function add(list: File[]) {
    if (!list.length) return;
    onFiles?.(list);
    const items: UploadItem[] = list.map((file, i) => {
      const tooBig = file.size > maxSize;
      const badType = !accept.includes(ext(file.name));
      return {
        id: `${Date.now()}-${i}`,
        name: file.name,
        size: file.size,
        progress: 0,
        status: tooBig || badType ? "error" : "uploading",
        error: tooBig ? `Over the ${formatBytes(maxSize)} limit` : badType ? `${ext(file.name).toUpperCase()} files aren't supported` : undefined,
        speed: 400_000 + Math.random() * 1_600_000,
      };
    });
    setFiles((current) => [...items, ...current]);
    setAnnounce(`${list.length} ${list.length === 1 ? "file" : "files"} added`);
  }

  function retry(itemId: string) {
    setFiles((list) => list.map((f) => (f.id === itemId ? { ...f, status: "uploading", error: undefined } : f)));
  }

  function remove(itemId: string) {
    setFiles((list) => list.filter((f) => f.id !== itemId));
  }

  const dragProps = {
    onDragEnter: (e: DragEvent) => {
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (e: DragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: () => {
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    },
    onDrop: (e: DragEvent) => {
      e.preventDefault();
      depth.current = 0;
      setDragging(false);
      add([...e.dataTransfer.files]);
    },
  };

  const done = files.filter((f) => f.status === "done").length;

  return (
    <div className={cx("kb-root kb-dz", className)}>
      <div className="kb-dz-well" data-drag={dragging || undefined} {...dragProps} onClick={() => inputRef.current?.click()}>
        <div className="kb-dz-fan" aria-hidden>
          {["csv", "pdf", "docx"].map((t, i) => (
            <span key={t} className="kb-dz-sheet" style={{ ["--i" as string]: i - 1, ["--c" as string]: TYPE_COLORS[t] }}>
              <span className="kb-dz-sheet-tab">{t}</span>
              <i />
              <i />
              <i />
            </span>
          ))}
        </div>
        <p className="kb-dz-title">{dragging ? "Let go to attach" : "Drop files for the agent to read"}</p>
        <p className="kb-dz-hint" id={`${id}-hint`}>
          {accept.map((a) => a.toUpperCase()).join(", ")} up to {formatBytes(maxSize)} each
        </p>
        <button
          type="button"
          className="kb-dz-browse"
          aria-describedby={`${id}-hint`}
          onClick={(e) => {
            e.stopPropagation();
            inputRef.current?.click();
          }}
        >
          <Icon name="upload" size={15} />
          Browse files
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          hidden
          accept={accept.map((a) => `.${a}`).join(",")}
          onChange={(e) => {
            add([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />
      </div>

      {files.length ? (
        <div className="kb-dz-tray">
          <div className="kb-dz-tray-head">
            <span>Attachments</span>
            <span className="kb-dz-count">{done} of {files.length} ready</span>
          </div>
          <ul className="kb-dz-list">
            {files.map((f) => {
              const t = ext(f.name);
              const pct = Math.round(f.progress * 100);
              return (
                <li key={f.id} className="kb-dz-item" data-status={f.status}>
                  <span className="kb-dz-badge" style={{ ["--c" as string]: TYPE_COLORS[t] ?? "#4d5b66" }}>{t}</span>
                  <div className="kb-dz-body">
                    <div className="kb-dz-line">
                      <span className="kb-dz-name" title={f.name}>{f.name}</span>
                      <span className="kb-dz-meta">
                        {f.status === "uploading" ? `${pct}%, ${timeLeft(f)}` : formatBytes(f.size)}
                      </span>
                    </div>
                    {f.status === "error" ? (
                      <p className="kb-dz-error" role="alert">
                        <Icon name="alert" size={13} />
                        {f.error}
                      </p>
                    ) : (
                      <div
                        className="kb-dz-channel"
                        role="progressbar"
                        aria-label={`Uploading ${f.name}`}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={pct}
                        aria-valuetext={f.status === "done" ? "Uploaded" : `${pct}%, ${timeLeft(f)}`}
                      >
                        <span className="kb-dz-fill" style={{ width: `${pct}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="kb-dz-actions">
                    {f.status === "done" ? (
                      <span className="kb-dz-cured" aria-label="Uploaded" role="img">
                        <Icon name="check" size={14} strokeWidth={2.4} />
                      </span>
                    ) : null}
                    {f.status === "error" && f.retryable ? (
                      <button type="button" className="kb-dz-retry" onClick={() => retry(f.id)}>
                        <Icon name="refresh" size={13} />
                        Retry
                      </button>
                    ) : null}
                    <button type="button" className="kb-dz-x" aria-label={`${f.status === "uploading" ? "Cancel" : "Remove"} ${f.name}`} onClick={() => remove(f.id)}>
                      <Icon name="x" size={14} />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
      <span className="kb-sr" role="status">{announce}</span>
    </div>
  );
}
