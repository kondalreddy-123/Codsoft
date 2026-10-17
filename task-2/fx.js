(() => {
  'use strict';
  const root = document.documentElement, shell = document.querySelector('.shell');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)'), small = matchMedia('(max-width: 700px)');
  let mx = 0, my = 0;

  // ---- Scroll reveal (fade + translate + scale), staggered; classes are removed afterwards so hover/tilt keep working
  if (!reduce.matches && 'IntersectionObserver' in window) {
    const targets = [...document.querySelectorAll('.nav, .intro > *, .status, .board-wrap, .reset, .sidebar > *, .shell footer')];
    const io = new IntersectionObserver(entries => entries.forEach(en => {
      if (!en.isIntersecting) return;
      en.target.classList.add('in'); io.unobserve(en.target);
    }), { threshold: 0.08 });
    targets.forEach(el => {
      el.classList.add('reveal');
      el.style.setProperty('--rd', `${(Array.prototype.indexOf.call(el.parentNode.children, el) % 6) * 0.08}s`);
      el.addEventListener('transitionend', e => {
        if (e.target === el && e.propertyName === 'opacity') { el.classList.remove('reveal', 'in'); el.style.removeProperty('--rd'); }
      });
      io.observe(el);
    });
    setTimeout(() => targets.forEach(el => el.classList.add('in')), 3000); // failsafe: never leave content hidden
  }

  // ---- Light scroll parallax (translate only; disabled on mobile / reduced motion)
  if (!reduce.matches && !small.matches) {
    let tick = false;
    addEventListener('scroll', () => {
      if (tick) return; tick = true;
      requestAnimationFrame(() => { root.style.setProperty('--sy', scrollY); tick = false; });
    }, { passive: true });
  }

  // ---- Three.js background: lazy-loaded, desktop only, no-WebGL falls back to the CSS gradient mesh
  if (reduce.matches || small.matches) return;
  const hasGL = (() => { try { const c = document.createElement('canvas'); return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl'))); } catch (e) { return false; } })();
  if (!hasGL) { root.classList.add('no-webgl'); return; }
  addEventListener('pointermove', e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; }, { passive: true });

  const load = () => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    s.onload = start; s.onerror = () => root.classList.add('no-webgl');
    document.head.appendChild(s);
  };
  'requestIdleCallback' in window ? requestIdleCallback(load, { timeout: 1500 }) : setTimeout(load, 400);

  function start() {
    const canvas = document.createElement('canvas');
    canvas.className = 'fx-canvas'; canvas.setAttribute('aria-hidden', 'true');
    shell.prepend(canvas);
    let renderer;
    try { renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power' }); }
    catch (e) { canvas.remove(); root.classList.add('no-webgl'); return; }
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 14;
    scene.add(new THREE.AmbientLight(0xffffff, 0.95));
    const light = new THREE.DirectionalLight(0xffffff, 0.7); light.position.set(4, 6, 8); scene.add(light);

    const geos = [new THREE.IcosahedronGeometry(0.9, 0), new THREE.OctahedronGeometry(0.95), new THREE.TorusGeometry(0.7, 0.26, 12, 32), new THREE.BoxGeometry(1.1, 1.1, 1.1)];
    const cols = [0xf3a393, 0x9fb0e6, 0xe9d3a8, 0xcfe0c8];
    const shapes = [];
    for (let i = 0; i < 14; i++) {            // capped: 14 meshes + 90 particles
      const m = new THREE.Mesh(geos[i % 4], new THREE.MeshStandardMaterial({ color: cols[i % 4], roughness: 0.6, metalness: 0.05, transparent: true, opacity: 0.5 }));
      m.position.set((i % 2 ? 1 : -1) * (5 + Math.random() * 7), (Math.random() - 0.5) * 14, -5 + Math.random() * 4);
      m.userData = { s: 0.2 + Math.random() * 0.3, p: Math.random() * 6, y: m.position.y };
      m.scale.setScalar(0.7 + Math.random() * 0.9);
      scene.add(m); shapes.push(m);
    }
    const pg = new THREE.BufferGeometry(), pos = new Float32Array(90 * 3);
    for (let i = 0; i < 90; i++) { pos[i * 3] = (Math.random() - 0.5) * 30; pos[i * 3 + 1] = (Math.random() - 0.5) * 18; pos[i * 3 + 2] = -8 + Math.random() * 8; }
    pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const dots = new THREE.Points(pg, new THREE.PointsMaterial({ size: 0.07, color: 0x9a8a68, transparent: true, opacity: 0.45 }));
    scene.add(dots);

    const resize = () => { renderer.setSize(innerWidth, innerHeight, false); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
    resize(); addEventListener('resize', resize);
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); running = false; canvas.remove(); root.classList.add('no-webgl'); });

    let running = true, t0 = performance.now();
    const frame = now => {
      if (!running) return;
      requestAnimationFrame(frame);
      if (document.hidden || small.matches) return;
      const t = (now - t0) / 1000;
      shapes.forEach(m => { m.rotation.x = t * m.userData.s; m.rotation.y = t * m.userData.s * 1.3; m.position.y = m.userData.y + Math.sin(t * 0.6 + m.userData.p) * 0.5; });
      dots.rotation.y = t * 0.02;
      camera.position.x += (mx * 1.8 - camera.position.x) * 0.05;
      camera.position.y += (-my * 1.2 - scrollY * 0.004 - camera.position.y) * 0.05;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
      canvas.classList.add('ready');
    };
    requestAnimationFrame(frame);
  }
})();
