"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { ClipboardEvent, KeyboardEvent } from "react";
import { cx, Icon } from "../../shared/index.ts";
import { Button } from "../button/Button.tsx";
import "./data-table.css";

export type CellValue = string | number | null;

export interface DataColumn {
  key: string;
  label: string;
  type?: "text" | "number";
  /** Display formatter for number columns */
  format?: (value: number) => string;
  width?: number;
  /** Read-only columns can be selected and copied but not edited or pasted into */
  readOnly?: boolean;
}

export interface DataRow {
  id: string;
  [key: string]: CellValue;
}

export interface DataTableProps {
  caption?: string;
  columns?: DataColumn[];
  rows?: DataRow[];
  /** Called with the full row set after every edit, paste, clear, undo or redo */
  onChange?: (rows: DataRow[]) => void;
  className?: string;
}

export const dataTableDemoColumns: DataColumn[] = [
  { key: "agent", label: "Agent", width: 170 },
  { key: "model", label: "Model", width: 146 },
  { key: "owner", label: "Owner", width: 120 },
  { key: "runs", label: "Runs", type: "number", width: 84, format: (v) => v.toLocaleString("en-US") },
  { key: "success", label: "Success", type: "number", width: 88, format: (v) => `${v.toFixed(1)}%` },
  { key: "cost", label: "Cost per run", type: "number", width: 120, format: (v) => `$${v.toFixed(3)}` },
];

export const dataTableDemoRows: DataRow[] = [
  { id: "r1", agent: "Support triage", model: "Fast chat", owner: "Maya Chen", runs: 18420, success: 94.2, cost: 0.018 },
  { id: "r2", agent: "Code review", model: "Large reasoning", owner: "Dev Patel", runs: 6210, success: 88.7, cost: 0.142 },
  { id: "r3", agent: "Research assistant", model: "Large reasoning", owner: "Lena Ortiz", runs: 2380, success: 81.4, cost: 0.316 },
  { id: "r4", agent: "Sales drafter", model: "Fast chat", owner: "Sam Okafor", runs: 4975, success: 91.9, cost: 0.027 },
  { id: "r5", agent: "Invoice matcher", model: "Small router", owner: "Maya Chen", runs: 12640, success: 97.6, cost: 0.004 },
  { id: "r6", agent: "On-call summarizer", model: "Fast chat", owner: "Ari Novak", runs: 1120, success: 89.3, cost: 0.051 },
  { id: "r7", agent: "Contract reviewer", model: "Large reasoning", owner: "Lena Ortiz", runs: 640, success: 76.8, cost: 0.488 },
  { id: "r8", agent: "Changelog writer", model: "Fast chat", owner: "Dev Patel", runs: 930, success: 95.1, cost: 0.022 },
];

interface Point {
  r: number;
  c: number;
}
type Sort = { key: string; dir: "asc" | "desc" } | null;

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

function parseCell(raw: string, column: DataColumn): CellValue {
  const text = raw.trim();
  if (column.type !== "number") return text;
  if (text === "") return null;
  const n = Number(text.replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function show(value: CellValue, column: DataColumn): string {
  if (value === null || value === undefined || value === "") return "";
  if (typeof value === "number") return column.format ? column.format(value) : String(value);
  return value;
}

/**
 * Spreadsheet-style table: select cells and ranges with the pointer or the keyboard, edit in place, copy and
 * paste as tab-separated text, undo, redo and sort. The selected range sinks into the sheet like a pressed
 * panel while the active cell stays raised, so it reads as the part your next keystroke lands on.
 */
export function DataTable({
  caption = "Agents in production",
  columns = dataTableDemoColumns,
  rows: initialRows = dataTableDemoRows,
  onChange,
  className,
}: DataTableProps) {
  const uid = useId();
  const gridRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState(initialRows);
  const [past, setPast] = useState<DataRow[][]>([]);
  const [future, setFuture] = useState<DataRow[][]>([]);
  const [sort, setSort] = useState<Sort>(null);
  const [anchor, setAnchor] = useState<Point>({ r: 0, c: 0 });
  const [focus, setFocus] = useState<Point>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<{ draft: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [note, setNote] = useState("");
  // A cell is "changed" while it differs from what the table started with, so undo clears the mark too
  const original = useMemo(() => new Map(initialRows.map((row) => [row.id, row])), [initialRows]);

  // Display order: sorting changes what you see, never the underlying row order
  const view = useMemo(() => {
    if (!sort) return rows;
    const col = columns.find((c) => c.key === sort.key);
    const sign = sort.dir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const x = a[sort.key];
      const y = b[sort.key];
      if (x === null || x === undefined || x === "") return 1;
      if (y === null || y === undefined || y === "") return -1;
      return col?.type === "number" ? (Number(x) - Number(y)) * sign : String(x).localeCompare(String(y)) * sign;
    });
  }, [rows, sort, columns]);

  const lastR = view.length - 1;
  const lastC = columns.length - 1;
  const top = Math.min(anchor.r, focus.r);
  const bottom = Math.max(anchor.r, focus.r);
  const left = Math.min(anchor.c, focus.c);
  const right = Math.max(anchor.c, focus.c);
  const inRange = (r: number, c: number) => r >= top && r <= bottom && c >= left && c <= right;

  useEffect(() => {
    if (!dragging) return;
    const up = () => setDragging(false);
    window.addEventListener("pointerup", up);
    return () => window.removeEventListener("pointerup", up);
  }, [dragging]);

  const commit = (next: DataRow[], message: string) => {
    setPast((p) => [...p.slice(-49), rows]);
    setFuture([]);
    setRows(next);
    setNote(message);
    onChange?.(next);
  };

  /** Write values into the sheet at view coordinates; read-only columns are skipped */
  const write = (cells: { r: number; c: number; value: string }[], message: string) => {
    const byId = new Map(rows.map((row) => [row.id, { ...row }]));
    const touched: string[] = [];
    for (const cell of cells) {
      const viewRow = view[cell.r];
      const column = columns[cell.c];
      if (!viewRow || !column || column.readOnly) continue;
      const target = byId.get(viewRow.id);
      if (!target) continue;
      const value = parseCell(cell.value, column);
      if (target[column.key] === value) continue;
      target[column.key] = value;
      touched.push(`${viewRow.id}:${column.key}`);
    }
    if (!touched.length) return;
    commit(rows.map((row) => byId.get(row.id) ?? row), message);
  };

  const undo = () => {
    const prev = past[past.length - 1];
    if (!prev) return;
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [rows, ...f]);
    setRows(prev);
    setNote("Undid last change");
    onChange?.(prev);
  };
  const redo = () => {
    const next = future[0];
    if (!next) return;
    setFuture((f) => f.slice(1));
    setPast((p) => [...p, rows]);
    setRows(next);
    setNote("Redid change");
    onChange?.(next);
  };

  const select = (p: Point, extend: boolean) => {
    const point = { r: clamp(p.r, 0, lastR), c: clamp(p.c, 0, lastC) };
    setFocus(point);
    if (!extend) setAnchor(point);
    document.getElementById(`${uid}-${point.r}-${point.c}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  };

  const startEdit = (seed?: string) => {
    const column = columns[focus.c];
    const row = view[focus.r];
    if (!column || !row || column.readOnly) return;
    const value = row[column.key];
    editDone.current = false;
    setEditing({ draft: seed ?? (value === null || value === undefined ? "" : String(value)) });
  };

  const editDone = useRef(false);
  const finishEdit = (save: boolean, move?: Point) => {
    // Enter or Tab moves focus back to the grid, which blurs the input: only the first finish counts
    if (!editing || editDone.current) return;
    editDone.current = true;
    if (save) {
      const column = columns[focus.c];
      write([{ r: focus.r, c: focus.c, value: editing.draft }], `Edited ${column?.label.toLowerCase() ?? "cell"}`);
    }
    setEditing(null);
    if (move) select({ r: focus.r + move.r, c: focus.c + move.c }, false);
    gridRef.current?.focus();
  };

  const toggleSort = (key: string) => {
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));
  };

  const onKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (editing || event.target !== gridRef.current) return; // the sort buttons and the editor handle their own keys
    const mod = event.metaKey || event.ctrlKey;
    const extend = event.shiftKey;
    const step = (dr: number, dc: number) => {
      event.preventDefault();
      if (mod) select({ r: dr ? (dr > 0 ? lastR : 0) : focus.r, c: dc ? (dc > 0 ? lastC : 0) : focus.c }, extend);
      else select({ r: focus.r + dr, c: focus.c + dc }, extend);
    };
    if (mod && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && event.key.toLowerCase() === "y") {
      event.preventDefault();
      redo();
      return;
    }
    if (mod && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setAnchor({ r: 0, c: 0 });
      setFocus({ r: lastR, c: lastC });
      return;
    }
    switch (event.key) {
      case "ArrowUp": return step(-1, 0);
      case "ArrowDown": return step(1, 0);
      case "ArrowLeft": return step(0, -1);
      case "ArrowRight": return step(0, 1);
      case "Home": event.preventDefault(); return select({ r: mod ? 0 : focus.r, c: 0 }, extend);
      case "End": event.preventDefault(); return select({ r: mod ? lastR : focus.r, c: lastC }, extend);
      case "Tab":
        if ((event.shiftKey && focus.c === 0) || (!event.shiftKey && focus.c === lastC)) return; // let focus leave the grid
        event.preventDefault();
        return select({ r: focus.r, c: focus.c + (event.shiftKey ? -1 : 1) }, false);
      case "Enter":
      case "F2":
        event.preventDefault();
        return startEdit();
      case "Escape":
        return setAnchor(focus);
      case "Delete":
      case "Backspace": {
        event.preventDefault();
        const cells: { r: number; c: number; value: string }[] = [];
        for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) cells.push({ r, c, value: "" });
        return write(cells, `Cleared ${cells.length} ${cells.length === 1 ? "cell" : "cells"}`);
      }
    }
    if (event.key.length === 1 && !mod && !event.altKey) {
      event.preventDefault();
      startEdit(event.key); // typing replaces the cell, like a spreadsheet
    }
  };

  const rangeText = () => {
    const lines: string[] = [];
    for (let r = top; r <= bottom; r++) {
      const cells: string[] = [];
      for (let c = left; c <= right; c++) {
        const column = columns[c];
        const value = column ? view[r]?.[column.key] : null;
        cells.push(value === null || value === undefined ? "" : String(value));
      }
      lines.push(cells.join("\t"));
    }
    return lines.join("\n");
  };

  const onCopy = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", rangeText());
    const count = (bottom - top + 1) * (right - left + 1);
    setNote(`Copied ${count} ${count === 1 ? "cell" : "cells"}`);
  };

  const onCut = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    onCopy(event);
    const cells: { r: number; c: number; value: string }[] = [];
    for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) cells.push({ r, c, value: "" });
    write(cells, `Cut ${cells.length} ${cells.length === 1 ? "cell" : "cells"}`);
  };

  const onPaste = (event: ClipboardEvent<HTMLDivElement>) => {
    if (editing) return;
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain").replace(/\r/g, "").replace(/\n$/, "");
    if (!text) return;
    const grid = text.split("\n").map((line) => line.split("\t"));
    // A single value pasted over a range fills the whole range
    const single = grid.length === 1 && grid[0]?.length === 1;
    const cells: { r: number; c: number; value: string }[] = [];
    if (single) {
      for (let r = top; r <= bottom; r++) for (let c = left; c <= right; c++) cells.push({ r, c, value: grid[0]?.[0] ?? "" });
    } else {
      grid.forEach((line, dr) => line.forEach((value, dc) => {
        if (top + dr <= lastR && left + dc <= lastC) cells.push({ r: top + dr, c: left + dc, value });
      }));
      const h = Math.min(grid.length, lastR - top + 1);
      const w = Math.min(Math.max(...grid.map((l) => l.length)), lastC - left + 1);
      setAnchor({ r: top, c: left });
      setFocus({ r: top + h - 1, c: left + w - 1 });
    }
    write(cells, `Pasted ${cells.length} ${cells.length === 1 ? "cell" : "cells"}`);
  };

  // Status bar: count, and sum and average when the range holds numbers
  const stats = useMemo(() => {
    const nums: number[] = [];
    let count = 0;
    for (let r = top; r <= bottom; r++)
      for (let c = left; c <= right; c++) {
        const column = columns[c];
        const v = column ? view[r]?.[column.key] : null;
        count++;
        if (typeof v === "number") nums.push(v);
      }
    const sum = nums.reduce((a, b) => a + b, 0);
    return { count, nums: nums.length, sum, avg: nums.length ? sum / nums.length : 0 };
  }, [top, bottom, left, right, view, columns]);

  const fmtStat = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const activeId = `${uid}-${focus.r}-${focus.c}`;
  const focusColumn = columns[focus.c];

  return (
    <div className={cx("kb-dt kb-part", className)}>
      <div className="kb-dt-bar">
        <div className="kb-dt-cap" id={`${uid}-cap`}>{caption}</div>
        <div className="kb-dt-tools">
          <Button size="sm" variant="ghost" icon="undo" onClick={undo} disabled={!past.length} aria-label="Undo" title="Undo (Ctrl+Z)" />
          <Button size="sm" variant="ghost" icon="redo" onClick={redo} disabled={!future.length} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" />
        </div>
      </div>

      <div
        ref={gridRef}
        className="kb-dt-scroll"
        tabIndex={0}
        role="grid"
        aria-labelledby={`${uid}-cap`}
        aria-multiselectable
        aria-rowcount={view.length + 1}
        aria-colcount={columns.length}
        aria-activedescendant={editing ? undefined : activeId}
        aria-describedby={`${uid}-help`}
        onKeyDown={onKey}
        onCopy={onCopy}
        onCut={onCut}
        onPaste={onPaste}
      >
        <table className="kb-dt-table" role="presentation">
          <colgroup>
            <col style={{ width: 40 }} />
            {columns.map((c) => <col key={c.key} style={{ width: c.width }} />)}
          </colgroup>
          <thead role="rowgroup">
            <tr role="row" aria-rowindex={1}>
              <th className="kb-dt-corner" aria-hidden />
              {columns.map((col, c) => {
                const dir = sort?.key === col.key ? sort.dir : null;
                return (
                  <th
                    key={col.key}
                    role="columnheader"
                    aria-sort={dir === "asc" ? "ascending" : dir === "desc" ? "descending" : "none"}
                    data-num={col.type === "number" || undefined}
                    data-hot={(c >= left && c <= right) || undefined}
                  >
                    <button type="button" className="kb-dt-sort" onClick={() => toggleSort(col.key)} title={`Sort by ${col.label.toLowerCase()}`}>
                      <span>{col.label}</span>
                      <span className="kb-dt-arrow" data-dir={dir ?? undefined} aria-hidden>
                        <Icon name={dir === "desc" ? "arrowDown" : "arrowUp"} size={12} strokeWidth={2} />
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody role="rowgroup">
            {view.map((row, r) => (
              <tr key={row.id} role="row" aria-rowindex={r + 2}>
                <th className="kb-dt-rownum" data-hot={(r >= top && r <= bottom) || undefined} aria-hidden>{r + 1}</th>
                {columns.map((col, c) => {
                  const selected = inRange(r, c);
                  const active = focus.r === r && focus.c === c;
                  const value = row[col.key] ?? null;
                  return (
                    <td
                      key={col.key}
                      id={`${uid}-${r}-${c}`}
                      role="gridcell"
                      aria-selected={selected}
                      aria-readonly={col.readOnly || undefined}
                      data-num={col.type === "number" || undefined}
                      data-sel={selected || undefined}
                      data-active={active || undefined}
                      data-edge={selected ? `${r === top ? "t" : ""}${r === bottom ? "b" : ""}${c === left ? "l" : ""}${c === right ? "r" : ""}` : undefined}
                      data-changed={(original.get(row.id)?.[col.key] ?? null) !== value || undefined}
                      onPointerDown={(event) => {
                        if (event.button !== 0) return;
                        if (editing) finishEdit(true);
                        select({ r, c }, event.shiftKey);
                        setDragging(true);
                        gridRef.current?.focus({ preventScroll: true });
                        event.preventDefault();
                      }}
                      onPointerEnter={() => dragging && setFocus({ r, c })}
                      onDoubleClick={() => startEdit()}
                    >
                      {active && editing ? (
                        <input
                          className="kb-dt-input"
                          autoFocus
                          aria-label={`Edit ${col.label}`}
                          inputMode={col.type === "number" ? "decimal" : undefined}
                          value={editing.draft}
                          onChange={(e) => setEditing({ draft: e.target.value })}
                          onBlur={() => finishEdit(true)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") { e.preventDefault(); finishEdit(true, { r: e.shiftKey ? -1 : 1, c: 0 }); }
                            else if (e.key === "Tab") { e.preventDefault(); finishEdit(true, { r: 0, c: e.shiftKey ? -1 : 1 }); }
                            else if (e.key === "Escape") { e.preventDefault(); finishEdit(false); }
                          }}
                        />
                      ) : (
                        <span className="kb-dt-text">{show(value, col)}</span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="kb-dt-status">
        <span className="kb-dt-ref">
          {`${focusColumn?.label ?? ""}, row ${focus.r + 1}`}
        </span>
        <span className="kb-dt-stats" aria-live="polite">
          {note ? <span className="kb-dt-note" key={note + past.length}>{note}</span> : null}
          {stats.count > 1 ? <span>{`${stats.count} cells`}</span> : null}
          {stats.nums > 1 ? <span>{`Sum ${fmtStat(stats.sum)}`}</span> : null}
          {stats.nums > 1 ? <span>{`Average ${fmtStat(stats.avg)}`}</span> : null}
        </span>
      </div>
      <p id={`${uid}-help`} className="kb-sr">
        Arrow keys move, Shift with arrows selects a range, Enter or typing edits, Escape cancels, Delete clears. Copy, cut, paste, undo and redo use the usual shortcuts.
      </p>
    </div>
  );
}
