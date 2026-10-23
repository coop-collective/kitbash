import { useId, useMemo, useState } from "react";
import { Button } from "../button/Button.tsx";
import { cx, Icon, NumberRoll } from "../../shared/index.ts";
import "./billing-schedule.css";

export type Repeat = "monthly" | "quarterly" | "yearly" | "once";
export type Timing = "advance" | "arrears";

export interface BillingLine {
  id: string;
  product: string;
  /** Per unit, per charge */
  price: number;
  quantity: number;
  repeat: Repeat;
  timing: Timing;
}

export interface BillingPhase {
  /** yyyy-mm-dd */
  start: string;
  months: number;
  lines: BillingLine[];
  /** Percent off every line */
  discount: number;
  /** Least the customer pays over the phase; the gap is billed as a true-up on the last invoice */
  minimum: number;
}

export const PRODUCT_CATALOG: Array<Omit<BillingLine, "id">> = [
  { product: "Agent seats", price: 40, quantity: 25, repeat: "monthly", timing: "advance" },
  { product: "Platform fee", price: 6000, quantity: 1, repeat: "yearly", timing: "advance" },
  { product: "Onboarding and setup", price: 4000, quantity: 1, repeat: "once", timing: "advance" },
  { product: "Extra runs, 10k pack", price: 250, quantity: 2, repeat: "quarterly", timing: "arrears" },
  { product: "Dedicated eval cluster", price: 900, quantity: 1, repeat: "monthly", timing: "arrears" },
  { product: "Priority support", price: 1200, quantity: 1, repeat: "quarterly", timing: "advance" },
];

export const DEMO_PHASE: BillingPhase = {
  start: "2026-11-01",
  months: 12,
  lines: PRODUCT_CATALOG.slice(0, 4).map((l, i) => ({ ...l, id: `l${i}` })),
  discount: 10,
  minimum: 30000,
};

export interface BillingScheduleProps {
  initial?: BillingPhase;
  /** Name shown in the header */
  title?: string;
  customer?: string;
  onSave?: (phase: BillingPhase) => void;
  className?: string;
}

const EVERY: Record<Repeat, number> = { monthly: 1, quarterly: 3, yearly: 12, once: 0 };
const REPEAT_LABEL: Record<Repeat, string> = { monthly: "Monthly", quarterly: "Quarterly", yearly: "Yearly", once: "Once" };

const money = (n: number, cents = false) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });

/**
 * Which invoice (0..months) each charge of a line lands on. Slot `months` is the closing invoice,
 * used by charges billed in arrears at the end of the phase.
 */
function charges(line: BillingLine, months: number): number[] {
  const every = EVERY[line.repeat];
  if (every === 0) return [line.timing === "advance" ? 0 : months];
  const out: number[] = [];
  for (let m = 0; m < months; m += every) out.push(line.timing === "advance" ? m : Math.min(m + every, months));
  return out;
}

function monthLabel(start: string, offset: number) {
  const [y, m] = start.split("-").map(Number);
  const d = new Date(y ?? 2026, (m ?? 1) - 1 + offset, 1);
  return d.toLocaleString("en-US", { month: "short", ...(d.getMonth() === 0 || offset === 0 ? { year: "numeric" } : {}) });
}

/**
 * Builds one billing phase: start date, length, products with how often and when they bill, a discount and a
 * minimum commitment, with totals that roll as you type. Beneath the table, the phase is a sprue of month parts:
 * each invoice is a raised part sized by its amount, so yearly and one-time charges stand out on the months
 * they hit, and a minimum true-up shows as a decal-yellow cap someone has to agree to.
 */
export function BillingSchedule({ initial = DEMO_PHASE, title = "Phase 1", customer = "Northwind Support, annual plan", onSave, className }: BillingScheduleProps) {
  const id = useId();
  const [phase, setPhase] = useState<BillingPhase>(initial);
  const [added, setAdded] = useState(0);
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const patch = (p: Partial<BillingPhase>) => {
    setPhase((cur) => ({ ...cur, ...p }));
    setSavedAt(null);
  };
  const patchLine = (lineId: string, p: Partial<BillingLine>) =>
    patch({ lines: phase.lines.map((l) => (l.id === lineId ? { ...l, ...p } : l)) });

  const calc = useMemo(() => {
    const months = Math.max(1, phase.months);
    const factor = 1 - Math.min(100, Math.max(0, phase.discount)) / 100;
    const slots = Array.from({ length: months + 1 }, () => 0);
    const lineTotals = phase.lines.map((l) => {
      const hits = charges(l, months);
      const each = l.price * l.quantity;
      hits.forEach((s) => (slots[s] = (slots[s] ?? 0) + each * factor));
      return { count: hits.length, total: each * hits.length };
    });
    const subtotal = lineTotals.reduce((s, l) => s + l.total, 0);
    const discount = subtotal * (1 - factor);
    const net = subtotal - discount;
    const trueUp = Math.max(0, phase.minimum - net);
    const last = slots[months]! > 0 ? months : months - 1;
    const total = net + trueUp;
    return { months, slots, lineTotals, subtotal, discount, net, trueUp, last, total };
  }, [phase]);

  const showClose = calc.slots[calc.months]! > 0;
  const shownSlots = showClose ? calc.slots : calc.slots.slice(0, calc.months);
  const peak = Math.max(...shownSlots.map((v, i) => v + (i === calc.last ? calc.trueUp : 0)), 1);
  const [sy, sm] = phase.start.split("-").map(Number);
  const endLabel = new Date(sy ?? 2026, (sm ?? 1) - 1 + calc.months - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" });

  function addLine() {
    const template = PRODUCT_CATALOG.find((p) => !phase.lines.some((l) => l.product === p.product)) ?? PRODUCT_CATALOG[0]!;
    patch({ lines: [...phase.lines, { ...template, id: `n${added}` }] });
    setAdded((n) => n + 1);
  }

  const numberField = (value: number, onChange: (n: number) => void, label: string, opts: { min?: number; max?: number; step?: number } = {}) => (
    <input
      className="kb-bs-input kb-bs-num"
      type="number"
      inputMode="decimal"
      value={Number.isFinite(value) ? value : ""}
      min={opts.min}
      max={opts.max}
      step={opts.step}
      aria-label={label}
      onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
    />
  );

  return (
    <section className={cx("kb-root kb-bs kb-part", className)} aria-labelledby={`${id}-title`}>
      <header className="kb-bs-head">
        <div>
          <h3 id={`${id}-title`}>{title}</h3>
          <p>{customer}</p>
        </div>
        <div className="kb-bs-total" aria-live="polite">
          <span className="kb-bs-total-label">Phase total</span>
          <NumberRoll value={money(calc.total)} className="kb-bs-total-value" />
          <span className="kb-bs-total-sub">about {money(calc.total / calc.months)} a month</span>
        </div>
      </header>

      <div className="kb-bs-terms">
        <label className="kb-bs-term">
          <span>Starts</span>
          <input className="kb-bs-input" type="date" value={phase.start} onChange={(e) => e.target.value && patch({ start: e.target.value })} />
        </label>
        <div className="kb-bs-term">
          <span id={`${id}-dur`}>Length</span>
          <div className="kb-bs-stepper" role="group" aria-labelledby={`${id}-dur`}>
            <button type="button" aria-label="One month shorter" disabled={phase.months <= 1} onClick={() => patch({ months: phase.months - 1 })}>
              <Icon name="minus" size={14} />
            </button>
            <output aria-live="polite">{phase.months} {phase.months === 1 ? "month" : "months"}</output>
            <button type="button" aria-label="One month longer" disabled={phase.months >= 36} onClick={() => patch({ months: phase.months + 1 })}>
              <Icon name="plus" size={14} />
            </button>
          </div>
          <small>Ends {endLabel}</small>
        </div>
        <label className="kb-bs-term">
          <span>Discount</span>
          <span className="kb-bs-affix-well">
            {numberField(phase.discount, (n) => patch({ discount: Math.min(100, Math.max(0, n)) }), "Discount percent", { min: 0, max: 100 })}
            <span className="kb-bs-affix">%</span>
          </span>
        </label>
        <label className="kb-bs-term">
          <span>Minimum commit</span>
          <span className="kb-bs-affix-well">
            <span className="kb-bs-affix">$</span>
            {numberField(phase.minimum, (n) => patch({ minimum: Math.max(0, n) }), "Minimum commit in dollars", { min: 0, step: 500 })}
          </span>
        </label>
      </div>

      <table className="kb-bs-table">
        <thead>
          <tr>
            <th scope="col">Product</th>
            <th scope="col" className="kb-bs-r">Price</th>
            <th scope="col" className="kb-bs-r">Qty</th>
            <th scope="col">Repeats</th>
            <th scope="col">Billed</th>
            <th scope="col" className="kb-bs-r">In phase</th>
            <th scope="col"><span className="kb-sr">Remove</span></th>
          </tr>
        </thead>
        <tbody>
          {phase.lines.map((l, i) => {
            const t = calc.lineTotals[i];
            return (
              <tr key={l.id} className="kb-bs-row">
                <td>
                  <input className="kb-bs-input kb-bs-name" value={l.product} aria-label="Product" onChange={(e) => patchLine(l.id, { product: e.target.value })} />
                </td>
                <td className="kb-bs-r">
                  <span className="kb-bs-affix-well kb-bs-price">
                    <span className="kb-bs-affix">$</span>
                    {numberField(l.price, (n) => patchLine(l.id, { price: Math.max(0, n) }), `${l.product} price`, { min: 0 })}
                  </span>
                </td>
                <td className="kb-bs-r">{numberField(l.quantity, (n) => patchLine(l.id, { quantity: Math.max(0, Math.round(n)) }), `${l.product} quantity`, { min: 0 })}</td>
                <td>
                  <select className="kb-bs-input kb-bs-select" value={l.repeat} aria-label={`${l.product} repeats`} onChange={(e) => patchLine(l.id, { repeat: e.target.value as Repeat })}>
                    {(Object.keys(REPEAT_LABEL) as Repeat[]).map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}
                  </select>
                </td>
                <td>
                  <select className="kb-bs-input kb-bs-select" value={l.timing} aria-label={`${l.product} billed`} onChange={(e) => patchLine(l.id, { timing: e.target.value as Timing })}>
                    <option value="advance">In advance</option>
                    <option value="arrears">In arrears</option>
                  </select>
                </td>
                <td className="kb-bs-r kb-bs-line-total">
                  <NumberRoll value={money(t?.total ?? 0)} />
                  <small>{t?.count ?? 0} {t?.count === 1 ? "charge" : "charges"}</small>
                </td>
                <td>
                  <button type="button" className="kb-bs-x" aria-label={`Remove ${l.product}`} onClick={() => patch({ lines: phase.lines.filter((x) => x.id !== l.id) })}>
                    <Icon name="x" size={14} />
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="kb-bs-add">
        <Button size="sm" variant="ghost" icon="plus" onClick={addLine}>Add product</Button>
      </div>

      <div className="kb-bs-rail-wrap">
        <div className="kb-bs-rail-head">
          <span>Invoices</span>
          <span className="kb-bs-legend">
            <i data-k="charge" /> Charges
            {calc.trueUp > 0 ? <><i data-k="trueup" /> Minimum true-up</> : null}
          </span>
        </div>
        <ol className="kb-bs-rail" aria-label="Invoice amount by month" style={{ gridTemplateColumns: `repeat(${shownSlots.length}, minmax(0, 1fr))` }}>
          {shownSlots.map((v, i) => {
            const up = i === calc.last ? calc.trueUp : 0;
            const label = i === calc.months ? "Close" : monthLabel(phase.start, i);
            return (
              <li key={i} className="kb-bs-slot" data-empty={v + up === 0 || undefined}>
                <span className="kb-bs-bar" style={{ height: `${Math.max(v + up > 0 ? 6 : 0, ((v + up) / peak) * 100)}%` }}>
                  {up > 0 ? <span className="kb-bs-bar-up" style={{ height: `${(up / (v + up)) * 100}%` }} /> : null}
                </span>
                <span className="kb-bs-slot-label" aria-hidden>{calc.months <= 18 || i % 3 === 0 || i === calc.months ? label : ""}</span>
                <span className="kb-sr">{label}: {money(v + up)}{up > 0 ? `, including ${money(up)} minimum true-up` : ""}</span>
              </li>
            );
          })}
        </ol>
      </div>

      <footer className="kb-bs-foot">
        <dl className="kb-bs-sums">
          <div><dt>Subtotal</dt><dd><NumberRoll value={money(calc.subtotal)} /></dd></div>
          <div><dt>Discount {phase.discount}%</dt><dd><NumberRoll value={`−${money(calc.discount)}`} /></dd></div>
          <div data-k={calc.trueUp > 0 ? "trueup" : undefined}>
            <dt>Minimum true-up</dt>
            <dd><NumberRoll value={money(calc.trueUp)} /></dd>
          </div>
        </dl>
        <div className="kb-bs-actions">
          <span className="kb-bs-saved" role="status">{savedAt ? `Saved ${savedAt}` : ""}</span>
          <Button
            variant="primary"
            onClick={() => {
              onSave?.(phase);
              setSavedAt(new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }));
            }}
          >
            Save phase
          </Button>
        </div>
      </footer>
    </section>
  );
}
