/* Пошаговая 3D-сборка шасси HSP 94123 (страница «Сборка», открывается из «Как всё устроено» и с «Домой»).
 *
 * Данные — renderer/assembly/data.js (window.HSP_ASM): 5 разделов А–Д, у каждого своя модель GLB
 * (renderer/assembly/hsp_X.glb), шаги с подписями RU+KK, детали с миниатюрами. Модели собраны в Blender
 * (скрипты в папке «Шасси/3D/instr»), здесь только показываем: детали шага прилетают на место по своим
 * стрелкам, модель можно крутить, деталь — выбрать и посмотреть отдельно.
 *
 * three.js подгружается только при первом открытии (vendor/three-hsp.min.js), чтобы не тормозить запуск.
 * Отметки «собрано» и место, где остановились, — в настройках (asm3d: { done, pos }).
 */
(function () {
  'use strict';
  const D = window.HSP_ASM;
  if (!D) return;

  const byId = (id) => document.getElementById(id);
  const L = () => (typeof currentLang !== 'undefined' ? currentLang : 'ru');
  const S = (o) => (o == null ? '' : typeof o === 'string' ? o : (o[L()] || o.ru || ''));
  const tt = (k, vars) => {
    let s; try { s = t(k); } catch (_) { s = k; }
    if (vars) Object.keys(vars).forEach((v) => { s = s.split('{' + v + '}').join(vars[v]); });
    return s;
  };
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  /* ── разделы: готовые узлы других разделов (ext) раскрываем в узлы шага, как в веб-версии ── */
  const SECS = D.sections;
  const SECBY = Object.fromEntries(SECS.map((s) => [s.id, s]));
  const OWN = Object.fromEntries(SECS.map((s) => [s.id, Object.keys(s.steps[s.steps.length - 1].nodes)]));
  for (const sec of SECS) for (const st of sec.steps) {
    if (!st.ext) continue;
    for (const [E, v] of Object.entries(st.ext)) {
      const hide = new Set((st.exthide || {})[E] || []);
      for (const id of OWN[E]) {
        if (hide.has(id)) continue;
        st.nodes[E + ':' + id] = v;
        if (v) st.seq[E + ':' + id] = st.extseq[E];
      }
    }
  }

  /* ── прогресс ── */
  let prog = { done: {}, pos: null };
  const countable = (sec) => sec.steps.filter((st) => st.num !== '✓');
  function secProgress(sec) {
    const c = countable(sec);
    return { n: c.filter((st) => prog.done[st.id]).length, m: c.length };
  }
  function totalProgress() {
    let n = 0, m = 0;
    SECS.forEach((sec) => { const p = secProgress(sec); n += p.n; m += p.m; });
    return { n, m };
  }
  /** Первый несобранный шаг: [индекс раздела, индекс шага] или null, если всё собрано. */
  function firstUndone() {
    for (let i = 0; i < SECS.length; i++) {
      const j = SECS[i].steps.findIndex((st) => st.num !== '✓' && !prog.done[st.id]);
      if (j >= 0) return [i, j];
    }
    return null;
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { window.sb.setSettings({ asm3d: { done: prog.done, pos: prog.pos } }); } catch (_) {}
    }, 250);
    document.dispatchEvent(new CustomEvent('sb-asm3d-progress'));
  }
  const ready = (async () => {
    try {
      const st = await window.sb.getSettings();
      if (st && st.asm3d) prog = { done: Object.assign({}, st.asm3d.done || {}), pos: st.asm3d.pos || null };
    } catch (_) {}
    document.dispatchEvent(new CustomEvent('sb-asm3d-progress'));
  })();

  /* ── разметка страницы (создаётся при первом открытии) ── */
  const ICON = {
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>',
    replay: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/></svg>',
    view: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    doc: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 13h6M9 17h6"/></svg>'
  };
  const MARKUP = `
  <div class="a3">
    <header class="a3-head">
      <div class="a3-brand">
        <b data-k="a3.title"></b>
        <div class="a3-total" id="a3-total"><span id="a3-total-t"></span><div class="a3-bar"><i id="a3-total-bar"></i></div></div>
      </div>
      <div class="a3-tabs" id="a3-tabs" role="tablist"></div>
      <div class="a3-pdfwrap">
        <button class="btn btn-ghost btn-sm" id="a3-pdf">${ICON.doc}<span data-k="a3.pdf"></span></button>
        <div class="a3-menu hidden" id="a3-pdf-menu" role="menu"></div>
      </div>
    </header>
    <div class="a3-main">
      <div class="a3-left">
        <section class="a3-stage" id="a3-stage">
          <div class="a3-overlay" id="a3-loading"></div>
          <div class="a3-chipbar">
            <div class="a3-how a3-glass" id="a3-how" data-k="a3.how"></div>
            <div class="a3-pick" id="a3-pick" hidden><div><span id="a3-pickname"></span><small id="a3-pickno"></small></div>
              <button class="a3-ib" id="a3-pickclose">✕</button></div>
            <button class="a3-ib a3-glass a3-viewbtn" id="a3-resetview">${ICON.view}</button>
          </div>
          <div class="a3-controls a3-glass">
            <button class="a3-btn" id="a3-prev">${ICON.prev}</button>
            <div class="a3-scrub"><input type="range" id="a3-scrub" min="0" max="1000" value="0">
              <span><span data-k="a3.apart"></span><span data-k="a3.together"></span></span></div>
            <button class="a3-btn" id="a3-replay">${ICON.replay}</button>
            <button class="a3-btn" id="a3-next">${ICON.next}</button>
          </div>
        </section>
        <nav class="a3-rail" id="a3-rail"></nav>
      </div>
      <section class="a3-card" id="a3-card" aria-live="polite">
        <div class="a3-card-scroll">
        <div class="a3-label a3-label-blue" id="a3-seclabel"></div>
        <div class="a3-stephead">
          <div class="a3-num" id="a3-num"></div>
          <div class="a3-of" id="a3-of"></div>
          <div class="a3-x2" id="a3-x2" hidden>2×</div>
        </div>
        <p class="a3-caption" id="a3-caption"></p>
        <div class="a3-tool" id="a3-tool" hidden></div>
        <div class="a3-label" id="a3-traylabel" data-k="a3.parts"></div>
        <div class="a3-tray" id="a3-tray"></div>
        <div class="a3-hint" data-k="a3.hint"></div>
        </div>
        <div class="a3-foot">
          <button class="a3-done" id="a3-done" type="button" aria-pressed="false"><span></span><i class="a3-switch" aria-hidden="true"></i></button>
          <button class="btn btn-primary a3-go" id="a3-next2" type="button"><span class="t"></span>${ICON.next}</button>
        </div>
      </section>
    </div>
    <div class="a3-modal" id="a3-modal" hidden>
      <div class="a3-sheet" role="dialog" aria-modal="true" aria-labelledby="a3-mname">
        <div class="a3-mview" id="a3-mview"><img id="a3-mimg" alt="" hidden></div>
        <div class="a3-minfo">
          <div class="a3-mcnt" id="a3-mcnt"></div>
          <div><h2 id="a3-mname"></h2><p id="a3-mnote"></p></div>
          <button class="a3-ib a3-mclose" id="a3-mclose">✕</button>
        </div>
      </div>
    </div>
  </div>`;

  let built = false, visible = false, backTo = 'manual';
  let si = 0, SEC = SECS[0], STEPS = SEC.steps, cur = 0;

  function build() {
    const page = byId('tab-assembly');
    page.innerHTML = MARKUP;
    built = true;
    // разделы
    SECS.forEach((s, i) => {
      const b = el('button', 'a3-tab');
      b.setAttribute('role', 'tab');
      b.dataset.i = String(i);
      b.appendChild(el('b', '', s.letter));
      b.appendChild(el('span', 'a3-tl'));
      b.appendChild(el('i', 'a3-tabmark'));
      b.addEventListener('click', () => { if (i !== si || !curRoot) goSection(i, 0); });
      byId('a3-tabs').appendChild(b);
    });
    // PDF
    const menu = byId('a3-pdf-menu');
    byId('a3-pdf').addEventListener('click', (e) => { e.stopPropagation(); fillPdfMenu(); menu.classList.toggle('hidden'); });
    document.addEventListener('click', () => menu.classList.add('hidden'));
    // управление
    byId('a3-prev').addEventListener('click', goPrev);
    byId('a3-next').addEventListener('click', () => goNext(true));
    byId('a3-next2').addEventListener('click', () => goNext(true));
    byId('a3-replay').addEventListener('click', replay);
    byId('a3-resetview').addEventListener('click', () => { if (three) fitCamera(STEPS[cur]); });
    byId('a3-scrub').addEventListener('input', (e) => { playing = false; P = e.target.value / 1000 * nPh; applyProgress(); });
    byId('a3-done').addEventListener('click', () => {
      const st = STEPS[cur];
      if (st.num === '✓') return;
      if (prog.done[st.id]) delete prog.done[st.id]; else prog.done[st.id] = true;
      save(); renderCard(); renderRail(); renderTabs();
    });
    byId('a3-pickclose').addEventListener('click', () => { clearPick(); applyProgress(); });
    byId('a3-mclose').addEventListener('click', closePart);
    byId('a3-modal').addEventListener('click', (e) => { if (e.target === byId('a3-modal')) closePart(); });
    document.addEventListener('keydown', onKey);
    applyTexts();
  }

  function fillPdfMenu() {
    const menu = byId('a3-pdf-menu');
    menu.textContent = '';
    SECS.forEach((s) => {
      const b = el('button', 'a3-menu-item');
      b.appendChild(el('b', '', s.letter));
      b.appendChild(el('span', '', S(s.label)));
      b.addEventListener('click', async () => {
        menu.classList.add('hidden');
        let r = null;
        try { r = await window.sb.openDoc(`assembly/pdf/HSP94123_${s.id}.pdf`); } catch (e) { r = { ok: false, error: String(e) }; }
        if (!r || !r.ok) { if (window.sbToast) window.sbToast(tt('a3.pdfErr')); }
      });
      menu.appendChild(b);
    });
    if (L() !== 'ru') menu.appendChild(el('div', 'a3-menu-note', tt('a3.pdfRu')));
  }

  /** Тексты интерфейса на текущем языке. */
  function applyTexts() {
    if (!built) return;
    byId('tab-assembly').querySelectorAll('[data-k]').forEach((n) => { n.textContent = tt(n.dataset.k); });
    byId('a3-replay').title = tt('a3.replay');
    byId('a3-prev').title = tt('a3.prev');
    byId('a3-resetview').title = tt('a3.resetView');
    byId('a3-pickclose').title = byId('a3-mclose').title = tt('a3.close');
    byId('a3-x2').title = tt('a3.x2');
    byId('a3-pdf').title = tt('a3.pdfTitle');
    byId('a3-loading').textContent = tt('a3.loading');
    renderTabs(); renderRail(); renderCard();
  }

  /* ── 3D: всё, что требует three.js, — после его загрузки ── */
  let three = null;           // { THREE, OrbitControls, GLTFLoader, RoomEnvironment }
  let renderer, scene, camera, controls, pmrem, lineMat, arrowMat, arrowGroup, ray, ndc;
  let meshes = new Map(), curRoot = null;
  let P = 0, nPh = 0, playing = false, t0 = 0, arrows = [], tween = null, selected = null, rafId = 0;
  const PHASE_T = 1.1, START_DELAY = 0.7;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const MAT_FIX = {  // пластик в модели почти чёрный — на экране делаем светлее, чтобы были видны формы
    'HSP · пластик': { color: 0x3f444b, roughness: 0.62, metalness: 0 },
    'HSP · пружина': { color: 0x2b2f35, roughness: 0.4, metalness: 0.6 }
  };

  function loadThree() {
    if (window.HSP3) return Promise.resolve(window.HSP3);
    return new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'vendor/three-hsp.min.js';
      s.onload = () => (window.HSP3 ? res(window.HSP3) : rej(new Error('three')));
      s.onerror = () => rej(new Error('three'));
      document.head.appendChild(s);
    });
  }

  function initScene(H) {
    three = H;
    const THREE = H.THREE;
    const stage = byId('a3-stage');
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    stage.prepend(renderer.domElement);
    scene = new THREE.Scene();
    pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new H.RoomEnvironment(renderer), 0.04).texture;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(0.3, 0.6, 0.4); scene.add(sun);
    camera = new THREE.PerspectiveCamera(28, 1, 0.002, 10);
    camera.position.set(-0.3, 0.2, 0.2);
    controls = new H.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.12; controls.minDistance = 0.03; controls.maxDistance = 1.6;
    controls.addEventListener('start', () => { byId('a3-how').hidden = true; tween = null; });
    lineMat = new THREE.LineBasicMaterial({ color: 0x0d1218, transparent: true, opacity: 0.55 });
    arrowMat = new THREE.MeshBasicMaterial({ color: 0xe8501a, transparent: true, depthTest: false });
    arrowGroup = new THREE.Group(); scene.add(arrowGroup);
    ray = new THREE.Raycaster(); ndc = new THREE.Vector2();
    readColors();
    new ResizeObserver(resize).observe(stage);
    resize();
    // выбор детали щелчком (не путать с поворотом модели)
    let down = null;
    const cv = renderer.domElement;
    cv.addEventListener('pointerdown', (e) => { down = [e.clientX, e.clientY]; });
    cv.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
      const h = hit(e);
      if (h) pick(h.object); else clearPick();
    });
    cv.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      cv.style.cursor = hit(e) ? 'pointer' : 'grab';
    });
  }

  function readColors() {
    if (!three) return;
    const cs = getComputedStyle(document.body);
    arrowMat.color.set(cs.getPropertyValue('--a3-arrow').trim() || '#e8501a');
  }

  function prepMesh(m) {
    const THREE = three.THREE;
    const fix = MAT_FIX[m.material.name];
    m.material = m.material.clone();
    if (fix) { m.material.color.setHex(fix.color); m.material.roughness = fix.roughness; m.material.metalness = fix.metalness; }
    m.material.side = THREE.DoubleSide;
    m.material.emissive = new THREE.Color(0, 0, 0);
    m.geometry.computeBoundingBox();
    m.updateWorldMatrix(true, false);
    m.userData.base = m.position.clone();
    m.userData.bbox = m.geometry.boundingBox.clone().applyMatrix4(m.matrixWorld);
    const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 32), lineMat);
    e.raycast = () => {};
    m.add(e);
  }

  function makeArrow(from, to, size) {
    const THREE = three.THREE;
    const g = new THREE.Group();
    const d = new THREE.Vector3().subVectors(to, from);
    const a = from.clone().addScaledVector(d, 0.12), b = from.clone().addScaledVector(d, 0.9);
    const len = a.distanceTo(b), head = Math.min(size * 2.6, len * 0.5), rad = size * 0.42;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, Math.max(len - head, 1e-4), 12), arrowMat.clone());
    const cone = new THREE.Mesh(new THREE.ConeGeometry(size * 1.15, head, 18), arrowMat.clone());
    shaft.position.y = (len - head) / 2; cone.position.y = len - head / 2;
    g.add(shaft, cone);
    g.position.copy(a);
    g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    g.renderOrder = 10; shaft.renderOrder = 10; cone.renderOrder = 10;
    return g;
  }

  const phaseList = (st) => [...new Set(Object.values(st.seq))].sort((a, b) => a - b);

  function stepBox(st, exploded) {
    const THREE = three.THREE;
    const box = new THREE.Box3(), tmp = new THREE.Box3();
    for (const [id, off] of Object.entries(st.nodes)) {
      const m = meshes.get(id); if (!m) continue;
      tmp.copy(m.userData.bbox);
      if (exploded && off) tmp.translate(new THREE.Vector3(...off));
      box.union(tmp);
    }
    return box;
  }
  /** Область кадра: весь шаг или (большая рама) заданная часть сцены + то, что двигается. */
  function viewBox(st) {
    const THREE = three.THREE;
    if (!st.fitbox) return stepBox(st, true).union(stepBox(st, false));
    const box = new THREE.Box3(new THREE.Vector3(...st.fitbox[0]), new THREE.Vector3(...st.fitbox[1])), tmp = new THREE.Box3();
    for (const [id, off] of Object.entries(st.nodes)) {
      if (!off) continue;
      const m = meshes.get(id); if (!m) continue;
      box.union(tmp.copy(m.userData.bbox)); box.union(tmp.translate(new THREE.Vector3(...off)));
    }
    return box;
  }
  function fitCamera(st, instant) {
    const THREE = three.THREE;
    const sph = viewBox(st).getBoundingSphere(new THREE.Sphere());
    const dir = new THREE.Vector3(...st.dir).normalize();
    const vf = THREE.MathUtils.degToRad(camera.fov);
    const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
    const dist = sph.radius / Math.sin(Math.min(vf, hf) / 2) * 0.8;
    const pos = sph.center.clone().addScaledVector(dir, -dist);
    if (instant || reduce) { camera.position.copy(pos); controls.target.copy(sph.center); controls.update(); tween = null; return; }
    tween = { p0: camera.position.clone(), t0: controls.target.clone(), p1: pos, t1: sph.center.clone(), s: performance.now() };
  }

  /* ── шаг ── */
  function setStep(i, opts = {}) {
    cur = Math.max(0, Math.min(STEPS.length - 1, i));
    const st = STEPS[cur];
    prog.pos = { sec: SEC.id, step: cur };
    if (st.num === '✓' && !prog.done[st.id]) prog.done[st.id] = true;     // дошли до конца раздела
    save();
    renderCard(); renderRail(); renderTabs();
    if (!three || !curRoot) return;
    const THREE = three.THREE;
    const ph = phaseList(st); nPh = ph.length;
    for (const [id, m] of meshes) {
      const off = st.nodes[id];
      m.visible = off !== undefined;
      m.userData.off = off ? new THREE.Vector3(...off) : null;
      m.userData.phase = off ? ph.indexOf(st.seq[id]) : -1;
      m.position.copy(m.userData.base);
    }
    arrowGroup.clear(); arrows = [];
    const box = st.fitbox ? viewBox(st) : stepBox(st, false);
    const size = Math.max(box.getSize(new THREE.Vector3()).length() * 0.011, 0.0009);
    for (const a of st.arrows) {
      const from = new THREE.Vector3(...a.from), to = new THREE.Vector3(...a.to);
      const off = from.clone().sub(to);
      let phase = 0;
      for (const m of meshes.values()) if (m.userData.off && m.userData.off.distanceTo(off) < 1e-4) { phase = m.userData.phase; break; }
      const g = makeArrow(from, to, size); g.userData.phase = phase; arrowGroup.add(g); arrows.push(g);
    }
    clearPick();
    fitCamera(st, opts.instant);
    P = 0; playing = nPh > 0; t0 = performance.now() / 1000 + START_DELAY;
    applyProgress();
  }

  const ease = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
  function applyProgress() {
    if (!three) return;
    for (const m of meshes.values()) {
      if (!m.visible) continue;
      if (m.userData.off) {
        const e = ease(Math.min(1, Math.max(0, P - m.userData.phase)));
        m.position.copy(m.userData.base).addScaledVector(m.userData.off, 1 - e);
      }
      if (m === selected) m.material.emissive.set(0x2f7cf6).multiplyScalar(0.45);
      else m.material.emissive.setRGB(0, 0, 0);
    }
    for (const g of arrows) {
      const o = 1 - Math.min(1, Math.max(0, (P - g.userData.phase) * 1.6));
      g.visible = o > 0.02;
      g.children.forEach((c) => { c.material.opacity = 0.95 * o; });
    }
    byId('a3-scrub').value = nPh ? Math.round(P / nPh * 1000) : 1000;
  }
  function replay() { P = 0; playing = nPh > 0; t0 = performance.now() / 1000 + 0.4; }

  /* ── карточка, лента шагов, вкладки разделов ── */
  function renderTabs() {
    if (!built) return;
    [...byId('a3-tabs').children].forEach((b, i) => {
      const s = SECS[i], p = secProgress(s);
      b.setAttribute('aria-selected', String(i === si));
      b.querySelector('.a3-tl').textContent = S(s.label);
      b.title = tt('a3.section', { l: s.letter, t: S(s.label) }) + ' · ' + tt('a3.progress', { n: p.n, m: p.m });
      b.classList.toggle('is-complete', p.n === p.m);
    });
    const tp = totalProgress();
    byId('a3-total-t').textContent = tt('a3.progress', { n: tp.n, m: tp.m });
    byId('a3-total-bar').style.width = Math.round(100 * tp.n / tp.m) + '%';
    byId('a3-total').classList.toggle('is-complete', tp.n === tp.m);
  }
  function renderRail() {
    if (!built) return;
    const rail = byId('a3-rail');
    if (rail.dataset.sec !== SEC.id) {
      rail.dataset.sec = SEC.id;
      rail.textContent = '';
      STEPS.forEach((s, i) => {
        const b = el('button', 'a3-chip');
        b.appendChild(document.createTextNode(s.num));
        if (s.sub) b.appendChild(el('span', 's', '·' + s.sub));
        b.addEventListener('click', () => setStep(i));
        rail.appendChild(b);
      });
    }
    [...rail.children].forEach((b, i) => {
      const s = STEPS[i];
      b.classList.toggle('cur', i === cur);
      b.classList.toggle('done', !!prog.done[s.id]);
      b.title = s.num === '✓' ? tt('a3.doneSec') : tt('a3.stepN', { n: s.num }) + (s.sub ? ' · ' + tt('a3.partN', { i: s.sub }) : '');
    });
    const c = rail.children[cur];
    if (c && visible) c.scrollIntoView({ block: 'nearest', inline: 'center', behavior: reduce ? 'auto' : 'smooth' });
  }
  function renderCard() {
    if (!built) return;
    const st = STEPS[cur];
    const fin = st.num === '✓';
    byId('a3-seclabel').textContent = tt('a3.section', { l: SEC.letter, t: S(SEC.label) });
    byId('a3-num').textContent = st.num;
    byId('a3-of').textContent = '';
    if (fin) byId('a3-of').textContent = tt('a3.doneSec');
    else {
      byId('a3-of').appendChild(document.createTextNode(tt('a3.stepOf', { n: SEC.total })));
      if (st.sub) { byId('a3-of').appendChild(el('br')); byId('a3-of').appendChild(document.createTextNode(tt('a3.partOf', { i: st.sub }))); }
    }
    byId('a3-x2').hidden = !st.x2;
    byId('a3-caption').textContent = S(st.text);
    const tool = byId('a3-tool');
    tool.hidden = !st.tool; tool.textContent = '';
    if (st.tool) { tool.appendChild(document.createTextNode(tt('a3.tool') + ' ')); tool.appendChild(el('b', '', S(st.tool))); }
    byId('a3-traylabel').hidden = fin;
    const tray = byId('a3-tray'); tray.textContent = '';
    if (!st.parts.length && !fin) tray.appendChild(el('div', 'a3-empty', tt('a3.noParts')));
    for (const [key, n] of st.parts) {
      const p = D.parts[key];
      const b = el('button', 'a3-tile');
      const th = el('span', 'th');
      const img = el('img'); img.alt = ''; img.src = p.img; img.loading = 'lazy';
      th.appendChild(img); b.appendChild(th);
      b.appendChild(el('span', 'nm', S(p.name)));
      b.appendChild(el('span', 'n', n + '×'));
      b.title = S(p.note);
      b.addEventListener('click', () => openPart(key, n));
      tray.appendChild(b);
    }
    const done = byId('a3-done');
    done.hidden = fin;
    done.classList.toggle('on', !!prog.done[st.id]);
    done.setAttribute('aria-pressed', prog.done[st.id] ? 'true' : 'false');
    done.querySelector('span').textContent = prog.done[st.id] ? tt('a3.isDone') : tt('a3.markDone');
    const last = cur === STEPS.length - 1, nextSec = last && si < SECS.length - 1 ? SECS[si + 1] : null;
    byId('a3-prev').disabled = cur === 0 && si === 0;
    byId('a3-next').disabled = last && !nextSec;
    byId('a3-next').title = nextSec ? tt('a3.toSection', { l: nextSec.letter }) : tt('a3.next');
    const go = byId('a3-next2');
    go.hidden = last && !nextSec;
    go.querySelector('.t').textContent = nextSec ? tt('a3.toSection', { l: nextSec.letter })
      : (fin ? tt('a3.next') : tt('a3.doneNext'));
  }

  function goNext(mark) {
    if (switching) return;
    const st = STEPS[cur];
    if (mark && st.num !== '✓' && !prog.done[st.id]) { prog.done[st.id] = true; save(); }    // «Далее» = этот шаг собран
    if (cur < STEPS.length - 1) setStep(cur + 1);
    else if (si < SECS.length - 1) goSection(si + 1, 0);
  }
  function goPrev() {
    if (switching) return;
    if (cur > 0) setStep(cur - 1); else if (si > 0) goSection(si - 1, -1);
  }
  function onKey(e) {
    if (!visible) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, .a3-modal')) { if (e.key === 'Escape' && mOpen) closePart(); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); goNext(true); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); goPrev(); }
    else if (e.key === ' ') { e.preventDefault(); replay(); }
    else if (e.key === 'Escape' && mOpen) closePart();
  }

  /* ── выбор детали в сцене ── */
  function hit(ev) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set((ev.clientX - r.left) / r.width * 2 - 1, -(ev.clientY - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const list = [...meshes.values()].filter((m) => m.visible);
    return ray.intersectObjects(list, false)[0];
  }
  function pick(m) {
    selected = m;
    const [pe, pid] = m.name.includes(':') ? m.name.split(':') : [SEC.id, m.name];
    const info = SECBY[pe].nodes[pid] || { name: m.name, no: '' };
    byId('a3-pickname').textContent = S(info.name);
    byId('a3-pickno').textContent = (info.no ? '№ ' + info.no : '') + (m.userData.off ? (info.no ? ' · ' : '') + tt('a3.thisStep') : '');
    byId('a3-pick').hidden = false; byId('a3-how').hidden = true;
    applyProgress();
  }
  function clearPick() { selected = null; const p = byId('a3-pick'); if (p) p.hidden = true; }

  /* ── окно «покрутить деталь» ── */
  let mR = null, mScene, mCam, mCtl, mOpen = false, mKey = null;
  function openPart(key, n) {
    const p = D.parts[key];
    byId('a3-mname').textContent = S(p.name); byId('a3-mnote').textContent = S(p.note); byId('a3-mcnt').textContent = n + '×';
    byId('a3-modal').hidden = false; mOpen = true; mKey = key;
    const img = byId('a3-mimg'); img.src = p.img; img.hidden = false;
    if (mR) { const old = mScene.getObjectByName('part'); if (old) mScene.remove(old); mR.domElement.style.visibility = 'hidden'; }
    byId('a3-mclose').focus();
    const ids = p.nodes || {};
    const sid = (ids[SEC.id] || []).length ? SEC.id : Object.keys(ids).find((k) => ids[k].length);
    if (!sid || !three) return;
    loadSection(SECBY[sid]).then((Ls) => {
      if (!mOpen || mKey !== key) return;
      img.hidden = true;
      showPart(ids[sid].map((id) => Ls.meshes.get(id)).filter(Boolean));
    }).catch(() => {});
  }
  function showPart(srcs) {
    const THREE = three.THREE;
    const view = byId('a3-mview');
    if (!mR) {
      mR = new THREE.WebGLRenderer({ antialias: true, alpha: true });
      mR.setPixelRatio(Math.min(devicePixelRatio, 2)); mR.outputColorSpace = THREE.SRGBColorSpace;
      mR.toneMapping = THREE.ACESFilmicToneMapping; mR.toneMappingExposure = 1.05;
      view.appendChild(mR.domElement);
      mScene = new THREE.Scene();
      mScene.environment = new THREE.PMREMGenerator(mR).fromScene(new three.RoomEnvironment(mR), 0.04).texture;
      mScene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 0.6));
      const s2 = new THREE.DirectionalLight(0xffffff, 1.2); s2.position.set(0.3, 0.6, 0.4); mScene.add(s2);
      mCam = new THREE.PerspectiveCamera(28, 1, 0.0005, 5);
      mCtl = new three.OrbitControls(mCam, mR.domElement); mCtl.enableDamping = true; mCtl.autoRotate = !reduce; mCtl.autoRotateSpeed = 2.2;
      mCtl.addEventListener('start', () => { mCtl.autoRotate = false; });
    }
    const old = mScene.getObjectByName('part'); if (old) mScene.remove(old);
    const g = new THREE.Group(); g.name = 'part';
    const box = new THREE.Box3();
    mR.domElement.style.visibility = '';
    for (const src of srcs) {
      const c = new THREE.Mesh(src.geometry, src.material.clone()); c.material.emissive = new THREE.Color(0, 0, 0);
      c.position.copy(src.userData.base); c.quaternion.copy(src.quaternion); c.scale.copy(src.scale);
      c.add(new THREE.LineSegments(src.children[0].geometry, lineMat));
      g.add(c); box.union(src.userData.bbox);
    }
    const ctr = box.getCenter(new THREE.Vector3()); g.position.copy(ctr).negate(); mScene.add(g);
    const r = box.getBoundingSphere(new THREE.Sphere()).radius;
    sizeModal();
    const vf = THREE.MathUtils.degToRad(mCam.fov), hf = 2 * Math.atan(Math.tan(vf / 2) * mCam.aspect);
    const dist = r / Math.sin(Math.min(vf, hf) / 2) * 1.05;
    mCam.position.set(-0.75, 0.45, 0.55).normalize().multiplyScalar(dist); mCtl.target.set(0, 0, 0);
    mCtl.minDistance = dist * 0.35; mCtl.maxDistance = dist * 3; mCtl.autoRotate = !reduce; mCtl.update();
  }
  function sizeModal() {
    const v = byId('a3-mview'); const w = v.clientWidth, h = v.clientHeight;
    mR.setSize(w, h, false); mCam.aspect = w / h; mCam.updateProjectionMatrix();
  }
  function closePart() { const m = byId('a3-modal'); if (m) m.hidden = true; mOpen = false; }

  /* ── размер и цикл ── */
  function resize() {
    if (!renderer) return;
    const stage = byId('a3-stage');
    const w = stage.clientWidth, h = stage.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  function loop() {
    rafId = requestAnimationFrame(loop);
    const now = performance.now() / 1000;
    if (tween) {
      const k = Math.min(1, (performance.now() - tween.s) / 900), e = ease(k);
      camera.position.lerpVectors(tween.p0, tween.p1, e); controls.target.lerpVectors(tween.t0, tween.t1, e);
      if (k >= 1) tween = null;
    }
    if (playing) {
      P = Math.max(0, (now - t0) / PHASE_T);
      if (P >= nPh) { P = nPh; playing = false; }
    }
    applyProgress();
    controls.update();
    renderer.render(scene, camera);
    if (mOpen && mR) { mCtl.update(); mR.render(mScene, mCam); }
  }

  /* ── модели разделов: GLB-файлы рядом (renderer/assembly) ── */
  const BUF = {}, LOADED = {};
  function readFile(url) {
    return fetch(url).then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.arrayBuffer(); })
      .catch(() => new Promise((res, rej) => {      // на всякий случай — XHR (file:// в старых сборках Electron)
        const x = new XMLHttpRequest();
        x.open('GET', url); x.responseType = 'arraybuffer';
        x.onload = () => (x.response ? res(x.response) : rej(new Error('empty')));
        x.onerror = () => rej(new Error('xhr'));
        x.send();
      }));
  }
  function getBuf(sec) {
    if (!BUF[sec.id]) {
      BUF[sec.id] = readFile(sec.glb);
      BUF[sec.id].catch(() => { delete BUF[sec.id]; });
    }
    return BUF[sec.id];
  }
  function loadSection(sec) {
    if (!LOADED[sec.id]) {
      LOADED[sec.id] = getBuf(sec).then((buf) => new Promise((res, rej) => new three.GLTFLoader().parse(buf, '', (gltf) => {
        const ms = new Map();
        gltf.scene.traverse((o) => { if (o.isMesh && /^n\d+$/.test(o.name)) { prepMesh(o); ms.set(o.name, o); } });
        res({ root: gltf.scene, meshes: ms });
      }, rej))).then(async (Ls) => {
        for (const E of sec.ext || []) {      // готовые узлы других разделов — копии их сеток (геометрия общая)
          const L2 = await loadSection(SECBY[E]);
          for (const id of OWN[E]) {
            const m = L2.meshes.get(id); if (!m) continue;
            const c = m.clone(); c.material = m.material.clone(); c.name = E + ':' + id;
            c.userData = { base: m.userData.base.clone(), bbox: m.userData.bbox.clone() };
            c.position.copy(c.userData.base);
            Ls.root.add(c); Ls.meshes.set(c.name, c);
          }
        }
        return Ls;
      });
      LOADED[sec.id].catch(() => { delete LOADED[sec.id]; });
    }
    return LOADED[sec.id];
  }

  let switching = false, loadTok = 0;
  async function goSection(i, step, opts = {}) {
    const sec = SECS[i], tok = ++loadTok;
    si = i; SEC = sec; STEPS = sec.steps;
    cur = step < 0 ? STEPS.length - 1 : Math.min(step, STEPS.length - 1);
    renderTabs(); renderRail(); renderCard();
    if (!three) return;
    if (sec !== curSec || !curRoot) {
      switching = true; closePart(); clearPick();
      const ld = byId('a3-loading');
      ld.textContent = tt('a3.loadingSec', { l: sec.letter }); ld.hidden = false;
      let Ls;
      try { Ls = await loadSection(sec); }
      catch (err) {
        if (tok === loadTok) { switching = false; ld.textContent = tt('a3.loadErr') + ': ' + (err && err.message ? err.message : err); }
        return;
      }
      if (tok !== loadTok) return;
      if (curRoot) scene.remove(curRoot);
      scene.add(Ls.root); curRoot = Ls.root; meshes = Ls.meshes; curSec = sec;
      ld.hidden = true; switching = false;
      opts = Object.assign({ instant: true }, opts);
      const nb = SECS[i + 1] || SECS[i - 1]; if (nb) setTimeout(() => getBuf(nb).catch(() => {}), 1500);   // соседний раздел — заранее
    }
    setStep(cur, opts);
  }
  let curSec = null;

  /* ── открыть / спрятать страницу ── */
  async function onShow(opts = {}) {
    visible = true;
    if (!built) build();
    if (opts.from) backTo = opts.from;
    await ready;
    let target = null;
    if (opts.sec) target = [Math.max(0, SECS.findIndex((s) => s.id === opts.sec)), opts.step || 0];
    else if (!curRoot && prog.pos && SECBY[prog.pos.sec]) target = [SECS.indexOf(SECBY[prog.pos.sec]), prog.pos.step || 0];
    else if (!curRoot) target = firstUndone() || [0, 0];
    if (target) { si = target[0]; SEC = SECS[si]; STEPS = SEC.steps; cur = Math.min(target[1], STEPS.length - 1); }
    applyTexts();
    if (!three) {
      const ld = byId('a3-loading'); ld.hidden = false; ld.textContent = tt('a3.loading');
      try { initScene(await loadThree()); }
      catch (e) { ld.textContent = tt('a3.loadErr'); return; }
    }
    readColors();
    if (!rafId) loop();
    if (target || !curRoot) await goSection(si, cur, { instant: true });
    else resize();
  }
  function onHide() {
    visible = false;
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    closePart();
  }

  document.addEventListener('sb-lang-changed', () => { if (built) applyTexts(); });
  new MutationObserver(() => readColors()).observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });

  window.sbAsm = {
    onShow, onHide,
    sections: SECS,
    progress: () => Object.assign(totalProgress(), { next: firstUndone(), bySec: SECS.map((s) => Object.assign({ id: s.id, letter: s.letter, label: s.label }, secProgress(s))) }),
    whenReady: () => ready,
    /** Открыть сборку: с места, где остановились (или с первого несобранного шага). */
    open(from, sec, step) { window.sbShared.showPage('assembly', { from, sec, step }); },
    reset() {
      prog = { done: {}, pos: null }; save();
      if (built) { renderTabs(); renderRail(); renderCard(); }
    }
  };
})();
