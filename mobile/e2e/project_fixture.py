"""Real engine fixture for the local-only phone/desktop encryption walkthrough."""
import base64
import json
import sys
from pathlib import Path

from openauthor.assistant.mobile_outbox import MobileOutboxEnvelope, import_mobile_outbox_item, list_mobile_inbox_items
from openauthor.assistant.snapshots import project_mobile_snapshot
from openauthor.project import initialize_project, resolve_project
from openauthor.revisions import create_revision
from openauthor.scenes import add_scene, get_scene

project_id = "20000000-0000-4000-8000-000000000001"
operation, directory = sys.argv[1:3]
root = Path(directory).resolve()
if root.name != "hosted-fixture" or "test-results" not in root.parts:
  raise ValueError("Only a Playwright fixture directory is permitted")

if operation == "prepare":
  paths = initialize_project(root, name="The Winter Observatory", project_id=project_id)
  add_scene(paths, title="The Snow Key", body="Mara found a brass key beneath the observatory's frozen door.")
  create_revision(paths, "Published companion fixture")
  snapshot = project_mobile_snapshot(paths, selected_project_id=project_id)
  result = {
    "schema_version": 1,
    "media_type": "application/vnd.openauthor.mobile-snapshot+json",
    "manifest": snapshot.manifest,
    "plaintext_base64": base64.b64encode(snapshot.plaintext_bytes).decode("ascii"),
  }
elif operation == "import":
  paths = resolve_project(root)
  data = json.load(sys.stdin)
  identity = data["envelope"]
  envelope = MobileOutboxEnvelope(
    project_id=identity["projectId"], device_id=identity["deviceId"],
    operation_id=identity["operationId"], base_revision=identity["baseRevision"],
    payload_digest=identity["payloadDigest"],
  )
  result = import_mobile_outbox_item(paths, envelope=envelope, payload=data["payload"]).to_dict()
elif operation == "inspect":
  paths = resolve_project(root)
  result = {"inbox": list_mobile_inbox_items(paths), "scene": get_scene(paths, "scene-0001")}
else:
  raise ValueError("Unknown fixture operation")
print(json.dumps(result))
