/* ═══════════════════════════════════════════════════════════════
   FRACTAL PATTERN - SPECIALIZED PATHS
   Port of the FractalScript logic from afa.txt
   ═══════════════════════════════════════════════════════════════ */

(function(global) {
  'use strict';

  var FLOAT_MULTIPLIER = 3.0;
  var WAIT_BARS = 20;
  var ATR_LEN = 14;

  var COLORS = {
    yellow: '#ffeb3b', // Path 1
    orange: '#ff9800'  // Path 2
  };

  function sma(candles, period, getter) {
    var n = candles.length;
    var out = new Array(n).fill(null);
    if (n < period) return out;
    var s = 0;
    for (var i = 0; i < n; i++) {
      s += getter(candles[i], i);
      if (i >= period) s -= getter(candles[i - period], i - period);
      if (i >= period - 1) out[i] = s / period;
    }
    return out;
  }

  function rma(data, period) {
    var n = data.length;
    var out = new Array(n).fill(null);
    if (n < period) return out;
    var alpha = 1 / period;
    var sum = 0;
    for(var i=0; i<period; i++) sum += data[i];
    var val = sum / period; // SMA for initial value
    out[period-1] = val;
    for (var i = period; i < n; i++) {
      val = alpha * data[i] + (1 - alpha) * val;
      out[i] = val;
    }
    return out;
  }

  function compute(candles) {
    var n = candles ? candles.length : 0;
    var result = { path1Segments: [], path2Segments: [] };
    if (n < 2500) return result;

    var getC = function(c) { return c.c; };
    var ma28 = sma(candles, 28, getC);
    var ma100 = sma(candles, 100, getC);
    var ma200 = sma(candles, 200, getC);
    var ma400 = sma(candles, 400, getC);
    var ma900 = sma(candles, 900, getC);
    var ma1500 = sma(candles, 1500, getC);
    var ma2500 = sma(candles, 2500, getC);

    // TR
    var tr = new Array(n).fill(0);
    for (var i = 0; i < n; i++) {
      var c = candles[i];
      if (i === 0) {
        tr[i] = c.h - c.l;
      } else {
        var pc = candles[i-1].c;
        tr[i] = Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
      }
    }
    var atr = rma(tr, ATR_LEN);

    var s1 = 0, f1 = false;
    var x1 = [], y1 = [];
    var inPath2 = false;
    var x2 = [], y2 = [];

    for (var i = 1; i < n; i++) {
      var prev400 = ma400[i-1], cur400 = ma400[i];
      var prev28 = ma28[i-1], cur28 = ma28[i];
      var prev200 = ma200[i-1], cur200 = ma200[i];
      var prev2500 = ma2500[i-1], cur2500 = ma2500[i];
      var prev900 = ma900[i-1], cur900 = ma900[i];
      var cur1500 = ma1500[i], cur100 = ma100[i];
      var close = candles[i].c;
      var high = candles[i].h, low = candles[i].l;

      if (cur2500 === null) continue; // we need all MAs to be valid (2500 is max)

      var start1 = (prev400 <= prev28 && cur400 > cur28); // crossover(ma400, ma28)
      var end1 = (prev400 <= prev200 && cur400 > cur200); // crossover(ma400, ma200)
      var trendFilter = (close > cur1500) && (cur900 > cur1500) && (cur900 > cur100);

      var start2 = (prev2500 <= prev200 && cur2500 > cur200); // crossover(ma2500, ma200)
      var end2 = (prev2500 <= prev900 && cur2500 > cur900); // crossover(ma2500, ma900)

      var medianPrice = (high + low) / 2;
      var floatBuffer = atr[i] * FLOAT_MULTIPLIER;
      var currentVal = medianPrice + floatBuffer;

      // PATH 1
      if (start1) {
        s1 = 1;
        f1 = trendFilter;
        x1 = []; y1 = [];
      }

      if (s1 === 1) {
        x1.push(i);
        y1.push(currentVal);
        if (trendFilter) f1 = true;
        if (end1) s1 = 2;
      }

      if (s1 === 2) {
        if (trendFilter || f1) {
          if (x1.length > 1) {
            result.path1Segments.push({ x: x1.slice(), y: y1.slice() });
          }
          s1 = 0; x1 = []; y1 = [];
        } else {
          var last_x = x1.length > 0 ? x1[x1.length - 1] : i;
          if ((i - last_x) >= WAIT_BARS) {
            s1 = 0; x1 = []; y1 = [];
          }
        }
      }

      // PATH 2
      if (start2) {
        inPath2 = true;
        x2 = []; y2 = [];
      }

      if (inPath2) {
        x2.push(i);
        y2.push(currentVal);
        if (end2) {
          if (x2.length > 1) {
            result.path2Segments.push({ x: x2.slice(), y: y2.slice() });
          }
          inPath2 = false; x2 = []; y2 = [];
        }
      }
    }

    return result;
  }

  function draw(ctx, candles, env) {
    if (!ctx || !candles || candles.length < 2500) return;
    if (!env || typeof env.worldToScreenX !== 'function' || typeof env.worldToScreenY !== 'function') return;

    var res = compute(candles);
    var PAD = env.PAD, W = env.W;
    var lEdge = PAD.l, rEdge = W - PAD.r;

    ctx.save();
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.setLineDash([]);

    function drawPath(segments, color) {
      ctx.strokeStyle = color;
      for (var k = 0; k < segments.length; k++) {
        var seg = segments[k];
        
        // Cull if entirely off-screen
        var minX = env.worldToScreenX(seg.x[0]);
        var maxX = env.worldToScreenX(seg.x[seg.x.length - 1]);
        if (maxX < lEdge - 20 || minX > rEdge + 20) continue;

        ctx.beginPath();
        for (var i = 0; i < seg.x.length; i++) {
          var sx = env.worldToScreenX(seg.x[i]);
          var sy = env.worldToScreenY(seg.y[i]);
          if (i === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        }
        ctx.stroke();
      }
    }

    drawPath(res.path1Segments, COLORS.yellow);
    drawPath(res.path2Segments, COLORS.orange);

    ctx.restore();
  }

  global.FractalPaths = {
    compute: compute,
    draw: draw,
    COLORS: COLORS
  };

})(typeof window !== 'undefined' ? window : this);
