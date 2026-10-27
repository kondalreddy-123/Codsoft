(() => {
  'use strict';
  // Sound + feedback animations. Observes the DOM only; game logic in game.js is untouched.
  const $ = s => document.querySelector(s);
  const boardEl = $('#board'), statusEl = $('.status'), statusText = $('#statusText'), turnTag = $('#turnTag');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');

  // ---------- Audio (synthesized with Web Audio, no files) ----------
  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null, master = null, muted = false;
  try { muted = localStorage.getItem('ttt-muted') === '1'; } catch (e) {}
  function audio() {
    if (!AC) return null;
    if (!ctx) { ctx = new AC(); master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination); }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, audio, { passive: true }));
  function tone(f, d = 0.12, o = {}) {
    if (muted) return; const c = audio(); if (!c) return;
    const { type = 'sine', vol = 0.2, to = null, at = 0 } = o, t = c.currentTime + at;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type; osc.frequency.setValueAtTime(f, t);
    if (to) osc.frequency.exponentialRampToValueAtTime(to, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    osc.connect(g); g.connect(master); osc.start(t); osc.stop(t + d + 0.03);
  }
  function whoosh(d = 0.4, vol = 0.14) {
    if (muted) return; const c = audio(); if (!c) return;
    const buf = c.createBuffer(1, c.sampleRate * d, c.sampleRate), data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain(), t = c.currentTime;
    src.buffer = buf; f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(3200, t + d);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + d * 0.4); g.gain.exponentialRampToValueAtTime(0.0001, t + d);
    src.connect(f); f.connect(g); g.connect(master); src.start(t);
  }
  const buzz = p => { if (!muted && navigator.vibrate) navigator.vibrate(p); };
  const S = {
    place() { tone(520, 0.1, { type: 'triangle', to: 780, vol: 0.22 }); tone(1040, 0.05, { vol: 0.05, at: 0.02 }); buzz(12); },
    ai()    { tone(440, 0.14, { type: 'sine', to: 300, vol: 0.2 }); },
    think() { tone(196, 0.09, { type: 'sine', vol: 0.07 }); tone(233, 0.09, { type: 'sine', vol: 0.07, at: 0.11 }); },
    hover() { tone(1300, 0.025, { vol: 0.025 }); },
    tick()  { tone(900, 0.04, { type: 'triangle', vol: 0.08 }); },
    mode()  { tone(660, 0.06, { type: 'triangle', vol: 0.12 }); tone(990, 0.08, { type: 'triangle', vol: 0.1, at: 0.06 }); },
    reset() { whoosh(0.38, 0.13); },
    win()   { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.28, { type: 'triangle', vol: 0.2, at: 0.2 + i * 0.1 })); tone(2093, 0.5, { vol: 0.05, at: 0.75 }); buzz([20, 40, 20, 40, 60]); },
    lose()  { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.32, { type: 'sawtooth', vol: 0.09, at: 0.2 + i * 0.18 })); buzz([60, 40, 90]); },
    draw()  { tone(392, 0.25, { type: 'sine', vol: 0.15, at: 0.2 }); tone(392, 0.35, { type: 'sine', vol: 0.12, at: 0.45 }); buzz(30); }
  };

  // ---------- Sound toggle (additive, fixed corner, keyboard accessible) ----------
  const toggle = document.createElement('button');
  toggle.className = 'sound-toggle'; toggle.type = 'button';
  const paint = () => { toggle.setAttribute('aria-pressed', String(!muted)); toggle.setAttribute('aria-label', muted ? 'Sound off. Turn sound on' : 'Sound on. Turn sound off'); toggle.innerHTML = `<i>♪</i>${muted ? 'SOUND OFF' : 'SOUND ON'}`; toggle.classList.toggle('off', muted); };
  toggle.addEventListener('click', () => { muted = !muted; try { localStorage.setItem('ttt-muted', muted ? '1' : '0'); } catch (e) {} paint(); if (!muted) S.mode(); });
  paint(); document.body.appendChild(toggle);

  // ---------- Particle layer ----------
  const layer = document.createElement('div'); layer.className = 'fx-layer'; layer.setAttribute('aria-hidden', 'true'); document.body.appendChild(layer);
  const COLORS = { X: ['#c93d25', '#f3a393', '#e5ba87'], O: ['#4a63b8', '#9fb0e6', '#cfe0c8'] };
  function sparkle(x, y, cols, n, dist) {
    const ring = document.createElement('i'); ring.className = 'fx-ring'; ring.style.left = x + 'px'; ring.style.top = y + 'px'; ring.style.borderColor = cols[0]; layer.appendChild(ring);
    ring.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: .7 }, { transform: 'translate(-50%,-50%) scale(2.2)', opacity: 0 }], { duration: 520, easing: 'ease-out' }).onfinish = () => ring.remove();
    for (let i = 0; i < n; i++) {
      const p = document.createElement('i'); p.className = 'fx-p'; p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.background = cols[i % cols.length]; layer.appendChild(p);
      const a = (Math.PI * 2 * i) / n + Math.random() * 0.5, d = dist * (0.6 + Math.random() * 0.6);
      p.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px),calc(-50% + ${Math.sin(a) * d}px)) scale(0)`, opacity: 0 }], { duration: 480 + Math.random() * 260, easing: 'cubic-bezier(.2,.7,.3,1)' }).onfinish = () => p.remove();
    }
  }
  function confetti() {
    const r = boardEl.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2, cols = ['#c93d25', '#4a63b8', '#e5ba87', '#84ae83', '#f3a393'];
    for (let i = 0; i < 44; i++) {
      const p = document.createElement('i'); p.className = 'fx-c'; p.style.left = cx + 'px'; p.style.top = cy + 'px'; p.style.background = cols[i % cols.length]; layer.appendChild(p);
      const vx = (Math.random() - 0.5) * 520, up = 120 + Math.random() * 180, fall = 260 + Math.random() * 220, rot = (Math.random() - 0.5) * 900;
      p.animate([{ transform: 'translate(0,0) rotate(0)', opacity: 1 }, { transform: `translate(${vx * 0.55}px,${-up}px) rotate(${rot * 0.5}deg)`, opacity: 1, offset: 0.4 }, { transform: `translate(${vx}px,${fall}px) rotate(${rot}deg)`, opacity: 0 }], { duration: 1400 + Math.random() * 900, easing: 'cubic-bezier(.25,.6,.4,1)' }).onfinish = () => p.remove();
    }
  }

  // ---------- Board events ----------
  let prev = Array(9).fill(null);
  const readBoard = () => [...boardEl.querySelectorAll('.cell')].map(b => { const m = /, ([XO])$/.exec(b.getAttribute('aria-label') || ''); return m ? m[1] : null; });
  new MutationObserver(() => {
    const cur = readBoard(), cells = boardEl.querySelectorAll('.cell'), placed = [];
    cur.forEach((m, i) => { if (m && !prev[i]) placed.push(i); });
    if (placed.length) {
      placed.forEach(i => {
        const mk = cells[i].querySelector('.mark'); if (mk) mk.classList.add('fresh');
        if (!reduce.matches) { const r = cells[i].getBoundingClientRect(); sparkle(r.left + r.width / 2, r.top + r.height / 2, COLORS[cur[i]], 12, 56); }
      });
      cur[placed[0]] === 'X' ? S.place() : S.ai();
    } else if (prev.some(Boolean) && !cur.some(Boolean)) S.reset();
    if (!reduce.matches) boardEl.querySelectorAll('.cell.winning').forEach((c, i) => c.animate([{ translate: '0 0 -18px' }, { translate: '0 0 0' }], { duration: 420, delay: 250 + i * 140, easing: 'cubic-bezier(.2,.85,.26,1.4)', fill: 'backwards' }));
    prev = cur;
  }).observe(boardEl, { childList: true });
  let lastHover = null;
  boardEl.addEventListener('pointerover', e => { const c = e.target.closest('.cell:not(:disabled)'); if (c && c !== lastHover) { lastHover = c; S.hover(); } else if (!c) lastHover = null; });

  // ---------- Status / result / score ----------
  let lastState = 'you';
  function onStatus() {
    const t = turnTag.textContent, state = t === 'DONE' ? 'done' : t === 'AI TURN' ? 'ai' : 'you';
    statusEl.dataset.state = state;
    if (state === lastState) return; lastState = state;
    if (state === 'ai') S.think();
    if (state === 'done') {
      const txt = statusText.textContent;
      if (/Beautifully/.test(txt)) { S.win(); if (!reduce.matches) setTimeout(confetti, 200); }
      else if (/machine|opponent/i.test(txt)) { S.lose(); if (!reduce.matches) boardEl.animate([{ translate: '0 0' }, { translate: '-9px 0' }, { translate: '8px 0' }, { translate: '-6px 0' }, { translate: '4px 0' }, { translate: '0 0' }], { duration: 480, delay: 200 }); }
      else { S.draw(); if (!reduce.matches) boardEl.animate([{ rotate: '0deg' }, { rotate: '-1.2deg' }, { rotate: '1.2deg' }, { rotate: '0deg' }], { duration: 520, delay: 200 }); }
    }
  }
  new MutationObserver(onStatus).observe(turnTag, { childList: true, characterData: true, subtree: true });
  let lastTitle = statusText.textContent;
  new MutationObserver(() => {
    const t = statusText.textContent; if (t === lastTitle) return; lastTitle = t;
    if (!reduce.matches) statusText.animate([{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'ease-out' });
  }).observe(statusText, { childList: true, characterData: true, subtree: true });
  ['#playerScore', '#aiScore', '#drawScore'].forEach(sel => {
    const el = $(sel); let v = el.textContent;
    new MutationObserver(() => {
      if (el.textContent === v) return; v = el.textContent;
      if (!reduce.matches) el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.5)', color: '#a4482f' }, { transform: 'scale(1)' }], { duration: 480, easing: 'cubic-bezier(.2,.85,.26,1.4)' });
    }).observe(el, { childList: true, characterData: true, subtree: true });
  });
  $('#reset').addEventListener('click', S.tick);
  document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', S.mode));
})();
