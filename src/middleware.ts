import { NextRequest, NextResponse } from 'next/server';

// Texting-only auth gate.
//
// The dashboard has no global login, but the texting archive (and its API) expose
// customer names, emails, addresses and phone numbers — so /texting and
// /api/texting/* sit behind a shared password set in the TEXTING_PASSWORD env var.
// Everything else in the app is intentionally left as-is.
//
// Fail-closed: if TEXTING_PASSWORD is unset, no cookie can ever match, so the
// pages stay locked rather than leaking PII.

const COOKIE = 'texting_auth';

async function expectedToken(): Promise<string | null> {
  const pw = process.env.TEXTING_PASSWORD;
  if (!pw) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`ms-texting:${pw}`));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // The login page + login API must stay reachable without a cookie.
  if (pathname === '/texting/login' || pathname.startsWith('/api/texting/login')) {
    return NextResponse.next();
  }

  const expected = await expectedToken();
  const token = req.cookies.get(COOKIE)?.value;
  if (expected && token === expected) return NextResponse.next();

  // API: hard 401 (no redirect — the client fetches handle this).
  if (pathname.startsWith('/api/texting')) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  // Page: send to the login screen, remembering where they were headed.
  const url = req.nextUrl.clone();
  const next = pathname + (req.nextUrl.search || '');
  url.pathname = '/texting/login';
  url.search = next && next !== '/texting' ? `?next=${encodeURIComponent(next)}` : '';
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ['/texting', '/texting/:path*', '/api/texting/:path*'],
};
