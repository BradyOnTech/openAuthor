// Build-tool verification runs in Node, outside the React Native type environment.
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);

describe("native build dependency compatibility", () => {
  it("can parse an Xcode project and generate identifiers with the patched UUID dependency", () => {
    const directory = mkdtempSync(join(tmpdir(), "openauthor-xcode-"));
    try {
      const path = join(directory, "project.pbxproj");
      writeFileSync(path, `// !$*UTF8*$!
{
  archiveVersion = 1;
  classes = {};
  objectVersion = 56;
  objects = {
/* Begin PBXProject section */
    A00000000000000000000001 = { isa = PBXProject; targets = (); };
/* End PBXProject section */
  };
  rootObject = A00000000000000000000001;
}
`);
      const project = require("xcode").project(path);
      project.parseSync();
      const identifiers = new Set(Array.from({ length: 100 }, () => project.generateUuid()));
      expect(identifiers.size).toBe(100);
      for (const identifier of identifiers) expect(identifier).toMatch(/^[A-F0-9]{24}$/);
      expect(project.writeSync()).toContain("PBXProject");
    } finally {
      rmSync(directory, { recursive: true });
    }
  });
});
