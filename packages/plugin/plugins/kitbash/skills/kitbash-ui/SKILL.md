---
name: kitbash-ui
description: Consult the Kitbash Styrene Storybook (@kitbash/ui) for inspiration and reusable source before designing or building React UI, especially agent and AI product surfaces such as approvals, tool calls, plans, chat, model pickers, inputs, charts and onboarding. Use when building, restyling or reviewing frontend UI in a Kitbash or vinext project, or when the user wants an interface that looks less like a stock component kit.
---

# Build UI from the Styrene catalog

Kitbash ships a Storybook of original React components in its own visual language, Styrene. Before you design a
screen or reach for a generic component kit, look here for a part that already solves the interaction, then adapt it.
The aim is UI that is recognizably considered and distinct from the default shadcn/Tailwind look.

## Find the catalog

- In a Kitbash checkout: `packages/ui/` (`README.md`, `src/catalog.json`, `src/components/<slug>/`). Run
  `pnpm --filter @kitbash/ui storybook` to browse it at `http://localhost:6006`, with a light/dark toolbar toggle.
- In an installed plugin: `runtime/catalog/ui/`, resolved relative to the plugin root, with the same layout.
- [references/catalog.md](references/catalog.md) lists every component with its category and what makes it distinct.
  Read it first and open only the components that match the task.

## How to use it

1. **Match the task to parts.** For each screen, name the interactions it needs (approve an action, show a tool call,
   pick a model, stream an answer, filter a list) and find the catalog entries that cover them. Prefer composing
   existing parts over inventing a new widget. A screen usually needs two to five parts plus layout.
2. **Read the part before using it.** Open `<Export>.tsx`, `<slug>.css` and `<Export>.stories.tsx`. The stories show
   each state the part supports; the docs description says what it is for.
3. **Bring it in as source.** Copy the component directory plus `src/tokens.css` and the `src/shared/` helpers it
   imports into the project's UI directory (`src/components` in the vinext preset). Keep the files' own styles,
   motion and accessibility. Change content, props and data wiring, not the visual language. In a workspace that
   already depends on `@kitbash/ui`, import from the package instead of copying.
4. **Keep it Styrene, or retheme on purpose.** Components read only `--kb-*` CSS variables. To fit an existing brand,
   override tokens (`--kb-accent`, `--kb-font`, surfaces) on `:root` rather than editing component CSS. Keep the
   theme's rules when building new parts next to these: flat panels split by hairline seams, molded keycaps only on
   things you press or turn, ribbed grips on drag handles, snap-fit motion for confirmations, one meaning per color
   (orange = the one action you commit, gunmetal = selected or current, cobalt = an agent is working, decal yellow
   = waiting on a person, never as a button fill), LED-style status (shape plus text, not pills), tight radius by
   hierarchy, Schibsted Grotesk with mono only for machine values.
5. **Inspiration, not a template.** When no part fits, design the new part by the README's conventions so it reads as
   part of the same kit, and consider contributing it back with a story through a Git pull request.

## Wire it into the app

- Import the tokens once (`import "@kitbash/ui/tokens.css"`), put `kb-root` on the app container, and import each
  component from its own path: `import { ChatThread } from "@kitbash/ui/chat-thread"`. Copied components keep the same
  folder layout, so the path maps one to one.
- Interactive components carry `"use client"`; render them from server components with serializable props and keep
  event handlers in a client component of the app's own.
- Components never fetch. Load data in the app, ideally with `useCachedLoader(key, load, { maxAge })` from
  `@kitbash/ui/shared`, and pass `data`, `loading`, `status` and `updatedAt` through. Seed the cache from server data
  with `primeCache`; call `invalidate` after a mutation.
- Every data component has a `loading` skeleton; use `EmptyState` and `ErrorState` (with `onRetry`) for the other
  states, and `FreshnessBadge` for data that refreshes. Defer heavy components below the fold with `LazyMount` and
  `React.lazy(() => import("@kitbash/ui/<slug>"))`, using the component's `loading` state as the fallback.
- The catalog's Foundations/Usage story shows each pattern end to end.

## Quality bar

- Set `.kb-root` on the app container (font, color, tabular numerals) and `data-theme="dark"` on `<html>` for dark mode.
- Every interaction keeps a keyboard path. Reduced motion shows end states instead of animating.
- Replace demo data with the project's real data. A component's demo timers and `autoplay` props are for the
  catalog; turn them off in the product.
- Check both themes in the running app and report what you verified. Do not claim a screen works from the catalog
  story alone.

Do not pull in components from other UI kits alongside these for the same surface. Mixed visual languages are what
this catalog exists to avoid.
