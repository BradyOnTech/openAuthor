from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import sys
import threading
import time
import webbrowser
from collections.abc import Callable
from pathlib import Path
from typing import Any


class CodexAppServerError(RuntimeError):
  pass


class CodexAppServerTimeout(CodexAppServerError):
  pass


class CodexAppServerUnavailable(CodexAppServerError):
  pass


DEFAULT_MODEL_SENTINELS = {
  "",
  "codex-default",
  "codex-mini-latest",
  "codex-recommended",
}
DEFAULT_REQUEST_TIMEOUT_SECONDS = 120.0
DEFAULT_LOGIN_TIMEOUT_SECONDS = 180.0
DEFAULT_ACCOUNT_READY_TIMEOUT_SECONDS = 15.0
ACCOUNT_READY_POLL_SECONDS = 0.25


def _configured_timeout(name: str, default: float) -> float:
  raw = os.getenv(name, "").strip()
  if raw == "":
    return default
  try:
    return max(1.0, float(raw))
  except ValueError:
    return default


def _codex_home() -> Path:
  configured = os.getenv("OPENAUTHOR_CODEX_HOME", "").strip()
  if configured:
    return Path(configured).expanduser().resolve()
  return (Path.home() / ".openauthor" / "codex").resolve()


def _codex_binary_candidates() -> list[Path]:
  candidates: list[Path] = []
  configured = os.getenv("OPENAUTHOR_CODEX_BIN", "").strip()
  if configured:
    candidates.append(Path(configured).expanduser())

  executable = Path(sys.executable).resolve()
  if len(executable.parents) >= 3:
    candidates.append(executable.parents[2] / "codex" / "bin" / "codex")

  repository_root = Path(__file__).resolve().parents[1]
  candidates.append(
    repository_root
    / "desktop"
    / "src-tauri"
    / "resources"
    / "runtime"
    / "codex"
    / "bin"
    / "codex"
  )

  discovered = shutil.which("codex")
  if discovered:
    candidates.append(Path(discovered))

  unique: list[Path] = []
  seen: set[str] = set()
  for candidate in candidates:
    key = str(candidate)
    if key in seen:
      continue
    seen.add(key)
    unique.append(candidate)
  return unique


def resolve_codex_binary() -> Path:
  for candidate in _codex_binary_candidates():
    if candidate.is_file() and os.access(candidate, os.X_OK):
      return candidate.resolve()
  raise CodexAppServerUnavailable(
    "Codex runtime is unavailable. Install Codex or set OPENAUTHOR_CODEX_BIN "
    "to an executable that supports 'codex app-server'."
  )


class CodexAppServer:
  def __init__(
    self,
    *,
    binary: Path | None = None,
    codex_home: Path | None = None,
    request_timeout: float | None = None,
  ) -> None:
    self.binary = binary or resolve_codex_binary()
    self.codex_home = (codex_home or _codex_home()).resolve()
    self.request_timeout = request_timeout or _configured_timeout(
      "OPENAUTHOR_CODEX_REQUEST_TIMEOUT_SECONDS",
      DEFAULT_REQUEST_TIMEOUT_SECONDS,
    )
    self._process: subprocess.Popen[str] | None = None
    self._messages: queue.Queue[dict[str, Any] | None] = queue.Queue()
    self._stderr_lines: list[str] = []
    self._request_id = 0

  def __enter__(self) -> CodexAppServer:
    self.start()
    return self

  def __exit__(self, exc_type: Any, exc: Any, traceback: Any) -> None:
    self.close()

  def start(self) -> None:
    if self._process is not None:
      return
    self.codex_home.mkdir(parents=True, exist_ok=True)
    try:
      os.chmod(self.codex_home, 0o700)
    except OSError:
      pass
    environment = os.environ.copy()
    environment["CODEX_HOME"] = str(self.codex_home)
    try:
      self._process = subprocess.Popen(
        [str(self.binary), "app-server", "--listen", "stdio://"],
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        bufsize=1,
        env=environment,
      )
    except OSError as error:
      raise CodexAppServerUnavailable(
        f"Unable to launch Codex app-server via {self.binary}: {error}"
      ) from error

    assert self._process.stdout is not None
    assert self._process.stderr is not None
    threading.Thread(
      target=self._read_stdout,
      args=(self._process.stdout,),
      daemon=True,
    ).start()
    threading.Thread(
      target=self._read_stderr,
      args=(self._process.stderr,),
      daemon=True,
    ).start()

    self.request(
      "initialize",
      {
        "clientInfo": {
          "name": "openauthor",
          "title": "openAuthor",
          "version": "0.1.0",
        },
        "capabilities": {"experimentalApi": True},
      },
    )
    self.notify("initialized", {})

  def close(self) -> None:
    process = self._process
    self._process = None
    if process is None:
      return
    if process.stdin is not None:
      try:
        process.stdin.close()
      except OSError:
        pass
    try:
      try:
        process.wait(timeout=2)
      except subprocess.TimeoutExpired:
        process.terminate()
        try:
          process.wait(timeout=2)
        except subprocess.TimeoutExpired:
          process.kill()
          process.wait(timeout=2)
    finally:
      for stream in (process.stdout, process.stderr):
        if stream is not None:
          try:
            stream.close()
          except OSError:
            pass

  def _read_stdout(self, stream: Any) -> None:
    try:
      for line in stream:
        clean = line.strip()
        if clean == "":
          continue
        try:
          payload = json.loads(clean)
        except json.JSONDecodeError:
          continue
        if isinstance(payload, dict):
          self._messages.put(payload)
    finally:
      self._messages.put(None)

  def _read_stderr(self, stream: Any) -> None:
    for line in stream:
      clean = line.strip()
      if clean:
        self._stderr_lines.append(clean)
        if len(self._stderr_lines) > 40:
          del self._stderr_lines[: len(self._stderr_lines) - 40]

  def _send(self, payload: dict[str, Any]) -> None:
    process = self._process
    if process is None or process.stdin is None or process.poll() is not None:
      details = "\n".join(self._stderr_lines[-5:])
      suffix = f" Details: {details}" if details else ""
      raise CodexAppServerError(f"Codex app-server is not running.{suffix}")
    try:
      process.stdin.write(json.dumps(payload, ensure_ascii=True) + "\n")
      process.stdin.flush()
    except OSError as error:
      raise CodexAppServerError(
        f"Failed to send a request to Codex app-server: {error}"
      ) from error

  def notify(self, method: str, params: dict[str, Any]) -> None:
    self._send({"method": method, "params": params})

  def _next_message(self, *, deadline: float) -> dict[str, Any]:
    remaining = deadline - time.monotonic()
    if remaining <= 0:
      raise CodexAppServerTimeout("Timed out waiting for Codex app-server.")
    try:
      message = self._messages.get(timeout=remaining)
    except queue.Empty as error:
      raise CodexAppServerTimeout("Timed out waiting for Codex app-server.") from error
    if message is None:
      details = "\n".join(self._stderr_lines[-5:])
      suffix = f" Details: {details}" if details else ""
      raise CodexAppServerError(f"Codex app-server exited unexpectedly.{suffix}")
    return message

  def request(
    self,
    method: str,
    params: dict[str, Any] | None,
    *,
    on_message: Callable[[dict[str, Any]], None] | None = None,
    on_server_request: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    timeout: float | None = None,
  ) -> dict[str, Any]:
    self._request_id += 1
    request_id = self._request_id
    payload: dict[str, Any] = {"method": method, "id": request_id}
    if params is not None:
      payload["params"] = params
    self._send(payload)
    deadline = time.monotonic() + (timeout or self.request_timeout)
    while True:
      message = self._next_message(deadline=deadline)
      if message.get("id") == request_id:
        error = message.get("error")
        if isinstance(error, dict):
          raise CodexAppServerError(
            f"Codex app-server rejected {method}: {error.get('message', error)}"
          )
        result = message.get("result", {})
        return result if isinstance(result, dict) else {"value": result}
      if "id" in message and "method" in message:
        if on_server_request is None:
          self._send({
            "id": message["id"],
            "error": {"code": -32601, "message": "Unsupported server request"},
          })
        else:
          self._send({"id": message["id"], "result": on_server_request(message)})
      if on_message is not None:
        on_message(message)

  def wait_for(
    self,
    predicate: Callable[[dict[str, Any]], bool],
    *,
    on_message: Callable[[dict[str, Any]], None] | None = None,
    on_server_request: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
    timeout: float | None = None,
  ) -> dict[str, Any]:
    deadline = time.monotonic() + (timeout or self.request_timeout)
    while True:
      message = self._next_message(deadline=deadline)
      if "id" in message and "method" in message:
        if on_server_request is None:
          self._send({
            "id": message["id"],
            "error": {"code": -32601, "message": "Unsupported server request"},
          })
        else:
          self._send({"id": message["id"], "result": on_server_request(message)})
      if on_message is not None:
        on_message(message)
      if predicate(message):
        return message

  def account_status(self, *, refresh: bool = True) -> dict[str, Any]:
    result = self.request("account/read", {"refreshToken": refresh})
    account = result.get("account")
    if not isinstance(account, dict):
      return {
        "authenticated": False,
        "available": True,
        "requires_openai_auth": bool(result.get("requiresOpenaiAuth", True)),
      }
    account_type = str(account.get("type", ""))
    return {
      "authenticated": account_type == "chatgpt",
      "available": True,
      "auth_method": account_type,
      "email": str(account.get("email") or ""),
      "plan_type": str(account.get("planType") or "unknown"),
      "requires_openai_auth": bool(result.get("requiresOpenaiAuth", True)),
    }

  def login_chatgpt(self) -> dict[str, Any]:
    response = self.request(
      "account/login/start",
      {"type": "chatgpt", "codexStreamlinedLogin": True},
    )
    login_id = str(response.get("loginId", ""))
    auth_url = str(response.get("authUrl", ""))
    if login_id == "" or auth_url == "":
      raise CodexAppServerError("Codex app-server did not return a ChatGPT login URL.")
    if not webbrowser.open(auth_url):
      raise CodexAppServerError(
        f"Could not open the ChatGPT login page automatically. Open this URL: {auth_url}"
      )

    timeout = _configured_timeout(
      "OPENAUTHOR_CODEX_LOGIN_TIMEOUT_SECONDS",
      DEFAULT_LOGIN_TIMEOUT_SECONDS,
    )
    account_updated = False

    def observe_account_update(message: dict[str, Any]) -> None:
      nonlocal account_updated
      if message.get("method") != "account/updated":
        return
      params = message.get("params", {})
      account_updated = (
        isinstance(params, dict) and str(params.get("authMode") or "") == "chatgpt"
      )

    def completed(message: dict[str, Any]) -> bool:
      if message.get("method") != "account/login/completed":
        return False
      params = message.get("params", {})
      return isinstance(params, dict) and str(params.get("loginId") or "") == login_id

    notification = self.wait_for(
      completed,
      on_message=observe_account_update,
      timeout=timeout,
    )
    params = notification.get("params", {})
    if not isinstance(params, dict) or not bool(params.get("success")):
      error = str(params.get("error") or "ChatGPT sign-in was not completed.")
      raise CodexAppServerError(error)

    ready_timeout = _configured_timeout(
      "OPENAUTHOR_CODEX_ACCOUNT_READY_TIMEOUT_SECONDS",
      DEFAULT_ACCOUNT_READY_TIMEOUT_SECONDS,
    )
    ready_deadline = time.monotonic() + ready_timeout
    while True:
      status = self.account_status(refresh=True)
      if bool(status.get("authenticated")):
        return status

      remaining = ready_deadline - time.monotonic()
      if remaining <= 0:
        raise CodexAppServerError(
          "ChatGPT sign-in completed, but the Codex account did not become ready. "
          "Try signing in again."
        )

      if account_updated:
        time.sleep(min(ACCOUNT_READY_POLL_SECONDS, remaining))
        continue

      try:
        self.wait_for(
          lambda message: (
            message.get("method") == "account/updated"
            and isinstance(message.get("params"), dict)
            and str(message["params"].get("authMode") or "") == "chatgpt"
          ),
          on_message=observe_account_update,
          timeout=min(ACCOUNT_READY_POLL_SECONDS, remaining),
        )
      except CodexAppServerTimeout:
        continue

  def logout(self) -> bool:
    before = self.account_status(refresh=False)
    self.request("account/logout", None)
    return bool(before.get("auth_method"))

  def complete(
    self,
    *,
    project_root: Path,
    model: str,
    system_prompt: str,
    history: list[dict[str, Any]],
    user_prompt: str,
    max_output_tokens: int,
    on_delta: Callable[[str], None] | None,
    tools: list[dict[str, Any]] | None,
  ) -> dict[str, Any]:
    dynamic_tools = [
      {
        "type": "function",
        "name": str(tool.get("name", "")),
        "description": str(tool.get("description", "")),
        "inputSchema": tool.get("parameters", {}),
      }
      for tool in tools or []
    ]
    developer_instructions = (
      f"{system_prompt.strip()}\n\n"
      "You are running inside openAuthor as a writing collaborator. Do not run shell "
      "commands, edit files, or call built-in Codex tools. Use only the openAuthor "
      "tools explicitly supplied by the host when tools are available. Keep the final "
      f"answer within roughly {max_output_tokens} tokens."
    )
    if dynamic_tools:
      developer_instructions += (
        " When an openAuthor tool returns that execution is deferred to the host, "
        "end the response immediately; the host will run or review it and continue "
        "the conversation with the result."
      )

    thread_params: dict[str, Any] = {
      "cwd": str(project_root.resolve()),
      "approvalPolicy": "never",
      "sandbox": "read-only",
      "environments": [],
      "config": {
        "web_search": "disabled",
        "features": {
          "apps": False,
          "goals": False,
          "hooks": False,
          "multi_agent": False,
          "remote_plugin": False,
          "shell_tool": False,
          "unified_exec": False,
        },
      },
      "ephemeral": True,
      "developerInstructions": developer_instructions,
    }
    if model.strip() not in DEFAULT_MODEL_SENTINELS:
      thread_params["model"] = model.strip()
    if dynamic_tools:
      thread_params["dynamicTools"] = dynamic_tools

    thread_result = self.request("thread/start", thread_params)
    thread = thread_result.get("thread", {})
    thread_id = str(thread.get("id", "")) if isinstance(thread, dict) else ""
    if thread_id == "":
      raise CodexAppServerError("Codex app-server did not create a thread.")

    conversation = json.dumps(history, ensure_ascii=False, indent=2)
    turn_input = (
      "Prior conversation (JSON; preserve role order and tool results):\n"
      f"{conversation}\n\n"
      "Current request:\n"
      f"{user_prompt}"
    )
    final_messages: dict[str, str] = {}
    streamed_parts: dict[str, list[str]] = {}
    tool_calls: list[dict[str, Any]] = []
    token_usage: dict[str, Any] = {}
    turn_error = ""

    def handle_server_request(message: dict[str, Any]) -> dict[str, Any]:
      if message.get("method") != "item/tool/call":
        return {}
      params = message.get("params", {})
      if not isinstance(params, dict):
        return {
          "contentItems": [{"type": "inputText", "text": "Invalid tool request."}],
          "success": False,
        }
      arguments = params.get("arguments", {})
      if not isinstance(arguments, dict):
        arguments = {}
      tool_calls.append({
        "id": str(params.get("callId") or f"call-{len(tool_calls) + 1}"),
        "name": str(params.get("tool", "")),
        "args": arguments,
      })
      return {
        "contentItems": [{
          "type": "inputText",
          "text": "Execution is deferred to the openAuthor host. End this response now.",
        }],
        "success": True,
      }

    def handle_message(message: dict[str, Any]) -> None:
      nonlocal token_usage, turn_error
      method = message.get("method")
      params = message.get("params", {})
      if not isinstance(params, dict):
        return
      if method == "item/agentMessage/delta":
        item_id = str(params.get("itemId", ""))
        delta = str(params.get("delta", ""))
        if delta:
          streamed_parts.setdefault(item_id, []).append(delta)
          if on_delta is not None and not dynamic_tools:
            on_delta(delta)
      elif method == "item/completed":
        item = params.get("item", {})
        if isinstance(item, dict) and item.get("type") == "agentMessage":
          final_messages[str(item.get("id", ""))] = str(item.get("text", ""))
      elif method == "thread/tokenUsage/updated":
        usage = params.get("tokenUsage", {})
        if isinstance(usage, dict):
          token_usage = usage
      elif method == "turn/completed":
        turn = params.get("turn", {})
        if isinstance(turn, dict) and turn.get("status") == "failed":
          error = turn.get("error", {})
          turn_error = str(error.get("message", error)) if isinstance(error, dict) else str(error)

    turn_result = self.request(
      "turn/start",
      {
        "threadId": thread_id,
        "input": [{"type": "text", "text": turn_input, "text_elements": []}],
      },
      on_message=handle_message,
      on_server_request=handle_server_request,
    )
    turn = turn_result.get("turn", {})
    turn_id = str(turn.get("id", "")) if isinstance(turn, dict) else ""

    def turn_completed(message: dict[str, Any]) -> bool:
      if message.get("method") != "turn/completed":
        return False
      params = message.get("params", {})
      if not isinstance(params, dict):
        return False
      completed_turn = params.get("turn", {})
      return isinstance(completed_turn, dict) and str(completed_turn.get("id", "")) == turn_id

    self.wait_for(
      turn_completed,
      on_message=handle_message,
      on_server_request=handle_server_request,
    )
    if turn_error:
      raise CodexAppServerError(f"Codex turn failed: {turn_error}")

    text_parts = [text for text in final_messages.values() if text.strip()]
    if text_parts:
      text = "\n\n".join(text_parts).strip()
    else:
      text = "\n\n".join(
        "".join(parts).strip() for parts in streamed_parts.values() if parts
      ).strip()
    last_usage = token_usage.get("last", {}) if isinstance(token_usage, dict) else {}
    if not isinstance(last_usage, dict):
      last_usage = {}
    return {
      "text": text,
      "tool_calls": tool_calls,
      "input_tokens": int(last_usage.get("inputTokens", 0) or 0),
      "output_tokens": int(last_usage.get("outputTokens", 0) or 0),
      "raw_usage": token_usage,
      "attempts": 1,
      "model": str(thread_result.get("model", model)),
    }
