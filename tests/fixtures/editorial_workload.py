"""Original synthetic book-sized workload, not a literary-quality benchmark.

Anchor passages carry independently specified editorial cases. Surrounding prose
is generated from recurring patterns to exercise distance, volume and navigation.
The builder only accepts an initialized project with no existing scenes.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from openauthor.planning import add_act, add_chapter, assign_scene
from openauthor.project import resolve_project
from openauthor.retrieval import build_retrieval_index
from openauthor.scenes import add_scene, list_scenes, parse_front_matter


PROTECTED = "The seventh bell must ring before dawn."
EARLY_EVIDENCE = "Only Ivo knew the tide key was hidden beneath the western bridge."
KNOWLEDGE_CONFLICT = "Mara knew the tide key was hidden beneath the western bridge, although nobody had told her."
REVEAL = "At the dry reservoir, Ivo finally told Mara where he had hidden the tide key."


def populate_editorial_workload(root: Path) -> dict:
  paths = resolve_project(root)
  if list_scenes(paths):
    raise ValueError("Editorial workload requires an empty manuscript.")
  places = ["salt market", "rope house", "signal yard", "abandoned mill", "customs hall", "reed garden", "dry reservoir", "eastern quay"]
  objects = ["survey stake", "blue receipt", "iron weight", "broken compass", "sealing stamp", "copper lamp", "wool scarf", "measuring chain"]
  witnesses = ["Leda", "Tomas", "Neri", "Sela", "Orin", "Vera", "Halen", "Ada"]
  act = add_act(paths, title="The Borrowed Coast")
  chapters = [add_chapter(paths, act_id=act["id"], title=f"Crossing {index + 1:02d}") for index in range(16)]
  originals = {}
  for index in range(64):
    place, obj, witness = places[index % 8], objects[(index // 8 + index) % 8], witnesses[(index // 4 + index) % 8]
    paragraphs = [
      f"The {place} appeared at the end of the surveyed lane, where Mara's pencilled boundary crossed a wall that had stood for three generations. {witness} waited beside the gate with a {obj}. There was no welcome in the gesture, but there was no refusal either. Mara put away the official plan and asked which entrance people used when the inspectors were not watching. The question cost her more than she expected. She had spent years believing a clean line could excuse an uncertain decision. Here the line had become somebody else's locked door.",
      f"Inside, the floor carried two histories of water. A dark stripe marked the old flood, while a pale crust recorded the tide that had come during the council's inspection. {witness} measured the distance between them with a thumb. Mara copied the measurement into page {index + 1} of her field book. She left a margin for a second witness. The council forms had never allowed that much room for doubt, and she was beginning to suspect the narrow margins were part of their purpose. Outside, a cart rolled over the loose stones and made the window tremble.",
      f"The account did not arrive in order. First came a disagreement about wages, then a winter when the ferries stopped, and only afterward the name of the person who had moved the boundary stone. Mara wanted a sequence she could defend before the council. {witness} wanted someone to understand why the sequence had not mattered when the water entered the house. Neither was willing to say that the other was wrong. They settled on a drawing of the doorway, including the notch where a child had measured the height of a dog that was now dead.",
      f"By afternoon the {obj} lay between them like an accusation. Mara could have taken it as evidence and written a receipt. Instead she asked who would need it tomorrow. The answer changed the bargain. Evidence was useful in a hearing; an absent tool could close a workshop before a hearing ever began. She made a rubbing, noted the damage on its edge, and returned it. {witness} watched until her hand was empty. Only then did another name enter the conversation, someone Mara would have to find without bringing an inspector to their door.",
      f"She walked back through the {place} with a route rather than a conclusion. On the wall beside the gate she found a child's chalk drawing of a boat. The hull was too deep, the sail too large, and every passenger had a separate face. Her own maps had shown the district as a grey block labelled for clearance. She copied the boat into the margin of page {index + 1}, then crossed out the label without erasing it. Whoever read the book later would have to see what she had believed before anyone had made her look.",
      f"At the next corner Mara stopped to check the day's account. The distance to the ferry was unchanged, but the walk no longer felt short. She counted the promises she had made and wrote a name beside each one. A promise without a person attached was too easy to carry into a meeting and leave behind. When the lamps came on, she folded the page around the rubbing and put both inside the brass case. She would return after the hearing even if the council found a reason to call the district empty.",
    ]
    title = f"Survey {index + 1:02d}: {place.title()}"
    if index == 0:
      title = "The Hidden Key"
      paragraphs.insert(0, "Mara began to trace the boundary with her finger. " + EARLY_EVIDENCE + " Ivo kept that knowledge from her while they worked. " + PROTECTED)
    elif index == 31:
      title = "Knowledge Before Its Time"
      paragraphs.insert(0, KNOWLEDGE_CONFLICT + " She used that certainty to promise the council an escape route.")
    elif index == 47:
      title = "The Reservoir Confession"
      paragraphs.insert(0, REVEAL + " She asked why he had waited until she had already promised the city a way out.")
    elif index == 63:
      title = "The Seventh Bell"
      paragraphs.insert(0, "Ivo began to count the families on the quay. " + PROTECTED + " Seven families were safe. Mara kept the brass case beside the bell rope.")
    body = "\n\n".join(paragraphs)
    created = add_scene(paths, title=title, pov="Mara", body=body)
    identifier = parse_front_matter(created)["id"]
    assign_scene(paths, scene_id=identifier, chapter_id=chapters[index // 4]["id"])
    originals[identifier] = body
  build_retrieval_index(paths)
  return {
    "kind": "synthetic-editorial-workload",
    "scene_count": 64,
    "chapter_count": 16,
    "word_count": sum(len(body.split()) for body in originals.values()),
    "anchors": {"early": "scene-0001", "conflict": "scene-0032", "reveal": "scene-0048", "ending": "scene-0064"},
    "originals": originals,
  }


if __name__ == "__main__":
  print(json.dumps(populate_editorial_workload(Path(sys.argv[1]))))
