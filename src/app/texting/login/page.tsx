'use client';

import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';

function LoginForm() {
  const params = useSearchParams();
  const next = params.get('next') || '/texting';
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      const res = await fetch('/api/texting/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        window.location.assign(next.startsWith('/texting') ? next : '/texting');
        return;
      }
      const d = await res.json().catch(() => ({}));
      setErr(d.error || `Sign-in failed (${res.status}).`);
    } catch {
      setErr('Network error. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="lg-root">
      <style>{`
        .lg-root{--ink:#15201d;--muted:#647069;--line:#e4e8e4;--bg:#f4f6f4;--card:#fff;
          --accent:#117e63;--accent-soft:#e6f1ec;
          min-height:100vh;display:flex;align-items:center;justify-content:center;
          background:var(--bg);color:var(--ink);padding:24px;
          font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
          -webkit-font-smoothing:antialiased;}
        .lg-card{background:var(--card);border:1px solid var(--line);border-radius:14px;
          padding:28px;width:100%;max-width:360px;box-shadow:0 1px 2px rgba(0,0,0,.04);}
        .lg-eyebrow{font:600 11px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;
          text-transform:uppercase;color:var(--accent);margin:0 0 6px;}
        .lg-title{font-size:19px;font-weight:670;letter-spacing:-.01em;margin:0 0 4px;}
        .lg-sub{font-size:13.5px;color:var(--muted);margin:0 0 18px;line-height:1.45;}
        .lg-label{display:block;font-size:12px;color:var(--muted);margin:0 0 6px;font-weight:600;}
        .lg-input{width:100%;box-sizing:border-box;font-size:15px;padding:10px 12px;
          border:1px solid var(--line);border-radius:10px;outline:none;background:var(--bg);}
        .lg-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);background:#fff;}
        .lg-btn{margin-top:14px;width:100%;font:inherit;font-size:15px;font-weight:600;
          padding:11px 12px;border:none;border-radius:10px;background:var(--accent);color:#fff;
          cursor:pointer;}
        .lg-btn:disabled{opacity:.6;cursor:default;}
        .lg-err{margin-top:12px;font-size:13px;color:#b3261e;}
      `}</style>
      <form className="lg-card" onSubmit={submit}>
        <p className="lg-eyebrow">Texting archive</p>
        <h1 className="lg-title">Sign in</h1>
        <p className="lg-sub">This area contains customer contact details. Enter the access password to continue.</p>
        <label className="lg-label" htmlFor="lg-pw">Password</label>
        <input
          id="lg-pw"
          className="lg-input"
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <button className="lg-btn" type="submit" disabled={busy || !password}>
          {busy ? 'Checking…' : 'Continue'}
        </button>
        {err ? <div className="lg-err">{err}</div> : null}
      </form>
    </div>
  );
}

export default function TextingLogin() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
