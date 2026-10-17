(() => {
  'use strict';
  // Peer-to-peer multiplayer over WebRTC. No server: players swap two short codes (offer / reply).
  const $ = s => document.querySelector(s);
  const peer = { name: 'Opponent', rating: 1000 };
  let pc = null, dc = null, isHost = false, open = false;
  window.TTTOnline = { peer, get connected() { return open; } };
  const clean = s => String(s || '').replace(/[^\p{L}\p{N} _.-]/gu, '').trim().slice(0, 16) || 'Opponent';

  const panel = document.createElement('section');
  panel.className = 'online-panel'; panel.hidden = true; panel.setAttribute('aria-label', 'Online match');
  panel.innerHTML = `<div class="op-head"><b>ONLINE MATCH</b><span id="opState" role="status">NOT CONNECTED</span></div>
  <div id="opSetup"><p class="op-help">Play a friend anywhere. No account or server: you swap two short codes.</p>
    <div class="op-tabs"><button type="button" id="opHost">I’LL HOST</button><button type="button" id="opJoin">I’LL JOIN</button></div>
    <div class="op-step" id="stepHost" hidden>
      <label>1 · Send this code to your friend<textarea id="hostOut" readonly rows="3" placeholder="Creating code…"></textarea></label><button type="button" data-copy="hostOut">COPY CODE</button>
      <label>2 · Paste their reply code<textarea id="hostIn" rows="3"></textarea></label><button type="button" id="hostGo">CONNECT</button></div>
    <div class="op-step" id="stepJoin" hidden>
      <label>1 · Paste the host’s code<textarea id="joinIn" rows="3"></textarea></label><button type="button" id="joinGo">CREATE REPLY</button>
      <label>2 · Send this reply back to the host<textarea id="joinOut" readonly rows="3"></textarea></label><button type="button" data-copy="joinOut">COPY REPLY</button></div>
  </div>
  <div id="opLive" hidden><span id="opWho"></span><button type="button" id="opLeave">DISCONNECT</button></div>`;
  $('.play-side').prepend(panel);

  const setState = t => { $('#opState').textContent = t; };
  const show = id => { $('#stepHost').hidden = id !== 'stepHost'; $('#stepJoin').hidden = id !== 'stepJoin'; };
  function ui(live) { $('#opSetup').hidden = live; $('#opLive').hidden = !live; }
  function resetUI() { ui(false); show(null); ['hostOut', 'hostIn', 'joinIn', 'joinOut'].forEach(i => { $('#' + i).value = ''; }); setState('NOT CONNECTED'); }
  function teardown() {
    const was = open; open = false;
    try { dc && dc.close(); } catch (e) {} try { pc && pc.close(); } catch (e) {}
    dc = pc = null;
    if (was && window.TTTGame && TTTGame.mode === 'online') TTTGame.online(false, 'X');
  }
  function lost() { if (open) { teardown(); resetUI(); setState('DISCONNECTED'); } }
  function mk() {
    teardown();
    pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }, { urls: 'stun:stun1.l.google.com:19302' }] });
    pc.onconnectionstatechange = () => { const s = pc && pc.connectionState; if (s === 'failed') { if (open) lost(); else setState('FAILED — TRY AGAIN'); } else if (s === 'disconnected' || s === 'closed') lost(); };
  }
  const gather = () => new Promise(res => {
    if (pc.iceGatheringState === 'complete') return res();
    const f = () => { if (pc.iceGatheringState === 'complete') { pc.removeEventListener('icegatheringstatechange', f); res(); } };
    pc.addEventListener('icegatheringstatechange', f); setTimeout(res, 5000);
  });
  const pack = d => btoa(JSON.stringify({ type: d.type, sdp: d.sdp }));
  const unpack = s => { const o = JSON.parse(atob(s.trim())); if (!o || !['offer', 'answer'].includes(o.type) || typeof o.sdp !== 'string') throw new Error('bad'); return { type: o.type, sdp: o.sdp }; };

  function wire(ch) {
    dc = ch;
    const hello = () => { open = true; ch.send(JSON.stringify({ t: 'hello', name: window.TTTStats ? TTTStats.name() : 'Player', rating: window.TTTStats ? TTTStats.rating() : 1000 })); };
    if (ch.readyState === 'open') hello(); else ch.onopen = hello; // a received channel may already be open
    ch.onclose = lost;
    ch.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (x) { return; }
      if (!m || typeof m !== 'object') return;
      if (m.t === 'hello') {
        peer.name = clean(m.name); peer.rating = Math.min(3000, Math.max(100, Math.round(+m.rating) || 1000));
        TTTGame.online(true, isHost ? 'X' : 'O');
        ui(true); setState('CONNECTED'); $('#opWho').textContent = `Playing ${peer.name} · rating ${peer.rating}`;
      } else if (m.t === 'move' && Number.isInteger(m.i) && m.i >= 0 && m.i < 9) TTTGame.remote(m.i);
      else if (m.t === 'reset') { TTTGame.reset(); TTTGame.flip(); }
    };
  }

  $('#opHost').onclick = async () => {
    isHost = true; show('stepHost'); $('#hostOut').value = ''; $('#hostIn').value = ''; setState('CREATING CODE…');
    try { mk(); wire(pc.createDataChannel('ttt')); await pc.setLocalDescription(await pc.createOffer()); await gather(); $('#hostOut').value = pack(pc.localDescription); setState('WAITING FOR REPLY'); }
    catch (e) { setState('ERROR — TRY AGAIN'); }
  };
  $('#hostGo').onclick = async () => {
    try { await pc.setRemoteDescription(unpack($('#hostIn').value)); setState('CONNECTING…'); } catch (e) { setState('INVALID CODE'); }
  };
  $('#opJoin').onclick = () => { isHost = false; show('stepJoin'); setState('PASTE HOST CODE'); };
  $('#joinGo').onclick = async () => {
    try {
      const offer = unpack($('#joinIn').value); mk(); pc.ondatachannel = e => wire(e.channel);
      await pc.setRemoteDescription(offer); await pc.setLocalDescription(await pc.createAnswer()); setState('CREATING REPLY…'); await gather();
      $('#joinOut').value = pack(pc.localDescription); setState('SEND REPLY TO HOST');
    } catch (e) { setState('INVALID CODE'); }
  };
  panel.addEventListener('click', e => {
    const c = e.target.closest('[data-copy]'); if (!c) return;
    const t = $('#' + c.dataset.copy); t.select();
    (navigator.clipboard ? navigator.clipboard.writeText(t.value) : Promise.reject()).catch(() => document.execCommand('copy'));
    c.textContent = 'COPIED ✓'; setTimeout(() => { c.textContent = c.dataset.copy === 'hostOut' ? 'COPY CODE' : 'COPY REPLY'; }, 1500);
  });
  $('#opLeave').onclick = () => { teardown(); resetUI(); };

  addEventListener('ttt:move', e => { if (open && dc && dc.readyState === 'open') dc.send(JSON.stringify({ t: 'move', i: e.detail.i })); });
  $('#reset').addEventListener('click', () => { if (TTTGame.mode === 'online' && open) { TTTGame.flip(); dc.send('{"t":"reset"}'); } });
  document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => {
    const on = b.dataset.mode === 'online'; panel.hidden = !on;
    if (!on) { teardown(); resetUI(); } else if (open) { TTTGame.flip(); dc.send('{"t":"reset"}'); }
  }));
})();
