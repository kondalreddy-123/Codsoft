(() => {
  'use strict';
  const $ = s => document.querySelector(s);
  const boardEl = $('#board'), statusText = $('#statusText'), statusIcon = $('#statusIcon'), turnTag = $('#turnTag'), root = $('#stats');
  const KEY = 'ttt-profile-v1', K = 24;
  const LINES = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  const LEVEL = { easy: ['Easygoing', 800], medium: ['Balanced', 1000], hard: ['Sharp', 1250], impossible: ['Unbeatable', 1600] };
  const BOTS = Object.values(LEVEL);
  const fresh = () => ({ name: 'Player', rating: 1000, hist: [{ t: Date.now(), r: 1000 }], games: [], streak: 0, best: 0, opps: {} });
  function load() { try { const p = JSON.parse(localStorage.getItem(KEY)); if (p && Array.isArray(p.games)) return Object.assign(fresh(), p); } catch (e) {} return fresh(); }
  let P = load(), tab = 'overview', timer = null;
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(P)); } catch (e) {} };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const tier = r => r >= 1500 ? 'Grandmaster' : r >= 1300 ? 'Master' : r >= 1100 ? 'Strategist' : r >= 900 ? 'Challenger' : 'Rookie';
  const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
  window.TTTStats = { name: () => P.name, rating: () => P.rating };

  // ---- track moves
  let seq = [], prev = Array(9).fill(null);
  const read = () => [...boardEl.querySelectorAll('.cell')].map(b => { const m = /, ([XO])$/.exec(b.getAttribute('aria-label') || ''); return m ? m[1] : null; });
  new MutationObserver(() => { const cur = read(); if (!cur.some(Boolean)) seq = []; else cur.forEach((m, i) => { if (m && !prev[i]) seq.push([i, m]); }); prev = cur; }).observe(boardEl, { childList: true });

  // ---- record finished games
  function opponent(mode) {
    if (mode === 'online') { const o = window.TTTOnline; return { name: o ? o.peer.name : 'Opponent', rating: o ? o.peer.rating : 1000, kind: 'online' }; }
    if (mode === 'pvp') return { name: 'Local friend', rating: null, kind: 'local' };
    if (mode === 'custom') { const d = +$('#depthRange').value, b = +$('#blunderRange').value; return { name: `Custom · depth ${d}, ${b}% slips`, rating: Math.max(500, Math.min(1600, Math.round(700 + d * 100 - b * 6))), kind: 'ai' }; }
    const l = LEVEL[mode] || LEVEL.impossible; return { name: l[0], rating: l[1], kind: 'ai' };
  }
  function record() {
    const act = document.querySelector('.mode.active'), mode = act ? act.dataset.mode : 'impossible';
    const title = statusText.textContent, icon = statusIcon.textContent, o = opponent(mode);
    let res = /Beautifully/.test(title) ? 'W' : /machine|opponent/i.test(title) ? 'L' : 'D';
    const g = { t: Date.now(), mode, opp: o.name, res, moves: seq.slice(), d: 0, local: o.kind === 'local' };
    if (g.local) g.res = icon === '×' ? 'X' : icon === '○' ? 'O' : 'D';
    else {
      const s = res === 'W' ? 1 : res === 'L' ? 0 : 0.5, e = 1 / (1 + Math.pow(10, (o.rating - P.rating) / 400)), nr = Math.round(P.rating + K * (s - e));
      g.d = nr - P.rating; P.rating = nr; P.hist.push({ t: g.t, r: nr }); if (P.hist.length > 200) P.hist.shift();
      P.streak = res === 'W' ? P.streak + 1 : 0; P.best = Math.max(P.best, P.streak);
      const q = P.opps[o.name] || (P.opps[o.name] = { w: 0, l: 0, d: 0, r: o.rating, kind: o.kind });
      q[res === 'W' ? 'w' : res === 'L' ? 'l' : 'd']++; q.r = o.rating;
    }
    P.games.push(g); if (P.games.length > 100) P.games.shift(); save(); render();
  }
  let last = 'x';
  new MutationObserver(() => { const s = turnTag.textContent === 'DONE' ? 'done' : 'x'; if (s === 'done' && last !== 'done') record(); last = s; }).observe(turnTag, { childList: true, characterData: true, subtree: true });

  // ---- visuals
  function totals() { let w = 0, l = 0, d = 0; P.games.forEach(g => { if (g.local) return; if (g.res === 'W') w++; else if (g.res === 'L') l++; else d++; }); return { w, l, d, n: w + l + d }; }
  function donut(t) {
    const C = 2 * Math.PI * 36; let off = 0;
    const seg = (v, c) => { const len = t.n ? C * v / t.n : 0, s = `<circle r="36" cx="50" cy="50" fill="none" stroke="${c}" stroke-width="14" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 50 50)"/>`; off += len; return s; };
    return `<svg viewBox="0 0 100 100" width="132" height="132" role="img" aria-label="${t.w} wins, ${t.l} losses, ${t.d} draws"><circle r="36" cx="50" cy="50" fill="none" stroke="#e9e6db" stroke-width="14"/>${seg(t.w, '#3f7a3a')}${seg(t.l, '#c93d25')}${seg(t.d, '#a8935a')}<text x="50" y="56" text-anchor="middle" font-size="17" font-weight="700" fill="#22241f">${pct(t.w, t.n)}%</text></svg>`;
  }
  function spark() {
    const h = P.hist.slice(-40); if (h.length < 2) return '<p class="st-empty">Play a few rated games to see your rating curve.</p>';
    const W = 320, H = 110, p = 14, min = Math.min(...h.map(x => x.r)) - 10, max = Math.max(...h.map(x => x.r)) + 10;
    const pts = h.map((x, i) => [p + i * (W - 2 * p) / (h.length - 1), H - p - (x.r - min) / (max - min) * (H - 2 * p)]);
    const line = pts.map(q => q.map(n => n.toFixed(1)).join(',')).join(' '), e = pts[pts.length - 1];
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Rating over your last ${h.length} results"><polygon points="${p},${H - p} ${line} ${W - p},${H - p}" fill="#4a63b822"/><polyline points="${line}" fill="none" stroke="#4a63b8" stroke-width="2.5" stroke-linejoin="round"/><circle cx="${e[0]}" cy="${e[1]}" r="4.5" fill="#c93d25"/></svg><p class="st-cap">Low ${Math.min(...h.map(x => x.r))} · High ${Math.max(...h.map(x => x.r))} · Last ${h.length} results</p>`;
  }
  function boardSVG(g, upto) {
    const n = upto == null ? g.moves.length : upto, cells = Array(9).fill(null);
    g.moves.slice(0, n).forEach(([i, k], j) => { cells[i] = [k, j + 1]; });
    const f = cells.map(c => c && c[0]), win = n >= g.moves.length ? LINES.find(([a, b, c]) => f[a] && f[a] === f[b] && f[a] === f[c]) : null;
    let s = '<svg viewBox="0 0 90 90" width="112" height="112" aria-hidden="true">';
    for (let i = 0; i < 9; i++) {
      const x = (i % 3) * 30, y = Math.floor(i / 3) * 30, c = cells[i];
      s += `<rect x="${x + 1}" y="${y + 1}" width="28" height="28" rx="4" fill="${win && win.includes(i) ? '#f3dfaa' : '#f4f2eb'}"/>`;
      if (c) s += `<text x="${x + 15}" y="${y + 22}" text-anchor="middle" font-size="22" font-weight="700" fill="${c[0] === 'X' ? '#c93d25' : '#4a63b8'}">${c[0] === 'X' ? '×' : '○'}</text><text x="${x + 26}" y="${y + 10}" text-anchor="end" font-size="9" font-weight="700" fill="#55574f">${c[1]}</text>`;
    }
    return s + '</svg>';
  }
  const MODE = { easy: 'Easygoing', medium: 'Balanced', hard: 'Sharp', custom: 'Custom AI', impossible: 'Unbeatable', pvp: 'Two players', online: 'Online' };
  const fmt = t => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

  function overview() {
    const t = totals(), ai = Object.entries(P.opps).filter(([, q]) => q.kind === 'ai');
    return `<div class="st-kpis"><div><small>RATING</small><b>${P.rating}</b><em>${tier(P.rating)}</em></div><div><small>GAMES</small><b>${t.n}</b><em>${P.games.length - t.n} local</em></div><div><small>WIN RATE</small><b>${pct(t.w, t.n)}%</b><em>${t.w}W · ${t.l}L · ${t.d}D</em></div><div><small>STREAK</small><b>${P.streak}</b><em>Best ${P.best}</em></div></div>
    <div class="st-grid"><div class="st-box"><h3>RESULTS</h3><div class="st-donut">${donut(t)}<ul class="st-legend"><li><i style="background:#3f7a3a"></i>Wins ${t.w}</li><li><i style="background:#c93d25"></i>Losses ${t.l}</li><li><i style="background:#a8935a"></i>Draws ${t.d}</li></ul></div></div>
    <div class="st-box"><h3>RATING OVER TIME</h3>${spark()}</div>
    <div class="st-box st-wide"><h3>WIN RATE BY OPPONENT</h3>${ai.length ? ai.map(([n, q]) => { const tot = q.w + q.l + q.d; return `<div class="st-bar"><span>${esc(n)}</span><div role="img" aria-label="${pct(q.w, tot)}% wins over ${tot} games"><i style="width:${pct(q.w, tot)}%"></i></div><b>${pct(q.w, tot)}%</b></div>`; }).join('') : '<p class="st-empty">Beat the machine a few times to see how you do at each level.</p>'}</div></div>`;
  }
  function history() {
    if (!P.games.length) return '<p class="st-empty">No games yet. Finish a round and it will appear here. Tap a board to replay it.</p>';
    return '<div class="st-hist">' + P.games.map((g, i) => [g, i]).reverse().slice(0, 12).map(([g, i]) => {
      const label = g.local ? (g.res === 'D' ? 'DRAW' : g.res === 'X' ? '× WON' : '○ WON') : g.res === 'W' ? 'WIN' : g.res === 'L' ? 'LOSS' : 'DRAW';
      return `<button type="button" class="hg" data-replay="${i}" aria-label="Replay game: ${label} against ${esc(g.opp)}"><span class="bsvg">${boardSVG(g)}</span><span class="hg-t"><b class="res-${g.res}">${label}</b><span>${esc(g.opp)}</span><small>${MODE[g.mode] || g.mode} · ${g.moves.length} moves · ${fmt(g.t)}</small><small>${g.local ? 'Unrated' : (g.d >= 0 ? '+' : '') + g.d + ' rating'} · ▶ REPLAY</small></span></button>`;
    }).join('') + '</div>';
  }
  function ladder() {
    const rows = [{ n: P.name + ' (you)', r: P.rating, me: 1, rec: `${totals().w}W · ${totals().l}L · ${totals().d}D` }];
    Object.entries(P.opps).filter(([, q]) => q.kind === 'online').forEach(([n, q]) => rows.push({ n, r: q.r, rec: `${q.l}W · ${q.w}L · ${q.d}D vs you` }));
    BOTS.forEach(([n, r]) => { const q = P.opps[n]; rows.push({ n: n + ' AI', r, rec: q ? `${q.l}W · ${q.w}L · ${q.d}D vs you` : 'Not met yet' }); });
    rows.sort((a, b) => b.r - a.r);
    return `<table class="st-table"><caption class="st-cap">Rankings on this device: your Elo rating against the AI levels and online rivals you have played.</caption><thead><tr><th scope="col">#</th><th scope="col">PLAYER</th><th scope="col">RATING</th><th scope="col">TIER</th><th scope="col">RECORD</th></tr></thead><tbody>${rows.map((x, i) => `<tr class="${x.me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(x.n)}</td><td>${x.r}</td><td>${tier(x.r)}</td><td>${esc(x.rec)}</td></tr>`).join('')}</tbody></table>`;
  }
  function render() {
    const tabs = [['overview', 'OVERVIEW'], ['history', 'GAME HISTORY'], ['ladder', 'LEADERBOARD']];
    root.innerHTML = `<div class="st-head"><div class="label">PLAYER STATISTICS <span>${esc(tier(P.rating)).toUpperCase()} · ${P.rating}</span></div><label class="st-name">PLAYER NAME<input id="stName" maxlength="16" value="${esc(P.name)}" autocomplete="off"></label></div>
    <div class="st-tabs" role="tablist">${tabs.map(([k, l]) => `<button type="button" role="tab" aria-selected="${tab === k}" data-tab="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <div class="st-body" role="tabpanel">${tab === 'overview' ? overview() : tab === 'history' ? history() : ladder()}</div>
    <button type="button" class="st-reset" id="stReset">RESET MY DATA</button>`;
  }
  root.addEventListener('click', e => {
    const t = e.target.closest('[data-tab]'); if (t) { tab = t.dataset.tab; render(); return; }
    const r = e.target.closest('[data-replay]');
    if (r) {
      const g = P.games[+r.dataset.replay], box = r.querySelector('.bsvg'); if (!g) return;
      clearInterval(timer); let n = 0; box.innerHTML = boardSVG(g, 0);
      timer = setInterval(() => { n++; box.innerHTML = boardSVG(g, n); if (n >= g.moves.length) clearInterval(timer); }, 480);
      return;
    }
    if (e.target.id === 'stReset' && confirm('Reset your rating, history and leaderboard on this device?')) { P = fresh(); save(); render(); }
  });
  root.addEventListener('change', e => { if (e.target.id === 'stName') { P.name = e.target.value.replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Player'; save(); render(); } });
  render();
})();
