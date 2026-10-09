# bookflow

A web app for planning and tracking multi-book production runs, from writing and illustration through review, layout, printing and binding. Each run is a **series** with its own pipeline, team and dates. The first series is eSTEAM L2: 13 Level 2 learner books, replacing the static Rev 5 swimlane diagram.

The full product specification is in [spec.md](spec.md). This README covers what is built and how to work on it.

## What it does

| Page                                 | Who                         | What it's for                                                                                                                                                                    |
| ------------------------------------ | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Matrix `/s/[series]`                 | Everyone                    | Every book against every stage, with status, dates, late and at-risk flags, and the projected finish against the target date and hard limit                                      |
| Swimlane `/s/[series]/swimlane`      | Everyone; coordinators edit | The plan on a timeline. Drag to move, pull an edge to resize; successors move along and window rules are checked. Critical path toggle (C), Undo and Redo (Ctrl+Z, Ctrl+Shift+Z) |
| Workload `/s/[series]/workload`      | Everyone                    | Task days per person per working day against their capacity; click a cell to see its tasks                                                                                       |
| Book page `/s/[series]/books/[code]` | Everyone                    | ISBN, pipeline stepper, tasks with variance from the latest baseline, reviews, comments, print approval and print records                                                        |
| My tasks `/me`                       | Contributors and up         | Your open work across series, plus reviews waiting on you (approve or return)                                                                                                    |
| Baselines `/s/[series]/baselines`    | Admin, coordinator          | Save the plan as a baseline (Rev 5, Rev 6…) and see slippage per book and task                                                                                                   |
| Activity `/s/[series]/activity`      | Admin, coordinator          | Every change, newest first. Undo your own last 50 changes (admins any), and redo what you undid                                                                                  |
| Settings `/s/[series]/settings`      | Admin, coordinator          | Dates, print defaults, windows, the pipeline (tracks, stages, books, skips) and the team. Save the pipeline as a template                                                        |
| Templates `/templates`               | Admin                       | Saved pipelines new series start from                                                                                                                                            |
| New series `/series/new`             | Admin                       | Create a series from a template or a blank pipeline                                                                                                                              |
| People, Calendar `/settings/...`     | Admin                       | Invite and manage people; holidays that every series skips                                                                                                                       |

A guided tour starts on each person's first visit and can be replayed from **Tour** in the top bar. Its steps depend on the person's role.

**Roles** are held per series: admin (everything), coordinator (edits the schedule and series), contributor (their own tasks and reviews), viewer (read and comment). Sign-up is invite-only; sign-in is email and password followed by a 6-digit emailed code.

## Stack

SvelteKit 3 with Svelte 5 runes, Drizzle ORM on SQLite through libSQL, Better Auth (email OTP), zod, Resend for email, Vitest and Playwright. Deploys with the Vercel adapter.

## Getting started

You need Node 22 or later.

```sh
npm install
cp .env.example .env
```

Fill in `.env`:

| Variable             | Notes                                                                                          |
| -------------------- | ---------------------------------------------------------------------------------------------- |
| `DATABASE_URL`       | e.g. `file:./data/dev.db`                                                                      |
| `ORIGIN`             | the app's base URL, e.g. `http://localhost:5173`                                               |
| `BETTER_AUTH_SECRET` | 32+ random characters                                                                          |
| `RESEND_API_KEY`     | leave empty in development: emails, including sign-in codes, are printed to the server console |
| `EMAIL_FROM`         | sender address; its domain must be verified in Resend                                          |

Environment variables are declared in `src/env.ts` and read through `$app/env/private`. After adding one, run `npx svelte-kit sync`.

Create the database, load the seed series and start the app:

```sh
npm run db:migrate
npm run db:seed        # eSTEAM L2 from Rev 5, its baseline and the "Learner book series" template
npm run dev
```

The seed expects a freshly migrated, empty database.

Because sign-up is invite-only, the first admin needs an invite link issued from the command line. After seeding, invite the seeded admin:

```sh
npm run auth:invite -- "EdTech 1" you@example.com
```

Starting from an empty database instead (production, say), `--admin` creates you as the admin and prints your invite link. It only runs while the app has no active admin:

```sh
npm run auth:invite -- --admin "Your Name" you@example.com
```

Open the printed link, set a name and password, and confirm with the emailed code. The code appears in the dev server's console while `RESEND_API_KEY` is empty. For production, `npm run auth:invite:prod -- --admin "Your Name" you@example.com` runs the same script with `.env.production` (its `DATABASE_URL`, `DATABASE_AUTH_TOKEN` and `ORIGIN`). If the link expires before you use it, run the first form with your name to get a new one.

## Scripts

| Script                                    | Does                                                                                                           |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                             | Development server                                                                                             |
| `npm run build`, `npm run preview`        | Production build and preview                                                                                   |
| `npm run check`                           | Type-check with svelte-check                                                                                   |
| `npm run lint`, `npm run format`          | Prettier and ESLint                                                                                            |
| `npm run test:unit`                       | Vitest (scheduling, calendar, workload, activity wording, templates, tour)                                     |
| `npm run test:e2e`                        | Playwright against a production build                                                                          |
| `npm run db:generate -- --name <name>`    | Generate a migration after changing `schema.ts`                                                                |
| `npm run db:migrate`                      | Apply migrations                                                                                               |
| `npm run db:studio`                       | Browse the database                                                                                            |
| `npm run db:seed`                         | Seed eSTEAM L2                                                                                                 |
| `npm run auth:invite -- <person> <email>` | Issue an invite link without sending email; `--admin "<name>" <email>` creates the first admin on an empty app |

## Database changes

The schema lives in `src/lib/server/db/schema.ts`. Change it, generate a named migration with `npm run db:generate -- --name <what_changed>`, and apply it with `npm run db:migrate`. Commit the generated SQL and the files under `drizzle/meta`.

## Keeping it fast

In production every query is a network round trip to Turso, so round trips, not query size, decide how fast a page feels. Each response carries a `Server-Timing` header (`db`) with the number of round trips and their total time; see it in the browser's network panel.

- Read independent data in one `db.batch([...])`, and filter by series with joins rather than first fetching ids.
- Write with `writeAll([...])` from `src/lib/server/db/index.ts`: one round trip, applied all or nothing. Keep `db.transaction` for the few writes that must read inside the transaction (undo, pipeline restructuring).
- The current person and their series membership are looked up once per request (`currentPerson`, `requireMember`), sessions are cached in a signed cookie for 5 minutes, and holidays for 30 seconds.

To see it locally, run the dev server with `DB_SIMULATED_LATENCY_MS=15` to add a delay per round trip, and `DB_TRACE=1` to print each round trip's SQL.

## How it fits together

- **Working days.** Monday to Friday, minus the holidays set under Calendar. All scheduling counts working days (`src/lib/schedule/calendar.ts`).
- **Dependencies and propagation.** A task starts the next working day after its predecessor ends. Moving one pushes its successors; started and finished tasks never move (`src/lib/server/scheduler.ts`).
- **Windows.** A series can split its calendar into windows. A task belongs to the window it starts in and may run past its edge only by the series' overflow allowance. Window and rule changes show their impact before saving.
- **Activity, undo and redo.** Every change is written to `activity_log` with before and after values. One action and every task it pushed share a batch id, so it undoes as one. Undo and redo entries point at the batch they reverse (`reverts_batch_id`), and are refused, naming the tasks, if someone has changed them since (`src/routes/api/undo`, `src/lib/server/reapply.ts`, `src/lib/server/history.ts`).
- **Templates.** A template is a series' pipeline keyed by track and stage key, so it applies to any new series (`src/lib/templates/definition.ts`).

## Project layout

```
src/
  env.ts                  environment variables
  lib/
    schedule/             pure scheduling logic: calendar, critical path, workload, deadlines, patterns
    activity/             plain-language lines for activity log entries
    templates/            template definitions
    tour/                 guided tour steps
    components/           Swimlane, Tour
    server/               database access, permissions, validation and write logic
      db/                 schema, seed and invite scripts
  routes/
    (app)/                signed-in pages
    (auth)/               sign-in, invite and password reset
    api/                  JSON endpoints used by the pages
drizzle/                  migrations
spec.md                   product specification
```
