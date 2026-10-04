export default {
  root: "/private/tmp/openauthor-desktop-grouped-updates/desktop",
  cacheDir: "/private/tmp/openauthor-supabase-upgrade-review/.vite-retained-old",
  resolve: { alias: {
    "@supabase/supabase-js": "~/Developer/openAuthor/desktop/node_modules/@supabase/supabase-js/dist/index.mjs",
  } },
  test: { include: ["src/cloud/account.supabase.test.ts"], maxWorkers: 1, reporters: ["default"] },
};
