/* ═══════════════════════════════════════════════════════════════
   SNIPER ENGINE — Pure algorithmic trade signal generator
   No AI. No API calls. Pure math.
   
   Methods: SMC structure, S/R levels, Fibonacci confluence
   Output: { direction, entry, sl, tp1, tp2, confidence, reasoning, ... }
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ── 1. SWING DETECTION ── 
   A swing high is a candle whose high is higher than `left` candles before
   and `right` candles after. Vice versa for swing low. */

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

  // Also add round-number levels within data range
  const allPrices = candles.map(c => +c.h).concat(candles.map(c => +c.l));
  const dataMin = Math.min(...allPrices);
  const dataMax = Math.max(...allPrices);

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

function findConfluence(entry, fibs, orderBlock, keyLevels, tolerancePct = 0.005) {
  let score = 0;
  const factors = [];

  // Check Fibonacci levels near entry
  for (const [level, price] of Object.entries(fibs)) {
    if (Math.abs(price - entry) / Math.max(entry, 0.0001) < tolerancePct) {
      score += level === '0.618' ? 3 : level === '0.500' ? 2 : 1;
      factors.push(`Fib ${level}`);
    }
  }

  // Check order block zone
  if (orderBlock) {
    if (entry >= orderBlock.low && entry <= orderBlock.high) {
      score += 3;
      factors.push(`${orderBlock.type} OB`);
    } else if (Math.abs(entry - orderBlock.high) / Math.max(entry, 0.0001) < tolerancePct * 2) {
      score += 1;
      factors.push(`near ${orderBlock.type} OB`);
    }
  }

  // Check S/R levels near entry
  for (const lvl of keyLevels.slice(0, 5)) {
    if (Math.abs(lvl.price - entry) / Math.max(entry, 0.0001) < tolerancePct) {
      score += 2;
      factors.push(`S/R (${lvl.touches} touches)`);
      break; // Only count once
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

  // SESSION (based on current UTC hour)
  const utcHour = new Date().getUTCHours();
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

function computeConfidence(confluence, structure, ctx) {
  let conf = 30; // base

  // Confluence factors (0-30 pts)
  conf += Math.min(30, confluence.score * 6);

  // Clear structure (0-20 pts)
  if (structure === 'bullish' || structure === 'bearish') conf += 15;
  else conf += 5;

  // Trend alignment (0-15 pts)
  if (ctx.trend === 'uptrend' && structure === 'bullish') conf += 15;
  else if (ctx.trend === 'downtrend' && structure === 'bearish') conf += 15;
  else if (ctx.trend === 'ranging') conf += 5;
  else conf += 0; // counter-trend = no bonus

  // Volatility (0-10 pts — medium is best for structured signals)
  if (ctx.volatility === 'medium') conf += 10;
  else if (ctx.volatility === 'low') conf += 5;
  else if (ctx.volatility === 'high') conf += 3;
  // extreme = no bonus

  return Math.min(95, Math.max(15, conf));
}


/* ── 12. TEMPLATE-BASED REASONING ── */

function generateReasoning(direction, structure, setupType, confluence, ctx, entry, sl, ob) {
  const dir = direction.toUpperCase();
  const structDesc = structure === 'bullish' ? 'HH/HL' : structure === 'bearish' ? 'LH/LL' : 'range';

  const parts = [`${dir}: ${structure} structure (${structDesc})`];

  if (confluence.factors.length > 0) {
    parts.push(`entry at ${confluence.factors.join(' + ')} confluence`);
  }

  if (ob) {
    parts.push(`${ob.type} OB at ${ob.low.toFixed(2)}-${ob.high.toFixed(2)}`);
  }

  parts.push(`SL beyond swing ${direction === 'long' ? 'low' : 'high'}`);

  if (setupType !== 'unknown') {
    parts.push(`setup: ${setupType.replace('_', ' ')}`);
  }

  if (ctx.trend !== structure && ctx.trend !== 'ranging') {
    parts.push(`⚠ counter-trend`);
  }

  return parts.join('. ') + '.';
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
  const swings    = detectSwings(parsed);
  const structure = getStructure(swings);
  const ctx       = computeContext(parsed, pair, timeframe);

  if (swings.highs.length < 1 || swings.lows.length < 1) {
    return { error: 'Insufficient swing structure detected' };
  }

  // Direction — follow structure, with trend as tiebreaker
  let direction;
  if (structure === 'bullish') direction = 'long';
  else if (structure === 'bearish') direction = 'short';
  else {
    // Ranging — follow trend, default to long if no trend
    direction = ctx.trend === 'downtrend' ? 'short' : 'long';
  }

  // Key prices
  const lastClose = parsed[len - 1].c;
  const allHighs  = parsed.map(c => c.h);
  const allLows   = parsed.map(c => c.l);
  const dataMax   = Math.max(...allHighs);
  const dataMin   = Math.min(...allLows);
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

  // Ensure TP ordering
  if (direction === 'long') {
    if (tp1 <= entry) tp1 = entry + finalSLDist * 1.5;
    if (tp2 <= tp1) tp2 = tp1 + finalSLDist;
  } else {
    if (tp1 >= entry) tp1 = entry - finalSLDist * 1.5;
    if (tp2 >= tp1) tp2 = tp1 - finalSLDist;
  }

  // ─── CONFLUENCE & CONFIDENCE ───
  const confluence = findConfluence(entry, fibs, ob, keyLevels);
  const setupType  = classifySetup(structure, swings, parsed);
  const confidence = computeConfidence(confluence, structure, ctx);

  // ─── REASONING ───
  const reasoning = generateReasoning(direction, structure, setupType, confluence, ctx, entry, sl, ob);

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
    // Context tags
    ctx_trend:      ctx.trend,
    ctx_session:    ctx.session,
    ctx_volatility: ctx.volatility,
    // Analysis metadata (for transparency)
    _analysis: {
      structure,
      swingHigh: recentSwingHigh,
      swingLow:  recentSwingLow,
      orderBlock: ob,
      fibLevels:  fibs,
      keyLevels:  keyLevels.slice(0, 5),
      confluence: confluence,
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
  // Expose internals for testing
  detectSwings,
  getStructure,
  calcFibLevels,
  findOrderBlock,
  findKeyLevels,
  computeContext,
  classifySetup,
  calcATR,
  calcSMA,
};
