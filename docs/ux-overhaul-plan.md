# UX/UI overhaul plan

Source: Megumin's review of the live site (20 Nov 2026, 49 issues). Issue IDs (T1, P1, F1…) refer to
that review. Base: `origin/main` @ 0c59c8b (frontend identical to `release/anishows-rc` 5820c6f, which
is what anishows.com serves).

## Product idea

**The tracker built around tonight's episode.** Every screen answers "what do I watch next?".
Promise: *Never lose your place. Know what's on tonight.*

## Audit (what the code does today)

| Area | Today | Problem |
|---|---|---|
| Tokens | `index.css` `:root` + `@theme`; every surface/border is mixed with violet `#8b5cf6`; ~60 `bg-accent-dark` + ~150 hard-coded `purple/violet` classes | Generic violet look (V2); accent swapped per page from cover art (V1) |
| Cards | `AnimeCard` (home, browse grid, schedule, favourites, list tab) with its own list logic; `AnimeListRow`, `AnimeMinimalCard` (browse list/compact) with none | Hover-only quick add with 3 of 5 statuses, no feedback (T1/T6); hover `+` bumps progress silently (T3); no score/progress (T2); status dot missing in other views (B4) |
| List writes | `hooks/useListEntryMutation` (optimistic, rollback, server-normalised) used by the detail page; `AnimeCard` and Home hero re-implement it | Three code paths, only "Removed" has Undo |
| Detail | `StatusSelector` (compact sidebar variant) + pencil + heart, `ListEntryEditModal` with typed number boxes | Score invisible (T5), typed score/progress with browser tooltips (T4), button takes cover colour (V1), 36 px targets (M3) |
| Browse | `useBrowseAnimeList` keeps `placeholderData` = previous results across *search* changes | Old grid under the new "Results for…" heading (B1) |
| Profile | Overview reads `UserStats` (materialised, refreshed later by Celery); Stats reads live `lists/summary` | Two numbers for one stat (P1) |
| Routes | No `/list`; "My List" → profile overview | P2 |
| Nav | Desktop: no bell; mobile bar: Home/Browse/Schedule/Notifs/Account | N1, M5 |
| Toasts | `react-hot-toast` with inline styles, used ad hoc | No single toast component (T6) |

## Design system (step 1)

> Revised after owner feedback: the first direction (lime "Highlighter" + Big Shoulders display face)
> read as generic. The site now takes its look from oddava.me. The rules below are the shipped ones.

* **Colour.** Slate ink surfaces (`#15181d` page, `#1b1f25` panels, up to `#2f3640`; no violet tint).
  Text `#e6e9ee` / `#a3abb6` / `#7d8591` (AA on every surface). One accent, periwinkle `#8db1ff`, for
  primary actions, links, focus and "tonight"; slate text on accent fills.
* **No lines.** No hairline dividers, borders, rules, underline indicators or outlined controls.
  Sections sit on soft raised panels (`.panel`); active tabs, days and segments use a soft fill
  (`bg-white/[0.07]`); inputs use a soft fill. Links are plain accent text, never underlined. No
  decorative marks. Empty states are a sentence and an action, no icon art.
* **Fixed status colours** (dots, chips, tabs, charts; never cover-derived): Watching `#86cc90`,
  Completed `#b8a5ff`, Planning `#a3abb6`, On hold `#e9c46a`, Dropped `#f391ba`. Cover colour only
  tints backdrops. In rows the status shows as a soft chip with its word ("Watching").
* **One label per status**: Watching, Completed, On hold, Dropped, **Planning** (API value stays
  `Plan to Watch`). Sentence case everywhere ("My list", "Most popular").
* **Type.** DM Sans everywhere (as on oddava.me), self-hosted via `@fontsource-variable/dm-sans`
  (no third-party request; replaced Google-hosted Inter). Page titles 650 weight, tight tracking.
* **Space / radii / elevation / motion** tokens: 4 px spacing grid; radii 6/10/14; two shadows;
  `--dur-fast 150ms`, `--dur-base 200ms`, `--dur-slow 250ms`, one ease-out curve; everything off under
  `prefers-reduced-motion`.
* **Shared components** (`src/components/ui/`): `StatusDot`, `StatusMenu` (popover on pointer, bottom
  sheet on touch), `QuickAdd`, `ProgressStepper`, `ScorePicker`, `toast` helpers (`notifyListChange`
  with Undo), `Skeleton`, `BottomSheet`, `Badge`, `EmptyState`.
* **One card** (`AnimeCard`): status dot, your score, progress, quick add, stepper on Watching shelves.
  All list writes go through `useListEntryMutation`, which now raises the toast with Undo.

## Fix order

First (must land): 1 skeletons / no 404 flash / stale search (F1, B1) · 2 quick add + toast + Undo
(T1, T6) · 3 your score on detail (T5) · 4 one stats calculation (P1) · 5 safe stepper (T3) ·
6 forums on the dark layout (C1) · 7 character/staff image placeholders (D1).

Next: 8 list badges, dense table, tap scoring, steppers (T2, T4) · 9 onboarding (A1) · 10 Continue
home, recommendations exclude listed shows (L2) · 11 `/list` library + desktop bell (P2, N1, M5) ·
12 mobile spacing, 44 px targets, bottom sheets (M1–M4) · 13 fixed status colours, one label (V1, T7) ·
14 auth polish (A2–A7).

Later, if time allows: 15 landing + identity (L1, V2, V3) · 16 share previews / real 404 (F2) ·
17 settings cleanup (N2, N4–N6, B6) · 18 browse filters (B2–B5), detail layout (D2, D3).

## Verification

Local stack only (isolated compose project, DB cloned from the dev volume, no Celery so nothing syncs
from AniList). Screens at 1440×900 and 390×844, guest and signed in, in `docs/ux-overhaul/screens/`.
Tests: `npm run test:run`, `npm run lint`, backend `pytest` for touched apps.
