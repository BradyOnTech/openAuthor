import { test } from "@e2e-dev/web";
import { expect } from "e2e";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { desktopBook } from "../support/desktopBook.ts";

for (const format of ["markdown", "text", "docx", "scrivener"] as const) {
  test(`desktop previews and imports ${format}, reads exact prose and exports Markdown in the same order`, { tags: ["desktop", "interchange", format], timeout: 120_000 }, async ({ app, browser, screen }) => {
    const book = await desktopBook(browser);
    try {
      let source = join(book.sandbox, "original.md");
      let expectedTitles = ["The Moving Map", "The Clocktower"];
      let originalBodies = [
        "Mara unrolled the map beside the lamp. A red line crept across the paper, passing streets the city had forgotten. She locked the door and watched it move.\n\nAt midnight, the line reached her own door.",
        "The clocktower had no hands. Mara climbed its narrow stairs, carrying the map in a brass case. At the top, a bell rang for the missing hour.",
      ];
      if (format === "markdown") {
        await copyFile(fileURLToPath(new URL("../../desktop/e2e/fixtures/lantern.md", import.meta.url)), source);
      } else if (format === "text") {
        source = join(book.sandbox, "Arrival.txt");
        await writeFile(source, "Mara carried the brass map case home.\n\nShe locked the door.");
        expectedTitles = ["Arrival"];
        originalBodies = ["Mara carried the brass map case home.\n\nShe locked the door."];
      } else if (format === "docx") {
        const fixtureRoot = join(book.sandbox, "fixture");
        const initialized = await book.core(book.sandbox, ["init", fixtureRoot, "--name", "Portable fixture", "--json"]);
        expect(initialized.status).toBe(0);
        await book.json(["scene", "add", "--title", "Arrival", "--body", "Mara carried the brass map case home."], fixtureRoot);
        await book.json(["scene", "add", "--title", "Choice", "--body", "She locked the door."], fixtureRoot);
        source = join(book.sandbox, "original.docx");
        await book.json(["manuscript", "export", "--format", "docx", "--target", source], fixtureRoot);
        expectedTitles = ["Arrival", "Choice"];
        originalBodies = ["Mara carried the brass map case home.", "She locked the door."];
      } else {
        source = join(book.sandbox, "Novel.scriv");
        await mkdir(source);
        await writeFile(join(source, "Novel.scrivx"), '<ScrivenerProject><Binder><BinderItem Type="DraftFolder"><Title>Manuscript</Title><Children><BinderItem UUID="arrival" Type="Text"><Title>Arrival</Title></BinderItem><BinderItem UUID="choice" Type="Text"><Title>Choice</Title></BinderItem><BinderItem UUID="private" Type="Text"><Title>Private Notes</Title><MetaData><IncludeInCompile>No</IncludeInCompile></MetaData></BinderItem></Children></BinderItem></Binder></ScrivenerProject>');
        for (const [id, prose] of [["arrival", "Mara carried the brass map case home."], ["choice", "She locked the door."], ["private", "This private note stays out of the manuscript."]]) {
          const folder = join(source, "Files", "Data", id);
          await mkdir(folder, { recursive: true });
          await writeFile(join(folder, "content.rtf"), `{\\rtf1\\ansi ${prose}}`);
        }
        expectedTitles = ["Arrival", "Choice"];
        originalBodies = ["Mara carried the brass map case home.", "She locked the door."];
      }
      await app.open("/");
      await screen.getByRole("button", "New Project").tap();
      await screen.getByRole("textbox", "Novel title").fill("The Lantern Cartographer");
      await screen.getByRole("textbox", "Project folder").fill(book.projectRoot);
      await screen.getByRole("button", /Add existing content/).tap();
      await screen.getByRole("button", format === "scrivener" ? "Folder / Scrivener" : "Manuscript File").tap();
      await screen.getByPlaceholder(format === "scrivener" ? "/path/to/scenes-or-Novel.scriv" : "/path/to/novel.docx-or-project.scrivx").fill(source);
      await screen.getByRole("combobox", "Import structure").selectOption({ value: format === "text" ? "single" : "auto" });
      await screen.getByRole("button", /Preview/).tap();
      await expect(screen.getByText(new RegExp(`${expectedTitles.length} scenes ·`))).toBeVisible();
      await screen.getByRole("button", "Create novel").tap();
      await screen.getByRole("button", "Hide first-run guide").tap();
      await screen.getByRole("button", "Read manuscript").tap();
      const reader = screen.getByRole("main", "Manuscript reading copy");
      await expect(reader.getByRole("heading", { level: 3 })).toHaveText(expectedTitles);
      await expect(reader).not.toContainText("This private note stays out");
      const scenes = await book.json(["scene", "list"]);
      const savedBodies = [];
      for (const scene of scenes) savedBodies.push((await book.json(["scene", "get", "--id", scene.id])).body);
      expect(savedBodies.map(body => body.trimEnd())).toEqual(originalBodies.map((body: string) => body.trimEnd()));
      await screen.getByRole("button", /^Settings \(/).tap();
      await screen.getByRole("combobox", "Export format").selectOption({ value: "markdown" });
      const target = join(book.sandbox, "exported");
      await screen.getByRole("textbox", "Export destination").fill(target);
      await screen.getByRole("button", "Export").tap();
      await expect(screen.getByRole("region", "Export loss report").getByRole("status")).toContainText(`Exported ${expectedTitles.length} scenes`);
      const roundtrip = await book.json(["manuscript", "preview", "--source", target]);
      expect(roundtrip.scenes.map((scene: { title: string }) => scene.title)).toEqual(expectedTitles);
      expect(roundtrip.scenes.map((scene: { excerpt: string }) => scene.excerpt)).toEqual(savedBodies.map(body => body.trimEnd().slice(0, 240)));
      const roundtripRoot = join(book.sandbox, "roundtrip");
      expect((await book.core(book.sandbox, ["init", roundtripRoot, "--name", "Export roundtrip", "--json"])).status).toBe(0);
      await book.json(["manuscript", "import", "--source", target], roundtripRoot);
      const roundtripBodies: string[] = [];
      for (const scene of await book.json(["scene", "list"], roundtripRoot)) roundtripBodies.push((await book.json(["scene", "get", "--id", scene.id], roundtripRoot)).body);
      expect(roundtripBodies).toEqual(savedBodies);
      const manifest = JSON.parse(await readFile(join(target, "openauthor-manuscript.json"), "utf8"));
      expect(manifest.schema_version).toBe(1);
      expect(await book.errors()).toEqual([]);
    } finally { await book.close(); }
  });
}
