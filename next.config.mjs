/** @type {import('next').NextConfig} */
const nextConfig = {
  /**
   * Serve the public `.csv` fleet-count URLs from DOT-FREE route handlers.
   *
   * WHY: a route segment containing a dot (`app/api/fleet-counts/customers.csv/
   * route.ts`) compiles, appears in the build manifest, and serves 200 under
   * `next start` — but **404s on Vercel**, for every client. Vercel resolves
   * extension-looking paths against the static filesystem first and never
   * dispatches to the function, which is what broke Google Sheets IMPORTDATA
   * ("Resource at url not found"). Nothing to do with the user agent.
   *
   * These are REWRITES, not redirects: a sheet's existing URL keeps working and
   * never sees a 3xx (the requirement is 200 + text/csv with no hop).
   *
   * `beforeFiles` so the rewrite runs BEFORE filesystem resolution — the exact
   * phase that was swallowing these paths.
   */
  async rewrites() {
    return {
      beforeFiles: [
        { source: "/api/fleet-counts.csv", destination: "/api/fleet-counts/both" },
        { source: "/api/fleet-counts/customers.csv", destination: "/api/fleet-counts/customers" },
        { source: "/api/fleet-counts/services.csv", destination: "/api/fleet-counts/services" },
      ],
      afterFiles: [],
      fallback: [],
    };
  },
};

export default nextConfig;
