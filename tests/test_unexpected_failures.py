from __future__ import annotations

import io
import json
import os
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path
from typing import Any
from unittest.mock import patch

from openauthor.chat import create_chat_thread
from openauthor.cli import main
from openauthor.project import OpenAuthorError, initialize_project
from openauthor.retrieval import build_retrieval_index
from openauthor.revisions import create_revision
from openauthor.scenes import add_scene, find_scene_file, get_scene, list_scenes, update_scene
from openauthor.server import ChatSidecarServer

BOM = b"\xef\xbb\xbf"


def _run_requests(paths: Any, requests: list[dict[str, Any]]) -> list[dict[str, Any]]:
  stdin = io.StringIO("\n".join(json.dumps(request) for request in requests) + "\n")
  stdout = io.StringIO()
  ChatSidecarServer(paths, stdin=stdin, stdout=stdout).serve_forever()
  return [json.loads(line) for line in stdout.getvalue().splitlines() if line.strip()]


def _responses(frames: list[dict[str, Any]], request_id: Any) -> list[dict[str, Any]]:
  return [frame for frame in frames if "event" not in frame and frame.get("id") == request_id]


class _ProjectCase(unittest.TestCase):
  def setUp(self) -> None:
    self.directory = tempfile.TemporaryDirectory()
    self.addCleanup(self.directory.cleanup)
    self.root = Path(self.directory.name)
    self.paths = initialize_project(self.root, name="Failure handling")
    add_scene(self.paths, title="Opening", body="Mara finds the winter key.")
    self.second = add_scene(self.paths, title="Quoted Title", pov="Mara", body="Idris waits by the harbor.")
    previous = Path.cwd()
    os.chdir(self.root)
    self.addCleanup(os.chdir, previous)

  def _cli(self, *arguments: str, debug: str | None = None) -> tuple[int, str, str]:
    stdout, stderr = io.StringIO(), io.StringIO()
    environment = {key: value for key, value in os.environ.items() if key != "OPENAUTHOR_DEBUG"}
    if debug is not None:
      environment["OPENAUTHOR_DEBUG"] = debug
    with patch.dict(os.environ, environment, clear=True), redirect_stdout(stdout), redirect_stderr(stderr):
      code = main(list(arguments))
    return code, stdout.getvalue(), stderr.getvalue()

  def _corrupt_second_scene(self) -> None:
    self.second.write_bytes(self.second.read_bytes().replace(b"Idris waits", b"Idris wa\xffts"))


class UndecodableSceneTests(_ProjectCase):
  def test_scene_list_names_the_file_and_the_fix_instead_of_a_traceback(self) -> None:
    self._corrupt_second_scene()
    code, stdout, stderr = self._cli("scene", "list", "--json")
    self.assertEqual(code, 2)
    self.assertEqual(stdout, "")
    self.assertEqual(len(stderr.strip().splitlines()), 1)
    self.assertTrue(stderr.startswith("error: Scene file "))
    self.assertIn(self.second.name, stderr)
    self.assertIn("UTF-8", stderr)
    self.assertIn("re-save", stderr)
    self.assertNotIn("Traceback", stderr)

  def test_engine_readers_raise_the_same_clear_error(self) -> None:
    self._corrupt_second_scene()
    for operation in (
      lambda: list_scenes(self.paths),
      lambda: get_scene(self.paths, "scene-0002"),
      lambda: find_scene_file(self.paths, "scene-0002"),
      lambda: build_retrieval_index(self.paths),
      lambda: create_revision(self.paths, "Checkpoint"),
    ):
      with self.assertRaises(OpenAuthorError) as caught:
        operation()
      self.assertIn(self.second.name, str(caught.exception))
      self.assertIn("UTF-8", str(caught.exception))

  def test_a_readable_scene_can_still_be_opened_next_to_a_damaged_one(self) -> None:
    self._corrupt_second_scene()
    self.assertEqual(get_scene(self.paths, "scene-0001")["title"], "Opening")

  def test_the_damaged_file_is_left_untouched(self) -> None:
    self._corrupt_second_scene()
    before = self.second.read_bytes()
    self._cli("scene", "update", "--id", "scene-0002", "--body", "Replacement", "--json")
    self.assertEqual(self.second.read_bytes(), before)


class UnexpectedCliFailureTests(_ProjectCase):
  def test_unexpected_exception_becomes_one_error_line_and_a_failure_status(self) -> None:
    with patch("openauthor.cli.list_scenes", side_effect=RuntimeError("index\nexploded")):
      code, stdout, stderr = self._cli("scene", "list", "--json")
    self.assertEqual(code, 1)
    self.assertEqual(stdout, "")
    self.assertEqual(len(stderr.strip().splitlines()), 1)
    self.assertTrue(stderr.startswith("error: Unexpected internal error (RuntimeError: index exploded)"))
    self.assertIn("OPENAUTHOR_DEBUG=1", stderr)
    self.assertNotIn("Traceback", stderr)

  def test_debug_flag_adds_the_traceback_and_keeps_the_error_line(self) -> None:
    with patch("openauthor.cli.list_scenes", side_effect=RuntimeError("index exploded")):
      code, _, stderr = self._cli("scene", "list", "--json", debug="1")
    self.assertEqual(code, 1)
    self.assertIn("Traceback (most recent call last)", stderr)
    self.assertTrue(stderr.strip().splitlines()[-1].startswith("error: Unexpected internal error (RuntimeError: index exploded)"))

  def test_other_debug_values_do_not_print_a_traceback(self) -> None:
    with patch("openauthor.cli.list_scenes", side_effect=RuntimeError("index exploded")):
      _, _, stderr = self._cli("scene", "list", "--json", debug="0")
    self.assertNotIn("Traceback", stderr)

  def test_expected_errors_keep_their_message_and_status(self) -> None:
    code, _, stderr = self._cli("scene", "get", "--id", "scene-9999", "--json")
    self.assertEqual(code, 2)
    self.assertEqual(stderr, "error: Unknown scene id 'scene-9999'.\n")

  def test_unexpected_failure_inside_an_author_edit_rolls_back_and_reports_one_line(self) -> None:
    before = self.second.read_bytes()
    with patch("openauthor.cli.extract_memory_suggestions", side_effect=RuntimeError("scan exploded")):
      code, stdout, stderr = self._cli("scene", "update", "--id", "scene-0002", "--body", "Replacement prose.", "--json")
    self.assertEqual(code, 1)
    self.assertEqual(stdout, "")
    self.assertNotIn("Traceback", stderr)
    self.assertEqual(self.second.read_bytes(), before)


class SidecarFailureTests(_ProjectCase):
  def test_request_that_raises_gets_an_error_and_later_requests_are_served(self) -> None:
    with patch("openauthor.server.list_chat_threads", side_effect=[RuntimeError("thread index\nexploded"), []]):
      frames = _run_requests(self.paths, [
        {"id": "broken", "method": "chat.threads"},
        {"id": "after", "method": "ping"},
        {"id": "again", "method": "chat.threads"},
      ])
    broken = _responses(frames, "broken")
    self.assertEqual(len(broken), 1)
    self.assertEqual(broken[0]["error"]["category"], "internal_error")
    self.assertIn("RuntimeError: thread index exploded", broken[0]["error"]["message"])
    self.assertNotIn("\n", broken[0]["error"]["message"])
    self.assertTrue(_responses(frames, "after")[0]["result"]["ok"])
    self.assertEqual(_responses(frames, "again")[0]["result"], [])

  def test_undecodable_scene_file_is_reported_per_request_without_stopping_the_sidecar(self) -> None:
    self._corrupt_second_scene()
    frames = _run_requests(self.paths, [
      {"id": "snapshot", "method": "mobile.snapshot.prepare", "params": {"project_id": ""}},
      {"id": "after", "method": "ping"},
    ])
    snapshot = _responses(frames, "snapshot")
    self.assertEqual(len(snapshot), 1)
    self.assertIn("error", snapshot[0])
    self.assertNotIn("Traceback", snapshot[0]["error"]["message"])
    self.assertTrue(_responses(frames, "after")[0]["result"]["ok"])

  def test_failure_while_routing_a_request_still_answers_that_request(self) -> None:
    with patch("openauthor.server._chat_context_params", side_effect=KeyError("thread_id")):
      frames = _run_requests(self.paths, [
        {"id": "context", "method": "chat.context", "params": {"thread_id": "missing"}},
        {"id": "after", "method": "ping"},
      ])
    context = _responses(frames, "context")
    self.assertEqual(len(context), 1)
    self.assertEqual(context[0]["error"]["category"], "internal_error")
    self.assertTrue(_responses(frames, "after")[0]["result"]["ok"])

  def test_chat_turn_that_raises_unexpectedly_is_answered_and_the_sidecar_survives(self) -> None:
    thread = create_chat_thread(self.paths, title="Failing turn", provider="local")
    with patch("openauthor.server.send_chat_message", side_effect=TypeError("unexpected payload shape")):
      frames = _run_requests(self.paths, [
        {"id": "turn", "method": "chat.send", "params": {"thread_id": thread["id"], "message": "Hello"}},
        {"id": "after", "method": "ping"},
      ])
    turn = _responses(frames, "turn")
    self.assertEqual(len(turn), 1)
    self.assertEqual(turn[0]["error"]["category"], "internal_error")
    self.assertIn("TypeError: unexpected payload shape", turn[0]["error"]["message"])
    statuses = [frame["payload"]["data"]["status"] for frame in frames if frame.get("event") == "assistant.event" and frame["payload"]["type"] == "turn.status"]
    self.assertEqual(statuses, ["failed"])
    self.assertTrue(_responses(frames, "after")[0]["result"]["ok"])

  def test_expected_errors_keep_their_category(self) -> None:
    frames = _run_requests(self.paths, [{"id": "messages", "method": "chat.messages", "params": {"thread_id": "thread-unknown"}}])
    self.assertEqual(_responses(frames, "messages")[0]["error"]["category"], "core_error")


class ByteOrderMarkTests(_ProjectCase):
  def _add_bom(self) -> None:
    self.second.write_bytes(BOM + self.second.read_bytes())

  def test_scene_keeps_its_identity_and_metadata(self) -> None:
    self._add_bom()
    rows = {row["id"]: row for row in list_scenes(self.paths)}
    self.assertEqual(set(rows), {"scene-0001", "scene-0002"})
    self.assertEqual(rows["scene-0002"]["title"], "Quoted Title")
    self.assertEqual(rows["scene-0002"]["pov"], "Mara")
    scene = get_scene(self.paths, "scene-0002")
    self.assertEqual(scene["body"], "Idris waits by the harbor.\n")
    self.assertEqual(find_scene_file(self.paths, "scene-0002"), self.second)

  def test_cli_lists_the_frontmatter_id(self) -> None:
    self._add_bom()
    code, stdout, _ = self._cli("scene", "list", "--json")
    self.assertEqual(code, 0)
    self.assertEqual([row["id"] for row in json.loads(stdout)], ["scene-0001", "scene-0002"])

  def test_saving_does_not_write_the_mark_back(self) -> None:
    self._add_bom()
    update_scene(self.paths, scene_identifier="scene-0002", body="Idris leaves the harbor.")
    content = self.second.read_bytes()
    self.assertFalse(content.startswith(BOM))
    self.assertTrue(content.startswith(b"---\nid: scene-0002\n"))
    self.assertNotIn(BOM, content)
    self.assertEqual(get_scene(self.paths, "scene-0002")["body"], "Idris leaves the harbor.\n")

  def test_mark_only_file_without_frontmatter_keeps_clean_prose(self) -> None:
    loose = self.paths.scenes_dir / "0003-loose.md"
    loose.write_bytes(BOM + b"Just prose.\n")
    scene = get_scene(self.paths, "0003-loose")
    self.assertEqual(scene["body"], "Just prose.\n")

  def test_retrieval_index_uses_the_frontmatter_id(self) -> None:
    self._add_bom()
    build_retrieval_index(self.paths)
    index = json.loads(self.paths.retrieval_index_file.read_text(encoding="utf-8"))
    self.assertEqual([source["source_ref"] for source in index["sources"]], ["scene-0001", "scene-0002"])
    self.assertEqual(index["sources"][1]["title"], "Quoted Title")


if __name__ == "__main__":
  unittest.main()
