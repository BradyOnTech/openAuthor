# openAuthor UI/UX Redesign Plan

## Aesthetic Direction: "Literary Noir"

**Concept**: A dark-first professional workspace where the writing surface *glows*. The
central editor area renders as a warm cream page floating in a sea of dark chrome — like
a manuscript illuminated under a desk lamp in a dark study. The surrounding tooling is
sharp, precise, and utilitarian (Cursor/VS Code DNA), while the writing surface itself
is warm, literary, and inviting.

**Signature moment**: In dark mode, the editor pane uses a warm cream background
(`#faf6f0`) against the surrounding charcoal UI. This "glowing page" effect is the
single most memorable visual element — it immediately communicates that this is a
*writing* tool, not a code editor wearing a novelist costume.

**Accent palette**: Warm amber/copper (`#c4841d`) replaces the generic blue. A secondary
muted teal (`#3d8b8b`) marks AI-specific elements. Status colors are desaturated and
warm (forest green, burnt orange, brick red) rather than neon.

---

## Layout Architecture

```
+------+-------------+------------------------------+--------------+
|      |   PRIMARY   |                              |  SECONDARY   |
|  AB  |   SIDEBAR   |        EDITOR AREA           |   SIDEBAR    |
| 48px |   280px     |     (flex, tabs, split)       |   360px      |
|      |  resizable  |                              |  toggleable  |
|      |             |                              |              |
+------+-------------+------------------------------+--------------+
|                    PANEL AREA (toggleable, 240px)                |
+-----------------------------------------------------------------+
|                         STATUS BAR (24px)                        |
+-----------------------------------------------------------------+
```

All panels are independently toggleable and resizable. The editor area always fills
remaining space. Zen mode hides everything except the editor.

---

## 1. Activity Bar (Left Edge)

A thin vertical strip (48px) anchored to the left window edge. Each icon toggles a
view in the Primary Sidebar. Only one view is active at a time (clicking the active
icon collapses the sidebar).

```
+------+
| [MS] |  ← Manuscript (scene tree)           Cmd+Shift+E
|      |
| [CX] |  ← Codex (entity browser)            Cmd+Shift+X
|      |
| [SR] |  ← Search (full-text project search)  Cmd+Shift+F
|      |
| [PR] |  ← Proposals (review queue)           Cmd+Shift+R
|      |
| [CK] |  ← Checks (continuity)               Cmd+Shift+C
|      |
|      |
|      |  ← spacer
|      |
| [ST] |  ← Settings (pinned to bottom)        Cmd+,
+------+
```

### Visual treatment
- Background: `--bg-base` (#111114 dark / #f5f1eb light)
- Icons: SVG, 20px, `--text-tertiary` default, `--text-primary` on hover
- Active icon: `--accent-primary` (amber) fill + 2px left border indicator
- Subtle separator line on the right edge
- Tooltip on hover: label + keyboard shortcut
- Badge dots: small colored circles (top-right of icon) for pending proposals count,
  check error count, etc.

### Behavior
- Click inactive icon → open sidebar to that view
- Click active icon → collapse sidebar (toggle)
- Right-click → context menu: "Move to Right" (swap sidebar side)
- Icons support drag-and-drop reordering (persist to localStorage)

---

## 2. Primary Sidebar (Left)

Width: 280px default (min 200, max 400, drag-to-resize via right edge).
Toggle: `Cmd+B`

Each Activity Bar selection renders a different sidebar panel. All panels share a
consistent structure:

```
+---------------------------+
| HEADER                [+] |  ← Title + primary action button
|---------------------------|
| [filter/search input]     |  ← Optional, per-view
|---------------------------|
|                           |
|  Scrollable list/tree     |
|                           |
|                           |
|                           |
+---------------------------+
```

### 2a. Manuscript Explorer

The primary navigation for scenes. Displays as a tree view.

```
+---------------------------+
| Manuscript           [+]  |
|---------------------------|
|  ▼ Act 1                  |
|    ● Chapter 1            |
|      ○ The Beginning  DFT |
|      ● The Journey    REV |
|    ● Chapter 2            |
|      ○ The Arrival    FNL |
|  ▶ Act 2                  |
|  ▶ Act 3                  |
+---------------------------+
```

- Tree structure: Acts → Chapters → Scenes (derived from scene metadata/ordering)
- Each scene item shows: title, status badge (DFT/REV/FNL as tiny monospace pill)
- Status dot colors: draft = amber, revised = teal, final = green
- Single click → open scene in editor (new tab or replace)
- Double click → open scene in a new tab (always)
- Drag-and-drop → reorder scenes
- Right-click context menu: Rename, Duplicate, Delete, Open in Split
- `[+]` button → New Scene form (inline at bottom of tree, not a modal)
- Inline rename on F2 or slow double-click on title

### 2b. Codex Browser

Entity browser organized by type.

```
+---------------------------+
| Codex                [+]  |
|---------------------------|
| [Search entities...]      |
|---------------------------|
| CHARACTERS (3)            |
|   ◆ Elena Vasquez         |
|   ◆ Marcus Chen           |
|   ◆ The Narrator          |
| LOCATIONS (2)             |
|   ◇ The Observatory       |
|   ◇ Market District       |
| LORE (1)                  |
|   ◈ The Founding Myth     |
+---------------------------+
```

- Grouped by type with collapsible headers: Characters, Locations, Lore, Items,
  Factions, Events
- Type icons: distinct shape per type (diamond, circle, hexagon, etc.)
- Search input filters across all types
- Click entity → open detail in editor area (as a tab, like opening a file)
- `[+]` → New Entity form (type selector + name input, inline)
- Entity items show name + description preview on hover tooltip

### 2c. Project Search

Full-text search across scenes and codex entries.

```
+---------------------------+
| Search                    |
|---------------------------|
| [Search manuscript...]    |
| ☑ Scenes  ☑ Codex        |
|---------------------------|
| 12 results for "Elena"    |
|                           |
|  the_beginning.md:14      |
|  "...Elena stepped into   |
|   the observatory..."     |
|                           |
|  market_scene.md:42       |
|  "...said Elena, turning  |
|   toward the door..."     |
+---------------------------+
```

- Search input with scope toggles (Scenes, Codex, Proposals)
- Results show: filename:line, context snippet with match highlighted
- Click result → open file and jump to line in editor
- Keyboard: Enter to search, Up/Down to navigate results, Enter to open

### 2d. Proposal Queue

AI-generated edit proposals with review workflow.

```
+---------------------------+
| Proposals  3 pending [+]  |
|---------------------------|
| Mode: [All ▾] [Pending ▾] |
|---------------------------|
| ● Deepen Elena's motive   |
|   scene_03 · 2m ago       |
|                           |
| ● Add market atmosphere   |
|   scene_07 · 15m ago      |
|                           |
| ○ Revise opening hook     |
|   scene_01 · applied      |
+---------------------------+
```

- Status dots: pending = amber, applied = green, rejected = red/dimmed
- Filter dropdowns: queue mode + status filter
- Click proposal → open in editor area with diff/review view
- `[+]` → Generate Proposal form (opens in editor area, not sidebar)
- Badge on Activity Bar icon shows pending count

### 2e. Continuity Checks

```
+---------------------------+
| Checks   2E 1W 3I  [Run] |
|---------------------------|
| ERRORS (2)                |
|   ✕ POV inconsistency     |
|     scene_03              |
|   ✕ Timeline conflict     |
|     scene_07, scene_08    |
| WARNINGS (1)              |
|   ▲ Unnamed character     |
|     scene_12              |
| INFO (3)                  |
|   ● Long scene (2400w)    |
|     scene_05              |
+---------------------------+
```

- Grouped by severity (errors first, then warnings, then info)
- Severity icons: ✕ (error/red), ▲ (warning/amber), ● (info/teal)
- Header shows counts per severity
- `[Run]` button triggers continuity check
- Click issue → open affected scene in editor + highlight issue

### 2f. Settings Panel

Opens configuration in the editor area (not a popover/modal). Settings are organized
as a scrollable form with sections:

- Project: name, root path
- AI Providers: provider selection, API key status, model defaults
- Budget: token/cost limits (inline editing)
- Editor: font size, line height, theme
- Voice: STT configuration
- Keyboard shortcuts: list with rebind support

---

## 3. Editor Area (Center)

The main workspace. Displays open scenes, codex entries, proposals, and settings as
tabbed editors. Supports split views.

### 3a. Tab Bar

```
+--[The Beginning]--[Elena Vasquez]--[Proposal: Deepen...]--+----+
|                                                            | ⋮  |
+------------------------------------------------------------+----+
```

- Tabs show document title + type icon (scene page icon, codex diamond, proposal
  sparkle)
- Close button (×) on each tab, visible on hover
- Active tab: bottom border in `--accent-primary` (amber)
- Middle-click to close, Cmd+W to close active
- Cmd+Tab / Ctrl+Tab to cycle tabs
- Drag tabs to reorder
- Tab overflow: horizontal scroll with chevron buttons
- Modified indicator: dot after title for unsaved changes
- Right-click context menu: Close, Close Others, Close All, Split Right, Split Down

### 3b. Breadcrumbs

Below the tab bar, a single-line breadcrumb trail:

```
Project Name  ›  Act 1  ›  Chapter 2  ›  The Arrival
```

- Each segment is clickable → dropdown showing siblings at that level
- Monospace font for IDs/paths, sans-serif for titles
- Dim styling (`--text-tertiary`), unobtrusive

### 3c. Scene Editor (Writing Surface)

The core writing experience. This is where the "glowing page" concept lives.

```
+------------------------------------------------------------+
| [breadcrumbs]                                              |
|------------------------------------------------------------|
|                                                            |
|         The Beginning                                      |
|         ─────────                                          |
|                                                            |
|         Elena stepped into the observatory just as         |
|         the last sliver of sun vanished below the          |
|         horizon. The copper dome overhead caught the        |
|         dying light and held it, amber and warm, for       |
|         one breath longer than the sky outside.            |
|                                                            |
|         She set her bag on the stone bench and             |
|         looked up.                                         |
|                                                            |
|                                                            |
+------------------------------------------------------------+
```

**Typography**:
- Font: Literata (Google Fonts) — a literary serif designed for extended reading
- Size: 17px, line-height: 1.8
- Color: `--editor-text` (#1a1815 dark theme / #1a1815 light theme)
- Title: 24px Literata bold, with a thin horizontal rule beneath

**Layout**:
- Background: `--editor-bg` (#faf6f0 in dark mode — warm cream; #ffffff in light mode)
- Max content width: 680px, centered horizontally with generous margins
- Vertical padding: 48px top, generous bottom padding
- The warm background extends full-width of the editor pane, but text is constrained

**Behavior**:
- Auto-save after 2s of inactivity (status bar shows save state)
- Word count in status bar (updates live)
- No visible toolbar — formatting through markdown syntax
- Scene title is an editable h1 at the top
- Metadata (status, POV, summary) accessible via Inspector (secondary sidebar)

### 3d. Split Editor

The editor area can be split into 2 panes (horizontal or vertical).

- `Cmd+\` → split right (vertical)
- `Cmd+Shift+\` → split down (horizontal)
- Drag a tab to the edge of the editor area to create a split
- Each pane has its own tab bar
- Panes are resizable via drag handle between them
- Use cases: scene + codex entry, two scenes side by side, scene + proposal review

### 3e. Proposal Review View

When a proposal is opened in the editor:

```
+------------------------------------------------------------+
|  PROPOSAL: Deepen Elena's motivation                       |
|------------------------------------------------------------|
|  Scene: The Beginning (scene_03)    Status: pending        |
|------------------------------------------------------------|
|  INTENT                                                    |
|  Add internal monologue revealing Elena's true reason      |
|  for visiting the observatory.                             |
|                                                            |
|  EDIT PLAN                                                 |
|  1. After "She set her bag..." paragraph, insert new       |
|     paragraph with Elena's reflection on her father's      |
|     letter.                                                |
|  2. Modify closing line to echo the new emotional beat.    |
|                                                            |
|  CONSTRAINTS                                               |
|  - Maintain third-person limited POV                       |
|  - Keep scene under 800 words                              |
|                                                            |
|  ┌─────────────────────────────────────────────────────┐   |
|  │ Source: openai / gpt-4o · 847 in / 234 out tokens   │   |
|  │ Quality: high · Cost: $0.003 · Latency: 2.1s       │   |
|  └─────────────────────────────────────────────────────┘   |
|                                                            |
|  [Apply]  [Reject]  [Open Scene]  [Open Run]              |
|------------------------------------------------------------|
```

- Clean document-style layout (not a cramped card)
- Generation metadata in a subtle inset box
- Action buttons at the bottom: Apply (green), Reject (red), Open Scene, Open Run
- Retrieval citations expandable if present

### 3f. Codex Detail View

When a codex entity is opened in the editor:

```
+------------------------------------------------------------+
|  ◆ ELENA VASQUEZ                              [character]  |
|------------------------------------------------------------|
|                                                            |
|  Description                                               |
|  ─────────                                                 |
|  A 34-year-old astronomer haunted by her father's          |
|  disappearance. She carries his last letter everywhere...  |
|                                                            |
|  [Edit]                                                    |
|                                                            |
|  ─── Appears In ───────────────────────────────            |
|  ● The Beginning (scene_03) — POV character                |
|  ● Market Scene (scene_07) — mentioned                     |
|  ● The Confrontation (scene_15) — POV character            |
|                                                            |
|  ─── Related Proposals ────────────────────────            |
|  ● Deepen Elena's motivation — pending                     |
|  ○ Revise Elena's backstory — applied                      |
+------------------------------------------------------------+
```

- Shows entity description with inline edit toggle
- Cross-references: scenes where entity appears (detected from content/POV)
- Related proposals that mention this entity or its scenes
- Type badge in header corner

### 3g. Outliner / Corkboard View

When a folder/chapter node is selected in the manuscript tree (not a single scene),
the editor shows child scenes as a card grid:

```
+------------------------------------------------------------+
|  Chapter 2: The Observatory                   [grid] [list]|
|------------------------------------------------------------|
|  ┌──────────┐  ┌──────────┐  ┌──────────┐                 |
|  │The Begin.│  │The Journ.│  │The Arriv.│                 |
|  │          │  │          │  │          │                 |
|  │Elena ste-│  │The road  │  │Dawn brok-│                 |
|  │pped into │  │wound thr-│  │e over th-│                 |
|  │the obser-│  │ough the  │  │e market  │                 |
|  │vatory... │  │hills...  │  │square... │                 |
|  │          │  │          │  │          │                 |
|  │DFT · 650w│  │REV · 820w│  │FNL · 710w│                 |
|  └──────────┘  └──────────┘  └──────────┘                 |
+------------------------------------------------------------+
```

- Toggle between grid (cards) and list (table) view
- Cards show: title, body preview, status badge, word count
- Cards are draggable to reorder scenes
- Double-click card → open scene in editor tab
- Card border-top color matches status (amber/teal/green)
- List view shows: title, status, POV, word count, updated date (sortable columns)

### 3h. Generate Proposal Form

When user clicks "Generate" from sidebar or command palette, opens as an editor tab:

```
+------------------------------------------------------------+
|  Generate Proposal                                         |
|------------------------------------------------------------|
|  Scene:     [The Beginning ▾]                              |
|  Provider:  [openai ▾]         Model: [gpt-4o        ]    |
|                                                            |
|  Instruction:                                              |
|  ┌─────────────────────────────────────────────────────┐   |
|  │ Deepen Elena's internal motivation. Show why she    │   |
|  │ really came to the observatory tonight.             │   |
|  └─────────────────────────────────────────────────────┘   |
|                                                            |
|  ─── Advanced ─────────────────────── (collapsed)          |
|  Temperature: 0.7  Max Tokens: 2048                        |
|  Context Radius: 2  Codex Limit: 10                        |
|  Retrieval: [auto ▾]  Min Score: 0.3                       |
|                                                            |
|  [Generate]                                                |
+------------------------------------------------------------+
```

- Opens as a full editor tab (not crammed in the sidebar)
- Advanced settings in a collapsible section
- Generate button triggers the AI call, status updates in real-time

---

## 4. Secondary Sidebar (Right)

Width: 360px default (min 280, max 480, resizable). Toggle: `Cmd+Shift+B`

Has its own tab switcher at the top for switching between views:

```
+-------------------------------+
| [Chat]  [Inspector]  [Voice] |
|-------------------------------|
|                               |
|   (content per active tab)    |
|                               |
+-------------------------------+
```

### 4a. AI Chat Panel

The persistent AI conversation interface.

```
+-------------------------------+
| [Chat]  [Inspector]  [Voice] |
|-------------------------------|
| Threads              [+ New] |
| ● Project brainstorm         |
| ○ Scene 3 revision           |
|-------------------------------|
| Provider: [openai ▾]  [Agent]|
|-------------------------------|
|                               |
| You                    2:14p  |
| How should I handle the       |
| transition between scenes     |
| 3 and 4?                     |
|                               |
| Assistant              2:14p  |
| Consider using a time skip    |
| with a sensory anchor...     |
|                               |
|-------------------------------|
| Context: Scene ✓  Codex auto |
|-------------------------------|
| [Type a message...]    [Send]|
+-------------------------------+
```

- Thread list at top (collapsible)
- Model/provider selector
- Mode toggle: Chat (read-only) vs Agent (can create proposals, modify scenes)
- Messages with role indicators and timestamps
- Context controls: which scene, codex settings, retrieval mode
- Pending tool calls shown with Execute/Skip buttons
- Monospace for code/tool output, serif for assistant prose

### 4b. Inspector Panel

Contextual metadata for the active editor tab.

When a scene is active:
```
+-------------------------------+
| [Chat]  [Inspector]  [Voice] |
|-------------------------------|
| SCENE METADATA                |
| Status:  [draft ▾]           |
| POV:     [Elena Vasquez    ]  |
| Words:   647                  |
| Updated: 2 hours ago          |
|-------------------------------|
| SUMMARY                       |
| [Elena visits the observatory |
|  searching for clues about    |
|  her father's disappearance.] |
|-------------------------------|
| LINKED ENTITIES               |
| ◆ Elena Vasquez               |
| ◇ The Observatory             |
|-------------------------------|
| PROPOSALS (2)                 |
| ● Deepen motivation  pending  |
| ○ Revise opening     applied  |
+-------------------------------+
```

- Editable fields: status dropdown, POV input, summary textarea
- Read-only fields: word count, timestamps
- Linked entities: detected from scene content, clickable to open in editor
- Related proposals: for this scene, clickable to open

### 4c. Voice Panel

Push-to-talk STT interface.

```
+-------------------------------+
| [Chat]  [Inspector]  [Voice] |
|-------------------------------|
| Mode: [Command ▾]            |
| ☑ Require confirmation       |
|-------------------------------|
|                               |
|        [  🎤 Hold  ]         |
|                               |
|-------------------------------|
| TRANSCRIPT                    |
| "add a new scene after the    |
|  market scene about Elena     |
|  arriving at the tower"       |
|                               |
| [Submit] [Clear]              |
|-------------------------------|
| COMMAND LOG                   |
| ✓ Added scene "Tower Arrival" |
| ✕ "delete all scenes" blocked |
+-------------------------------+
```

---

## 5. Panel Area (Bottom)

Height: 240px default (min 160, max 400, resizable). Toggle: `Cmd+J`

Tab bar along the top, content below. Three panels:

```
+----[Runs]----[Merge]----[Budget]----------------------------+
|                                                              |
|  (content per active tab)                                    |
|                                                              |
+--------------------------------------------------------------+
```

### 5a. Runs Panel

Generation run history — similar to VS Code's Terminal/Output panel.

```
| Status | Run ID    | Scene      | Provider | Quality | Cost    | Time  |
|--------|-----------|------------|----------|---------|---------|-------|
| ✓      | run_a1b2  | scene_03   | openai   | high    | $0.003  | 2.1s  |
| ✓      | run_c3d4  | scene_07   | anthropic| medium  | $0.005  | 3.4s  |
| ✕      | run_e5f6  | scene_03   | openai   | —       | —       | 0.8s  |
```

- Table layout with sortable columns
- Status icon: ✓ green (succeeded), ✕ red (failed)
- Filters above table: status, provider, quality tier
- Click row → expand inline detail (instruction, error, retrieval info)
- Preferred runs marked with star icon

### 5b. Merge Panel

Branch operations and diff view.

```
+--------------------------------------------------------------+
| Current: main   Branches: [feature/elena-backstory ▾]       |
|--------------------------------------------------------------|
| [Preflight]  [Diff]  [Merge]  [New Branch]  [Switch]        |
|--------------------------------------------------------------|
|                                                              |
| Preflight Report:                                            |
| Base: main  Head: feature/elena-backstory                    |
| Risk: low  Safe to merge: yes                                |
| Files changed: 3  Overlap: 0                                 |
|                                                              |
+--------------------------------------------------------------+
```

### 5c. Budget Panel

Token/cost budget monitoring and configuration.

```
+--------------------------------------------------------------+
| USAGE                          | POLICY                       |
| Daily:  4,200 / 50,000 tokens | Max input:  10,000 tokens    |
| Weekly: 12,800 / 200,000      | Max output: 4,000 tokens     |
| Cost:   $0.12 / $5.00 daily   | Max cost:   $0.50 per run    |
|                                | Enforcement: fail-closed     |
|                                | [Edit Policy]                |
+--------------------------------------------------------------+
```

- Two-column layout: usage meters (left) + policy config (right)
- Usage shown as progress bars with numeric labels
- Policy fields are editable inline
- Provider runtime config (retry settings, API key status)

---

## 6. Status Bar

A thin 24px strip at the very bottom of the window.

```
+--------------------------------------------------------------+
| 📁 My Novel · 24 scenes · 18,420 words  |  main  ↑0 ↓0     |
|                          scene_03 · draft · Literata 17px · ☽|
+--------------------------------------------------------------+
```

**Left side** (project-scoped):
- Project name
- Scene count
- Total word count
- Git branch + sync status

**Right side** (file-scoped):
- Current scene ID
- Scene status badge
- Editor font info
- Theme toggle (moon/sun icon)
- AI provider indicator (when active)
- Budget remaining indicator (when low)

### Visual treatment
- Background: `--bg-base`
- Text: `--text-secondary`, `--text-xs` (11px)
- Items separated by subtle dividers
- Clickable items: branch opens branch switcher, scene ID opens scene picker,
  theme icon toggles light/dark, font info opens editor settings

---

## 7. Command Palette

A modal overlay triggered by `Cmd+K` (or `Cmd+Shift+P`).

```
            +---------------------------------------------+
            | > search scenes, entities, commands...       |
            |---------------------------------------------|
            | RECENT                                      |
            |   📄 The Beginning                  scene   |
            |   ◆ Elena Vasquez                   codex   |
            |---------------------------------------------|
            | COMMANDS                                    |
            |   New Scene                     Cmd+N       |
            |   Generate Proposal             Cmd+G       |
            |   Toggle Zen Mode               Cmd+Shift+Z |
            |   Run Continuity Checks                     |
            |   Toggle Theme                  Cmd+Shift+T |
            +---------------------------------------------+
```

### Prefix modes
- No prefix: search everything (scenes, entities, commands)
- `>` : commands only
- `@` : codex entities only
- `#` : scenes only
- `:` : go to scene by ID

### Visual treatment
- Centered horizontally, top-third of screen
- Width: 560px max
- Background: `--bg-elevated` with subtle backdrop blur
- Border: `--border-strong`
- Shadow: large, dramatic (`--shadow-lg`)
- Results show type icon + title + category label + keyboard shortcut
- Keyboard navigation: Up/Down arrows, Enter to select, Esc to close
- Fuzzy matching with highlighted match characters
- Entrance animation: fade in + slight scale up (150ms)

---

## 8. Zen Mode

Toggle: `Cmd+Shift+Z`

Hides all panels (activity bar, sidebars, panel, status bar, tab bar, breadcrumbs).
The writing surface expands to fill the entire window with extra-generous margins.

```
+-----------------------------------------------------------------+
|                                                                 |
|                                                                 |
|              The Beginning                                      |
|              ─────────                                          |
|                                                                 |
|              Elena stepped into the observatory just as         |
|              the last sliver of sun vanished below the          |
|              horizon. The copper dome overhead caught the        |
|              dying light and held it, amber and warm, for       |
|              one breath longer than the sky outside.            |
|                                                                 |
|                                                                 |
|                                                                 |
+-----------------------------------------------------------------+
```

- Background: solid `--editor-bg` (full window)
- Text max-width: 640px, centered
- Extra vertical padding (80px top)
- Esc or `Cmd+Shift+Z` to exit
- Subtle floating word count in bottom-right corner (fades on typing)
- Mouse movement near top edge reveals a thin "Exit Zen Mode" bar

---

## 9. Keyboard Shortcuts

| Shortcut        | Action                          |
|-----------------|---------------------------------|
| Cmd+K           | Command Palette                 |
| Cmd+B           | Toggle Primary Sidebar          |
| Cmd+J           | Toggle Panel                    |
| Cmd+Shift+B     | Toggle Secondary Sidebar        |
| Cmd+\           | Split Editor Right              |
| Cmd+Shift+\     | Split Editor Down               |
| Cmd+Shift+E     | Focus Manuscript Explorer       |
| Cmd+Shift+X     | Focus Codex Browser             |
| Cmd+Shift+F     | Focus Project Search            |
| Cmd+Shift+R     | Focus Proposal Queue            |
| Cmd+Shift+C     | Focus Continuity Checks         |
| Cmd+L           | Focus AI Chat                   |
| Cmd+Shift+Z     | Toggle Zen Mode                 |
| Cmd+1/2/3       | Focus Editor Group 1/2/3        |
| Cmd+W           | Close Current Tab               |
| Cmd+Tab         | Cycle Tabs                      |
| Cmd+N           | New Scene                       |
| Cmd+S           | Save Scene                      |
| Cmd+G           | Generate Proposal               |
| Cmd+,           | Open Settings                   |
| Cmd+Shift+T     | Toggle Theme                    |
| Esc             | Close overlay / Exit Zen Mode   |

---

## 10. Component Architecture

The monolithic 4,600-line App.tsx will be decomposed into a modular component tree:

```
<App>
  <ThemeProvider>
    <CommandPaletteProvider>
      <WorkspaceProvider>        ← shared state (project, scenes, codex, etc.)
        <ZenMode />              ← full-screen overlay when active
        <CommandPalette />       ← modal overlay
        <Workbench>
          <ActivityBar />
          <PrimarySidebar>
            <ManuscriptExplorer />
            <CodexBrowser />
            <ProjectSearch />
            <ProposalQueue />
            <CheckResults />
            <SettingsForm />
          </PrimarySidebar>
          <EditorArea>
            <TabBar />
            <Breadcrumbs />
            <EditorGroup>       ← supports split views
              <EditorPane>
                <SceneEditor />
                <CodexDetail />
                <ProposalReview />
                <OutlinerView />
                <GenerateForm />
              </EditorPane>
            </EditorGroup>
          </EditorArea>
          <SecondarySidebar>
            <ChatPanel />
            <InspectorPanel />
            <VoicePanel />
          </SecondarySidebar>
          <PanelArea>
            <RunsPanel />
            <MergePanel />
            <BudgetPanel />
          </PanelArea>
          <StatusBar />
        </Workbench>
      </WorkspaceProvider>
    </CommandPaletteProvider>
  </ThemeProvider>
</App>
```

### State management

Replace the massive useState block in App.tsx with context providers:

- **WorkspaceContext**: project status, scenes, codex entities, proposals, runs, checks
- **EditorContext**: open tabs, active tab, split layout, editor preferences
- **ChatContext**: threads, messages, pending tool calls, context profile
- **UIContext**: sidebar visibility, panel visibility, theme, zen mode, command palette

Each context provider handles its own data fetching, caching, and mutations.

### File structure

```
desktop/src/
  components/
    workbench/
      Workbench.tsx
      ActivityBar.tsx
      StatusBar.tsx
    sidebar/
      PrimarySidebar.tsx
      ManuscriptExplorer.tsx
      CodexBrowser.tsx
      ProjectSearch.tsx
      ProposalQueue.tsx
      CheckResults.tsx
    editor/
      EditorArea.tsx
      TabBar.tsx
      Breadcrumbs.tsx
      EditorGroup.tsx
      EditorPane.tsx
      SceneEditor.tsx
      CodexDetail.tsx
      ProposalReview.tsx
      OutlinerView.tsx
      GenerateForm.tsx
    secondary/
      SecondarySidebar.tsx
      ChatPanel.tsx
      InspectorPanel.tsx
      VoicePanel.tsx
    panel/
      PanelArea.tsx
      RunsPanel.tsx
      MergePanel.tsx
      BudgetPanel.tsx
    overlay/
      CommandPalette.tsx
      ZenMode.tsx
    settings/
      SettingsForm.tsx
  contexts/
    WorkspaceContext.tsx
    EditorContext.tsx
    ChatContext.tsx
    UIContext.tsx
  hooks/
    useScenes.ts
    useCodex.ts
    useProposals.ts
    useRuns.ts
    useChecks.ts
    useBranches.ts
    useBudget.ts
    useKeyboardShortcuts.ts
    useLocalStorage.ts
  styles/
    design-system.css       ← tokens, reset, base styles
    workbench.css           ← layout grid
    activity-bar.css
    sidebar.css
    editor.css
    secondary-sidebar.css
    panel.css
    status-bar.css
    command-palette.css
    zen-mode.css
    components.css          ← shared component styles (buttons, inputs, badges)
```

---

## 11. Visual Design System

See `desktop/src/design-system-v2.css` for the complete token set. Key decisions:

### Typography
- **UI chrome**: "Outfit" (Google Fonts) — geometric sans with personality
- **Writing surface**: "Literata" (Google Fonts) — literary serif for extended reading
- **Technical elements**: "JetBrains Mono" — for scene IDs, file paths, token counts

### Color philosophy
- Dark theme: near-black backgrounds with warm undertones (#111114, #18181b)
- Editor surface: warm cream (#faf6f0) in dark mode — the "glowing page"
- Accent: warm amber (#c4841d) — literary, warm, distinct from code-editor blue
- AI elements: muted teal (#3d8b8b) — clearly marks AI-related UI
- Status: desaturated warm tones (forest green, burnt orange, brick red)

### Spacing and density
- Sidebars: dense, compact (space-1 to space-3 padding)
- Editor area: generous, spacious (space-8 to space-12 margins)
- The contrast between dense chrome and spacious writing area reinforces hierarchy

### Borders and shadows
- Primarily border-based separation (1px, subtle opacity)
- Shadows minimal in dark mode (none on most elements)
- Light mode gets subtle shadows on elevated elements only
- No heavy box-shadows — clean, flat surfaces

### Animation
- Panel show/hide: 250ms ease-out (width/height + opacity)
- Tab transitions: 150ms
- Command palette: 150ms scale + opacity
- Hover states: 100ms
- Respects prefers-reduced-motion

---

## 12. Migration Strategy

### Phase 1: Design System + Layout Shell
- Create new CSS design system (`design-system-v2.css`)
- Build `Workbench` layout component with resizable panels
- Wire up Activity Bar ↔ Primary Sidebar toggling
- Build Tab Bar with basic open/close/switch
- Build Status Bar with static content
- **No data integration yet** — static placeholder content

### Phase 2: Primary Sidebar Views
- Port ManuscriptExplorer (scene tree) from current sidebar
- Port CodexBrowser from current sidebar
- Build ProjectSearch (new feature)
- Port ProposalQueue from current Review > Proposals
- Port CheckResults from current Review > Checks
- Build SettingsForm (replaces popover)

### Phase 3: Editor Area
- Build SceneEditor (port from current Write view)
- Build CodexDetail (port/enhance from current codex view)
- Build ProposalReview (port from current Review > Proposals detail)
- Build OutlinerView (port from current Plan view)
- Build GenerateForm (port from current Review > Proposals generate)
- Implement split editor support

### Phase 4: Secondary Sidebar + Panel
- Port ChatPanel from current Chat view
- Build InspectorPanel (new — scene metadata + links)
- Port VoicePanel from current voice drawer
- Port RunsPanel from current Review > Runs
- Port MergePanel from current Review > Merge
- Port BudgetPanel from current Review > Runs budget section

### Phase 5: Overlays + Polish
- Build CommandPalette (new feature)
- Build ZenMode (new feature)
- Keyboard shortcut system
- Animation polish
- Responsive breakpoints
- Accessibility audit

### Phase 6: Cleanup
- Remove old App.tsx monolith
- Remove old styles.css
- Update tests
- Performance profiling
