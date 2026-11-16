from __future__ import annotations

import json
import tempfile
import unittest
import zipfile
from pathlib import Path
from xml.etree import ElementTree
from xml.sax.saxutils import escape

from openauthor.manuscript_io import (
  _emphasis_line,
  _markdown_inline_runs,
  export_manuscript,
  import_manuscript,
  preview_manuscript_import,
)
from openauthor.project import initialize_project
from openauthor.scenes import add_scene, list_scene_details

WORD = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
W = f"{{{WORD}}}"


def run(text: str, properties: str = "") -> str:
  return f"<w:r>{f'<w:rPr>{properties}</w:rPr>' if properties else ''}<w:t xml:space=\"preserve\">{escape(text)}</w:t></w:r>"


def paragraph(*runs: str, style: str = "", centred: bool = False) -> str:
  properties = (f'<w:pStyle w:val="{style}"/>' if style else "") + ('<w:jc w:val="center"/>' if centred else "")
  return f"<w:p>{f'<w:pPr>{properties}</w:pPr>' if properties else ''}{''.join(runs)}</w:p>"


def write_docx(path: Path, *paragraphs: str, styles: str = "") -> Path:
  with zipfile.ZipFile(path, "w") as archive:
    archive.writestr("word/document.xml", f'<w:document xmlns:w="{WORD}"><w:body>{"".join(paragraphs)}</w:body></w:document>')
    if styles:
      archive.writestr("word/styles.xml", f'<w:styles xmlns:w="{WORD}">{styles}</w:styles>')
  return path


def exported_paragraphs(path: Path) -> list[dict]:
  """Each exported paragraph as its alignment and (text, bold, italic) runs."""
  with zipfile.ZipFile(path) as archive:
    root = ElementTree.fromstring(archive.read("word/document.xml"))
  rows = []
  for node in root.iter(f"{W}p"):
    alignment = node.find(f"{W}pPr/{W}jc")
    rows.append({
      "centred": alignment is not None and alignment.get(f"{W}val") == "center",
      "runs": [
        ("".join(text.text or "" for text in item.iter(f"{W}t")), item.find(f"{W}rPr/{W}b") is not None, item.find(f"{W}rPr/{W}i") is not None)
        for item in node.iter(f"{W}r")
      ],
    })
  return rows


class DocxEmphasisCase(unittest.TestCase):
  def setUp(self) -> None:
    self.directory = tempfile.TemporaryDirectory()
    self.addCleanup(self.directory.cleanup)
    self.root = Path(self.directory.name)

  def imported_body(self, source: Path, name: str = "imported") -> str:
    paths = initialize_project(self.root / name, name=name)
    import_manuscript(paths, source)
    return "\n\n".join(scene["body"].rstrip("\n") for scene in list_scene_details(paths))


class DocxImportEmphasisTests(DocxEmphasisCase):
  def test_italic_and_bold_runs_become_markdown_emphasis(self) -> None:
    source = write_docx(
      self.root / "novel.docx",
      paragraph(run("Mara said "), run("never", "<w:i/>"), run(" and meant "), run("it", "<w:b/>"), run(".")),
      paragraph(run("Both at once", "<w:b/><w:i/>"), run(" here.")),
    )
    self.assertEqual(self.imported_body(source), "Mara said *never* and meant **it**.\n***Both at once*** here.")

  def test_adjacent_runs_with_the_same_formatting_merge(self) -> None:
    source = write_docx(self.root / "novel.docx", paragraph(run("The "), run("Winter", "<w:i/>"), run(" ", "<w:i/>"), run("Key", "<w:i/>"), run(" sank.")))
    self.assertEqual(self.imported_body(source), "The *Winter Key* sank.")

  def test_whitespace_stays_outside_the_markers(self) -> None:
    source = write_docx(self.root / "novel.docx", paragraph(run("She"), run(" really ", "<w:i/>"), run("did"), run("  ", "<w:b/>"), run("leave.")))
    self.assertEqual(self.imported_body(source), "She *really* did  leave.")

  def test_emphasis_nested_inside_emphasis_is_valid_markdown(self) -> None:
    source = write_docx(self.root / "novel.docx", paragraph(run("She said ", "<w:i/>"), run("never", "<w:i/><w:b/>"), run(" again.", "<w:i/>")))
    body = self.imported_body(source)
    self.assertEqual(body, "*She said **never** again.*")
    self.assertEqual(_markdown_inline_runs(body), [("She said ", False, True), ("never", True, True), (" again.", False, True)])

  def test_properties_switched_off_and_character_styles_are_respected(self) -> None:
    styles = (
      '<w:style w:type="character" w:styleId="Emphasis"><w:rPr><w:i/></w:rPr></w:style>'
      '<w:style w:type="character" w:styleId="Loud"><w:basedOn w:val="Emphasis"/><w:rPr><w:b/></w:rPr></w:style>'
    )
    source = write_docx(
      self.root / "novel.docx",
      paragraph(run("Plain ", '<w:b w:val="0"/><w:i w:val="false"/>'), run("styled", '<w:rStyle w:val="Emphasis"/>'), run(" "), run("loud", '<w:rStyle w:val="Loud"/>'), run(" "), run("upright", '<w:rStyle w:val="Emphasis"/><w:i w:val="0"/>')),
      styles=styles,
    )
    self.assertEqual(self.imported_body(source), "Plain *styled **loud*** upright")
    self.assertEqual(_markdown_inline_runs("Plain *styled **loud*** upright"), [("Plain ", False, False), ("styled ", False, True), ("loud", True, True), (" upright", False, False)])

  def test_runs_inside_hyperlinks_and_line_breaks_keep_their_emphasis(self) -> None:
    linked = f'<w:hyperlink>{run("the ledger", "<w:i/>")}</w:hyperlink>'
    broken = '<w:r><w:rPr><w:i/></w:rPr><w:t>first line</w:t><w:br/><w:t>second line</w:t></w:r>'
    source = write_docx(self.root / "novel.docx", paragraph(run("See "), linked, run(".")), paragraph(broken))
    self.assertEqual(self.imported_body(source), "See *the ledger*.\n*first line*\n*second line*")

  def test_heading_titles_stay_plain(self) -> None:
    source = write_docx(self.root / "novel.docx", paragraph(run("The Gate", "<w:b/>"), style="Heading1"), paragraph(run("Prose "), run("here", "<w:i/>"), run(".")))
    preview = preview_manuscript_import(source)
    self.assertEqual([row["title"] for row in preview["scenes"]], ["The Gate"])
    self.assertEqual(preview["scenes"][0]["excerpt"], "Prose *here*.")

  def test_import_warning_no_longer_claims_emphasis_is_lost(self) -> None:
    source = write_docx(self.root / "novel.docx", paragraph(run("Prose "), run("here", "<w:i/>"), run(".")))
    warnings = preview_manuscript_import(source)["warnings"]
    self.assertEqual(len(warnings), 1)
    self.assertIn("italic and bold emphasis are imported", warnings[0])
    self.assertIn("images, comments, tracked changes", warnings[0])
    self.assertNotIn("rich formatting", warnings[0])

  def test_formatting_that_is_really_lost_is_named(self) -> None:
    source = write_docx(
      self.root / "novel.docx",
      paragraph(run("An "), run("underlined", '<w:u w:val="single"/>'), run(" title and a "), run("struck", "<w:strike/>"), run(" word, "), run("not this", '<w:u w:val="none"/>'), run(".")),
    )
    warnings = preview_manuscript_import(source)["warnings"]
    self.assertEqual(len(warnings), 2)
    self.assertIn("strikethrough, underline", warnings[1])
    self.assertIn("imported as plain text", warnings[1])
    self.assertEqual(self.imported_body(source), "An underlined title and a struck word, not this.")

  def test_emphasis_markdown_cannot_mark_is_dropped_with_a_warning_not_stray_asterisks(self) -> None:
    source = write_docx(self.root / "novel.docx", paragraph(run("un", "<w:b/>"), run("believ", "<w:b/><w:i/>"), run("able", "<w:i/>"), run(" luck")))
    self.assertEqual(self.imported_body(source), "unbelievable luck")
    self.assertTrue(any("cannot mark" in warning for warning in preview_manuscript_import(source)["warnings"]))


class DocxExportEmphasisTests(DocxEmphasisCase):
  def export_body(self, body: str) -> tuple[list[dict], dict]:
    paths = initialize_project(self.root / "book", name="Export")
    add_scene(paths, title="Opening", body=body)
    target = self.root / "export.docx"
    report = export_manuscript(paths, target, format="docx")
    return exported_paragraphs(target)[1:], report

  def test_markdown_emphasis_becomes_italic_and_bold_runs(self) -> None:
    rows, _ = self.export_body("She *never* said _that_ to **anyone**, ***ever***.")
    self.assertEqual(rows[0]["runs"], [
      ("She ", False, False), ("never", False, True), (" said ", False, False), ("that", False, True),
      (" to ", False, False), ("anyone", True, False), (", ", False, False), ("ever", True, True), (".", False, False),
    ])

  def test_scene_break_lines_are_centred_and_nothing_else_is(self) -> None:
    rows, _ = self.export_body("Before.\n\n***\n\nMiddle.\n\n* * *\n\nLater.\n\n#\n\n# A literal sign")
    breaks = [(row["runs"][0][0], row["centred"]) for row in rows if row["runs"][0][0].strip()]
    self.assertEqual(breaks, [("Before.", False), ("***", True), ("Middle.", False), ("* * *", True), ("Later.", False), ("#", True), ("# A literal sign", False)])
    self.assertTrue(all(not bold and not italic for row in rows for _, bold, italic in row["runs"]))

  def test_ordinary_asterisks_and_underscores_stay_literal(self) -> None:
    body = "2 * 3 * 4 is not a_snake_case name.\n\n* a list item\n\nA footnote* and \\*escaped\\* text, __init__ too."
    rows, _ = self.export_body(body)
    self.assertEqual([row["runs"] for row in rows if row["runs"][0][0]], [[(line, False, False)] for line in body.split("\n\n")])

  def test_plain_paragraph_xml_is_unchanged(self) -> None:
    paths = initialize_project(self.root / "book", name="Export")
    add_scene(paths, title="Opening", body="Plain prose & nothing else.")
    target = self.root / "export.docx"
    export_manuscript(paths, target, format="docx")
    with zipfile.ZipFile(target) as archive:
      document = archive.read("word/document.xml").decode("utf-8")
    self.assertIn('<w:p><w:r><w:t xml:space="preserve">Plain prose &amp; nothing else.</w:t></w:r></w:p>', document)

  def test_loss_report_describes_emphasis_as_preserved_and_still_lists_real_losses(self) -> None:
    _, report = self.export_body("She *never* said.")
    self.assertTrue(any("typeset as italic and bold" in line for line in report["preserves"]))
    self.assertFalse(any("Markdown formatting syntax is exported as literal text" in line for line in report["losses"]))
    self.assertTrue(any("lists, links" in line and "literal text" in line for line in report["losses"]))
    self.assertTrue(any("Scene metadata" in line for line in report["losses"]))
    saved = json.loads(Path(report["report_path"]).read_text(encoding="utf-8"))
    self.assertEqual(saved["preserves"], report["preserves"])


class DocxRoundTripTests(DocxEmphasisCase):
  def test_word_emphasis_survives_import_export_and_reimport(self) -> None:
    source = write_docx(
      self.root / "source.docx",
      paragraph(run("Chapter One"), style="Heading1"),
      paragraph(run("“"), run("Never", "<w:i/>"), run(",” she said, and "), run("meant", "<w:b/>"), run(" it.")),
      paragraph(run("***"), centred=True),
      paragraph(run("The "), run("Winter Key", "<w:i/>"), run(" sank "), run("without ", "<w:i/>"), run("a sound", "<w:i/><w:b/>"), run(".")),
    )
    first = initialize_project(self.root / "first", name="First")
    import_manuscript(first, source)
    body = list_scene_details(first)[0]["body"]
    self.assertEqual(body.rstrip("\n"), "“*Never*,” she said, and **meant** it.\n***\nThe *Winter Key* sank *without **a sound***.")

    exported = self.root / "exported.docx"
    export_manuscript(first, exported, format="docx")
    rows = [row for row in exported_paragraphs(exported) if row["runs"] != [("Chapter One", False, False)]][1:]
    self.assertEqual(rows[0]["runs"], [("“", False, False), ("Never", False, True), (",” she said, and ", False, False), ("meant", True, False), (" it.", False, False)])
    self.assertEqual((rows[1]["runs"], rows[1]["centred"]), ([("***", False, False)], True))
    self.assertEqual(rows[2]["runs"][-3:], [("without ", False, True), ("a sound", True, True), (".", False, False)])

    second = initialize_project(self.root / "second", name="Second")
    import_manuscript(second, exported)
    self.assertEqual(list_scene_details(second)[0]["body"], body)
    self.assertEqual(list_scene_details(second)[0]["title"], "Chapter One")

  def test_markdown_scene_survives_export_and_reimport(self) -> None:
    body = "She *never* said that to **anyone**.\n\n* * *\n\n# A literal sign\n\n**Do not remove this.**\n\nA footnote* and 2 * 3 stay as typed."
    paths = initialize_project(self.root / "book", name="Book")
    add_scene(paths, title="Opening", body=body)
    target = self.root / "book.docx"
    export_manuscript(paths, target, format="docx")
    restored = initialize_project(self.root / "restored", name="Restored")
    import_manuscript(restored, target)
    self.assertEqual(list_scene_details(restored)[0]["body"].rstrip("\n"), body)

  def test_every_rendered_line_reads_back_as_the_same_runs(self) -> None:
    cases = [
      [("plain", False, False)],
      [("a", True, False), (" ", False, False), ("b", False, True)],
      [("foo", True, False), ("bar", False, True)],
      [("italic ", False, True), ("both", True, True)],
      [("both", True, True), (" bold", True, False)],
      [("word", False, False), ("—and then", False, True), (" on", False, False)],
      [("“Go,”", False, True), (" she said", False, False)],
    ]
    for runs in cases:
      with self.subTest(runs=runs):
        text, dropped = _emphasis_line(runs)
        self.assertFalse(dropped)
        self.assertEqual("".join(piece for piece, _, _ in _markdown_inline_runs(text)), "".join(piece for piece, _, _ in runs))
        self.assertEqual(_emphasis_line(_markdown_inline_runs(text)), (text, False))


if __name__ == "__main__":
  unittest.main()
