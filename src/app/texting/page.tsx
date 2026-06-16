// Place this at:  src/app/texting/page.tsx
// Reach it at:    https://your-dashboard/texting
'use client';

import { useEffect, useMemo, useState } from 'react';

type Conv = {
  conversation_id: string;
  phone: string;
  first_name?: string; last_name?: string; email?: string;
  city?: string; state?: string;
  last_message?: string; status?: string;
  updated_at?: string | null;
};
type Msg = {
  conversation_id: string;
  phone: string;
  body: string;
  sent_at: string | null;
  direction: string | null;
  is_inbound: boolean | null;
};

const fmtPhone = (p: string) => {
  const d = (p || '').replace(/\D/g, '').slice(-10);
  return d.length === 10 ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : (p || '');
};
const fmtDateShort = (s?: string | null) => {
  if (!s) return '';
  const d = new Date(s); if (isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric', year: '2-digit' });
};
const fmtTime = (s: string | null) => {
  if (!s) return '';
  const d = new Date(s); if (isNaN(d.getTime())) return '';
  return d.toLocaleString(undefined, { hour: 'numeric', minute: '2-digit' });
};
const dayKey = (s: string | null) => {
  if (!s) return 'Undated';
  const d = new Date(s); if (isNaN(d.getTime())) return 'Undated';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
};
const nameOf = (c?: Partial<Conv>) => [c?.first_name, c?.last_name].filter(Boolean).join(' ').trim();

export default function TextingArchive() {
  const [convs, setConvs] = useState<Conv[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listErr, setListErr] = useState('');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(200);

  const [selected, setSelected] = useState<Conv | null>(null);
  const [thread, setThread] = useState<Msg[]>([]);
  const [contact, setContact] = useState<Conv | null>(null);
  const [loadingThread, setLoadingThread] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch('/api/texting/search?list=1');
        if (!res.ok) throw new Error(`Couldn't load conversations (${res.status})`);
        const d = await res.json();
        setConvs(d.conversations || []);
      } catch (e) {
        setListErr(e instanceof Error ? e.message : 'Failed to load.');
      } finally {
        setLoadingList(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    const digits = term.replace(/\D/g, '');
    if (!term) return convs;
    return convs.filter(c => {
      if (digits && (c.phone || '').replace(/\D/g, '').includes(digits)) return true;
      const hay = `${nameOf(c)} ${c.email || ''} ${c.city || ''} ${c.last_message || ''}`.toLowerCase();
      return hay.includes(term);
    });
  }, [convs, q]);

  async function open(c: Conv) {
    setSelected(c); setThread([]); setContact(null); setLoadingThread(true);
    try {
      const res = await fetch(`/api/texting/search?cid=${encodeURIComponent(c.conversation_id)}`);
      const d = await res.json();
      setThread(d.messages || []);
      setContact(d.contact || c);
    } catch {
      setThread([]);
    } finally {
      setLoadingThread(false);
    }
  }

  const days = useMemo(() => {
    const out: { day: string; msgs: Msg[] }[] = [];
    for (const m of thread) {
      const k = dayKey(m.sent_at);
      if (!out.length || out[out.length - 1].day !== k) out.push({ day: k, msgs: [] });
      out[out.length - 1].msgs.push(m);
    }
    return out;
  }, [thread]);

  return (
    <div className={`tx-root${selected ? ' tx-has-sel' : ''}`}>
      <style>{`
        .tx-root{--ink:#15201d;--muted:#647069;--line:#e4e8e4;--bg:#f4f6f4;--card:#fff;
          --accent:#117e63;--accent-soft:#e6f1ec;--in:#eceeec;--sel:#eef4f1;
          color:var(--ink);background:var(--bg);height:100vh;display:flex;flex-direction:column;
          font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
          -webkit-font-smoothing:antialiased;}
        .tx-top{padding:14px 20px;border-bottom:1px solid var(--line);background:var(--card);}
        .tx-eyebrow{font:600 11px/1 ui-monospace,Menlo,Consolas,monospace;letter-spacing:.14em;
          text-transform:uppercase;color:var(--accent);margin:0 0 6px;}
        .tx-title{font-size:19px;font-weight:670;letter-spacing:-.01em;margin:0;}
        .tx-main{flex:1;display:grid;grid-template-columns:340px 1fr;min-height:0;}
        .tx-list{border-right:1px solid var(--line);background:var(--card);display:flex;
          flex-direction:column;min-height:0;}
        .tx-search{padding:12px;border-bottom:1px solid var(--line);}
        .tx-input{width:100%;box-sizing:border-box;font-size:15px;padding:10px 12px;
          border:1px solid var(--line);border-radius:10px;outline:none;background:var(--bg);}
        .tx-input:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft);background:#fff;}
        .tx-count{padding:8px 14px;font-size:12px;color:var(--muted);
          font-family:ui-monospace,Menlo,Consolas,monospace;}
        .tx-rows{overflow-y:auto;flex:1;min-height:0;}
        .tx-item{display:block;width:100%;text-align:left;border:none;background:none;cursor:pointer;
          padding:11px 14px;border-bottom:1px solid var(--line);font:inherit;color:inherit;}
        .tx-item:hover{background:var(--bg);}
        .tx-item.on{background:var(--sel);box-shadow:inset 3px 0 0 var(--accent);}
        .tx-itop{display:flex;justify-content:space-between;gap:8px;align-items:baseline;}
        .tx-iname{font-weight:600;font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .tx-idate{font-size:11.5px;color:var(--muted);flex:none;
          font-family:ui-monospace,Menlo,Consolas,monospace;}
        .tx-iprev{font-size:13px;color:var(--muted);margin-top:3px;
          white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .tx-more{padding:12px;text-align:center;}
        .tx-moreb{font:inherit;font-size:13px;padding:8px 16px;border:1px solid var(--line);
          border-radius:9px;background:var(--card);cursor:pointer;color:var(--ink);}
        .tx-detail{display:flex;flex-direction:column;min-height:0;}
        .tx-dhead{padding:15px 20px;border-bottom:1px solid var(--line);background:var(--card);
          display:flex;align-items:center;gap:12px;}
        .tx-back{display:none;border:none;background:var(--bg);border-radius:8px;cursor:pointer;
          font-size:18px;line-height:1;padding:6px 10px;color:var(--ink);}
        .tx-dname{font-weight:650;font-size:16px;}
        .tx-dmeta{color:var(--muted);font-size:12.5px;margin-top:2px;
          font-family:ui-monospace,Menlo,Consolas,monospace;}
        .tx-scroll{overflow-y:auto;flex:1;min-height:0;padding:6px 20px 26px;}
        .tx-day{display:flex;align-items:center;gap:12px;margin:18px 0 12px;}
        .tx-day::before,.tx-day::after{content:"";flex:1;height:1px;background:var(--line);}
        .tx-day span{font-size:11px;letter-spacing:.05em;color:var(--muted);
          text-transform:uppercase;font-weight:600;}
        .tx-row{display:flex;margin:7px 0;}
        .tx-row.out{justify-content:flex-end;}
        .tx-bub{max-width:72%;padding:9px 13px;border-radius:15px;font-size:14.5px;
          line-height:1.42;white-space:pre-wrap;word-break:break-word;}
        .tx-row.in .tx-bub{background:var(--in);border-bottom-left-radius:5px;}
        .tx-row.out .tx-bub{background:var(--accent);color:#fff;border-bottom-right-radius:5px;}
        .tx-stamp{font-size:11px;color:var(--muted);margin-top:3px;
          font-family:ui-monospace,Menlo,Consolas,monospace;}
        .tx-row.out .tx-stamp{text-align:right;}
        .tx-blank{display:flex;height:100%;align-items:center;justify-content:center;
          color:var(--muted);font-size:15px;text-align:center;padding:30px;}
        @media (max-width:760px){
          .tx-main{grid-template-columns:1fr;}
          .tx-detail{display:none;}
          .tx-list{border-right:none;}
          .tx-has-sel .tx-list{display:none;}
          .tx-has-sel .tx-detail{display:flex;}
          .tx-back{display:block;}
          .tx-bub{max-width:84%;}
        }
      `}</style>

      <div className="tx-top">
        <p className="tx-eyebrow">Texting archive</p>
        <h1 className="tx-title">Conversations</h1>
      </div>

      <div className="tx-main">
        <div className="tx-list">
          <div className="tx-search">
            <input
              className="tx-input"
              placeholder="Search number, name, or message"
              value={q}
              onChange={e => { setQ(e.target.value); setLimit(200); }}
            />
          </div>
          <div className="tx-count">
            {loadingList ? 'Loading…' : listErr ? listErr
              : `${filtered.length.toLocaleString()} conversation${filtered.length === 1 ? '' : 's'}`}
          </div>
          <div className="tx-rows">
            {filtered.slice(0, limit).map(c => (
              <button
                key={c.conversation_id}
                className={`tx-item${selected?.conversation_id === c.conversation_id ? ' on' : ''}`}
                onClick={() => open(c)}
              >
                <div className="tx-itop">
                  <span className="tx-iname">{nameOf(c) || fmtPhone(c.phone)}</span>
                  <span className="tx-idate">{fmtDateShort(c.updated_at)}</span>
                </div>
                <div className="tx-iprev">{nameOf(c) ? `${fmtPhone(c.phone)} · ` : ''}{c.last_message || '—'}</div>
              </button>
            ))}
            {!loadingList && filtered.length > limit && (
              <div className="tx-more">
                <button className="tx-moreb" onClick={() => setLimit(l => l + 200)}>
                  Show more ({(filtered.length - limit).toLocaleString()} left)
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="tx-detail">
          {!selected ? (
            <div className="tx-blank">Pick a conversation on the left to read the full thread.</div>
          ) : (
            <>
              <div className="tx-dhead">
                <button className="tx-back" onClick={() => setSelected(null)} aria-label="Back">←</button>
                <div>
                  <div className="tx-dname">{nameOf(contact || selected) || fmtPhone(selected.phone)}</div>
                  <div className="tx-dmeta">
                    {fmtPhone(selected.phone)}
                    {(contact?.email) ? ` · ${contact.email}` : ''}
                    {[contact?.city, contact?.state].filter(Boolean).length ? ` · ${[contact?.city, contact?.state].filter(Boolean).join(', ')}` : ''}
                    {!loadingThread ? ` · ${thread.length} message${thread.length === 1 ? '' : 's'}` : ''}
                  </div>
                </div>
              </div>
              <div className="tx-scroll">
                {loadingThread ? (
                  <div className="tx-blank">Loading…</div>
                ) : thread.length === 0 ? (
                  <div className="tx-blank">No messages stored for this conversation.</div>
                ) : days.map((d, i) => (
                  <div key={i}>
                    <div className="tx-day"><span>{d.day}</span></div>
                    {d.msgs.map((m, j) => {
                      const out = m.is_inbound === false;
                      return (
                        <div className={`tx-row ${out ? 'out' : 'in'}`} key={j}>
                          <div>
                            <div className="tx-bub">{m.body || '—'}</div>
                            <div className="tx-stamp">{fmtTime(m.sent_at)}{m.direction ? ` · ${m.direction}` : ''}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
