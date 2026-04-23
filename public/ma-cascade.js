/* ═══════════════════════════════════════════════════════════════
   FRACTAL GEOMETRY — alternating MA-cross bridge levels.
   Port of the FractalScript "Machine Learning Level" idea:
     Event A = SMA(900) x SMA(1500)
     Event B = SMA(100) x SMA(200)
     When A and B fire within 250 bars of each other, draw a
     solid diagonal from the earlier anchor to the later one,
     and a dashed horizontal projection 50 bars forward.
   Also draws SMA(2500) as a horizontal line at its current value.
   Exports: window.MACascade = { compute, draw }.
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
  'use strict';

  var MAX_BARS_BETWEEN = 250;
  var FORWARD_BARS     = 50;

  /* Desaturated palette — informational, not alarming */
  var COLORS = {
    A_down:  { solid: 'rgba( 80,140,220,0.75)', dashed: 'rgba(210, 90, 90,0.70)' }, // 900 crossunder 1500
    A_up:    { solid: 'rgba(160,110,210,0.75)', dashed: 'rgba(215,180, 80,0.70)' }, // 900 crossover  1500
    B_up:    { solid: 'rgba( 90,200,220,0.75)', dashed: 'rgba(225,150, 70,0.70)' }, // 100 crossover   200
    B_down:  { solid: 'rgba(200, 95,180,0.75)', dashed: 'rgba(150,210, 90,0.70)' }, // 100 crossunder  200
    sma2500: 'rgba(0,246,25,0.80)',
  };

  function sma(candles, period) {
    var n = candles.length;
    if (n < period) return null;
    var out = new Array(n);
    var s = 0;
    for (var i = 0; i < n; i++) {
      s += +candles[i].c;
      if (i >= period) s -= +candles[i - period].c;
      out[i] = (i >= period - 1) ? s / period : null;
    }
    return out;
  }

  /* Walks the full candle array once, returns every completed bridge
     segment plus the latest SMA2500 value. */
  function compute(candles) {
    var n = candles ? candles.length : 0;
    var result = { sma2500Now: null, segments: [] };
    if (n < 200) return result;

    var ma100  = sma(candles, 100);
    var ma200  = sma(candles, 200);
    var ma900  = n >= 900  ? sma(candles, 900)  : null;
    var ma1500 = n >= 1500 ? sma(candles, 1500) : null;
    var ma2500 = n >= 2500 ? sma(candles, 2500) : null;

    if (ma2500) result.sma2500Now = ma2500[n - 1];
    if (!ma900 || !ma1500) return result;

    /* state: 0 = none, 1 = waiting for B (A anchored), 2 = waiting for A (B anchored) */
    var state = 0;
    var startBar = -1;
    var startValue = 0;
    var nextSolid = null;
    var nextDashed = null;

    for (var i = 1; i < n; i++) {
      var a0 = ma900[i - 1], a1 = ma900[i];
      var b0 = ma1500[i - 1], b1 = ma1500[i];
      var c0 = ma100[i - 1], c1 = ma100[i];
      var d0 = ma200[i - 1], d1 = ma200[i];
      if (a0 == null || a1 == null || b0 == null || b1 == null) continue;
      if (c0 == null || c1 == null || d0 == null || d1 == null) continue;

      var crossUnder_900_1500 = a0 >= b0 && a1 <  b1;
      var crossOver_900_1500  = a0 <= b0 && a1 >  b1;
      var eventA = crossUnder_900_1500 || crossOver_900_1500;

      var crossOver_100_200  = c0 <= d0 && c1 >  d1;
      var crossUnder_100_200 = c0 >= d0 && c1 <  d1;
      var eventB = crossOver_100_200 || crossUnder_100_200;

      if (eventA) {
        if (state === 2 && startBar >= 0 && (i - startBar) <= MAX_BARS_BETWEEN) {
          result.segments.push({
            barA: startBar, priceA: startValue,
            barB: i,        priceB: ma900[i],
            solidColor:  nextSolid,
            dashedColor: nextDashed,
          });
        }
        state = 1;
        startBar = i;
        startValue = ma900[i];
        if (crossUnder_900_1500) { nextSolid = COLORS.A_down.solid; nextDashed = COLORS.A_down.dashed; }
        else                     { nextSolid = COLORS.A_up.solid;   nextDashed = COLORS.A_up.dashed;   }
      }

      if (eventB) {
        if (state === 1 && startBar >= 0 && (i - startBar) <= MAX_BARS_BETWEEN) {
          result.segments.push({
            barA: startBar, priceA: startValue,
            barB: i,        priceB: ma100[i],
            solidColor:  nextSolid,
            dashedColor: nextDashed,
          });
        }
        state = 2;
        startBar = i;
        startValue = ma100[i];
        if (crossOver_100_200) { nextSolid = COLORS.B_up.solid;   nextDashed = COLORS.B_up.dashed;   }
        else                   { nextSolid = COLORS.B_down.solid; nextDashed = COLORS.B_down.dashed; }
      }
    }

    return result;
  }

  /* Render into an existing canvas context using the host chart's
     world→screen helpers. All lines are 1px; dashed uses [3,3]. */
  function draw(ctx, candles, env) {
    if (!ctx || !candles || candles.length < 200) return;
    if (!env || typeof env.worldToScreenX !== 'function' || typeof env.worldToScreenY !== 'function') return;

    var res  = compute(candles);
    var PAD  = env.PAD, W = env.W;
    var lEdge = PAD.l, rEdge = W - PAD.r;

    ctx.save();
    ctx.lineWidth = 1;

    /* SMA 2500 — horizontal line across the full chart */
    if (res.sma2500Now != null && isFinite(res.sma2500Now)) {
      var y2500 = env.worldToScreenY(res.sma2500Now);
      ctx.setLineDash([]);
      ctx.strokeStyle = COLORS.sma2500;
      ctx.beginPath();
      ctx.moveTo(lEdge, y2500);
      ctx.lineTo(rEdge, y2500);
      ctx.stroke();
    }

    /* Bridge segments */
    for (var k = 0; k < res.segments.length; k++) {
      var seg = res.segments[k];
      var x1 = env.worldToScreenX(seg.barA);
      var y1 = env.worldToScreenY(seg.priceA);
      var x2 = env.worldToScreenX(seg.barB);
      var y2 = env.worldToScreenY(seg.priceB);
      var xF = env.worldToScreenX(seg.barB + FORWARD_BARS);

      /* Cull segments whose solid AND dashed are both fully off-screen */
      var minX = Math.min(x1, x2);
      var maxX = Math.max(x2, xF);
      if (maxX < lEdge - 20 || minX > rEdge + 20) continue;

      /* Solid diagonal */
      ctx.setLineDash([]);
      ctx.strokeStyle = seg.solidColor;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      /* Dashed horizontal forward projection */
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = seg.dashedColor;
      ctx.beginPath();
      ctx.moveTo(x2, y2);
      ctx.lineTo(xF, y2);
      ctx.stroke();
    }

    ctx.setLineDash([]);
    ctx.restore();
  }

  global.MACascade = {
    compute: compute,
    draw:    draw,
    COLORS:  COLORS,
    FORWARD_BARS: FORWARD_BARS,
    MAX_BARS_BETWEEN: MAX_BARS_BETWEEN,
  };
})(typeof window !== 'undefined' ? window : this);
