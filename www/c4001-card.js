(() => {
  'use strict';

  const BG      = '#07080d';
  const CYAN    = '#00e0ff';
  const RED     = '#ff2b4e';
  const GREEN   = '#00ffb4';
  const ORANGE  = '#ff6b2b';
  const AMBER   = '#ffb347';
  const DIM     = '#1a2a3a';
  const DIMTXT  = '#3a5a7a';
  const FONT    = "'Courier New',Courier,monospace";
  const MAX_M   = 25;
  const HALF_DEG = 50;
  const TRAIL_MS = 30000;
  const RING_FT  = [16, 33, 49, 66, 82];
  const RING_M   = [4.877, 10.058, 14.935, 20.117, 24.994];

  function toFt(m) { return m * 3.28084; }

  function abbrev(v) {
    if (v >= 1e6) return (v / 1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
    return Math.round(v).toString();
  }

  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
  }

  const CSS = `
:host{display:block;background:${BG};border-radius:8px;overflow:hidden;border:1px solid ${DIM}}
#wrap{display:flex;flex-direction:column;background:${BG}}
canvas{display:block}
#stats{display:flex;border-top:1px solid ${DIM}}
.st{flex:1;padding:8px 4px 7px;text-align:center;border-right:1px solid ${DIM};min-width:0}
.st:last-child{border-right:none}
.sl{font-size:9px;color:${DIMTXT};letter-spacing:2px;margin-bottom:2px;font-family:${FONT}}
.sv{font-size:20px;font-weight:700;line-height:1.15;font-family:${FONT};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${CYAN}}
.ss{font-size:10px;color:${DIMTXT};margin-top:1px;font-family:${FONT}}
.sd{font-size:9px;letter-spacing:1.5px;margin-top:3px;font-family:${FONT};color:${DIMTXT}}
.bw{height:4px;background:${DIM};border-radius:2px;margin:4px 8px 0}
.bf{height:100%;border-radius:2px;width:0%;background:${CYAN};transition:width .4s}
#sb{display:flex;align-items:center;padding:5px 8px;border-top:1px solid ${DIM};gap:7px}
#badge{font-size:10px;font-weight:700;letter-spacing:3px;padding:2px 8px;border:1px solid ${DIMTXT};color:${DIMTXT};border-radius:3px;font-family:${FONT};flex-shrink:0}
#ftr{flex:1;font-size:9px;color:${DIMTXT};letter-spacing:1px;font-family:${FONT};overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dw{display:flex;align-items:center;gap:3px;font-size:8px;letter-spacing:1px;font-family:${FONT};color:${DIMTXT};flex-shrink:0}
.dot{width:7px;height:7px;border-radius:50%;display:inline-block;flex-shrink:0;background:${DIMTXT}}
`;

  const HTML = `
<style>${CSS}</style>
<div id="wrap">
  <canvas id="c"></canvas>
  <div id="stats">
    <div class="st">
      <div class="sl">DISTANCE</div>
      <div class="sv" id="dft">--</div>
      <div class="ss" id="dm">-- m</div>
    </div>
    <div class="st">
      <div class="sl">VELOCITY</div>
      <div class="sv" id="sv">--</div>
      <div class="ss" id="su">mph</div>
      <div class="sd" id="sl2">STANDBY</div>
    </div>
    <div class="st">
      <div class="sl">SIGNAL</div>
      <div class="sv" id="ev">--</div>
      <div class="bw"><div class="bf" id="eb"></div></div>
      <div class="sd" id="el">WEAK</div>
    </div>
  </div>
  <div id="sb">
    <div id="badge">STBY</div>
    <div id="ftr">SYS // STANDBY</div>
    <div class="dw"><span class="dot" id="du"></span>UART</div>
    <div class="dw"><span class="dot" id="dg"></span>GPIO</div>
  </div>
</div>`;

  class C4001Card extends HTMLElement {
    constructor() {
      super();
      this._cfg = null;
      this._hass = null;
      this._canvas = null;
      this._ctx = null;
      this._raf = null;
      this._rafCb = null;
      this._iv = null;
      this._ro = null;
      this._lastTs = 0;
      // canvas layout
      this._cw = 0;
      this._ch = 0;
      this._ax = 0;   // apex x
      this._ay = 0;   // apex y
      this._cH = 0;   // cone height in px
      // animation
      this._sw = Math.PI / 2 - HALF_DEG * Math.PI / 180; // sweep angle
      this._swd = 1;  // sweep direction
      this._ph = 0;   // pulse phase
      // sensor state
      this._dm = null;
      this._smph = 0;
      this._sms = 0;
      this._en = 0;
      this._det = false;
      this._occ = false;
      this._trail = [];
    }

    setConfig(cfg) {
      this._cfg = Object.assign({
        entity_distance:  'sensor.beam_target_distance',
        entity_speed:     'sensor.beam_target_speed_mph',
        entity_speed_ms:  'sensor.beam_target_speed',
        entity_energy:    'sensor.beam_target_energy',
        entity_detected:  'binary_sensor.beam_target_detected',
        entity_occupancy: 'binary_sensor.beam_occupancy',
      }, cfg);
    }

    set hass(h) { this._hass = h; }
    get hass()  { return this._hass; }
    getCardSize() { return 8; }

    connectedCallback() {
      if (this.shadowRoot) return;
      const sr = this.attachShadow({ mode: 'open' });
      sr.innerHTML = HTML;
      this._canvas = sr.getElementById('c');
      this._ctx = this._canvas.getContext('2d');

      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(sr.getElementById('wrap'));

      this._iv = setInterval(() => this._poll(), 500);
      this._rafCb = (ts) => {
        this._raf = requestAnimationFrame(this._rafCb);
        this._frame(ts);
      };
      this._raf = requestAnimationFrame(this._rafCb);
    }

    disconnectedCallback() {
      clearInterval(this._iv);
      cancelAnimationFrame(this._raf);
      if (this._ro) this._ro.disconnect();
    }

    _resize() {
      const wrap = this.shadowRoot.getElementById('wrap');
      const w = Math.round(wrap.clientWidth) || 300;
      const h = Math.round(w * 1.1);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this._canvas.width  = Math.round(w * dpr);
      this._canvas.height = Math.round(h * dpr);
      this._canvas.style.width  = w + 'px';
      this._canvas.style.height = h + 'px';
      this._ctx.scale(dpr, dpr);
      this._cw = w;
      this._ch = h;
      this._ax = w / 2;
      this._ay = Math.round(h * 0.08);
      this._cH = h - this._ay - Math.round(h * 0.03);
    }

    _poll() {
      if (!this._hass || !this._cfg) return;
      const s = this._hass.states;
      const g = (k) => s[this._cfg[k]];

      const rawDist = parseFloat(g('entity_distance')?.state);
      this._dm   = isFinite(rawDist) && rawDist > 0 ? rawDist : null;
      this._smph = parseFloat(g('entity_speed')?.state)    || 0;
      this._sms  = parseFloat(g('entity_speed_ms')?.state) || 0;
      this._en   = parseFloat(g('entity_energy')?.state)   || 0;
      this._det  = g('entity_detected')?.state  === 'on';
      this._occ  = g('entity_occupancy')?.state === 'on';

      const now = Date.now();
      if (this._det && this._dm !== null) {
        this._trail.push({ d: this._dm, v: this._sms, t: now });
      }
      const cut = now - TRAIL_MS;
      let i = 0;
      while (i < this._trail.length && this._trail[i].t < cut) i++;
      if (i > 0) this._trail.splice(0, i);
      if (this._trail.length > 500) this._trail.splice(0, this._trail.length - 500);

      this._dom();
    }

    _dom() {
      const sr = this.shadowRoot;
      const { _dm: dm, _smph: sm, _en: en, _det: det, _occ: occ } = this;

      // distance
      if (dm !== null) {
        sr.getElementById('dft').textContent = toFt(dm).toFixed(1) + ' ft';
        sr.getElementById('dft').style.color = CYAN;
        sr.getElementById('dm').textContent   = dm.toFixed(2) + ' m';
      } else {
        sr.getElementById('dft').textContent = '--';
        sr.getElementById('dft').style.color = DIMTXT;
        sr.getElementById('dm').textContent  = '-- m';
      }

      // speed
      let sc = CYAN, sym = '●', lbl = 'STATIONARY';
      if (sm < -0.5)    { sc = RED;    sym = '▼'; lbl = 'APPROACHING'; }
      else if (sm > 0.5){ sc = GREEN;  sym = '▲'; lbl = 'RECEDING'; }
      sr.getElementById('sv').style.color  = sc;
      sr.getElementById('sv').textContent  = sym + ' ' + Math.abs(sm).toFixed(1);
      sr.getElementById('sl2').textContent = lbl;
      sr.getElementById('sl2').style.color = sc;

      // energy
      const ep = Math.min(100, (en / 4e6) * 100);
      let ec = DIMTXT, el = 'WEAK';
      if (en > 2e6)      { ec = RED;   el = 'STRONG'; }
      else if (en > 3e5) { ec = CYAN;  el = 'NOMINAL'; }
      else if (en > 5e4) { ec = GREEN; el = 'NOMINAL'; }
      sr.getElementById('ev').textContent         = abbrev(en);
      sr.getElementById('ev').style.color         = ec;
      sr.getElementById('eb').style.width         = ep.toFixed(1) + '%';
      sr.getElementById('eb').style.background    = ec;
      sr.getElementById('el').textContent         = el;
      sr.getElementById('el').style.color         = ec;

      // badge
      let badge = 'STBY', footer = 'SYS // STANDBY', bc = DIMTXT;
      if (det && occ)  { badge = 'TRK';  footer = 'TARGET LOCKED // TRACKING';  bc = RED; }
      else if (det)    { badge = 'ACQ';  footer = 'ACQUISITION // TRACKING';    bc = CYAN; }
      else if (occ)    { badge = 'HOLD'; footer = 'HOLD // PRESENCE DETECTED';  bc = AMBER; }
      const bdg = sr.getElementById('badge');
      bdg.textContent        = badge;
      bdg.style.borderColor  = bc;
      bdg.style.color        = bc;
      sr.getElementById('ftr').textContent = footer;

      // dots
      sr.getElementById('du').style.background = det ? CYAN  : DIMTXT;
      sr.getElementById('dg').style.background = occ ? AMBER : DIMTXT;
    }

    _frame(ts) {
      if (!this._cw) { this._resize(); if (!this._cw) return; }
      const dt = Math.min((ts - (this._lastTs || ts)), 80);
      this._lastTs = ts;

      const halfRad = HALF_DEG * Math.PI / 180;
      const swMin = Math.PI / 2 - halfRad;
      const swMax = Math.PI / 2 + halfRad;
      const spd = this._det ? 0.055 : 0.020;
      this._sw += this._swd * spd * (dt / 16.67);
      if (this._sw >= swMax) { this._sw = swMax; this._swd = -1; }
      if (this._sw <= swMin) { this._sw = swMin; this._swd =  1; }

      this._ph = (this._ph + 0.016 * (dt / 16.67)) % 1;

      this._draw();
    }

    _ry(m) {
      return this._ay + (Math.min(Math.max(m, 0), MAX_M) / MAX_M) * this._cH;
    }

    _conePath(ctx) {
      const tan = Math.tan(HALF_DEG * Math.PI / 180);
      const botY = this._ay + this._cH;
      ctx.beginPath();
      ctx.moveTo(this._ax, this._ay);
      ctx.lineTo(this._ax - this._cH * tan, botY);
      ctx.lineTo(this._ax + this._cH * tan, botY);
      ctx.closePath();
    }

    _draw() {
      const ctx = this._ctx;
      const W = this._cw, H = this._ch;
      const ax = this._ax, ay = this._ay, cH = this._cH;
      const halfRad = HALF_DEG * Math.PI / 180;
      const tan = Math.tan(halfRad);
      const botY = ay + cH;
      const botL = ax - cH * tan;
      const botR = ax + cH * tan;

      // background
      ctx.fillStyle = BG;
      ctx.fillRect(0, 0, W, H);

      // --- cone ambient fill ---
      ctx.save();
      this._conePath(ctx);
      ctx.clip();
      const g0 = ctx.createLinearGradient(ax, ay, ax, botY);
      g0.addColorStop(0,   'rgba(0,224,255,0.08)');
      g0.addColorStop(0.5, 'rgba(0,224,255,0.03)');
      g0.addColorStop(1,   'rgba(0,224,255,0.01)');
      ctx.fillStyle = g0;
      ctx.fillRect(0, ay, W, H - ay);
      ctx.restore();

      // --- range rings ---
      ctx.save();
      ctx.setLineDash([3, 8]);
      ctx.lineWidth = 1;
      const fs0 = Math.max(8, Math.round(W * 0.026));
      ctx.font = `${fs0}px ${FONT}`;
      RING_M.forEach((rm, i) => {
        const ry = this._ry(rm);
        const hw = (ry - ay) * tan;
        ctx.strokeStyle = 'rgba(0,224,255,0.20)';
        ctx.beginPath();
        ctx.moveTo(ax - hw, ry);
        ctx.lineTo(ax + hw, ry);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(0,224,255,0.45)';
        ctx.textAlign = 'left';
        ctx.fillText(RING_FT[i] + 'ft', ax + hw + 4, ry + 3);
        ctx.setLineDash([3, 8]);
      });
      ctx.setLineDash([]);
      ctx.restore();

      // --- trail dots ---
      const now = Date.now();
      ctx.save();
      this._conePath(ctx);
      ctx.clip();
      for (let i = 0; i < this._trail.length; i++) {
        const pt = this._trail[i];
        const age = now - pt.t;
        if (age > TRAIL_MS) continue;
        const alpha = (1 - age / TRAIL_MS) * 0.85;
        let col;
        if (pt.v < -1)         col = RED;
        else if (pt.v < -0.15) col = ORANGE;
        else if (pt.v > 0.15)  col = GREEN;
        else                   col = CYAN;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(ax, this._ry(pt.d), 3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();

      // --- sweep line ---
      ctx.save();
      this._conePath(ctx);
      ctx.clip();
      const swLen = cH * 2.5;
      const sx = ax + swLen * Math.cos(this._sw);
      const sy = ay + swLen * Math.sin(this._sw);
      const sg = ctx.createLinearGradient(ax, ay, sx, sy);
      sg.addColorStop(0,   'rgba(0,224,255,0.9)');
      sg.addColorStop(0.25,'rgba(0,224,255,0.4)');
      sg.addColorStop(1,   'rgba(0,224,255,0)');
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(sx, sy);
      ctx.strokeStyle = sg;
      ctx.lineWidth = this._det ? 2.5 : 1.5;
      ctx.shadowColor = CYAN;
      ctx.shadowBlur  = this._det ? 12 : 5;
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.restore();

      // --- CRT centerline glow ---
      ctx.save();
      const glows = [[18, 0.025], [10, 0.05], [4, 0.12], [1, 0.30]];
      for (const [lw, op] of glows) {
        ctx.beginPath();
        ctx.moveTo(ax, ay);
        ctx.lineTo(ax, botY);
        ctx.strokeStyle = `rgba(0,224,255,${op})`;
        ctx.lineWidth = lw;
        ctx.stroke();
      }
      ctx.restore();

      // --- cone edges ---
      ctx.save();
      ctx.strokeStyle = 'rgba(0,224,255,0.40)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(ax, ay); ctx.lineTo(botL, botY);
      ctx.moveTo(ax, ay); ctx.lineTo(botR, botY);
      ctx.stroke();
      ctx.restore();

      // --- live target ---
      const dm = this._dm;
      if (this._det && dm !== null) {
        const ty  = this._ry(dm);
        const dy  = ty - ay;
        const hw  = dy * tan;
        const arcR = dy;

        // full-width arc at distance
        ctx.save();
        this._conePath(ctx);
        ctx.clip();
        ctx.beginPath();
        ctx.arc(ax, ay, arcR, Math.PI / 2 - halfRad, Math.PI / 2 + halfRad);
        ctx.strokeStyle = 'rgba(0,224,255,0.80)';
        ctx.lineWidth = 1.5;
        ctx.shadowColor = CYAN;
        ctx.shadowBlur  = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();

        // pulse ring
        const pr = Math.max(8, hw * 0.15 + hw * 0.35 * this._ph);
        ctx.save();
        ctx.beginPath();
        ctx.arc(ax, ty, pr, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(0,224,255,${(1 - this._ph).toFixed(2)})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();

        // crosshair reticle
        const cs = Math.max(10, W * 0.028);
        ctx.save();
        ctx.strokeStyle = CYAN;
        ctx.lineWidth = 1.5;
        ctx.shadowColor = CYAN;
        ctx.shadowBlur  = 8;
        ctx.beginPath();
        ctx.moveTo(ax - cs,        ty); ctx.lineTo(ax - cs * 0.32, ty);
        ctx.moveTo(ax + cs * 0.32, ty); ctx.lineTo(ax + cs,        ty);
        ctx.moveTo(ax, ty - cs);        ctx.lineTo(ax, ty - cs * 0.32);
        ctx.moveTo(ax, ty + cs * 0.32); ctx.lineTo(ax, ty + cs);
        ctx.stroke();
        ctx.shadowBlur = 0;
        ctx.restore();

        // direction chevrons
        const vm = this._sms;
        if (Math.abs(vm) > 0.15) {
          const chCol = vm < 0 ? RED : GREEN;
          ctx.save();
          ctx.strokeStyle = chCol;
          ctx.lineWidth = 2;
          ctx.shadowColor = chCol;
          ctx.shadowBlur = 5;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          for (let ci = 0; ci < 3; ci++) {
            if (vm < 0) {
              // approaching — chevrons above reticle pointing up (toward sensor)
              const cy2 = ty - cs * 1.3 - ci * 9;
              ctx.beginPath();
              ctx.moveTo(ax - 7, cy2 + 6); ctx.lineTo(ax, cy2); ctx.lineTo(ax + 7, cy2 + 6);
              ctx.stroke();
            } else {
              // receding — chevrons below reticle pointing down
              const cy2 = ty + cs * 1.3 + ci * 9;
              ctx.beginPath();
              ctx.moveTo(ax - 7, cy2 - 6); ctx.lineTo(ax, cy2); ctx.lineTo(ax + 7, cy2 - 6);
              ctx.stroke();
            }
          }
          ctx.shadowBlur = 0;
          ctx.restore();
        }

        // distance label
        const ftTxt = toFt(dm).toFixed(1) + ' ft';
        const mTxt  = dm.toFixed(2) + ' m';
        const lx = ax + hw * 0.28 + 10;
        const fs1 = Math.max(11, Math.round(W * 0.033));
        const fs2 = Math.max(9,  Math.round(W * 0.026));
        ctx.save();
        ctx.textAlign  = 'left';
        ctx.shadowColor = CYAN;
        ctx.shadowBlur  = 5;
        ctx.font      = `700 ${fs1}px ${FONT}`;
        ctx.fillStyle = CYAN;
        ctx.fillText(ftTxt, lx, ty - 3);
        ctx.shadowBlur = 0;
        ctx.font      = `${fs2}px ${FONT}`;
        ctx.fillStyle = 'rgba(0,224,255,0.65)';
        ctx.fillText(mTxt, lx, ty + fs2 + 2);
        ctx.restore();
      }

      // --- sensor block ---
      const bw = Math.max(44, Math.round(W * 0.13));
      const bh = Math.max(16, Math.round(H * 0.028));
      const bx = ax - bw / 2;
      const by = ay - bh - 1;
      const active = this._det || this._occ;
      ctx.save();
      ctx.shadowColor = active ? CYAN : 'transparent';
      ctx.shadowBlur  = active ? 16 : 0;
      ctx.fillStyle   = active ? 'rgba(0,224,255,0.12)' : 'rgba(26,42,58,0.90)';
      rr(ctx, bx, by, bw, bh, 3);
      ctx.fill();
      ctx.strokeStyle = active ? CYAN : DIMTXT;
      ctx.lineWidth   = 1.5;
      rr(ctx, bx, by, bw, bh, 3);
      ctx.stroke();
      ctx.shadowBlur = 0;
      const fsB = Math.max(8, Math.round(W * 0.024));
      ctx.font      = `700 ${fsB}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillStyle = active ? CYAN : DIMTXT;
      ctx.fillText('C4001', ax, by + bh - 3);
      ctx.restore();

      // --- scanlines ---
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.13)';
      for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);
      ctx.restore();
    }
  }

  if (!customElements.get('c4001-card')) {
    customElements.define('c4001-card', C4001Card);
  }
})();
