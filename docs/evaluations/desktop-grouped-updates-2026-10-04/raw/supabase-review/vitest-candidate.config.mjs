export default {
  root: "/private/tmp/openauthor-supabase-upgrade-review",
  resolve: { alias: {
    vitest: "/private/tmp/openauthor-desktop-grouped-updates/desktop/node_modules/vitest/dist/index.js",
    "@supabase/supabase-js": "/private/tmp/openauthor-desktop-grouped-updates/desktop/node_modules/@supabase/supabase-js/dist/index.mjs",
    "./account": "/private/tmp/openauthor-desktop-grouped-updates/desktop/src/cloud/account.ts",
  } },
  test: { include: ["account.supabase.test.ts"], maxWorkers: 1, testTimeout: 5000, reporters: ["default"] },
};
