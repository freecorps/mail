// @freecorps/ember-* come from npm (their "exports" point to dist/). Only this repo's own @freecorps/mail-sdk keeps a
// source export condition, so the api tests (which import it) run without building it first.
// The workerd config only adds the condition: @cloudflare/vitest-plugin appends its own (workerd, worker, ...).
export const SOURCE_CONDITION = "@freecorps/ember-source";

/** For configs using @cloudflare/vitest-plugin. */
export const workerdSourceResolve = {
  resolve: { conditions: [SOURCE_CONDITION] },
  ssr: { resolve: { conditions: [SOURCE_CONDITION, "workerd", "worker", "module", "browser", "development|production"] } },
};
