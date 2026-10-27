(() => {
  'use strict';
  const secure = location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  if ('serviceWorker' in navigator && secure) addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  let deferred = null;
  const btn = document.createElement('button');
  btn.className = 'install-btn'; btn.type = 'button'; btn.hidden = true; btn.textContent = '⇩ INSTALL APP';
  document.body.appendChild(btn);
  addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; btn.hidden = false; });
  btn.addEventListener('click', async () => { if (!deferred) return; deferred.prompt(); await deferred.userChoice; deferred = null; btn.hidden = true; });
  addEventListener('appinstalled', () => { btn.hidden = true; });
})();
