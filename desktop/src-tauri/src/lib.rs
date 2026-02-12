use serde::Serialize;
use std::env;
use std::path::PathBuf;
use std::process::Command;

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
  let output = Command::new(python_bin)
    .arg("-m")
    .arg("openauthor")
    .args(args)
    .current_dir(project_root)
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
    "scene",
    "codex",
    "proposal",
    "snapshot",
    "branch",
    "check",
    "retrieval",
    "generation",
    "chat",
  ];
  if allowed.contains(&args[0].as_str()) {
    Ok(())
  } else {
    Err(format!("Unsupported command root: {}", args[0]))
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
    .invoke_handler(tauri::generate_handler![project_status, core_command])
    .run(tauri::generate_context!())
    .expect("error while running openAuthor desktop");
}
