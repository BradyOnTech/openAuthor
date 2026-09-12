from __future__ import annotations

import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from openauthor.assistant.mobile_outbox import (
  MobileOutboxEnvelope,
  MobileOutboxIdempotencyConflict,
  import_mobile_outbox_item,
  list_mobile_inbox_items,
  list_mobile_review_decisions,
  mobile_outbox_payload_digest,
)
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.proposals import create_proposal, get_proposal
from openauthor.revisions import create_revision
from openauthor.scenes import add_scene, get_scene, update_scene
from openauthor.story_memory import list_memory_suggestions


class AssistantMobileOutboxTests(unittest.TestCase):
  def test_capture_note_import_is_durable_and_replay_does_not_duplicate_it(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Notes",
        project_id="project-mobile-notes",
      )
      base_revision = create_revision(paths, "Mobile baseline")
      payload = {
        "kind": "capture_note",
        "title": "Opening image",
        "content": "The bell should ring before Mara sees the gate.",
      }
      envelope = MobileOutboxEnvelope(
        project_id="project-mobile-notes",
        device_id="device-ios-1",
        operation_id="operation-note-1",
        base_revision=base_revision,
        payload_digest=mobile_outbox_payload_digest(payload),
      )

      first = import_mobile_outbox_item(paths, envelope=envelope, payload=payload)
      replay = import_mobile_outbox_item(paths, envelope=envelope, payload=payload)

      self.assertEqual(replay, first)
      self.assertEqual(first.kind, "capture_note")
      self.assertEqual(first.artifact_kind, "mobile_inbox_item")
      self.assertEqual(first.disposition, "imported")
      self.assertFalse(first.stale)
      inbox = list_mobile_inbox_items(paths)
      self.assertEqual(len(inbox), 1)
      self.assertEqual(inbox[0]["operation_id"], "operation-note-1")
      self.assertEqual(inbox[0]["payload"]["content"], payload["content"])

  def test_thread_turn_is_captured_in_the_append_only_mobile_inbox(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Thread",
        project_id="project-mobile-thread",
      )
      base_revision = create_revision(paths, "Thread baseline")
      payload = {
        "kind": "thread_turn",
        "thread_id": "thread-mobile-1",
        "turn_id": "turn-mobile-1",
        "role": "user",
        "content": "Remember that the key was forged in winter.",
      }
      envelope = MobileOutboxEnvelope(
        project_id="project-mobile-thread",
        device_id="device-ios-1",
        operation_id="operation-turn-1",
        base_revision=base_revision,
        payload_digest=mobile_outbox_payload_digest(payload),
      )

      result = import_mobile_outbox_item(paths, envelope=envelope, payload=payload)

      self.assertEqual(result.artifact_kind, "mobile_inbox_item")
      self.assertEqual(result.kind, "thread_turn")
      [item] = list_mobile_inbox_items(paths)
      self.assertEqual(item["payload"]["thread_id"], "thread-mobile-1")
      self.assertEqual(item["payload"]["turn_id"], "turn-mobile-1")
      self.assertEqual(item["payload"]["role"], "user")

  def test_passage_and_change_request_become_pending_proposals_without_editing_prose(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Proposals",
        project_id="project-mobile-proposals",
      )
      add_scene(paths, title="The Gate", body="Mara waited beside the gate.")
      base_revision = create_revision(paths, "Proposal baseline")
      payloads = [
        {
          "kind": "dictated_passage",
          "title": "A colder arrival",
          "scene_id": "scene-0001",
          "content": "Snow caught in Mara's sleeves as the gate opened.",
        },
        {
          "kind": "change_set_request",
          "title": "Strengthen the consequence",
          "scene_id": "scene-0001",
          "instruction": "Make opening the gate cost Mara her map.",
        },
      ]

      results = []
      for index, payload in enumerate(payloads, start=1):
        envelope = MobileOutboxEnvelope(
          project_id="project-mobile-proposals",
          device_id="device-ios-1",
          operation_id=f"operation-proposal-{index}",
          base_revision=base_revision,
          payload_digest=mobile_outbox_payload_digest(payload),
        )
        results.append(
          import_mobile_outbox_item(paths, envelope=envelope, payload=payload)
        )

      self.assertEqual(
        [result.artifact_kind for result in results],
        ["proposal", "proposal"],
      )
      dictated = get_proposal(paths, results[0].artifact_id)
      requested = get_proposal(paths, results[1].artifact_id)
      self.assertEqual(dictated["status"], "pending")
      self.assertEqual(dictated["source"], "mobile_outbox")
      self.assertEqual(dictated["proposed_body"], payloads[0]["content"])
      self.assertEqual(requested["status"], "pending")
      self.assertEqual(requested["instruction"], payloads[1]["instruction"])
      self.assertEqual(
        get_scene(paths, "scene-0001")["body"].strip(),
        "Mara waited beside the gate.",
      )

  def test_story_memory_item_becomes_one_pending_review_suggestion(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Memory",
        project_id="project-mobile-memory",
      )
      base_revision = create_revision(paths, "Memory baseline")
      payload = {
        "kind": "story_memory_suggestion",
        "title": "Winter-forged key",
        "content": "The archive key was forged during the longest winter.",
      }
      envelope = MobileOutboxEnvelope(
        project_id="project-mobile-memory",
        device_id="device-ios-1",
        operation_id="operation-memory-1",
        base_revision=base_revision,
        payload_digest=mobile_outbox_payload_digest(payload),
      )

      first = import_mobile_outbox_item(paths, envelope=envelope, payload=payload)
      replay = import_mobile_outbox_item(paths, envelope=envelope, payload=payload)

      self.assertEqual(replay, first)
      self.assertEqual(first.artifact_kind, "story_memory_suggestion")
      [suggestion] = list_memory_suggestions(paths)
      self.assertEqual(suggestion["id"], first.artifact_id)
      self.assertEqual(suggestion["status"], "pending")
      self.assertEqual(suggestion["name"], "Winter-forged key")

  def test_review_decision_is_pending_desktop_review_and_never_applies_prose(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Review",
        project_id="project-mobile-review",
      )
      add_scene(paths, title="The Gate", body="The gate remained shut.")
      base_revision = create_revision(paths, "Review baseline")
      request_payload = {
        "kind": "dictated_passage",
        "title": "Open the gate",
        "scene_id": "scene-0001",
        "content": "The gate opened before Mara touched it.",
      }
      request_envelope = MobileOutboxEnvelope(
        project_id="project-mobile-review",
        device_id="device-ios-1",
        operation_id="operation-review-target",
        base_revision=base_revision,
        payload_digest=mobile_outbox_payload_digest(request_payload),
      )
      proposal_result = import_mobile_outbox_item(
        paths,
        envelope=request_envelope,
        payload=request_payload,
      )
      decision_payload = {
        "kind": "review_decision",
        "target_kind": "proposal",
        "target_id": proposal_result.artifact_id,
        "decision": "accepted",
        "notes": "Looks right on mobile; confirm on desktop.",
      }
      decision_envelope = MobileOutboxEnvelope(
        project_id="project-mobile-review",
        device_id="device-ios-1",
        operation_id="operation-review-decision",
        base_revision=base_revision,
        payload_digest=mobile_outbox_payload_digest(decision_payload),
      )

      first = import_mobile_outbox_item(
        paths,
        envelope=decision_envelope,
        payload=decision_payload,
      )
      replay = import_mobile_outbox_item(
        paths,
        envelope=decision_envelope,
        payload=decision_payload,
      )

      self.assertEqual(replay, first)
      self.assertEqual(first.artifact_kind, "mobile_review_decision")
      self.assertEqual(first.disposition, "pending_review")
      [decision] = list_mobile_review_decisions(paths)
      self.assertEqual(decision["status"], "pending_desktop_review")
      self.assertEqual(decision["payload"]["decision"], "accepted")
      self.assertEqual(get_proposal(paths, proposal_result.artifact_id)["status"], "pending")
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "The gate remained shut.")

  def test_stale_write_like_items_are_retained_as_review_conflicts(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Conflicts",
        project_id="project-mobile-conflicts",
      )
      add_scene(paths, title="The Gate", body="The gate was quiet.")
      base_revision = create_revision(paths, "Mobile snapshot revision")
      review_target = create_proposal(
        paths,
        title="Existing review",
        instruction="Consider a louder gate.",
        scene_id="scene-0001",
      )
      update_scene(paths, scene_identifier="scene-0001", body="The gate was already open.")
      current_revision = create_revision(paths, "Desktop advanced")
      payloads = [
        {
          "kind": "dictated_passage",
          "title": "Mobile passage",
          "scene_id": "scene-0001",
          "content": "The gate groaned in the snow.",
        },
        {
          "kind": "change_set_request",
          "title": "Mobile change",
          "scene_id": "scene-0001",
          "instruction": "Restore the gate's ominous arrival.",
        },
        {
          "kind": "story_memory_suggestion",
          "title": "The gate remembers",
          "content": "The gate records each person who crosses it.",
        },
        {
          "kind": "review_decision",
          "target_kind": "proposal",
          "target_id": review_target,
          "decision": "accepted",
        },
      ]

      results = []
      for index, payload in enumerate(payloads, start=1):
        envelope = MobileOutboxEnvelope(
          project_id="project-mobile-conflicts",
          device_id="device-ios-1",
          operation_id=f"operation-stale-{index}",
          base_revision=base_revision,
          payload_digest=mobile_outbox_payload_digest(payload),
        )
        results.append(import_mobile_outbox_item(paths, envelope=envelope, payload=payload))

      self.assertTrue(all(result.stale for result in results))
      self.assertTrue(all(result.disposition == "conflict" for result in results))
      self.assertTrue(all(result.imported_revision == current_revision for result in results))
      for result in results[:2]:
        proposal = get_proposal(paths, result.artifact_id)
        self.assertEqual(proposal["status"], "pending")
        self.assertTrue(proposal["mobile_outbox"]["conflict"])
      [suggestion] = [
        row for row in list_memory_suggestions(paths)
        if row["id"] == results[2].artifact_id
      ]
      self.assertEqual(suggestion["status"], "pending")
      self.assertTrue(suggestion["mobile_outbox"]["conflict"])
      [decision] = list_mobile_review_decisions(paths)
      self.assertEqual(decision["status"], "conflict")
      self.assertEqual(get_scene(paths, "scene-0001")["body"].strip(), "The gate was already open.")

  def test_envelope_and_payload_identity_are_enforced_at_the_import_boundary(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Identity",
        project_id="project-mobile-identity",
      )
      base_revision = create_revision(paths, "Identity baseline")
      payload = {
        "kind": "capture_note",
        "content": "An authenticated note.",
        "project_id": "different-project",
      }
      envelope = MobileOutboxEnvelope(
        project_id="project-mobile-identity",
        device_id="device-ios-1",
        operation_id="operation-identity-1",
        base_revision=base_revision,
        payload_digest=mobile_outbox_payload_digest(payload),
      )

      with self.assertRaisesRegex(OpenAuthorError, "payload project_id"):
        import_mobile_outbox_item(paths, envelope=envelope, payload=payload)

      valid_payload = {"kind": "capture_note", "content": "A valid note."}
      digest = mobile_outbox_payload_digest(valid_payload)
      invalid_envelopes = [
        MobileOutboxEnvelope("wrong-project", "device-ios-1", "operation-1", base_revision, digest),
        MobileOutboxEnvelope("project-mobile-identity", "bad/device", "operation-1", base_revision, digest),
        MobileOutboxEnvelope("project-mobile-identity", " device-ios-1", "operation-1", base_revision, digest),
        MobileOutboxEnvelope("project-mobile-identity", "device-ios-1", "bad operation", base_revision, digest),
        MobileOutboxEnvelope("project-mobile-identity", "device-ios-1", "operation-1", "", digest),
        MobileOutboxEnvelope("project-mobile-identity", "device-ios-1", "operation-1", "missing-revision", digest),
        MobileOutboxEnvelope("project-mobile-identity", "device-ios-1", "operation-1", base_revision, "sha256:" + "0" * 64),
      ]
      for invalid in invalid_envelopes:
        with self.subTest(envelope=invalid):
          with self.assertRaises(OpenAuthorError):
            import_mobile_outbox_item(paths, envelope=invalid, payload=valid_payload)

      unsupported = {"kind": "replace_manuscript", "content": "Never do this."}
      with self.assertRaisesRegex(OpenAuthorError, "Unsupported"):
        import_mobile_outbox_item(
          paths,
          envelope=MobileOutboxEnvelope(
            "project-mobile-identity",
            "device-ios-1",
            "operation-unsupported",
            base_revision,
            mobile_outbox_payload_digest(unsupported),
          ),
          payload=unsupported,
        )

  def test_concurrent_retries_converge_and_changed_operation_content_conflicts(self) -> None:
    with tempfile.TemporaryDirectory() as tmp:
      paths = initialize_project(
        Path(tmp),
        name="Mobile Retry",
        project_id="project-mobile-retry",
      )
      base_revision = create_revision(paths, "Retry baseline")
      payload = {"kind": "capture_note", "content": "Import exactly once."}
      envelope = MobileOutboxEnvelope(
        project_id="project-mobile-retry",
        device_id="device-ios-1",
        operation_id="operation-concurrent-1",
        base_revision=base_revision,
        payload_digest=mobile_outbox_payload_digest(payload),
      )

      with ThreadPoolExecutor(max_workers=8) as executor:
        results = list(executor.map(
          lambda _: import_mobile_outbox_item(paths, envelope=envelope, payload=payload),
          range(16),
        ))

      self.assertTrue(all(result == results[0] for result in results))
      self.assertEqual(len(list_mobile_inbox_items(paths)), 1)
      changed = {"kind": "capture_note", "content": "Different content."}
      changed_envelope = MobileOutboxEnvelope(
        project_id=envelope.project_id,
        device_id=envelope.device_id,
        operation_id=envelope.operation_id,
        base_revision=base_revision,
        payload_digest=mobile_outbox_payload_digest(changed),
      )
      with self.assertRaises(MobileOutboxIdempotencyConflict):
        import_mobile_outbox_item(paths, envelope=changed_envelope, payload=changed)


if __name__ == "__main__":
  unittest.main()
