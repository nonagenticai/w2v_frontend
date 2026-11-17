# Premium UI Redesign Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild the w2v frontend as a dark-first glassmorphism UI with teal/cyan accent, icon-rail sidebar, and fully theme-aware components.

**Architecture:** Replace all 50+ hardcoded light-mode colors with semantic tokens. Rebuild every UI component with glass effects. New sidebar as collapsible icon rail. Custom Select dropdown replacing native `<select>`. Three new components (Toggle, Textarea, Tooltip).

**Tech Stack:** SvelteKit 5 (runes: `$props`, `$bindable`, `$state`, `$derived`, `$effect`, snippets), Tailwind CSS 4 (`@theme` tokens), lucide-svelte icons, `backdrop-filter` for glass.

**Verification:** After every task: `npx svelte-check --tsconfig ./tsconfig.json` + `bun run build`

---

## Dependency Graph

```
Phase 1 (tokens + CSS) ──→ Phase 2 (core UI) ──┬→ Phase 3 (layout)     ─┐
                                                 ├→ Phase 4 (wizard)     ─┤
                                                 ├→ Phase 5 (jobs)       ─├→ Phase 9 (pages) → Phase 10 (verify)
                                                 ├→ Phase 6 (critique)   ─┤
                                                 ├→ Phase 7 (reviews)    ─┤
                                                 └→ Phase 8 (video)      ─┘
```

**Phases 3-8 are independent and can run in parallel.**

---

## Phase 1: Design System Foundation

### Task 1: Rewrite app.css with new token system

**Files:**

- Modify: `src/app.css`

**Step 1: Replace the entire app.css**

Replace all content with the dark-first token system. Key changes:

- Background layers: `background`, `surface` (glass), `surface-raised`, `surface-overlay`
- Primary palette: teal/cyan (#06b6d4 family) replacing sky-blue (#0ea5e9)
- New tokens: `input-bg`, `input-hover`, `border-hover`, `border-focus`, `text-on-primary`
- Glass utility classes: `.glass`, `.glass-subtle`
- Glow effects: `--glow-primary`, `--glow-success`, `--glow-error`
- Light theme as secondary (`[data-theme="light"]`)
- Subtle radial gradient on body for depth

```css
@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

@import 'tailwindcss';

@theme {
	/* Primary (teal/cyan) — shared between themes */
	--color-primary-50: #ecfeff;
	--color-primary-100: #cffafe;
	--color-primary-200: #a5f3fc;
	--color-primary-300: #67e8f9;
	--color-primary-400: #22d3ee;
	--color-primary-500: #06b6d4;
	--color-primary-600: #0891b2;
	--color-primary-700: #0e7490;
	--color-primary-800: #155e75;
	--color-primary-900: #164e63;
	--color-primary-950: #083344;

	/* Semantic surface tokens (dark default) */
	--color-background: #0a0f1a;
	--color-surface: #111827;
	--color-surface-raised: #1e293b;
	--color-surface-overlay: #1e293bda;
	--color-border: #1e293b;
	--color-border-hover: #334155;
	--color-border-focus: #06b6d480;
	--color-text: #f1f5f9;
	--color-text-secondary: #94a3b8;
	--color-text-muted: #475569;
	--color-text-on-primary: #0a0f1a;

	/* Inputs */
	--color-input-bg: #0f172a80;
	--color-input-hover: #0f172ab3;

	/* Status */
	--color-status-pending: #fbbf24;
	--color-status-running: #22d3ee;
	--color-status-completed: #4ade80;
	--color-status-failed: #f87171;
	--color-status-cancelled: #9ca3af;

	/* Severity */
	--color-severity-critical: #f87171;
	--color-severity-high: #fb923c;
	--color-severity-medium: #fbbf24;
	--color-severity-low: #60a5fa;
	--color-severity-info: #9ca3af;

	/* Fonts */
	--font-sans: 'Inter', system-ui, sans-serif;
	--font-mono: 'JetBrains Mono', monospace;
}

/* Dark theme (default) */
[data-theme='dark'] {
	color-scheme: dark;
}

/* Light theme */
[data-theme='light'] {
	--color-background: #f8fafc;
	--color-surface: #ffffff;
	--color-surface-raised: #ffffff;
	--color-surface-overlay: #ffffffe6;
	--color-border: #e2e8f0;
	--color-border-hover: #cbd5e1;
	--color-border-focus: #06b6d480;
	--color-text: #0f172a;
	--color-text-secondary: #475569;
	--color-text-muted: #94a3b8;
	--color-text-on-primary: #ffffff;
	--color-input-bg: #f8fafc;
	--color-input-hover: #f1f5f9;

	--color-primary-50: #ecfeff;
	--color-primary-100: #cffafe;
	--color-primary-200: #a5f3fc;
	--color-primary-300: #67e8f9;
	--color-primary-400: #06b6d4;
	--color-primary-500: #0891b2;
	--color-primary-600: #0e7490;
	--color-primary-700: #155e75;
	--color-primary-800: #164e63;
	--color-primary-900: #083344;
	--color-primary-950: #042f2e;

	color-scheme: light;
}

/* Base styles */
body {
	@apply bg-background text-text font-sans antialiased;
}

/* Glass utility */
.glass {
	backdrop-filter: blur(16px) saturate(150%);
	-webkit-backdrop-filter: blur(16px) saturate(150%);
}

.glass-subtle {
	backdrop-filter: blur(8px) saturate(120%);
	-webkit-backdrop-filter: blur(8px) saturate(120%);
}

/* Scrollbar */
::-webkit-scrollbar {
	width: 6px;
	height: 6px;
}
::-webkit-scrollbar-track {
	background: transparent;
}
::-webkit-scrollbar-thumb {
	background: var(--color-text-muted);
	border-radius: 3px;
}
::-webkit-scrollbar-thumb:hover {
	background: var(--color-text-secondary);
}
```

**Step 2: Update app.html default theme to dark**

In `src/app.html`, change the fallback in the blocking script from `'light'` to `'dark'`:

```js
// Line 14: change fallback
name = window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
// Line 19: change catch fallback
document.documentElement.setAttribute('data-theme', 'dark');
```

**Step 3: Verify**

Run: `npx svelte-check --tsconfig ./tsconfig.json && bun run build`

**Step 4: Commit**

```bash
git add src/app.css src/app.html
git commit -m "feat: dark-first teal/cyan token system with glass utilities"
```

---

## Phase 2: Core UI Components

### Task 2: Rebuild Button component

**Files:**

- Modify: `src/lib/components/ui/Button.svelte`

**Changes:**

- `primary`: `bg-primary-500 text-text-on-primary hover:bg-primary-400` + glow on hover
- `secondary`: `bg-surface-raised border border-border text-primary-400 hover:border-border-hover`
- `ghost`: `text-text-secondary hover:text-text hover:bg-surface-raised`
- `danger`: `bg-status-failed text-white hover:bg-red-500`
- Add `transition-all duration-200` to all variants
- Focus ring: `focus:ring-border-focus` (teal glow)
- Remove all hardcoded `slate-*`, `white`, `bg-primary-600/700/800`

**Props interface unchanged** — same `variant`, `size`, `loading`, `disabled`, `href`, `download`, `type`, `children`, `onclick`, `class`.

**Verify:** `npx svelte-check --tsconfig ./tsconfig.json && bun run build`

### Task 3: Rebuild Input component

**Files:**

- Modify: `src/lib/components/ui/Input.svelte`

**Changes:**

- Replace `bg-white` with `bg-input-bg`
- Border: `border-border` default, `border-border-focus ring-2 ring-border-focus/20` on focus
- Error: `border-status-failed ring-status-failed/20`
- Placeholder: `placeholder:text-text-muted`
- Label: `text-text-secondary` (no change needed)
- Add `transition-all duration-200` to input
- Icon slot colors: `text-text-muted` (already correct)

**Props interface unchanged.**

### Task 4: Rebuild Select component (custom dropdown)

**Files:**

- Modify: `src/lib/components/ui/Select.svelte`

**Changes — option A (simple, keeps native `<select>`):**

- Replace `bg-white` with `bg-input-bg`
- Border/focus same as Input
- Chevron: `text-text-muted`

**Note:** The design calls for a custom dropdown but this can be deferred. For now, fix the colors to match the token system. A custom dropdown component can be added later as enhancement.

**Props interface unchanged.**

### Task 5: Rebuild Card component

**Files:**

- Modify: `src/lib/components/ui/Card.svelte`

**Changes:**

- Base: `bg-surface border border-border rounded-xl` (upgrade from rounded-lg)
- Add `glass` class for backdrop-filter
- Hover (when `hover` prop): `hover:border-border-hover hover:shadow-[0_0_20px_rgba(6,182,212,0.08)]` (subtle teal glow)
- Remove hardcoded `hover:border-slate-300 hover:bg-slate-50`

### Task 6: Rebuild Badge component

**Files:**

- Modify: `src/lib/components/ui/Badge.svelte`

**Changes:**

- `default`: `bg-surface-raised text-text-secondary border border-border`
- `success`: `bg-status-completed/15 text-status-completed border border-status-completed/20`
- `warning`: `bg-status-pending/15 text-status-pending border border-status-pending/20`
- `error`: `bg-status-failed/15 text-status-failed border border-status-failed/20`
- `info`: `bg-status-running/15 text-status-running border border-status-running/20`
- Add subtle border to all variants for glass aesthetic

### Task 7: Rebuild Modal component

**Files:**

- Modify: `src/lib/components/ui/Modal.svelte`

**Changes:**

- Dialog: `bg-surface-raised border border-border rounded-xl shadow-2xl glass`
- Backdrop: `backdrop:bg-black/70` (darker for contrast)
- Close button: `hover:bg-surface hover:text-text` (remove `hover:bg-slate-100`)
- Entry animation: add `scale` transition if possible (CSS-only via `::backdrop` and dialog open state)

### Task 8: Rebuild Tabs component

**Files:**

- Modify: `src/lib/components/ui/Tabs.svelte`

**Changes:**

- Active tab: `text-primary-400 border-primary-400` (teal)
- Inactive: `text-text-secondary hover:text-text border-transparent`
- Count badge active: `bg-primary-500/15 text-primary-400`
- Count badge inactive: `bg-surface-raised text-text-secondary`
- Remove `bg-primary-50`, `bg-slate-100`

### Task 9: Rebuild Toast and ToastContainer

**Files:**

- Modify: `src/lib/components/ui/Toast.svelte`
- Modify: `src/lib/components/ui/ToastContainer.svelte`

**Toast changes:**

- Container: `bg-surface-raised border glass rounded-xl shadow-lg`
- Close button: `hover:bg-surface hover:text-text` (remove `hover:bg-slate-100`)
- Keep existing variant border colors (they use status tokens, already good)

**ToastContainer:** No changes needed (positioning only).

### Task 10: Rebuild Spinner, Pagination, EmptyState

**Files:**

- Modify: `src/lib/components/ui/Spinner.svelte`
- Modify: `src/lib/components/ui/Pagination.svelte`
- Modify: `src/lib/components/ui/EmptyState.svelte`

**Spinner:** Change SVG `fill="currentColor"` to use `text-primary-400`. Add `drop-shadow` for glow trail.

**Pagination:**

- Active page: `bg-primary-500 text-text-on-primary`
- Inactive: `text-text-secondary hover:bg-surface-raised hover:text-text`
- Remove `hover:bg-slate-100`

**EmptyState:** Already uses semantic tokens. No changes needed.

### Task 11: Create Toggle component (new)

**Files:**

- Create: `src/lib/components/ui/Toggle.svelte`
- Modify: `src/lib/components/ui/index.ts` (add export)

**Props interface:**

```typescript
{
  checked: boolean;           // $bindable
  label?: string;
  description?: string;
  disabled?: boolean;
  class?: string;
}
```

**Implementation:** Extract the toggle switch pattern from DeliverableCard/ConfigurationPage into reusable component. Teal track when on (`bg-primary-500`), muted when off (`bg-text-muted`). White thumb with smooth transition.

### Task 12: Commit Phase 2

```bash
git add src/lib/components/ui/
git commit -m "feat: rebuild core UI components with dark-first glass design system"
```

---

## Phase 3: Layout Components

### Task 13: Rebuild Sidebar as icon rail

**Files:**

- Modify: `src/lib/components/layout/Sidebar.svelte`

**Complete rewrite.** Key features:

- `width: 56px` collapsed (icon-only), `width: 240px` expanded on hover
- `transition-all duration-200 ease-out` for width
- Glass surface: `bg-surface/80 glass border-r border-border`
- Active item: left teal border accent (`border-l-2 border-primary-400`) + `bg-primary-500/10`
- Inactive: `text-text-secondary hover:text-text hover:bg-surface-raised`
- Logo: Film icon only when collapsed, + "w2v" text when expanded
- Labels hidden when collapsed via `overflow-hidden` + `opacity-0` with transition
- Bottom: Settings icon + version (hidden when collapsed)
- Replace `bg-white` and `hover:bg-slate-100`

**Props interface:** Same — `onnavigate?: () => void`

**Internal state:** Add `expanded = $state(false)` controlled by `onmouseenter`/`onmouseleave`

### Task 14: Update Header

**Files:**

- Modify: `src/lib/components/layout/Header.svelte`

**Changes:**

- Height: `h-12` (from h-14)
- Background: `bg-surface/80 glass border-b border-border`
- Already uses mostly semantic tokens — just verify no hardcoded colors remain
- Theme toggle and health indicator stay the same

### Task 15: Update PageContainer

**Files:**

- Modify: `src/lib/components/layout/PageContainer.svelte`

**Changes:** Minimal — just ensure it passes through without forcing padding. The `px-6 py-6` padding is fine.

### Task 16: Update +layout.svelte for icon rail

**Files:**

- Modify: `src/routes/+layout.svelte`

**Changes:**

- Content area: `ml-14` (56px rail) instead of `md:ml-64` (256px sidebar)
- The sidebar component handles its own expansion internally
- Mobile overlay: keep existing pattern but ensure glass backdrop
- Sign-in page: use `bg-background` (already does), update button to `bg-primary-500`

### Task 17: Commit Phase 3

```bash
git add src/lib/components/layout/ src/routes/+layout.svelte
git commit -m "feat: icon-rail sidebar with glass panels and dark layout"
```

---

## Phase 4: Wizard Components

### Task 18: Rebuild DeliverableCard

**Files:**

- Modify: `src/lib/components/wizard/DeliverableCard.svelte`

**Changes:**

- Enabled: `bg-surface border-primary-500/30 shadow-[0_0_15px_rgba(6,182,212,0.06)]`
- Disabled: `bg-surface border-border`
- Icon enabled: `bg-primary-500/15 text-primary-400`
- Icon disabled: `bg-surface-raised text-text-muted`
- Toggle: use new `<Toggle>` component (or inline with `bg-primary-500`/`bg-text-muted`)
- Remove all `bg-white`, `bg-slate-*`, `text-slate-*`

### Task 19: Rebuild SourceRow

**Files:**

- Modify: `src/lib/components/wizard/SourceRow.svelte`

**Changes:**

- Card: `bg-surface border border-border rounded-xl`
- Mode toggle: `bg-surface-raised` background, active mode `bg-surface text-text`
- Drag zone: `border-border-hover` default, `border-primary-500 bg-primary-500/5` on drag
- Remove button: `text-text-muted hover:text-status-failed hover:bg-surface-raised`
- All inputs use semantic Input styling
- Remove all `bg-white`, `bg-slate-*`, `border-slate-*`

### Task 20: Update ConfigurationPage

**Files:**

- Modify: `src/lib/components/wizard/ConfigurationPage.svelte`

**Changes (template only — script already uses wizard store):**

- Platform buttons inactive: `border-border bg-surface text-text-secondary hover:border-border-hover hover:bg-surface-raised`
- Platform description text: `text-text-muted` (not `text-slate-400`)
- Icon colors: `text-text-muted`
- Auth container: `bg-surface border border-border`
- Toggle switches: `bg-primary-500`/`bg-text-muted`
- Auth border accent: `border-primary-500/30`
- Credential info box: `bg-surface-raised`
- Crawl container: `bg-surface border border-border`
- Textarea: `bg-input-bg border-border` (not `bg-white`)
- Placeholder: `placeholder:text-text-muted`

### Task 21: Update PurposePage

**Files:**

- Modify: `src/lib/components/wizard/PurposePage.svelte`

**Changes:**

- Category buttons: `bg-surface-raised text-text-secondary` (inactive), `bg-primary-500/15 text-primary-400 border-primary-500/30` (active)
- Textarea placeholders: `placeholder:text-text-muted`
- Toggle switches: same as ConfigurationPage
- Remove `text-slate-400` from labels

### Task 22: Update SettingsPage

**Files:**

- Modify: `src/lib/components/wizard/SettingsPage.svelte`

**Changes (many scattered colors):**

- `inputClasses` variable: replace `bg-white` with `bg-input-bg`, `placeholder:text-text-muted`
- Accordion sections: `bg-surface border border-border`
- Section header hover: `hover:bg-surface-raised`
- Icon container: `bg-surface-raised text-text-muted`
- Chevron: `text-text-muted`
- Server config alert: `border-primary-500/30 bg-primary-500/10`
- Tier description text: `text-text-muted`
- Stage override containers: `bg-surface-raised`
- Stage group labels: `text-text-muted`
- Theme buttons inactive: `border-border bg-surface text-text-secondary hover:bg-surface-raised`
- Range labels: `text-text-muted`
- Device dropdown: use `bg-input-bg`

### Task 23: Update SettingsSummary

**Files:**

- Modify: `src/lib/components/wizard/SettingsSummary.svelte`

**Changes:**

- Summary container: `bg-surface border border-border`
- Section labels: `text-text-muted uppercase`
- Status dots: keep `bg-green-500` for enabled (or use `bg-status-completed`)
- Remove `bg-white`

### Task 24: Update WizardShell step indicator

**Files:**

- Modify: `src/lib/components/wizard/WizardShell.svelte`

**Changes:**

- Step circles completed: `bg-primary-500 text-text-on-primary`
- Step circles current: `border-2 border-primary-400 text-primary-400 bg-primary-500/10`
- Step circles future: `bg-surface-raised text-text-muted`
- Connector completed: `bg-primary-500`
- Connector future: `bg-border`
- Step text: use `text-text`, `text-primary-400`, `text-text-secondary` respectively
- Content panel: `bg-surface/50 border border-border rounded-xl glass-subtle`

### Task 25: Commit Phase 4

```bash
git add src/lib/components/wizard/
git commit -m "feat: wizard components with dark glass treatment"
```

---

## Phase 5: Jobs Components

### Task 26: Update JobCard

**Files:**

- Modify: `src/lib/components/jobs/JobCard.svelte`

**Changes:**

- Stage dots inactive: `bg-surface-raised` (not `bg-slate-200`)
- Progress percentage: `text-primary-400`
- Card hover already uses Card component

### Task 27: Update JobStatusBadge

**Files:**

- Modify: `src/lib/components/jobs/JobStatusBadge.svelte`

**Changes:**

- Fallback variant: `bg-surface-raised text-text-secondary` (not `bg-slate-100`)
- `paused`: `bg-purple-500/15 text-purple-400` (not `bg-purple-100 text-purple-700`)

### Task 28: Update LogStream

**Files:**

- Modify: `src/lib/components/jobs/LogStream.svelte`

**Changes:**

- Container: `border-border bg-surface-raised`
- Header: `bg-surface-raised border-b border-border`
- Header text: `text-text-secondary`
- Log area: `bg-background`
- Log text: `text-text-secondary`
- Line numbers: `text-text-muted`
- Buttons: `hover:text-text hover:bg-surface`
- Replace all `slate-700`, `slate-800`, `slate-900`, `slate-300` with semantic tokens

### Task 29: Update PipelineProgress

**Files:**

- Modify: `src/lib/components/jobs/PipelineProgress.svelte`

**Changes:**

- Running stage bg: `bg-status-running/5 border border-status-running/20` (already fine)
- Default connector: `bg-border` (already fine)
- Verify no `slate-*` colors remain

### Task 30: Update StageDetail and MobileProgress

**Files:**

- Modify: `src/lib/components/jobs/StageDetail.svelte`
- Modify: `src/lib/components/jobs/MobileProgress.svelte`

**StageDetail changes:**

- Error box: `bg-status-failed/10 border-status-failed/30`
- Error detail text: `text-status-failed`
- Service job ID: `bg-surface-raised border-border`
- Remove `bg-red-50`, `border-red-200`, `text-red-700`, `bg-slate-50`

**MobileProgress:** Already uses mostly semantic tokens. Verify no hardcoded colors.

### Task 31: Commit Phase 5

```bash
git add src/lib/components/jobs/
git commit -m "feat: jobs components with dark theme tokens"
```

---

## Phase 6: Critique Components

### Task 32: Update ScoreCard and ScoreDashboard

**Files:**

- Modify: `src/lib/components/critique/ScoreCard.svelte`
- Modify: `src/lib/components/critique/ScoreDashboard.svelte`

**ScoreCard changes:**

- Background track: `stroke-border` (not `stroke-slate-100/200`)
- Null score bg: `bg-surface-raised`
- Score >= 80 bg: `bg-status-completed/10` (not `bg-green-50/50`)
- Score 60-79 bg: `bg-status-pending/10`
- Score < 60 bg: `bg-status-failed/10`

**ScoreDashboard changes:**

- Same SVG stroke fixes
- Grade badge null: `bg-surface-raised text-text-muted`

### Task 33: Update FindingCard and FindingsList

**Files:**

- Modify: `src/lib/components/critique/FindingCard.svelte`
- Modify: `src/lib/components/critique/FindingsList.svelte`

**FindingCard changes:**

- Header hover: `hover:bg-surface-raised` (not `hover:bg-primary-50/50`)
- Recommendation box: `bg-primary-500/10 border-primary-500/20`
- Code selector: `text-primary-400 bg-primary-500/10 border-primary-500/20`
- Link: `text-primary-400 hover:text-primary-300`

**FindingsList changes:**

- Category buttons already use severity tokens — verify no hardcoded slate

### Task 34: Update SeverityBadge and BackendSecuritySection

**Files:**

- Modify: `src/lib/components/critique/SeverityBadge.svelte`
- Modify: `src/lib/components/critique/BackendSecuritySection.svelte`

**SeverityBadge:** Already uses severity tokens. No changes needed.

**BackendSecuritySection:**

- Low confidence badge: `bg-surface-raised text-text-secondary border-border` (not `bg-slate-100`)

### Task 35: Commit Phase 6

```bash
git add src/lib/components/critique/
git commit -m "feat: critique components with dark theme tokens"
```

---

## Phase 7: Reviews Components

### Task 36: Update ReviewPanel and ReviewScoreBar

**Files:**

- Modify: `src/lib/components/reviews/ReviewPanel.svelte`
- Modify: `src/lib/components/reviews/ReviewScoreBar.svelte`

**ReviewPanel changes:**

- SVG gauge background: `stroke-border`
- Long-term bullet: `bg-text-muted` (not `bg-slate-300`)
- Other bullets already use status tokens

**ReviewScoreBar changes:**

- Available tab: `border-border bg-surface hover:border-border-hover hover:bg-surface-raised`
- Disabled tab: `border-border/50 bg-surface-raised opacity-50`
- Remove `hover:bg-slate-50`, `hover:border-slate-300`, `bg-slate-50`

### Task 37: Update FeatureReviewPanel and SuggestionsPanel

**Files:**

- Modify: `src/lib/components/reviews/FeatureReviewPanel.svelte`
- Modify: `src/lib/components/reviews/SuggestionsPanel.svelte`

**Changes:** Mostly use Badge component. Verify no hardcoded slate colors in card containers.

### Task 38: Commit Phase 7

```bash
git add src/lib/components/reviews/
git commit -m "feat: review components with dark theme tokens"
```

---

## Phase 8: Video Components

### Task 39: Update VideoPlayer

**Files:**

- Modify: `src/lib/components/video/VideoPlayer.svelte`

**Changes:**

- Play overlay: `bg-surface/90` (not `bg-white/90`)
- Play icon: `text-primary-400` (not `text-primary-700`)
- Progress bar bg: `bg-surface-raised/50` (not `bg-white/20`)
- Buffered: `bg-surface/30`
- Active progress: `bg-primary-400`
- Button colors: `text-text hover:text-primary-300`
- Time display: `text-text-secondary`
- Volume accent: `accent-primary-400`
- Keep `bg-black` for video container and gradient overlay

### Task 40: Update ChapterMarkers

**Files:**

- Modify: `src/lib/components/video/ChapterMarkers.svelte`

**Changes:**

- Active: `bg-primary-500/10 border-primary-500/30 text-primary-400`
- Active badge: `bg-primary-500 text-text-on-primary`
- Inactive: `bg-surface border-border text-text`
- Inactive badge: `bg-surface-raised text-text-muted`
- Hover: `hover:border-border-hover hover:bg-surface-raised`
- Remove `bg-primary-50`, `border-primary-200`, `bg-slate-100`

### Task 41: Commit Phase 8

```bash
git add src/lib/components/video/
git commit -m "feat: video components with dark theme tokens"
```

---

## Phase 9: Pages & Dashboard

### Task 42: Update StatsGrid

**Files:**

- Modify: `src/lib/components/dashboard/StatsGrid.svelte`

**Changes:**

- Icon backgrounds: `bg-primary-500/15` (not `bg-primary-50`)
- Icons: `text-primary-400` (not `text-primary-600`)
- Completed icon bg: already uses status tokens
- Running icon bg: already uses status tokens

### Task 43: Update Dashboard page

**Files:**

- Modify: `src/routes/+page.svelte`

**Changes:**

- Cancelled status: `bg-surface-raised text-text-secondary` (not `bg-slate-100 text-slate-500`)
- Card hover: `hover:border-border-hover` (not `hover:border-primary-300`)
- Progress text: `text-primary-400`

### Task 44: Update Pipelines list page

**Files:**

- Modify: `src/routes/pipelines/+page.svelte`

**Same status badge pattern as dashboard. Replace all `bg-slate-100 text-slate-500`, `hover:border-primary-300`.**

### Task 45: Update Pipeline detail page

**Files:**

- Modify: `src/routes/pipelines/[id]/+page.svelte`

**Changes:**

- Back button hover: `hover:bg-surface-raised` (not `hover:bg-slate-100`)
- Error banner: `bg-status-failed/10 border-status-failed/30 text-status-failed`
- Remove `bg-red-50`, `border-red-200`, `text-red-700`
- Links: `text-primary-400`

### Task 46: Update remaining pages

**Files:**

- Modify: `src/routes/settings/+page.svelte`
- Modify: `src/routes/critique/+page.svelte`
- Modify: `src/routes/critique/[id]/+page.svelte`
- Modify: `src/routes/pipelines/[id]/video/+page.svelte`
- Modify: `src/routes/pipelines/[id]/report/+page.svelte`
- Modify: `src/routes/pipelines/[id]/reviews/+page.svelte`

**Settings page:**

- `inputClasses` variable: replace `bg-white` with `bg-input-bg`
- Status colors: `text-status-completed` (connected), `text-status-failed` (disconnected)

**Critique list:**

- List item hover: `hover:border-border-hover hover:bg-surface-raised` (not `hover:border-slate-300 hover:bg-slate-50`)

**All pages:** search for any remaining `bg-white`, `bg-slate-*`, `text-slate-*`, `border-slate-*` and replace with semantic tokens.

### Task 47: Commit Phase 9

```bash
git add src/lib/components/dashboard/ src/routes/
git commit -m "feat: all pages and dashboard with dark theme tokens"
```

---

## Phase 10: Verification & Polish

### Task 48: Full type check and build

Run: `npx svelte-check --tsconfig ./tsconfig.json`
Expected: 0 errors

Run: `bun run build`
Expected: Build succeeds

### Task 49: Grep for remaining hardcoded colors

Run a comprehensive search for any remaining hardcoded colors:

```bash
grep -rn 'bg-white\|bg-slate-\|text-slate-\|border-slate-\|hover:bg-slate\|bg-gray-\|text-gray-' src/ --include='*.svelte' --include='*.ts'
```

Fix any remaining instances. Exceptions allowed:

- `bg-black` in VideoPlayer (video container)
- `bg-white` in Spinner SVG (standard pattern)

### Task 50: Container build and smoke test

```bash
cd /Users/georgedekker/Movies/nonagenticai/w2v
docker compose build frontend
docker compose up -d frontend
sleep 3
# Test all pages
curl -s -o /dev/null -w "%{http_code}" http://localhost:6183/
curl -s -o /dev/null -w "%{http_code}" http://localhost:6183/pipelines/new
curl -s -o /dev/null -w "%{http_code}" http://localhost:6183/pipelines
curl -s -o /dev/null -w "%{http_code}" http://localhost:6183/settings
curl -s -o /dev/null -w "%{http_code}" http://localhost:6183/critique
curl -s -o /dev/null -w "%{http_code}" http://localhost:6183/api/config/status
```

All should return 200.

### Task 51: Final commit

```bash
git add -A
git commit -m "feat: complete premium UI redesign — dark-first glassmorphism with teal accent"
```
