/**
 * Compliments / shout-outs (rev 50) — peer recognition shown on the route board.
 *
 * A shout-out is visible for 7 days from submission, newest first. Soft-deleted
 * (`hidden`) rows never show. The tech dropdown is driven by the roster
 * (`tech_roster`, filled from column A of the Technician sheet — names only).
 */
import { initSchema, sql } from "@/lib/db";
import type { Shoutout } from "@/components/tv-board-view";

export const SHOUTOUT_MAX_CHARS = 160;

/** Active (≤7 days, not hidden) shout-outs, newest first. */
export async function getActiveShoutouts(): Promise<Shoutout[]> {
  await initSchema();
  const rows = (await sql`
    SELECT id, technician, body, from_name, customer_name, created_at::text
    FROM compliments
    WHERE hidden = FALSE AND created_at > NOW() - INTERVAL '7 days'
    ORDER BY created_at DESC
  `) as Array<{
    id: number;
    technician: string;
    body: string;
    from_name: string;
    customer_name: string | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    technician: r.technician,
    body: r.body,
    fromName: r.from_name,
    customerName: r.customer_name,
    createdAt: r.created_at,
  }));
}

/** All shout-outs for the browser management view (incl. hidden), newest first. */
export async function listShoutouts(): Promise<Array<Shoutout & { hidden: boolean }>> {
  await initSchema();
  const rows = (await sql`
    SELECT id, technician, body, from_name, customer_name, hidden, created_at::text
    FROM compliments ORDER BY created_at DESC LIMIT 200
  `) as Array<{
    id: number;
    technician: string;
    body: string;
    from_name: string;
    customer_name: string | null;
    hidden: boolean;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: Number(r.id),
    technician: r.technician,
    body: r.body,
    fromName: r.from_name,
    customerName: r.customer_name,
    hidden: Boolean(r.hidden),
    createdAt: r.created_at,
  }));
}

export async function createShoutout(input: {
  technician: string;
  body: string;
  fromName: string;
  customerName?: string | null;
}): Promise<void> {
  await initSchema();
  const technician = input.technician.trim().slice(0, 120);
  const body = input.body.trim().slice(0, SHOUTOUT_MAX_CHARS);
  const fromName = input.fromName.trim().slice(0, 120);
  const customer = (input.customerName || "").trim().slice(0, 160) || null;
  if (!technician || !body || !fromName) throw new Error("technician, body and from-name are required");
  await sql`
    INSERT INTO compliments (technician, body, from_name, customer_name)
    VALUES (${technician}, ${body}, ${fromName}, ${customer})
  `;
}

/** Soft-delete (hide) or restore a shout-out. */
export async function setShoutoutHidden(id: number, hidden: boolean): Promise<void> {
  await initSchema();
  await sql`UPDATE compliments SET hidden = ${hidden} WHERE id = ${id}`;
}

/** Roster technician names for the shout-out dropdown, in sheet order. */
export async function getRosterNames(): Promise<string[]> {
  await initSchema();
  const rows = (await sql`
    SELECT name FROM tech_roster ORDER BY sort_order, name
  `) as Array<{ name: string }>;
  return rows.map((r) => r.name);
}
