// Place this at:  src/app/api/texting/search/route.ts
//
//   /api/texting/search?list=1        -> every conversation, newest activity first (left pane)
//   /api/texting/search?cid=12345     -> the full thread for one conversation (right pane)
//   /api/texting/search?q=respray     -> optional: text search across all messages
//
// It sits inside your existing dashboard, so whatever login protects the rest of
// the app protects this too. (Confirm your auth/middleware covers /api and /texting.)

import { neon } from '@neondatabase/serverless';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const sql = neon(
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL ||
  (process.env.POSTGRES_URL as string)
);

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;

  // ----- left pane: the full conversation list -----
  if (sp.get('list')) {
    try {
      const conversations = await sql`
        SELECT conversation_id, phone, first_name, last_name, email, city, state,
               last_message, status, updated_at
        FROM texting_contacts
        ORDER BY updated_at DESC NULLS LAST
      `;
      return NextResponse.json({ conversations });
    } catch {
      // no contacts table loaded — derive a list straight from the messages
      const conversations = await sql`
        SELECT conversation_id,
               MAX(phone) AS phone,
               MAX(sent_at) AS updated_at,
               (ARRAY_AGG(body ORDER BY sent_at DESC NULLS LAST))[1] AS last_message
        FROM texting_messages
        GROUP BY conversation_id
        ORDER BY updated_at DESC NULLS LAST
      `;
      return NextResponse.json({ conversations });
    }
  }

  // ----- right pane: one full thread -----
  const cid = sp.get('cid');
  if (cid) {
    const messages = await sql`
      SELECT conversation_id, phone, body, sent_at, direction, is_inbound
      FROM texting_messages
      WHERE conversation_id = ${cid}
      ORDER BY sent_at ASC NULLS LAST, id ASC
    `;
    let contact: Record<string, unknown> | null = null;
    try {
      const c = await sql`SELECT * FROM texting_contacts WHERE conversation_id = ${cid} LIMIT 1` as Record<string, unknown>[];
      contact = c[0] || null;
    } catch { /* contacts table optional */ }
    return NextResponse.json({ messages, contact });
  }

  // ----- optional: text search across message bodies -----
  const q = (sp.get('q') || '').trim();
  if (q.length >= 3) {
    const like = `%${q}%`;
    const messages = await sql`
      SELECT conversation_id, phone, body, sent_at, direction, is_inbound
      FROM texting_messages
      WHERE body ILIKE ${like}
      ORDER BY sent_at DESC NULLS LAST
      LIMIT 300
    `;
    return NextResponse.json({ messages });
  }

  return NextResponse.json({ conversations: [] });
}
