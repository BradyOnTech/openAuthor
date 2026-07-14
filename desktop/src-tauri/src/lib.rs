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

fn python_candidates(project_root: &PathBuf) -> Vec<String> {
  let mut candidates: Vec<String> = Vec::new();

  if let Ok(explicit) = env::var("OPENAUTHOR_PYTHON_BIN") {
    let trimmed = explicit.trim();
    if !trimmed.is_empty() {
      candidates.push(trimmed.to_string());
    }
  }

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
  let mut command = Command::new(python_bin);
  command
    .arg("-m")
    .arg("openauthor")
    .args(args)
    .current_dir(project_root);

  if let Some(root) = repo_root() {
    let root_str = root.to_string_lossy().to_string();
    let combined_pythonpath = match env::var("PYTHONPATH") {
      Ok(existing) if !existing.trim().is_empty() => {
        format!("{}{}{}", root_str, path_separator(), existing)
      }
      _ => root_str,
    };
    command.env("PYTHONPATH", combined_pythonpath);
  }

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

fn combined_pythonpath() -> Option<String> {
  let root = repo_root()?;
  let root_str = root.to_string_lossy().to_string();
  Some(match env::var("PYTHONPATH") {
    Ok(existing) if !existing.trim().is_empty() => {
      format!("{}{}{}", root_str, path_separator(), existing)
    }
    _ => root_str,
  })
}

fn resolve_sidecar_python(project_root: &PathBuf) -> Result<String, String> {
  for candidate in python_candidates(project_root) {
    let mut probe = Command::new(&candidate);
    probe
      .arg("-c")
      .arg("import openauthor")
      .current_dir(project_root)
      .stdout(Stdio::null())
      .stderr(Stdio::null());
    if let Some(pythonpath) = combined_pythonpath() {
      probe.env("PYTHONPATH", pythonpath);
    }
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
  let mut command = Command::new(&python_bin);
  command
    .arg("-m")
    .arg("openauthor")
    .arg("serve")
    .current_dir(project_root)
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::null());
  if let Some(pythonpath) = combined_pythonpath() {
    command.env("PYTHONPATH", pythonpath);
  }
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
      pick_zip_file
    ])
    .run(tauri::generate_context!())
    .expect("error while running openAuthor desktop");
}
