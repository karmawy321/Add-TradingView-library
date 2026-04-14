/* ═══════════════════════════════════════════════════════════════
   SNIPER ENGINE — Pure algorithmic trade signal generator
   No AI. No API calls. Pure math.

   Methods: SMC structure, S/R levels, Fibonacci confluence,
            chart pattern recognition (H&S, double top/bottom,
            triangles, broadening, candlestick patterns)
   Output: { direction, entry, sl, tp1, tp2, confidence, reasoning,
             patterns, ... }
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ── 1. SWING DETECTION ──
   A swing high is a candle whose high is higher than `left` candles before
   and `right` candles after. Vice versa for swing low.
   Params scale with timeframe — sub-1H charts need wider windows to filter noise. */

const SWING_PARAMS = {
  '1':   { left: 15, right: 10 },  // 1m  — 25-bar window filters micro-noise
  '5':   { left: 10, right: 7 },   // 5m
  '15':  { left: 8,  right: 5 },   // 15m
  '30':  { left: 6,  right: 4 },   // 30m
  // 1H+ uses defaults (left=5, right=3)
};

function getSwingParams(timeframe) {
  if (!timeframe) return { left: 5, right: 3 };
  const tf = String(timeframe).toLowerCase().replace(/\s+/g, '');
  // Extract numeric part for minute-based timeframes
  const minMatch = tf.match(/^(\d+)(m|min)?$/);
  if (minMatch) {
    const mins = parseInt(minMatch[1], 10);
    if (SWING_PARAMS[String(mins)]) return SWING_PARAMS[String(mins)];
    if (mins < 60) return { left: 6, right: 4 }; // fallback for unlisted sub-1H
  }
  return { left: 5, right: 3 }; // 1H+ defaults
}

function detectSwings(candles, left = 5, right = 3) {
  const highs = [], lows = [];
  const len = candles.length;
  if (len < left + right + 1) return { highs, lows };

  for (let i = left; i < len - right; i++) {
    let isHigh = true, isLow = true;
    for (let j = i - left; j <= i + right; j++) {
      if (j === i) continue;
      if (+candles[j].h >= +candles[i].h) isHigh = false;
      if (+candles[j].l <= +candles[i].l) isLow = false;
    }
    if (isHigh) highs.push({ index: i, price: +candles[i].h });
    if (isLow)  lows.push({ index: i, price: +candles[i].l });
  }
  return { highs, lows };
}


/* ── 2. MARKET STRUCTURE ──
   Compare consecutive swing highs/lows to determine HH/HL or LH/LL. */

function getStructure(swings) {
  const h = swings.highs, l = swings.lows;
  if (h.length < 2 || l.length < 2) return 'ranging';

  const lastH = h[h.length - 1], prevH = h[h.length - 2];
  const lastL = l[l.length - 1], prevL = l[l.length - 2];

  const higherHigh = lastH.price > prevH.price;
  const higherLow  = lastL.price > prevL.price;
  const lowerHigh  = lastH.price < prevH.price;
  const lowerLow   = lastL.price < prevL.price;

  if (higherHigh && higherLow) return 'bullish';
  if (lowerHigh && lowerLow)   return 'bearish';
  // Mixed signals — check the most recent move
  if (higherLow) return 'bullish';
  if (lowerHigh) return 'bearish';
  return 'ranging';
}


/* ── 3. FIBONACCI LEVELS ── */

function calcFibLevels(swingHigh, swingLow) {
  const range = swingHigh - swingLow;
  return {
    '0.236': swingLow + range * 0.236,
    '0.382': swingLow + range * 0.382,
    '0.500': swingLow + range * 0.500,
    '0.618': swingLow + range * 0.618,
    '0.786': swingLow + range * 0.786,
    '1.272': swingLow + range * 1.272,
    '1.618': swingLow + range * 1.618,
  };
}


/* ── 4. ORDER BLOCK DETECTION ──
   Bullish OB: last bearish candle before a strong bullish impulse move.
   Bearish OB: last bullish candle before a strong bearish impulse move. */

function findOrderBlock(candles, structure) {
  const len = candles.length;
  if (len < 5) return null;

  // Average candle body size for "strong move" threshold
  let avgBody = 0;
  for (let i = Math.max(0, len - 30); i < len; i++) {
    avgBody += Math.abs(+candles[i].c - +candles[i].o);
  }
  avgBody /= Math.min(30, len);
  const threshold = avgBody * 1.5;

  // Search backwards from recent candles (skip last 2 for confirmation)
  for (let i = len - 3; i >= Math.max(0, len - 60); i--) {
    const curr = candles[i], next = candles[i + 1];
    const currOpen = +curr.o, currClose = +curr.c;
    const nextOpen = +next.o, nextClose = +next.c;
    const currBody = Math.abs(currClose - currOpen);
    const nextBody = Math.abs(nextClose - nextOpen);

    if (structure === 'bullish' || structure === 'ranging') {
      // Bullish OB: bearish candle followed by strong bullish candle
      const isBearish = currClose < currOpen;
      const strongBullish = nextClose > nextOpen && nextBody > threshold;
      if (isBearish && strongBullish && nextBody > currBody) {
        return { type: 'bullish', high: currOpen, low: +curr.l, index: i };
      }
    }
    if (structure === 'bearish' || structure === 'ranging') {
      // Bearish OB: bullish candle followed by strong bearish candle
      const isBullish = currClose > currOpen;
      const strongBearish = nextClose < nextOpen && nextBody > threshold;
      if (isBullish && strongBearish && nextBody > currBody) {
        return { type: 'bearish', high: +curr.h, low: currOpen, index: i };
      }
    }
  }
  return null;
}


/* ── 5. SUPPORT / RESISTANCE LEVELS ──
   Cluster swing highs and lows that occur near similar prices.
   A level with 2+ touches is considered significant. */

function findKeyLevels(candles, swings, tolerancePct = 0.003) {
  // Collect all swing prices
  const prices = [];
  swings.highs.forEach(s => prices.push({ price: s.price, type: 'resistance' }));
  swings.lows.forEach(s => prices.push({ price: s.price, type: 'support' }));

  // Cluster nearby prices
  const levels = [];
  for (const p of prices) {
    const existing = levels.find(l =>
      Math.abs(l.price - p.price) / Math.max(l.price, 0.0001) < tolerancePct
    );
    if (existing) {
      existing.touches++;
      existing.price = (existing.price * (existing.touches - 1) + p.price) / existing.touches;
    } else {
      levels.push({ price: p.price, touches: 1, type: p.type });
    }
  }

  return levels
    .filter(l => l.touches >= 2)
    .sort((a, b) => b.touches - a.touches);
}


/* ── 6. CONFLUENCE FINDER ──
   Score how many factors align at a given price zone. */

function findConfluence(entry, fibs, orderBlock, keyLevels, atr, tolerancePct = 0.005) {
  // ATR-based tolerance: prevents all Fibonacci levels firing on tight swing ranges.
  // Cap at 30% of ATR so "near a level" means something relative to actual volatility.
  // Falls back to price-relative tolerance when ATR is unavailable.
  const absTol = atr
    ? Math.min(entry * tolerancePct, atr * 0.30)
    : entry * tolerancePct;

  let score = 0;
  const factors = [];

  // Check Fibonacci levels near entry — cap at best 2 matches to prevent
  // score inflation when tight swing ranges cluster all Fib levels together
  const fibHits = [];
  for (const [level, price] of Object.entries(fibs)) {
    if (Math.abs(price - entry) < absTol) {
      const pts = level === '0.618' ? 3 : level === '0.500' ? 2 : 1;
      fibHits.push({ level, pts });
    }
  }
  // Keep only the 2 highest-value Fib matches
  fibHits.sort((a, b) => b.pts - a.pts);
  for (const fh of fibHits.slice(0, 2)) {
    score += fh.pts;
    factors.push(`Fib ${fh.level}`);
  }

  // Check order block zone
  if (orderBlock) {
    if (entry >= orderBlock.low && entry <= orderBlock.high) {
      score += 3;
      factors.push(`${orderBlock.type} OB`);
    } else if (Math.abs(entry - orderBlock.high) < absTol * 2) {
      score += 1;
      factors.push(`near ${orderBlock.type} OB`);
    }
  }

  // Check S/R levels near entry
  for (const lvl of keyLevels.slice(0, 5)) {
    if (Math.abs(lvl.price - entry) < absTol) {
      score += 2;
      factors.push(`S/R (${lvl.touches} touches)`);
      break;
    }
  }

  return { score, factors };
}


/* ── 7. TREND (SMA-based) ── */

function calcSMA(candles, period) {
  if (candles.length < period) return null;
  let sum = 0;
  for (let i = candles.length - period; i < candles.length; i++) {
    sum += +candles[i].c;
  }
  return sum / period;
}

function getTrend(candles) {
  const sma20 = calcSMA(candles, Math.min(20, candles.length));
  const sma50 = calcSMA(candles, Math.min(50, candles.length));
  const lastClose = +candles[candles.length - 1].c;

  if (!sma20 || !sma50) {
    return lastClose > sma20 ? 'uptrend' : 'downtrend';
  }

  if (sma20 > sma50 && lastClose > sma20) return 'uptrend';
  if (sma20 < sma50 && lastClose < sma20) return 'downtrend';
  return 'ranging';
}


/* ── 7b. LINEAR REGRESSION & TREND SLOPE ──
   Least-squares linear fit. Used by triangle/broadening detection
   and as a supplement to SMA-based trend. */

function linearRegression(xArr, yArr) {
  const n = xArr.length;
  if (n < 2) return { slope: 0, intercept: yArr[0] || 0, r2: 0 };

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    sumX  += xArr[i];
    sumY  += yArr[i];
    sumXY += xArr[i] * yArr[i];
    sumX2 += xArr[i] * xArr[i];
  }

  const denom = n * sumX2 - sumX * sumX;
  if (denom === 0) return { slope: 0, intercept: sumY / n, r2: 0 };

  const slope     = (n * sumXY - sumX * sumY) / denom;
  const intercept = (sumY - slope * sumX) / n;

  // R² — goodness of fit
  const meanY = sumY / n;
  let ssTot = 0, ssRes = 0;
  for (let i = 0; i < n; i++) {
    ssTot += (yArr[i] - meanY) ** 2;
    ssRes += (yArr[i] - (slope * xArr[i] + intercept)) ** 2;
  }

  return { slope, intercept, r2: ssTot > 0 ? 1 - ssRes / ssTot : 0 };
}

function getTrendSlope(candles, period = 50) {
  const n = Math.min(period, candles.length);
  const recent = candles.slice(-n);
  const x = recent.map((_, i) => i);
  const y = recent.map(c => c.c);
  const reg = linearRegression(x, y);

  // Normalize slope relative to price so it's comparable across assets
  const avgPrice = y.reduce((a, b) => a + b, 0) / n;
  const normSlope = avgPrice > 0 ? reg.slope / avgPrice : 0;

  return {
    direction: normSlope > 0.0003 ? 'uptrend' : normSlope < -0.0003 ? 'downtrend' : 'ranging',
    slope: +normSlope.toFixed(6),
    r2:    +reg.r2.toFixed(3),
  };
}


/* ── 8. ATR (Average True Range) ── */

function calcATR(candles, period = 14) {
  if (candles.length < 2) return 0;
  const p = Math.min(period, candles.length - 1);
  let sum = 0;
  for (let i = candles.length - p; i < candles.length; i++) {
    const h = +candles[i].h, l = +candles[i].l;
    const prevC = +candles[i - 1].c;
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    sum += tr;
  }
  return sum / p;
}


/* ── 9. CONTEXT TAGS ── */

function computeContext(candles, pair, timeframe) {
  // TREND
  const trend = getTrend(candles);

  // VOLATILITY (ATR as % of price)
  const atr = calcATR(candles);
  const lastPrice = +candles[candles.length - 1].c;
  const atrPct = lastPrice > 0 ? (atr / lastPrice) * 100 : 0;
  let volatility;
  if (atrPct < 0.3) volatility = 'low';
  else if (atrPct < 0.8) volatility = 'medium';
  else if (atrPct < 2.0) volatility = 'high';
  else volatility = 'extreme';

  // SESSION — use last candle's timestamp when available (backtest-safe),
  // fall back to wall-clock time for live signals.
  const lastCandle = candles[candles.length - 1];
  let utcHour;
  if (lastCandle && lastCandle.t) {
    const candleDate = new Date(typeof lastCandle.t === 'number'
      ? lastCandle.t * (lastCandle.t < 1e12 ? 1000 : 1)  // handle seconds vs ms
      : lastCandle.t);
    utcHour = isNaN(candleDate.getTime()) ? new Date().getUTCHours() : candleDate.getUTCHours();
  } else {
    utcHour = new Date().getUTCHours();
  }
  let session;
  if (utcHour >= 0 && utcHour < 7) session = 'asia';
  else if (utcHour >= 7 && utcHour < 12) session = 'london';
  else if (utcHour >= 12 && utcHour < 17) session = 'new_york';
  else if (utcHour >= 17 && utcHour < 21) session = 'late_ny';
  else session = 'asia';

  return { trend, volatility, session, atr, atrPct: +atrPct.toFixed(3) };
}


/* ── 10. SETUP TYPE CLASSIFICATION ── */

function classifySetup(structure, swings, candles) {
  const len = candles.length;
  if (len < 10) return 'unknown';

  const lastClose = +candles[len - 1].c;
  const h = swings.highs, l = swings.lows;

  if (h.length < 2 || l.length < 2) return 'unknown';

  const lastHigh = h[h.length - 1], lastLow = l[l.length - 1];

  // Breakout: price is beyond the last swing extreme
  if (structure === 'bullish' && lastClose > lastHigh.price) return 'breakout';
  if (structure === 'bearish' && lastClose < lastLow.price) return 'breakout';

  // Reversal: structure just changed (last two swings show opposite pattern to prior)
  if (h.length >= 3 && l.length >= 3) {
    const thirdH = h[h.length - 3], thirdL = l[l.length - 3];
    const prevH = h[h.length - 2], prevL = l[l.length - 2];
    const wasBullish = prevH.price > thirdH.price && prevL.price > thirdL.price;
    const wasBearish = prevH.price < thirdH.price && prevL.price < thirdL.price;
    if (structure === 'bearish' && wasBullish) return 'reversal';
    if (structure === 'bullish' && wasBearish) return 'reversal';
  }

  // Range bounce: structure is ranging and price is near S/R
  if (structure === 'ranging') return 'range_bounce';

  // Default: continuation
  return 'continuation';
}


/* ── 11. CONFIDENCE SCORE ── */

function computeConfidence(confluence, structure, ctx, patterns = [], direction = null) {
  let conf = 30; // base

  // Confluence factors (0-30 pts)
  conf += Math.min(30, confluence.score * 6);

  // Clear structure (0-15 pts)
  if (structure === 'bullish' || structure === 'bearish') conf += 15;
  else conf += 5;

  // Trend alignment (0-15 pts) — use actual direction, not structure
  // When structure is ranging, direction follows trend — still gets full credit if aligned
  const dir = direction || (structure === 'bullish' ? 'long' : structure === 'bearish' ? 'short' : null);
  const trendMatch = (ctx.trend === 'uptrend' && dir === 'long') ||
                     (ctx.trend === 'downtrend' && dir === 'short');
  if (trendMatch)              conf += 15;
  else if (ctx.trend === 'ranging') conf += 5;
  // else: counter-trend = no bonus

  // Volatility (0-10 pts — medium is best for structured signals)
  if (ctx.volatility === 'medium') conf += 10;
  else if (ctx.volatility === 'low') conf += 5;
  else if (ctx.volatility === 'high') conf += 3;
  // extreme = no bonus

  // Pattern confirmation/conflict — use actual direction, not structure
  // Capped at ±30 pts total to prevent triple-pattern ceiling/floor hits
  const signalDir = dir === 'long' ? 'bullish' : 'bearish';
  let patternBonus = 0;
  for (const p of patterns) {
    if (p.type === signalDir && p.confirmed)                              patternBonus += 15;
    else if (p.type === signalDir)                                        patternBonus += 8;
    else if (p.type !== 'neutral' && p.type !== signalDir && p.confirmed) patternBonus -= 10;
  }
  conf += Math.max(-30, Math.min(30, patternBonus));

  return Math.min(95, Math.max(15, conf));
}


/* ── 12. TEMPLATE-BASED REASONING ── */

function generateReasoning(direction, structure, setupType, confluence, ctx, entry, sl, ob, patterns = []) {
  const dir = direction.toUpperCase();
  const structDesc = structure === 'bullish' ? 'HH/HL' : structure === 'bearish' ? 'LH/LL' : 'range';

  const parts = [`${dir}: ${structure} structure (${structDesc})`];

  if (confluence.factors.length > 0) {
    parts.push(`entry at ${confluence.factors.join(' + ')} confluence`);
  }

  if (ob) {
    const obDp = getDecimals(ob.high);
    parts.push(`${ob.type} OB at ${ob.low.toFixed(obDp)}-${ob.high.toFixed(obDp)}`);
  }

  parts.push(`SL beyond swing ${direction === 'long' ? 'low' : 'high'}`);

  if (setupType !== 'unknown') {
    parts.push(`setup: ${setupType.replace(/_/g, ' ')}`);
  }

  // Confirmed and forming chart patterns — filtered by direction alignment
  const signalType          = direction === 'long' ? 'bullish' : 'bearish';
  const confirmedPatterns   = patterns.filter(p => p.confirmed && p.type === signalType);
  const conflictingPatterns = patterns.filter(p => p.confirmed && p.type !== 'neutral' && p.type !== signalType);
  const formingPatterns     = patterns.filter(p => !p.confirmed &&
    (p.type === signalType || p.type === 'neutral'));

  if (confirmedPatterns.length > 0) {
    parts.push(`confirmed: ${confirmedPatterns.map(p => p.name).join(', ')}`);
  }
  if (conflictingPatterns.length > 0) {
    parts.push(`conflicting: ${conflictingPatterns.map(p => p.name).join(', ')}`);
  }
  if (formingPatterns.length > 0) {
    parts.push(`forming: ${formingPatterns.map(p => p.name).join(', ')}`);
  }

  const trendAligned =
    (ctx.trend === 'uptrend'   && direction === 'long')  ||
    (ctx.trend === 'downtrend' && direction === 'short') ||
    ctx.trend === 'ranging';
  if (!trendAligned) parts.push(`⚠ counter-trend`);

  return parts.join('. ') + '.';
}


/* ── 13. HEAD & SHOULDERS / INVERSE H&S ──
   H&S (bearish): 3 swing highs where the middle (head) is highest,
   and the two outer peaks (shoulders) are at similar heights.
   Inverse H&S (bullish): mirror image using swing lows. */

function detectHeadAndShoulders(candles, swings) {
  const results = [];
  const { highs, lows } = swings;
  const lastClose = candles[candles.length - 1].c;
  const SHOULDER_TOL = 0.04; // shoulders within 4% of each other

  // ── Bearish H&S ──
  if (highs.length >= 3) {
    const startIdx = Math.max(0, highs.length - 5);
    for (let i = startIdx; i <= highs.length - 3; i++) {
      const ls = highs[i], head = highs[i + 1], rs = highs[i + 2];

      // Head must be higher than both shoulders
      if (head.price <= ls.price || head.price <= rs.price) continue;

      // Shoulders must be at similar heights
      const shoulderDiff = Math.abs(ls.price - rs.price) / Math.max(ls.price, rs.price);
      if (shoulderDiff > SHOULDER_TOL) continue;

      // Find troughs between peaks to define neckline
      const trough1 = lows.filter(l => l.index > ls.index && l.index < head.index);
      const trough2 = lows.filter(l => l.index > head.index && l.index < rs.index);
      if (trough1.length === 0 || trough2.length === 0) continue;

      const t1 = trough1[trough1.length - 1];
      const t2 = trough2[trough2.length - 1];

      // Linear neckline projected to current bar
      const neckSlope = (t2.price - t1.price) / Math.max(t2.index - t1.index, 1);
      const neckNow   = t1.price + neckSlope * (candles.length - 1 - t1.index);

      const avgNeck        = (t1.price + t2.price) / 2;
      const headAboveNeck  = head.price - avgNeck;
      const priceTarget    = neckNow - headAboveNeck;
      const confirmed      = lastClose < neckNow;

      results.push({
        name: 'Head & Shoulders',
        type: 'bearish',
        confirmed,
        neckline:    neckNow,
        priceTarget,
        confidence:  confirmed ? 0.80 : 0.50,
      });
      break; // most recent only
    }
  }

  // ── Bullish Inverse H&S ──
  if (lows.length >= 3) {
    const startIdx = Math.max(0, lows.length - 5);
    for (let i = startIdx; i <= lows.length - 3; i++) {
      const ls = lows[i], head = lows[i + 1], rs = lows[i + 2];

      // Head must be lower than both shoulders
      if (head.price >= ls.price || head.price >= rs.price) continue;

      const shoulderDiff = Math.abs(ls.price - rs.price) / Math.max(ls.price, rs.price);
      if (shoulderDiff > SHOULDER_TOL) continue;

      // Peaks between troughs define neckline
      const peak1 = highs.filter(h => h.index > ls.index && h.index < head.index);
      const peak2 = highs.filter(h => h.index > head.index && h.index < rs.index);
      if (peak1.length === 0 || peak2.length === 0) continue;

      const p1 = peak1[peak1.length - 1];
      const p2 = peak2[peak2.length - 1];

      const neckSlope   = (p2.price - p1.price) / Math.max(p2.index - p1.index, 1);
      const neckNow     = p1.price + neckSlope * (candles.length - 1 - p1.index);
      const avgNeck     = (p1.price + p2.price) / 2;
      const headBelowNeck = avgNeck - head.price;
      const priceTarget   = neckNow + headBelowNeck;
      const confirmed     = lastClose > neckNow;

      results.push({
        name: 'Inverse Head & Shoulders',
        type: 'bullish',
        confirmed,
        neckline:    neckNow,
        priceTarget,
        confidence:  confirmed ? 0.80 : 0.50,
      });
      break;
    }
  }

  return results;
}


/* ── 14. DOUBLE TOP / DOUBLE BOTTOM ──
   Two peaks (or troughs) at nearly the same price level
   with a clear trough (or peak) between them. */

function detectDoubleTopBottom(candles, swings) {
  const results = [];
  const { highs, lows } = swings;
  const lastClose = candles[candles.length - 1].c;
  const PEAK_TOL = 0.02; // peaks within 2% of each other

  // ── Double Top (bearish) ──
  if (highs.length >= 2) {
    const startIdx = Math.max(0, highs.length - 4);
    for (let i = startIdx; i <= highs.length - 2; i++) {
      const top1 = highs[i], top2 = highs[i + 1];

      const diff = Math.abs(top1.price - top2.price) / Math.max(top1.price, top2.price);
      if (diff > PEAK_TOL) continue;

      // Must be a trough between them
      const troughs = lows.filter(l => l.index > top1.index && l.index < top2.index);
      if (troughs.length === 0) continue;

      const neckline    = Math.min(...troughs.map(t => t.price));
      const height      = ((top1.price + top2.price) / 2) - neckline;
      const priceTarget = neckline - height;
      const confirmed   = lastClose < neckline;

      results.push({
        name: 'Double Top',
        type: 'bearish',
        confirmed,
        neckline,
        priceTarget,
        confidence: confirmed ? 0.75 : 0.45,
      });
      break;
    }
  }

  // ── Double Bottom (bullish) ──
  if (lows.length >= 2) {
    const startIdx = Math.max(0, lows.length - 4);
    for (let i = startIdx; i <= lows.length - 2; i++) {
      const bot1 = lows[i], bot2 = lows[i + 1];

      const diff = Math.abs(bot1.price - bot2.price) / Math.max(bot1.price, bot2.price);
      if (diff > PEAK_TOL) continue;

      const peaks = highs.filter(h => h.index > bot1.index && h.index < bot2.index);
      if (peaks.length === 0) continue;

      const neckline    = Math.max(...peaks.map(p => p.price));
      const height      = neckline - ((bot1.price + bot2.price) / 2);
      const priceTarget = neckline + height;
      const confirmed   = lastClose > neckline;

      results.push({
        name: 'Double Bottom',
        type: 'bullish',
        confirmed,
        neckline,
        priceTarget,
        confidence: confirmed ? 0.75 : 0.45,
      });
      break;
    }
  }

  return results;
}


/* ── 15. TRIANGLE PATTERNS ──
   Uses linear regression on swing highs and lows to detect:
   - Ascending triangle:  flat resistance + rising support  → bullish bias
   - Descending triangle: flat support   + falling resistance → bearish bias
   - Symmetrical triangle: converging highs + lows → neutral (breakout pending)
   Slope tolerance is price-relative so it works for all assets. */

function detectTriangle(candles, swings) {
  const { highs, lows } = swings;
  if (highs.length < 3 || lows.length < 3) return [];

  const recentHighs = highs.slice(-4);
  const recentLows  = lows.slice(-4);

  const highReg = linearRegression(
    recentHighs.map(h => h.index),
    recentHighs.map(h => h.price)
  );
  const lowReg = linearRegression(
    recentLows.map(l => l.index),
    recentLows.map(l => l.price)
  );

  // Require a decent linear fit on both trendlines
  if (highReg.r2 < 0.5 || lowReg.r2 < 0.5) return [];

  // Price-relative slope tolerance (0.02% per candle = "flat")
  const avgPrice = [
    ...recentHighs.map(h => h.price),
    ...recentLows.map(l => l.price),
  ].reduce((a, b) => a + b, 0) / (recentHighs.length + recentLows.length);

  const slopeTol   = avgPrice * 0.0002;
  const highFall   = highReg.slope < -slopeTol;
  const highFlat   = Math.abs(highReg.slope) <= slopeTol;
  const highRise   = highReg.slope > slopeTol;
  const lowFall    = lowReg.slope < -slopeTol;
  const lowFlat    = Math.abs(lowReg.slope) <= slopeTol;
  const lowRise    = lowReg.slope > slopeTol;

  let triangleType = null, biasType = null;
  if      (highFall && lowRise)  { triangleType = 'Symmetrical Triangle';  biasType = 'neutral';  }
  else if (highFlat && lowRise)  { triangleType = 'Ascending Triangle';    biasType = 'bullish';  }
  else if (highFall && lowFlat)  { triangleType = 'Descending Triangle';   biasType = 'bearish';  }

  if (!triangleType) return [];

  const lastIndex  = candles.length - 1;
  const lastClose  = candles[lastIndex].c;
  const highNow    = highReg.slope * lastIndex + highReg.intercept;
  const lowNow     = lowReg.slope  * lastIndex + lowReg.intercept;

  // Price must be inside the triangle to count
  if (lastClose > highNow || lastClose < lowNow) return [];

  // Bars until the two trendlines converge
  const slopeDiff = highReg.slope - lowReg.slope;
  const barsToApex = slopeDiff !== 0
    ? Math.max(0, Math.round((lowReg.intercept - highReg.intercept) / slopeDiff - lastIndex))
    : 0;

  return [{
    name: triangleType,
    type: biasType,
    confirmed:      false, // confirmed only on breakout
    resistanceLine: highNow,
    supportLine:    lowNow,
    barsToApex,
    confidence:     0.55,
  }];
}


/* ── 16. BROADENING / MEGAPHONE PATTERN ──
   Expanding highs AND expanding lows simultaneously.
   Signals high volatility and indecision — often precedes a strong move. */

function detectBroadening(candles, swings) {
  const { highs, lows } = swings;
  if (highs.length < 3 || lows.length < 3) return [];

  const recentHighs = highs.slice(-4);
  const recentLows  = lows.slice(-4);

  const highReg = linearRegression(
    recentHighs.map(h => h.index),
    recentHighs.map(h => h.price)
  );
  const lowReg = linearRegression(
    recentLows.map(l => l.index),
    recentLows.map(l => l.price)
  );

  if (highReg.r2 < 0.5 || lowReg.r2 < 0.5) return [];

  const avgPrice = [
    ...recentHighs.map(h => h.price),
    ...recentLows.map(l => l.price),
  ].reduce((a, b) => a + b, 0) / (recentHighs.length + recentLows.length);

  const slopeTol = avgPrice * 0.0002;

  // Broadening: highs rising AND lows falling
  if (!(highReg.slope > slopeTol && lowReg.slope < -slopeTol)) return [];

  const lastIndex = candles.length - 1;
  const highNow   = highReg.slope * lastIndex + highReg.intercept;
  const lowNow    = lowReg.slope  * lastIndex + lowReg.intercept;

  return [{
    name:           'Broadening / Megaphone',
    type:           'neutral', // can break either direction
    confirmed:      false,
    resistanceLine: highNow,
    supportLine:    lowNow,
    confidence:     0.45,
  }];
}


/* ── 17. CANDLESTICK PATTERNS ──
   Single and multi-candle patterns on the last 1-3 bars.
   All checks use body/wick ratios — fully price-agnostic. */

function detectCandlestickPatterns(candles) {
  const results = [];
  const len = candles.length;
  if (len < 3) return results;

  const c  = candles[len - 1]; // current
  const p  = candles[len - 2]; // previous
  const pp = candles[len - 3]; // two bars ago

  const body      = Math.abs(c.c - c.o);
  const range     = c.h - c.l;
  const upperWick = c.h - Math.max(c.o, c.c);
  const lowerWick = Math.min(c.o, c.c) - c.l;

  if (range === 0) return results; // avoid divide by zero

  // ── Doji: tiny body relative to range ──
  if (body / range < 0.1) {
    results.push({ name: 'Doji', type: 'neutral', confirmed: true, confidence: 0.55 });
  }

  // ── Hammer (bullish): small body near top of range, long lower wick, at a recent low ──
  const recentLow10  = Math.min(...candles.slice(-10).map(x => x.l));
  const recentHigh10 = Math.max(...candles.slice(-10).map(x => x.h));
  const isAtLow  = c.l <= recentLow10  * 1.005; // within 0.5% of 10-bar low
  const isAtHigh = c.h >= recentHigh10 * 0.995; // within 0.5% of 10-bar high

  if (lowerWick > body * 2 && upperWick < body && body > 0 && isAtLow) {
    results.push({ name: 'Hammer', type: 'bullish', confirmed: true, confidence: 0.65 });
  }

  // ── Shooting Star (bearish): long upper wick, small body near low of range, at a recent high ──
  if (upperWick > body * 2 && lowerWick < body && body > 0 && isAtHigh) {
    results.push({ name: 'Shooting Star', type: 'bearish', confirmed: true, confidence: 0.65 });
  }

  // ── Bullish Engulfing: previous bearish candle fully engulfed by current bullish candle ──
  const prevBearish = p.c < p.o;
  const currBullish = c.c > c.o;
  if (prevBearish && currBullish && c.o <= p.c && c.c >= p.o) {
    results.push({ name: 'Bullish Engulfing', type: 'bullish', confirmed: true, confidence: 0.70 });
  }

  // ── Bearish Engulfing: previous bullish candle fully engulfed by current bearish candle ──
  const prevBullish = p.c > p.o;
  const currBearish = c.c < c.o;
  if (prevBullish && currBearish && c.o >= p.c && c.c <= p.o) {
    results.push({ name: 'Bearish Engulfing', type: 'bearish', confirmed: true, confidence: 0.70 });
  }

  // ── Morning Star (3-bar bullish reversal): large bearish → small body gap → large bullish ──
  const ppBearish   = pp.c < pp.o;
  const pSmallBody  = Math.abs(p.c - p.o) < Math.abs(pp.c - pp.o) * 0.3;
  const cBullish3   = c.c > c.o;
  const cCloseAboveMid = c.c > (pp.o + pp.c) / 2;
  if (ppBearish && pSmallBody && cBullish3 && cCloseAboveMid) {
    results.push({ name: 'Morning Star', type: 'bullish', confirmed: true, confidence: 0.75 });
  }

  // ── Evening Star (3-bar bearish reversal): large bullish → small body → large bearish ──
  const ppBullish   = pp.c > pp.o;
  const pSmallBody2 = Math.abs(p.c - p.o) < Math.abs(pp.c - pp.o) * 0.3;
  const cBearish3   = c.c < c.o;
  const cCloseBelowMid = c.c < (pp.o + pp.c) / 2;
  if (ppBullish && pSmallBody2 && cBearish3 && cCloseBelowMid) {
    results.push({ name: 'Evening Star', type: 'bearish', confirmed: true, confidence: 0.75 });
  }

  return results;
}


/* ── 18. HARMONIC PATTERNS ──
   Detects Gartley, Bat, Butterfly, Crab from the last 5 alternating swing points.
   XABCD structure: each leg checked against pattern-specific Fibonacci ratio tolerances.
   D point = PRZ (Potential Reversal Zone). */

const HARMONIC_DEFS = [
  { name: 'Gartley',   AB_XA: [0.618, 0.618], BC_AB: [0.382, 0.886], CD_XA: [0.786, 0.786], confidence: 0.72 },
  { name: 'Bat',       AB_XA: [0.382, 0.500], BC_AB: [0.382, 0.886], CD_XA: [0.886, 0.886], confidence: 0.75 },
  { name: 'Butterfly', AB_XA: [0.786, 0.786], BC_AB: [0.382, 0.886], CD_XA: [1.272, 1.618], confidence: 0.70 },
  { name: 'Crab',      AB_XA: [0.382, 0.618], BC_AB: [0.382, 0.886], CD_XA: [1.618, 1.618], confidence: 0.73 },
];
const HARM_TOL = 0.06; // 6% tolerance on each ratio check

function _ratioOk(ratio, min, max) {
  return ratio >= min * (1 - HARM_TOL) && ratio <= max * (1 + HARM_TOL);
}

function detectHarmonics(candles, swings) {
  const results  = [];
  const lastClose = +candles[candles.length - 1].c;

  // Merge highs and lows into one time-ordered sequence
  const all = [
    ...swings.highs.map(s => ({ ...s, kind: 'high' })),
    ...swings.lows.map(s =>  ({ ...s, kind: 'low'  })),
  ].sort((a, b) => a.index - b.index);

  // Build strictly alternating sequence — when two same-kind swings are adjacent, keep the more extreme
  const seq = [];
  for (const sw of all) {
    if (seq.length === 0) { seq.push(sw); continue; }
    const last = seq[seq.length - 1];
    if (last.kind === sw.kind) {
      if ((sw.kind === 'high' && sw.price > last.price) ||
          (sw.kind === 'low'  && sw.price < last.price)) {
        seq[seq.length - 1] = sw;
      }
    } else {
      seq.push(sw);
    }
  }

  if (seq.length < 5) return results;

  // Only check the most recent 5-point window
  const [X, A, B, C, D] = seq.slice(-5);

  const isBullish = X.kind === 'low'  && A.kind === 'high' && B.kind === 'low'  && C.kind === 'high' && D.kind === 'low';
  const isBearish = X.kind === 'high' && A.kind === 'low'  && B.kind === 'high' && C.kind === 'low'  && D.kind === 'high';

  if (!isBullish && !isBearish) return results;

  // Leg sizes — all positive
  const XA = isBullish ? A.price - X.price : X.price - A.price;
  const AB = isBullish ? A.price - B.price : B.price - A.price;
  const BC = isBullish ? C.price - B.price : B.price - C.price;
  const CD = isBullish ? C.price - D.price : D.price - C.price;

  if (XA <= 0 || AB <= 0 || BC <= 0 || CD <= 0) return results;

  const abXa = AB / XA;
  const bcAb = BC / AB;
  const cdXa = CD / XA;

  for (const def of HARMONIC_DEFS) {
    if (!_ratioOk(abXa, def.AB_XA[0], def.AB_XA[1])) continue;
    if (!_ratioOk(bcAb, def.BC_AB[0], def.BC_AB[1])) continue;
    if (!_ratioOk(cdXa, def.CD_XA[0], def.CD_XA[1])) continue;

    // Confirmed: price has moved 5%+ of XA away from D in the reversal direction
    const confirmed = isBullish
      ? lastClose > D.price && (lastClose - D.price) / XA > 0.05
      : lastClose < D.price && (D.price - lastClose) / XA > 0.05;

    // In PRZ: last close within 1.5% of D point
    const inPRZ = Math.abs(lastClose - D.price) / Math.max(D.price, 0.0001) < 0.015;

    results.push({
      name:       def.name,
      type:       isBullish ? 'bullish' : 'bearish',
      confirmed,
      inPRZ,
      priceTarget: C.price,       // first meaningful target after D reversal
      neckline:    D.price,       // D = PRZ level
      points:     { X: X.price, A: A.price, B: B.price, C: C.price, D: D.price },
      ratios:     { AB_XA: +abXa.toFixed(3), BC_AB: +bcAb.toFixed(3), CD_XA: +cdXa.toFixed(3) },
      confidence: def.confidence,
    });
  }

  return results;
}


/* ── 19. MASTER PATTERN DETECTOR ──
   Runs all pattern checks and returns a unified array. */

function detectPatterns(candles, swings) {
  const patterns = [];
  patterns.push(...detectHeadAndShoulders(candles, swings));
  patterns.push(...detectDoubleTopBottom(candles, swings));
  patterns.push(...detectTriangle(candles, swings));
  patterns.push(...detectBroadening(candles, swings));
  patterns.push(...detectCandlestickPatterns(candles));
  patterns.push(...detectHarmonics(candles, swings));
  return patterns;
}


/* ═════════════════════════════════════════════════════════
   MAIN ENTRY: sniperSignal()
   ═════════════════════════════════════════════════════════ */

function sniperSignal(candles, pair, timeframe) {
  const len = candles.length;
  if (len < 12) return { error: 'Need at least 12 candles for analysis' };

  // Parse all prices to numbers
  const parsed = candles.map(c => ({
    t: c.t, o: +c.o, h: +c.h, l: +c.l, c: +c.c, v: +(c.v || 0)
  }));

  // ─── ANALYSIS ───
  const { left: swL, right: swR } = getSwingParams(timeframe);
  const swings    = detectSwings(parsed, swL, swR);
  const structure = getStructure(swings);
  const ctx       = computeContext(parsed, pair, timeframe);

  if (swings.highs.length < 1 || swings.lows.length < 1) {
    return { error: 'Insufficient swing structure detected' };
  }

  // ─── PATTERN DETECTION ───
  const patterns   = detectPatterns(parsed, swings);
  const trendSlope = getTrendSlope(parsed);

  // Direction — follow structure, with trend as tiebreaker
  let direction;
  if (structure === 'bullish') direction = 'long';
  else if (structure === 'bearish') direction = 'short';
  else {
    // Ranging — use linear regression slope for a data-driven tiebreaker
    // instead of defaulting to long when both structure and SMA trend are inconclusive
    const _slope = getTrendSlope(parsed);
    if (ctx.trend === 'downtrend' || _slope.direction === 'downtrend') direction = 'short';
    else if (ctx.trend === 'uptrend' || _slope.direction === 'uptrend') direction = 'long';
    else {
      // Truly flat — use micro-slope sign as final tiebreaker
      direction = _slope.slope >= 0 ? 'long' : 'short';
    }
  }

  // Key prices
  const lastClose = parsed[len - 1].c;
  const allHighs  = parsed.map(c => c.h);
  const allLows   = parsed.map(c => c.l);
  const atr       = ctx.atr || calcATR(parsed);

  // Swing points
  const recentSwingHigh = swings.highs[swings.highs.length - 1];
  const recentSwingLow  = swings.lows[swings.lows.length - 1];

  // Fibonacci: use the most recent major swing (high→low for bearish, low→high for bullish)
  const fibHigh = recentSwingHigh.price;
  const fibLow  = recentSwingLow.price;
  const fibs    = calcFibLevels(fibHigh, fibLow);

  // Order block
  const ob = findOrderBlock(parsed, structure);

  // Key levels
  const keyLevels = findKeyLevels(parsed, swings);

  // ─── ENTRY ───
  const entry = lastClose; // Always the last close — no fantasy entries

  // ─── STOP LOSS ───
  // Beyond the most recent swing structure + ATR buffer
  const atrBuffer = atr * 0.3;
  let sl;
  if (direction === 'long') {
    sl = recentSwingLow.price - atrBuffer;
  } else {
    sl = recentSwingHigh.price + atrBuffer;
  }

  // Ensure SL isn't absurdly far (max 3x ATR from entry)
  const maxSLDist = atr * 3;
  const slDist = Math.abs(entry - sl);
  if (slDist > maxSLDist) {
    sl = direction === 'long' ? entry - maxSLDist : entry + maxSLDist;
  }
  // Ensure SL isn't absurdly close (min 0.5x ATR)
  const minSLDist = atr * 0.5;
  if (slDist < minSLDist) {
    sl = direction === 'long' ? entry - minSLDist : entry + minSLDist;
  }

  const finalSLDist = Math.abs(entry - sl);

  // ─── TAKE PROFITS ───
  // TP1: 1.5:1 RR minimum, try to align with a key level / Fibonacci
  // TP2: 2.5:1 RR minimum, try to align with a key level / extension
  let tp1, tp2;

  if (direction === 'long') {
    tp1 = entry + finalSLDist * 1.5;
    tp2 = entry + finalSLDist * 2.5;

    // Try to snap TP1 to nearest resistance / Fib if it improves the target
    const tp1Candidates = keyLevels
      .filter(l => l.price > entry && l.price >= tp1 * 0.95)
      .sort((a, b) => a.price - b.price);
    if (tp1Candidates.length > 0 && tp1Candidates[0].price < tp1 * 1.3) {
      tp1 = tp1Candidates[0].price;
    }

    // Snap TP2 to next level beyond TP1
    const tp2Candidates = keyLevels
      .filter(l => l.price > tp1 && l.price >= tp2 * 0.9)
      .sort((a, b) => a.price - b.price);
    if (tp2Candidates.length > 0 && tp2Candidates[0].price < tp2 * 1.5) {
      tp2 = tp2Candidates[0].price;
    }

    // Also check Fib extensions
    if (fibs['1.272'] > tp1 && fibs['1.272'] < tp2 * 1.2) tp2 = fibs['1.272'];
    if (fibs['1.618'] > tp2 && fibs['1.618'] < entry + finalSLDist * 4) tp2 = fibs['1.618'];

  } else {
    tp1 = entry - finalSLDist * 1.5;
    tp2 = entry - finalSLDist * 2.5;

    const tp1Candidates = keyLevels
      .filter(l => l.price < entry && l.price <= tp1 * 1.05)
      .sort((a, b) => b.price - a.price);
    if (tp1Candidates.length > 0 && tp1Candidates[0].price > tp1 * 0.7) {
      tp1 = tp1Candidates[0].price;
    }

    const tp2Candidates = keyLevels
      .filter(l => l.price < tp1 && l.price <= tp2 * 1.1)
      .sort((a, b) => b.price - a.price);
    if (tp2Candidates.length > 0 && tp2Candidates[0].price > tp2 * 0.5) {
      tp2 = tp2Candidates[0].price;
    }
  }

  // Ensure TP ordering + minimum RR (1.5:1 TP1, 2.5:1 TP2)
  // Previous floor was 1:1 for TP1 — allowed S/R snap to produce negative-EV targets
  if (direction === 'long') {
    if (tp1 <= entry || (tp1 - entry) < finalSLDist * 1.5) tp1 = entry + finalSLDist * 1.5;
    if (tp2 <= tp1 || (tp2 - entry) < finalSLDist * 2.5) tp2 = entry + finalSLDist * 2.5;
  } else {
    if (tp1 >= entry || (entry - tp1) < finalSLDist * 1.5) tp1 = entry - finalSLDist * 1.5;
    if (tp2 >= tp1 || (entry - tp2) < finalSLDist * 2.5) tp2 = entry - finalSLDist * 2.5;
  }

  // ─── CONFLUENCE & CONFIDENCE ───
  const confluence = findConfluence(entry, fibs, ob, keyLevels, atr);

  // Setup type — base classification then pattern override
  let setupType = classifySetup(structure, swings, parsed);
  const HARMONIC_NAMES = ['Gartley', 'Bat', 'Butterfly', 'Crab'];
  const hasConfirmedReversal = patterns.some(p =>
    p.confirmed &&
    ['Head & Shoulders', 'Inverse Head & Shoulders', 'Double Top', 'Double Bottom',
     ...HARMONIC_NAMES].includes(p.name)
  );
  if (hasConfirmedReversal) {
    setupType = 'reversal';
  } else if (patterns.some(p => p.name.includes('Triangle') || p.name.includes('Broadening'))) {
    if (setupType !== 'breakout') setupType = 'breakout_pending';
  }

  const confidence = computeConfidence(confluence, structure, ctx, patterns, direction);

  // ─── REASONING ───
  const reasoning = generateReasoning(direction, structure, setupType, confluence, ctx, entry, sl, ob, patterns);

  // ─── PRECISION ── match asset price precision
  const decimals = getDecimals(lastClose);

  return {
    pair:       pair || 'UNKNOWN',
    timeframe:  timeframe || 'auto',
    direction,
    setup_type: setupType,
    entry:      +entry.toFixed(decimals),
    sl:         +sl.toFixed(decimals),
    tp1:        +tp1.toFixed(decimals),
    tp2:        +tp2.toFixed(decimals),
    confidence,
    reasoning,
    patterns:   patterns.map(p => ({
      name:        p.name,
      type:        p.type,
      confirmed:   p.confirmed,
      priceTarget: p.priceTarget != null ? +p.priceTarget.toFixed(decimals) : null,
      neckline:    p.neckline    != null ? +p.neckline.toFixed(decimals)    : null,
      confidence:  p.confidence,
      // Harmonic-specific fields (undefined for non-harmonic patterns)
      inPRZ:  p.inPRZ  != null ? p.inPRZ  : undefined,
      points: p.points != null ? Object.fromEntries(
        Object.entries(p.points).map(([k, v]) => [k, +v.toFixed(decimals)])
      ) : undefined,
      ratios: p.ratios != null ? p.ratios : undefined,
    })),
    // Harmonic PRZ flag — true if price is currently inside a PRZ
    harmonic_prz: patterns.some(p => p.inPRZ),

    // Context tags
    ctx_trend:      ctx.trend,
    ctx_session:    ctx.session,
    ctx_volatility: ctx.volatility,
    // Analysis metadata (for transparency)
    _analysis: {
      structure,
      swingHigh:  recentSwingHigh,
      swingLow:   recentSwingLow,
      orderBlock: ob,
      fibLevels:  fibs,
      keyLevels:  keyLevels.slice(0, 5),
      confluence,
      trendSlope,
      atr:        +atr.toFixed(decimals),
      atrPct:     ctx.atrPct,
    }
  };
}


/* ── Helper: decimal precision ── */
function getDecimals(price) {
  if (price >= 1000) return 2;
  if (price >= 10) return 2;
  if (price >= 1) return 4;
  if (price >= 0.01) return 5;
  return 6;
}


/* ═════════════════════════════════════════════════════════
   OUTCOME CHECKER
   Checks if pending sniper signals hit TP or SL
   using cached OANDA candle data.
   ═════════════════════════════════════════════════════════ */

function checkSignalOutcome(signal, candlesAfter) {
  if (!candlesAfter || candlesAfter.length === 0) return null;

  const isLong = (signal.direction || '').toLowerCase() === 'long';
  const entry  = +signal.entry;
  const sl     = +signal.sl;
  const tp1    = +signal.tp1;
  const tp2    = +signal.tp2;

  // Walk through candles chronologically — first hit wins
  let tp1Hit = false;

  for (let i = 0; i < candlesAfter.length; i++) {
    const c = candlesAfter[i];
    const high = +c.h, low = +c.l;

    if (isLong) {
      // Check SL first (intra-bar: if low went below SL)
      if (low <= sl) {
        return { outcome: 'sl_hit', actual_price: sl, bars: i + 1 };
      }
      // Check TP2 (if TP1 already hit)
      if (tp1Hit && high >= tp2) {
        return { outcome: 'tp2_hit', actual_price: tp2, bars: i + 1 };
      }
      // Check TP1
      if (!tp1Hit && high >= tp1) {
        tp1Hit = true;
        // Don't return yet — check if TP2 also hit in same bar
        if (high >= tp2) {
          return { outcome: 'tp2_hit', actual_price: tp2, bars: i + 1 };
        }
      }
    } else {
      // Short: SL above, TP below
      if (high >= sl) {
        return { outcome: 'sl_hit', actual_price: sl, bars: i + 1 };
      }
      if (tp1Hit && low <= tp2) {
        return { outcome: 'tp2_hit', actual_price: tp2, bars: i + 1 };
      }
      if (!tp1Hit && low <= tp1) {
        tp1Hit = true;
        if (low <= tp2) {
          return { outcome: 'tp2_hit', actual_price: tp2, bars: i + 1 };
        }
      }
    }
  }

  // TP1 hit but TP2 not yet
  if (tp1Hit) {
    return { outcome: 'tp1_hit', actual_price: tp1, bars: candlesAfter.length };
  }

  return null; // Still pending
}


/* ═════════════════════════════════════════════════════════
   EXPORTS
   ═════════════════════════════════════════════════════════ */

module.exports = {
  sniperSignal,
  checkSignalOutcome,
  // Pattern detection (exposed for testing / direct use)
  detectPatterns,
  detectHeadAndShoulders,
  detectDoubleTopBottom,
  detectTriangle,
  detectBroadening,
  detectCandlestickPatterns,
  // Internals (exposed for testing)
  detectSwings,
  getSwingParams,
  getStructure,
  calcFibLevels,
  findOrderBlock,
  findKeyLevels,
  computeContext,
  classifySetup,
  calcATR,
  calcSMA,
  linearRegression,
  getTrendSlope,
};
