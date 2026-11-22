# Explicit maintenance skills

Kitbash's first maintenance skills replace broad Clean Code prescriptions with evidence-led, bounded work after merge or at an explicitly requested readiness checkpoint.

| Skill | Task |
|---|---|
| [clean-code-typescript](clean-code-typescript/SKILL.md) | Diagnose a TypeScript correctness, agent-navigation or measured performance problem |
| [clean-code-rust](clean-code-rust/SKILL.md) | Diagnose Rust behavior, ownership/task lifecycle or measured costs |
| [page-delivery](page-delivery/SKILL.md) | Choose and verify rendering/data-refresh/cache strategies per route |
| [deterministic-tests](deterministic-tests/SKILL.md) | Write tests that pass on every run, and find and fix the cause of a flaky one |

The language names preserve existing Gitstalk invocations. These are maintenance procedures, not style guides that every feature agent should read. Research and its limits live in the skills' targeted references. No universal function/file-size limits or performance savings are claimed.

`deterministic-tests` is the exception to the explicit-only rule below. "Tests must be deterministic" is a core rule for every coding agent in every project, so the skill stays implicitly invocable and the `kit` plugin ships it twice: the short rule in `packages/plugin/plugins/kitbash/rules/deterministic-tests.md`, which the plugin's SessionStart hook adds to every session, and this skill as a plugin skill (a copy the plugin build generates from this directory) for the checklist and fix recipes. The two Clean Code skills refer to it for any test they add or change.

## Installation and invocation

Each directory is self-contained. Copy selected directories into the project's skill location, or vendor this `skills/` tree as a pinned subtree payload and expose selected skill directories through the harness's supported discovery mechanism. Keep project commands, budgets and exceptions outside the vendored directories. Updating the files does not itself enable a recurring job.

For the three explicit skills, Claude Code frontmatter uses `disable-model-invocation: true`; Codex policy uses `allow_implicit_invocation: false`. After installation, explicitly invoke `/clean-code-typescript`, `/clean-code-rust` or `/page-delivery` in Claude, or the corresponding `$skill-name` in Codex. Do not add those three skills to always-load instructions or feature-agent preload lists. [Claude invocation controls](https://code.claude.com/docs/en/skills#control-who-invokes-a-skill), [Codex invocation policy](https://learn.chatgpt.com/docs/build-skills)

## Post-merge integration contract

A future runner should select a merged revision and concrete finding, assign assessment or repair, provide scope and a budget, and reserve verification capacity. It should suppress unchanged/deferred findings, enforce cost/time limits outside the model, and open separate reviewable changes. Finishing with no change is valid. Existing correctness/security gates remain part of feature development.

No scheduler or automatic agent invocation is installed here. Claude's current explicit-only setting also blocks subagent preloading and a scheduled task whose prompt is just the skill. A runner must use a supported, explicitly authorized invocation/instruction-delivery path and verify that the installed harness loads it; a post-merge event alone is insufficient. Do not weaken the ordinary feature agents' invocation policy to make scheduling work.

Measure accepted fixes, false positives, regressions, runtime improvements and total agent/tool/review cost. Compare matched tasks with and without the skills before claiming an economic benefit.
