import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon } from "../../shared/index.ts";
import "./date-range-picker.css";

export interface DateRange {
  start: Date;
  end: Date;
}

export type CompareMode = "none" | "period" | "year";

export interface DateRangePickerProps {
  label?: string;
  /** "Today" for presets and the future cutoff; fixed by default so docs render the same every day */
  today?: Date;
  defaultValue?: DateRange;
  defaultCompare?: CompareMode;
  /** Days after `today` can't be picked */
  disableFuture?: boolean;
  /** 0 = Sunday, 1 = Monday */
  weekStartsOn?: 0 | 1;
  defaultOpen?: boolean;
  onApply?: (range: DateRange, compare: DateRange | null) => void;
  className?: string;
}

/* ---------- date helpers (local midnight dates only) ---------- */

const day = (y: number, m: number, d: number) => new Date(y, m, d);
const strip = (d: Date) => day(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => day(d.getFullYear(), d.getMonth(), d.getDate() + n);
function addMonths(d: Date, n: number) {
  const target = day(d.getFullYear(), d.getMonth() + n, 1);
  const last = day(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return day(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last));
}
const startOfMonth = (d: Date) => day(d.getFullYear(), d.getMonth(), 1);
const same = (a: Date | null | undefined, b: Date | null | undefined) => !!a && !!b && a.getTime() === b.getTime();
const key = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const spanDays = (r: DateRange) => Math.round((r.end.getTime() - r.start.getTime()) / 86400000) + 1;
const order = (a: Date, b: Date): DateRange => (a <= b ? { start: a, end: b } : { start: b, end: a });
const within = (d: Date, r: DateRange | null) => !!r && d >= r.start && d <= r.end;

const fmtShort = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const fmtYear = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtMonth = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });
const fmtLong = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const fmtWeekday = new Intl.DateTimeFormat("en-US", { weekday: "short" });

export function formatRange(r: DateRange) {
  if (same(r.start, r.end)) return fmtYear.format(r.start);
  const sameYear = r.start.getFullYear() === r.end.getFullYear();
  return `${(sameYear ? fmtShort : fmtYear).format(r.start)} – ${fmtYear.format(r.end)}`;
}

function compareRange(r: DateRange, mode: CompareMode): DateRange | null {
  if (mode === "none") return null;
  if (mode === "year") return { start: addMonths(r.start, -12), end: addMonths(r.end, -12) };
  const len = spanDays(r);
  return { start: addDays(r.start, -len), end: addDays(r.start, -1) };
}

function presets(today: Date): Array<{ label: string; range: DateRange }> {
  const y = today.getFullYear();
  const m = today.getMonth();
  const q = Math.floor(m / 3) * 3;
  return [
    { label: "Today", range: { start: today, end: today } },
    { label: "Yesterday", range: { start: addDays(today, -1), end: addDays(today, -1) } },
    { label: "Last 7 days", range: { start: addDays(today, -6), end: today } },
    { label: "Last 30 days", range: { start: addDays(today, -29), end: today } },
    { label: "This month", range: { start: day(y, m, 1), end: today } },
    { label: "Last month", range: { start: day(y, m - 1, 1), end: day(y, m, 0) } },
    { label: "Quarter to date", range: { start: day(y, q, 1), end: today } },
    { label: "Year to date", range: { start: day(y, 0, 1), end: today } },
  ];
}

/**
 * Two-calendar range picker for analytics. Presets on the left, a hover (or focus) preview while the
 * second end is open, and an optional comparison period. Keyboard follows the WAI-ARIA date grid:
 * arrows by day and week, Home/End for the week, PageUp/PageDown by month (Shift for a year).
 * The picked range is one continuous molded bar; the comparison sits as a groove under its days.
 */
export function DateRangePicker({
  label = "Reporting period",
  today: todayProp = day(2026, 9, 23),
  defaultValue,
  defaultCompare = "period",
  disableFuture = true,
  weekStartsOn = 1,
  defaultOpen = false,
  onApply,
  className,
}: DateRangePickerProps) {
  const id = useId();
  const today = strip(todayProp);
  const initial = defaultValue ?? { start: addDays(today, -29), end: today };
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridsRef = useRef<HTMLDivElement>(null);
  const moveFocus = useRef(false);

  const [open, setOpen] = useState(defaultOpen);
  const [value, setValue] = useState<DateRange>(initial);
  const [compare, setCompare] = useState<CompareMode>(defaultCompare);
  const [draftCompare, setDraftCompare] = useState<CompareMode>(defaultCompare);
  const [draft, setDraft] = useState<{ start: Date; end: Date | null }>(initial);
  const [hover, setHover] = useState<Date | null>(null);
  const [view, setView] = useState(() => startOfMonth(addMonths(initial.end, -1)));
  const [focusDate, setFocusDate] = useState<Date>(initial.end);

  const list = useMemo(() => presets(today), [today.getTime()]);
  const months = [view, addMonths(view, 1)];
  const isDisabled = (d: Date) => disableFuture && d > today;

  // The range drawn on the grid: the draft, or a live preview while waiting for the second end
  const shown: DateRange | null = draft.end ? { start: draft.start, end: draft.end } : hover ? order(draft.start, hover) : { start: draft.start, end: draft.start };
  const shownCompare = shown && draft.end ? compareRange(shown, draftCompare) : null;
  const activePreset = draft.end ? list.find((p) => same(p.range.start, draft.start) && same(p.range.end, draft.end))?.label : undefined;

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridsRef.current?.querySelector<HTMLButtonElement>(`[data-date="${key(focusDate)}"]`)?.focus();
  }, [focusDate, view]);

  function openPicker() {
    setDraft(value);
    setDraftCompare(compare);
    setHover(null);
    setView(startOfMonth(addMonths(value.end, -1)));
    setFocusDate(value.end);
    setOpen(true);
    moveFocus.current = true;
  }

  function close(restore = true) {
    setOpen(false);
    if (restore) triggerRef.current?.focus();
  }

  function pick(d: Date) {
    if (isDisabled(d)) return;
    if (draft.end === null) {
      setDraft(order(draft.start, d));
      setHover(null);
    } else {
      setDraft({ start: d, end: null });
    }
    setFocusDate(d);
  }

  function focusTo(d: Date) {
    // Keep the focused day on screen: shift the two-month window when it walks off either edge
    if (d < months[0]!) setView(startOfMonth(d));
    else if (d >= addMonths(months[1]!, 1)) setView(startOfMonth(addMonths(d, -1)));
    moveFocus.current = true;
    setFocusDate(d);
    if (draft.end === null) setHover(d);
  }

  function onGridKey(e: KeyboardEvent<HTMLDivElement>) {
    const f = focusDate;
    const dow = (f.getDay() - weekStartsOn + 7) % 7;
    const map: Record<string, () => Date> = {
      ArrowLeft: () => addDays(f, -1),
      ArrowRight: () => addDays(f, 1),
      ArrowUp: () => addDays(f, -7),
      ArrowDown: () => addDays(f, 7),
      Home: () => addDays(f, -dow),
      End: () => addDays(f, 6 - dow),
      PageUp: () => addMonths(f, e.shiftKey ? -12 : -1),
      PageDown: () => addMonths(f, e.shiftKey ? 12 : 1),
    };
    const go = map[e.key];
    if (go) {
      e.preventDefault();
      focusTo(go());
    }
  }

  function apply() {
    const end = draft.end ?? draft.start;
    const range = order(draft.start, end);
    setValue(range);
    setCompare(draftCompare);
    onApply?.(range, compareRange(range, draftCompare));
    close();
  }

  const valueCompare = compareRange(value, compare);
  const weekdays = Array.from({ length: 7 }, (_, i) => fmtWeekday.format(day(2026, 1, 1 + ((i + weekStartsOn) % 7))).slice(0, 2));

  return (
    <div className={cx("kb-root kb-drp", className)}>
      <span className="kb-drp-label" id={`${id}-label`}>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        className="kb-drp-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? close() : openPicker())}
      >
        <Icon name="calendar" size={16} />
        <span id={`${id}-value`} className="kb-drp-value">
          {formatRange(value)}
          {valueCompare ? <span className="kb-drp-vs">vs {formatRange(valueCompare)}</span> : null}
        </span>
        <Icon name="chevronDown" size={16} />
      </button>

      {open ? (
        <div
          className="kb-drp-pop"
          role="dialog"
          aria-modal="false"
          aria-label={`Choose ${label.toLowerCase()}`}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              close();
            }
          }}
        >
          <div className="kb-drp-presets" role="group" aria-label="Presets">
            {list.map((p) => (
              <button
                key={p.label}
                type="button"
                className="kb-drp-preset"
                aria-pressed={activePreset === p.label}
                onClick={() => {
                  setDraft(p.range);
                  setHover(null);
                  setView(startOfMonth(addMonths(p.range.end, -1)));
                  setFocusDate(p.range.end);
                }}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="kb-drp-main">
            <div className="kb-drp-grids" ref={gridsRef} onKeyDown={onGridKey} onMouseLeave={() => setHover(null)}>
              {months.map((month, mi) => {
                const offset = (month.getDay() - weekStartsOn + 7) % 7;
                const count = day(month.getFullYear(), month.getMonth() + 1, 0).getDate();
                const weeks = Math.ceil((offset + count) / 7);
                const titleId = `${id}-m${mi}`;
                return (
                  <div key={key(month)} className="kb-drp-month">
                    <div className="kb-drp-month-head">
                      {mi === 0 ? (
                        <button type="button" className="kb-drp-nav" aria-label="Previous month" onClick={() => setView(addMonths(view, -1))}>
                          <Icon name="chevronLeft" size={16} />
                        </button>
                      ) : <span className="kb-drp-nav-gap" />}
                      <h3 id={titleId} className="kb-drp-month-title" aria-live="polite">{fmtMonth.format(month)}</h3>
                      {mi === 1 ? (
                        <button type="button" className="kb-drp-nav" aria-label="Next month" onClick={() => setView(addMonths(view, 1))}>
                          <Icon name="chevronRight" size={16} />
                        </button>
                      ) : <span className="kb-drp-nav-gap" />}
                    </div>
                    <table className="kb-drp-grid" role="grid" aria-labelledby={titleId}>
                      <thead>
                        <tr>
                          {weekdays.map((w) => <th key={w} scope="col" abbr={w}>{w}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {Array.from({ length: weeks }, (_, w) => (
                          <tr key={w}>
                            {Array.from({ length: 7 }, (_, c) => {
                              const n = w * 7 + c - offset + 1;
                              if (n < 1 || n > count) return <td key={c} role="gridcell" />;
                              const d = day(month.getFullYear(), month.getMonth(), n);
                              const inRange = within(d, shown);
                              const isStart = same(d, shown?.start);
                              const isEnd = same(d, shown?.end);
                              // Caps close the bar at week edges and month edges so each row reads as one part
                              const capL = inRange && (isStart || c === 0 || n === 1);
                              const capR = inRange && (isEnd || c === 6 || n === count);
                              const inCmp = within(d, shownCompare);
                              const cmpL = inCmp && (same(d, shownCompare?.start) || c === 0 || n === 1);
                              const cmpR = inCmp && (same(d, shownCompare?.end) || c === 6 || n === count);
                              return (
                                <td
                                  key={c}
                                  role="gridcell"
                                  aria-selected={inRange || undefined}
                                  className="kb-drp-cell"
                                  data-range={inRange || undefined}
                                  data-cap-l={capL || undefined}
                                  data-cap-r={capR || undefined}
                                  data-preview={(inRange && draft.end === null) || undefined}
                                  data-cmp={inCmp || undefined}
                                  data-cmp-l={cmpL || undefined}
                                  data-cmp-r={cmpR || undefined}
                                >
                                  <button
                                    type="button"
                                    className="kb-drp-day"
                                    data-date={key(d)}
                                    data-end={isStart || isEnd || undefined}
                                    data-today={same(d, today) || undefined}
                                    tabIndex={same(d, focusDate) ? 0 : -1}
                                    disabled={isDisabled(d)}
                                    aria-label={`${fmtLong.format(d)}${same(d, today) ? ", today" : ""}${inCmp ? ", in comparison period" : ""}`}
                                    aria-current={same(d, today) ? "date" : undefined}
                                    onClick={() => pick(d)}
                                    onMouseEnter={() => draft.end === null && setHover(d)}
                                    onFocus={() => setFocusDate(d)}
                                  >
                                    {n}
                                  </button>
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                );
              })}
            </div>

            <div className="kb-drp-foot">
              <div className="kb-drp-compare" role="radiogroup" aria-label="Compare with">
                <span className="kb-drp-compare-label">Compare with</span>
                {(
                  [
                    ["none", "Nothing"],
                    ["period", "Previous period"],
                    ["year", "Previous year"],
                  ] as const
                ).map(([mode, text]) => (
                  <button
                    key={mode}
                    type="button"
                    role="radio"
                    aria-checked={draftCompare === mode}
                    className="kb-drp-seg"
                    onClick={() => setDraftCompare(mode)}
                  >
                    {text}
                  </button>
                ))}
              </div>
              <p className="kb-drp-summary" aria-live="polite">
                {draft.end ? (
                  <>
                    <strong>{spanDays({ start: draft.start, end: draft.end })} days</strong>
                    {shownCompare ? <>, compared with {formatRange(shownCompare)}</> : null}
                  </>
                ) : (
                  <>Pick the other end of the range</>
                )}
              </p>
              <div className="kb-drp-actions">
                <Button size="sm" variant="ghost" onClick={() => close()}>Cancel</Button>
                <Button size="sm" variant="primary" onClick={apply}>Apply range</Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
