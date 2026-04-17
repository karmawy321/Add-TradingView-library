'use strict';

const store = require('../candleStore');

// ─── Config ───────────────────────────────────────────────────────────────────
const SOURCE = 'oanda';

const METAAPI_TOKEN      = process.env.METAAPI_TOKEN      || '';
const METAAPI_ACCOUNT_ID = '620f74cf-9c2e-46d0-8073-36ab51e621c0';

const TF_MS = {
  '1m':60000, '5m':300000, '15m':900000, '30m':1800000,
  '1h':3600000, '4h':14400000, '1d':86400000, '1w':604800000,
};
const TIMEFRAMES = Object.keys(TF_MS);

// Full history targets per TF
const FULL_LIMITS = {
  '1w': 1100, '1d': 5000, '4h': 7800, '1h': 17520,
  '30m': 2000, '15m': 2000, '5m': 2000, '1m': 10080,
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
  'OILBRNT':  'OILBRNT.pro',
  'NATGAS':   'NATGAS.pro',
  'COPPER':   'COPPER-US.pro',
  'PLATIN':   'PLATIN.pro',
  'PALLAD':   'PALLAD.pro',
  /* Forex majors */
  'EURUSD':   'EURUSD.pro',
  'GBPUSD':   'GBPUSD.pro',
  'USDJPY':   'USDJPY.pro',
  'USDCHF':   'USDCHF.pro',
  'AUDUSD':   'AUDUSD.pro',
  'NZDUSD':   'NZDUSD.pro',
  'USDCAD':   'USDCAD.pro',
  /* Forex crosses */
  'EURJPY':   'EURJPY.pro',
  'GBPJPY':   'GBPJPY.pro',
  'EURGBP':   'EURGBP.pro',
  'EURAUD':   'EURAUD.pro',
  'EURCAD':   'EURCAD.pro',
  'EURCHF':   'EURCHF.pro',
  'EURNZD':   'EURNZD.pro',
  'GBPAUD':   'GBPAUD.pro',
  'GBPCAD':   'GBPCAD.pro',
  'GBPCHF':   'GBPCHF.pro',
  'GBPNZD':   'GBPNZD.pro',
  'AUDCAD':   'AUDCAD.pro',
  'AUDCHF':   'AUDCHF.pro',
  'AUDJPY':   'AUDJPY.pro',
  'AUDNZD':   'AUDNZD.pro',
  'CADCHF':   'CADCHF.pro',
  'CADJPY':   'CADJPY.pro',
  'CHFJPY':   'CHFJPY.pro',
  'NZDJPY':   'NZDJPY.pro',
  /* Indices */
  'US500':    'US500.pro',
  'US30':     'US30.pro',
  'US100':    'US100.pro',
  'DE30':     'DE30.pro',
  'GB100':    'GB100.pro',
  'JP225':    'JP225.pro',
  'AU200':    'AU200.pro',
  'EU50':     'EU50.pro',
  'FR40':     'FR40.pro',
  /* Equity CFDs */
  'TSLA':     'TSLA_CFD.US',
  'NVDA':     'NVDA_CFD.US',
  'AAPL':     'AAPL_CFD.US',
  /* Crypto (OANDA broker) */
  'BTCUSDT':  'BTCUSD',
  'ETHUSDT':  'ETHUSD',
  'SOLUSDT':  'SOLUSD',
  'ADAUSDT':  'ADAUSD',
  'LTCUSD':   'LTCUSD',
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
        const mid  = ((bid || ask) + (ask || bid)) / 2;
        const ts   = price.time ? new Date(price.time).getTime() : Date.now();
        const sym  = _brokerToInternal[price.symbol];
        if (!sym) return;
        _lastSeen = Date.now();
        for (const tf of TIMEFRAMES) {
          store.writeTick(SOURCE, sym, tf, TF_MS[tf], mid, 0);
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

async function fetchHistory(internalSym, incremental) {
  if (!_ready) return;
  const maSym = SYMBOL_MAP[internalSym];
  if (!maSym) return;

  try {
    for (const tf of TIMEFRAMES) {
      progress.currentTF = tf;
      const hwm    = store.highWaterMark(SOURCE, internalSym, tf);
      const target = FULL_LIMITS[tf] || 1000;

      if (incremental && hwm > 0) {
        const elapsed = Date.now() - hwm;
        const limit   = Math.min(PAGE_SIZE, Math.ceil(elapsed / TF_MS[tf]) + 20);
        const batch   = await _fetchRawCandles(maSym, tf, new Date(), limit);
        const fresh   = batch.filter(c => c.t > hwm);
        for (const c of fresh) store.writeBar(SOURCE, internalSym, tf, c);
        if (fresh.length) console.log(`[OANDA] ${internalSym} ${tf}: +${fresh.length} (incremental)`);
      } else {
        let collected = [];
        let fromTime  = new Date();
        while (collected.length < target) {
          const limit = Math.min(PAGE_SIZE, target - collected.length);
          const batch = await _fetchRawCandles(maSym, tf, fromTime, limit);
          if (!batch.length) break;
          collected = [...batch, ...collected];
          fromTime  = new Date(batch[0].t - 1);
          if (batch.length < limit) break;
          await _delay(500);
        }
        // Derive higher TFs from 1m if needed
        if (tf === '1m' && collected.length) {
          for (const higherTf of ['5m', '15m', '30m']) {
            const existing = store.readCandles(SOURCE, internalSym, higherTf);
            if (!existing.length) {
              const derived = _aggregate(collected, TF_MS[higherTf]);
              store.writeCandles(SOURCE, internalSym, higherTf, derived);
            }
          }
        }
        store.writeCandles(SOURCE, internalSym, tf, collected);
        console.log(`[OANDA] ${internalSym} ${tf}: ${collected.length} candles`);
      }

      progress.tfDone++;
      await _delay(500);
    }
    console.log(`[OANDA] History ready for ${internalSym}`);
    _pLog(`Done: ${internalSym}`);
    store.saveToDisk(SOURCE, internalSym);
  } catch(e) {
    console.error('[OANDA] fetchHistory error:', e.message);
  }
}

// ─── Full cache refresh (called from admin endpoint) ─────────────────────────
let _refreshing = false;

async function refreshAllCache() {
  if (!_ready || _refreshing) return;
  _refreshing = true;
  const syms = Object.keys(SYMBOL_MAP);
  Object.assign(progress, {
    active: true, symDone: 0, symTotal: syms.length,
    tfDone: 0, tfTotal: syms.length * TIMEFRAMES.length,
    pct: 0, startedAt: new Date().toISOString(), log: [],
  });
  _pLog(`Started full refresh (${syms.length} symbols)`);
  for (const sym of syms) {
    progress.currentSym = sym;
    const hasData = store.readCandles(SOURCE, sym, '1d').length > 0;
    try { await fetchHistory(sym, hasData); } catch(e) {
      console.error('[OANDA] Error refreshing ' + sym + ':', e.message);
      _pLog('ERROR ' + sym + ': ' + e.message);
    }
    progress.symDone++;
    progress.pct = Math.round((progress.symDone / progress.symTotal) * 100);
    await _delay(1000);
  }
  Object.assign(progress, { active: false, currentSym: null, currentTF: null });
  _refreshing = false;
  _pLog('Refresh complete');
  console.log('[OANDA] Full cache refresh complete');
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
    _discoverBrokerSymbols().catch(e => console.warn('[OANDA] Symbol discovery failed:', e.message));
    _startWatchdog();
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
  fetchHistory,
  refreshAllCache,
  getStatus,
  getSymbols,
  isReady,
  getRpcConn,
};
