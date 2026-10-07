# Book Production Tracker: product specification

Oct 5, 2026 · @EdTech

## Overview and goals

The Book Production Tracker is a general web app for planning and tracking any multi-book production run, from writing and illustration through review, layout, printing and binding. Each run is a series with its own pipeline, team and dates. The first series is eSTEAM L2: the app replaces the static Rev 5 swimlane diagram and tracks the 13 Level 2 learner books, N1 to Grade 9, aiming for binding by 24 November 2026, with room to run up to 15 December. Textbooks, workbooks, teacher guides or later eSTEAM levels become new series, set up from a template rather than new code.

**The problem.** The current plan is a drawing on its fifth revision. Every slip means redrawing it by hand, nobody can see current status at a glance, per-person workload is invisible, and the effect of a late task on the print date has to be worked out manually.

**Goals**

1. One source of truth for every task's owner, dates and status.
2. Answer "where are we" in under ten seconds from a single screen.
3. Show the knock-on effect of any slip on downstream tasks and on the final date, immediately.
4. Make overload per person visible before it happens.
5. Let the coordinator re-plan by dragging bars on the swimlane instead of redrawing a diagram.

**Proposed success measures**

- The Rev 5 diagram is retired within one week of go-live; the app is the only plan.
- Task status is updated within one working day of any change.
- Re-planning after a slip takes the coordinator under five minutes.
- No book reaches printing without a recorded approval.

## Users, roles and permissions

Permissions come from four system roles, held per series. What someone does on a series (EdTech, reviewer, designer, Production Unit) is a team label plus the tasks assigned to them, so any series can define its own teams without code changes. eSTEAM L2 has roughly 12 to 15 people; its external binder is tracked as a vendor, not a user.

| System role | Can do | eSTEAM L2 example |
| --- | --- | --- |
| Admin | Everything across all series: create series and templates, manage people, holidays and settings | Plan owner |
| Coordinator | On their series: edit the schedule (drag, resize, reassign, link), set the series' target date and hard limit, edit windows, tracks and stages, approve for print, plus everything a contributor can do | Project manager (named by admin later) |
| Contributor | Update status, notes and feedback links on their own tasks; approve or return work on review tasks assigned to them; update print records on printing and binding tasks assigned to them | EdTechs, reviewers, designers, Production Unit |
| Viewer | Read and comment only | Management |

Roles are held per series, so a designer can be a coordinator on one series and a contributor on another.

Every logged-in user can comment on any task. Permission checks run on the server for every action; the UI hides controls a role cannot use but never relies on that alone.

### Accounts and sign-in

Only invited people can create accounts; there is no open sign-up.

1. **Invite.** Placeholder people such as EdTech 1 can be assigned work before anyone signs up. To bring someone in, the admin, or a coordinator for their own series, enters the person's email and sends an invite. The email carries a single-use link valid for 7 days. Resending voids the old link, and an unused invite can be revoked.
2. **Accept.** The link opens `/invite/[token]`, where the person confirms their display name and sets a password of at least 10 characters. A 6-digit code is emailed to verify the address. Once it is entered, the account is linked to the existing person record, so every task already assigned to the placeholder carries over.
3. **Sign in.** Email and password, then a 6-digit emailed code valid for 10 minutes. Sessions end after 7 days without activity.
4. **Forgotten password.** "Forgot password" on the sign-in page emails a single-use reset link valid for 30 minutes; the page shows the same message whether or not the email exists. Setting a new password signs the account out everywhere else, and the next sign-in still needs the emailed code. An admin can also send a reset link from the people page.
5. **Leaving.** Deactivating a person ends their sessions and blocks sign-in. Their tasks and history stay, and the coordinator reassigns any open work.

## Scope

The MVP covers everything the coordinator and team need to run the current production cycle; phase 2 turns it into a reusable tool for future series.

**MVP (version 1)**

- A general series model (configurable tracks, stages, book groups, team labels, windows and print settings), seeded with eSTEAM L2 from Rev 5: 13 books, placeholder people, enforced time windows and dependencies.
- Status matrix as the home screen, with a series switcher once more than one series exists.
- Swimlane editor with draggable, resizable and editable bars, dependency arrows and automatic slip propagation.
- My tasks view for each assignee.
- Basic workload view (tasks per person per day), plus a print and binding tracker with copies planned, printed and bound per book.
- Task drawer with status, assignees, dates, notes and comments.
- Review loop with iteration count, review badges (done and pending), a Google Drive feedback link per task, and a print approval gate per book.
- Baseline snapshot of Rev 5 with variance shown per task.
- Activity log, undo, email and password sign-in with OTP verification, and roles.

**Phase 2**

- Overload alerts and suggested reassignments.
- Email and in-app notifications on handoff, return and lateness.
- Per-stage review checklists (for example the five image QA areas: topic headers, main topic images, project images against the shoot reference, design structure, content images).
- Links to InDesign packages and source files, beyond the review feedback links in the MVP.
- A new-series wizard that starts from a saved template or a blank pipeline, so eSTEAM L1 and L3, textbooks, workbooks or any other run can be planned in minutes. Until then, new series are created from a template through a simple admin form.
- Export of the swimlane to PDF and PNG; CSV export of tasks.

**Out of scope**

Storing InDesign or image files, page-level PDF annotation, costs and budgets, and native mobile apps. The web app is responsive, but swimlane editing targets desktop and tablet.

## Core concepts

Every book runs through its track's pipeline of stages, which each series defines for itself, and each book-stage pair is one task with owners, dates and a status. The swimlane, matrix and workload views are three ways of looking at the same set of tasks.

| Concept | What it is | eSTEAM L2 example |
| --- | --- | --- |
| Series | One production run with its own pipeline, team, dates and settings | eSTEAM L2, from 1 Oct 2026; target 24 Nov, hard limit 15 Dec |
| Template | A saved pipeline (tracks, stages, default durations, dependency pattern, team labels) that a new series can start from | "Learner book series", saved from eSTEAM L2 |
| Book | One title in a series | Grade 9, KG 1, N1 |
| Book group | A free-form grouping set per series for filters and reports; its display name is configurable | Shown as "Grade group": Preschool, Lower, Upper, JHS |
| Track | A named stage sequence defined per series; each book follows one | Image track, Content track |
| Stage | One step in one or more tracks, with a category and default duration | Converting to InDesign |
| Task | One book at one stage; the unit people work on | Overall review, Grade 6 |
| Team label | A per-series job label used to group swimlane lanes and the workload view; separate from permissions | EdTech, Reviewer, Designer, Production Unit |
| Assignee | A person on a task; a task can have several, one marked lead | KG2 content: EdTech 1, 2 and 3 |
| Dependency | Finish-to-start link with an optional lag in working days | InDesign (G9) before Overall review (G9) |
| Batch | A wave of books moving together | G9, G8, G7 |
| Window | A date band; each series chooses whether windows are enforced or shown for reference only, and enforced series can let marked tasks overflow a set number of days into the next window | Oct 20 to 21, enforced |
| Review cycle | One pass of review on a task, approved or returned | Iteration 2 on Grade 8 correction |
| Print record | Copies planned, printed and bound for one book, with binder details | 20 copies per book |
| Baseline | A frozen copy of planned dates to measure slippage against | Rev 5 |

**Tracks in eSTEAM L2.** The image track covers Grades 1 to 9: image generation (Grades 1 to 3 only), image review and correction, overall content review, converting to InDesign, post-layout review, correction and iteration, publishing (manuscript submission and payment, agency review, ISBN issue, all running alongside layout), print approval, printing and binding. The content track covers N1, N2, KG1 and KG2: content restructure (or generation, for N1) with illustration and image generation, content and images review, then the same layout, review, ISBN, approval, print and binding stages. Stages a book does not need are recorded as skips, so Grade 9 has a skip for image generation and no task for it. Another series defines its own tracks; a textbook run might use a single track of manuscript, copyedit, layout, proofread, ISBN and metadata, print approval, printing, binding and legal deposit; an ebook run would end with an online release stage instead of printing.

**Stage categories** drive colour on the swimlane: Creation (writing, illustration, image generation), Review, Layout, Publishing (ISBN assignment, copyright and catalogue registration, metadata, legal deposit, online release) and Production; every working stage in any series maps to one of these five, so colours work for any pipeline. A sixth category, Gate, covers approval points such as print approval: a gate takes no working days, is drawn as a diamond in --foreground, and completes only through its approval action, never through a status button.

&#91;embedded content: Stage pipeline · two tracks, one review loop, one gate\]

In text: image track books go from image generation (Grades 1 to 3 only) to image review and correction, then whole-book content review; content track books go from writing content and illustrations to content review. Both tracks then go to InDesign layout and layout review. A returned layout review loops through corrections back to layout review. An approved one goes to print approval, which also waits for the 7-working-day ISBN process, and then to printing by the Production Unit and external binding.

Both tracks merge at InDesign layout. A returned layout review loops through corrections until approved, and print approval waits for both an approved layout and a recorded ISBN. The ISBN stage and the print gate are the two stages Rev 5 does not have; legal deposit of 2 printed copies, which follows binding, is a third.

## Views and features

The app has five main views. The status matrix is the home screen; the swimlane is where planning happens.

### Status matrix (home)

A grid with one row per book (13 for eSTEAM L2, grouped by batch) and one column per stage. Each cell shows the task's status as a coloured chip, its lead assignee's initials and its planned end date. Review cells also carry a badge with reviews done and pending, and printing and binding cells show copies against plan, for example "12 of 22". Empty cells mean the stage does not apply. A header strip shows today's date, the projected final binding date against the series target date and hard limit, and counts of late and at-risk tasks. Clicking a cell opens the task drawer. Filters: grade group, batch, person, status.

### Swimlane editor

The auto-generated Gantt view of the Rev 5 diagram, fully editable by drag and inline edit. Full interaction rules are in the next section.

### My tasks

The signed-in person's tasks in three groups: due now, up next (predecessor finishing within two working days), and later. Each row has one-tap status buttons that follow the allowed moves: Start (Not started to In progress), Resume corrections (Returned to In progress), Submit for review, and Done for stages with no review step. Only the buttons valid for the task's current status are shown. Reviewers see a fourth group, Waiting for my review.

### Workload

A person-by-day heatmap of assigned task days, using each person's capacity (default one task day per day). Cells over capacity are flagged. This is where the EdTech 1 bottleneck in Rev 5 becomes visible. Clicking a cell lists the tasks behind it.

### Book detail

One page per book: its ISBN and edition, its pipeline as a horizontal stepper, all tasks with dates and variance from baseline, review history, comments and the print approval record.

### Task drawer

Opens from any view. Fields: title, book, stage, assignees (lead marked), planned start and end, duration in working days, status, iteration, Google Drive feedback link, notes, predecessors and successors, comments and activity. Coordinators can edit everything, including an Allow overflow switch when the series enforces windows; assignees can change status and add notes.

### Review loop

When an assignee marks a task Submit for review, the reviewer on the next review stage is notified (in-app in MVP). The reviewer chooses Approve, which completes the task and releases its successors, or Return with changes, which sets the task to Returned, increments its iteration count and records a short summary. The returned task moves to the top of the assignee's My tasks, and they set it back to In progress when they start the corrections. Iteration count shows on the bar and in the matrix, so books stuck in loops stand out. Detailed feedback stays in Google Drive comments; each task stores a link to that file, and the app only counts reviews done and pending, shown as icon badges on bars, matrix cells and the book page.

### Print approval gate

Printing cannot start until a coordinator records approval on the book: who approved, when, and an optional note. The approval is blocked while any earlier task is not Done, including the publishing stage, so no book goes to print without its ISBN recorded on the book page. This closes the gap in Rev 5, where the last review flows straight into the press.

### Print and binding tracker

Each book has a print record that the Production Unit updates: copies planned (default 20), copies printed and the date, date sent to the external binder, date returned, copies bound, and the binder's name and contact. It also records the legal deposit: copies submitted (2 per book for eSTEAM L2, printed and bound on top of the 20 planned, so each print run is 22) and the date, against the deadline of two calendar months after the ISBN was issued. A book counts as finished only when copies bound equals copies planned plus deposit copies and its deposit is recorded. When a book's print record is created, copies planned and deposit copies are copied from the series' default copies and legal deposit copies; the coordinator can then change them for that book. Changing a series default later affects only books added afterwards, unless the coordinator chooses Apply to all books, which updates every book whose printing has not started and lists any it skipped.

### Recording ISBNs

When the agency issues an ISBN, the project manager (coordinator) enters it with the edition on the book page. The app accepts only a valid ISBN-13 (13 digits with a correct check digit) that no other book uses. The ISBN issued task can only be marked Done once the book has an ISBN, so the print approval gate cannot open without one. Changing an ISBN after print approval is first refused with HTTP 409 and the code confirm\_required; the app then shows a confirmation dialog and resends the request with confirmChange set to true. The change is logged, and if printing has not started the print approval is withdrawn and the gate task returns to Not started, so the coordinator re-approves once the new ISBN is in the files.

### Task statuses

| Status | Meaning | Set by |
| --- | --- | --- |
| Not started | Scheduled, not yet begun | System |
| In progress | Work has started | Assignee |
| In review | Submitted, waiting on a reviewer | Assignee |
| Returned | Reviewer sent it back with changes | Reviewer |
| Done | Complete and approved where needed | Assignee or reviewer |
| Blocked | Cannot proceed; reason required | Anyone assigned |

Allowed moves: Not started to In progress; In progress to In review, or straight to Done when the stage has no review step; In review to Done or Returned; Returned to In progress. Any status except Done can move to Blocked and back to the status it came from. The server rejects any other change.

Late and At risk are computed flags, not statuses: Late means today is past the planned end and the task is not Done; At risk means a predecessor is late, or the task's projected end passes its hard deadline, such as the legal deposit date, or its book's projected finish passes the series hard limit. Outside window means a started task no longer fits its window after a window change.

## Swimlane editor

Every bar on the swimlane can be dragged, resized, reassigned and edited in place, and every change pushes dependent tasks forward with a preview before it is saved.

### Layout

- **Time axis.** Working days from the series start to two weeks past the target, with weekends drawn as narrow grey columns. Zoom levels: day (default) and week. The toolbar above the axis holds the zoom, the lane grouping toggle, the Critical path toggle and, while strict mode is on, a Strict badge. A vertical line marks today; a dashed line marks the series target date.
- **Windows.** The Rev 5 windows appear as labelled bands across the top and as faint dividers down the grid. When the series enforces them, as eSTEAM L2 does, every task belongs to the window it starts in and cannot cross its edge unless the coordinator has allowed it to overflow. The overflowing part of a bar is drawn at 60% opacity past a dashed window edge, with a badge such as "+1d".
- **Lanes.** Two groupings, switched with a toggle. By person groups lanes by the series' team labels; for eSTEAM L2 that reproduces Rev 5, with one lane per EdTech, reviewer, designer and the Production Unit. By book shows one lane per book with its whole pipeline left to right. Lanes collapse into their role or batch.
- **Bars.** Fill colour shows stage category; the label shows stage and book ("InDesign · G8"). Status shows as fill style: outline for Not started, solid for In progress, striped for In review, a dashed border with a return-arrow icon for Returned, a check icon and reduced opacity for Done, a danger border for Late or Blocked. An iteration badge ("×2") appears after the first return. The print gate is a diamond.
- **Dependencies.** Thin arrows from a bar's end to its successor's start. An arrow turns danger-coloured when a successor starts before its predecessor ends.

### Interactions

| Action | Mouse or touch | Keyboard | Result |
| --- | --- | --- | --- |
| Move | Drag bar horizontally | Arrow left or right moves one working day | Bar moves within its window, or into another window when dropped there, snapping to working days; it cannot straddle a window edge beyond its overflow allowance; successors preview as ghost bars |
| Resize | Drag left or right edge | Shift plus arrow | Changes start or duration up to the window's edge, or into the next window up to the overflow allowance for a task allowed to overflow. Pulling an ordinary task past the edge asks the coordinator whether to allow overflow for it. Minimum one working day |
| Reassign | Drag bar vertically into another lane (person grouping only) | Open popover, change assignee | Lead assignee changes; workload updates live |
| Edit | Double-click bar | Enter | Inline popover: title, assignees, dates, status, notes, link to full drawer |
| Create | Drag across empty lane space | N, then fill popover | New task; coordinator picks book and stage |
| Link | Drag from the bar's end handle onto another bar | Popover, add predecessor | New finish-to-start dependency |
| Unlink | Click an arrow, then Delete | Popover, remove predecessor | Dependency removed |
| Multi-select | Shift-click or drag a marquee | Shift plus Tab | Selected bars move and resize together |
| Delete | Popover delete button | Delete, then confirm | Task removed; its links are reattached predecessor to successor |
| Undo and redo | Toolbar buttons | Ctrl or Cmd plus Z; Ctrl or Cmd plus Shift plus Z | Steps back through your own last 50 changes on this series; redo reapplies them |

Only Admin and Coordinator roles can drag, resize, create and link. Everyone else sees the swimlane read-only, with a click opening the task drawer.

### On drop

1. The client applies the change optimistically and shows ghost positions for any successor that has to move.
2. The server recalculates the schedule (rules in the next section) and returns every changed task.
3. A toast summarises the effect, for example "6 tasks moved; projected binding now 26 Nov (target 24 Nov)", with an Undo button.
4. If the projected final date passes the target, the header strip shows a neutral Behind target badge; only past the hard limit do the target line and header strip turn danger-coloured.

### Conflicts and concurrency

- Dropping a task before its predecessor ends is allowed but flagged: the arrow turns danger-coloured and the task gets an At risk flag. Strict mode, switched on in series settings by an admin or coordinator, blocks such drops instead and shows a Strict badge in the swimlane toolbar.
- Double-booking a person is allowed; it shows in the workload view. Production is the exception: printing is capped at 2 books per working day.
- Each task carries a version number. If two people edit the same task, the second save is rejected, the bar snaps to the server state and a toast explains why.
- Other users' changes arrive by polling every 10 seconds and animate into place.

### Build approach

The swimlane is a custom Svelte component rendering bars as positioned HTML elements over a CSS grid time axis, with dependency arrows in an SVG overlay and pointer events for drag. At about 110 tasks this performs well without virtualisation. An off-the-shelf Svelte Gantt library is the alternative; it would save time on the time axis but tends to resist the person-lane layout and custom bar styling this needs, so evaluate one for a day before committing either way.

## Scheduling rules

The scheduler pushes successors forward when a task moves later, never pulls them earlier on its own, and counts only working days.

**Calendar.** Working days are Monday to Friday, minus dates in a holidays table the admin maintains. All dates are calendar dates with no time component, stored as ISO strings ("2026-10-20"), in the Africa/Accra time zone (UTC, no daylight saving). Rev 5 windows such as 15 to 19 October span a weekend; the app treats that as three working days, not five.

**Durations.** Each task stores its duration in working days. The end date is derived from start plus duration, and resizing a bar changes the duration.

**Dependencies.** Finish-to-start only in the MVP, each with a lag in working days (default 0). The default chain per book follows stage order. Cross-book links are allowed, for example to stop a designer's second book starting before their first is converted.

**Propagation.** When a task's dates change, the server walks its successors in topological order and applies:

```typescript
// Dates are ISO 'YYYY-MM-DD' strings, so plain string comparison orders them.
// addWorkingDays and nextWorkingDay skip weekends and the holidays table.

function earliestStart(task: Task): string {
  return maxDate(
    predecessorLinks(task).map(({ predecessor: p, lagDays }) =>
      p.durationDays === 0
        ? addWorkingDays(p.endDate, lagDays)                  // gate: same day
        : nextWorkingDay(addWorkingDays(p.endDate, lagDays))  // task: next day
    )
  );
}

function pushForward(task: Task): void {
  if (task.status === 'done' || isStarted(task)) {
    if (task.startDate < earliestStart(task)) flagAtRisk(task); // frozen: flag, never move
    return;
  }
  const earliest = earliestStart(task);
  if (task.startDate < earliest) {
    task.startDate = earliest;
    task.endDate =
      task.durationDays === 0
        ? task.startDate                                      // gate: one date
        : addWorkingDays(task.startDate, task.durationDays - 1);
  }
}
```

Done tasks and started tasks (In progress, In review, Returned, or Blocked after starting) are never moved by propagation, just as with window changes. When a slip would push a started task, it keeps its dates and is flagged At risk, and propagation carries on from its real end to its not-started successors. Successors that already start late enough are left alone, so slack absorbs slips. The whole recalculation runs in one database transaction and returns the list of changed tasks.

**Gates.** A gate has no duration, so its start and end are the same working day: the day after its last predecessor ends. Its successors may start on that same day, because a gate marks a decision rather than work; for print approval, printing can begin the day approval is given. Gates take no capacity, never sit in a window and are never placed on a buffer day. `addWorkingDays(d, 0)` returns `d`.

**Windows.** When a series enforces windows, as eSTEAM L2 does, every task belongs to the window it starts in, and its end must fall inside that window unless the task is allowed to overflow (below); otherwise windows are reference bands only. Publishing stages are exempt in every series, because they run on the ISBN agency's clock rather than the team's windows. When propagation pushes a task past its window's last working day, the task moves into the earliest later window that starts after its predecessors finish and has room for its duration (counting the overflow allowance for tasks allowed to overflow). If no window has room, the task is marked unscheduled (its schedule\_state changes and its window is cleared, while its dates keep the earliest it could run) and parked in an overflow lane until the coordinator extends a window or adds one. Only Admin and Coordinator can edit windows.

**Window overflow.** Some work genuinely runs a day or two past its window, like KG2's content restructure in Rev 5, which starts in the 15 to 19 October window and finishes inside 20 to 21 October. Each series sets a maximum overflow in working days (0 by default, 2 for eSTEAM L2), and the coordinator marks which tasks may use it. An overflowing task still belongs to the window it starts in, so its `window_id` does not change; only its end may run up to that many working days into the next window. Overflow days count toward the assignee's workload in the next window, and successors start after the true end date as usual. When a slip pushes an overflow-allowed task, it first uses its allowance and only jumps to the next window with room if it would run past it. Tasks not marked for overflow behave exactly as before. The allowance is counted in working days past the window's end, so a task can overflow into a gap between windows. It is capped at the end of the next window, so a task never crosses two window edges; after the series' last window the full allowance applies. An overflow-allowed task keeps its allowance wherever it lands, so a window "has room" when the task's duration fits between its start and the window's end plus the allowance, capped at the end of the next window.

**Changing windows.** In a series that enforces windows, shrinking, moving or deleting a window refits the tasks it affects automatically. A task whose end now passes the window's edge uses its overflow allowance if it has one; otherwise it moves, with its duration unchanged, to the earliest later window that has room. If no window has room, it becomes unscheduled. A task whose start no longer falls inside any window moves forward the same way; tasks are never pulled earlier. Successors are then pushed by the normal propagation rules. Tasks that have started (In progress, In review, Returned, or Blocked after starting) and Done tasks are never moved by a window change, because work on them has begun or finished. A started task that no longer fits gets an Outside window flag, listed in the preview for the coordinator to resolve, and its successors are still pushed from its real end. Deleting a window clears window\_id on any started or Done tasks still in it and keeps their dates. Windows in a series may not overlap; creating or moving one so that it overlaps another returns 422 naming the window it collides with. After any window change, including an extension, the server also retries every unscheduled task in the series, placing each in the earliest window with room after its predecessors. That is how extending a window clears the overflow lane. The whole change is saved as one batch, so a single undo restores the windows and every task. Before saving, the settings page calls the endpoint with `preview: true` and shows the impact, for example "6 tasks move, 1 becomes unscheduled, projected finish 27 Nov", for the coordinator to confirm. The confirmed save returns the impact actually applied; if the schedule changed after the preview and the result differs, the page says so and shows what was applied, with undo available. The same preview, refit and undo apply when the series' overflow allowance is lowered, when a task's overflow switch is turned off, and when window enforcement is switched on. Raising the allowance moves nothing, though unscheduled tasks are retried. Switching enforcement off moves nothing either: every task's window is cleared, and unscheduled tasks become scheduled at the earliest dates they already hold, outside any window, with their successors pushed as usual. In series that do not enforce windows, changing a window moves nothing.

### Pipeline changes

Changes to tracks, stages and books come in two kinds. Edits never create or delete tasks and save straight away. Structural changes do, so they follow the same pattern as window changes: a preview, then one undoable batch, with the impact actually applied returned. Started tasks are never moved or deleted by either kind.

**Edits**

| Item | Editable | Rules |
| --- | --- | --- |
| Track | Name, order | None |
| Stage | Name, category, default duration, review flag, external flag, ignores windows, deadline rule | Category cannot change to or from Gate once the stage has tasks, because gates have no duration. Default duration applies to new tasks only. Turning the review flag off is refused while any of the stage's tasks are In review or Returned. Changing ignores windows or the deadline rule recomputes the affected not-started tasks with a preview. |
| Book | Code, name, group, batch, order | Code stays unique in the series. |

**Structural changes**

| Change | Rule |
| --- | --- |
| Add a book | The coordinator chooses how to schedule it. "Like another book" copies that book's dates, windows, skips and assignees, which suits a book joining an existing batch. "From a date" chains the tasks from a chosen date, defaulting to the next working day, using default durations and placing them in windows like a slip. Tasks are linked by the series' dependency pattern, and a print record is created from the series defaults. |
| Skip a stage for a book | Recorded as a skip, not just a missing task, so later changes never recreate it. Skipping deletes the book's not-started task for that stage and relinks around it; it is refused if the task has started or is Done. Lifting a skip creates the task again. |
| Add a stage | The dialog asks which tracks get it, which books (all ticked, except books whose next stage has already started), what it starts after and finishes before, and how it joins: "Insert into the chain" replaces the direct link between those stages, while "Run alongside" keeps it, as the ISBN process does. Each book's new task is placed after its predecessor, and successors are pushed by normal propagation. |
| Remove a stage or book | Not-started tasks are deleted and their dependencies relinked around them. Started tasks block the removal until they finish or are reset to Not started. Done tasks are kept as history: the stage or book is archived, hidden from the matrix and swimlane, and left out of projections, but still shown in the book page and activity log. A book with an ISBN or a print approval can only be archived. Nothing is hard-deleted once any of its work has started. |
| Change a book's track | Stages in both tracks keep their tasks untouched, progress included. Stages only in the old track are removed under the rule above, and started ones block the change. Stages only in the new track are added under the add-a-stage rule. |
| Reorder stages | Changes the matrix column order only; dependencies are untouched, because books' chains may have been adjusted by hand. New series made from a template use the template's dependency pattern, not the column order. |
| Deadline rules | Edited here, as part of the stage, since a rule applies to every book. Changing one recomputes due dates for tasks not yet Done. Overriding a single task's deadline from the book page is left for phase 2. |

**Structural endpoints**

| Method and path | Body | Returns | Roles |
| --- | --- | --- | --- |
| `POST /api/series/:id/tracks`, `DELETE /api/tracks/:id` | `{ name, stageIds }` | Track; delete refused while any book uses it | Admin, coordinator |
| `POST /api/series/:id/books` | `{ code, name, trackId, groupLabel?, batch?, schedule: { likeBookId } or { fromDate }, preview? }` | Book, its tasks, links and print record | Admin, coordinator |
| `POST /api/series/:id/stages` | `{ name, category, trackIds, defaultDays, flags, after, before, mode: "insert" or "alongside", bookIds, preview? }` | Stage, pattern links, new tasks and pushed successors | Admin, coordinator |
| `PUT`, `DELETE /api/books/:id/skips/:stageId` | `{ preview? }` | Skip recorded and task removed, or skip lifted and task created | Admin, coordinator |
| `PUT /api/books/:id/track` | `{ trackId, preview? }` | Tasks kept, removed and added, or 409 naming started tasks in the way | Admin, coordinator |
| `DELETE /api/stages/:id`, `DELETE /api/books/:id` | `{ preview? }` | Deleted, or archived when Done work exists; 409 naming started tasks | Admin, coordinator |
| `PUT /api/series/:id/stage-order` | `{ stageIds }` | New column order | Admin, coordinator |
| `PUT /api/series/:id/track-order`, `PUT /api/series/:id/book-order` | `{ trackIds }` or `{ bookIds }` | New track or book order; no tasks or dependencies change | Admin, coordinator |

**Production capacity.** Printing capacity, buffer days and default copies are set per series. For eSTEAM L2, the Production Unit prints 2 books per working day at 22 copies each (20 planned plus 2 for legal deposit). Each printing task is one working day, the Production Unit's capacity is set to 2, and the scheduler reserves a buffer of print\_buffer\_days working days (1 for eSTEAM L2) straight after each batch's last printing day. Automatic placement never puts printing on a buffer day, and that batch's binding cannot start until the buffer has passed. A coordinator can still drag a print task onto a buffer day, and the bar then shows a hatched warning. Where windows are enforced, printing plus the buffer must fit inside the window; books that do not fit at the Production Unit's capacity move to the next window. A batch of three books therefore needs 3 working days and N1 needs 2, which matches the Rev 5 printing windows.

**Publishing.** Publishing stages follow the ISBN agency's process, set per series. For eSTEAM L2 they run as below, in working days unless stated. For eSTEAM L2, submission waits for the team's internal content review, so the agency always receives the final manuscript; a series can instead submit straight after content creation when time is tight.

| Stage | Duration | Starts after | Done by |
| --- | --- | --- | --- |
| Manuscript submission and payment | 1 day | Internal content review (overall review, or content and images review) | Project manager (coordinator) |
| Agency review and approval | 5 days | Submission and payment | ISBN agency (external) |
| ISBN issued | 1 day | Approval | ISBN agency (external) |
| Add ISBN to copyright page and cover | Within correction and iteration | ISBN issued | Designer |
| Legal deposit of 2 printed copies | 1 day | Binding | Production, coordinator |

Print approval waits for ISBN issued. Legal deposit carries a hard deadline of two calendar months after ISBN issued; the app counts down to it and flags the task once binding is projected to finish too late.

**Deadlines.** Any stage can carry a deadline rule relative to another stage, such as the legal deposit rule above. The scheduler never moves a deadline; it flags the task At risk when its projected end passes it.

**Cycle check.** Adding a dependency that would create a loop is rejected with a message naming the loop.

**Projected dates.** Each book's projected finish is its binding task's end. The series projected finish is the latest of those, shown against the series target date and its hard limit (24 November and 15 December for eSTEAM L2). Both dates belong to the series, not the app: the admin sets them when creating a series, the admin or coordinator can change them at any time (each change goes in the activity log), and the hard limit is optional. The chain of tasks with no slack before that date is the critical path. A Critical path toggle in the swimlane toolbar (shortcut C) outlines those bars at 2 px in --primary-active and fades every other bar to 40% opacity; the book page has the same toggle for one book. The toggle is off by default and remembered per user.

**Baselines.** On import, Rev 5 is saved as the baseline. Variance per task is planned end minus baseline end in working days, shown in the drawer and the book page. The coordinator can save new baselines (Rev 6 and so on) at any time.

## Design system

Headings use Plus Jakarta Sans and body text uses Inter, on a white background, with the supplied primary, secondary and tertiary tokens carrying stage categories and actions.

### Typography

Both fonts are self-hosted through Fontsource packages so the app does not depend on Google's CDN. Dates and counts use Inter's tabular figures (`font-feature-settings: "tnum"`) so columns line up.

| Token | Font | Size / line height | Weight | Used for |
| --- | --- | --- | --- | --- |
| `--text-display` | Plus Jakarta Sans | 28 / 36 px | 700 | Page titles |
| `--text-h1` | Plus Jakarta Sans | 22 / 30 px | 700 | Section titles |
| `--text-h2` | Plus Jakarta Sans | 18 / 26 px | 600 | Panel and drawer titles |
| `--text-h3` | Plus Jakarta Sans | 15 / 22 px | 600 | Card titles, lane headers |
| `--text-body` | Inter | 14 / 22 px | 400 | Body text, table cells |
| `--text-small` | Inter | 13 / 20 px | 400 to 500 | Labels, meta |
| `--text-bar` | Inter | 12 / 16 px | 500 | Swimlane bar labels, chips |

### Colour tokens (supplied)

```css
:root {
  --primary: #635bff;
  --primary-hover: #5148f5;
  --primary-active: #443bdc;
  --primary-foreground: #ffffff;
  --primary-subtle: #eeedff;
  --primary-subtle-foreground: #5148d8;
  --secondary: #06b6d4;
  --secondary-hover: #089db8;
  --secondary-foreground: #062f36;
  --secondary-subtle: #e7f9fc;
  --tertiary: #f59e0b;
  --tertiary-hover: #d98705;
  --tertiary-foreground: #3d2600;
  --tertiary-subtle: #fff7e8;
}
```

### Colour tokens (approved additions)

The supplied palette has no neutrals or status colours, and the swimlane needs both. These fill the gaps without competing with the brand colours.

```css
:root {
  --background: #ffffff;
  --foreground: #101828;
  --muted: #f5f6f8;
  --muted-foreground: #5d6678;
  --border: #e3e6ec;
  --weekend: #f0f1f4;
  --production: #344054;
  --production-subtle: #eef0f3;
  --publish: #c026d3;
  --publish-hover: #a21caf;
  --publish-foreground: #4a044e;
  --publish-subtle: #fdf4ff;
  --success: #12a150;
  --success-subtle: #e8f7ee;
  --danger: #e5484d;
  --danger-subtle: #fdecec;
  --focus-ring: var(--primary);
}
```

The four `--publish` tokens were added for the publishing category after the other additions and are now approved as well. Fuchsia was chosen to stay clear of the primary indigo, the danger red and the success green.

### How colour maps to meaning

| Element | Colour |
| --- | --- |
| Primary buttons, links, selected state | `--primary`, hover and active variants, text in `--primary-foreground` |
| Creation stage bars | `--primary-subtle` fill, `--primary` border, `--primary-subtle-foreground` text |
| Review stage bars | `--secondary-subtle` fill, `--secondary` border, `--secondary-foreground` text |
| Layout (InDesign) stage bars | `--tertiary-subtle` fill, `--tertiary` border, `--tertiary-foreground` text |
| Printing and binding bars | `--production-subtle` fill, `--production` border |
| Matrix chips: Not started, In progress, In review, Returned, Done, Blocked | `--muted`, `--primary-subtle`, `--secondary-subtle`, `--tertiary-subtle`, `--success-subtle`, `--danger-subtle` |
| Late, conflicts, target missed | `--danger` |
| Publishing stage bars (ISBN, registration, release) | --publish-subtle fill, --publish border, --publish-foreground text |

On the swimlane, colour means stage category; in the matrix, colour means status, because each matrix column already is a stage. Status is never shown by colour alone: chips carry a word and bars carry a fill style or icon.

### Contrast

White text on `--primary` is about 4.7 to 1, which passes WCAG AA for normal text. `--secondary` and `--tertiary` fail as text colours on white, so they are used only as borders and fills, with their dark foreground tokens for any text on top.

### Components and spacing

A 4 px spacing scale, 8 px corner radius on cards, bars and inputs, 1 px borders in `--border`, and a 2 px focus ring in `--focus-ring` with a 2 px offset. Core components: button (primary, secondary, ghost, danger), status chip, avatar initials, task bar, matrix cell, drawer, popover, toast, segmented toggle, date picker that skips non-working days, and a confirmation dialog.

### Breakpoints

| Width | Layout |
| --- | --- |
| Under 640 px (phone) | Single column. Matrix keeps the book column fixed and scrolls sideways. Drawer opens full screen. Swimlane is read-only. |
| 640 to 1023 px (small tablet) | Drawer opens as a 420 px side panel over the page. Swimlane is read-only below 768 px and editable from 768 px, which covers tablets in landscape. |
| 1024 to 1439 px (laptop) | Full layout; drawer docks beside the view. |
| 1440 px and up (wide) | Swimlane shows more days at the same zoom; text sizes do not grow. |

### Loading, empty and error states

- **Loading.** First loads show plain grey placeholder rows and bars in `--muted`; nothing jumps when data arrives. Polling refreshes happen silently.
- **Empty.** No series: admins see "Create your first series"; others see "You have not been added to a series yet". A series with no books prompts the coordinator to add books or apply a template. My tasks with nothing assigned says so in one line. The overflow lane is hidden when no task is unscheduled.
- **Errors.** A failed save snaps the bar back and shows a toast with the reason. After three failed polls in a row, a banner reads "Offline: your view may be out of date" and clears itself when polling recovers.

## Technical architecture

SvelteKit on Vercel talks to the database through Drizzle ORM and the libSQL client, which reads a local SQLite file in development and Turso in production, so the swap is a change of two environment variables rather than a code change.

&#91;embedded content: System architecture · browser, server, database\]

In text: the browser (status matrix, swimlane editor, task drawer, my tasks and workload) sends HTTPS requests to the SvelteKit server on Vercel and polls its change feed. The server holds the pages and endpoints, the scheduler, Better Auth and the change feed, and reaches the database through Drizzle ORM and libSQL: a SQLite file in development or Turso in production, both built from the same migrations.

The browser never touches the database; every write passes through the server, which runs the scheduler; open sessions poll it every 10 seconds for changes made by others.

| Layer | Choice | Why |
| --- | --- | --- |
| Framework | SvelteKit with Svelte 5 (runes), TypeScript, `@sveltejs/adapter-vercel` | Server load functions and endpoints keep data access on the server; runes suit the swimlane's drag state |
| Styling | Plain CSS with the tokens above as custom properties, scoped component styles | No framework needed for a small, token-driven UI |
| Database client | `@libsql/client` | Accepts `file:./data/dev.db` locally and `libsql://<db>.turso.io` with an auth token on Vercel |
| ORM and migrations | Drizzle ORM and drizzle-kit (SQLite dialect) | Typed schema, SQL-like queries, same migrations for SQLite and Turso |
| Auth | Better Auth with its Drizzle adapter: email and password, plus an emailed one-time code that verifies the address at sign-up and confirms each sign-in | Session cookies, role field on the user, works with SvelteKit hooks |
| Email | A transactional email service such as Resend, for one-time codes and invites | Vercel functions cannot send mail on their own |
| Live updates | Clients poll `GET /api/changes?since=<cursor>` every 10 seconds; the cursor is the last activity log id they saw | Serverless functions cannot hold an in-memory broadcast hub; polling is cheap for about 15 users |
| Fonts | `@fontsource/plus-jakarta-sans`, `@fontsource/inter` | Self-hosted |
| Testing | Vitest for scheduler and permission logic; Playwright for drag-and-drop flows | The scheduler is the riskiest code, so it gets unit tests first |
| Hosting | Vercel, maintained by the software unit; production and preview deployments each use their own Turso database | Team's choice; Turso is designed for access from serverless functions |

### Environment

```
DATABASE_URL=file:./data/dev.db          # development
DATABASE_URL=libsql://esteam-l2-<org>.turso.io   # production
DATABASE_AUTH_TOKEN=<turso token>          # production only
BETTER_AUTH_SECRET=<random 32 bytes>
PUBLIC_APP_URL=https://tracker.example.org
RESEND_API_KEY=<email service key>
```

### SQLite to Turso notes

- Use only SQLite features libSQL supports (it is a fork, so this is nearly everything); avoid extensions that need loading.
- Keep IDs as text (ULIDs) rather than auto-increment integers so rows can be created safely on the client before the server confirms.
- Run `drizzle-kit migrate` against Turso in the deploy step; never edit the production schema by hand.
- Turso adds network latency per query compared with a local file, so the propagation step should read the whole series' tasks and dependencies in two queries, compute in memory, then write changed rows in one batch.
- Vercel has no persistent disk, so every deployment, previews included, uses Turso; keep a separate Turso database for previews. The SQLite file is for local development only.

### Project structure

```
src/
  lib/
    server/
      db/         schema.ts, client.ts, seed/esteam-l2.ts
      auth.ts     Better Auth config
      scheduler/  calendar.ts, propagate.ts, windows.ts, critical-path.ts
      templates/  snapshot.ts (series to template), apply.ts (template to series)
      changes.ts  change feed for polling
      permissions.ts
    components/   Matrix, Swimlane, TaskBar, DependencyLayer, TaskDrawer,
                  StatusChip, SeriesSwitcher, Toast, ...
    stores/       selection.svelte.ts, undo.svelte.ts
    styles/       tokens.css, base.css
  routes/
    (app)/+page.svelte                       series list
    (app)/me/+page.svelte                    my tasks, all series
    (app)/s/[series]/+page.svelte            status matrix
    (app)/s/[series]/swimlane/+page.svelte
    (app)/s/[series]/workload/+page.svelte
    (app)/s/[series]/books/[code]/+page.svelte
    (app)/s/[series]/settings/...
    (app)/s/[series]/baselines/+page.svelte
    (app)/s/[series]/activity/+page.svelte
    (app)/series/new/+page.svelte
    (app)/templates/+page.svelte
    (app)/settings/people/+page.svelte
    (app)/settings/calendar/+page.svelte
    api/...
    login/+page.svelte
    invite/[token]/+page.svelte
    reset-password/+page.svelte
    reset-password/[token]/+page.svelte
drizzle/          migrations
```

## Database schema

Twenty-three tables hold the plan, its history and its people; auth tables are generated by Better Auth and linked to `people` through `user_id`. Dates are ISO text, IDs are ULID text, and every mutable task row carries a `version` for optimistic locking.

```sql
-- Series, templates and pipeline definition --------------------------

CREATE TABLE templates (
  id              TEXT PRIMARY KEY,
  name            TEXT NOT NULL,            -- 'Learner book series'
  description     TEXT,
  definition_json TEXT NOT NULL,            -- tracks, stages, stage_tracks, default durations,
                                            -- dependency pattern by stage key, team labels, settings
  created_by      TEXT REFERENCES people(id),
  created_at      TEXT NOT NULL
);

CREATE TABLE series (
  id                   TEXT PRIMARY KEY,
  name                 TEXT NOT NULL,       -- 'eSTEAM L2'
  template_id          TEXT REFERENCES templates(id),
  status               TEXT NOT NULL DEFAULT 'active'
                       CHECK (status IN ('planning','active','closed')),
  start_date           TEXT NOT NULL,       -- '2026-10-01'
  target_date          TEXT NOT NULL,       -- '2026-11-24'
  hard_limit_date      TEXT,                -- optional; '2026-12-15' for eSTEAM L2
  book_group_label     TEXT NOT NULL DEFAULT 'Group',  -- 'Grade group' for eSTEAM L2
  enforce_windows      INTEGER NOT NULL DEFAULT 0,     -- 1 for eSTEAM L2
  strict_mode          INTEGER NOT NULL DEFAULT 0,
  default_copies       INTEGER NOT NULL DEFAULT 20,
  legal_deposit_copies INTEGER NOT NULL DEFAULT 0,     -- 2 for eSTEAM L2
  print_buffer_days    INTEGER NOT NULL DEFAULT 1,
  window_overflow_days INTEGER NOT NULL DEFAULT 0      -- 2 for eSTEAM L2
);

CREATE TABLE tracks (
  id            TEXT PRIMARY KEY,
  series_id     TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  key           TEXT NOT NULL,              -- 'image', 'content'
  name          TEXT NOT NULL,
  sort_order    INTEGER NOT NULL,
  UNIQUE (series_id, key)
);

CREATE TABLE stages (
  id              TEXT PRIMARY KEY,
  series_id       TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  key             TEXT NOT NULL,            -- 'indesign', 'isbn_issued'
  name            TEXT NOT NULL,
  category        TEXT NOT NULL
                  CHECK (category IN ('creation','review','layout','publish','gate','production')),
  sort_order      INTEGER NOT NULL,         -- also the matrix column order
  default_days    INTEGER NOT NULL DEFAULT 1,  -- 0 for gates
  is_review       INTEGER NOT NULL DEFAULT 0,
  is_external     INTEGER NOT NULL DEFAULT 0,  -- done by an outside body, e.g. the ISBN agency
  ignores_windows INTEGER NOT NULL DEFAULT 0,  -- 1 for publishing stages
  deadline_rule   TEXT,                     -- JSON, e.g. {"after":"isbn_issued","months":2}
  archived_at     TEXT,                     -- set on removal when Done tasks keep history
  UNIQUE (series_id, key)
);

CREATE TABLE stage_tracks (
  stage_id      TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  track_id      TEXT NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,
  PRIMARY KEY (stage_id, track_id)
);

CREATE TABLE stage_links (      -- the series' default dependency pattern, applied when tasks are created
  from_stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  to_stage_id   TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  lag_days      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (from_stage_id, to_stage_id)
);

CREATE TABLE books (
  id            TEXT PRIMARY KEY,
  series_id     TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  track_id      TEXT NOT NULL REFERENCES tracks(id),
  code          TEXT NOT NULL,              -- 'G9', 'KG1', 'N1'
  name          TEXT NOT NULL,
  group_label   TEXT,                       -- 'JHS', 'Preschool'; free text per series
  isbn          TEXT UNIQUE,                -- ISBN-13, entered when the agency issues it
  edition       TEXT,                       -- '1st edition, 2026'
  batch         INTEGER,
  sort_order    INTEGER NOT NULL,
  version       INTEGER NOT NULL DEFAULT 1,
  archived_at   TEXT,                       -- set instead of deleting once work has started
  UNIQUE (series_id, code)
);

CREATE TABLE book_stage_skips (  -- stages a book deliberately does not have
  book_id       TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  stage_id      TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, stage_id)
);

-- People, membership and invites -------------------------------------
-- Better Auth adds its own user, session, account and verification tables;
-- password reset tokens and one-time codes live there.

CREATE TABLE people (
  id            TEXT PRIMARY KEY,
  user_id       TEXT UNIQUE,                -- null until the invite is accepted
  display_name  TEXT NOT NULL,              -- 'EdTech 1' until renamed
  email         TEXT UNIQUE,
  is_admin      INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE series_members (
  series_id     TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  person_id     TEXT NOT NULL REFERENCES people(id),
  role          TEXT NOT NULL CHECK (role IN ('coordinator','contributor','viewer')),
  team_label    TEXT,                       -- 'EdTech', 'Reviewer', 'Production Unit'
  capacity      REAL NOT NULL DEFAULT 1,    -- task days per working day; 2 for eSTEAM's Production Unit
  PRIMARY KEY (series_id, person_id)
);

CREATE TABLE invites (
  id            TEXT PRIMARY KEY,
  person_id     TEXT NOT NULL REFERENCES people(id),
  email         TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,       -- only the hash is stored
  invited_by    TEXT NOT NULL REFERENCES people(id),
  created_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,              -- created_at + 7 days
  accepted_at   TEXT,
  revoked_at    TEXT
);

-- Calendar --------------------------------------------------------------

CREATE TABLE windows (
  id            TEXT PRIMARY KEY,
  series_id     TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  label         TEXT NOT NULL,              -- 'Oct 20 to 21'
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  sort_order    INTEGER NOT NULL,
  CHECK (end_date >= start_date)
  -- must not overlap another window in the series (server-checked, 422)
);

CREATE TABLE holidays (
  date          TEXT PRIMARY KEY,
  label         TEXT NOT NULL
);

-- Work ------------------------------------------------------------------

CREATE TABLE tasks (
  id             TEXT PRIMARY KEY,
  book_id        TEXT NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  stage_id       TEXT NOT NULL REFERENCES stages(id),
  -- window_id is null when the task sits outside windows: the series does not
  -- enforce them, the stage ignores them (publishing), or the task is unscheduled;
  -- also when its window is deleted after work started (ON DELETE SET NULL)
  window_id      TEXT REFERENCES windows(id) ON DELETE SET NULL,
  schedule_state TEXT NOT NULL DEFAULT 'scheduled'
                 CHECK (schedule_state IN ('scheduled','unscheduled')),
  overflow_allowed INTEGER NOT NULL DEFAULT 0,  -- end may pass its window by up to series.window_overflow_days
  title          TEXT NOT NULL,
  start_date     TEXT NOT NULL,             -- earliest possible dates while unscheduled
  end_date       TEXT NOT NULL,
  duration_days  INTEGER NOT NULL CHECK (duration_days >= 0),  -- 0 only for gates (server-checked)
  status         TEXT NOT NULL DEFAULT 'not_started'
                 CHECK (status IN ('not_started','in_progress','in_review','returned','done','blocked')),
  status_before_block TEXT,                 -- restored when a Blocked task is unblocked
  blocked_reason TEXT,
  iteration      INTEGER NOT NULL DEFAULT 1,
  feedback_url   TEXT,                      -- Google Drive file holding review comments
  due_date       TEXT,                      -- hard deadline from the stage's deadline rule
  notes          TEXT,
  version        INTEGER NOT NULL DEFAULT 1,
  completed_at   TEXT,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  UNIQUE (book_id, stage_id),
  CHECK (schedule_state = 'scheduled' OR window_id IS NULL)
);

CREATE TABLE task_assignees (
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_id     TEXT NOT NULL REFERENCES people(id),
  is_lead       INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (task_id, person_id)
);

CREATE TABLE dependencies (
  id             TEXT PRIMARY KEY,
  predecessor_id TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  successor_id   TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  lag_days       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (predecessor_id, successor_id)
);

CREATE TABLE review_cycles (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  iteration     INTEGER NOT NULL,
  reviewer_id   TEXT NOT NULL REFERENCES people(id),
  outcome       TEXT NOT NULL CHECK (outcome IN ('approved','changes_requested')),
  comments      TEXT,                       -- short summary; detail stays in Google Drive
  created_at    TEXT NOT NULL
);

CREATE TABLE print_approvals (
  book_id       TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  approved_by   TEXT NOT NULL REFERENCES people(id),
  approved_at   TEXT NOT NULL,
  note          TEXT
);

CREATE TABLE print_records (
  book_id                 TEXT PRIMARY KEY REFERENCES books(id) ON DELETE CASCADE,
  -- copies_planned and deposit_copies are copied from series.default_copies and
  -- series.legal_deposit_copies when the record is created; print run = their sum
  copies_planned          INTEGER NOT NULL,
  deposit_copies          INTEGER NOT NULL,
  copies_printed          INTEGER NOT NULL DEFAULT 0,
  printed_on              TEXT,
  sent_to_binder_on       TEXT,
  returned_from_binder_on TEXT,
  copies_bound            INTEGER NOT NULL DEFAULT 0,
  deposit_submitted_on    TEXT,
  binder_name             TEXT,
  binder_contact          TEXT,
  notes                   TEXT,
  version                 INTEGER NOT NULL DEFAULT 1,
  updated_at              TEXT NOT NULL
);

CREATE TABLE comments (
  id            TEXT PRIMARY KEY,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  author_id     TEXT NOT NULL REFERENCES people(id),
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

-- History ---------------------------------------------------------------

CREATE TABLE baselines (
  id            TEXT PRIMARY KEY,
  series_id     TEXT NOT NULL REFERENCES series(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,              -- 'Rev 5'
  created_at    TEXT NOT NULL
);

CREATE TABLE baseline_tasks (
  baseline_id   TEXT NOT NULL REFERENCES baselines(id) ON DELETE CASCADE,
  task_id       TEXT NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  start_date    TEXT NOT NULL,
  end_date      TEXT NOT NULL,
  PRIMARY KEY (baseline_id, task_id)
);

CREATE TABLE activity_log (
  id            TEXT PRIMARY KEY,           -- ULID, so it doubles as the polling cursor
  series_id     TEXT REFERENCES series(id), -- scopes the change feed; null for global changes
  actor_id      TEXT REFERENCES people(id),
  entity        TEXT NOT NULL CHECK (entity IN (
                  'series','template','track','stage','stage_link','skip','book','task','dependency',
                  'window','holiday','member','person','invite','review',
                  'approval','print_record','comment','baseline')),
  entity_id     TEXT NOT NULL,
  action        TEXT NOT NULL,              -- 'create', 'update', 'delete', 'move', 'resize',
                                            -- 'reassign', 'status', 'undo'
  before_json   TEXT,
  after_json    TEXT,
  batch_id      TEXT,                       -- groups an action and its propagated moves
  created_at    TEXT NOT NULL
);

CREATE INDEX idx_books_series  ON books(series_id);
CREATE INDEX idx_tasks_book    ON tasks(book_id);
CREATE INDEX idx_tasks_window  ON tasks(window_id);
CREATE INDEX idx_tasks_dates   ON tasks(start_date, end_date);
CREATE INDEX idx_assignee_p    ON task_assignees(person_id);
CREATE INDEX idx_dep_succ      ON dependencies(successor_id);
CREATE INDEX idx_invites_p     ON invites(person_id);
CREATE INDEX idx_log_feed      ON activity_log(series_id, id);
CREATE INDEX idx_log_entity    ON activity_log(entity, entity_id);
CREATE INDEX idx_log_batch     ON activity_log(actor_id, series_id, batch_id);
```

The `batch_id` on the activity log lets one undo reverse a drop together with every task it pushed.

## Routes and server actions

Pages load their data through SvelteKit load functions; every write goes through a JSON endpoint that checks the role, checks the task version, runs the scheduler where needed, logs the change and broadcasts it.

### Pages

| Route | View | Roles |
| --- | --- | --- |
| `/` | Series list; opens the only active series directly when there is one | All |
| `/me` | My tasks across every series | All |
| `/s/[series]` | Status matrix | Series members |
| `/s/[series]/swimlane` | Swimlane editor (editable for admin and coordinator) | Series members |
| `/s/[series]/workload` | Workload heatmap | Series members |
| `/s/[series]/books/[code]` | Book detail, including ISBN entry | Series members; ISBN entry for admin and coordinator |
| `/s/[series]/settings` | Tracks, stages, book groups, team labels, windows, members and invites, print and publishing settings, target date and hard limit, enforce windows and strict mode switches | Admin, coordinator |
| `/s/[series]/baselines` | Saved baselines and variance | Admin, coordinator |
| `/s/[series]/activity` | Activity log; each user can undo their own last 50 changes here, and admins any change | Admin, coordinator |
| `/series/new` | Create a series from a template or blank (simple form in MVP, wizard in phase 2) | Admin |
| `/templates` | Saved templates | Admin |
| `/settings/people`, `/settings/calendar` | People, invites, password reset links, holidays | Admin |
| `/login` | Sign-in with password and emailed code | Public |
| `/invite/[token]` | Accept an invite: set name and password, verify email | Public, valid token |
| `/reset-password`, `/reset-password/[token]` | Request a reset link; set a new password | Public, valid token for the second |

### Write endpoints

| Method and path | Body | Returns | Roles |
| --- | --- | --- | --- |
| Better Auth routes under `/api/auth/*` | Sign-in, emailed code, sign-out, password reset request and reset | Session or reset result | Public |
| `POST /api/people` | `{ displayName, email? }` | New placeholder person | Admin; coordinator, who also adds them to their series |
| `POST /api/people/:id/invite` | `{ email }` | Invite sent; any earlier open invite for that person is voided | Admin; coordinator for their series' members |
| `DELETE /api/invites/:id` | none | Invite revoked | Admin, the inviter |
| `POST /api/invites/accept` | `{ token, displayName, password }` | Account created and linked to the person; verification code sent | Public, valid token |
| `POST /api/people/:id/password-reset` | none | Reset link emailed to that person | Admin |
| `PATCH /api/people/:id` | Any of `displayName, active` | Updated person; deactivation ends their sessions | Admin |
| `POST /api/series` | `{ name, startDate, targetDate, hardLimitDate?, templateId? }` | New series with tracks, stages, team labels and settings copied from the template | Admin |
| `PATCH /api/series/:id` | Any of `name, targetDate, hardLimitDate, status, bookGroupLabel, enforceWindows, strictMode, defaultCopies, legalDepositCopies, printBufferDays`, windowOverflowDays, preview? | Updated series; existing print records are unchanged. When the change lowers windowOverflowDays or turns enforceWindows on, also the refit report, saved with the series change as one undoable batch; with preview set, the report only | Admin, coordinator |
| `POST /api/series/:id/print-defaults/apply` | `{ fields: ["copiesPlanned", "depositCopies"] }` | Print records updated to the series defaults for every book whose printing has not started, plus the books skipped; one batch id | Admin, coordinator |
| `POST /api/series/:id/template` | `{ name, description }` | Template saved from this series' pipeline | Admin, coordinator |
| `PATCH /api/tracks/:id`, `PATCH /api/stages/:id`, `PATCH /api/books/:id` | The editable fields listed under Pipeline changes, plus `version` and `preview?` | Updated track, stage or book; changing ignoresWindows or a deadline rule also returns the refit report. Structural changes use the endpoints listed under Pipeline changes | Admin, coordinator |
| `PUT /api/series/:id/members/:personId` | `{ role, teamLabel, capacity }` | Membership | Admin, coordinator |
| `POST /api/series/:id/windows`, `PATCH /api/windows/:id` | `{ label, startDate, endDate, preview? }` | Window, plus every task moved, re-placed, flagged Outside window or made unscheduled, saved as one undoable batch; with preview set, the same report without saving; 422 if it would overlap another window | Admin, coordinator |
| `DELETE /api/windows/:id` | `{ preview? }` | Removed id, plus the same refit report; started and Done tasks in it keep their dates and lose their window | Admin, coordinator |
| `PATCH /api/books/:id/publishing` | `{ isbn, edition, version, confirmChange? }` | { book, approvalWithdrawn }, where approvalWithdrawn is true when the print approval was removed and the gate task reset to Not started; 422 for an invalid or duplicate ISBN-13; 409 `confirm_required` when the book is already approved for print and `confirmChange` is not true | Admin, coordinator |
| `POST /api/tasks/:id/schedule` | `{ start, durationDays, windowId, version }` | Changed tasks, projected dates, or a window error | Admin, coordinator |
| `POST /api/tasks/bulk-schedule` | `{ moves: [{ id, start, durationDays, windowId, version }] }` | Changed tasks, or the failing task ids (rules below) | Admin, coordinator |
| `POST /api/tasks/:id/assignees` | `{ personIds, leadId, version }` | Updated task | Admin, coordinator |
| `PATCH /api/tasks/:id` | Any of `title, notes, status, blockedReason, feedbackUrl, overflowAllowed, version`, preview? | Updated task, or 422 for a status move the rules do not allow. When overflowAllowed is turned off on a task using its overflow, also the refit report, saved as one undoable batch; with preview set, the report only | Coordinator; assignees for status, notes and feedback link |
| `POST /api/tasks` | `{ bookId, stageId, windowId, start, durationDays, personIds }` | New task, changed tasks | Admin, coordinator |
| `DELETE /api/tasks/:id` | `{ version }` | Removed id, relinked dependencies | Admin, coordinator |
| `POST /api/dependencies` | `{ predecessorId, successorId, lagDays }` | Dependency, changed tasks, or a cycle error | Admin, coordinator |
| `DELETE /api/dependencies/:id` | none | Removed id | Admin, coordinator |
| `POST /api/tasks/:id/review` | `{ outcome, summary, version }` | Updated task, review cycle | Assignee of that review task, coordinator |
| `POST /api/books/:id/approve-print` | `{ note }` | Approval, with the book's print approval gate task set to Done in the same transaction; or 409 with the list of unfinished tasks blocking it | Admin, coordinator |
| `PATCH /api/books/:id/print-record` | Any of `copiesPlanned, depositCopies, copiesPrinted, printedOn, sentToBinderOn, returnedFromBinderOn, copiesBound, depositSubmittedOn, binderName, binderContact, notes, version` | Updated print record | Assignee of the book's printing, binding or deposit task, coordinator |
| `POST /api/tasks/:id/comments` | `{ body }` | Comment | Series members |
| `POST /api/undo` | `{ batchId }` | Restored tasks, or 409 naming tasks changed since (rules below) | The batch's actor within their last 50; admin for any batch |
| `POST /api/redo` | `{ batchId }` | Reapplied changes as a new batch | Whoever undid that batch |
| `POST /api/series/:id/baselines` | `{ name }` | Baseline | Admin, coordinator |
| `GET /api/series/:id/changes?since=<cursor>` | none | Everything changed in that series since the cursor, plus the new cursor | Series members |

A stale `version` returns HTTP 409 with the current task so the client can snap back. A permission failure returns 403. Validation uses Zod schemas shared between client and server.

**Bulk schedule.** Used when several selected bars move together. The server checks every move before saving any: each must land inside its target window (plus the overflow allowance for tasks allowed to overflow), unless its stage ignores windows, and every version must be current. If any check fails, nothing is saved and the response names the failing tasks (409 for stale versions, 422 for window violations); moves are never clamped to fit. A valid request applies all the moves, runs one propagation pass from the moved tasks, and saves everything in one transaction under one batch id.

**Undo and redo.** Every action, together with the moves it propagated, shares one batch id. The undo button walks back through the current user's last 50 batches on the current series, and redo reapplies them; the endpoint enforces the same limit, so a user can only undo their own recent batches. An admin can undo any batch from the activity log page. In every case the server first checks that none of the batch's tasks has changed since; if one has, the undo is refused with those tasks named, rather than overwriting someone's later edit.

## Seed data from Rev 5

The seed script creates eSTEAM L2 as the first series, loads Rev 5 as its starting plan and first baseline, and saves the series' tracks, stages, durations and team labels as the first template, "Learner book series". The dates below are my reading of the diagram and should be checked against the source before import.

### Batches and key dates

| Batch | Books | Track | Generation and content review | InDesign | Post-layout review and correction | Printing | Binding |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | G9, G8, G7 | Image | Image review 1 to 2 Oct; overall review 9 to 14 Oct | 15 to 19 Oct | 20 to 21 Oct | 22 to 26 Oct | 27 to 28 Oct |
| 2 | G6, G5, G4 | Image | Image review 5 to 8 Oct; overall review 9 to 14 Oct | 22 to 26 Oct | 27 to 28 Oct | 29 Oct to 2 Nov | 3 to 4 Nov |
| 3 | G3, G2, G1 | Image | Image generation 5 to 8 Oct; image review 5 to 12 Oct; overall review 13 to 19 Oct | 29 Oct to 2 Nov | 3 to 4 Nov | 5 to 9 Nov | 10 to 11 Nov |
| 4 | KG2, KG1, N2 | Content | KG2 15 to 21 Oct; KG1 22 to 28 Oct; N2 29 Oct to 4 Nov | 5 to 9 Nov | 10 to 11 Nov | 12 to 16 Nov | 17 to 18 Nov |
| 5 | N1 | Content | Generation 5 to 9 Nov; review 10 to 11 Nov | 12 to 16 Nov | 17 to 18 Nov | 19 to 20 Nov | 23 to 24 Nov |

### Publishing dates for eSTEAM L2

With submission after internal review, every book still finishes by about 26 November, well inside the 15 December limit. Only batch 1 and N1 move, each by two to three working days.

| Batch | Submission (after internal review) | ISBN issued | Rev 5 printing | Effect |
| --- | --- | --- | --- | --- |
| 1: G9, G8, G7 | 15 Oct | 23 Oct | 22 to 26 Oct | Two books print 26 Oct; the third joins batch 2 in the 29 Oct window; binding ends 4 Nov instead of 28 Oct |
| 2: G6, G5, G4 | 15 Oct | 23 Oct | 29 Oct to 2 Nov | On time |
| 3: G3, G2, G1 | 20 Oct | 28 Oct | 5 to 9 Nov | On time |
| 4: KG2, KG1, N2 | KG2 22 Oct; KG1 29 Oct; N2 5 Nov | KG2 30 Oct; KG1 6 Nov; N2 13 Nov | 12 to 16 Nov | KG2 and KG1 on time; N2 prints 16 Nov using the buffer day, or 19 Nov |
| 5: N1 | 12 Nov | 20 Nov | 19 to 20 Nov | Prints 23 Nov; binding moves to the first reserve window and ends about 26 Nov |

Legal deposit deadlines then fall between 23 December 2026 (batches 1 and 2) and 20 January 2027 (N1). Those sit after the 15 December limit but never bind in practice: each deposit task is scheduled the working day after its book is bound, so the last deposit is due to go in around 27 November. If the agency turns out to accept manuscripts before internal review, the coordinator can switch the series to submit straight after content creation, which puts batch 1 and N1 back on their Rev 5 dates. Once real submission dates are entered, the app recalculates all of this itself.

### People

| Seeded as | Team label | Main Rev 5 assignments |
| --- | --- | --- |
| EdTech 1 | EdTech | Image review G9 to G7; image generation G3 to G1; content for KG2, KG1, N2 and N1 |
| EdTech 2, EdTech 3 | EdTech | Content for KG2 with EdTech 1 |
| Rev 1 | Reviewer | Image review G6 to G4; overall reviews G9 and G6; post-layout reviews in every batch |
| Rev 2 | Reviewer | Overall reviews G8, G7, G5; post-layout reviews in every batch |
| Rev 3 | Reviewer | Image review G3 to G1; overall reviews G1 to G3; post-layout reviews in every batch |
| Rev 4 | Reviewer | Content and images review for KG2, KG1, N2 and N1 |
| Designer 1, 2, 3 | Designer | One book per batch each, in the order shown in Rev 5 |
| Production Unit | Production | All printing; 2 books per working day, 22 copies per book (20 plus 2 for deposit) |
| External binder | Vendor (not a user) | All binding, tracked by Production |

People keep these placeholder names until the admin renames them and sends sign-in invites. Windows are imported as the 15 date bands from the Rev 5 header, plus reserve windows of one working week each from 25 November to 15 December (the first runs 25 to 27 November, the last 14 to 15 December), so slips have somewhere to land instead of becoming Unscheduled. Tasks that already run past their window in Rev 5, such as KG2's content restructure, are imported with overflow allowed.

## Non-functional requirements

| Area | Requirement |
| --- | --- |
| Performance | Matrix and swimlane load in under 1.5 seconds on a school broadband connection with about 110 tasks; a drop and its propagation return in under 800 ms from Vercel to Turso; dragging stays smooth (60 frames per second) up to 300 bars |
| Concurrency | Optimistic locking on every task and print record write; other open sessions see changes within 10 seconds through polling |
| Data safety | Every change recorded in the activity log with before and after values; Turso's backup and restore in production (confirm what the chosen plan includes); seed script can rebuild a clean database from Rev 5 |
| Security | HTTPS only; httpOnly, secure session cookies; emailed one-time codes expire after 10 minutes; role checks on every endpoint; rate limits of 5 failed sign-ins per email per 15 minutes (then a 15-minute lockout), 3 code or reset emails per email per hour, 5 attempts per one-time code, and 120 writes per user per minute; no learner data stored |
| Accessibility | WCAG 2.1 AA; every drag action has a keyboard and popover equivalent; status never shown by colour alone; visible focus ring |
| Devices | Latest Chrome, Edge, Firefox and Safari; full editing on desktop and tablet in landscape; matrix, my tasks and the drawer usable on phones; swimlane read-only on phones |
| Time zone | Africa/Accra; dates have no time component |
| Maintainability | Handed to the software unit with a README, a deployment and rollback runbook, and environment variable list; scheduler and permission logic covered by unit tests; drag flows covered by end-to-end tests; schema changes only through migrations |

## Delivery milestones

The build is split so the status matrix and my tasks are live by 14 October, a week before the first batch goes to print, with the full swimlane editor following on 23 October.

&#91;embedded content: MVP delivery roadmap · 5 phases, 4 gates\]

In text: Spec, 5 to 7 October, ending with the spec signed on 7 October; Foundation, 8 to 14 October, ending with go-live on 14 October; Swimlane, 15 to 23 October, ending with the editor live on 23 October; Workflow, 26 to 30 October, ending with the MVP complete on 30 October; then run support with fixes only from 2 November to 15 December, and phase 2 after the run.

Durations assume one developer working full time with AI-assisted coding, and include the general series model, which adds about a day to Foundation; the new-series wizard waits for phase 2. With less time, move the workload view and baselines out of the Workflow phase rather than delaying go-live, because a tracker that arrives after batch 2 prints has missed most of its value for this run.

## Assumptions and open questions

### Assumptions made in this spec

- The fonts and colour tokens are for the app's interface, not for this document.
- "Plus Jakarta" means Plus Jakarta Sans.
- "Rev" in Rev 5 means reviewer, as the diagram's legend states, and the filename's "Rev 5" means revision 5 of the plan.
- N1 sits in the Preschool grade group with N2 to KG2.
- One developer builds the MVP using AI-assisted coding; the software unit maintains it on Vercel after launch.
- Each person's capacity is one task at a time unless the admin changes it.
- The external binder does not log in; Production records binding progress. The app is general-purpose and nothing eSTEAM-specific is hard-coded; eSTEAM L2 is simply its first series. Rev 5 has no publishing slot, so each eSTEAM L2 book gets the publishing stages above, with submission, payment and registration handled by the project manager (coordinator); none of the books has an ISBN yet. Assumed: submission and payment take one working day; the agency works Monday to Friday; the 2 deposit copies are printed and bound in addition to the 20 per book without changing the Production Unit's capacity of 2 books per working day; and the hard limit for eSTEAM L2 is 15 December 2026.

### Open questions

- [x] Who are the real people behind EdTech 1 to 3, Rev 1 to 4 and Designer 1 to 3, and who is the coordinator with edit rights? Answer: The real names do not matter now. But they can be set by the admin/project manager later
- [x] What is the Production Unit's capacity (books per day and copies per book)? Rev 5 marks it "??". Answer: 2 books per day and 20 copies per book. But add an extra day for printer downtime or any unforeseen mishaps.
- [x] Is the target to use the app for this production run, or to have it ready for the next series? Answer: The current production run
- [x] Are the proposed neutral and status colours (danger, success, production) acceptable, or is there a brand palette for them? Answer: Yes, acceptable!
- [x] Should sign-in use Google Workspace accounts, email and password, or both? Answer: Email and Password, with OTP verification
- [x] Should time windows from Rev 5 be enforced (tasks cannot cross them) or stay as visual reference only? Answer: The time window should be enforced.
- [x] Where will it be hosted, and who maintains it after launch? Answer: Hosted on Vercel, maintained by software unit.
- [x] Do reviewers want to leave page-level feedback in the app, or keep using comments in Google Drive and link to them? Answer: Use comments in GD and link them. However, app may record the number of reviews made/pending as icon badges (just a thought)
- [x] Should print quantities and binding vendor details be tracked in the MVP or left for phase 2? Answer: Print quantities, etc should be tracked

* [x] Do the eSTEAM L2 books already have ISBNs, and who handles registration with the national ISBN agency? Answer: Nope. Project manager should handle the registration
