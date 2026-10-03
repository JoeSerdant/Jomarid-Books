/* ui.js - rozhraní Chess League (React z CDN, bez JSX). Vzhled je ve style.css, logika v session.js,
   league.js, bots.js a search.js; tady je jen skládání obrazovek. */
(() => {
  const { useState, useEffect, useRef, useReducer, useMemo } = React;
  const h = React.createElement;
  // krátké pomocníky místo React.createElement
  const el = (tag) => (props, ...kids) => h(tag, props, ...kids);
  const div = el("div"), span = el("span"), button = el("button"), p = el("p"), small = el("small"), nav = el("nav"), b = el("b"), i = el("i");
  const svg = el("svg"), path = el("path"), line = el("line"), circle = el("circle"), text = el("text"), polygon = el("polygon");

  const BOTS = Bots.BOTS;
  const BOT_RATINGS = BOTS.map((bt) => bt.rating);
  const BOT_LIST = BOTS.map((bt) => ({ key: bt.key, rating: bt.rating }));
  const embedded = (() => { try { return window.parent !== window; } catch (e) { return false; } })();

  // ---------- Pomocné funkce ----------
  function pad2(n) { return String(n).padStart(2, "0"); }
  function dateStr(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayStr() { return dateStr(new Date()); }
  function yesterdayStr() { const d = new Date(); d.setDate(d.getDate() - 1); return dateStr(d); }
  function fmtClock(ms) {
    if (ms == null) return "";
    const total = Math.max(0, ms);
    if (total < 10000) return Math.floor(total / 1000) + "." + Math.floor((total % 1000) / 100);
    const s = Math.ceil(total / 1000);
    return Math.floor(s / 60) + ":" + pad2(s % 60);
  }
  function signed(n) { return (n > 0 ? "+" : n < 0 ? "−" : "±") + Math.abs(n); }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function pct(x) { return Math.round(x * 100) + " %"; }
  function botByKey(key) { return BOTS.find((bt) => bt.key === key) || BOTS[0]; }

  // Znaky figur; ︎ vynutí textové (barevně ovladatelné) zobrazení i na iOS a Androidu,
  // kde by se černý pěšec ♟ jinak vykreslil jako emoji.
  const TXT = "︎";
  const PIECE_GLYPHS = {
    w: { k: "♔" + TXT, q: "♕" + TXT, r: "♖" + TXT, b: "♗" + TXT, n: "♘" + TXT, p: "♙" + TXT },
    b: { k: "♚" + TXT, q: "♛" + TXT, r: "♜" + TXT, b: "♝" + TXT, n: "♞" + TXT, p: "♟" + TXT }
  };

  // ---------- Zvuky ----------
  const SoundFX = (function () {
    let ctx = null;
    function ensureCtx() {
      if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { ctx = null; } }
      if (ctx && ctx.state === "suspended") ctx.resume().catch(() => {});
      return ctx;
    }
    function tone(freq, start, duration, type, peak) {
      const c = ensureCtx();
      if (!c) return;
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type || "sine";
      osc.frequency.value = freq;
      const t0 = c.currentTime + start;
      gain.gain.setValueAtTime(1e-4, t0);
      gain.gain.linearRampToValueAtTime(peak || 0.12, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(1e-4, t0 + duration);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(t0);
      osc.stop(t0 + duration + 0.03);
    }
    return {
      move() { tone(520, 0, 0.09, "sine", 0.1); },
      capture() { tone(340, 0, 0.1, "triangle", 0.14); tone(210, 0.05, 0.12, "triangle", 0.11); },
      castle() { tone(480, 0, 0.08, "sine", 0.1); tone(620, 0.09, 0.09, "sine", 0.1); },
      promote() { [523.25, 659.25, 880].forEach((f, k) => tone(f, k * 0.07, 0.14, "triangle", 0.1)); },
      check() { tone(880, 0, 0.08, "square", 0.07); tone(660, 0.1, 0.1, "square", 0.07); },
      click() { tone(700, 0, 0.05, "sine", 0.05); },
      tick() { tone(1200, 0, 0.04, "square", 0.04); },
      win() { [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone(f, k * 0.11, 0.22, "triangle", 0.12)); },
      lose() { [392, 349.23, 293.66].forEach((f, k) => tone(f, k * 0.13, 0.28, "sine", 0.1)); },
      draw() { [440, 440].forEach((f, k) => tone(f, k * 0.16, 0.18, "sine", 0.09)); },
      level() { [392, 523.25, 659.25, 783.99, 1046.5].forEach((f, k) => tone(f, k * 0.09, 0.2, "triangle", 0.11)); }
    };
  })();

  const Confetti = (function () {
    function burst(canvas, durationMs) {
      const dpr = window.devicePixelRatio || 1;
      const W = canvas.offsetWidth, H = canvas.offsetHeight;
      canvas.width = W * dpr; canvas.height = H * dpr;
      const ctx = canvas.getContext("2d");
      const colors = ["#58CC02", "#1CB0F6", "#FFC800", "#FF4B4B", "#CE82FF"];
      const particles = Array.from({ length: 140 }, () => ({
        x: Math.random() * W, y: -20 - Math.random() * H * 0.6, r: 4 + Math.random() * 5,
        c: colors[Math.floor(Math.random() * colors.length)], vy: 2 + Math.random() * 3, vx: -2 + Math.random() * 4,
        rot: Math.random() * Math.PI * 2, vr: -0.2 + Math.random() * 0.4, shape: Math.random() < 0.5 ? "rect" : "circle"
      }));
      const start = performance.now();
      let raf;
      function frame(now) {
        const elapsed = now - start;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, W, H);
        for (const q of particles) {
          q.x += q.vx; q.y += q.vy; q.vy += 0.035; q.rot += q.vr;
          ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.fillStyle = q.c;
          if (q.shape === "rect") ctx.fillRect(-q.r / 2, -q.r / 2, q.r, q.r * 0.6);
          else { ctx.beginPath(); ctx.arc(0, 0, q.r / 2, 0, Math.PI * 2); ctx.fill(); }
          ctx.restore();
        }
        if (elapsed < durationMs) raf = requestAnimationFrame(frame);
        else ctx.clearRect(0, 0, W, H);
      }
      raf = requestAnimationFrame(frame);
      return () => { cancelAnimationFrame(raf); ctx.clearRect(0, 0, canvas.width, canvas.height); };
    }
    return { burst };
  })();

  // ---------- Klient enginu: Web Worker, jinak záloha v hlavním vlákně ----------
  // Zdroj workeru = text search.js. Když worker nejde vytvořit (omezení prostředí) nebo spadne,
  // hledání se spustí v hlavním vlákně přes setTimeout, takže hra funguje pořád.
  function createAIClient() {
    let worker = null;
    let workerBroken = false;
    let nextId = 1;
    const pending = new Map();
    const srcEl = document.getElementById("src-search");
    const source = srcEl ? srcEl.textContent : null;

    function failAll() {
      workerBroken = true;
      if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
      const jobs = Array.from(pending.values());
      pending.clear();
      jobs.forEach((j) => runLocal(j.req, j.resolve, j.onProgress));
    }
    function ensureWorker() {
      if (worker || workerBroken || !source || typeof Worker === "undefined") return worker;
      try {
        const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
        worker = new Worker(url);
        worker.onmessage = (e) => {
          const msg = e.data;
          const job = pending.get(msg.id);
          if (!job) return;
          if (msg.type === "progress") { if (job.onProgress) job.onProgress(msg); return; }
          pending.delete(msg.id);
          job.resolve(msg);
        };
        worker.onerror = () => failAll();
      } catch (e) { workerBroken = true; worker = null; }
      return worker;
    }
    function runLocal(req, resolve, onProgress) {
      setTimeout(() => {
        try { resolve(FastChess.handle(req, onProgress)); } catch (e) { resolve({ id: req.id, error: String(e && e.message || e) }); }
      }, 30);
    }
    function request(req, onProgress) {
      return new Promise((resolve) => {
        req.id = nextId++;
        const w = ensureWorker();
        if (!w) { runLocal(req, resolve, onProgress); return; }
        pending.set(req.id, { resolve, req, onProgress });
        try { w.postMessage(req); } catch (e) { pending.delete(req.id); failAll(); runLocal(req, resolve, onProgress); }
      });
    }
    return {
      search: (req) => request(Object.assign({ type: "search" }, req)),
      evalPos: (req) => request(Object.assign({ type: "eval" }, req)),
      analyze: (req, onProgress) => request(Object.assign({ type: "analyze" }, req), onProgress),
      newGame: () => { if (worker) { try { worker.postMessage({ type: "newgame", id: 0 }); } catch (e) {} } else FastChess.handle({ type: "newgame", id: 0 }); },
      // Rozběhnutý výpočet nejde přerušit zevnitř, takže se worker zahodí a příště se vytvoří nový.
      cancel: () => {
        if (worker) { try { worker.terminate(); } catch (e) {} worker = null; }
        const jobs = Array.from(pending.values());
        pending.clear();
        jobs.forEach((j) => j.resolve({ id: j.req.id, error: "cancelled" }));
      },
      destroy: () => { if (worker) { try { worker.terminate(); } catch (e) {} worker = null; } pending.clear(); }
    };
  }

  // ---------- Malé stavební prvky ----------
  function Sparkline({ points, width = 160, height = 44, stroke = "#fff", fillOpacity = 0.18 }) {
    if (!points || points.length < 2) return null;
    const lo = Math.min.apply(null, points), hi = Math.max.apply(null, points);
    const span_ = Math.max(1, hi - lo);
    const pad = 4;
    const xy = points.map((v, k) => [pad + (k / (points.length - 1)) * (width - pad * 2), pad + (1 - (v - lo) / span_) * (height - pad * 2)]);
    const d = xy.map((q, k) => (k ? "L" : "M") + q[0].toFixed(1) + " " + q[1].toFixed(1)).join(" ");
    const area = d + " L" + xy[xy.length - 1][0].toFixed(1) + " " + height + " L" + xy[0][0].toFixed(1) + " " + height + " Z";
    const last = xy[xy.length - 1];
    return svg({ viewBox: "0 0 " + width + " " + height, className: "hero-spark", "aria-hidden": "true" },
      path({ d: area, fill: stroke, opacity: fillOpacity }),
      path({ d, fill: "none", stroke, strokeWidth: 2.5, strokeLinejoin: "round", strokeLinecap: "round" }),
      circle({ cx: last[0], cy: last[1], r: 3.5, fill: stroke }));
  }

  function RatingChart({ save }) {
    const hist = save.ratingHistory;
    if (!hist.length) return div({ className: "chart-empty" }, "Odehraj hodnocený zápas a tady uvidíš vývoj ratingu.");
    const pts = [hist[0].r - hist[0].delta].concat(hist.map((x) => x.r));
    const res = [null].concat(hist.map((x) => x.res));
    const W = 320, H = 150, padL = 34, padR = 8, padT = 10, padB = 18;
    let lo = Math.min.apply(null, pts), hi = Math.max.apply(null, pts);
    if (hi - lo < 40) { const mid = (hi + lo) / 2; lo = mid - 20; hi = mid + 20; }
    lo = Math.floor((lo - 10) / 10) * 10; hi = Math.ceil((hi + 10) / 10) * 10;
    const x = (k) => padL + (pts.length === 1 ? 0 : (k / (pts.length - 1)) * (W - padL - padR));
    const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * (H - padT - padB);
    const d = pts.map((v, k) => (k ? "L" : "M") + x(k).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    const area = d + " L" + x(pts.length - 1).toFixed(1) + " " + (H - padB) + " L" + x(0).toFixed(1) + " " + (H - padB) + " Z";
    const showDots = pts.length <= 24;
    return svg({ viewBox: "0 0 " + W + " " + H, className: "rating-chart", role: "img", "aria-label": "Vývoj ratingu" },
      [lo, Math.round((lo + hi) / 2), hi].map((v) => h(React.Fragment, { key: v },
        line({ className: "grid", x1: padL, x2: W - padR, y1: y(v), y2: y(v) }),
        text({ x: padL - 6, y: y(v) + 4, textAnchor: "end" }, v))),
      path({ className: "area", d: area }),
      path({ className: "line", d }),
      showDots && pts.map((v, k) => circle({ key: k, className: "dot " + (res[k] || ""), cx: x(k), cy: y(v), r: k === pts.length - 1 ? 5 : 3.5 })));
  }

  // Graf výhodnosti bílého v průběhu partie (hodnoty 0-100).
  function EvalGraph({ graph, cursor, onPick }) {
    if (!graph || graph.length < 2) return null;
    const W = 300, H = 76;
    const x = (k) => (k / (graph.length - 1)) * W;
    const y = (v) => H - (v / 100) * H;
    const d = graph.map((v, k) => (k ? "L" : "M") + x(k).toFixed(1) + " " + y(v).toFixed(1)).join(" ");
    // plocha mezi křivkou a středem: zelená, když vede bílý, červená, když vede černý
    const clampPath = (f) => graph.map((v, k) => (k ? "L" : "M") + x(k).toFixed(1) + " " + y(f(v)).toFixed(1)).join(" ") + " L" + W + " " + H / 2 + " L0 " + H / 2 + " Z";
    const areaW = clampPath((v) => Math.max(v, 50)), areaB = clampPath((v) => Math.min(v, 50));
    return svg({
      viewBox: "0 0 " + W + " " + H, className: "eval-graph", preserveAspectRatio: "none",
      onClick: (e) => {
        const r = e.currentTarget.getBoundingClientRect();
        onPick(clamp(Math.round(((e.clientX - r.left) / r.width) * (graph.length - 1)), 0, graph.length - 1));
      }
    },
      path({ className: "fill-w", d: areaW }),
      path({ className: "fill-b", d: areaB }),
      line({ className: "mid", x1: 0, x2: W, y1: H / 2, y2: H / 2 }),
      path({ className: "ln", d }),
      cursor != null && line({ className: "cursor", x1: x(cursor), x2: x(cursor), y1: 0, y2: H }));
  }

  function ConfirmModal({ title, text: body, confirmLabel, cancelLabel, danger, onConfirm, onCancel }) {
    return div({ className: "overlay", onClick: onCancel, role: "dialog", "aria-modal": "true" },
      div({ className: "modal-card", onClick: (e) => e.stopPropagation() },
        div({ className: "modal-title" }, title),
        body && div({ className: "modal-text" }, body),
        div({ className: "modal-actions" },
          button({ className: "btn btn-ghost btn-sm", onClick: onCancel }, cancelLabel || "Zrušit"),
          button({ className: "btn btn-sm " + (danger ? "btn-danger" : "btn-primary"), onClick: onConfirm, autoFocus: true }, confirmLabel || "Potvrdit"))));
  }

  function BotAvatar({ bot, small: sm, locked }) {
    return div({ className: "bot-avatar" + (sm ? " sm" : ""), style: { background: bot.colorSoft } }, locked ? "🔒" : bot.emoji);
  }

  function CapturedRow({ pieces, glyphColor, advantage }) {
    return div({ className: "captured-row" },
      pieces.map((t, k) => span({
        key: k, className: "cap",
        style: {
          color: glyphColor === "w" ? "#FCFCFC" : "#2A2A2A",
          textShadow: glyphColor === "w" ? "-1px -1px 0 #4B4B4B, 1px -1px 0 #4B4B4B, -1px 1px 0 #4B4B4B, 1px 1px 0 #4B4B4B" : "0 1px 1px rgba(0,0,0,0.3)"
        }
      }, PIECE_GLYPHS[glyphColor][t])),
      advantage > 0 && span({ className: "adv" }, "+", advantage));
  }

  // ---------- Šachovnice: výběr tahu klepnutím i přetažením, animace, nápověda ----------
  function Board({ state, flipped, selected, targets, lastMove, hint, arrows, anim, interactive, showTargets, onPick, onTapRelease, onDrop, draggingFrom, onDragStart }) {
    const boardRef = useRef(null);
    const inCheck = ChessEngine.isInCheck(state, state.turn);
    const kingPos = inCheck ? ChessEngine.findKing(state.board, state.turn) : null;

    function squareAt(clientX, clientY) {
      const el_ = boardRef.current;
      if (!el_) return null;
      const r = el_.getBoundingClientRect();
      const fx = (clientX - r.left) / r.width, fy = (clientY - r.top) / r.height;
      if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null;
      const dc = Math.floor(fx * 8), dr = Math.floor(fy * 8);
      return { r: flipped ? 7 - dr : dr, c: flipped ? 7 - dc : dc };
    }

    // Tažení: ghost figura se posouvá přímo v DOM (bez překreslování Reactu při každém pohybu).
    const dragRef = useRef(null);
    const ghostRef = useRef(null);
    function onPointerDown(e) {
      if (!interactive) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const sq = squareAt(e.clientX, e.clientY);
      if (!sq) return;
      const isTarget = selected && targets.some((m) => m.to.r === sq.r && m.to.c === sq.c);
      if (isTarget) { onDrop(sq, false); dragRef.current = null; return; } // klepnutí na cílové pole = tah
      const res = onPick(sq); // vybere vlastní figuru (nebo zruší výběr)
      if (res.ok) {
        const piece = state.board[sq.r][sq.c];
        dragRef.current = { from: sq, startX: e.clientX, startY: e.clientY, active: false, piece, pid: e.pointerId, was: res.was };
        try { boardRef.current.setPointerCapture(e.pointerId); } catch (err) { /* nevadí */ }
      } else { dragRef.current = null; }
    }
    function onPointerMove(e) {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pid) return;
      if (!d.active) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 7) return;
        d.active = true;
        onDragStart(d.from, d.piece);
      }
      if (ghostRef.current) ghostRef.current.style.transform = "translate(" + e.clientX + "px," + e.clientY + "px) translate(-50%, -58%)";
    }
    function endDrag(e, cancel) {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pid) return;
      dragRef.current = null;
      try { boardRef.current.releasePointerCapture(e.pointerId); } catch (err) { /* nevadí */ }
      if (!d.active) { onTapRelease(d.from, d.was); return; } // prosté klepnutí na už vybranou figuru ji odvybere
      const sq = cancel ? null : squareAt(e.clientX, e.clientY);
      onDrop(sq, true);
    }

    const squares = [];
    for (let dr = 0; dr < 8; dr++) {
      for (let dc = 0; dc < 8; dc++) {
        const r = flipped ? 7 - dr : dr;
        const c = flipped ? 7 - dc : dc;
        const piece = state.board[r][c];
        const isSelected = !!(selected && selected.r === r && selected.c === c);
        const targetMove = showTargets ? targets.find((m) => m.to.r === r && m.to.c === c) : null;
        const isCapture = !!targetMove && (!!targetMove.captured || targetMove.flag === "ep");
        const isLast = !!(lastMove && ((lastMove.from.r === r && lastMove.from.c === c) || (lastMove.to.r === r && lastMove.to.c === c)));
        const isCheck = !!(kingPos && kingPos.r === r && kingPos.c === c);
        const isHintFrom = !!(hint && hint.from.r === r && hint.from.c === c);
        const isHintTo = !!(hint && hint.to.r === r && hint.to.c === c);
        const animFor = anim && anim.moves.find((a) => a.to.r === r && a.to.c === c);
        const lifted = draggingFrom && draggingFrom.r === r && draggingFrom.c === c;
        const cls = ["square", (r + c) % 2 === 0 ? "light" : "dark"];
        if (isSelected) cls.push("selected");
        if (isLast) cls.push("last-from");
        if (isCheck) cls.push("check");
        if (isHintFrom) cls.push("hint-from");
        if (isHintTo) cls.push("hint-to");
        let pieceStyle;
        if (animFor) {
          const sign = flipped ? -1 : 1;
          pieceStyle = { "--dx": (animFor.from.c - c) * sign * 100 + "%", "--dy": (animFor.from.r - r) * sign * 100 + "%" };
        }
        squares.push(div({ key: r + "-" + c, className: cls.join(" "), "data-sq": r + "," + c },
          dc === 0 && span({ className: "coord-label coord-rank" }, 8 - r),
          dr === 7 && span({ className: "coord-label coord-file" }, String.fromCharCode(97 + c)),
          piece && span({ key: animFor ? "a" + anim.key : "p", className: "piece " + (piece.color === "w" ? "white" : "black") + (animFor ? " slide" : "") + (lifted ? " lifted" : ""), style: pieceStyle }, PIECE_GLYPHS[piece.color][piece.type]),
          targetMove && !isCapture && span({ className: "move-marker" }),
          isCapture && span({ className: "capture-marker" })));
      }
    }

    // šipky (nápověda, rozbor): souřadnice ve čtverečcích 0-8
    const center = (sq) => ({ x: (flipped ? 7 - sq.c : sq.c) + 0.5, y: (flipped ? 7 - sq.r : sq.r) + 0.5 });
    const arrowEls = (arrows || []).map((a, k) => {
      const f = center(a.from), t = center(a.to);
      const dx = t.x - f.x, dy = t.y - f.y, len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const head = 0.42, tail = 0.16;
      const bx = t.x - ux * head, by = t.y - uy * head;
      return h("g", { key: k, opacity: 0.85 },
        line({ x1: f.x + ux * 0.2, y1: f.y + uy * 0.2, x2: bx, y2: by, stroke: a.color || "#FFC800", strokeWidth: tail * 2, strokeLinecap: "round" }),
        polygon({ points: [t.x, t.y, bx - uy * 0.26, by + ux * 0.26, bx + uy * 0.26, by - ux * 0.26].map((v) => v.toFixed(3)).join(" "), fill: a.color || "#FFC800" }));
    });

    return div({ className: "board-stage" },
      div({ className: "board-wrap", onPointerDown, onPointerMove, onPointerUp: (e) => endDrag(e, false), onPointerCancel: (e) => endDrag(e, true) },
        div({ className: "board", ref: boardRef }, squares),
        arrowEls.length > 0 && svg({ className: "board-arrows", viewBox: "0 0 8 8" }, arrowEls)),
      draggingFrom && h(DragGhost, { ghostRef, piece: state.board[draggingFrom.r][draggingFrom.c] }));
  }

  function DragGhost({ ghostRef, piece }) {
    return div({ ref: ghostRef, className: "drag-ghost " + (piece.color === "w" ? "white" : "black"), style: { transform: "translate(-100px,-100px)" } }, PIECE_GLYPHS[piece.color][piece.type]);
  }

  function PromotionModal({ color, onChoose, onCancel }) {
    const options = ["q", "r", "b", "n"];
    return div({ className: "overlay", onClick: onCancel },
      div({ className: "modal-card", onClick: (e) => e.stopPropagation() },
        div({ className: "modal-title" }, "Povyš svého pěšce"),
        div({ className: "modal-text" }, "Vyber, čím se stane"),
        div({ className: "promo-choices" }, options.map((t) =>
          button({ key: t, className: "promo-choice", onClick: () => onChoose(t), "aria-label": t },
            span({ className: "piece " + (color === "w" ? "white" : "black") }, PIECE_GLYPHS[color][t]))))));
  }

  // ---------- Seznam tahů s navigací a značkami kvality ----------
  function MoveListPanel({ moves, viewIdx, onView, cats, title, showNav }) {
    const listRef = useRef(null);
    const total = moves.length;
    const cur = viewIdx == null ? total : viewIdx; // počet odehraných půltahů v zobrazené pozici
    useEffect(() => {
      const node = listRef.current;
      if (!node) return;
      const active = node.querySelector(".mv.cur");
      if (active && viewIdx != null) active.scrollIntoView({ block: "nearest" });
      else node.scrollTop = node.scrollHeight;
    }, [total, viewIdx]);
    const rows = [];
    for (let k = 0; k < total; k += 2) rows.push({ num: k / 2 + 1, w: k, bl: k + 1 < total ? k + 1 : null });
    const cell = (idx) => idx == null ? span({ key: "e" }) : button({
      key: idx, className: "mv" + (cur === idx + 1 ? " cur" : ""), onClick: () => onView(idx + 1), "aria-label": "Tah " + moves[idx].san
    }, cats && cats[idx] && span({ className: "move-cat " + cats[idx].cat, title: League.CATEGORY_LABELS[cats[idx].cat] }), moves[idx].san);
    return div({ className: "panel-card" },
      div({ className: "panel-title" }, title || "Tahy"),
      div({ className: "move-list", ref: listRef },
        rows.length === 0 && div({ className: "move-list-empty" }, "Zatím žádné tahy."),
        rows.map((row) => div({ className: "move-list-row", key: row.num }, span({ className: "mv-num" }, row.num, "."), cell(row.w), cell(row.bl)))),
      showNav && div({ className: "nav-row" },
        button({ className: "icon-btn", onClick: () => onView(0), disabled: cur === 0, "aria-label": "Na začátek" }, "⏮"),
        button({ className: "icon-btn", onClick: () => onView(Math.max(0, cur - 1)), disabled: cur === 0, "aria-label": "Zpět" }, "◀"),
        button({ className: "icon-btn", onClick: () => onView(Math.min(total, cur + 1)), disabled: cur === total, "aria-label": "Vpřed" }, "▶"),
        button({ className: "icon-btn", onClick: () => onView(total), disabled: cur === total, "aria-label": "Na konec" }, "⏭")));
  }

  // ---------- Karty ligy a výzev ----------
  function LeagueCard({ xp, compact, onViewFull }) {
    const info = League.getLeagueInfo(xp);
    return div({ className: "panel-card league-card" },
      div({ className: "rail-card-head" }, span({ className: "rail-card-title" }, "Tvoje liga"), compact && button({ className: "link-btn", onClick: onViewFull }, "ZOBRAZIT LIGU")),
      div({ className: "league-tier-row" },
        span({ className: "league-tier-icon" }, info.current.icon),
        div(null, div({ className: "league-tier-name" }, info.current.name), div({ className: "league-tier-sub" }, info.next ? "Do " + info.next.name + " zbývá " + (info.next.min - xp) + " XP" : "Nejvyšší liga dosažena!"))),
      div({ className: "progress-track" }, div({ className: "progress-fill", style: { width: info.progress * 100 + "%" } })),
      !compact && div({ className: "tier-list" }, League.LEAGUE_TIERS.map((t, k) =>
        div({ key: t.name, className: "tier-row" + (k <= info.idx ? " reached" : "") }, span(null, t.icon), span(null, t.name), span({ className: "tier-min" }, t.min, " XP")))));
  }

  function QuestsCard({ save, compact, onViewAll }) {
    const quests = League.getDailyQuests(save, todayStr());
    return div({ className: "panel-card quests-card" },
      div({ className: "rail-card-head" }, span({ className: "rail-card-title" }, "Dnešní výzvy"), compact && button({ className: "link-btn", onClick: onViewAll }, "ZOBRAZIT VŠE")),
      div({ className: "quest-list" }, quests.map((q) =>
        div({ key: q.key, className: "quest-row" + (q.done ? " done" : "") },
          span({ className: "quest-icon" }, q.done ? "✅" : q.icon),
          div({ className: "quest-body" },
            div({ className: "quest-label" }, q.label, q.special && span({ className: "quest-tag" }, "DNES NAVÍC")),
            div({ className: "progress-track sm" }, div({ className: "progress-fill", style: { width: Math.min(100, (q.current / q.target) * 100) + "%" } }))),
          span({ className: "quest-reward" }, "+", q.reward, " XP")))),
      !compact && div({ className: "quest-note" }, "Za splněnou výzvu dostaneš XP automaticky po zápase, jednou za den. Výzvy se každý den obnoví."));
  }

  function HistoryList({ recentGames, onOpen }) {
    if (!recentGames || recentGames.length === 0) return div({ className: "history-empty" }, "Zatím žádné zápasy — odehraj svou první hru a uvidíš ji tady.");
    return div({ className: "history-list" }, recentGames.map((g, k) => {
      const bot = botByKey(g.botKey);
      const tcName = (League.TIME_CONTROLS.find((t) => t.key === g.tc) || {}).short;
      const meta = [g.color === "b" ? "černými" : "bílými", g.plies ? Math.ceil(g.plies / 2) + " tahů" : null, tcName && g.tc !== "none" ? tcName : null, g.acc != null ? "přesnost " + g.acc + " %" : null, g.rated === false ? "cvičná" : null].filter(Boolean).join(" · ");
      const row = [
        h(BotAvatar, { key: "a", bot, small: true }),
        div({ key: "i", className: "history-info" }, div({ className: "history-name" }, bot.name), div({ className: "history-meta" }, meta)),
        span({ key: "r", className: "result-tag " + g.result }, g.result === "win" ? "✓ Výhra" : g.result === "loss" ? "✕ Prohra" : "– Remíza"),
        span({ key: "d", className: "history-delta " + (g.delta > 0 ? "up" : g.delta < 0 ? "down" : "") }, g.rated === false ? "" : g.delta == null ? "" : signed(g.delta))
      ];
      return g.moves && onOpen ? button({ key: k, className: "history-row", onClick: () => onOpen(g), "aria-label": "Prohlédnout partii" }, row) : div({ key: k, className: "history-row" }, row);
    }));
  }

  // ---------- Menu ----------
  function useCountUp(target, ms, startFrom) {
    const [val, setVal] = useState(startFrom != null ? startFrom : target);
    const fromRef = useRef(startFrom != null ? startFrom : target);
    useEffect(() => {
      const from = fromRef.current;
      if (from === target) return;
      const t0 = performance.now();
      let raf;
      const reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      if (reduce) { fromRef.current = target; setVal(target); return; }
      function frame(now) {
        const t = clamp((now - t0) / ms, 0, 1);
        const e = 1 - Math.pow(1 - t, 3);
        setVal(Math.round(from + (target - from) * e));
        if (t < 1) raf = requestAnimationFrame(frame); else fromRef.current = target;
      }
      raf = requestAnimationFrame(frame);
      return () => cancelAnimationFrame(raf);
    }, [target]);
    return val;
  }

  function ThemeSeg({ value, onChange }) {
    const opts = [["dark", "Tmavý"], ["light", "Světlý"], ["auto", "Podle zařízení"]];
    return div({ className: "seg", role: "radiogroup", "aria-label": "Motiv" }, opts.map(([k, label]) =>
      button({ key: k, className: value === k ? "on" : "", role: "radio", "aria-checked": value === k, onClick: () => onChange(k) }, label)));
  }
  function Toggle({ on, onChange, label }) {
    return button({ className: "toggle" + (on ? " on" : ""), role: "switch", "aria-checked": on, "aria-label": label, onClick: () => onChange(!on) });
  }

  function RatingHero({ save }) {
    const hist = save.ratingHistory;
    const last = hist.length ? hist[hist.length - 1] : null;
    const shown = useCountUp(save.rating, 700);
    const prov = save.ratedGames < League.PROVISIONAL_GAMES;
    const spark = hist.length ? [hist[0].r - hist[0].delta].concat(hist.slice(-20).map((x) => x.r)) : null;
    const rec = save.record;
    return div({ className: "hero-card" },
      h("h1", null, "Šachové zápasy"),
      div({ className: "hero-main" },
        div(null,
          div({ className: "hero-rating" },
            span({ className: "hero-rating-num" }, shown),
            last && span({ className: "delta-chip " + (last.delta > 0 ? "up" : last.delta < 0 ? "down" : "flat") }, last.delta > 0 ? "▲" : last.delta < 0 ? "▼" : "•", " ", Math.abs(last.delta))),
          div({ className: "hero-rating-title" }, "📈 Rating · ", League.ratingTitle(save.rating))),
        spark && h(Sparkline, { points: spark })),
      div({ className: "hero-stats" },
        span(null, "✓ ", rec.w, " výher"), span(null, "= ", rec.d, " remíz"), span(null, "✕ ", rec.l, " proher"),
        save.peak > League.START_RATING && span(null, "🏆 rekord ", save.peak)),
      prov
        ? div({ className: "hero-calib" }, "Kalibrace ratingu: ", save.ratedGames, " / ", League.PROVISIONAL_GAMES, " hodnocených zápasů", div({ className: "progress-track" }, div({ className: "progress-fill", style: { width: (save.ratedGames / League.PROVISIONAL_GAMES) * 100 + "%" } })))
        : p({ className: "hero-tagline" }, "Probojuj se žebříčkem botů — čistě offline, jen ty a šachovnice."));
  }

  function SetupPicker({ save, colorChoice, setColorChoice, tc, setTc }) {
    const colorOpts = [["w", "♙ Bílými"], ["r", "🎲 Náhodně"], ["b", "♟ Černými"]];
    return div({ className: "setup-block" },
      div({ className: "chip-label" }, "Barva figur"),
      div({ className: "color-picker" }, colorOpts.map(([k, label]) =>
        button({ key: k, className: "color-chip" + (colorChoice === k ? " active" : ""), onClick: () => setColorChoice(k), "aria-pressed": colorChoice === k }, label))),
      div({ className: "chip-label" }, "Čas na partii"),
      div({ className: "color-picker" }, League.TIME_CONTROLS.map((t) =>
        button({ key: t.key, className: "color-chip sm" + (tc === t.key ? " active" : ""), onClick: () => setTc(t.key), "aria-pressed": tc === t.key }, t.key === "none" ? "∞ Bez limitu" : "⏱ " + t.short))));
  }

  function BotCards({ save, onStart }) {
    // doporučený soupeř = ten odemčený, jehož rating je nejblíž tomu tvému (a není o hodně slabší)
    let reco = 0, best = 1e9;
    BOTS.forEach((bt, idx) => {
      if (idx > save.unlockedIndex) return;
      const dist = Math.abs(bt.rating - (save.rating + 100));
      if (dist < best) { best = dist; reco = idx; }
    });
    return div({ className: "bot-list" }, BOTS.map((bot, idx) => {
      const locked = idx > save.unlockedIndex;
      const winCount = save.wins[bot.key] || 0;
      const chance = League.expectedScore(save.rating, bot.rating);
      const gain = League.ratingChange(save.rating, bot.rating, 1, save.ratedGames).delta;
      const loss = League.ratingChange(save.rating, bot.rating, 0, save.ratedGames).delta;
      return button({
        key: bot.key, className: "bot-card" + (locked ? " locked" : "") + (idx === reco && !locked ? " recommended" : ""), disabled: locked,
        onClick: () => { if (!locked) onStart(idx); }
      },
        h(BotAvatar, { bot, locked }),
        div({ className: "bot-info" },
          div({ className: "bot-name-row" },
            span({ className: "bot-name" }, bot.name),
            span({ className: "bot-rating" }, "≈ ", bot.rating),
            winCount > 0 && span({ className: "badge badge-green" }, "✓ ", winCount),
            idx === reco && !locked && span({ className: "reco-tag" }, "DOPORUČENÝ")),
          div({ className: "bot-blurb" }, bot.blurb),
          !locked && div({ className: "trait-chips" }, bot.traits.map((t) => span({ key: t, className: "trait-chip" }, t))),
          embedded && !locked && div({ className: "bot-coin" }, "🪙 Výhra: až ", Bots.COIN_REWARDS[bot.key], " Jomarid Coins"),
          locked
            ? span({ className: "bot-locked-note" }, "🔒 Poraz ", BOTS[idx - 1].name, " pro odemčení")
            : div({ className: "bot-meta" },
              span({ className: "bot-stars" }, "★".repeat(bot.stars), "☆".repeat(5 - bot.stars)),
              span({ className: "bot-chance" }, "Tvoje šance ", pct(chance), span({ className: "chance-bar" }, i({ style: { width: chance * 100 + "%" } }))),
              span({ className: "bot-delta", title: "Změna ratingu při výhře / prohře" }, span({ className: "up" }, "+", gain), " / ", span({ className: "down" }, "−", Math.abs(loss))))));
    }));
  }

  function BadgesCard({ save }) {
    const badges = League.getBadges(save);
    const got = badges.filter((x) => x.earned).length;
    return div(null,
      div({ className: "section-head" }, "Odznaky", small(null, got, " / ", badges.length)),
      div({ className: "badge-grid" }, badges.map((bd) => div({ key: bd.key, className: "badge-tile" + (bd.earned ? "" : " off"), title: bd.hint },
        div({ className: "ic" }, bd.icon), div({ className: "nm" }, bd.name), !bd.earned && div({ className: "hn" }, bd.hint)))));
  }

  function LadderCard({ save }) {
    const rows = BOTS.map((bt) => ({ bot: bt, rating: bt.rating })).concat([{ me: true, rating: save.rating }]).sort((a, c) => c.rating - a.rating);
    return div({ className: "ladder" }, rows.map((r) => {
      if (r.me) return div({ key: "me", className: "ladder-row me" }, div({ className: "ladder-you" }, "TY"), div({ className: "ladder-name" }, "Ty", small(null, League.ratingTitle(save.rating))), span({ className: "ladder-rating" }, save.rating));
      const st = save.botStats[r.bot.key];
      return div({ key: r.bot.key, className: "ladder-row" },
        h(BotAvatar, { bot: r.bot, small: true }),
        div({ className: "ladder-name" }, r.bot.name, small(null, st.w + st.d + st.l > 0 ? st.w + " výher · " + st.d + " remíz · " + st.l + " proher" : r.bot.role)),
        span({ className: "ladder-rating" }, r.rating));
    }));
  }

  function MenuScreen({ save, savedGame, onStart, onResume, onAbandon, onUpdate, onOpenReview, onResetProgress, theme, setTheme }) {
    const [colorChoice, setColorChoice] = useState(save.playerColor === "b" ? "b" : "w");
    const [tc, setTc] = useState(save.tc || "none");
    const [menuTab, setMenuTab] = useState("play");
    const navItems = [["play", "🏠", "Hrát"], ["league", "🛡️", "Liga"], ["quests", "🎯", "Výzvy"], ["settings", "⚙️", "Nastavení"]];
    const start = (idx) => {
      const color = colorChoice === "r" ? (Math.random() < 0.5 ? "w" : "b") : colorChoice;
      onStart(idx, color, tc, colorChoice);
    };
    const total = save.record.w + save.record.d + save.record.l;
    const resumeBot = savedGame ? BOTS[savedGame.botIdx] || BOTS[0] : null;

    return div({ className: "dashboard" },
      nav({ className: "side-nav" },
        div({ className: "brand" }, span({ className: "brand-mark" }, "♞"), span({ className: "brand-name" }, "Chess League")),
        navItems.map(([k, icon, label]) => button({ key: k, className: "nav-item" + (menuTab === k ? " active" : ""), onClick: () => setMenuTab(k) }, span({ className: "nav-icon" }, icon), span({ className: "nav-label" }, label)))),
      div({ className: "dash-shell" },
        div({ className: "dash-topbar" },
          div({ className: "stat-row" }, span({ className: "stat-pill" }, "🔥 ", save.streak), span({ className: "stat-pill" }, "⭐ ", save.xp, " XP"), span({ className: "stat-pill" }, "📈 ", save.rating)),
          div({ style: { display: "flex", gap: 8 } }, button({ className: "icon-btn", onClick: () => onUpdate({ sound: !save.sound }), "aria-label": "Přepnout zvuk" }, save.sound ? "🔊" : "🔇"))),

        menuTab === "play" && div({ className: "dash-body" },
          div({ className: "dash-main" },
            h(RatingHero, { save }),
            savedGame && div({ className: "resume-card" },
              h(BotAvatar, { bot: resumeBot, small: true }),
              div({ className: "resume-body" }, div({ className: "resume-title" }, "Rozehraná partie s ", resumeBot.name), div({ className: "resume-sub" }, Math.ceil(savedGame.moves.length / 2), ". tah · ", savedGame.color === "w" ? "bílými" : "černými", savedGame.assisted ? " · cvičná" : " · hodnocená")),
              div({ className: "resume-actions" }, button({ className: "btn btn-primary btn-sm", onClick: onResume }, "Pokračovat"), button({ className: "btn btn-ghost btn-sm", onClick: onAbandon }, "Vzdát"))),
            h(SetupPicker, { save, colorChoice, setColorChoice, tc, setTc }),
            h(BotCards, { save, onStart: start }),
            div({ className: "section-head" }, "Historie zápasů", total > 0 && small(null, save.record.w, "–", save.record.d, "–", save.record.l)),
            h(HistoryList, { recentGames: save.recentGames, onOpen: onOpenReview })),
          div({ className: "dash-rail" },
            h(LeagueCard, { xp: save.xp, compact: true, onViewFull: () => setMenuTab("league") }),
            h(QuestsCard, { save, compact: true, onViewAll: () => setMenuTab("quests") }))),

        menuTab === "league" && div({ className: "dash-body single" }, div({ className: "dash-main" },
          div({ className: "section-head" }, "Tvůj rating"),
          div({ className: "panel-card" },
            div({ className: "rating-big" }, span({ className: "num" }, save.rating), span({ className: "ttl" }, League.ratingTitle(save.rating))),
            save.ratedGames < League.PROVISIONAL_GAMES && div({ className: "rc-note" }, "Rating se ještě kalibruje (", save.ratedGames, "/", League.PROVISIONAL_GAMES, " hodnocených zápasů) a hýbe se rychleji."),
            div({ className: "chart-wrap" }, h(RatingChart, { save })),
            div({ className: "stat-grid" },
              div({ className: "stat-cell" }, b(null, save.peak), span(null, "Nejvyšší rating")),
              div({ className: "stat-cell" }, b(null, total ? Math.round(((save.record.w + save.record.d * 0.5) / total) * 100) + " %" : "–"), span(null, "Úspěšnost")),
              div({ className: "stat-cell" }, b(null, save.bestWinStreak), span(null, "Série výher")))),
          div({ className: "section-head" }, "Žebříček"),
          h(LadderCard, { save }),
          div({ className: "section-head" }, "Tvoje liga"),
          h(LeagueCard, { xp: save.xp }),
          h(BadgesCard, { save }))),

        menuTab === "quests" && div({ className: "dash-body single" }, div({ className: "dash-main" },
          div({ className: "section-head" }, "Dnešní výzvy"), h(QuestsCard, { save }))),

        menuTab === "settings" && div({ className: "dash-body single" }, div({ className: "dash-main" },
          div({ className: "section-head" }, "Nastavení"),
          div({ className: "panel-card settings-card" },
            div({ className: "settings-row" }, span(null, "Zvukové efekty"), h(Toggle, { on: save.sound, label: "Zvukové efekty", onChange: (v) => onUpdate({ sound: v }) })),
            div({ className: "settings-row" }, span(null, "Zvýrazňovat možné tahy", small(null, "Tečky na polích, kam může vybraná figura.")), h(Toggle, { on: save.highlights, label: "Zvýrazňovat možné tahy", onChange: (v) => onUpdate({ highlights: v }) })),
            div({ className: "settings-row" }, span(null, "Hlášky soupeřů", small(null, "Boti občas něco prohodí k průběhu partie.")), h(Toggle, { on: save.botChat, label: "Hlášky soupeřů", onChange: (v) => onUpdate({ botChat: v }) })),
            div({ className: "settings-row" }, span(null, "Automaticky povyšovat na dámu", small(null, "Bez ptaní, když pěšec dojde na konec desky.")), h(Toggle, { on: save.autoQueen, label: "Automaticky povyšovat na dámu", onChange: (v) => onUpdate({ autoQueen: v }) })),
            div({ className: "settings-row" }, span(null, "Motiv"), h(ThemeSeg, { value: theme, onChange: setTheme })),
            div({ className: "settings-row" }, span(null, "Resetovat postup", small(null, "Smaže XP, rating, sérii, výhry i odemčené soupeře.")), button({ className: "btn btn-danger btn-sm", onClick: onResetProgress }, "Resetovat")))))));
  }

  // ---------- Hra ----------
  function useTicker(active, ms) {
    const [, force] = useReducer((x) => x + 1, 0);
    useEffect(() => { if (!active) return; const id = setInterval(force, ms); return () => clearInterval(id); }, [active, ms]);
  }

  function PlayerStrip({ who, bot, name, rating, captured, glyphColor, advantage, time, active, low, turn }) {
    return div({ className: "player-strip" + (turn ? " turn" : "") },
      who === "bot" ? h(BotAvatar, { bot }) : div({ className: "bot-avatar you-avatar" }, "TY"),
      div({ className: "strip-info" },
        div({ className: "strip-name" }, name, small(null, rating)),
        div({ className: "strip-captured" }, h(CapturedRow, { pieces: captured, glyphColor, advantage }))),
      time != null && div({ className: "clock" + (active ? " active" : "") + (low ? " low" : "") }, fmtClock(time)));
  }

  function GameScreen({ session, save, soundOn, onToggleSound, onExit, onFinished, settings }) {
    const [, bump] = useReducer((x) => x + 1, 0);
    const [selected, setSelected] = useState(null);
    const [targets, setTargets] = useState([]);
    const [viewIdx, setViewIdx] = useState(null);
    const [promotion, setPromotion] = useState(null);
    const [flipped, setFlipped] = useState(session.playerColor === "b");
    const [dragFrom, setDragFrom] = useState(null);
    const [modal, setModal] = useState(null);
    const [bubble, setBubble] = useState(null);
    const [anim, setAnim] = useState(null);
    const [busy, setBusy] = useState(null); // "hint" | "draw"
    const [toast, setToast] = useState(null);
    const animNextRef = useRef(true);
    const settingsRef = useRef(settings); // obsluha událostí vzniká jen jednou, ale nastavení (zvuk) se může změnit
    settingsRef.current = settings;
    const bubbleTimer = useRef(null);

    // Přihlášení k odběru změn a událostí relace.
    useEffect(() => {
      session.onChange = () => bump();
      session.onEvent = (type, data) => {
        if (type === "move") {
          const m = data.move;
          if (settingsRef.current.sound) {
            if (data.rec.promotion) SoundFX.promote();
            else if (m.flag === "castleK" || m.flag === "castleQ") SoundFX.castle();
            else if (data.rec.capture) SoundFX.capture();
            else SoundFX.move();
            if (data.rec.check && !ChessEngine.isCheckmate(data.state)) setTimeout(() => SoundFX.check(), 120);
          }
          const moves = [{ from: m.from, to: m.to }];
          if (m.flag === "castleK") moves.push({ from: { r: m.from.r, c: 7 }, to: { r: m.from.r, c: 5 } });
          if (m.flag === "castleQ") moves.push({ from: { r: m.from.r, c: 0 }, to: { r: m.from.r, c: 3 } });
          setAnim(animNextRef.current || data.byBot ? { moves, key: session.moves.length } : null);
          animNextRef.current = true;
          setViewIdx(null);
        } else if (type === "say") {
          if (!settingsRef.current.chat) return;
          if (bubbleTimer.current) clearTimeout(bubbleTimer.current);
          setBubble({ text: data.text, out: false, key: Math.random() });
          bubbleTimer.current = setTimeout(() => {
            setBubble((bb) => bb && Object.assign({}, bb, { out: true }));
            bubbleTimer.current = setTimeout(() => setBubble(null), 320);
          }, 3300);
        } else if (type === "gameover") {
          if (settingsRef.current.sound) SoundFX[data.result === "win" ? "win" : data.result === "loss" ? "lose" : "draw"]();
        }
      };
      session.start();
      return () => { session.onChange = () => {}; session.onEvent = () => {}; if (bubbleTimer.current) clearTimeout(bubbleTimer.current); };
    }, [session]);

    // Hodiny: každých 200 ms překresli a zkontroluj, jestli někomu nedošel čas.
    useTicker(session.clock.on && !session.over, 200);
    useEffect(() => {
      if (!session.clock.on) return;
      const id = setInterval(() => session.tick(), 250);
      return () => clearInterval(id);
    }, [session]);

    // Po skončení partie chvíli počkej (ať je vidět poslední tah) a předej výsledek dál.
    const isOver = session.over;
    useEffect(() => {
      if (!isOver) return;
      const t = setTimeout(() => onFinished(), session.result.reason === "resign" ? 250 : 1100);
      return () => clearTimeout(t);
    }, [isOver]);

    // Pípání při nízkém čase hráče.
    const times = session.liveTimes();
    const playerTime = times ? times[session.playerColor] : null;
    const botTime = times ? times[session.botColor] : null;
    const lastTickRef = useRef(null);
    if (settings.sound && playerTime != null && session.clock.running === session.playerColor && playerTime < 10000 && !session.over) {
      const sec = Math.ceil(playerTime / 1000);
      if (lastTickRef.current !== sec) { lastTickRef.current = sec; SoundFX.tick(); }
    }

    const view = viewIdx == null ? session.state : session.states[viewIdx];
    const liveView = viewIdx == null;
    const lastMove = viewIdx == null ? session.state.lastMove : (viewIdx > 0 ? session.states[viewIdx].lastMove : null);
    const myTurn = session.isPlayerTurn && liveView && !promotion;
    const bot = session.bot;

    function clearSelection() { setSelected(null); setTargets([]); }

    function commitMove(move, byDrag) {
      animNextRef.current = !byDrag;
      clearSelection();
      setDragFrom(null);
      session.playerMove(move);
    }

    // Stisk na pole: vybere vlastní figuru (a ukáže její tahy), jinak zruší výběr.
    // was = figura už byla vybraná, takže ji prosté klepnutí (bez tažení) odvybere.
    function onPick(sq) {
      if (!myTurn) return { ok: false };
      const piece = session.state.board[sq.r][sq.c];
      if (piece && piece.color === session.playerColor) {
        const was = !!(selected && selected.r === sq.r && selected.c === sq.c);
        if (!was) {
          setSelected({ r: sq.r, c: sq.c });
          setTargets(session.legalFrom(sq.r, sq.c));
          if (settings.sound) SoundFX.click();
        }
        return { ok: true, was };
      }
      clearSelection();
      return { ok: false };
    }
    function onTapRelease(sq, was) { if (was) clearSelection(); }

    // Dokončení tahu na poli sq (z klepnutí nebo přetažení).
    function onDrop(sq, byDrag) {
      setDragFrom(null);
      if (!sq || !selected) return; // tažení mimo desku: výběr zůstává
      const variants = targets.filter((m) => m.to.r === sq.r && m.to.c === sq.c);
      if (variants.length === 0) { if (!byDrag) clearSelection(); return; }
      if (variants.length > 1 && variants[0].promotion) {
        if (settings.autoQueen) { commitMove(variants.find((v) => v.promotion === "q") || variants[0], byDrag); return; }
        animNextRef.current = !byDrag;
        setPromotion({ variants, byDrag });
        return;
      }
      commitMove(variants[0], byDrag);
    }

    function choosePromotion(t) {
      const v = promotion.variants.find((x) => x.promotion === t);
      const byDrag = promotion.byDrag;
      setPromotion(null);
      commitMove(v, byDrag);
    }

    function view_(idx) { setViewIdx(idx >= session.moves.length ? null : idx); clearSelection(); }

    async function doHint() {
      if (!session.isPlayerTurn || busy) return;
      setBusy("hint");
      const hres = await session.requestHint();
      setBusy(null);
      if (!hres) setToast("Nápovědu se teď nepodařilo spočítat.");
    }
    async function doDraw() {
      setModal(null);
      setBusy("draw");
      const res = await session.offerDraw();
      setBusy(null);
      if (res.verdict === "blocked") setToast("Remízu teď nabídnout nejde.");
      else if (res.verdict === "decline" || res.verdict === "early") setToast(bot.name + " remízu odmítl" + (bot.fem ? "a" : "") + ".");
    }
    useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 2600); return () => clearTimeout(t); }, [toast]);

    function handleBack() {
      if (session.over) { onFinished(); return; } // výsledek se musí zaznamenat i při dřívějším odchodu
      onExit(); // rozehraná partie se ukládá, takže se k ní jde vrátit z menu
    }

    // ---------- Vykreslení ----------
    const inCheckNow = !session.over && ChessEngine.isInCheck(session.state, session.state.turn);
    let turnText;
    if (session.over) turnText = "Konec hry";
    else if (!liveView) turnText = "Prohlížíš tah " + viewIdx + " z " + session.moves.length;
    else if (session.thinking) turnText = bot.name + " přemýšlí…";
    else if (session.state.turn === session.playerColor) turnText = "Jsi na tahu";
    else turnText = "Na tahu je " + bot.name;
    if (inCheckNow && liveView) turnText += " — Šach!";

    const capInfo = session.captured();
    const capturedByPlayer = session.playerColor === "w" ? capInfo.capturedByWhite : capInfo.capturedByBlack;
    const capturedByBot = session.botColor === "w" ? capInfo.capturedByWhite : capInfo.capturedByBlack;
    const advPlayer = session.playerColor === "w" ? capInfo.advantage : -capInfo.advantage;
    const lowTime = (t) => t != null && t < 20000;
    const showTargets = settings.highlights !== false;
    const hintArrow = session.hint && liveView ? [{ from: session.hint.from, to: session.hint.to, color: "#FFC800" }] : [];
    const opening = session.opening();
    const clockRunning = session.clock.running;
    const nonLive = !liveView;

    const topAnim = liveView ? anim : null;

    return div({ className: "screen" },
      promotion && h(PromotionModal, { color: session.playerColor, onChoose: choosePromotion, onCancel: () => { setPromotion(null); } }),
      modal === "resign" && h(ConfirmModal, { title: "Vzdát tuto hru?", text: session.moves.length > 1 ? "Zápas se počítá jako prohra." : "Zápas se počítá jako prohra.", confirmLabel: "Vzdát", danger: true, onConfirm: () => { setModal(null); session.resign(); }, onCancel: () => setModal(null) }),
      modal === "draw" && h(ConfirmModal, { title: "Nabídnout remízu?", text: bot.name + " se rozhodne podle pozice na šachovnici.", confirmLabel: "Nabídnout", onConfirm: doDraw, onCancel: () => setModal(null) }),
      toast && div({ className: "toast", role: "status" }, toast),
      div({ className: "topbar" },
        button({ className: "icon-btn", onClick: handleBack, "aria-label": "Zpět do menu" }, "←"),
        div({ className: "turn-banner" + (session.thinking ? " thinking" : "") + (session.over ? " over" : "") + (inCheckNow ? " check" : "") }, span({ className: "dot" }), span(null, turnText)),
        button({ className: "icon-btn", onClick: onToggleSound, "aria-label": "Přepnout zvuk" }, soundOn ? "🔊" : "🔇")),
      div({ className: "container" },
        div({ className: "game-layout" },
          div({ className: "board-col" },
            h(PlayerStrip, { who: "bot", bot, name: bot.name, rating: "≈ " + bot.rating, captured: capturedByBot, glyphColor: session.playerColor, advantage: -advPlayer, time: botTime, active: clockRunning === session.botColor, low: lowTime(botTime), turn: !session.over && session.state.turn === session.botColor }),
            bubble && div({ key: bubble.key, className: "bot-bubble" + (bubble.out ? " out" : ""), role: "status" }, bubble.text),
            h(Board, {
              state: view, flipped, selected: liveView ? selected : null, targets: liveView ? targets : [], lastMove, hint: session.hint && liveView ? session.hint : null, arrows: hintArrow, anim: topAnim,
              interactive: myTurn, showTargets, onPick, onTapRelease, onDrop, draggingFrom: dragFrom,
              onDragStart: (from) => { setDragFrom(from); }
            }),
            h(PlayerStrip, { who: "me", name: "Ty", rating: String(save.rating), captured: capturedByPlayer, glyphColor: session.botColor, advantage: advPlayer, time: playerTime, active: clockRunning === session.playerColor, low: lowTime(playerTime), turn: !session.over && session.state.turn === session.playerColor }),
            nonLive && div({ className: "view-banner" }, "Prohlížíš starší pozici — ", button({ className: "link-btn", onClick: () => view_(session.moves.length) }, "ZPĚT NA AKTUÁLNÍ")),
            div({ className: "board-controls" },
              button({ className: "btn btn-ghost btn-sm", onClick: () => { if (session.undo()) { clearSelection(); setAnim(null); } }, disabled: !session.canUndo || !liveView, "aria-label": "Vrátit tah" }, "↩", span({ className: "lbl" }, " Vrátit")),
              button({ className: "btn btn-ghost btn-sm", onClick: doHint, disabled: !myTurn || !!busy, "aria-label": "Nápověda" }, busy === "hint" ? "…" : "💡", span({ className: "lbl" }, " Nápověda")),
              button({ className: "btn btn-ghost btn-sm", onClick: () => setModal("draw"), disabled: !myTurn || !!busy || session.moves.length < 2, "aria-label": "Nabídnout remízu" }, busy === "draw" ? "…" : "🤝", span({ className: "lbl" }, " Remíza")),
              button({ className: "btn btn-ghost btn-sm btn-icon", onClick: () => setFlipped((f) => !f), "aria-label": "Otočit desku" }, "⇅"),
              button({ className: "btn btn-danger btn-sm", onClick: () => setModal("resign"), disabled: session.over, "aria-label": "Vzdát" }, "🏳", span({ className: "lbl" }, " Vzdát")))),
          div({ className: "side-panel" },
            div({ className: "panel-card" },
              div({ className: "panel-title" }, "Zahájení"),
              opening ? div({ className: "opening-name" }, opening) : div({ className: "opening-empty" }, session.playerColor === "w" ? "Zatím se nehrálo — táhni jako první!" : "Zatím se nehrálo."),
              div({ className: "mode-pill " + (session.rated ? "rated" : "practice") }, session.rated ? "🏅 Hodnocená partie" : "🎓 Cvičná partie"),
              div({ className: "mode-note" }, session.rated ? "Vrácení tahu a nápověda změní partii na cvičnou — rating se pak nezmění a nedostaneš Coiny." : "Použil jsi pomoc: rating se nezmění, XP je poloviční a bez Coinů.")),
            h(MoveListPanel, { moves: session.moves, viewIdx, onView: view_, showNav: true })))));
  }

  // ---------- Konec zápasu ----------
  const REASON_LABELS = {
    checkmate: "matem", resign: "vzdáním", stalemate: "patem", insufficient: "nedostatkem materiálu", fiftymove: "pravidlem 50 tahů",
    repetition: "trojím opakováním pozice", timeout: "časem", "timeout-material": "časem (soupeř nemá dost materiálu na mat)", agreement: "dohodou", botresign: "vzdáním soupeře"
  };

  function EndScreen({ info, bot, analysis, onContinue, onRematch, onReview }) {
    const canvasRef = useRef(null);
    const s = info.summary;
    const shown = useCountUp(s.ratingAfter, 900, s.ratingBefore);
    useEffect(() => {
      if (info.result === "win" && canvasRef.current) return Confetti.burst(canvasRef.current, 2600);
    }, []);
    const cfg = {
      win: { emoji: "🎉", title: "Vítězství!", sub: "Přehrál jsi " + bot.name + ". Skvělá hra!" },
      loss: { emoji: info.reason === "resign" ? "🏳️" : info.reason === "timeout" ? "⏱️" : "😅", title: info.reason === "resign" ? "Vzdáno" : info.reason === "timeout" ? "Došel čas" : "Tak blízko!", sub: bot.name + " tě tentokrát dostal" + (bot.fem ? "a" : "") + ". Chceš odvetu?" },
      draw: { emoji: "🤝", title: "Remíza", sub: "Vyrovnaný boj s " + bot.name + "." }
    }[info.result];
    const reason = REASON_LABELS[info.reason] || "";
    const deltaCls = s.delta > 0 ? "up" : s.delta < 0 ? "down" : "flat";
    const acc = analysis && analysis.done ? analysis.summary : null;
    const myC = info.color, botC = info.color === "w" ? "b" : "w";
    return div({ className: "end-screen" },
      info.result === "win" && canvasRef && h("canvas", { ref: canvasRef, className: "confetti-canvas" }),
      div({ className: "end-emoji" }, cfg.emoji),
      div({ className: "end-title" }, cfg.title),
      div({ className: "end-sub" }, cfg.sub, reason ? " (" + reason + ")" : ""),
      div({ className: "xp-card" },
        div({ className: "xp-card-title" }, "Rating"),
        s.rated
          ? div(null,
            div({ className: "rating-change" }, span({ className: "rc-num" }, shown), span({ className: "rc-delta " + deltaCls }, s.delta > 0 ? "▲ +" + s.delta : s.delta < 0 ? "▼ −" + Math.abs(s.delta) : "• ±0")),
            div({ className: "rc-note" }, "Před zápasem ", s.ratingBefore, " · očekávaná šance ", pct(s.expected), " · K ", s.k, s.provisional ? " · kalibrace " + Math.min(s.ratedGamesAfter, League.PROVISIONAL_GAMES) + "/" + League.PROVISIONAL_GAMES : ""),
            s.newPeak && div({ className: "badge-new" }, "🏆 Nový osobní rekord!"))
          : div({ className: "rc-note" }, "🎓 Cvičná partie (použil jsi vrácení tahu nebo nápovědu): rating zůstává ", s.ratingBefore, ".")),
      div({ className: "xp-card" },
        div({ className: "xp-row" }, span(null, "XP ze zápasu"), span({ className: "xp-total" }, "+", s.xpBase)),
        s.questBonus.map((q) => div({ key: q.key, className: "xp-row" }, span(null, q.icon, " Výzva: ", q.label), span({ className: "xp-total" }, "+", q.reward))),
        info.coinReward > 0 && embedded && div({ className: "xp-row" }, span(null, "🪙 Odměna za výhru (Jomarid Coins)"), span({ className: "xp-total" }, "až +", info.coinReward)),
        div({ className: "xp-row" }, span(null, "Série"), span(null, "🔥 ", s.streak)),
        s.newlyUnlocked && div({ className: "xp-row" }, span(null, "Nový soupeř"), span({ className: "xp-total" }, "Odemčen!")),
        s.promoted && div({ className: "xp-row" }, span(null, "Postup do ligy"), span({ className: "xp-total" }, s.tierAfter.icon, " ", s.tierAfter.name))),
      info.moves.length >= 4 && div({ className: "xp-card" },
        div({ className: "xp-card-title" }, "Rozbor partie"),
        acc
          ? div(null,
            div({ className: "acc-grid" },
              div({ className: "acc-cell" }, b(null, acc.acc[myC] == null ? "–" : Math.round(acc.acc[myC]) + " %"), span(null, "Tvoje přesnost")),
              div({ className: "acc-cell" }, b(null, acc.acc[botC] == null ? "–" : Math.round(acc.acc[botC]) + " %"), span(null, bot.name))),
            div({ className: "acc-counts" },
              [["blunder", "Hrubky"], ["mistake", "Chyby"], ["inaccuracy", "Nepřesnosti"]].map(([k, label]) => span({ key: k }, i({ className: "move-cat " + k }), label + ": " + acc.counts[myC][k]))))
          : analysis && analysis.failed
            ? div({ className: "rc-note" }, "Rozbor se nepodařilo spočítat. Partii si můžeš přesto projít tah po tahu.")
            : div(null, div({ className: "rc-note" }, "Počítám rozbor… ", analysis ? analysis.done_n + " / " + analysis.total : ""), div({ className: "progress-track review-progress" }, div({ className: "progress-fill", style: { width: (analysis && analysis.total ? (analysis.done_n / analysis.total) * 100 : 5) + "%" } })))),
      div({ className: "end-actions" },
        button({ className: "btn btn-ghost", onClick: onContinue }, "Menu"),
        button({ className: "btn btn-primary", onClick: onRematch }, "Odveta"),
        info.moves.length >= 2 && button({ className: "btn btn-secondary btn-wide", onClick: onReview }, "🔍 Rozbor partie")));
  }

  // ---------- Rozbor partie ----------
  function ReviewScreen({ review, analysisState, onBack }) {
    const { moves, color } = review; // moves: pole souřadnic
    const [idx, setIdx] = useState(0);
    const built = useMemo(() => {
      const states = [ChessEngine.initialState()], recs = [];
      for (const coord of moves) {
        const before = states[states.length - 1];
        const m = findMoveByCoord(before, coord);
        if (!m) break;
        const all = ChessEngine.generateAllLegalMoves(before, before.turn);
        const after = ChessEngine.applyMove(before, m);
        recs.push({ coord, san: toSAN(m, all, after), color: m.piece.color, from: m.from, to: m.to });
        states.push(after);
      }
      return { states, recs };
    }, [moves]);
    const { states, recs } = built;
    const sum = analysisState && analysisState.summary;
    const cats = sum ? sum.perPly : null;
    useEffect(() => {
      const onKey = (e) => {
        if (e.key === "ArrowLeft") setIdx((v) => Math.max(0, v - 1));
        else if (e.key === "ArrowRight") setIdx((v) => Math.min(recs.length, v + 1));
      };
      window.addEventListener("keydown", onKey);
      return () => window.removeEventListener("keydown", onKey);
    }, [recs.length]);
    const state = states[idx];
    const lastMove = idx > 0 ? state.lastMove : null;
    const info = idx > 0 && cats ? cats[idx - 1] : null;
    const arrows = [];
    if (info && info.best && info.cat !== "best") {
      const bm = findMoveByCoord(states[idx - 1], info.best);
      if (bm) arrows.push({ from: bm.from, to: bm.to, color: "#58CC02" });
    }
    let bestSan = null;
    if (info && info.best && info.cat !== "best") {
      const before = states[idx - 1];
      const bm = findMoveByCoord(before, info.best);
      if (bm) { const all = ChessEngine.generateAllLegalMoves(before, before.turn); bestSan = toSAN(bm, all, ChessEngine.applyMove(before, bm)); }
    }
    const flipped = color === "b";
    const bot = review.botKey ? botByKey(review.botKey) : null;
    return div({ className: "screen" },
      div({ className: "topbar" },
        button({ className: "icon-btn", onClick: onBack, "aria-label": "Zpět" }, "←"),
        div({ className: "turn-banner" }, span({ className: "dot" }), span(null, "Rozbor", bot ? ": " + bot.name : " partie")),
        span({ style: { width: 42 } })),
      div({ className: "container" },
        div({ className: "game-layout" },
          div({ className: "board-col" },
            h(Board, { state, flipped, selected: null, targets: [], lastMove, arrows, interactive: false, showTargets: false, anim: null, onPick: () => ({ ok: false }), onTapRelease: () => {}, onDrop: () => {}, draggingFrom: null, onDragStart: () => {} }),
            div({ className: "board-controls" },
              [["⏮", 0], ["◀", Math.max(0, idx - 1)], ["▶", Math.min(recs.length, idx + 1)], ["⏭", recs.length]].map(([label, to], k) =>
                button({ key: k, className: "btn btn-ghost btn-sm", onClick: () => setIdx(to), disabled: to === idx }, label)))),
          div({ className: "side-panel" },
            sum && div({ className: "panel-card" },
              div({ className: "panel-title" }, "Průběh partie"),
              h(EvalGraph, { graph: sum.graph, cursor: idx, onPick: setIdx })),
            div({ className: "panel-card review-info" },
              idx === 0 ? "Vyber tah v seznamu nebo se posouvej šipkami."
                : div(null,
                  b(null, Math.ceil(idx / 2) + (recs[idx - 1].color === "w" ? ". " : "... "), recs[idx - 1].san), " ",
                  info && span({ className: "cat-chip" }, i({ className: "move-cat " + info.cat }), League.CATEGORY_LABELS[info.cat]),
                  bestSan && div({ style: { marginTop: 6 } }, "Lepší byl ", b(null, bestSan), ".")),
              !sum && analysisState && !analysisState.failed && div({ className: "rc-note" }, "Počítám rozbor… ", analysisState.done_n || 0, " / ", analysisState.total || "?")),
            h(MoveListPanel, { moves: recs, viewIdx: idx, onView: setIdx, cats, title: "Tahy", showNav: false })))));
  }

  // ---------- Aplikace ----------
  class ErrorBoundary extends React.Component {
    constructor(props) { super(props); this.state = { hasError: false }; }
    static getDerivedStateFromError() { return { hasError: true }; }
    componentDidCatch(err, info) { console.error("Chess app error:", err, info); }
    render() {
      if (this.state.hasError) {
        return div({ style: { padding: 40, textAlign: "center" } },
          div({ style: { fontSize: 40, marginBottom: 10 } }, "♟️💥"),
          div({ style: { fontFamily: "var(--font-display)", fontWeight: 700, fontSize: 20, marginBottom: 8 } }, "Něco se pokazilo"),
          div({ style: { color: "var(--ink-soft)", marginBottom: 16 } }, "Zkus stránku znovu načíst. Rozehraná partie se ukládá."),
          button({ className: "btn btn-primary", onClick: () => window.location.reload() }, "Načíst znovu"));
      }
      return this.props.children;
    }
  }

  function applyTheme(theme) {
    const root = document.documentElement;
    let eff = theme;
    if (theme === "auto") eff = window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
    if (eff === "light") root.setAttribute("data-theme", "light"); else root.removeAttribute("data-theme");
    root.style.colorScheme = eff === "light" ? "light" : "dark";
  }

  function App() {
    const storage = window.localStorage;
    const [save, setSave] = useState(() => League.loadSave(storage, BOT_RATINGS));
    const [savedGame, setSavedGame] = useState(() => League.loadGame(storage));
    const [view, setView] = useState("menu");
    const [session, setSession] = useState(null);
    const [endInfo, setEndInfo] = useState(null);
    const [analysis, setAnalysis] = useState(null);
    const [reviewData, setReviewData] = useState(null);
    const [confirm, setConfirm] = useState(null);
    const saveRef = useRef(save);
    saveRef.current = save;
    const aiRef = useRef(null);
    const analysisAiRef = useRef(null);
    const analysisToken = useRef(0);
    const processedRef = useRef(null);
    if (!aiRef.current) aiRef.current = createAIClient();

    const theme = save.theme || "dark";
    useEffect(() => {
      applyTheme(theme);
      if (theme !== "auto" || !window.matchMedia) return;
      const mq = window.matchMedia("(prefers-color-scheme: light)");
      const fn = () => applyTheme("auto");
      if (mq.addEventListener) mq.addEventListener("change", fn);
      return () => { if (mq.removeEventListener) mq.removeEventListener("change", fn); };
    }, [theme]);

    function updateSave(patch) {
      setSave((prev) => { const next = Object.assign({}, prev, patch); League.persistSave(storage, next); return next; });
    }
    function setSaveFull(next) { League.persistSave(storage, next); setSave(next); }
    function stopAnalysis() {
      analysisToken.current++;
      if (analysisAiRef.current) { analysisAiRef.current.destroy(); analysisAiRef.current = null; }
    }

    // ---------- Nová / obnovená partie ----------
    function makeSession(botIdx, color, tc, saved) {
      const sess = new GameSession({
        bot: BOTS[botIdx], botIdx, playerColor: color, tcKey: tc, ai: aiRef.current, chat: saveRef.current.botChat !== false,
        // rozehraná partie se ukládá po každé změně, ale až když táhly obě strany (jinak není co obnovovat)
        onPersist: (sess_) => {
          if (sess_.over) return;
          if (sess_.moves.length >= 2) League.persistGame(storage, sess_.serialize());
        }
      });
      if (saved) sess.restore(saved);
      return sess;
    }
    function launch(sess) {
      stopAnalysis();
      processedRef.current = null;
      setSession(sess); setEndInfo(null); setAnalysis(null); setView("game");
    }
    function reallyStart(botIdx, color, tc, colorChoice) {
      updateSave({ playerColor: colorChoice === "r" ? saveRef.current.playerColor : color, tc });
      League.persistGame(storage, null); setSavedGame(null);
      aiRef.current.newGame();
      launch(makeSession(botIdx, color, tc, null));
    }
    function startGame(botIdx, color, tc, colorChoice) {
      if (savedGame) { setConfirm({ start: { botIdx, color, tc, colorChoice } }); return; }
      reallyStart(botIdx, color, tc, colorChoice);
    }
    function resumeGame() {
      if (!savedGame) return;
      aiRef.current.newGame();
      launch(makeSession(savedGame.botIdx, savedGame.color, savedGame.tc, savedGame));
    }
    // Vzdání rozehrané partie z menu = prohra.
    function doAbandon() {
      const saved = savedGame;
      League.persistGame(storage, null); setSavedGame(null);
      if (!saved) return;
      const r = League.finishGame(saveRef.current, { botIdx: saved.botIdx, result: "loss", reason: "resign", color: saved.color, plies: saved.moves.length, tc: saved.tc, rated: !saved.assisted, moves: saved.moves }, BOT_LIST, todayStr(), yesterdayStr());
      setSaveFull(r.save);
    }

    // ---------- Konec partie ----------
    function onFinished() {
      const sess = session;
      if (!sess || !sess.result || processedRef.current === sess) return;
      processedRef.current = sess;
      const { result, reason } = sess.result;
      const botIdx = sess.botIdx, rated = sess.rated, coords = sess.coords();
      const r = League.finishGame(saveRef.current, { botIdx, result, reason, color: sess.playerColor, plies: coords.length, tc: sess.tcKey, rated, moves: coords }, BOT_LIST, todayStr(), yesterdayStr());
      setSaveFull(r.save);
      League.persistGame(storage, null); setSavedGame(null);
      // Odměna v Coinech jen za výhru v hodnocené partii; o skutečné částce rozhoduje server (denní strop).
      const coinReward = result === "win" && rated ? Bots.COIN_REWARDS[BOTS[botIdx].key] || 0 : 0;
      if (coinReward > 0 && typeof jomaridReward === "function") jomaridReward("chess_win_" + BOTS[botIdx].key, coinReward, true);
      if (r.summary.promoted && r.save.sound) setTimeout(() => SoundFX.level(), 600);
      setEndInfo({ result, reason, summary: r.summary, coinReward, botIdx, color: sess.playerColor, moves: coords, tcKey: sess.tcKey });
      setView("end");
      runAnalysis(coords, sess.playerColor, true);
      sess.destroy();
    }

    // Rozbor partie běží v samostatném workeru, ať neblokuje odvetu ani hru.
    function runAnalysis(coords, color, attachAccuracy) {
      stopAnalysis();
      const token = analysisToken.current;
      if (coords.length < 4) { setAnalysis(null); return; }
      analysisAiRef.current = createAIClient();
      setAnalysis({ done: false, done_n: 0, total: coords.length + 1 });
      analysisAiRef.current.analyze({ moves: coords }, (msg) => {
        if (token === analysisToken.current) setAnalysis((a) => (a && !a.done ? Object.assign({}, a, { done_n: msg.done, total: msg.total }) : a));
      }).then((res) => {
        if (token !== analysisToken.current) return;
        if (!res || !res.scores) { setAnalysis({ done: false, failed: true }); return; }
        const summary = League.summarizeAnalysis(res.scores, coords);
        setAnalysis({ done: true, summary });
        const mine = summary.acc[color];
        if (attachAccuracy && mine != null) {
          const cur = saveRef.current;
          if (cur.recentGames.length && cur.recentGames[0].moves === coords.join(" ")) {
            const copy = JSON.parse(JSON.stringify(cur));
            copy.recentGames[0].acc = Math.round(mine);
            setSaveFull(copy);
          }
        }
      });
    }
    function openReview(game, from) {
      const moves = (typeof game.moves === "string" ? game.moves.split(" ") : game.moves).filter(Boolean);
      setReviewData({ moves, color: game.color || "w", botKey: game.botKey, from });
      setView("review");
      if (from === "menu") runAnalysis(moves, game.color || "w", false);
    }

    // ---------- Navigace ----------
    function leaveGame() {
      // Zpět do menu; nedokončená partie zůstává uložená a nabídne se k pokračování.
      if (session && !session.over && session.moves.length >= 2) { const ser = session.serialize(); League.persistGame(storage, ser); setSavedGame(ser); }
      if (session) session.destroy();
      setSession(null); setView("menu");
    }
    function toMenu() { stopAnalysis(); setView("menu"); setSession(null); }
    function rematch() {
      if (!endInfo) return;
      reallyStart(endInfo.botIdx, endInfo.color, endInfo.tcKey, endInfo.color);
    }
    function doReset() {
      stopAnalysis();
      League.persistGame(storage, null); setSavedGame(null);
      setSaveFull(League.defaultSave());
    }

    useEffect(() => () => { if (aiRef.current) aiRef.current.destroy(); if (analysisAiRef.current) analysisAiRef.current.destroy(); }, []);

    const settings = { sound: save.sound, highlights: save.highlights, chat: save.botChat !== false, autoQueen: !!save.autoQueen };
    let content;
    if (view === "menu") {
      content = h(MenuScreen, { save, savedGame, onStart: startGame, onResume: resumeGame, onAbandon: () => setConfirm({ abandon: true }), onUpdate: updateSave, onOpenReview: (g) => openReview(g, "menu"), onResetProgress: () => setConfirm({ reset: true }), theme, setTheme: (t) => updateSave({ theme: t }) });
    } else if (view === "game" && session) {
      content = h(GameScreen, { key: session.startedAt + "-" + session.botIdx, session, save, soundOn: save.sound, onToggleSound: () => updateSave({ sound: !save.sound }), onExit: leaveGame, onFinished, settings });
    } else if (view === "end" && endInfo) {
      content = h(EndScreen, { info: endInfo, bot: BOTS[endInfo.botIdx], analysis, onContinue: toMenu, onRematch: rematch, onReview: () => openReview({ moves: endInfo.moves, color: endInfo.color, botKey: BOTS[endInfo.botIdx].key }, "end") });
    } else if (view === "review" && reviewData) {
      content = h(ReviewScreen, { review: reviewData, analysisState: analysis, onBack: () => { if (reviewData.from === "end" && endInfo) setView("end"); else toMenu(); } });
    }
    return div({ className: "app-shell" },
      content,
      confirm && confirm.abandon && h(ConfirmModal, { title: "Vzdát rozehranou partii?", text: "Zápas se započítá jako prohra.", confirmLabel: "Vzdát", danger: true, onConfirm: () => { setConfirm(null); doAbandon(); }, onCancel: () => setConfirm(null) }),
      confirm && confirm.reset && h(ConfirmModal, { title: "Resetovat veškerý postup?", text: "Smaže se XP, rating, série, výhry i odemčení soupeři. Tohle nejde vrátit.", confirmLabel: "Resetovat", danger: true, onConfirm: () => { setConfirm(null); doReset(); }, onCancel: () => setConfirm(null) }),
      confirm && confirm.start && h(ConfirmModal, { title: "Máš rozehranou partii", text: "Když začneš novou, rozehraná partie se započítá jako prohra.", confirmLabel: "Začít novou", danger: true, onConfirm: () => { const c = confirm.start; setConfirm(null); doAbandon(); reallyStart(c.botIdx, c.color, c.tc, c.colorChoice); }, onCancel: () => setConfirm(null) }));
  }

  function ChessLeague() {
    return h(React.Fragment, null, h(ErrorBoundary, null, h(App, null)));
  }
  ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(ChessLeague));
})();
