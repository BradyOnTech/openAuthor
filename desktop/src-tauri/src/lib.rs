use serde::Serialize;
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

fn validate_core_args(args: &[String]) -> Result<(), String> {
  if args.is_empty() {
    return Err("No command arguments provided.".to_string());
  }
  let allowed = ["init", "scene", "codex", "proposal", "snapshot"];
  if allowed.contains(&args[0].as_str()) {
    Ok(())
  } else {
    Err(format!("Unsupported command root: {}", args[0]))
  }
}

#[tauri::command]
fn project_status(project_root: String) -> Result<ProjectStatus, String> {
  let root = PathBuf::from(project_root.clone());
  let marker = root.join(".openauthor").join("project.json");
  Ok(ProjectStatus {
    found: marker.exists(),
    project_root,
  })
}

#[tauri::command]
fn core_command(project_root: String, args: Vec<String>) -> Result<CoreCommandResponse, String> {
  validate_core_args(&args)?;

  let output = Command::new("python3")
    .arg("-m")
    .arg("openauthor")
    .args(args)
    .current_dir(&project_root)
    .output()
    .map_err(|error| format!("Failed to execute python core: {error}"))?;

  let status = output.status.code().unwrap_or(-1);
  let stdout = String::from_utf8_lossy(&output.stdout).to_string();
  let stderr = String::from_utf8_lossy(&output.stderr).to_string();

  Ok(CoreCommandResponse {
    status,
    stdout,
    stderr,
  })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![project_status, core_command])
    .run(tauri::generate_context!())
    .expect("error while running openAuthor desktop");
}
