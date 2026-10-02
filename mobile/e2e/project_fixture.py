"""Real engine fixture for the local-only phone/desktop encryption walkthrough."""
import base64
import json
import sys
from pathlib import Path

from openauthor.assistant.mobile_outbox import MobileOutboxEnvelope, import_mobile_outbox_item, list_mobile_inbox_items
from openauthor.assistant.snapshots import project_mobile_snapshot
from openauthor.project import initialize_project, resolve_project
from openauthor.proposals import list_proposals
from openauthor.revisions import create_revision
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.style_profile import save_style_profile
from openauthor.canon import add_canon_fact, list_canon_facts, update_canon_fact
from openauthor.planning import add_act, add_chapter, assign_scene

project_id = "20000000-0000-4000-8000-000000000001"
operation, directory = sys.argv[1:3]
root = Path(directory).resolve()
if root.name != "hosted-fixture" or "test-results" not in root.parts:
  raise ValueError("Only a Playwright fixture directory is permitted")

def prepare_snapshot(paths):
  snapshot = project_mobile_snapshot(paths, selected_project_id=project_id)
  return {
    "schema_version": 1,
    "media_type": "application/vnd.openauthor.mobile-snapshot+json",
    "manifest": snapshot.manifest,
    "plaintext_base64": base64.b64encode(snapshot.plaintext_bytes).decode("ascii"),
  }

if operation == "prepare":
  paths = initialize_project(root, name="The Winter Observatory", project_id=project_id)
  body = "Mara found a brass key beneath the observatory's frozen door."
  add_scene(paths, title="The Snow Key", body=body + " A red ribbon marked the door.")
  add_canon_fact(paths, subject_entity_id="", predicate="key material", value="brass",
    evidence=[{"scene_id": "scene-0001", "excerpt": "a brass key"}])
  add_canon_fact(paths, subject_entity_id="", predicate="door marker", value="red ribbon",
    evidence=[{"scene_id": "scene-0001", "excerpt": "A red ribbon marked the door."}])
  update_scene(paths, scene_identifier="scene-0001", body=body)
  add_scene(paths, title="The Blue Hour", body="Mara reached the observatory before sunrise.")
  add_scene(paths, title="A Loose Page", body="An unsorted page waited in her notebook.")
  act = add_act(paths, title="Winter")
  arrival = add_chapter(paths, act_id=act["id"], title="Arrival")
  discovery = add_chapter(paths, act_id=act["id"], title="Discovery")
  assign_scene(paths, scene_id="scene-0002", chapter_id=arrival["id"])
  assign_scene(paths, scene_id="scene-0001", chapter_id=discovery["id"])
  save_style_profile(paths, expected_version="", profile={
    "name": "Winter restraint", "description": "Let physical choices carry emotion.",
    "traits": {"emotion": "restrained", "dialogue": "subtextual"},
    "guidance": ["Keep action spatially clear."], "avoid": ["Melodrama."],
  })
  create_revision(paths, "Published companion fixture")
  result = prepare_snapshot(paths)
elif operation == "withdraw-fact":
  paths = resolve_project(root)
  fact = next(row for row in list_canon_facts(paths, for_editing=True) if row["predicate"] == "door marker")
  update_canon_fact(paths, fact["id"], expected_version=fact["edit_version"], changes={"status": "rejected"})
  result = prepare_snapshot(paths)
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
  result = {"inbox": list_mobile_inbox_items(paths), "proposals": list_proposals(paths), "scene": get_scene(paths, "scene-0001")}
else:
  raise ValueError("Unknown fixture operation")
print(json.dumps(result))
