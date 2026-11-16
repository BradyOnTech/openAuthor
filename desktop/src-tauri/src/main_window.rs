// The main window opens where the author left it. Its frame is remembered in
// the app's config folder and restored only where today's displays can show
// it, so unplugging a monitor never leaves the window out of reach.
//
// Frames are kept in desktop units: points on a Mac, where every display
// shares one coordinate space, and pixels elsewhere.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;
use tauri::{
  AppHandle, LogicalPosition, LogicalSize, Manager, Monitor, PhysicalPosition, PhysicalSize,
  Runtime, WebviewWindow, Window, WindowEvent,
};

const STATE_FILE: &str = "window-state.json";
const MAIN_WINDOW: &str = "main";
/// Dragging reports many frames a second; the disk hears about the last of them.
const WRITE_DELAY: Duration = Duration::from_millis(600);
/// How long the hidden window waits for its first screen before appearing anyway.
const REVEAL_DEADLINE: Duration = Duration::from_secs(3);
/// How much of the title bar must stay on a display for the window to be reachable.
const REACHABLE_WIDTH: f64 = 120.0;
const REACHABLE_HEIGHT: f64 = 40.0;

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Frame {
  pub x: f64,
  pub y: f64,
  pub width: f64,
  pub height: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
struct SavedWindow {
  frame: Frame,
  #[serde(default)]
  maximized: bool,
}

#[derive(Default)]
struct Tracker {
  current: Option<SavedWindow>,
  written: Option<SavedWindow>,
  write_scheduled: bool,
}

#[derive(Default)]
pub struct MainWindowState {
  tracker: Mutex<Tracker>,
  revealed: AtomicBool,
}

fn overlap(a: Frame, b: Frame) -> f64 {
  let width = (a.x + a.width).min(b.x + b.width) - a.x.max(b.x);
  let height = (a.y + a.height).min(b.y + b.height) - a.y.max(b.y);
  if width <= 0.0 || height <= 0.0 {
    0.0
  } else {
    width * height
  }
}

fn fitted_size(saved: Frame, display: Frame, minimum: (f64, f64)) -> (f64, f64) {
  (
    saved.width.max(minimum.0).min(display.width),
    saved.height.max(minimum.1).min(display.height),
  )
}

/// The remembered frame as it can be shown on these displays, or `None` when
/// no display shows any of it. The display holding most of the window decides;
/// a window that fits is moved only as far as needed to keep its title bar
/// within reach, and one that had to shrink is brought wholly onto the display.
pub fn fit_to_displays(saved: Frame, displays: &[Frame], minimum: (f64, f64)) -> Option<Frame> {
  let display = displays
    .iter()
    .copied()
    .filter(|display| overlap(saved, *display) > 0.0)
    .max_by(|a, b| overlap(saved, *a).total_cmp(&overlap(saved, *b)))?;
  let (width, height) = fitted_size(saved, display, minimum);
  if width < saved.width || height < saved.height {
    let x = saved.x.min(display.x + display.width - width).max(display.x);
    let y = saved.y.min(display.y + display.height - height).max(display.y);
    return Some(Frame { x, y, width, height });
  }
  let reach = REACHABLE_WIDTH.min(width);
  let x = saved
    .x
    .max(display.x - width + reach)
    .min(display.x + display.width - reach);
  let y = saved
    .y
    .min(display.y + display.height - REACHABLE_HEIGHT)
    .max(display.y);
  Some(Frame { x, y, width, height })
}

/// Centred across, and a little above the middle, where a Mac places a new window.
pub fn centred_in(display: Frame, width: f64, height: f64) -> Frame {
  Frame {
    x: display.x + (display.width - width) / 2.0,
    y: display.y + (display.height - height) / 3.0,
    width,
    height,
  }
}

fn uses_points() -> bool {
  cfg!(target_os = "macos")
}

fn display_frame(monitor: &Monitor) -> Frame {
  let scale = if uses_points() { monitor.scale_factor() } else { 1.0 };
  let area = monitor.work_area();
  Frame {
    x: f64::from(area.position.x) / scale,
    y: f64::from(area.position.y) / scale,
    width: f64::from(area.size.width) / scale,
    height: f64::from(area.size.height) / scale,
  }
}

fn window_frame<R: Runtime>(window: &Window<R>) -> Option<Frame> {
  let scale = if uses_points() { window.scale_factor().ok()? } else { 1.0 };
  let position = window.outer_position().ok()?;
  let size = window.inner_size().ok()?;
  Some(Frame {
    x: f64::from(position.x) / scale,
    y: f64::from(position.y) / scale,
    width: f64::from(size.width) / scale,
    height: f64::from(size.height) / scale,
  })
}

fn state_path<R: Runtime>(app: &AppHandle<R>) -> Option<PathBuf> {
  app.path().app_config_dir().ok().map(|folder| folder.join(STATE_FILE))
}

fn read_saved<R: Runtime>(app: &AppHandle<R>) -> Option<SavedWindow> {
  let saved: SavedWindow = serde_json::from_str(&fs::read_to_string(state_path(app)?).ok()?).ok()?;
  let frame = saved.frame;
  let usable = [frame.x, frame.y, frame.width, frame.height].iter().all(|value| value.is_finite())
    && frame.width > 0.0
    && frame.height > 0.0;
  usable.then_some(saved)
}

fn write_saved<R: Runtime>(app: &AppHandle<R>, saved: &SavedWindow) -> bool {
  let Some(path) = state_path(app) else { return false };
  let Some(folder) = path.parent() else { return false };
  let Ok(text) = serde_json::to_string(saved) else { return false };
  // Written beside the target and renamed, so a crash never leaves half a file.
  let partial = path.with_extension("json.partial");
  fs::create_dir_all(folder).is_ok() && fs::write(&partial, text).is_ok() && fs::rename(&partial, &path).is_ok()
}

fn minimum_size<R: Runtime>(window: &WebviewWindow<R>) -> (f64, f64) {
  let configured = window
    .app_handle()
    .config()
    .app
    .windows
    .iter()
    .find(|candidate| candidate.label == window.label());
  let (width, height) = configured.map_or((None, None), |config| (config.min_width, config.min_height));
  let scale = if uses_points() { 1.0 } else { window.scale_factor().unwrap_or(1.0) };
  (width.unwrap_or(0.0) * scale, height.unwrap_or(0.0) * scale)
}

fn set_size<R: Runtime>(window: &WebviewWindow<R>, width: f64, height: f64) {
  let _ = if uses_points() {
    window.set_size(LogicalSize::new(width, height))
  } else {
    window.set_size(PhysicalSize::new(width.round() as u32, height.round() as u32))
  };
}

fn set_position<R: Runtime>(window: &WebviewWindow<R>, x: f64, y: f64) {
  let _ = if uses_points() {
    window.set_position(LogicalPosition::new(x, y))
  } else {
    window.set_position(PhysicalPosition::new(x.round() as i32, y.round() as i32))
  };
}

/// Place the window before it is first shown. Without a usable remembered
/// frame it stays where the system opened it, at the remembered or configured
/// size; if that size has to change to fit the display, it is centred again.
pub fn restore<R: Runtime>(window: &WebviewWindow<R>) {
  let saved = read_saved(window.app_handle());
  let displays: Vec<Frame> = window
    .available_monitors()
    .map(|monitors| monitors.iter().map(display_frame).collect())
    .unwrap_or_default();
  let minimum = minimum_size(window);
  if let Some(frame) = saved.and_then(|saved| fit_to_displays(saved.frame, &displays, minimum)) {
    // Position first: the size is then applied on the display it belongs to.
    set_position(window, frame.x, frame.y);
    set_size(window, frame.width, frame.height);
    set_position(window, frame.x, frame.y);
  } else if let Some(opened) = window_frame(&window.as_ref().window()) {
    // Stay on the display the system opened the window on.
    let home = displays
      .iter()
      .copied()
      .max_by(|a, b| overlap(opened, *a).total_cmp(&overlap(opened, *b)));
    if let Some(home) = home {
      let wanted = saved.map_or(opened, |saved| saved.frame);
      let (width, height) = fitted_size(wanted, home, minimum);
      if (width, height) != (opened.width, opened.height) {
        let centred = centred_in(home, width, height);
        set_position(window, centred.x, centred.y);
        set_size(window, width, height);
        set_position(window, centred.x, centred.y);
      }
    }
  }
  if saved.is_some_and(|saved| saved.maximized) {
    let _ = window.maximize();
  }
  if let Some(state) = window.try_state::<MainWindowState>() {
    if let Ok(mut tracker) = state.tracker.lock() {
      tracker.current = saved;
      tracker.written = saved;
    }
  }
}

fn record<R: Runtime>(window: &Window<R>, flush: bool) {
  let Some(state) = window.try_state::<MainWindowState>() else { return };
  let Ok(mut tracker) = state.tracker.lock() else { return };
  // A minimised or full-screen window keeps the frame it will return to.
  let transient = window.is_minimized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false);
  if !transient {
    if window.is_maximized().unwrap_or(false) {
      if let Some(current) = tracker.current.as_mut() {
        current.maximized = true;
      }
    } else if let Some(frame) = window_frame(window) {
      tracker.current = Some(SavedWindow { frame, maximized: false });
    }
  }
  if flush {
    write_if_changed(window.app_handle(), &mut tracker);
  } else if tracker.current != tracker.written && !tracker.write_scheduled {
    tracker.write_scheduled = true;
    let app = window.app_handle().clone();
    thread::spawn(move || {
      thread::sleep(WRITE_DELAY);
      let Some(state) = app.try_state::<MainWindowState>() else { return };
      let Ok(mut tracker) = state.tracker.lock() else { return };
      tracker.write_scheduled = false;
      write_if_changed(&app, &mut tracker);
    });
  }
}

fn write_if_changed<R: Runtime>(app: &AppHandle<R>, tracker: &mut Tracker) {
  let Some(current) = tracker.current else { return };
  if tracker.written != Some(current) && write_saved(app, &current) {
    tracker.written = Some(current);
  }
}

/// Show the window, once. It is created hidden so that it first appears in
/// its remembered place with its page already drawn, never as a blank frame.
pub fn reveal<R: Runtime>(window: &WebviewWindow<R>) {
  let Some(state) = window.try_state::<MainWindowState>() else { return };
  if state.revealed.swap(true, Ordering::SeqCst) {
    return;
  }
  if let Err(error) = window.show().and_then(|()| window.set_focus()) {
    eprintln!("openAuthor: could not show the main window: {error}");
  }
}

/// A page that never reports its first screen must not leave the app invisible.
pub fn reveal_by_deadline<R: Runtime>(window: &WebviewWindow<R>) {
  let window = window.clone();
  thread::spawn(move || {
    thread::sleep(REVEAL_DEADLINE);
    reveal(&window);
  });
}

/// Tell the page whether the window is full screen, where the title bar and
/// its window buttons are out of sight.
pub fn announce_full_screen<R: Runtime>(window: &WebviewWindow<R>) {
  let full_screen = window.is_fullscreen().unwrap_or(false);
  let _ = window.eval(&format!(
    "document.documentElement.toggleAttribute('data-fullscreen', {full_screen})"
  ));
}

pub fn handle_event<R: Runtime>(window: &Window<R>, event: &WindowEvent) {
  if window.label() != MAIN_WINDOW {
    return;
  }
  match event {
    WindowEvent::Moved(_) => record(window, false),
    WindowEvent::Resized(_) => {
      record(window, false);
      if let Some(webview) = window.app_handle().get_webview_window(MAIN_WINDOW) {
        announce_full_screen(&webview);
      }
    }
    WindowEvent::Focused(false) | WindowEvent::CloseRequested { .. } | WindowEvent::Destroyed => record(window, true),
    _ => {}
  }
}

/// Keep the latest frame when the app quits without closing its window first.
pub fn flush<R: Runtime>(app: &AppHandle<R>) {
  if let Some(webview) = app.get_webview_window(MAIN_WINDOW) {
    record(&webview.as_ref().window(), true);
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  const LAPTOP: Frame = Frame { x: 0.0, y: 25.0, width: 1440.0, height: 875.0 };
  const LEFT_MONITOR: Frame = Frame { x: -1920.0, y: 0.0, width: 1920.0, height: 1080.0 };
  const MINIMUM: (f64, f64) = (820.0, 560.0);

  #[test]
  fn a_frame_that_still_fits_is_restored_exactly() {
    let saved = Frame { x: -1660.0, y: 64.0, width: 1400.0, height: 900.0 };
    assert_eq!(fit_to_displays(saved, &[LAPTOP, LEFT_MONITOR], MINIMUM), Some(saved));
    let across = Frame { x: -400.0, y: 100.0, width: 900.0, height: 600.0 };
    assert_eq!(fit_to_displays(across, &[LAPTOP, LEFT_MONITOR], MINIMUM), Some(across));
  }

  #[test]
  fn a_frame_on_an_unplugged_display_is_not_restored_there() {
    let saved = Frame { x: -1660.0, y: 64.0, width: 1400.0, height: 900.0 };
    assert_eq!(fit_to_displays(saved, &[LAPTOP], MINIMUM), None);
    assert_eq!(fit_to_displays(saved, &[], MINIMUM), None);
  }

  #[test]
  fn a_frame_larger_than_its_display_shrinks_onto_it() {
    let saved = Frame { x: 200.0, y: 600.0, width: 2400.0, height: 1300.0 };
    assert_eq!(fit_to_displays(saved, &[LAPTOP], MINIMUM), Some(LAPTOP));
    let tall = Frame { x: 300.0, y: 40.0, width: 1000.0, height: 1300.0 };
    assert_eq!(
      fit_to_displays(tall, &[LAPTOP], MINIMUM),
      Some(Frame { x: 300.0, y: 25.0, width: 1000.0, height: 875.0 })
    );
  }

  #[test]
  fn a_frame_mostly_off_screen_is_pulled_back_within_reach() {
    let low = Frame { x: 1400.0, y: 890.0, width: 900.0, height: 600.0 };
    let fitted = fit_to_displays(low, &[LAPTOP], MINIMUM).expect("touches the laptop display");
    assert_eq!(fitted.x, 1440.0 - REACHABLE_WIDTH);
    assert_eq!(fitted.y, 900.0 - REACHABLE_HEIGHT);
    let high = Frame { x: -850.0, y: -300.0, width: 900.0, height: 600.0 };
    let fitted = fit_to_displays(high, &[LAPTOP], MINIMUM).expect("touches the laptop display");
    assert_eq!(fitted.x, REACHABLE_WIDTH - 900.0);
    assert_eq!(fitted.y, 25.0);
  }

  #[test]
  fn a_frame_smaller_than_the_minimum_grows_to_it() {
    let saved = Frame { x: 100.0, y: 100.0, width: 300.0, height: 200.0 };
    let fitted = fit_to_displays(saved, &[LAPTOP], MINIMUM).expect("on the laptop display");
    assert_eq!((fitted.width, fitted.height), MINIMUM);
  }

  #[test]
  fn a_resized_window_is_centred_on_its_display_above_the_middle() {
    let placed = centred_in(LEFT_MONITOR, 1400.0, 900.0);
    assert_eq!((placed.x, placed.y), (-1660.0, 60.0));
  }

  #[test]
  fn the_saved_file_format_reads_back_and_tolerates_a_missing_flag() {
    let saved = SavedWindow { frame: Frame { x: -10.5, y: 30.0, width: 1200.0, height: 800.0 }, maximized: true };
    let text = serde_json::to_string(&saved).expect("serialises");
    assert_eq!(serde_json::from_str::<SavedWindow>(&text).expect("reads back"), saved);
    let older: SavedWindow = serde_json::from_str(r#"{"frame":{"x":1,"y":2,"width":900,"height":700}}"#).expect("reads without the flag");
    assert!(!older.maximized);
  }
}
