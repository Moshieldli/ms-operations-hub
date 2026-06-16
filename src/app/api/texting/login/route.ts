// POST /api/texting/login  { password }  -> sets the texting_auth cookie on match.
//
// Compares against the TEXTING_PASSWORD env var. The cookie stores a SHA-256
// token of the password (not the password itself); src/middleware.ts recomputes
// the same token to verify, so the plaintext never lives in the browser.

import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const COOKIE = 'texting_auth';

async function token(pw: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ms-texting:${pw}`));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function POST(req: NextRequest) {
  const expected = process.env.TEXTING_PASSWORD;
  if (!expected) {
    return NextResponse.json({ error: 'TEXTING_PASSWORD is not set on the server.' }, { status: 500 });
  }

  let password = '';
  try {
    password = ((await req.json())?.password ?? '').toString();
  } catch {
    /* no/invalid body -> treated as empty */
  }

  if (password !== expected) {
    return NextResponse.json({ error: 'Incorrect password.' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(COOKIE, await token(expected), {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
