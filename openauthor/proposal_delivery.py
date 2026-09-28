from __future__ import annotations

import hashlib
import inspect
import json
from contextvars import ContextVar
from functools import wraps
from typing import Any

from .project import OpenAuthorError, atomic_write_json
from .project_lock import project_write_lock
from .proposals import get_proposal

_delivery: ContextVar[dict[str, Any] | None] = ContextVar("proposal_delivery", default=None)


def current_proposal_delivery() -> dict[str, Any]:
  return dict(_delivery.get() or {})


def recoverable_proposal(kind: str):
  """Keep completed artifact identity across command response/process loss.

  The artifact itself records the receipt, so a crash before the final request
  checkpoint does not repeat a completed provider call. An unrecorded provider
  response may still require a paid retry; generation attempt logs remain intact.
  """
  def decorate(operation):
    signature = inspect.signature(operation)

    @wraps(operation)
    def deliver(paths, *, request_id: str = "", **kwargs):
      if not request_id:
        return operation(paths, **kwargs)
      if not isinstance(request_id, str) or len(request_id) > 256:
        raise OpenAuthorError("A generation request id must be at most 256 characters.")
      bound = signature.bind(paths, **kwargs)
      bound.apply_defaults()
      arguments = {key: value for key, value in bound.arguments.items() if key != "paths"}
      fingerprint = hashlib.sha256(json.dumps(arguments, sort_keys=True).encode()).hexdigest()
      key = hashlib.sha256(f"{kind}:{request_id}".encode()).hexdigest()
      proposal_id = f"proposal-{key[:24]}" if kind == "generate" else arguments["proposal_id"]
      receipt_path = paths.workspace_dir / "proposal-deliveries" / f"{key}.json"
      artifact_path = paths.proposals_dir / f"{proposal_id}.json"
      with project_write_lock(paths, resource="generation-" + key):
        if receipt_path.exists():
          receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
          if receipt.get("fingerprint") != fingerprint:
            raise OpenAuthorError("A generation request id cannot be reused for different inputs.")
        else:
          receipt = {"schema_version": 1, "key": key, "fingerprint": fingerprint, "proposal_id": proposal_id, "completed": False}
          if kind != "generate":
            receipt["initial_artifact_digest"] = hashlib.sha256(artifact_path.read_bytes()).hexdigest()
          atomic_write_json(receipt_path, receipt)
        if artifact_path.exists():
          artifact = get_proposal(paths, proposal_id)
          if kind == "hunk":
            hunk = next((row for row in artifact.get("change_set", {}).get("hunks", []) if row.get("id") == arguments["hunk_id"]), {})
            saved = hunk.get("regeneration", {}).get("delivery", {})
          else:
            saved = artifact.get("generation" if kind == "generate" else "draft", {}).get("delivery", {})
          if saved.get("key") == key:
            if saved.get("fingerprint") != fingerprint:
              raise OpenAuthorError("Saved generation belongs to different request inputs.")
            return artifact
        if receipt.get("completed"):
          raise OpenAuthorError("The completed generation artifact has changed or is missing. Inspect Changes instead of replaying it.")
        if kind != "generate" and receipt.get("initial_artifact_digest") != hashlib.sha256(artifact_path.read_bytes()).hexdigest():
          raise OpenAuthorError("The Change Set changed since this draft request started. Inspect Changes and start a new request instead of replaying it.")
        token = _delivery.set({"key": key, "fingerprint": fingerprint, "proposal_id": proposal_id})
        try:
          artifact = operation(paths, **kwargs)
          receipt["completed"] = True
          atomic_write_json(receipt_path, receipt)
          return artifact
        finally:
          _delivery.reset(token)
    return deliver
  return decorate
