const { createRequire } = require("node:module");
const requireAt = createRequire("/private/tmp/openauthor-desktop-grouped-updates/desktop/package.json");
const { chromium, webkit } = requireAt("playwright");
(async () => {
  for (const [name, type] of Object.entries({ chromium, webkit })) {
    const browser = await type.launch();
    try {
      const page = await browser.newPage();
      await page.setContent('<button class="tree-item"><span aria-hidden="true">○</span><span class="tree-item__label">The Door</span><span class="tree-item__badge">DRA</span></button>');
      const row = page.locator("button");
      const withoutCss = await row.ariaSnapshot();
      await page.addStyleTag({ content: ".tree-item { display:flex; align-items:center; gap:8px } .tree-item__label { flex:1 }" });
      const withCss = await row.ariaSnapshot();
      await row.evaluate(button => button.setAttribute("aria-label", "The Door DRA"));
      const withLabel = await row.ariaSnapshot();
      await page.locator("style").evaluate(style => style.remove());
      const withLabelWithoutCss = await row.ariaSnapshot();
      console.log(JSON.stringify({ name, withoutCss, withCss, withLabel, withLabelWithoutCss }));
    } finally { await browser.close(); }
  }
})();
