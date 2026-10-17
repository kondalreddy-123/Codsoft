(() => {
  'use strict';
  const boardEl = document.querySelector('#board');
  const statusText = document.querySelector('#statusText');
  const statusDetail = document.querySelector('#statusDetail');
  const turnTag = document.querySelector('#turnTag');
  const statusIcon = document.querySelector('#statusIcon');
  const lineSet = [[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
  let board = Array(9).fill(null), turn = 'X', mode = 'impossible', busy = false;
  const score = { player: 0, ai: 0, draw: 0 }, pvpScore = { player: 0, ai: 0, draw: 0 };
  let gen = 0;
  const onlineScore = { player: 0, ai: 0, draw: 0 };
  let myMark = 'X', netReady = false;
  const depthEl = document.querySelector('#depthRange'), blunderEl = document.querySelector('#blunderRange');
  const scoreFor = () => mode === 'pvp' ? pvpScore : mode === 'online' ? onlineScore : score;
  const bucket = r => r.mark === 'draw' ? 'draw' : (mode === 'online' ? r.mark === myMark : r.mark === 'X') ? 'player' : 'ai';
  const notMine = () => mode === 'online' ? (!netReady || turn !== myMark) : (mode !== 'pvp' && turn !== 'X');
  const nameEls = document.querySelectorAll('.score-name'), footEls = document.querySelectorAll('.board-foot > span');
  const orig = { n: [nameEls[0].innerHTML, nameEls[1].innerHTML], f: [footEls[0].lastChild.textContent, footEls[2].lastChild.textContent] };
  let labelsKey = null;
  const setName = (el, t, sub) => { el.textContent = t; const sm = document.createElement('small'); sm.textContent = sub; el.appendChild(sm); };
  function syncLabels() {
    const key = mode === 'pvp' ? 'pvp' : mode === 'online' ? 'online:' + (window.TTTOnline ? TTTOnline.peer.name : '') + netReady : '';
    if (key === labelsKey) return; labelsKey = key;
    if (!key) { nameEls[0].innerHTML = orig.n[0]; nameEls[1].innerHTML = orig.n[1]; footEls[0].lastChild.textContent = orig.f[0]; footEls[2].lastChild.textContent = orig.f[1]; }
    else if (mode === 'pvp') { setName(nameEls[0], 'PLAYER ONE', 'PLAYS ×'); setName(nameEls[1], 'PLAYER TWO', 'PLAYS ○'); footEls[0].lastChild.textContent = ' PLAYER ONE'; footEls[2].lastChild.textContent = ' PLAYER TWO'; }
    else { setName(nameEls[0], 'YOU', 'ONLINE PLAYER'); setName(nameEls[1], netReady ? TTTOnline.peer.name : 'OPPONENT', 'ONLINE RIVAL'); footEls[0].lastChild.textContent = ' FIRST MOVE'; footEls[2].lastChild.textContent = ' SECOND MOVE'; }
  }
  function winner(cells) {
    for (const line of lineSet) {
      const [a,b,c] = line;
      if (cells[a] && cells[a] === cells[b] && cells[a] === cells[c]) return { mark: cells[a], line };
    }
    return cells.every(Boolean) ? { mark: 'draw', line: null } : null;
  }
  // ---- AI engine: alpha-beta pruning + per-level strategies ----
  const ORDER = [4, 0, 2, 6, 8, 1, 3, 5, 7]; // centre, corners, edges: best-first ordering prunes more
  let nodes = 0;
  function lineScore(cells) {
    let s = 0;
    for (const [a, b, c] of lineSet) {
      const l = [cells[a], cells[b], cells[c]], o = l.filter(v => v === 'O').length, x = l.filter(v => v === 'X').length;
      if (o && !x) s += [0, 1, 5, 0][o]; else if (x && !o) s -= [0, 1, 5, 0][x];
    }
    return s;
  }
  function alphaBeta(cells, maximizing, depth, alpha, beta, limit) {
    nodes++;
    const r = winner(cells);
    if (r) return r.mark === 'O' ? 10 - depth : r.mark === 'X' ? depth - 10 : 0;
    if (depth >= limit) return lineScore(cells);
    let best = maximizing ? -Infinity : Infinity;
    for (const i of ORDER) if (!cells[i]) {
      cells[i] = maximizing ? 'O' : 'X';
      const v = alphaBeta(cells, !maximizing, depth + 1, alpha, beta, limit);
      cells[i] = null;
      if (maximizing) { best = Math.max(best, v); alpha = Math.max(alpha, best); } else { best = Math.min(best, v); beta = Math.min(beta, best); }
      if (beta <= alpha) break; // prune
    }
    return best;
  }
  function plainCount(cells, maximizing) { // positions plain minimax would visit (for the efficiency readout)
    if (winner(cells)) return 1;
    let n = 1;
    for (let i = 0; i < 9; i++) if (!cells[i]) { cells[i] = maximizing ? 'O' : 'X'; n += plainCount(cells, !maximizing); cells[i] = null; }
    return n;
  }
  function searchMove(cells, limit) {
    let move = -1, high = -Infinity;
    for (const i of ORDER) if (!cells[i]) {
      cells[i] = 'O'; const v = alphaBeta(cells, false, 1, high, Infinity, limit); cells[i] = null;
      if (v > high) { high = v; move = i; }
    }
    return move;
  }
  function ruleMove(cells) { // win if possible, block if necessary, then centre / corner / edge
    const open = ORDER.filter(i => !cells[i]);
    const finds = m => open.find(i => { cells[i] = m; const w = winner(cells)?.mark === m; cells[i] = null; return w; });
    const w = finds('O'); if (w !== undefined) return w;
    const k = finds('X'); if (k !== undefined) return k;
    return open[0];
  }
  function aiMove(cells) {
    const open = cells.map((v, i) => v ? -1 : i).filter(i => i !== -1);
    const rand = () => open[Math.floor(Math.random() * open.length)];
    const stat = document.querySelector('#searchStat');
    let move; nodes = 0;
    if (mode === 'easy') move = Math.random() < 0.7 ? rand() : searchMove(cells, 9);   // mostly random
    else if (mode === 'medium') move = Math.random() < 0.2 ? rand() : ruleMove(cells);  // rule-based
    else if (mode === 'hard') move = Math.random() < 0.1 ? rand() : searchMove(cells, 3); // 3-ply alpha-beta + heuristic
    else if (mode === 'custom') move = Math.random() < blunderEl.value / 100 ? rand() : searchMove(cells, +depthEl.value); // player-tuned depth + slip rate
    else move = searchMove(cells, 9);                                                   // full alpha-beta: perfect play
    if (mode === 'impossible' && nodes) { const base = plainCount(cells, true); stat.textContent = `Alpha-beta searched ${nodes.toLocaleString()} of ${base.toLocaleString()} positions (${Math.round(100 - 100 * nodes / base)}% pruned).`; }
    else if ((mode === 'hard' || mode === 'custom') && nodes) stat.textContent = `Alpha-beta searched ${nodes.toLocaleString()} positions at depth ${mode === 'hard' ? 3 : depthEl.value}.`;
    else stat.textContent = '';
    return move;
  }
  function markHTML(mark) {
    const g = mark === 'X' ? '×' : '○';
    const layers = Array.from({ length: 8 }, (_, k) => `<span class="layer" style="--z:${k * 2}px;--b:${(0.5 + k * 0.0715).toFixed(2)}">${g}</span>`).join('');
    return `<span class="mark mark-${mark.toLowerCase()}" aria-hidden="true">${layers}</span>`;
  }
  function render() {
    const result = winner(board), sc = scoreFor();
    syncLabels();
    boardEl.innerHTML = board.map((mark,i) => `<button class="cell ${mark ? `cell-${mark.toLowerCase()}` : ''} ${result?.line?.includes(i) ? 'winning' : ''}" role="gridcell" aria-label="Square ${i+1}${mark ? `, ${mark}` : ', empty'}" ${mark || result || notMine() || busy ? 'disabled' : ''}>${mark ? `${markHTML(mark)}` : `<span class="cell-id">0${i+1}</span>`}</button>`).join('');
    boardEl.querySelectorAll('.cell').forEach((button,i) => button.addEventListener('click', () => play(i)));
    document.querySelector('#playerScore').textContent = String(sc.player).padStart(2,'0');
    document.querySelector('#aiScore').textContent = String(sc.ai).padStart(2,'0');
    document.querySelector('#drawScore').textContent = String(sc.draw).padStart(2,'0');
    document.querySelector('#record').textContent = `${sc.player}W · ${sc.ai}L · ${sc.draw}D`;
    const pv = mode === 'pvp', onl = mode === 'online';
    if (onl && result && result.mark !== 'draw') setStatus(result.mark === myMark ? 'Beautifully played.' : 'Your opponent takes this one.', result.mark === myMark ? 'You found the winning line.' : 'Better luck next round.', 'DONE', result.mark === 'X' ? '×' : '○');
    else if (result?.mark === 'X') setStatus('Beautifully played.', pv ? 'Player one found the winning line.' : 'You found the winning line.', 'DONE', '×');
    else if (result?.mark === 'O') pv ? setStatus('Beautifully played.', 'Player two found the winning line.', 'DONE', '○') : setStatus('The machine takes this one.', 'The algorithm saw it coming.', 'DONE', '◎');
    else if (result?.mark === 'draw') setStatus('A perfectly matched draw.', 'Nobody blinked.', 'DONE', '＝');
    else if (busy) setStatus('Calculating your next move…', 'The algorithm is exploring every possibility', 'AI TURN', '◎');
    else if (onl) (netReady
      ? (turn === myMark ? setStatus('Your move.', `You play the ${myMark === 'X' ? 'coral ×' : 'blue ○'} · tap any open square`, 'YOUR TURN', '●') : setStatus('Waiting for your opponent…', 'They are choosing a square', 'THEIR TURN', '◎'))
      : setStatus('Waiting for an opponent…', 'Use the Online panel to host or join a match', 'OFFLINE', '◌'));
    else if (pv) setStatus(turn === 'X' ? 'Player one, you’re up.' : 'Player two, you’re up.', turn === 'X' ? 'Place your coral × on any open square.' : 'Place your blue ○ on any open square.', `${turn} TURN`, turn === 'X' ? '×' : '○');
    else setStatus('Your move, player one.', 'You’re the warm coral X · the AI is cool blue O', 'YOUR TURN', '●');
  }
  function setStatus(title, detail, badge, icon) { statusText.textContent = title; statusDetail.textContent = detail; turnTag.textContent = badge; statusIcon.textContent = icon; statusIcon.classList.toggle('result', badge === 'DONE'); }
  function finish(result) { if (!result) return false; scoreFor()[bucket(result)]++; render(); return true; }
  function play(i) {
    if (board[i] || busy || winner(board)) return;
    if (mode === 'pvp') { board[i] = turn; if (finish(winner(board))) return; turn = turn === 'X' ? 'O' : 'X'; render(); return; }
    if (mode === 'online') { if (!netReady || turn !== myMark) return; board[i] = myMark; window.dispatchEvent(new CustomEvent('ttt:move', { detail: { i } })); if (finish(winner(board))) return; turn = turn === 'X' ? 'O' : 'X'; render(); return; }
    if (turn !== 'X') return;
    board[i] = 'X'; if (finish(winner(board))) return;
    turn = 'O'; busy = true; render();
    const g = gen; window.setTimeout(() => { if (g !== gen) return; board[aiMove([...board])] = 'O'; busy = false; turn = 'X'; finish(winner(board)) || render(); }, 580);
  }
  function reset() { gen++; board = Array(9).fill(null); turn = 'X'; busy = false; render(); }
  document.querySelector('#reset').addEventListener('click', reset);
  document.querySelectorAll('.mode').forEach(button => button.addEventListener('click', () => {
    mode = button.dataset.mode;
    document.querySelectorAll('.mode').forEach(item => { item.classList.toggle('active', item === button); item.querySelector('.check').textContent = item === button ? '✓' : ''; });
    document.querySelector('#noteText').textContent = ({
      easy: 'The easy opponent makes occasional imperfect moves.',
      medium: 'Plays by simple rules: win if it can, block if it must, then take the best open square.',
      hard: 'Looks three moves ahead with alpha-beta pruning, but sometimes misjudges.',
      impossible: 'The minimax algorithm explores every possible game. It cannot lose.',
      pvp: 'Two players share the board. Player one is ×, player two is ○. Take turns.',
      custom: 'You choose how many moves ahead the AI searches and how often it slips. Depth 9 sees the whole game.',
      online: 'Play a friend over the internet. Marks swap each round, and your rating updates after every game.'
    })[mode];
    document.querySelector('#searchStat').textContent = '';
    document.querySelector('#customBox').hidden = mode !== 'custom';
    reset();
  }));
  // 3D: board tilts toward the pointer
  const wrap = document.querySelector('.board-wrap');
  wrap.addEventListener('pointermove', e => {
    if (e.target.closest('.board')) return; // tilt only from the margins, so squares never move under the pointer
    const r = wrap.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    boardEl.style.setProperty('--ry', `${(x * 22).toFixed(1)}deg`);
    boardEl.style.setProperty('--rx', `${(12 - y * 18).toFixed(1)}deg`);
  });
  wrap.addEventListener('pointerleave', () => { boardEl.style.removeProperty('--ry'); boardEl.style.removeProperty('--rx'); });
  // 3D landing: parallax for floating pieces, headline and cube; tilt for cards
  const shell = document.querySelector('.shell');
  window.addEventListener('pointermove', e => {
    shell.style.setProperty('--mx', (e.clientX / innerWidth - 0.5).toFixed(3));
    shell.style.setProperty('--my', (e.clientY / innerHeight - 0.5).toFixed(3));
  });
  document.querySelectorAll('.card, .quote, .status').forEach(el => {
    el.addEventListener('pointermove', e => {
      const r = el.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      el.style.setProperty('--tx', `${(-y * 10).toFixed(1)}deg`);
      el.style.setProperty('--ty', `${(x * 12).toFixed(1)}deg`);
      el.style.setProperty('--gx', `${((x + 0.5) * 100).toFixed(0)}%`);
      el.style.setProperty('--gy', `${((y + 0.5) * 100).toFixed(0)}%`);
    });
    el.addEventListener('pointerleave', () => ['--tx', '--ty'].forEach(v => el.style.removeProperty(v)));
  });
  [['#depthRange', '#depthOut', v => v], ['#blunderRange', '#blunderOut', v => v + '%']].forEach(([a, b, f]) => { const r = document.querySelector(a), o = document.querySelector(b); r.addEventListener('input', () => { o.textContent = f(r.value); }); });
  window.TTTGame = {
    get mode() { return mode; },
    online(ready, mark) { netReady = ready; myMark = mark; labelsKey = null; reset(); },
    remote(i) { if (mode === 'online' && netReady && !board[i] && turn !== myMark && !winner(board)) { board[i] = turn; if (finish(winner(board))) return; turn = turn === 'X' ? 'O' : 'X'; render(); } },
    flip() { myMark = myMark === 'X' ? 'O' : 'X'; render(); },
    reset
  };
  render();
})();
