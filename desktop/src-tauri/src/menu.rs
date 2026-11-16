//! The application menu bar.
//!
//! Every custom item stands for a keyboard shortcut the interface already
//! handles. Choosing one sends its key combination to the window, where it runs
//! through the same handlers as the key press, so the menu can never drift from
//! what a shortcut does. The standard Edit and Window items stay native.

use serde::Serialize;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder, SubmenuBuilder};
use tauri::{AppHandle, Manager, Runtime};

/// The DOM event the interface listens for. The menu talks to the page
/// directly instead of through the event plugin, so it needs no permission and
/// does not load a module the Assistant fetches on demand.
pub const MENU_DOM_EVENT: &str = "openauthor-menu";

/// A shortcut offered in the menu: Command (Control elsewhere) plus `key`,
/// with Shift when `shift` is set.
pub struct MenuShortcut {
  pub id: &'static str,
  pub label: &'static str,
  pub key: &'static str,
  pub shift: bool,
}

#[derive(Clone, Serialize)]
pub struct MenuShortcutEvent {
  pub key: &'static str,
  pub shift: bool,
}

const fn shortcut(id: &'static str, label: &'static str, key: &'static str, shift: bool) -> MenuShortcut {
  MenuShortcut { id, label, key, shift }
}

pub const SETTINGS: MenuShortcut = shortcut("menu:settings", "Settings\u{2026}", ",", false);

pub const FILE: &[MenuShortcut] = &[
  shortcut("menu:new-scene", "New Scene", "n", false),
  shortcut("menu:save", "Save", "s", false),
  shortcut("menu:command-palette", "Command Palette\u{2026}", "k", false),
  shortcut("menu:close-tab", "Close Tab", "w", false),
  shortcut("menu:close-project", "Close Project", "o", true),
];

pub const EDIT: &[MenuShortcut] = &[
  shortcut("menu:italic", "Italic", "i", false),
  shortcut("menu:find", "Find in Scene\u{2026}", "f", false),
  shortcut("menu:find-next", "Find Next", "g", false),
  shortcut("menu:find-previous", "Find Previous", "g", true),
];

pub const VIEW_PLACES: &[MenuShortcut] = &[
  shortcut("menu:manuscript", "Manuscript", "e", true),
  shortcut("menu:plan", "Plan", "p", true),
  shortcut("menu:story-memory", "Story Memory", "x", true),
  shortcut("menu:storylines", "Storylines", "l", true),
  shortcut("menu:search", "Search Book", "f", true),
  shortcut("menu:changes", "Changes", "r", true),
  shortcut("menu:checks", "Checks", "c", true),
];

pub const VIEW_PANELS: &[MenuShortcut] = &[
  shortcut("menu:assistant", "Assistant", "l", false),
  shortcut("menu:sidebar", "Show or Hide Sidebar", "b", false),
  shortcut("menu:right-panel", "Show or Hide Right Panel", "b", true),
  shortcut("menu:tools-panel", "Show or Hide Tools Panel", "j", false),
];

pub const VIEW_MODES: &[MenuShortcut] = &[
  shortcut("menu:focus-mode", "Focus Mode", "d", true),
  shortcut("menu:theme", "Switch Light or Dark", "t", true),
];

pub fn all_shortcuts() -> impl Iterator<Item = &'static MenuShortcut> {
  std::iter::once(&SETTINGS)
    .chain(FILE)
    .chain(EDIT)
    .chain(VIEW_PLACES)
    .chain(VIEW_PANELS)
    .chain(VIEW_MODES)
}

pub fn accelerator(item: &MenuShortcut) -> String {
  let key = if item.key == "," { "Comma".to_string() } else { item.key.to_uppercase() };
  if item.shift { format!("CmdOrCtrl+Shift+{key}") } else { format!("CmdOrCtrl+{key}") }
}

pub fn shortcut_event(id: &str) -> Option<MenuShortcutEvent> {
  all_shortcuts()
    .find(|item| item.id == id)
    .map(|item| MenuShortcutEvent { key: item.key, shift: item.shift })
}

fn add_shortcuts<'m, R: Runtime>(
  app: &'m AppHandle<R>,
  mut menu: SubmenuBuilder<'m, R, AppHandle<R>>,
  items: &[MenuShortcut],
) -> tauri::Result<SubmenuBuilder<'m, R, AppHandle<R>>> {
  for item in items {
    let entry = MenuItemBuilder::with_id(item.id, item.label).accelerator(accelerator(item)).build(app)?;
    menu = menu.item(&entry);
  }
  Ok(menu)
}

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
  let name = app.package_info().name.clone();
  let application = add_shortcuts(app, SubmenuBuilder::new(app, &name).about(None).separator(), std::slice::from_ref(&SETTINGS))?
    .separator()
    .services()
    .separator()
    .hide()
    .hide_others()
    .show_all()
    .separator()
    .quit()
    .build()?;

  let file = add_shortcuts(app, SubmenuBuilder::new(app, "File"), &FILE[..2])?.separator();
  let file = add_shortcuts(app, file, &FILE[2..3])?.separator();
  let file = add_shortcuts(app, file, &FILE[3..])?.build()?;

  let edit = SubmenuBuilder::new(app, "Edit")
    .undo()
    .redo()
    .separator()
    .cut()
    .copy()
    .paste()
    .select_all()
    .separator();
  let edit = add_shortcuts(app, edit, &EDIT[..1])?.separator();
  let edit = add_shortcuts(app, edit, &EDIT[1..])?.build()?;

  let view = add_shortcuts(app, SubmenuBuilder::new(app, "View"), VIEW_PLACES)?.separator();
  let view = add_shortcuts(app, view, VIEW_PANELS)?.separator();
  let view = add_shortcuts(app, view, VIEW_MODES)?.separator().fullscreen().build()?;

  let window = SubmenuBuilder::new(app, "Window")
    .minimize()
    .maximize()
    .separator()
    .bring_all_to_front()
    .build()?;

  MenuBuilder::new(app).items(&[&application, &file, &edit, &view, &window]).build()
}

/// The script that hands a chosen shortcut to the page.
pub fn dispatch_script(event: &MenuShortcutEvent) -> String {
  // Both fields come from the static table above, so the JSON is trusted.
  let detail = serde_json::to_string(event).unwrap_or_else(|_| "null".to_string());
  format!("window.dispatchEvent(new CustomEvent('{MENU_DOM_EVENT}', {{ detail: {detail} }}));")
}

/// Forward a chosen shortcut item to the window. Native items handle themselves.
pub fn handle_event<R: Runtime>(app: &AppHandle<R>, id: &str) {
  if let Some(event) = shortcut_event(id) {
    let script = dispatch_script(&event);
    for window in app.webview_windows().values() {
      let _ = window.eval(&script);
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;
  use std::collections::HashSet;

  #[test]
  fn every_menu_shortcut_has_a_unique_id_and_key_combination() {
    let mut ids = HashSet::new();
    let mut combinations = HashSet::new();
    for item in all_shortcuts() {
      assert!(ids.insert(item.id), "duplicate menu id {}", item.id);
      assert!(combinations.insert((item.key, item.shift)), "duplicate shortcut for {}", item.id);
    }
  }

  #[test]
  fn menu_shortcuts_leave_system_editing_keys_alone() {
    // Undo, Redo, Cut, Copy, Paste, Select All, Quit, Hide and Minimize are
    // native items; a custom item on the same keys would take them over.
    for item in all_shortcuts() {
      assert!(!matches!((item.key, item.shift), ("z", _) | ("x", false) | ("c", false) | ("v", false) | ("a", false) | ("q", false) | ("h", false) | ("m", false)),
        "{} takes a system editing shortcut", item.id);
    }
  }

  #[test]
  fn shortcut_events_carry_the_key_combination_and_ignore_native_items() {
    let focus = shortcut_event("menu:focus-mode").expect("focus mode is a shortcut item");
    assert_eq!((focus.key, focus.shift), ("d", true));
    assert_eq!(accelerator(&SETTINGS), "CmdOrCtrl+Comma");
    assert_eq!(accelerator(&VIEW_MODES[0]), "CmdOrCtrl+Shift+D");
    assert!(shortcut_event("quit").is_none());
  }

  #[test]
  fn the_page_receives_a_dom_event_with_the_shortcut() {
    assert_eq!(
      dispatch_script(&focus_mode()),
      "window.dispatchEvent(new CustomEvent('openauthor-menu', { detail: {\"key\":\"d\",\"shift\":true} }));"
    );
  }

  fn focus_mode() -> MenuShortcutEvent {
    shortcut_event("menu:focus-mode").expect("focus mode is a shortcut item")
  }
}
