const { createRequire } = require("node:module");
const roots = [
  "~/Developer/openAuthor/desktop/package.json",
  "/private/tmp/openauthor-desktop-grouped-updates/desktop/package.json",
];
const html = '<button class="tree-item"><span aria-hidden="true">○</span><span class="tree-item__label">The Door</span><span class="tree-item__badge">DRA</span></button>';
for (const root of roots) {
  const requireAt = createRequire(root);
  const { JSDOM } = requireAt("jsdom");
  const { computeAccessibleName } = requireAt("dom-accessibility-api");
  const dom = new JSDOM(html);
  const button = dom.window.document.querySelector("button");
  const span = dom.window.document.querySelector(".tree-item__label");
  const before = { display: dom.window.getComputedStyle(span).display, name: computeAccessibleName(button) };
  span.style.display = "block";
  const after = { display: dom.window.getComputedStyle(span).display, name: computeAccessibleName(button) };
  console.log(JSON.stringify({ jsdom: requireAt("jsdom/package.json").version, before, after }));
  dom.window.close();
}
