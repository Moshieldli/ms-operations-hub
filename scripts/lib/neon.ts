/**
 * Neon query helper for one-off scripts. Re-exports the app's shared client so
 * scripts don't each `neon(process.env.DATABASE_URL)`.
 *
 * Run scripts with the env file so DATABASE_URL is present:
 *   node --env-file=.env.local node_modules/tsx/dist/cli.mjs scripts/<name>.ts
 *
 * Usage: `import { sql } from "./lib/neon"; const r = await sql\`SELECT …\`;`
 */
export { sql, initSchema, getSyncState, setSyncState } from "../../src/lib/db";
