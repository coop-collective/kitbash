# Styrene component catalog

Generated from `packages/ui/src/catalog.json` by `pnpm -F @kitbash/ui gen-skill-catalog`; do not edit by hand.
Each component lives in `src/components/<slug>/` as `<Export>.tsx`, `<slug>.css` and `<Export>.stories.tsx`.

## Agents

| Component | Slug | What makes it Styrene |
|---|---|---|
| Agent Cursors (`AgentCursors`) | `agent-cursors` | Agent edits sit in the page as unglued parts, with a dashed seam in the agent's color, until a person accepts them and they snap flush; margin notes still waiting on you carry the decal-yellow edge. |
| Agent Graph (`AgentGraph`) | `agent-graph` | Calls travel as pellets that land in a tool's socket, whose plug presses in on each hit; links thicken with traffic, and an agent that needs you turns decal yellow and stops calling. |
| Agent Inbox (`AgentInbox`) | `agent-inbox` | One signal per state: an LED-style status mark, the waiting step lit decal yellow, and the open row tinted gunmetal instead of nested in a card; acting glides the row (FLIP) to its new slot. |
| Agent Lanes (`AgentLanes`) | `agent-lanes` | Read like a logic analyzer: a channel per agent, one block grammar (soft fill plus a colored left edge for running and failed, a dashed outline for work held on a person), hand-offs as directed elbows, labels measured to sit inside their block, durations on every finished block, and the axis and header honest about whether the run is running, waiting or shipped. |
| Agent Plan (`AgentPlan`) | `agent-plan` | Steps hang off a recessed runner with numbered gates like a kit instruction sheet, and running the plan fills the runner with accent step by step, like styrene flowing through a mold. |
| Agent Queue (`AgentQueue`) | `agent-queue` | Workers are sockets that job plugs snap into; a rate limit drops a hazard-striped clamp across all sockets while the depth gauge shows the backlog building behind it. |
| Agent Steering (`AgentSteering`) | `agent-steering` | A queued note clips onto the seam after the running step and snaps into the plan as its own step when picked up; Interrupt stops the step, runs your note first and puts a "Resume" step after it. |
| Agent Tree (`AgentTree`) | `agent-tree` | The tree hangs off sprue runners with a gate nub at each card, and a folded branch closes to one stacked part carrying the branch's rolled-up cost. |
| Approval Card (`ApprovalCard`) | `approval-card` | The countdown is plain text that pauses while you read, the preview is set off by seams instead of a nested panel, and deciding presses the card in and seats it as one recessed row with a stamp. |
| Autonomy Dial (`AutonomyDial`) | `autonomy-dial` | A knurled rotary knob in a recessed socket clicks between three detents with a snap overshoot, while the real actions glide between the "Runs on its own" and decal-edged "Asks you first" columns. |
| Context Window (`ContextWindow`) | `context-window` | Context drawn as a memory dump: one cell per thousand tokens, fifty to a line, each line addressed by its token offset; a hard rule and hatching mark where the agent compacts on its own, and Compact says what it frees and previews the cells it would clear. |
| Decision Tree (`DecisionTree`) | `decision-tree` | Options hang from one runner like parts on a sprue (risky ones edged in hazard stripes), and confirming a path snips every other branch's gate so they drop off the runner. |
| Delegate Board (`DelegateBoard`) | `delegate-board` | Each agent's load is a rail of task parts on a shared hour scale; holding a task over an agent snaps a hatched ghost part onto the rail with the new busy-until time, and the card presses in. |
| Inline Diff (`InlineDiff`) | `inline-diff` | Each pending edit sits on decal tape because it is waiting on you; deciding peels the tape and the kept words settle into the sentence, with Y/N/J/K keys and Cmd/Ctrl+Z undo. |
| Memory Panel (`MemoryPanel`) | `memory-panel` | Pausing a memory pushes it down into the panel as a pressed-in part instead of greying it out, and forgetting slides an Undo tray up from the panel's bottom edge. |
| Permission Request (`PermissionRequest`) | `permission-request` | The three grant lengths are one molded strip with a risk gradient (only the narrowest grant is the orange key), and granting folds the card into a hole-punched key tag on one line with a draining ring and Revoke. |
| Review Center (`ReviewCenter`) | `review-center` | Unsure spans wear a wavy decal underline with the reason on hover or focus, and each verdict debosses a stamp into the pressed card before it slides out and the next item rises in. |
| Tool Call Card (`ToolCallCard`) | `tool-call-card` | Status is a lit lens sunk into the part, and the group header draws a recessed runner bar with one segment per call, sized by its duration and lit by its status. |
| Trace Waterfall (`TraceWaterfall`) | `trace-waterfall` | A profiler, not a card: the header says where the run went (model time, tool time, idle, the costliest call) instead of repeating totals; tree guides, an axis that grows while the run is live, durations always right of their bar, and cobalt only for what is still running. |

## Chat

| Component | Slug | What makes it Styrene |
|---|---|---|
| AI Answer (`AiAnswer`) | `ai-answer` | Citation studs and numbered source cards work like a peg and socket: point at either one and the other presses down into the recessed source tray. |
| Chat Composer (`ChatComposer`) | `chat-composer` | When a prompt asks a connected app to write something, a decal-yellow approval tab slides up out of the composer's top seam and the send key turns into a lock until a person answers. |
| Cited Answer (`CitedAnswer`) | `cited-answer` | Clicking a citation opens the quoted passage as a recessed well cut into the answer, with the matching words raised as embossed marks. |
| Comment Thread (`CommentThread`) | `comment-thread` | Replies hang off a molded spine, and the assistant's "What I did" receipt folds down on a hinge, with a decal-yellow stripe on any item waiting for a person. |
| Comments Panel (`CommentsPanel`) | `comments-panel` | Comments waiting on you carry a decal tab clipped to the card's top edge, the /edit key stays pressed in while the edit runs, and resolving snaps a card shut into a thin green seam you can reopen. |
| Message Actions (`MessageActions`) | `message-actions` | The bar is one molded strip split by part seams that only shows its plastic when you reach for it, and toggles stay pressed into the strip instead of filling with color. |
| Model Picker (`ModelPicker`) | `model-picker` | Speed, quality and cost show as rows of neutral pips that click in one by one beside the list, set off by a seam rather than a nested panel, and the tray rolls first-token time and price like odometers. |
| Thinking Loader (`ThinkingLoader`) | `thinking-loader` | Built on the shared eight-ray Spinner and Shimmer, each phase clicks up into a drum window with a snap overshoot, and on finish the rays retract and a green check stud snaps into the socket. |
| Thinking State (`ThinkingState`) | `thinking-state` | Steps sit on a recessed rail that fills like resin running down a mold channel, and each finished step gets a green peg that snaps into its socket. |
| Writing Assistant (`WritingAssistant`) | `writing-assistant` | Instead of a decorative gradient glow, the card's rim is edge-lit like clear acrylic and only glows ultramarine while the assistant is writing or listening. |

## Inputs

| Component | Slug | What makes it Styrene |
|---|---|---|
| Billing Schedule (`BillingSchedule`) | `billing-schedule` | The phase is drawn as a row of month parts in a recessed channel, each sized by its invoice amount, and a minimum-commit top-up shows as a decal-yellow cap on the last invoice because someone has to agree to it. |
| Combobox (`Combobox`) | `combobox` | Picks snap into the recessed field as chips, and Backspace first lifts the last chip out (tilted, red edge) so a second press is needed to remove it. |
| Date Range Picker (`DateRangePicker`) | `date-range-picker` | The range is one continuous molded bar capped at week and month edges with raised end knobs, and the comparison period sits as a recessed groove under its days. |
| Dropzone (`Dropzone`) | `dropzone` | A stack of documents fans out of the drop area while files hover, and progress fills a recessed channel like plastic injecting into a mold, then turns green and flattens with a snapped-in check. |
| Filter Menu (`FilterMenu`) | `filter-menu` | Active filters show as one molded part per group (a label cap, then each value as a piece separated by a seam) instead of one chip per value, and "Waiting on you" carries a small decal-yellow mark. |
| Integration Settings (`IntegrationSettings`) | `integration-settings` | Unsaved edits slide a save bar with a decal-yellow edge into the card's bottom seam, and switching the service off sinks the body into a dimmed, recessed well. |
| OTP Input (`OtpInput`) | `otp-input` | One focus ring glides between recessed cells, and a correct code closes the gaps so the cells fuse into a single green "Verified" part. |
| Prompt Library (`PromptLibrary`) | `prompt-library` | Empty blanks in the sentence are decal-yellow slots that wait on a person, filled ones snap in as raised ultramarine parts, and progress shows as a row of small yellow-to-green markers. |
| Stepper Form (`StepperForm`) | `stepper-form` | Finished steps stay latched as pressed-in green keys on the step bar, the current key stands raised, and the groove between keys fills as you advance while the card resizes to each step. |

## Data display

| Component | Slug | What makes it Styrene |
|---|---|---|
| Breakdown Chart (`BreakdownChart`) | `breakdown-chart` | Each bar is a stack of molded bricks with a 2px seam and a light catch on each top edge, so picking a measure or segment makes the bricks snap into place; arrow keys walk the bars and up/down picks a segment, kept in step with the linked table. |
| Change Summary (`ChangeSummary`) | `change-summary` | Each change gets one to four detent notches for how far it moved, colored by whether that's good for this metric; a bad move past the metric's alert line gets a decal-yellow stripe and a "Mark as seen" button. |
| Compact Breakdown (`CompactBreakdown`) | `compact-breakdown` | Parts sit on a recessed runner like pieces on a sprue; changing the period rolls the numbers, glides the runner and lets ranked rows trade places, with a brief chevron on the rows that moved. |
| Data Table (`DataTable`) | `data-table` | The selected range sinks into the sheet, ringed only on its outer edge, while the active cell stays raised like a key; cells that differ from their starting value carry an accent corner notch, which undo clears. |
| Experiment Card (`ExperimentCard`) | `experiment-card` | Once a metric passes the confidence line, the card wears a decal-yellow top strip and a "Needs your call" tag until someone picks a winner, which then drops into a recessed socket with a snap. |
| KPI Chart (`KpiChart`) | `kpi-chart` | Lines are labeled where they end, each value paired with last week's; last week is drawn as dashed ghosts, today is stated as of a time and compared to the same time a week ago, and shaded bands explain the shape of the data (weekend dips). |
| Usage Meter (`UsageMeter`) | `usage-meter` | One molded strip per category sits in a recessed tray, with a limit tab clipped to its rim; past the warning line the tab and the action turn decal yellow and the footer says when credits run out at the current pace. |

## Buttons

| Component | Slug | What makes it Styrene |
|---|---|---|
| Button (`Button`) | `button` | Raised at rest with a top light catch and bottom shade, it presses 1px into the page while held, and loading swaps the label for the eight-ray spinner without changing width. |
| Reaction Bar (`ReactionBar`) | `reaction-bar` | One molded pill with seams between segments; like and repost are push-latch switches that stay pressed into the pill while on, and counts roll digit by digit. |

## Navigation

| Component | Slug | What makes it Styrene |
|---|---|---|
| Command Menu (`CommandMenu`) | `command-menu` | The highlight is a single gunmetal slider that snaps from row to row with an overshoot, actions show what they do rather than whose logo they are, and when a shortcut fires its keycap visibly presses in. |
| Integration Picker (`IntegrationPicker`) | `integration-picker` | The service and workspace tiles are joined by a molded runner that is dashed while open, flows decal yellow while sign-in waits on a person, and turns cured green with a check that snaps into place once connected. |
| Profile Menu (`ProfileMenu`) | `profile-menu` | Setup progress is a recessed parts tray with one slot per step: finished steps are green parts that drop and seat into their slot, and the next step waiting on the person is ringed in decal yellow. |
| Segmented Control (`SegmentedControl`) | `segmented-control` | The indicator is a slider in a recessed track with seams between options: its leading edge moves first so it stretches slightly, it lifts with a deeper shadow while dragged, and it snaps into the option it is dropped on. |

## Feedback

| Component | Slug | What makes it Styrene |
|---|---|---|
| Decision Inbox (`DecisionInbox`) | `decision-inbox` | The two answers are one molded rocker: the chosen half presses in and locks green, the row's decal-yellow edge turns green, the outcome shows with Undo, then the row folds away and focus moves to the next decision. |
| Notification Stack (`NotificationStack`) | `notification-stack` | Cards behind the front one show only their neutral molded edge, so the stack reads as depth rather than a rainbow; dismissed cards slide off and the next one snaps up into place. |
| Progress Tracker (`ProgressTracker`) | `progress-tracker` | Progress is a rail of separate molded cells, one per step, that clip in with a snap and all turn green when the last one lands, instead of a smooth bar; ticks draw themselves. |
| Setup Guide (`SetupGuide`) | `setup-guide` | Task groups are numbered like kit instruction steps and split by seams; a finished task gets one cured-green check, and a finished group turns its step badge green, folds itself and opens the next step. |
| Toaster (`Toaster`) | `toaster` | Toasts stack with only their top edges showing; pulled sideways, a toast resists like a part held in its socket until a 64px detent, then pops free and lifts; promise toasts snap from spinner to a self-drawing check. |

## Cards

| Component | Slug | What makes it Styrene |
|---|---|---|
| Email Draft (`EmailDraft`) | `email-draft` | Anything the agent guessed (the recipient) wears a decal-yellow ring and a "guess" note until a person confirms or changes it; after send or discard the card folds into a slim strip with a burning undo fuse. |
| Project Card (`ProjectCard`) | `project-card` | The progress ring is made of snap-fit arc parts, one per subtask: green when done, ultramarine while an agent works on it, decal yellow when it waits on a person; people, ring parts and rows light each other up on hover. |
| Smart Recommendation (`SmartRecommendation`) | `smart-recommendation` | Confidence is shown as five molded pips pressed into the card (colored by level) instead of a percentage bar, and a swapped-in alternative snaps into the main slot. |
| Tips Panel (`TipsPanel`) | `tips-panel` | Taking a tip presses its card down from a raised part into a recessed, cured-green socket with a stamped check, so the tips still to do stand up off the surface. |
