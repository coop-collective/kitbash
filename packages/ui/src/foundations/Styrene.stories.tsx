import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { Button } from "../components/button/Button.tsx";
import { Icon, iconNames, NumberRoll, Shimmer, Spinner, Tag } from "../shared/index.ts";
import "./foundations.css";

const meta = {
  title: "Foundations/Styrene",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Styrene is the Kitbash UI theme: interface parts that feel molded and click together. Every component reads these tokens from tokens.css.",
      },
    },
  },
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const swatches = [
  ["Styrene", "--kb-styrene", "Page and wells"],
  ["Panel", "--kb-panel", "Raised parts"],
  ["Gunmetal", "--kb-ink", "Text"],
  ["Safety orange", "--kb-accent", "Act here: primary action, selection, focus"],
  ["Paint-pot cobalt", "--kb-agent", "An agent is working"],
  ["Decal yellow", "--kb-decal", "Waiting on a person"],
  ["Cured green", "--kb-ok", "Done, healthy"],
  ["Crimson", "--kb-danger", "Failed, destructive"],
  ["Primer teal", "--kb-info", "Neutral notices"],
] as const;

export const Palette: Story = {
  render: () => (
    <div className="kb-fd">
      <section>
        <h2>Palette</h2>
        <p>Cool styrene grays carry the structure. Signal colors each have one meaning, so a glance tells you who is waiting on whom.</p>
        <div className="kb-fd-swatches">
          {swatches.map(([name, token, use]) => (
            <figure key={token} className="kb-fd-swatch kb-part" style={{ margin: 0 }}>
              <div className="kb-fd-chip" style={{ background: `var(${token})` }} />
              <figcaption>
                {name}
                <code>{token}</code>
                <span style={{ color: "var(--kb-ink-2)" }}>{use}</span>
              </figcaption>
            </figure>
          ))}
        </div>
      </section>
    </div>
  ),
};

export const Surfaces: Story = {
  render: function SurfacesDemo() {
    const [on, setOn] = useState(false);
    return (
      <div className="kb-fd">
        <section>
          <h2>Molded surfaces</h2>
          <p>Surfaces stay flat, split by hairline seams. Only things you press or turn are molded: keys, knobs and switches, which press in while held. Fields sit recessed.</p>
          <div className="kb-fd-surfaces">
            <div className="kb-fd-surface" data-kind="raised">Flat panel, --kb-raised</div>
            <div className="kb-fd-surface" data-kind="key">Keycap, --kb-key</div>
            <div className="kb-fd-surface" data-kind="recessed">Recessed, --kb-recessed</div>
            <div className="kb-fd-surface" data-kind="pressed">Pressed, --kb-pressed</div>
          </div>
        </section>
        <section>
          <h2>Snap fit</h2>
          <p>Confirmations settle with a small overshoot (--kb-snap), like a part clicking into its socket. Layout changes glide.</p>
          <div className="kb-fd-snap">
            <div className="kb-fd-track" data-on={on || undefined}>
              <div className="kb-fd-knob" />
            </div>
            <Button onClick={() => setOn((v) => !v)}>Toggle</Button>
          </div>
        </section>
      </div>
    );
  },
};

export const Type: Story = {
  render: () => (
    <div className="kb-fd">
      <section className="kb-fd-type">
        <h2>Type</h2>
        <p>One family, Schibsted Grotesk. JetBrains Mono is reserved for code and machine values: ids, durations, tokens and costs.</p>
        {(["2xl", "xl", "lg", "md", "sm", "xs"] as const).map((size) => (
          <div key={size}>
            <code>--kb-text-{size}</code>
            <span style={{ fontSize: `var(--kb-text-${size})` }}>Approve the deploy to staging</span>
          </div>
        ))}
        <div>
          <code>numbers</code>
          <span style={{ fontSize: "var(--kb-text-2xl)", fontWeight: 600 }}>
            $<NumberRoll value="12,480" />
          </span>
        </div>
      </section>
    </div>
  ),
};

export const Parts: Story = {
  render: () => (
    <div className="kb-fd">
      <section>
        <h2>Grips</h2>
        <p>Anything you grab to drag is ribbed, like the handle of a molded part.</p>
        <span className="kb-ribs" />
      </section>
      <section>
        <h2>Shared parts</h2>
        <p>Small pieces every component builds from.</p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
          <Spinner size={16} />
          <Shimmer>Reading 4 files</Shimmer>
          <Tag>Queued</Tag>
          <Tag tone="agent" live>Running</Tag>
          <Tag tone="decal" dot>Needs you</Tag>
          <Tag tone="ok" dot>Done</Tag>
          <Tag tone="danger" dot>Failed</Tag>
        </div>
      </section>
      <section>
        <h2>Icons</h2>
        <div className="kb-fd-icons">
          {iconNames.map((name) => (
            <div key={name}>
              <Icon name={name} size={20} />
              <span>{name}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  ),
};
