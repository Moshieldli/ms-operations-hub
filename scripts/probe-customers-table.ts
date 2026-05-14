/** Verify the customers table reflects the overnight enrichment. */
import { sql } from "../src/lib/db";

(async () => {
  const total = (await sql`SELECT COUNT(*) AS n FROM customers`) as Array<{ n: string }>;
  console.log(`Total enriched customers: ${total[0].n}`);

  const byStatus = (await sql`
    SELECT status, COUNT(*) AS n
    FROM customers
    GROUP BY status
    ORDER BY n DESC
  `) as Array<{ status: string; n: string }>;
  console.log("By status:");
  for (const r of byStatus) console.log(`  ${r.status}: ${r.n}`);

  const tagSummary = (await sql`
    SELECT
      AVG(jsonb_array_length(tags))::numeric(10,2) AS avg_tags,
      MAX(jsonb_array_length(tags)) AS max_tags,
      COUNT(*) FILTER (WHERE jsonb_array_length(tags) = 0) AS no_tags
    FROM customers
  `) as Array<{ avg_tags: string; max_tags: number; no_tags: string }>;
  console.log("Tags:");
  console.log(`  avg per customer: ${tagSummary[0].avg_tags}`);
  console.log(`  max per customer: ${tagSummary[0].max_tags}`);
  console.log(`  customers with 0 tags: ${tagSummary[0].no_tags}`);

  const sample = (await sql`
    SELECT pocomos_id, status, full_name, last_service_date, cancel_date,
           jsonb_array_length(tags) AS tag_count,
           jsonb_array_length(contracts) AS contract_count,
           tags
    FROM customers
    WHERE status = 'Inactive'
    ORDER BY refreshed_at DESC
    LIMIT 3
  `) as Array<{
    pocomos_id: string;
    status: string;
    full_name: string;
    last_service_date: string;
    cancel_date: string;
    tag_count: number;
    contract_count: number;
    tags: string[];
  }>;
  console.log("\nSample enriched inactive customers:");
  for (const r of sample) {
    console.log(`  ${r.pocomos_id} (${r.full_name}) cancel=${r.cancel_date} tags=${r.tag_count} contracts=${r.contract_count}`);
    console.log(`    tags: [${r.tags.join(", ")}]`);
  }
})();
