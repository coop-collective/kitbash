# @kitbash/ui

Styrene-themed React components for agent and AI products, catalogued in Storybook. Agents building UI in a Kitbash
project browse this catalog for structure, interaction and motion ideas before reaching for a generic component kit.

```sh
pnpm --filter @kitbash/ui storybook        # http://localhost:6006
pnpm --filter @kitbash/ui build-storybook  # static catalog in packages/ui/dist/storybook
pnpm --filter @kitbash/ui validate         # catalog, per-component entry points, barrel and skill reference are current
pnpm --filter @kitbash/ui test             # every component renders with react-dom/server; package imports resolve
```

The component set follows the component list of [affectUI](https://www.affectui.com/components) as a brief. Every
implementation here is original: written from that public one-line description, then reworked into the Styrene
language. No affectUI source is copied. [`src/catalog.json`](src/catalog.json) records each component's category,
the brief it answers, and what Styrene does differently (`twist`).

## Styrene, the theme

Kitbashing is building a new model from the parts of other kits. Styrene makes interface parts feel like molded
plastic parts that click together:

| Idea | How it shows up |
|---|---|
| Tactility is rare | Surfaces are flat panels split by hairline seams (`--kb-raised`, no drop shadow). Only things you press or turn are molded (`--kb-key`): buttons, keys, knobs, switches. Only floating layers cast a shadow (`--kb-cast-lg`). |
| Parts press in | Keys move down 1px and swap to `--kb-pressed` while held. Fields are recessed (`--kb-recessed`). |
| Ribbed grips | Anything you drag carries molded ribbing (`.kb-ribs`) instead of a dotted grip icon. |
| Snap fit | Confirmations and moving indicators settle with `--kb-snap`, a short overshoot like a part clicking into its socket. Layout changes use `--kb-glide`. |
| One meaning per color | Safety orange `--kb-accent` is only the action you commit (approve, send, run), one per component, with dark text like a hardware key. Selection, checked, current and focus are gunmetal (`--kb-select`). Cobalt `--kb-agent` means an agent is working. Decal yellow `--kb-decal` means waiting on a person: never a button fill, one signal per item. Green is done, crimson is failed. Charts use kit-paint series (`--kb-series-1..6`) that never collide with these. |
| Status like an LED | Status is an indicator shape plus text, not a pastel pill: running pulses, needs-you is a diamond, failed is a square. |
| Tight radius by hierarchy | Frames 9, cards 7, controls 5, parts 3. Pills only for status tags and switches. |
| Type with a voice | Schibsted Grotesk for everything, four weights (`--kb-w-*`), nothing under 12px. JetBrains Mono only for code and machine values: ids, durations, tokens, costs. No tabular figures (they widen Schibsted's punctuation). |

Avoid the generated-UI tells: no all-caps eyebrow labels, no `A · B · C` meta strings, no arrow glyphs appended to
button text, no gradient washes or glows, no cards nested inside cards, no drop shadow on resting surfaces, no sparkle
icon for "AI" (the `sparkle` icon is Kitbash's own mark, a part on its sprue), and no repeating the same state with
several signals on one item.

The direction was set with the method from Lenny's Newsletter, "How to turn your AI into a world-class designer":
a shell-generated seed string chose the orange hue, typeface, a signature detail and the radius scale, and a critic
agent that sees only screenshots scores each pass against a fixed rubric. The seeded signature, sprue runners joining
button groups, was dropped after two independent critiques read it as a rendering glitch; its ribbed grips stayed.

## Writing a component

Each component lives in `src/components/<slug>/`:

| File | Contents |
|---|---|
| `<Export>.tsx` | The component. Named export, typed props with sensible defaults, realistic demo data as a default prop or exported constant so it renders with no props. |
| `<slug>.css` | Its styles, imported by the `.tsx`. Classes are prefixed `kb-<short>-`. Only `--kb-*` tokens for color, radius, shadow, motion; no raw hex except inside data (chart series, avatar colors). |
| `<Export>.stories.tsx` | `title: "Components/<Category>/<Name>"`, `tags: ["autodocs"]`, a docs description, a default story plus stories for each meaningful state. |

Rules:

- **No dependencies** beyond React and `src/shared` (`Icon`, `cx`, `NumberRoll`, `Spinner`, `Shimmer`, `Avatar`, `Tag`,
  `useReducedMotion`, `useInterval`, `useElapsed`, `formatDuration`) and other components here (for example `Button`).
  Charts are hand-written SVG. If an icon is missing, draw it inline in the component.
- **Live, but honest.** "Live" demos run on timers in the component (a `demo`/`autoplay` prop) and stop on unmount.
  With reduced motion, show the end state instead of animating.
- **Accessible.** Real buttons and inputs, labels, `aria-*` for state, keyboard paths for every pointer interaction
  (drag has a keyboard alternative), visible `:focus-visible`.
- **Both themes.** Check light (Styrene) and dark (Gunmetal) with the toolbar or `node scripts/shot.mjs`.
- **Copy** is sentence case, plain verbs, from the user's side: "Approve and run", not "Submit".

### React rules

- **Client components.** A component that uses state, effects or event handlers starts with `"use client";`, so it can
  be imported from a React Server Component (vinext and Next app routers). Pure display components may omit it.
- **No browser APIs during render.** `window`, `document`, `matchMedia`, `IntersectionObserver` and timers belong in
  effects or event handlers, so every component renders on the server. `scripts/ssr-check` renders every story's
  component with `react-dom/server` to prove it.
- **Data comes in through props.** Components never fetch. Every data component takes its data as props with demo
  defaults, plus `loading` (draws its own skeleton from `Skeleton`, `SkeletonText` and `SkeletonCircle`, inside a
  `SkeletonRegion`), and shows `EmptyState` or `ErrorState` (with `onRetry`) where those states exist. Live data that
  refreshes shows a `FreshnessBadge`.
- **Caching and lazy loading are the app's choice.** `useCachedLoader(key, load)` gives stale-while-revalidate data
  with `status` and `updatedAt` to pass straight into a component; `LazyMount` defers heavy components until they near
  the viewport, with the component's `loading` state as the fallback. Each component is also its own import path
  (`@kitbash/ui/<slug>`), so `React.lazy(() => import("@kitbash/ui/chat-thread"))` splits it out.
- **Controlled when it matters.** Selection, open state and values that an app would store accept `value` /
  `onChange` style props; demo state lives inside the component only when those props are absent.

`node scripts/shot.mjs <story-id> --port <port> --theme dark --out <file.png>` screenshots a story from a running
dev server, cropped to the component, and fails on page errors.
