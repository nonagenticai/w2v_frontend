# Premium UI Redesign: Dark-First Glassmorphism

**Date:** 2026-03-02
**Approach:** Full component library rebuild
**Aesthetic:** Dark-first, frosted glass panels, teal/cyan accent, icon-rail sidebar

---

## Problem Statement

The frontend has 50+ hardcoded light-mode colors (`bg-white`, `bg-slate-*`, `text-slate-*`) that bypass the semantic token system. Dark mode is unusable: inputs render white backgrounds with white text, the sidebar stays white, and wizard pages are nearly unreadable. Beyond the bug fixes, the overall aesthetic reads as "generic SaaS starter template" rather than a premium video production tool.

## Design Decisions

- **Dark-first:** Default theme is dark. Light mode is secondary but fully supported.
- **Teal/cyan accent** replaces sky-blue. More distinctive, pairs well with dark glass.
- **Glassmorphism:** All surface elements use `backdrop-filter: blur()` with semi-transparent backgrounds.
- **Icon-rail sidebar:** 56px collapsed, 240px expanded on hover. Maximizes content area.
- **Component rebuild:** Every UI component rebuilt with the design system enforced. No hardcoded colors.

---

## 1. Design System Foundation

### Color Tokens

```css
/* Dark theme (default) */
[data-theme='dark'] {
	/* Background layers */
	--color-background: #0a0f1a;
	--color-surface: rgba(15, 23, 42, 0.7);
	--color-surface-raised: rgba(30, 41, 59, 0.6);
	--color-surface-overlay: rgba(30, 41, 59, 0.85);

	/* Primary (teal/cyan) */
	--color-primary-50: #042f2e;
	--color-primary-100: #083344;
	--color-primary-200: #155e75;
	--color-primary-300: #0e7490;
	--color-primary-400: #22d3ee;
	--color-primary-500: #06b6d4;
	--color-primary-600: #0891b2;
	--color-primary-700: #0e7490;
	--color-primary-800: #155e75;
	--color-primary-900: #164e63;
	--color-primary-950: #083344;

	/* Text hierarchy */
	--color-text: #f1f5f9;
	--color-text-secondary: #94a3b8;
	--color-text-muted: #475569;
	--color-text-on-primary: #0a0f1a;

	/* Borders */
	--color-border: rgba(148, 163, 184, 0.12);
	--color-border-hover: rgba(148, 163, 184, 0.25);
	--color-border-focus: rgba(6, 182, 212, 0.5);

	/* Inputs */
	--color-input-bg: rgba(15, 23, 42, 0.5);
	--color-input-hover: rgba(15, 23, 42, 0.7);

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

	/* Glow effects */
	--glow-primary: 0 0 20px rgba(6, 182, 212, 0.15);
	--glow-success: 0 0 20px rgba(74, 222, 128, 0.15);
	--glow-error: 0 0 20px rgba(248, 113, 113, 0.15);

	color-scheme: dark;
}

/* Light theme */
[data-theme='light'] {
	--color-background: #f8fafc;
	--color-surface: rgba(255, 255, 255, 0.8);
	--color-surface-raised: rgba(255, 255, 255, 0.9);
	--color-surface-overlay: rgba(255, 255, 255, 0.95);

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

	--color-text: #0f172a;
	--color-text-secondary: #475569;
	--color-text-muted: #94a3b8;
	--color-text-on-primary: #ffffff;

	--color-border: rgba(15, 23, 42, 0.08);
	--color-border-hover: rgba(15, 23, 42, 0.15);
	--color-border-focus: rgba(6, 182, 212, 0.5);

	--color-input-bg: rgba(248, 250, 252, 0.8);
	--color-input-hover: rgba(241, 245, 249, 0.9);

	--glow-primary: 0 0 20px rgba(6, 182, 212, 0.1);
	--glow-success: 0 0 20px rgba(34, 197, 94, 0.1);
	--glow-error: 0 0 20px rgba(239, 68, 68, 0.1);

	color-scheme: light;
}
```

### Glass Utility Classes

```css
.glass {
	backdrop-filter: blur(16px) saturate(150%);
	-webkit-backdrop-filter: blur(16px) saturate(150%);
}

.glass-subtle {
	backdrop-filter: blur(8px) saturate(120%);
	-webkit-backdrop-filter: blur(8px) saturate(120%);
}
```

### Typography Scale

| Role    | Classes                                        |
| ------- | ---------------------------------------------- |
| Display | `text-2xl font-semibold tracking-tight`        |
| Heading | `text-lg font-semibold`                        |
| Subhead | `text-base font-medium`                        |
| Body    | `text-sm font-normal leading-relaxed`          |
| Caption | `text-xs font-medium uppercase tracking-wider` |
| Mono    | `text-sm font-mono`                            |

### Transition Standard

All interactive elements: `transition-all duration-200 ease-out`

---

## 2. Component Library

### 2.1 Layout

#### Sidebar (Icon Rail)

- **Collapsed:** 56px wide, icon-only, glass surface
- **Expanded:** 240px on hover, labels + count badges appear, 200ms width transition
- **Active item:** Teal left border accent + subtle teal glow background
- **Inactive item:** `text-secondary`, hover brightens to `text`
- **Mobile:** Full overlay with glass backdrop, close on outside click
- **Bottom:** Settings icon + version string

#### Header

- 48px height, glass surface spanning content area
- Left: page title (breadcrumb-ready)
- Right: theme toggle, health status indicator
- Mobile: hamburger menu button added

#### PageContainer

- Passes through to page content, no extra padding
- Content area: `ml-14` (rail collapsed) transitioning to `ml-60` (rail expanded)

### 2.2 Core UI Components

#### Button

| Variant     | Style                                                                 |
| ----------- | --------------------------------------------------------------------- |
| `primary`   | Solid teal fill, `text-on-primary`, glow on hover, slight scale(1.02) |
| `secondary` | Glass surface + border, teal text, border brightens on hover          |
| `ghost`     | Transparent, `text-secondary`, bg-surface on hover                    |
| `danger`    | Red fill, white text, red glow on hover                               |

All: rounded-lg, 200ms transitions, disabled = 40% opacity, loading = spinner replaces text.

#### Input

- `input-bg` background, subtle border
- Focus: teal border-focus ring with glow
- Error: red glow border + error message below
- Label above in `text-secondary`, caption weight
- Icon slot (left)

#### Select (Custom Dropdown)

- Trigger: same styling as Input with chevron icon
- Dropdown panel: glass `surface-raised`, positioned below trigger
- Options: hover = `surface-overlay`, active = teal text + left accent
- Replaces native `<select>` for full theme control

#### Card

- Glass surface + blur, subtle border
- Hover (clickable): border brightens + `box-shadow: var(--glow-primary)`
- Padding: p-5 standard

#### Badge

| Variant   | Style                                   |
| --------- | --------------------------------------- |
| `default` | Glass, muted border, secondary text     |
| `success` | Green-tinted glass, green text + border |
| `warning` | Amber-tinted glass                      |
| `error`   | Red-tinted glass                        |
| `info`    | Blue-tinted glass                       |

Pill shape (rounded-full), `text-xs font-medium`.

#### Modal

- Glass `surface-raised` panel, centered
- Dark overlay behind (50% opacity black)
- Entry: scale(0.95) + opacity 0 -> scale(1) + opacity 1, 150ms
- Close button: ghost style, top-right

#### Tabs

- Glass surface bar
- Active tab: teal underline + brighter text
- Inactive: muted text, hover brightens
- Count badges use Badge component

#### Toast

- Glass `surface-raised` panel
- Colored left accent bar (success=teal, error=red, warning=amber)
- Slide-in from top-right, 200ms
- Auto-dismiss with subtle progress bar

#### Toggle (new)

- Teal track when on, muted when off
- White thumb with smooth slide animation
- Extracted from inline implementations across wizard

#### Tooltip (new)

- Glass `surface-raised` small panel
- Used for icon-rail labels on hover
- Delay 300ms, 150ms fade-in

#### Spinner

- Teal ring with rotating glow trail
- Sizes: sm (16px), md (24px), lg (32px)

#### Pagination

- Ghost buttons, glass active state
- Teal active page number
- Chevron prev/next buttons

---

## 3. Domain Components

### 3.1 Pipeline Progress

- Stage nodes: glass circles connected by teal line
- Completed: solid teal fill + checkmark
- Running: pulsing teal ring animation
- Pending: dim border only
- Failed: red glow
- Progress bar: teal gradient fill, glow leading edge, glass track
- Below: current stage, duration, ETA in caption text

### 3.2 Job Card

- Glass card with hover glow
- Status: color-coded Badge pill
- Mini progress bar
- Deliverable indicators: small glass pills

### 3.3 Critique Scores

- SVG ring gauges with teal/gradient stroke
- Glow effect on score value
- Color by score: 80+ teal, 60-79 amber, <60 red
- Animate from 0 to value on mount (500ms ease-out)

### 3.4 Finding Cards

- Glass card, severity-colored left border
- Expand/collapse with smooth height animation
- Code blocks: `surface-raised` panel, mono font

### 3.5 Review Panels

- Glass cards with horizontal score bars
- Score bars: teal fill + glow, glass track
- Suggestions: teal accent bullets

### 3.6 Log Stream

- `surface-raised` container, mono font
- Stays deliberately dark in both themes
- Log level coloring: error=red, warn=amber, info=teal, debug=muted
- Auto-scroll with floating "jump to bottom" button

### 3.7 Video Player

- Glass controls overlay at bottom
- Teal progress bar with glow leading edge
- Chapter markers: teal dots on timeline
- Play/pause: glass circle with teal icon

---

## 4. Wizard Flow

### WizardShell

- Step indicator: glass pill bar with teal active dot + connecting line
- Glass content panel for current page

### ConfigurationPage

- Platform selector: glass cards, teal border when active
- Auth/crawl sections: glass panels with Toggle component
- All inputs use rebuilt Input/Select

### PurposePage

- DeliverableCards: glass panels with teal glow when enabled
- Toggle component for sub-options
- Category pills use Badge

### SettingsPage

- Accordion sections: glass panels with chevron
- All native selects replaced with custom Select
- Sliders: teal accent track

### SettingsSummary

- Review panel: glass card with section dividers
- Edit buttons: ghost Button variant
- Status dots: Badge component

---

## 5. Page Backgrounds

- Deep navy `#0a0f1a` with subtle radial gradient
- Teal glow at 5% opacity from top-right corner
- Creates depth perception behind glass panels

---

## 6. Component Inventory (41 files)

### Files to rebuild (complete rewrite):

**UI (12):** Button, Input, Select, Card, Badge, Modal, Tabs, Toast, ToastContainer, Spinner, Pagination, EmptyState

**New UI (3):** Toggle, Tooltip, Textarea

**Layout (3):** Sidebar, Header, PageContainer

**Wizard (7):** WizardShell, ConfigurationPage, PurposePage, SettingsPage, SettingsSummary, SourceRow, DeliverableCard

**Jobs (6):** JobCard, JobStatusBadge, LogStream, MobileProgress, PipelineProgress, StageDetail

**Critique (6):** BackendSecuritySection, FindingCard, FindingsList, ScoreCard, ScoreDashboard, SeverityBadge

**Reviews (4):** FeatureReviewPanel, ReviewPanel, ReviewScoreBar, SuggestionsPanel

**Video (2):** VideoPlayer, ChapterMarkers

**Dashboard (1):** StatsGrid

### Files to update (token changes only):

**CSS (1):** app.css (complete rewrite of theme tokens)

**HTML (1):** app.html (update default theme to dark)

**Layout root (1):** +layout.svelte (sidebar rail integration, content margin)

**Pages (6):** All +page.svelte route files for hardcoded colors

**Total: ~48 files touched**
