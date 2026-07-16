use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::env;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, State};

#[derive(Serialize)]
struct CoreCommandResponse {
  status: i32,
  stdout: String,
  stderr: String,
}

#[derive(Serialize)]
struct ProjectStatus {
  found: bool,
  project_root: String,
}

fn resolve_project_root(input: &str) -> PathBuf {
  let trimmed = input.trim();
  if trimmed.is_empty() {
    return PathBuf::new();
  }

  let expanded = if trimmed == "~" || trimmed.starts_with("~/") {
    if let Ok(home) = env::var("HOME") {
      if trimmed == "~" {
        PathBuf::from(home)
      } else {
        PathBuf::from(home).join(trimmed.trim_start_matches("~/"))
      }
    } else {
      PathBuf::from(trimmed)
    }
  } else {
    PathBuf::from(trimmed)
  };

  if expanded.is_relative() {
    if let Ok(cwd) = env::current_dir() {
      return cwd.join(expanded);
    }
  }
  expanded
}

fn repo_root() -> Option<PathBuf> {
  let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
  manifest_dir.parent()?.parent().map(|path| path.to_path_buf())
}

fn path_separator() -> &'static str {
  if cfg!(windows) {
    ";"
  } else {
    ":"
  }
}

fn bundled_python_candidates_for(
  runtime_dir: Option<&str>,
  executable: Option<&PathBuf>,
) -> Vec<String> {
  let mut candidates = Vec::new();

  if let Some(runtime_dir) = runtime_dir {
    let trimmed = runtime_dir.trim();
    if !trimmed.is_empty() {
      let runtime_python = PathBuf::from(trimmed).join("python").join("bin").join("python3");
      if runtime_python.exists() {
        candidates.push(runtime_python.to_string_lossy().to_string());
      }
    }
  }

  if let Some(executable) = executable {
    if let Some(bin_dir) = executable.parent() {
      let app_resource_python = bin_dir
        .join("..")
        .join("Resources")
        .join("resources")
        .join("runtime")
        .join("python")
        .join("bin")
        .join("python3");
      if app_resource_python.exists() {
        candidates.push(app_resource_python.to_string_lossy().to_string());
      }

      let adjacent_python = bin_dir
        .join("runtime")
        .join("python")
        .join("bin")
        .join("python3");
      if adjacent_python.exists() {
        candidates.push(adjacent_python.to_string_lossy().to_string());
      }
    }
  }

  candidates
}

fn bundled_python_candidates() -> Vec<String> {
  let runtime_dir = env::var("OPENAUTHOR_RUNTIME_DIR").ok();
  let executable = env::current_exe().ok();
  bundled_python_candidates_for(runtime_dir.as_deref(), executable.as_ref())
}

fn configure_runtime_environment(command: &mut Command) {
  if cfg!(target_os = "macos") {
    // A process launched from a GUI app inherits the app's XPC identity.
    // python-build-standalone treats that identity as a GUI launch and can
    // block during interpreter startup while macOS restores app state.
    // Core workers are ordinary command-line children, so strip GUI identity.
    command.env_remove("XPC_SERVICE_NAME");
    command.env_remove("__CFBundleIdentifier");
    for key in ["LANG", "LC_ALL", "LC_CTYPE"] {
      if env::var(key).map(|value| value == "C.UTF-8").unwrap_or(false) {
        command.env(key, "en_US.UTF-8");
      }
    }
  }
}

fn python_command(python_bin: &str, project_root: &PathBuf) -> Command {
  if cfg!(target_os = "macos") {
    // std::process may fall back to fork+exec when current_dir is set. Forking
    // a multi-threaded AppKit/WebKit process can leave the child holding a
    // copied macOS framework lock before Python initializes its codecs. Start
    // a clean shell through posix_spawn, change directory there, then exec.
    let mut command = Command::new("/bin/sh");
    command
      .arg("-c")
      .arg("cd -- \"$1\" && shift && exec \"$@\"")
      .arg("openauthor-core-launcher")
      .arg(project_root)
      .arg(python_bin);
    command
  } else {
    let mut command = Command::new(python_bin);
    command.current_dir(project_root);
    command
  }
}

fn configure_python_imports(command: &mut Command, python_bin: &str) {
  let binary = PathBuf::from(python_bin);
  let bundled_home = binary.parent().and_then(|bin| bin.parent()).filter(|home| {
    home.join("openauthor-runtime.json").exists()
      || home.to_string_lossy().contains("resources/runtime/python")
  });
  if let Some(home) = bundled_home {
    command.env_remove("PYTHONPATH");
    command.env("PYTHONHOME", home);
    command.env("PYTHONNOUSERSITE", "1");
    command.env("PYTHONSAFEPATH", "1");
  } else if let Some(root) = repo_root() {
    let root_str = root.to_string_lossy().to_string();
    let combined_pythonpath = match env::var("PYTHONPATH") {
      Ok(existing) if !existing.trim().is_empty() => {
        format!("{}{}{}", root_str, path_separator(), existing)
      }
      _ => root_str,
    };
    command.env("PYTHONPATH", combined_pythonpath);
  }
}

fn python_candidates(project_root: &PathBuf) -> Vec<String> {
  let mut candidates: Vec<String> = Vec::new();

  if let Ok(explicit) = env::var("OPENAUTHOR_PYTHON_BIN") {
    let trimmed = explicit.trim();
    if !trimmed.is_empty() {
      candidates.push(trimmed.to_string());
    }
  }

  candidates.extend(bundled_python_candidates());

  if let Ok(venv) = env::var("VIRTUAL_ENV") {
    let venv_python = PathBuf::from(venv).join("bin").join("python3");
    if venv_python.exists() {
      candidates.push(venv_python.to_string_lossy().to_string());
    }
  }

  let project_venv = project_root.join(".venv").join("bin").join("python3");
  if project_venv.exists() {
    candidates.push(project_venv.to_string_lossy().to_string());
  }

  if let Some(root) = repo_root() {
    let repo_venv = root.join(".venv").join("bin").join("python3");
    if repo_venv.exists() {
      candidates.push(repo_venv.to_string_lossy().to_string());
    }
  }

  candidates.push("python3".to_string());
  candidates.push("python".to_string());
  candidates.dedup();
  candidates
}

fn run_core_with_python(
  python_bin: &str,
  project_root: &PathBuf,
  args: &[String],
) -> Result<CoreCommandResponse, String> {
  let mut command = python_command(python_bin, project_root);
  configure_runtime_environment(&mut command);
  configure_python_imports(&mut command, python_bin);
  command
    .arg("-m")
    .arg("openauthor")
    .args(args);

  let output = command
    .output()
    .map_err(|error| format!("Failed to execute python core via '{python_bin}': {error}"))?;

  let status = output.status.code().unwrap_or(-1);
  let stdout = String::from_utf8_lossy(&output.stdout).to_string();
  let stderr = String::from_utf8_lossy(&output.stderr).to_string();
  Ok(CoreCommandResponse {
    status,
    stdout,
    stderr,
  })
}

fn is_missing_module(response: &CoreCommandResponse) -> bool {
  let stderr = response.stderr.to_lowercase();
  stderr.contains("no module named openauthor")
}

fn validate_core_args(args: &[String]) -> Result<(), String> {
  if args.is_empty() {
    return Err("No command arguments provided.".to_string());
  }
  let allowed = [
    "init",
    "project",
    "scene",
    "codex",
    "proposal",
    "snapshot",
    "branch",
    "check",
    "retrieval",
    "generation",
    "chat",
    "auth",
    "manuscript",
    "revision",
    "plan",
    "memory",
    "search",
    "pass",
    "storyline",
    "style",
    "metrics",
  ];
  if allowed.contains(&args[0].as_str()) {
    Ok(())
  } else {
    Err(format!("Unsupported command root: {}", args[0]))
  }
}

const SIDECAR_EVENT_CHANNEL: &str = "openauthor://sidecar-event";
const SIDECAR_DEFAULT_TIMEOUT_MS: u64 = 300_000;

struct SidecarHandle {
  stdin: Mutex<ChildStdin>,
  pending: Arc<Mutex<HashMap<String, mpsc::Sender<Value>>>>,
  alive: Arc<AtomicBool>,
}

#[derive(Default)]
struct SidecarRegistry(Mutex<HashMap<String, Arc<SidecarHandle>>>);

fn resolve_sidecar_python(project_root: &PathBuf) -> Result<String, String> {
  for candidate in python_candidates(project_root) {
    // Use the same posix_spawn-safe launcher as normal core commands. A
    // direct Command with current_dir can hang when spawned by AppKit,
    // leaving every Assistant request waiting behind the probe.
    let mut probe = python_command(&candidate, project_root);
    configure_runtime_environment(&mut probe);
    configure_python_imports(&mut probe, &candidate);
    probe
      .arg("-c")
      .arg("import openauthor")
      .stdout(Stdio::null())
      .stderr(Stdio::null());
    if let Ok(status) = probe.status() {
      if status.success() {
        return Ok(candidate);
      }
    }
  }
  Err("No python interpreter with the openauthor module was found.".to_string())
}

fn frame_id_key(id: &Value) -> String {
  match id {
    Value::String(text) => text.clone(),
    other => other.to_string(),
  }
}

fn spawn_sidecar(
  app: AppHandle,
  project_root: &PathBuf,
  registry_key: String,
) -> Result<Arc<SidecarHandle>, String> {
  let python_bin = resolve_sidecar_python(project_root)?;
  let mut command = python_command(&python_bin, project_root);
  configure_runtime_environment(&mut command);
  configure_python_imports(&mut command, &python_bin);
  command
    .arg("-m")
    .arg("openauthor")
    .arg("serve")
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
  let mut child = command
    .spawn()
    .map_err(|error| format!("Failed to spawn sidecar via '{python_bin}': {error}"))?;

  let stdin = child
    .stdin
    .take()
    .ok_or_else(|| "Sidecar stdin unavailable.".to_string())?;
  let stdout = child
    .stdout
    .take()
    .ok_or_else(|| "Sidecar stdout unavailable.".to_string())?;

  let handle = Arc::new(SidecarHandle {
    stdin: Mutex::new(stdin),
    pending: Arc::new(Mutex::new(HashMap::new())),
    alive: Arc::new(AtomicBool::new(true)),
  });

  let reader_handle = handle.clone();
  std::thread::spawn(move || {
    let mut lines = BufReader::new(stdout).lines();
    while let Some(Ok(line)) = lines.next() {
      let trimmed = line.trim();
      if trimmed.is_empty() {
        continue;
      }
      let frame: Value = match serde_json::from_str(trimmed) {
        Ok(value) => value,
        Err(_) => continue,
      };
      if frame.get("event").is_some() {
        let _ = app.emit(
          SIDECAR_EVENT_CHANNEL,
          serde_json::json!({ "projectRoot": registry_key, "frame": frame }),
        );
        continue;
      }
      if let Some(id) = frame.get("id") {
        let id_key = frame_id_key(id);
        let sender = reader_handle.pending.lock().unwrap().remove(&id_key);
        if let Some(sender) = sender {
          let _ = sender.send(frame);
        }
      }
    }
    reader_handle.alive.store(false, Ordering::SeqCst);
    reader_handle.pending.lock().unwrap().clear();
    let registry = app.state::<SidecarRegistry>();
    let mut map = registry.0.lock().unwrap();
    if let Some(current) = map.get(&registry_key) {
      if Arc::ptr_eq(current, &reader_handle) {
        map.remove(&registry_key);
      }
    }
    drop(map);
    let _ = child.wait();
  });

  Ok(handle)
}

#[tauri::command]
async fn sidecar_request(
  app: AppHandle,
  registry: State<'_, SidecarRegistry>,
  project_root: String,
  request: Value,
  timeout_ms: Option<u64>,
) -> Result<Value, String> {
  let root = resolve_project_root(&project_root);
  if !root.exists() {
    return Err(format!(
      "Project root does not exist: {}",
      root.to_string_lossy()
    ));
  }
  let id = request
    .get("id")
    .ok_or_else(|| "Sidecar request frame requires an id.".to_string())?;
  let id_key = frame_id_key(id);
  let registry_key = root.to_string_lossy().to_string();

  let handle = {
    let mut map = registry.0.lock().unwrap();
    match map.get(&registry_key) {
      Some(existing) if existing.alive.load(Ordering::SeqCst) => existing.clone(),
      _ => {
        let spawned = spawn_sidecar(app.clone(), &root, registry_key.clone())?;
        map.insert(registry_key.clone(), spawned.clone());
        spawned
      }
    }
  };

  let (sender, receiver) = mpsc::channel::<Value>();
  handle.pending.lock().unwrap().insert(id_key.clone(), sender);

  let line = serde_json::to_string(&request)
    .map_err(|error| format!("Failed to encode sidecar request: {error}"))?;
  {
    let mut stdin = handle.stdin.lock().unwrap();
    if let Err(error) = stdin
      .write_all(line.as_bytes())
      .and_then(|_| stdin.write_all(b"\n"))
      .and_then(|_| stdin.flush())
    {
      handle.pending.lock().unwrap().remove(&id_key);
      handle.alive.store(false, Ordering::SeqCst);
      return Err(format!("Failed to write to sidecar: {error}"));
    }
  }

  let timeout = Duration::from_millis(timeout_ms.unwrap_or(SIDECAR_DEFAULT_TIMEOUT_MS));
  let outcome =
    tauri::async_runtime::spawn_blocking(move || receiver.recv_timeout(timeout))
      .await
      .map_err(|error| format!("Sidecar wait failed: {error}"))?;
  match outcome {
    Ok(frame) => Ok(frame),
    Err(mpsc::RecvTimeoutError::Timeout) => {
      handle.pending.lock().unwrap().remove(&id_key);
      Err("Sidecar request timed out.".to_string())
    }
    Err(mpsc::RecvTimeoutError::Disconnected) => {
      Err("Sidecar exited before responding.".to_string())
    }
  }
}

#[tauri::command]
fn pick_folder(starting_path: Option<String>) -> Result<Option<String>, String> {
  let mut dialog = rfd::FileDialog::new();
  if let Some(raw_starting_path) = starting_path {
    let resolved = resolve_project_root(&raw_starting_path);
    if resolved.exists() {
      dialog = dialog.set_directory(resolved);
    }
  }
  Ok(dialog
    .pick_folder()
    .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn pick_zip_file(starting_path: Option<String>) -> Result<Option<String>, String> {
  let mut dialog = rfd::FileDialog::new().add_filter("Zip Archive", &["zip"]);
  if let Some(raw_starting_path) = starting_path {
    let resolved = resolve_project_root(&raw_starting_path);
    if resolved.exists() {
      let directory = if resolved.is_dir() {
        resolved
      } else {
        resolved.parent().map_or(resolved.clone(), |parent| parent.to_path_buf())
      };
      dialog = dialog.set_directory(directory);
    }
  }
  Ok(dialog
    .pick_file()
    .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn pick_manuscript_file(starting_path: Option<String>) -> Result<Option<String>, String> {
  let mut dialog = rfd::FileDialog::new()
    .add_filter("Manuscript", &["md", "markdown", "txt", "docx", "scrivx"]);
  if let Some(raw_starting_path) = starting_path {
    let resolved = resolve_project_root(&raw_starting_path);
    if resolved.exists() {
      let directory = if resolved.is_dir() {
        resolved
      } else {
        resolved.parent().map_or(resolved.clone(), |parent| parent.to_path_buf())
      };
      dialog = dialog.set_directory(directory);
    }
  }
  Ok(dialog.pick_file().map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
fn pick_export_target(format: String, starting_path: Option<String>) -> Result<Option<String>, String> {
  let mut dialog = rfd::FileDialog::new();
  if let Some(raw_starting_path) = starting_path {
    let resolved = resolve_project_root(&raw_starting_path);
    if resolved.exists() {
      let directory = if resolved.is_dir() {
        resolved
      } else {
        resolved.parent().map_or(resolved.clone(), |parent| parent.to_path_buf())
      };
      dialog = dialog.set_directory(directory);
    }
  }
  if format == "docx" {
    Ok(dialog
      .add_filter("Word Document", &["docx"])
      .set_file_name("manuscript.docx")
      .save_file()
      .map(|path| path.to_string_lossy().to_string()))
  } else if format == "markdown" {
    Ok(dialog.pick_folder().map(|path| path.to_string_lossy().to_string()))
  } else {
    Err("Export format must be markdown or docx.".to_string())
  }
}

#[tauri::command]
fn project_status(project_root: String) -> Result<ProjectStatus, String> {
  let root = resolve_project_root(&project_root);
  let marker = root.join(".openauthor").join("project.json");
  Ok(ProjectStatus {
    found: marker.exists(),
    project_root: root.to_string_lossy().to_string(),
  })
}

#[tauri::command]
fn core_command(project_root: String, args: Vec<String>) -> Result<CoreCommandResponse, String> {
  validate_core_args(&args)?;
  let root = resolve_project_root(&project_root);
  if !root.exists() {
    return Err(format!("Project root does not exist: {}", root.to_string_lossy()));
  }

  let mut last_response: Option<CoreCommandResponse> = None;
  let mut spawn_errors: Vec<String> = Vec::new();
  for python_bin in python_candidates(&root) {
    match run_core_with_python(&python_bin, &root, &args) {
      Ok(response) => {
        if response.status == 0 {
          return Ok(response);
        }
        if is_missing_module(&response) {
          last_response = Some(response);
          continue;
        }
        return Ok(response);
      }
      Err(error) => spawn_errors.push(error),
    }
  }

  if let Some(response) = last_response {
    return Ok(response);
  }

  Err(
    if spawn_errors.is_empty() {
      "Unable to execute python core.".to_string()
    } else {
      spawn_errors.join(" | ")
    },
  )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .manage(SidecarRegistry::default())
    .invoke_handler(tauri::generate_handler![
      project_status,
      core_command,
      sidecar_request,
      pick_folder,
      pick_zip_file,
      pick_manuscript_file,
      pick_export_target
    ])
    .run(tauri::generate_context!())
    .expect("error while running openAuthor desktop");
}

#[cfg(test)]
mod tests {
  use super::*;
  use serde_json::Value;
  use std::fs;
  use std::time::{SystemTime, UNIX_EPOCH};

  fn temporary_project_root(label: &str) -> PathBuf {
    let nonce = SystemTime::now()
      .duration_since(UNIX_EPOCH)
      .expect("system clock")
      .as_nanos();
    let root = env::temp_dir().join(format!("openauthor-native-{label}-{nonce}"));
    fs::create_dir_all(&root).expect("create temporary project root");
    root
  }

  fn command(root: &PathBuf, args: &[&str]) -> CoreCommandResponse {
    core_command(
      root.to_string_lossy().to_string(),
      args.iter().map(|item| item.to_string()).collect(),
    )
    .expect("Tauri core command bridge")
  }

  fn json_output(response: CoreCommandResponse) -> Value {
    assert_eq!(response.status, 0, "core stderr: {}", response.stderr);
    serde_json::from_str(response.stdout.trim()).expect("valid core JSON")
  }

  #[test]
  fn native_bridge_completes_project_scene_and_proposal_flow() {
    let root = temporary_project_root("golden-flow");

    let initialized = json_output(command(
      &root,
      &["init", ".", "--name", "Native Product Flow", "--json"],
    ));
    assert_eq!(initialized["initialized"], true);

    let status = project_status(root.to_string_lossy().to_string()).expect("project status");
    assert!(status.found);

    let added = command(
      &root,
      &[
        "scene",
        "add",
        "--title",
        "The First Choice",
        "--summary",
        "A protagonist makes a consequential decision.",
        "--pov",
        "Mara",
        "--body",
        "At exactly midnight, Mara alone remembered the gate. She paused, but fear could not answer for her.",
      ],
    );
    assert_eq!(added.status, 0, "scene add stderr: {}", added.stderr);

    let scene = json_output(command(
      &root,
      &["scene", "get", "--id", "scene-0001", "--json"],
    ));
    assert_eq!(scene["title"], "The First Choice");
    let original_body = scene["body"].as_str().expect("original scene body").to_string();

    let proposal = json_output(command(
      &root,
      &[
        "proposal",
        "generate",
        "--scene",
        "scene-0001",
        "--instruction",
        "Increase tension while preserving Mara's decisive voice.",
        "--provider",
        "local",
        "--json",
      ],
    ));
    let proposal_id = proposal["id"].as_str().expect("proposal id");

    let drafted = json_output(command(
      &root,
      &[
        "proposal",
        "draft",
        "--id",
        proposal_id,
        "--provider",
        "local",
        "--json",
      ],
    ));
    let drafted_body = drafted["proposed_body"]
      .as_str()
      .expect("drafted scene body")
      .to_string();
    assert!(drafted_body.len() > 20);

    let applied = json_output(command(
      &root,
      &["proposal", "apply", "--id", proposal_id, "--json"],
    ));
    assert_eq!(applied["applied_changes"], true);
    assert!(applied["pre_apply_snapshot"].as_str().unwrap_or("").len() >= 7);

    let final_scene = json_output(command(
      &root,
      &["scene", "get", "--id", "scene-0001", "--json"],
    ));
    assert_eq!(
      final_scene["body"].as_str().unwrap_or("").trim_end(),
      drafted_body.trim_end()
    );

    let undone = json_output(command(
      &root,
      &["proposal", "undo", "--id", proposal_id, "--json"],
    ));
    assert!(undone["undo_revision"].as_str().unwrap_or("").len() >= 7);
    let restored_scene = json_output(command(
      &root,
      &["scene", "get", "--id", "scene-0001", "--json"],
    ));
    assert_eq!(
      restored_scene["body"].as_str().unwrap_or("").trim_end(),
      original_body.trim_end()
    );

    fs::remove_dir_all(root).expect("remove temporary project root");
  }

  #[test]
  fn native_bridge_rejects_unsupported_command_roots() {
    let error = validate_core_args(&["shell".to_string()]).expect_err("unsupported root");
    assert!(error.contains("Unsupported command root"));
  }

  #[test]
  fn native_bridge_allows_private_metrics_commands() {
    validate_core_args(&["metrics".to_string(), "dashboard".to_string()])
      .expect("metrics root should be available to the desktop dashboard");
  }

  #[test]
  fn bundled_runtime_override_is_preferred_over_system_python() {
    let root = temporary_project_root("bundled-runtime");
    let python = root.join("python").join("bin").join("python3");
    fs::create_dir_all(python.parent().expect("runtime bin")).expect("create runtime bin");
    fs::write(&python, "runtime placeholder").expect("write runtime placeholder");

    let runtime_dir = root.to_string_lossy().to_string();
    let candidates = bundled_python_candidates_for(Some(&runtime_dir), None);

    assert_eq!(candidates.first(), Some(&python.to_string_lossy().to_string()));
    fs::remove_dir_all(root).expect("remove temporary runtime");
  }

  #[cfg(target_os = "macos")]
  #[test]
  fn runtime_children_do_not_inherit_gui_xpc_identity() {
    let mut command = Command::new("/usr/bin/env");
    command.env("XPC_SERVICE_NAME", "application.com.openauthor.desktop.test");
    command.env("__CFBundleIdentifier", "com.openauthor.desktop");
    configure_runtime_environment(&mut command);
    let output = command.output().expect("environment probe");
    let environment = String::from_utf8_lossy(&output.stdout);
    assert!(!environment.contains("XPC_SERVICE_NAME="));
    assert!(!environment.contains("__CFBundleIdentifier="));
  }

  #[cfg(target_os = "macos")]
  #[test]
  fn python_launcher_changes_directory_after_spawn() {
    let root = temporary_project_root("launcher-cwd");
    let output = python_command("/bin/pwd", &root).output().expect("launcher output");
    assert!(output.status.success());
    assert_eq!(String::from_utf8_lossy(&output.stdout).trim(), root.to_string_lossy());
    fs::remove_dir_all(root).expect("remove launcher root");
  }
}
