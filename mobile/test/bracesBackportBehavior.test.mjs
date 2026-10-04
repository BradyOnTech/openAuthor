import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBracesModuleEntry, maintainBracesBackport } from "../scripts/braces-backport.mjs";

const mobile = resolve(import.meta.dirname, "..");
const nativeRequire = createRequire(resolve(mobile, "package.json"));
const digest = value => createHash("sha256").update(value).digest("hex");
const original = JSON.parse(readFileSync(resolve(mobile, "security/braces/originals.json"), "utf8"));
const sources = Object.fromEntries(Object.keys(original.files).filter(name => name.endsWith(".js"))
  .map(name => [name, readFileSync(resolve(mobile, "security/braces", name), "utf8")]));

function sourceModules(files) {
  const cache = {};
  const load = name => {
    if (cache[name]) return cache[name].exports;
    const module = { exports: {} };
    cache[name] = module;
    const require = dependency => {
      if (dependency === "fill-range") return nativeRequire(dependency);
      const path = posix.normalize(posix.join(posix.dirname(name), dependency)) + ".js";
      if (!Object.hasOwn(files, path)) throw new Error("Unexpected Braces source dependency");
      return load(path);
    };
    new Function("require", "module", "exports", files[name])(require, module, module.exports);
    return module.exports;
  };
  return load;
}

function uniqueReplace(text, before, after) {
  expect(text.split(before)).toHaveLength(2);
  return text.replace(before, () => after);
}

function embedded(text, name) {
  if (name === "resolve-workspace-root") {
    text = uniqueReplace(text, "var r=__nccwpck_require__(6144);module.exports=r})();",
      "var r=__nccwpck_require__(610);module.exports=r})();");
  } else {
    text = uniqueReplace(text, "var y=__nccwpck_require2_(6144);i.exports=y})()",
      "var y=__nccwpck_require2_(610);i.exports=y})()");
    text = uniqueReplace(text, "var __webpack_exports__=__nccwpck_require__(2712);module.exports=__webpack_exports__})();",
      "var __webpack_exports__=__nccwpck_require__(9072);module.exports=__webpack_exports__})();");
  }
  // Expose only the embedded Braces module through the existing loader. Doctor's
  // main entry and its network checks are never loaded by this private adapter.
  const filename = resolve(mobile, "security", name + "-isolated-test.cjs");
  const module = new Module(filename);
  module.filename = filename;
  module.paths = Module._nodeModulePaths(dirname(filename));
  module._compile(text, filename);
  expect(typeof module.exports).toBe("function");
  expect(typeof module.exports.parse).toBe("function");
  return module.exports;
}

function shape(node) {
  return Object.fromEntries(Object.entries(node).filter(([key]) => !["parent", "prev", "queue"].includes(key))
    .map(([key, value]) => [key, key === "nodes" ? value.map(shape) : value]));
}

function outcome(run) {
  try { return { value: run() }; } catch (error) { return { error: error.name }; }
}

const corpus = [
  ["a/{b,c}/d"], ["packages/*"], ["packages/{mobile,shared}"], ["{a,{b,c}}"],
  ["{a,b}{1,2}"], ["{1..3}"], ["{3..1}"], ["{01..03}"], ["{1..5..2}"],
  ["{a..c}"], ["{c..a}"], ["{a..e..2}"], ["${a,b}"], ["{}"], ["{a}"], ["{,a,}"],
  ["{a,a,b}"], ["{a,a,b}", { nodupes: true }], ["{,a,}", { noempty: true }],
  ["x\\{a,b}"], ["x\\{a,b}", { keepEscaping: true }], ["[{}()]/{a,b}"],
  ["\"{a,b}\""], ["\"{a,b}\"", { keepQuotes: true }], ["'{a,b}'"], ["`{a,b}`"],
  ["(a{b,c})"], ["{(a,b),c}"], ["@(a|b)/{x,y}"], ["{a,(b{c,d})}"],
  ["{a,b"], ["{a,b", { escapeInvalid: true }], ["(a{b,c}"], ["{a,(b}"],
  ["[a\\]b]/{c,d}"], ["x]/{a,b}"], ["{a,b,c}", { maxLength: 3 }],
  ["{1..4}", { rangeLimit: 2 }], ["{1..3}", { rangeLimit: false }],
  [""], ["a"], ["ab"], ["{a..}"], ["{1..3,a}"], ["{1...3}"],
  ["{a,{b,c}}", { escapeInvalid: true }], ["x\u00a0{a,b}\ufeffy"],
];
const copies = ["braces", "resolve-workspace-root", "expo-doctor"];
const implementations = {};

beforeAll(() => {
  for (const [name, text] of Object.entries(original.files)) expect(digest(text)).toBe(original.sha256[name]);
  const verified = maintainBracesBackport(mobile);
  expect(verified.dependency_audit_gate).toBe("separate_raw_audit_required");
  implementations.braces = { before: sourceModules(original.files)("index.js"), after: nativeRequire("braces") };
  const manifest = JSON.parse(readFileSync(resolve(mobile, "security/braces-backport-3.0.3.json"), "utf8"));
  for (const patch of manifest.patches.filter(item => item.modules)) {
    const current = readFileSync(resolve(mobile, patch.path), "utf8");
    expect(digest(current)).toBe(patch.patched_sha256);
    let baseline = current;
    for (const item of patch.modules) {
      baseline = uniqueReplace(baseline, buildBracesModuleEntry(item.source, sources[item.source]), item.original_entry);
    }
    expect(digest(baseline)).toBe(patch.original_sha256);
    const name = patch.path.includes("expo-doctor") ? "expo-doctor" : "resolve-workspace-root";
    implementations[name] = { before: embedded(baseline, name), after: embedded(current, name) };
  }
});

for (const name of copies) describe("actual " + name + " Braces compatibility", () => {
  it.each(corpus)("preserves ordinary pattern %s with %j", (pattern, options = {}) => {
    const { before, after } = implementations[name];
    expect(shape(after.parse(pattern))).toEqual(shape(before.parse(pattern)));
    for (const method of ["stringify", "compile", "expand", "create"]) {
      expect(outcome(() => after[method](pattern, options))).toEqual(outcome(() => before[method](pattern, options)));
    }
    expect(outcome(() => after(pattern, options))).toEqual(outcome(() => before(pattern, options)));
    expect(outcome(() => after([pattern, pattern], { ...options, expand: true, nodupes: true })))
      .toEqual(outcome(() => before([pattern, pattern], { ...options, expand: true, nodupes: true })));
  });

  it("refuses three combined containers at limit two while the original accepts them", () => {
    const { before, after } = implementations[name];
    for (const pattern of ["((a{b,c}))", "{a,(b{c,d})}", "{a,{b,{c,d}}}"]) {
      expect(() => before.parse(pattern, { maxDepth: 2 })).not.toThrow();
      for (const method of ["parse", "stringify", "compile", "expand", "create"]) {
        expect(() => after[method](pattern, { maxDepth: 2 })).toThrow("exceeds maxDepth");
      }
      expect(() => after([pattern], { maxDepth: 2 })).toThrow("exceeds maxDepth");
    }
    for (const pattern of ["(a{b,c})", "{a,{b,c}}", "((a))"]) {
      for (const method of ["parse", "stringify", "compile", "expand", "create"]) {
        expect(outcome(() => after[method](pattern, { maxDepth: 2 }))).toEqual(outcome(() => before[method](pattern)));
      }
    }
  });

  it("applies zero consistently and keeps escaped, quoted and bracket text literal", () => {
    const { before, after } = implementations[name];
    for (const pattern of ["{a,b}", "(a)"]) expect(() => after.parse(pattern, { maxDepth: 0 })).toThrow("maxDepth");
    for (const pattern of ["\\{a,b\\}", "[{}()]", "\"{a,b}\"", "plain"]) {
      for (const method of ["parse", "stringify", "compile", "expand", "create"]) {
        expect(outcome(() => after[method](pattern, { maxDepth: 0 }))).toEqual(outcome(() => before[method](pattern)));
      }
    }
  });

  it.each([1.5, -1, NaN, Infinity, "2", null, {}, [], 1n])("rejects invalid maxDepth %s on every public path", maxDepth => {
    const { after } = implementations[name];
    for (const method of ["parse", "stringify", "compile", "expand", "create"]) {
      expect(() => after[method]("a", { maxDepth })).toThrow("safe integer");
    }
    expect(() => after([], { maxDepth })).toThrow("safe integer");
  });

  it("validates direct parsed roots and subtrees before all three walkers", () => {
    const { before, after } = implementations[name];
    for (const method of ["stringify", "compile", "expand"]) {
      const pattern = "{a,{b,{c,d}}}";
      expect(() => after[method](before.parse(pattern), { maxDepth: 2 })).toThrow("maxDepth");
      const originalSubtree = before.parse("{a,{b,c}}").nodes[1];
      const patchedSubtree = before.parse("{a,{b,c}}").nodes[1];
      expect(outcome(() => after[method](patchedSubtree, { maxDepth: 2 })))
        .toEqual(outcome(() => before[method](originalSubtree)));
    }
  });

  it("rejects malformed/cyclic plain-data ASTs before expansion mutates them", () => {
    const { after } = implementations[name];
    const fixtures = [
      { type: "root", nodes: null }, { type: "root", nodes: [null] },
      { type: "root", nodes: [{ type: "text", value: ["x"] }] },
      { type: "brace", commas: [1], ranges: 0, nodes: [] },
    ];
    const childCycle = { type: "root", nodes: [] }; childCycle.nodes.push(childCycle); fixtures.push(childCycle);
    const parentCycle = { type: "root", nodes: [] }; parentCycle.parent = parentCycle; fixtures.push(parentCycle);
    const queueCycle = []; queueCycle.push(queueCycle); fixtures.push({ type: "root", nodes: [], queue: queueCycle });
    for (const ast of fixtures) for (const method of ["stringify", "compile", "expand"]) {
      expect(() => after[method](ast)).toThrow(/must be|cycle/);
      expect(ast.queue).not.toEqual([]);
    }
  });

  it("bounds every child edge, including noncontainer wrappers", () => {
    const { after } = implementations[name];
    const wrapper = child => ({ type: "text", nodes: [child] });
    const leaf = { type: "text", value: "x" };
    const accepted = wrapper(wrapper(wrapper(leaf)));
    expect(after.stringify(accepted, { maxDepth: 2 })).toBe("x");
    expect(() => after.stringify(wrapper(accepted), { maxDepth: 2 })).toThrow("child depth");
  });

  it("keeps the hard character ceiling with a nonfinite custom comparison", () => {
    const { after } = implementations[name];
    const flatText = "a".repeat(10001);
    for (const maxLength of [undefined, NaN, Infinity]) {
      expect(() => after.parse(flatText, { maxLength })).toThrow("exceeds max characters");
    }
  });

  it("retains shared text, stale imbalanced parents and repeated range AST behavior", () => {
    const { before, after } = implementations[name];
    const shared = { type: "text", value: "x" };
    expect(after.stringify({ type: "root", nodes: [shared, shared] })).toBe("xx");
    for (const method of ["stringify", "compile", "expand"]) {
      for (const pattern of ["{a,(b}", "{1..3}", "{(a,b),c}"]) {
        const baseline = before.parse(pattern); const candidate = before.parse(pattern);
        for (let i = 0; i < 2; i++) expect(outcome(() => after[method](candidate))).toEqual(outcome(() => before[method](baseline)));
      }
    }
  });
});

it("preserves both actual Metro glob callers on ordinary paths", () => {
  for (const path of ["metro-file-map/src/watchers/common.js", "@expo/metro-file-map/build/watchers/common.js"]) {
    const { includedByGlob } = nativeRequire(resolve(mobile, "node_modules", path));
    expect(includedByGlob("f", ["src/{mobile,shared}/**/*.ts"], false, "src/mobile/scene.ts")).toBe(true);
    expect(includedByGlob("f", ["src/{mobile,shared}/**/*.ts"], false, "src/other/scene.ts")).toBe(false);
    expect(includedByGlob("f", ["**/*.ts"], false, ".hidden/scene.ts")).toBe(false);
    expect(includedByGlob("f", ["**/*.ts"], true, ".hidden/scene.ts")).toBe(true);
  }
});

it("preserves public synchronous and asynchronous workspace resolution", async () => {
  const root = mkdtempSync(join(tmpdir(), "openauthor-braces-workspace-"));
  try {
    const workspace = nativeRequire("resolve-workspace-root");
    const globs = ["packages/{mobile,shared}"];
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "synthetic-workspace", private: true, workspaces: globs }));
    for (const name of ["mobile", "shared", "other"]) mkdirSync(join(root, "packages", name), { recursive: true });
    expect(workspace.getWorkspaceGlobs(root)).toEqual(globs);
    expect(await workspace.getWorkspaceGlobsAsync(root)).toEqual(globs);
    for (const name of ["mobile", "shared"]) {
      expect(workspace.resolveWorkspaceRoot(join(root, "packages", name))).toBe(root);
      expect(await workspace.resolveWorkspaceRootAsync(join(root, "packages", name))).toBe(root);
    }
    expect(workspace.resolveWorkspaceRoot(join(root, "packages", "other"))).toBeNull();
    expect(await workspace.resolveWorkspaceRootAsync(join(root, "packages", "other"))).toBeNull();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

it("normalizes high finite depth options without increasing the local bound", () => {
  const utils = sourceModules(sources)("lib/utils.js");
  expect(utils.normalizeDepth()).toBe(100);
  expect(utils.normalizeDepth({ maxDepth: Number.MAX_SAFE_INTEGER })).toBe(100);
  expect(utils.normalizeDepth({ maxDepth: 0 })).toBe(0);
  const arrays = ["a", [undefined, "b", ["c"]]];
  expect(utils.flatten(arrays, arrays)).toEqual(["a", "b", "c", "a", "b", "c"]);
});
