/* ═══════════════════════════════════════════════════════════════
   BACKTEST ENGINE — Walk-forward signal simulation
   No AI. No API calls. Pure math.

   Uses sniperSignal() (with all pattern detection) as the strategy.
   Walks through candles bar by bar, fires signals, tracks outcomes.

   Output: { trades[], metrics{}, equityCurve[], monteCarlo{} }
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const { sniperSignal } = require('./sniper-engine');

const LOOKBACK = 150; // bars fed to sniperSignal each iteration
const MIN_GAP  = 10;  // minimum bars between new entries


/* ═══════════════════════════════════════════════════════
   MAIN ENTRY: runBacktest()
   ═══════════════════════════════════════════════════════ */

function runBacktest(candles, opts = {}) {
  const minConf     = opts.minConfidence || 50;
  const startEquity = opts.startEquity   || 10000;
  const riskPct     = opts.riskPct       || 0.01; // 1% risk per trade
  const btPair      = opts.pair          || 'BT';
  const btTimeframe = opts.timeframe     || '1h';

  // Cost model, expressed in R (multiples of SL distance) so it's instrument-agnostic.
  // costR covers round-trip spread + commission; slippageR is extra loss only on SL fills
  // (TPs are limit orders and fill at price, stops slip through in fast moves).
  // Defaults match typical retail FX: ~1-pip spread + $3.5/lot commission on a ~20-pip SL.
  const costR       = opts.costR       != null ? opts.costR       : 0.05;
  const slippageR   = opts.slippageR   != null ? opts.slippageR   : 0.02;

  const MIN_CANDLES = LOOKBACK + 20;
  if (!candles || candles.length < MIN_CANDLES) {
    return { error: `Need at least ${MIN_CANDLES} candles for backtest (got ${candles ? candles.length : 0})` };
  }

  const trades     = [];
  let openTrade    = null;
  let lastEntryBar = -(MIN_GAP + 1);

  for (let i = LOOKBACK; i < candles.length; i++) {
    const c = candles[i];

    /* ── Check open trade against this bar ── */
    if (openTrade) {
      const isLong = openTrade.direction === 'long';
      let outcome  = null;

      // SL has priority — worst-case intrabar assumption
      if      (isLong  && c.l <= openTrade.sl)  outcome = 'sl_hit';
      else if (!isLong && c.h >= openTrade.sl)  outcome = 'sl_hit';
      else if (isLong  && c.h >= openTrade.tp2) outcome = 'tp2_hit';
      else if (!isLong && c.l <= openTrade.tp2) outcome = 'tp2_hit';
      else if (isLong  && c.h >= openTrade.tp1) outcome = 'tp1_hit';
      else if (!isLong && c.l <= openTrade.tp1) outcome = 'tp1_hit';

      if (outcome) {
        const grossR = outcome === 'sl_hit'  ? -1.0
                     : outcome === 'tp2_hit' ? openTrade.rr2
                     : openTrade.rr1;
        const pnlR = grossR - costR - (outcome === 'sl_hit' ? slippageR : 0);

        trades.push({
          ...openTrade,
          outcome,
          pnlR:     +pnlR.toFixed(3),
          exitBar:  i,
          exitTime: c.t,
          barsHeld: i - openTrade.entryBar,
        });
        openTrade = null;
      }
      continue; // never open a new trade while one is active
    }

    /* ── Minimum bar spacing between entries ── */
    if (i - lastEntryBar < MIN_GAP) continue;

    /* ── Run sniper on lookback window ── */
    const window = candles.slice(i - LOOKBACK, i + 1);
    const sig    = sniperSignal(window, btPair, btTimeframe);
    if (sig.error || sig.confidence < minConf) continue;

    /* ── Compute RR (sniperSignal gives raw prices) ── */
    const slDist = Math.abs(sig.entry - sig.sl);
    if (slDist === 0) continue;
    const rr1 = Math.abs(sig.tp1 - sig.entry) / slDist;
    const rr2 = Math.abs(sig.tp2 - sig.entry) / slDist;

    lastEntryBar = i;
    openTrade = {
      direction:  sig.direction,
      setup_type: sig.setup_type,
      confidence: sig.confidence,
      patterns:   sig.patterns || [],
      entry:      sig.entry,
      sl:         sig.sl,
      tp1:        sig.tp1,
      tp2:        sig.tp2,
      rr1:        +rr1.toFixed(2),
      rr2:        +rr2.toFixed(2),
      entryBar:   i,
      entryTime:  c.t,
    };
  }

  /* ── Close any still-open trade at last bar's close ── */
  if (openTrade) {
    const last   = candles[candles.length - 1];
    const isLong = openTrade.direction === 'long';
    const grossR = isLong
      ? (last.c - openTrade.entry) / (openTrade.entry - openTrade.sl)
      : (openTrade.entry - last.c) / (openTrade.sl    - openTrade.entry);
    const pnlR  = grossR - costR;

    trades.push({
      ...openTrade,
      outcome:  'open',
      pnlR:     +pnlR.toFixed(3),
      exitBar:  candles.length - 1,
      exitTime: last.t,
      barsHeld: candles.length - 1 - openTrade.entryBar,
    });
  }

  return buildResults(trades, startEquity, riskPct, { costR, slippageR });
}


/* ═══════════════════════════════════════════════════════
   METRICS + EQUITY CURVE
   ═══════════════════════════════════════════════════════ */

function buildResults(trades, startEquity, riskPct, costs = { costR: 0, slippageR: 0 }) {
  if (trades.length === 0) {
    return {
      trades:      [],
      metrics:     null,
      equityCurve: [startEquity],
      monteCarlo:  null,
    };
  }

  const closed = trades.filter(t => t.outcome !== 'open');
  const wins   = closed.filter(t => t.outcome !== 'sl_hit');
  const losses = closed.filter(t => t.outcome === 'sl_hit');

  /* ── Equity curve ── */
  let equity = startEquity;
  const equityCurve = [+equity.toFixed(2)];
  for (const t of trades) {
    equity += equity * riskPct * t.pnlR;
    equityCurve.push(+Math.max(0, equity).toFixed(2));
  }

  /* ── Core metrics ── */
  const winRate      = closed.length > 0 ? wins.length / closed.length : 0;
  const grossWin     = wins.reduce((s, t) => s + t.pnlR, 0);
  const grossLoss    = Math.abs(losses.reduce((s, t) => s + t.pnlR, 0));
  const profitFactor = grossLoss > 0 ? grossWin / grossLoss : (grossWin > 0 ? 99 : 0);
  const netPnlR      = closed.reduce((s, t) => s + t.pnlR, 0);

  /* ── Max drawdown ── */
  let peak = startEquity, maxDD = 0;
  for (const eq of equityCurve) {
    if (eq > peak) peak = eq;
    const dd = peak > 0 ? (peak - eq) / peak : 0;
    if (dd > maxDD) maxDD = dd;
  }

  /* ── Sharpe ratio (trade-level R multiples) ── */
  const pnlRs = closed.map(t => t.pnlR);
  const meanR = pnlRs.length > 0 ? pnlRs.reduce((s, x) => s + x, 0) / pnlRs.length : 0;
  const varR  = pnlRs.length > 1
    ? pnlRs.reduce((s, x) => s + (x - meanR) ** 2, 0) / (pnlRs.length - 1)
    : 0;
  const stdR  = Math.sqrt(varR);
  // Scale by sqrt(n trades) — gives a comparable signal-to-noise metric
  const sharpe = stdR > 0 ? (meanR / stdR) * Math.sqrt(closed.length) : 0;

  /* ── Avg bars held ── */
  const avgBars = closed.length > 0
    ? closed.reduce((s, t) => s + t.barsHeld, 0) / closed.length
    : 0;

  /* ── Pattern edge — win rate with vs without confirmed patterns ── */
  const withPat    = closed.filter(t => t.patterns && t.patterns.some(p => p.confirmed));
  const withoutPat = closed.filter(t => !t.patterns || !t.patterns.some(p => p.confirmed));
  const patWR      = withPat.length > 0
    ? withPat.filter(t => t.outcome !== 'sl_hit').length / withPat.length
    : null;
  const noPatWR    = withoutPat.length > 0
    ? withoutPat.filter(t => t.outcome !== 'sl_hit').length / withoutPat.length
    : null;

  return {
    trades: trades.map(t => ({
      direction:  t.direction,
      setup_type: t.setup_type,
      confidence: t.confidence,
      patterns:   (t.patterns || []).filter(p => p.confirmed).map(p => p.name),
      entry:      t.entry,
      sl:         t.sl,
      tp1:        t.tp1,
      tp2:        t.tp2,
      rr1:        t.rr1,
      rr2:        t.rr2,
      outcome:    t.outcome,
      pnlR:       t.pnlR,
      barsHeld:   t.barsHeld,
      entryTime:  t.entryTime,
      exitTime:   t.exitTime,
    })),
    metrics: {
      totalTrades:      trades.length,
      closedTrades:     closed.length,
      wins:             wins.length,
      losses:           losses.length,
      winRate:          +winRate.toFixed(4),
      profitFactor:     +Math.min(profitFactor, 99).toFixed(2),
      sharpe:           +sharpe.toFixed(2),
      maxDrawdown:      +maxDD.toFixed(4),
      netPnlR:          +netPnlR.toFixed(2),
      finalEquity:      +equityCurve[equityCurve.length - 1].toFixed(2),
      startEquity,
      avgBarsHeld:      +avgBars.toFixed(1),
      patternWinRate:   patWR   != null ? +patWR.toFixed(4)   : null,
      noPatternWinRate: noPatWR != null ? +noPatWR.toFixed(4) : null,
      costR:            costs.costR,
      slippageR:        costs.slippageR,
    },
    equityCurve,
    monteCarlo: runMonteCarlo(closed, startEquity, riskPct),
  };
}


/* ═══════════════════════════════════════════════════════
   MONTE CARLO SIMULATION
   Randomly shuffles the trade sequence 1000 times to test
   whether the edge is robust or just lucky sequencing.
   ═══════════════════════════════════════════════════════ */

function runMonteCarlo(trades, startEquity, riskPct, iterations = 1000) {
  if (trades.length === 0) return null;

  // Bootstrap with replacement: each run picks trades.length trades randomly
  // from the trade pool (with repetition). This produces genuine variance in
  // final equity — unlike shuffling, which is commutative with % sizing.
  const finals = [];
  const n = trades.length;
  for (let i = 0; i < iterations; i++) {
    let eq = startEquity;
    for (let j = 0; j < n; j++) {
      const t = trades[Math.floor(Math.random() * n)];
      eq += eq * riskPct * t.pnlR;
      if (eq <= 0) { eq = 0; break; }
    }
    finals.push(eq);
  }

  finals.sort((a, b) => a - b);
  return {
    p5:        +finals[Math.floor(iterations * 0.05)].toFixed(2),
    p50:       +finals[Math.floor(iterations * 0.50)].toFixed(2),
    p95:       +finals[Math.floor(iterations * 0.95)].toFixed(2),
    worstCase: +finals[0].toFixed(2),
    bestCase:  +finals[finals.length - 1].toFixed(2),
  };
}


/* ═══════════════════════════════════════════════════════
   EXPORTS
   ═══════════════════════════════════════════════════════ */

module.exports = { runBacktest };
