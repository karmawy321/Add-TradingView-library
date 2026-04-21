'use strict';

const store = require('../candleStore');
const sse   = require('../sse');

// ─── Config ───────────────────────────────────────────────────────────────────
const SOURCE = 'oanda';

const METAAPI_TOKEN      = process.env.METAAPI_TOKEN      || '';
const METAAPI_ACCOUNT_ID = '620f74cf-9c2e-46d0-8073-36ab51e621c0';

const TF_MS = {
  '1m':60000, '5m':300000, '15m':900000, '30m':1800000,
  '1h':3600000, '4h':14400000, '1d':86400000, '1w':604800000,
};
const TIMEFRAMES = Object.keys(TF_MS);
// Only these TFs are safe to bucket from live ticks using UTC alignment.
// 4h/1d/1w are derived from 1h via _aggregate (UTC-aligned) — MetaAPI REST
// returns broker-offset timestamps for those TFs which caused wrong/duplicate bars.
const TICK_TFS = ['1m', '5m', '15m', '30m', '1h'];

// Full history targets per TF
const FULL_LIMITS = {
  '1w': 5000, '1d': 5000, '4h': 7000, '1h': 17000,
  '30m': 3000, '15m': 3000, '5m': 3000, '1m': 11000,
};

const PAGE_SIZE = 1000; // max candles per MetaAPI call

// ─── Symbol map: internal → OANDA MT5 broker name ────────────────────────────
// NOTE: broker may rename symbols (e.g. .pro → .sml). _discoverBrokerSymbols()
// auto-remaps this at connect time so we always use the current broker name.
const SYMBOL_MAP = {
  /* Metals / Commodities */
  'XAUUSD':   'GOLD.pro',
  'XAGUSD':   'SILVER.pro',
  'OILWTI':   'OILWTI.pro',
  /* Forex majors */
  'EURUSD':   'EURUSD.pro',
  'GBPUSD':   'GBPUSD.pro',
  'USDJPY':   'USDJPY.pro',
  'USDCHF':   'USDCHF.pro',
  'AUDUSD':   'AUDUSD.pro',
  'NZDUSD':   'NZDUSD.pro',
  'USDCAD':   'USDCAD.pro',
  /* Forex crosses (highest-volume JPY crosses) */
  'EURJPY':   'EURJPY.pro',
  'GBPJPY':   'GBPJPY.pro',
  /* Indices (US majors) */
  'US500':    'US500.pro',
  'US30':     'US30.pro',
  'US100':    'US100.pro',
  /* Equity CFDs — moved to TwelveData (real exchange data, avoids source conflict) */
};

// Reverse map: broker symbol → internal
const _brokerToInternal = {};
for (const [k, v] of Object.entries(SYMBOL_MAP)) _brokerToInternal[v] = k;

// ─── State ────────────────────────────────────────────────────────────────────
let _account     = null;
let _rpcConn     = null;
let _streamConn  = null;
let _streamStarted = false;
let _streamStatus  = {};  // brokerSym → status string
let _ready         = false;
let _status        = 'disconnected';
let _lastSeen      = null;
let _retryCount    = 0;
let _watchdog      = null;
let _lastBrokerList = [];

// Last known bid per internal symbol — used by forward-fill timer to open
// new bars at minute boundary even if MetaAPI relay lag delays first tick.
const _lastPrice = {};
let _fwdFillTimer = null;

// Cache progress (exposed for admin endpoint)
const progress = {
  active: false, currentSym: null, currentTF: null,
  symDone: 0, symTotal: 0, tfDone: 0, tfTotal: 0, pct: 0,
  startedAt: null, log: [],
};

function _pLog(msg) {
  progress.log.push({ t: new Date().toISOString(), msg });
  if (progress.log.length > 20) progress.log.shift();
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function _delay(ms) { return new Promise(r => setTimeout(r, ms)); }

function _maToCandle(c) {
  return { t: new Date(c.time).getTime(), o: c.open, h: c.high, l: c.low, c: c.close, v: c.tickVolume || 0 };
}

// Aggregate lower-TF candles into higher TF (OHLCV rollup)
function _aggregate(src, periodMs) {
  const out = [];
  for (const c of src) {
    const bucket = Math.floor(c.t / periodMs) * periodMs;
    const last   = out[out.length - 1];
    if (!last || last.t !== bucket) {
      out.push({ t: bucket, o: c.o, h: c.h, l: c.l, c: c.c, v: c.v });
    } else {
      last.h = Math.max(last.h, c.h);
      last.l = Math.min(last.l, c.l);
      last.c = c.c;
      last.v += c.v;
    }
  }
  return out;
}

// ─── Broker symbol discovery ──────────────────────────────────────────────────
// OANDA renames symbols periodically (.pro → .sml). This auto-remaps SYMBOL_MAP
// to whatever names the broker currently exposes.
async function _discoverBrokerSymbols() {
  if (!_rpcConn) return;
  try {
    const brokerSymbols = await _rpcConn.getSymbols();
    if (!brokerSymbols || !brokerSymbols.length) return;
    _lastBrokerList = brokerSymbols.map(bs => bs.symbol || bs).sort();

    const baseToSuffixes = new Map();
    for (const bs of brokerSymbols) {
      const name = bs.symbol || bs;
      const base = name.toUpperCase().replace(/\..*/,'');
      if (!baseToSuffixes.has(base)) baseToSuffixes.set(base, []);
      baseToSuffixes.get(base).push(name);
    }

    const SUFFIX_PRIORITY = ['.sml', '.pro', '.raw', ''];
    function pickBest(base) {
      const avail = baseToSuffixes.get(base);
      if (!avail) return null;
      for (const pref of SUFFIX_PRIORITY) {
        const m = avail.find(s => s.toLowerCase().endsWith(pref.toLowerCase()));
        if (m) return m;
      }
      return avail[0];
    }

    let remapped = 0;
    for (const [internalSym, oldBroker] of Object.entries(SYMBOL_MAP)) {
      const internalBase = internalSym.toUpperCase().replace(/\..*/,'');
      let found = pickBest(internalBase);
      if (!found) {
        const oldBase = oldBroker.toUpperCase().replace(/\..*/,'');
        found = pickBest(oldBase);
      }
      if (found && found !== oldBroker) {
        console.log(`[OANDA] Remapped ${internalSym}: ${oldBroker} → ${found}`);
        SYMBOL_MAP[internalSym] = found;
        _brokerToInternal[found] = internalSym;
        delete _brokerToInternal[oldBroker];
        remapped++;
      } else if (!found) {
        console.warn(`[OANDA] No broker match for ${internalSym} (was: ${oldBroker})`);
      }
    }
    console.log(`[OANDA] Symbol discovery: ${remapped} remapped`);
  } catch(e) {
    console.warn('[OANDA] _discoverBrokerSymbols error:', e.message);
  }
}

// ─── MetaAPI streaming ────────────────────────────────────────────────────────
// Symbols OANDA does not stream (broker limitation)
const STREAM_UNSUPPORTED = new Set(['ADAUSD', 'LTCUSD']);

async function startStream() {
  if (!_account || _streamStarted) return;
  _streamStarted = true;
  try {
    console.log('[OANDA] Starting streaming connection...');
    _streamConn = _account.getStreamingConnection();

    function _onPrice(price) {
      try {
        const bid = price.bid, ask = price.ask;
        if (!bid && !ask) return;
        // Use bid price (MT5 default chart price) — mid diverges from bid
        // when spread widens and causes red/green inversions vs MT5.
        const px   = bid || ask;
        const ts   = price.time ? new Date(price.time).getTime() : Date.now();
        const sym  = _brokerToInternal[price.symbol];
        if (!sym) return;
        _lastSeen = Date.now();
        _lastPrice[sym] = px; // for forward-fill synth bars
        // Only tick-aggregate TFs whose broker alignment matches UTC (<= 1h).
        // 4h/1d/1w use broker-local midnight alignment (UTC±2/3), so local
        // UTC bucketing would place tick-built bars at different timestamps
        // than MetaAPI REST bars → duplicate bars every 2h. REST backfill
        // owns 4h/1d/1w exclusively.
        for (const tf of TICK_TFS) {
          store.writeTick(SOURCE, sym, tf, TF_MS[tf], px, 0, ts);
        }
      } catch(e) { /* ignore per-tick errors */ }
    }

    _streamConn.addSynchronizationListener({
      onSymbolPriceUpdated(_i, price)   { _onPrice(price); },
      onSymbolPricesUpdated(_i, prices) { (prices || []).forEach(_onPrice); },
      onConnected()                     { console.log('[OANDA] Stream connected'); },
      onDisconnected()                  { console.log('[OANDA] Stream disconnected'); },
    });

    await _streamConn.connect();
    try {
      await _streamConn.waitSynchronized({ timeoutInSeconds: 60 });
      console.log('[OANDA] Stream synchronized');
    } catch(e) {
      console.warn('[OANDA] Sync timeout — proceeding anyway:', e.message);
    }

    const brokerSyms = Object.values(SYMBOL_MAP).filter(s => !STREAM_UNSUPPORTED.has(s));
    console.log(`[OANDA] Subscribing ${brokerSyms.length} symbols...`);
    for (const brokerSym of brokerSyms) {
      _streamStatus[brokerSym] = 'pending';
      try {
        await _streamConn.subscribeToMarketData(brokerSym);
        _streamStatus[brokerSym] = 'subscribed';
      } catch(e) {
        _streamStatus[brokerSym] = 'failed: ' + e.message;
        console.warn(`[OANDA] Stream ${brokerSym} ✗:`, e.message);
      }
      await _delay(200);
    }
    const ok   = Object.values(_streamStatus).filter(v => v === 'subscribed').length;
    const fail = Object.values(_streamStatus).filter(v => v.startsWith('failed')).length;
    console.log(`[OANDA] Stream done — ${ok} subscribed, ${fail} failed`);
  } catch(e) {
    console.error('[OANDA] Streaming failed:', e.message);
    _streamStarted = false;
  }
}

// ─── History fetch ────────────────────────────────────────────────────────────
async function _fetchRawCandles(maSym, tf, startTime, limit) {
  if (!_account) return [];
  try {
    const raw = await _account.getHistoricalCandles(maSym, tf, startTime, limit);
    return (raw || []).map(_maToCandle);
  } catch(e) {
    console.error('[OANDA] fetchRawCandles error:', e.message);
    return [];
  }
}

// ─── Phase 1: recent fetch (fast, priority) ──────────────────────────────────
// Pull last N canonical bars per TF. Uses replaceBar so any tick-built bars
// get corrected with broker-authoritative OHLC.
const RECENT_SIZE = 200;

async function fetchRecent(internalSym) {
  if (!_ready) return;
  const maSym = SYMBOL_MAP[internalSym];
  if (!maSym) return;
  const now = new Date();
  try {
    for (const tf of TIMEFRAMES) {
      progress.currentTF = tf;
      try {
        const batch = await _fetchRawCandles(maSym, tf, now, RECENT_SIZE);
        for (const c of batch) store.replaceBar(SOURCE, internalSym, tf, c);
        if (batch.length) console.log(`[OANDA] ${internalSym} ${tf}: ${batch.length} recent`);
      } catch(e) { /* ignore per-TF errors */ }
      progress.tfDone++;
      await _delay(150);
    }
    _pLog(`Recent: ${internalSym}`);
    store.saveToDisk(SOURCE, internalSym);

    // Push snapshot to any SSE clients watching this symbol
    const snap = {};
    for (const tf of TIMEFRAMES) {
      const arr = store.readCandles(SOURCE, internalSym, tf);
      if (arr.length) snap[tf] = arr;
    }
    sse.pushEvent(SOURCE, internalSym, { type: 'snapshot', source: SOURCE, symbol: internalSym, candles: snap });
  } catch(e) {
    console.error('[OANDA] fetchRecent error:', e.message);
  }
}

// ─── Phase 2: lazy backfill queue ────────────────────────────────────────────
// Pulls older bars in background chunks. Yields to fast-refresh (Layer 2
// priority). A user opening a chart for a sym promotes that sym to the front
// of the queue via promoteBackfill().
const _backfillQueue = []; // items: { sym, tf }
let _backfillWorking = false;
let _backfillTimer   = null;
const BACKFILL_GAP   = 2000; // ms between chunks
const BACKFILL_CHUNK = 1000; // bars per chunk

function _enqueueBackfill(sym, tf) {
  if (_backfillQueue.some(q => q.sym === sym && q.tf === tf)) return;
  _backfillQueue.push({ sym, tf });
}

function promoteBackfill(sym) {
  const mine = _backfillQueue.filter(q => q.sym === sym);
  if (!mine.length) return;
  const rest = _backfillQueue.filter(q => q.sym !== sym);
  _backfillQueue.length = 0;
  _backfillQueue.push(...mine, ...rest);
}

async function _backfillStep() {
  if (_backfillWorking || !_ready || _fastRefreshing) return;
  if (!_backfillQueue.length) return;
  _backfillWorking = true;
  try {
    const { sym, tf } = _backfillQueue[0];
    const maSym = SYMBOL_MAP[sym];
    if (!maSym) { _backfillQueue.shift(); return; }

    const existing = store.readCandles(SOURCE, sym, tf);
    const target   = FULL_LIMITS[tf] || 1000;
    if (existing.length >= target) { _backfillQueue.shift(); return; }

    // Fetch backward from the oldest bar we already have
    const oldestT  = existing.length ? existing[0].t : Date.now();
    const fromTime = new Date(oldestT - 1);
    const limit    = Math.min(BACKFILL_CHUNK, target - existing.length);
    const batch    = await _fetchRawCandles(maSym, tf, fromTime, limit);

    if (batch.length) store.writeCandles(SOURCE, sym, tf, batch);
    // Source exhausted or target reached → drop from queue
    if (!batch.length || batch.length < limit) {
      _backfillQueue.shift();
      store.saveToDisk(SOURCE, sym);
    }
  } catch(e) {
    _backfillQueue.shift(); // drop on error to unblock queue
  } finally {
    _backfillWorking = false;
  }
}

function _startBackfillWorker() {
  if (_backfillTimer) return;
  _backfillTimer = setInterval(() => {
    _backfillStep().catch(e => console.warn('[OANDA] Backfill step error:', e.message));
  }, BACKFILL_GAP);
  _backfillTimer.unref && _backfillTimer.unref();
  console.log(`[OANDA] Backfill worker started (${BACKFILL_GAP}ms cadence, ${BACKFILL_CHUNK} bars/chunk)`);
}

function getBackfillStatus() {
  return { queued: _backfillQueue.length, working: _backfillWorking };
}

// ─── Full cache refresh (called from admin endpoint) ─────────────────────────
let _refreshing        = false;
let _initialRefreshDone = false; // first run = always full fetch

async function refreshAllCache() {
  if (!_ready || _refreshing) return;
  _refreshing = true;
  const syms = Object.keys(SYMBOL_MAP);
  Object.assign(progress, {
    active: true, symDone: 0, symTotal: syms.length,
    tfDone: 0, tfTotal: syms.length * TIMEFRAMES.length,
    pct: 0, startedAt: new Date().toISOString(), log: [],
  });
  _pLog(`Phase 1 started: recent bars (${syms.length} symbols)`);

  // PHASE 1 — pull last 200 bars per sym/TF (fast, charts usable within seconds)
  for (const sym of syms) {
    progress.currentSym = sym;
    try { await fetchRecent(sym); }
    catch(e) {
      console.error('[OANDA] Error fetching recent ' + sym + ':', e.message);
      _pLog('ERROR ' + sym + ': ' + e.message);
    }
    progress.symDone++;
    progress.pct = Math.round((progress.symDone / progress.symTotal) * 100);
    await _delay(200);
  }

  // PHASE 2 — enqueue lazy backfill for every sym×TF that's under target
  for (const sym of syms) {
    for (const tf of TIMEFRAMES) {
      const existing = store.readCandles(SOURCE, sym, tf);
      const target   = FULL_LIMITS[tf] || 1000;
      if (existing.length < target) _enqueueBackfill(sym, tf);
    }
  }
  _pLog(`Phase 2 queued: ${_backfillQueue.length} sym×TF pairs for backfill`);

  _initialRefreshDone = true;
  Object.assign(progress, { active: false, currentSym: null, currentTF: null });
  _refreshing = false;
  _pLog('Phase 1 complete — backfill running in background');
  console.log(`[OANDA] Phase 1 complete, backfill queue: ${_backfillQueue.length} items`);
}

// ─── Fast REST backfill ───────────────────────────────────────────────────────
// Every 60s, pull last N bars from MetaAPI REST for 1m/5m/15m and OVERWRITE
// the local copy (authoritative broker OHLC wins over live-aggregated bars).
// Also purges any local bar in the refreshed window that REST did not return
// (phantom flat bars from sparse-tick periods).
// Per-TF bar counts for each refresh call. Intraday TFs get more bars
// (streaming may have touched many); 4h/1d/1w only need the last 1-2 since
// REST is the sole writer for them.
const FAST_REFRESH_LIMITS = {
  '1m': 5, '5m': 5, '15m': 5, '30m': 3, '1h': 3, '4h': 2, '1d': 2, '1w': 2,
};
const FAST_REFRESH_TFS   = Object.keys(FAST_REFRESH_LIMITS);
const FAST_REFRESH_MS    = 60_000;
const FAST_REFRESH_GAP   = 100;      // ms delay between calls to respect MetaAPI rate limit
let _fastRefreshTimer    = null;
let _fastRefreshing      = false;

async function _fastRefreshRecent() {
  if (!_ready || _fastRefreshing) return;
  _fastRefreshing = true;
  let overwritten = 0, purged = 0, errors = 0;
  try {
    for (const internalSym of Object.keys(SYMBOL_MAP)) {
      const maSym = SYMBOL_MAP[internalSym];
      if (!maSym) continue;
      for (const tf of FAST_REFRESH_TFS) {
        try {
          const limit = FAST_REFRESH_LIMITS[tf];
          const batch = await _fetchRawCandles(maSym, tf, new Date(), limit);
          if (!batch.length) continue;
          const firstTime = batch[0].t;
          const validTimes = new Set(batch.map(c => c.t));
          for (const c of batch) {
            store.replaceBar(SOURCE, internalSym, tf, c);
            overwritten++;
          }
          purged += store.removeWhere(SOURCE, internalSym, tf,
            c => c.t >= firstTime && !validTimes.has(c.t));
        } catch(e) { errors++; }
        await _delay(FAST_REFRESH_GAP);
      }
    }
  } finally {
    _fastRefreshing = false;
  }
  if (overwritten || purged || errors) {
    console.log(`[OANDA] Fast refresh: ${overwritten} bars overwritten, ${purged} phantom purged, ${errors} errors`);
  }
}

function _startFastRefresh() {
  if (_fastRefreshTimer) return;
  _fastRefreshTimer = setInterval(() => {
    _fastRefreshRecent().catch(e => console.warn('[OANDA] Fast refresh error:', e.message));
  }, FAST_REFRESH_MS);
  _fastRefreshTimer.unref && _fastRefreshTimer.unref();
  console.log(`[OANDA] Fast REST backfill started (every ${FAST_REFRESH_MS/1000}s, TFs: ${FAST_REFRESH_TFS.join(',')})`);
}

// ─── Forward-fill (mask MetaAPI relay latency) ───────────────────────────────
// MetaAPI adds 1-3s of latency between broker and us. A new minute opens on
// MT5 instantly but our first tick for that minute may arrive 2-3s late.
// Every second, check if any symbol has crossed into a new 1m bucket and
// synthesize an opening bar from the last known price. Real ticks fill it in
// as they arrive; REST backfill corrects any drift within 60s.
function _forwardFillTick() {
  if (!_ready) return;
  const now = Date.now();
  for (const sym of Object.keys(_lastPrice)) {
    const px = _lastPrice[sym];
    if (!px) continue;
    for (const tf of TICK_TFS) {
      store.writeTick(SOURCE, sym, tf, TF_MS[tf], px, 0, now);
    }
  }
}

function _startForwardFill() {
  if (_fwdFillTimer) return;
  _fwdFillTimer = setInterval(_forwardFillTick, 1000);
  _fwdFillTimer.unref && _fwdFillTimer.unref();
  console.log('[OANDA] Forward-fill started (1s cadence, masks relay latency)');
}

// ─── Watchdog ─────────────────────────────────────────────────────────────────
function _startWatchdog() {
  if (_watchdog) clearInterval(_watchdog);
  _watchdog = setInterval(async () => {
    try {
      if (!_rpcConn) throw new Error('no connection');
      await _rpcConn.getSymbolPrice(SYMBOL_MAP['EURUSD']);
      _lastSeen = Date.now();
      _status   = 'connected';
    } catch(e) {
      const staleSec = _lastSeen ? Math.round((Date.now() - _lastSeen) / 1000) : '?';
      console.warn(`[OANDA] Watchdog: lost (last seen ${staleSec}s ago) — reconnecting...`);
      _status       = 'disconnected';
      _ready        = false;
      _streamConn   = null;
      _streamStatus = {};
      _streamStarted = false;
      clearInterval(_watchdog);
      _watchdog = null;
      _scheduleReconnect();
    }
  }, 120000);
}

function _scheduleReconnect() {
  const delay = Math.min(10000 * Math.pow(2, _retryCount), 600000);
  _retryCount++;
  console.log(`[OANDA] Reconnecting in ${Math.round(delay / 1000)}s (attempt ${_retryCount})...`);
  setTimeout(async () => {
    _ready    = false;
    _rpcConn  = null;
    _account  = null;
    await connect();
  }, delay);
}

// ─── Connect ──────────────────────────────────────────────────────────────────
async function connect() {
  if (!METAAPI_TOKEN) {
    console.warn('[OANDA] METAAPI_TOKEN not set — source disabled');
    return;
  }
  _status = 'connecting';
  try {
    const MetaApi = require('metaapi.cloud-sdk').default;
    const api     = new MetaApi(METAAPI_TOKEN);
    _account      = await api.metatraderAccountApi.getAccount(METAAPI_ACCOUNT_ID);
    if (!['DEPLOYING','DEPLOYED'].includes(_account.state)) await _account.deploy();
    _rpcConn      = _account.getRPCConnection();
    await _rpcConn.connect();
    await _delay(5000); // let connection settle
    _ready      = true;
    _status     = 'connected';
    _lastSeen   = Date.now();
    _retryCount = 0;
    console.log('[OANDA] Connection ready');
    // Await symbol discovery so refreshAllCache() sees correct broker names
    await _discoverBrokerSymbols().catch(e => console.warn('[OANDA] Symbol discovery failed:', e.message));
    _startWatchdog();
    // _startFastRefresh();    // BYPASS: stream-only mode, no REST refresh
    _startForwardFill();
    // _startBackfillWorker(); // BYPASS: stream-only mode, no REST backfill
    startStream(); // non-blocking
  } catch(e) {
    _status = 'error';
    console.error('[OANDA] Init failed:', e.message);
    _scheduleReconnect();
  }
}

// ─── Load cache from disk ─────────────────────────────────────────────────────
function loadCache() {
  let n = 0;
  for (const sym of Object.keys(SYMBOL_MAP)) {
    try {
      store.loadFromDisk(SOURCE, sym);
      n++;
    } catch(e) {
      console.error(`[OANDA] loadCache ${sym}:`, e.message);
    }
  }
  console.log(`[OANDA] Loaded ${n} symbols from disk`);
}

// ─── Public API ───────────────────────────────────────────────────────────────
function getStatus() {
  return {
    status:       _status,
    ready:        _ready,
    lastSeen:     _lastSeen ? new Date(_lastSeen).toISOString() : null,
    retryCount:   _retryCount,
    streamStatus: _streamStatus,
    brokerList:   _lastBrokerList,
    unmapped:     Object.entries(SYMBOL_MAP)
      .filter(([, v]) => !_lastBrokerList.includes(v))
      .map(([k]) => k),
    symbolMap:    { ...SYMBOL_MAP },
    progress,
  };
}

function getSymbols() { return Object.keys(SYMBOL_MAP); }

function isReady() { return _ready; }

function getRpcConn() { return _rpcConn; }

module.exports = {
  SOURCE,
  SYMBOL_MAP,
  TIMEFRAMES,
  TF_MS,
  connect,
  loadCache,
  fetchRecent,
  refreshAllCache,
  promoteBackfill,
  getBackfillStatus,
  getStatus,
  getSymbols,
  isReady,
  getRpcConn,
};
