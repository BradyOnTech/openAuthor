# UI/UX Redesign: Apple-Inspired Clean Design with Light/Dark Mode

## Status Overview

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Theme Foundation (CSS tokens + theme toggle) | COMPLETED |
| Phase 2 | Layout Restructure + Navigation | COMPLETED |
| Phase 3 | Apple-Clean Component Styling | PENDING |
| Phase 4 | Polish + Accessibility | PENDING |

---

## Completed Work

### Phase 1: Theme Foundation

**Goal**: Establish light/dark mode variable architecture. No layout changes.

**What was done**:
- Rewrote `styles.css` `:root` variables into `[data-theme="light"]` and `[data-theme="dark"]` blocks
- Converted ~200 hardcoded color values to semantic CSS custom properties
- Added theme state management to `App.tsx`:
  - `loadDefaultTheme()` reads localStorage, falls back to `prefers-color-scheme`
  - `useState<Theme>` with localStorage persistence via `useEffect`
  - `toggleTheme()` function
  - Wrapped render in `<div className="app-shell" data-theme={theme}>`
  - Added temporary theme toggle button

**Design token system established**:
```css
:root {
  /* Fonts */
  --font-sans: -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif;
  --font-serif: "New York", "Iowan Old Style", "Book Antiqua", serif;
  --font-mono: "SF Mono", "Menlo", "Consolas", monospace;

  /* Spacing (8px grid) */
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px;
  --space-5: 20px; --space-6: 24px; --space-8: 32px; --space-10: 40px; --space-12: 48px;

  /* Radii */
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 14px; --radius-full: 999px;

  /* Font scale */
  --text-xs: 11px; --text-sm: 13px; --text-base: 15px; --text-lg: 17px;
  --text-xl: 20px; --text-2xl: 28px;

  /* Transitions */
  --duration-fast: 120ms; --duration-normal: 200ms; --duration-slow: 350ms;
}

[data-theme="light"] {
  --color-bg: #f5f5f7; --color-surface: #ffffff; --color-surface-raised: #ffffff;
  --color-surface-inset: #f0f0f2; --color-surface-hover: #e8e8ed;
  --color-text-primary: #1d1d1f; --color-text-secondary: #6e6e73; --color-text-tertiary: #aeaeb2;
  --color-border: rgba(0,0,0,0.08); --color-accent: #0071e3;
  --color-success: #248a3d; --color-warning: #b25000; --color-danger: #d70015;
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);
  /* ... more elevation shadows */
}

[data-theme="dark"] {
  --color-bg: #000000; --color-surface: #1c1c1e; --color-surface-raised: #2c2c2e;
  --color-text-primary: #f5f5f7; --color-text-secondary: #98989d; --color-text-tertiary: #636366;
  --color-border: rgba(255,255,255,0.1); --color-accent: #0a84ff;
  --color-success: #30d158; --color-warning: #ff9f0a; --color-danger: #ff453a;
  --shadow-sm: none; /* no shadows in dark mode */
}
```

**Verification**: 59 tests passing, TypeScript compiles cleanly, `make check` passes.

---

### Phase 2: Layout Restructure + Navigation

**Goal**: Replace 3-column layout with collapsible sidebar + full-width content. Replace tab bars with dropdowns.

**What was done**:

1. **New types** added to App.tsx (~line 137):
   ```typescript
   type CenterView = "editor" | "outliner" | "chat" | "review";
   type SidebarContent = "scenes" | "codex" | "context";
   type ViewMode = "write" | "plan" | "chat" | "review";
   type ReviewSection = "proposals" | "runs" | "checks" | "merge";
   ```

2. **New state** (~line 375):
   ```typescript
   const [sidebarOpen, setSidebarOpen] = useState(true);
   const [sidebarContent, setSidebarContent] = useState<SidebarContent>("scenes");
   const [settingsOpen, setSettingsOpen] = useState(false);
   const [voiceDrawerOpen, setVoiceDrawerOpen] = useState(false);
   ```

3. **Navigation helper**:
   ```typescript
   function navigateToPanel(tab: RightTab) {
     setRightTab(tab);
     if (tab === "codex") { setSidebarContent("codex"); setSidebarOpen(true); }
     else if (tab === "context") { setSidebarContent("context"); setSidebarOpen(true); }
     else { setCenterView("review"); }
   }
   ```

4. **Computed view values**:
   ```typescript
   const viewMode: ViewMode = centerView === "editor" ? "write" : ...;
   const reviewSection: ReviewSection = rightTab === "runs" ? "runs" : ...;
   const wordCount = useMemo(() => draft.body.trim().split(/\s+/).filter(Boolean).length, [draft.body]);
   ```

5. **Bulk replacement**: ~16 `setRightTab()` calls in handler code (lines 600-2700) replaced with `navigateToPanel()`

6. **Complete render rewrite** (~line 2858 to end):
   - `<div.app-shell>` wrapper
   - `<header.topbar>`: sidebar toggle, project name, view-mode dropdown, mic/gear/theme icons
   - `<div.app-body>`: `<aside.sidebar>` (collapsible, content dropdown for Scenes/Codex/Context) + `<main.content-area>`
   - Review mode: secondary dropdown for Proposals/Runs/Checks/Merge
   - Voice bar: collapsible drawer from mic icon
   - Project root input: settings popover from gear icon
   - `<footer.status-bar>`: branch, save status, word count, busy indicator

7. **New layout CSS** added to styles.css:
   ```css
   .app-shell { display: flex; flex-direction: column; height: 100vh; }
   .topbar { display: flex; align-items: center; gap: var(--space-3); padding: var(--space-2) var(--space-4); min-height: 48px; }
   .sidebar { width: 280px; flex-shrink: 0; transition: width var(--duration-slow) ease; }
   .sidebar.collapsed { width: 0; opacity: 0; pointer-events: none; }
   .content-area { flex: 1; min-width: 0; overflow: auto; padding: var(--space-4); }
   .status-bar { display: flex; align-items: center; justify-content: space-between; min-height: 28px; }
   ```

8. **Shortcuts updated** (`shortcuts.ts`):
   - Added: `toggle_sidebar`, `switch_write`, `switch_plan`, `switch_chat`, `switch_review`
   - Bindings: Cmd+B (sidebar), Cmd+1/2/3/4 (view modes)
   - Tests updated in `shortcuts.test.ts`

**Issues encountered & fixed**:
- Leftover old render code after Edit tool partial match (fixed with `head -n` truncation)
- TS2367 type narrowing error with codex edit card inside review ternary (moved outside)

**Feature mapping preserved**:

| View Mode | Content | Maps From |
|-----------|---------|-----------|
| Write | Scene editor (inline title + status pill, full-height textarea) | `centerView: "editor"` |
| Plan | Outliner (scene cards, status filters, branch ops) | `centerView: "outliner"` |
| Chat | Chat workspace (threads + messages + composer) | `centerView: "chat"` |
| Review | Secondary dropdown: Proposals / Runs / Checks / Merge | Right pane tabs |

| Sidebar | Content | Maps From |
|---------|---------|-----------|
| Scenes | Scene binder list + new scene form | `.binder` |
| Codex | Entity list grouped by type + CRUD | `rightTab: "codex"` |
| Context | Scene context dashboard, preferred pipeline | `rightTab: "context"` |

| Feature | Old Location | New Location |
|---------|-------------|--------------|
| Voice workspace | Always-visible bar | Collapsible drawer from mic icon |
| Project root input | Always-visible bar | Settings popover (gear icon) |
| Workspace health | Right pane Runs tab | Settings popover |
| Message/error display | Footer bar | Status bar (inline) |

**Verification**: 59 tests passing, TypeScript compiles cleanly, `make check` passes.

---

## Remaining Work

### Phase 3: Apple-Clean Component Styling (NEXT)

**Goal**: Apply the minimalist component style guide to all interactive elements.

**Files to change**:
- `desktop/src/styles.css` — Rewrite all component styles
- `desktop/src/App.tsx` — Update className usage to match new naming

**Component style guide to implement**:

#### Buttons
- **Ghost buttons** (default): transparent background, hover fills with `var(--color-surface-hover)`
- **Accent fill** for primary CTAs: `var(--color-accent)` background, white text
- **Icon buttons** for toolbar: compact, no border, subtle hover
- **Danger buttons**: `var(--color-danger)` for destructive actions
- Remove all existing colored backgrounds and thick borders from buttons

#### Inputs
- **Borderless** with subtle background fill (`var(--color-surface-inset)`)
- **Focus ring**: 2px `var(--color-accent)` outline
- **No visible borders** in resting state
- Textareas: same treatment, maximize writing area for editor

#### Cards
- **Light mode**: shadow elevation (`var(--shadow-sm)` or `var(--shadow-md)`)
- **Dark mode**: subtle border (`var(--color-border)`)
- **No dashed outlines** anywhere
- Clean, minimal padding following 8px grid

#### Lists
- **No borders between items**
- **Generous padding** (at least `var(--space-3)` vertical)
- **Subtle hover**: background change to `var(--color-surface-hover)`
- **Selected state**: accent tint background
- Scene list items, codex entity list, proposal list, etc.

#### Dropdowns
- Custom-built from divs (already done in Phase 2)
- Shadow + border styling
- Click-outside to close (already done)
- Refine hover and active states

#### Status indicators / Pills
- Rounded (`var(--radius-full)`)
- Subtle background with matching text color
- Small size (`var(--text-xs)`)

#### Typography
- Weight and size hierarchy only
- No color overload (primary, secondary, tertiary text only)
- Headings: `var(--text-lg)` or `var(--text-xl)`, font-weight 600
- Body: `var(--text-base)`, font-weight 400
- Meta/labels: `var(--text-sm)`, `var(--color-text-secondary)`

#### Specific removals
- All dashed borders (`border-style: dashed`)
- All colored/warm backgrounds (old beige palette remnants)
- Thick `border-left` indicators on cards
- Overly styled form elements
- Any remaining old-style color values not using CSS variables

#### Editor area
- Maximize writing area: minimal chrome around the textarea
- Editor title bar: inline minimal bar with title + status pill
- Full-height textarea with generous padding
- POV/summary accessible via expand chevron (already in Phase 2 render)

**Verification**: Visual review in both themes. All interactive states work. `make test-desktop`.

---

### Phase 4: Polish + Accessibility

**Goal**: Transitions, responsive behavior, keyboard navigation, ARIA attributes.

**Files to change**:
- `desktop/src/styles.css` — Transition rules, responsive breakpoints, focus styles
- `desktop/src/App.tsx` — ARIA attributes, keyboard handlers, localStorage persistence

**Work items**:

#### Transitions
- Smooth sidebar open/close animation
- View mode switch transitions (crossfade or slide)
- Dropdown open/close animations
- Settings popover and voice drawer transitions
- Use `var(--duration-fast)`, `var(--duration-normal)`, `var(--duration-slow)` consistently

#### Responsive behavior
- Sidebar auto-collapses below 768px viewport width
- Content area fills full width when sidebar collapsed
- Topbar adapts (possibly hide project name, shrink gaps)
- Status bar stacks or truncates on narrow viewports

#### Keyboard navigation
- Dropdown items navigable with arrow keys
- Escape closes open dropdowns/popovers
- Tab order follows visual layout
- View mode shortcuts already work (Cmd+1/2/3/4 from Phase 2)

#### ARIA attributes
- `role="navigation"` on sidebar
- `role="main"` on content area
- `aria-expanded` on collapsible elements (sidebar, drawers, dropdowns)
- `aria-selected` on active list items
- `aria-label` on icon-only buttons
- `role="status"` on status bar

#### Motion preferences
- `@media (prefers-reduced-motion: reduce)` — disable all transitions
- Respect system-level motion settings

#### State persistence
- Persist sidebar open/closed state to localStorage
- Persist sidebar content selection to localStorage
- Already persisting: theme (from Phase 1)

**Verification**: Keyboard-only navigation test. Screen reader audit. Responsive at 768px and 1024px breakpoints. `make test-desktop`.

---

## Critical Files Reference

| File | Role |
|------|------|
| `desktop/src/styles.css` | All styling — tokens, layout, components |
| `desktop/src/App.tsx` | Monolithic React component (~4548 lines) — state, handlers, render |
| `desktop/src/shortcuts.ts` | Keyboard shortcut resolver |
| `desktop/src/shortcuts.test.ts` | Shortcut tests |
| `desktop/src/types.ts` | Shared TypeScript interfaces (unchanged) |
| `desktop/src/api.ts` | Tauri command wrappers (unchanged) |

## Test Status

- 59 tests passing (vitest)
- TypeScript compiles cleanly
- `make check` passes (repo integrity + no-mock audit)
