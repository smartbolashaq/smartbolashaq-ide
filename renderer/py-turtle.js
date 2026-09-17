/* Холст черепашки для вкладки «Python». Команды приходят из py-worker.js
 * (наш модуль turtle) пачками: line / fill / dot / write / stamp / bg / clear /
 * turtle. Рисунок копится на скрытом холсте, поверх него рисуются сами
 * черепашки — так их можно двигать, не перерисовывая всё. */
(() => {
  const W = 640, H = 500;           // логический размер экрана, центр — (0, 0), y вверх
  let view = null, back = null, bctx = null, dpr = 1;
  let turtles = new Map();          // id → {x, y, h, vis, color}
  let bg = '#ffffff';
  let used = false;                 // рисовали ли что-то в текущем запуске
  let raf = 0;

  const cx = (x) => W / 2 + x, cy = (y) => H / 2 - y;

  function ensure() {
    if (view) return true;
    view = document.getElementById('py-turtle-canvas');
    if (!view) return false;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    view.width = W * dpr; view.height = H * dpr;
    back = document.createElement('canvas');
    back.width = W * dpr; back.height = H * dpr;
    bctx = back.getContext('2d');
    bctx.scale(dpr, dpr);
    clearBack();
    return true;
  }
  function clearBack() {
    bctx.save(); bctx.setTransform(1, 0, 0, 1, 0, 0);
    bctx.clearRect(0, 0, back.width, back.height); bctx.restore();
  }

  function fontCss(f) {
    // ("Arial", 16, "bold") → "bold 16px Arial"
    const fam = (f && f[0]) || 'Arial', size = (f && f[1]) || 8, style = String((f && f[2]) || 'normal').toLowerCase();
    const parts = [];
    if (style.includes('italic')) parts.push('italic');
    if (style.includes('bold')) parts.push('bold');
    return parts.join(' ') + ' ' + size + 'px ' + fam;
  }

  function apply(cmds) {
    if (!ensure()) return;
    for (const c of cmds) {
      const k = c[0];
      if (k === 'line') {
        used = true;
        bctx.strokeStyle = c[5]; bctx.lineWidth = c[6] || 1; bctx.lineCap = 'round';
        bctx.beginPath(); bctx.moveTo(cx(c[1]), cy(c[2])); bctx.lineTo(cx(c[3]), cy(c[4])); bctx.stroke();
      } else if (k === 'fill') {
        used = true;
        const pts = c[1]; if (!pts || pts.length < 3) continue;
        bctx.fillStyle = c[2]; bctx.beginPath();
        bctx.moveTo(cx(pts[0][0]), cy(pts[0][1]));
        for (let i = 1; i < pts.length; i++) bctx.lineTo(cx(pts[i][0]), cy(pts[i][1]));
        bctx.closePath(); bctx.fill();
      } else if (k === 'dot') {
        used = true;
        bctx.fillStyle = c[4]; bctx.beginPath();
        bctx.arc(cx(c[1]), cy(c[2]), Math.max(1, c[3] / 2), 0, Math.PI * 2); bctx.fill();
      } else if (k === 'write') {
        used = true;
        bctx.fillStyle = c[4]; bctx.font = fontCss(c[6]);
        bctx.textAlign = (c[5] === 'center' || c[5] === 'right') ? c[5] : 'left';
        bctx.textBaseline = 'bottom';
        bctx.fillText(c[3], cx(c[1]), cy(c[2]));
      } else if (k === 'stamp') {
        used = true;
        drawTurtle(bctx, { x: c[1], y: c[2], h: c[3], color: c[4], vis: true });
      } else if (k === 'bg') {
        used = true; bg = c[1];
      } else if (k === 'clear') {
        clearBack();
      } else if (k === 'turtle') {
        turtles.set(c[1], { x: c[2], y: c[3], h: c[4], vis: c[5], color: c[6] });
      }
    }
    if (used) show();
    schedule();
  }

  function drawTurtle(ctx, t) {
    if (!t.vis) return;
    const a = -t.h * Math.PI / 180, x = cx(t.x), y = cy(t.y);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.lineTo(-6, 6); ctx.lineTo(-3, 0); ctx.lineTo(-6, -6); ctx.closePath();
    ctx.fillStyle = t.color || 'black'; ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,.55)'; ctx.lineWidth = 1; ctx.stroke();
    ctx.restore();
  }

  function schedule() { if (!raf) raf = requestAnimationFrame(render); }
  function render() {
    raf = 0;
    if (!ensure()) return;
    const ctx = view.getContext('2d');
    ctx.save(); ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = bg; ctx.fillRect(0, 0, view.width, view.height);
    ctx.drawImage(back, 0, 0);
    ctx.restore();
    ctx.save(); ctx.scale(dpr, dpr);
    turtles.forEach((t) => drawTurtle(ctx, t));
    ctx.restore();
  }

  function pane() { return document.getElementById('py-turtle-pane'); }
  const panel = () => document.getElementById('py-work-panel');
  function show() { const p = pane(); if (p) p.classList.remove('hidden'); const w = panel(); if (w) w.classList.add('has-turtle'); }
  function hide() { const p = pane(); if (p) p.classList.add('hidden'); const w = panel(); if (w) w.classList.remove('has-turtle'); }

  window.sbTurtle = {
    /* новый запуск: чистый холст, черепашек нет, панель прячется до первой команды */
    reset() {
      if (!ensure()) return;
      turtles = new Map(); bg = '#ffffff'; used = false;
      clearBack(); hide(); schedule();
    },
    apply, show, hide,
    isUsed() { return used; },
    /* PNG-снимок рисунка — пригодится для «сохранить картинку» */
    toDataURL() { render(); return view ? view.toDataURL('image/png') : null; }
  };
})();
