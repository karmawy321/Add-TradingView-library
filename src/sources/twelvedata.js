'use strict';

const https     = require('https');
const fs        = require('fs');
const path      = require('path');
const WebSocket = require('ws');
const store     = require('../candleStore');

// ─── Config ───────────────────────────────────────────────────────────────────
const SOURCE = 'td';
const TD_KEY = process.env.TWELVEDATA_API_KEY || '';

// Always-cached TD symbols — fetched at startup + auto-subscribed to WS.
// Stocks/ETFs + non-OANDA forex (EM) + aggregated commodities (sniper training).
// Broker-grade forex/metals (majors, gold, WTI) → OANDA; main crypto → Binance.
const PRECACHE_SYMBOLS = [
  /* US equities & ETFs */
  'TSLA','NVDA','AAPL','MSFT','GOOGL','AMZN','META',
  'AMD','NFLX','COIN','PLTR',
  'SPY','QQQ','GLD','SLV',
  /* EM / exotic forex (not in OANDA SYMBOL_MAP) */
  'USDBRL','USDMXN','USDZAR','USDTRY','USDSGD','USDCNH','USDINR',
  /* Commodities (aggregated — TD is not broker-grade) */
  'BRENT','NATGAS','COPPER','XPTUSD','XPDUSD',
];
const _precacheSet = new Set(PRECACHE_SYMBOLS);

// Commodity symbol mapping: internal code → TwelveData native symbol.
// Kept separate from slash-based forex because commodities use mixed formats.
const COMMODITY_MAP = {
  'BRENT':  'BRENT',
  'NATGAS': 'NG',
  'COPPER': 'XCU/USD',
  'XPTUSD': 'XPT/USD',
  'XPDUSD': 'XPD/USD',
};

const TF_MS = {
  '1m':60000, '5m':300000, '15m':900000, '30m':1800000,
  '1h':3600000, '4h':14400000, '1d':86400000, '1w':604800000,
};

const TD_TF = {
  '1m':'1min', '5m':'5min', '15m':'15min', '30m':'30min',
  '1h':'1h', '4h':'4h', '1d':'1day', '1w':'1week',
};

// Known stock tickers — TwelveData uses plain ticker (no slash)
const STOCK_TICKERS = new Set([
  'AAPL','MSFT','GOOGL','GOOG','AMZN','META','NVDA','TSLA','NFLX','AMD',
  'INTC','BABA','DIS','JPM','GS','BAC','V','MA','PYPL','UBER','LYFT',
  'COIN','HOOD','PLTR','RIVN','NIO','LCID','GME','AMC','SPY','QQQ','GLD','SLV',
]);

// ─── Symbol conversion ────────────────────────────────────────────────────────
function toTDSymbol(sym) {
  const s = sym.toUpperCase();
  if (COMMODITY_MAP[s]) return COMMODITY_MAP[s];
  if (s.includes('/')) return s;
  if (STOCK_TICKERS.has(s)) return s;
  if (s.endsWith('USDT')) return s.replace('USDT', '/USD');
  if (s.endsWith('USDC')) return s.replace('USDC', '/USD');
  if (s.endsWith('BTC'))  return s.replace('BTC',  '/BTC');
  if (s.length === 6)     return s.slice(0, 3) + '/' + s.slice(3);
  return s;
}

// Reverse map: tdSym → internalSym
const _reverseMap = {};
function _registerSym(internalSym) {
  _reverseMap[toTDSymbol(internalSym)] = internalSym;
}

// Parse TwelveData datetime string → Unix ms
function _tdTs(dt) {
  if (!dt) return 0;
  const s = dt.includes(' ') ? dt.replace(' ', 'T') + 'Z' : dt + 'T00:00:00Z';
  return new Date(s).getTime();
}

// Format timestamp → TwelveData end_date param
function _tdDateStr(ts) {
  return new Date(ts).toISOString().slice(0, 19).replace('T', ' ');
}

// Aggregate lower-TF candles into higher TF
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

// ─── REST single fetch ────────────────────────────────────────────────────────
const _INTERVAL_MS = {
  '1min':60000,'5min':300000,'15min':900000,'30min':1800000,
  '1h':3600000,'4h':14400000,'1day':86400000,'1week':604800000,
};

function _fetchSingle(tdSym, tdInterval, extra) {
  return new Promise(resolve => {
    if (!TD_KEY) { resolve([]); return; }
    const params = new URLSearchParams({
      symbol:     tdSym,
      interval:   tdInterval,
      outputsize: '5000',
      order:      'ASC',
      timezone:   'UTC',
      apikey:     TD_KEY,
      ...(extra || {}),
    });
    const reqPath = `/time_series?${params.toString()}`;
    const req = https.request({ hostname: 'api.twelvedata.com', path: reqPath, method: 'GET' }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(d);
          if (json.status !== 'ok' || !Array.isArray(json.values)) {
            console.warn(`[TD] ${tdSym} ${tdInterval}:`, json.message || json.status);
            return resolve([]);
          }
          resolve(json.values.map(v => ({
            t: _tdTs(v.datetime),
            o: parseFloat(v.open),   h: parseFloat(v.high),
            l: parseFloat(v.low),    c: parseFloat(v.close),
            v: parseFloat(v.volume || 0),
          })));
        } catch(e) { console.error('[TD] parse error:', e.message); resolve([]); }
      });
    });
    req.on('error', e => { console.error('[TD] request error:', e.message); resolve([]); });
    req.end();
  });
}

// ─── Paginated REST fetch ─────────────────────────────────────────────────────
async function _fetchPaginated(tdSym, tdInterval, target) {
  const PAGE = 5000; // TwelveData max per call
  let collected = [];
  let endDate   = null;

  while (collected.length < target) {
    const need  = target - collected.length;
    const extra = { outputsize: String(Math.min(PAGE, need)) };
    if (endDate) extra.end_date = endDate;
    const batch = await _fetchSingle(tdSym, tdInterval, extra);
    if (!batch.length) break;
    collected = [...batch, ...collected]; // prepend older candles
    endDate   = _tdDateStr(batch[0].t - (_INTERVAL_MS[tdInterval] || 60000));
    if (batch.length < Math.min(PAGE, need)) break;
    await new Promise(r => setTimeout(r, 400));
  }
  return collected;
}

// ─── History fetch for on-demand symbol ──────────────────────────────────────
const _loading = new Set(); // prevent concurrent fetches for same sym

async function fetchHistory(sym) {
  if (!TD_KEY || _loading.has(sym)) return;
  _loading.add(sym);
  const tdSym = toTDSymbol(sym);
  _registerSym(sym);

  try {
    // 1d → derive 1w
    const d1 = await _fetchPaginated(tdSym, '1day', 5000);
    store.writeCandles(SOURCE, sym, '1d', d1);
    if (d1.length) store.writeCandles(SOURCE, sym, '1w', _aggregate(d1, TF_MS['1w']));
    await new Promise(r => setTimeout(r, 400));

    // 1h → derive 4h
    const h1 = await _fetchPaginated(tdSym, '1h', 17000);
    store.writeCandles(SOURCE, sym, '1h', h1);
    if (h1.length) store.writeCandles(SOURCE, sym, '4h', _aggregate(h1, TF_MS['4h']));
    await new Promise(r => setTimeout(r, 400));

    // 30m, 15m, 5m — fetch directly (deriving from 1m would need 90k+ 1m candles)
    for (const [tdInt, tf, target] of [['30min','30m',3000],['15min','15m',3000],['5min','5m',3000]]) {
      const bars = await _fetchPaginated(tdSym, tdInt, target);
      store.writeCandles(SOURCE, sym, tf, bars);
      await new Promise(r => setTimeout(r, 400));
    }

    // 1m
    const m1 = await _fetchPaginated(tdSym, '1min', 11000);
    store.writeCandles(SOURCE, sym, '1m', m1);

    console.log(`[TD] History ready for ${sym}`);
    store.saveToDisk(SOURCE, sym);

    // Push snapshot to any SSE clients watching this symbol
    const sse = require('../sse');
    const snap = {};
    for (const tf of Object.keys(TF_MS)) {
      const arr = store.readCandles(SOURCE, sym, tf);
      if (arr.length) snap[tf] = arr;
    }
    sse.pushEvent(SOURCE, sym, { type: 'snapshot', source: SOURCE, symbol: sym, candles: snap });
  } catch(e) {
    console.error(`[TD] fetchHistory ${sym}:`, e.message);
  } finally {
    _loading.delete(sym);
  }
}

// ─── Current price (for AI tools) ────────────────────────────────────────────
function fetchCurrentPrice(sym) {
  return new Promise(resolve => {
    if (!TD_KEY) { resolve(0); return; }
    const tdSym   = toTDSymbol(sym);
    const reqPath = `/price?symbol=${encodeURIComponent(tdSym)}&apikey=${TD_KEY}`;
    const req = https.request({ hostname: 'api.twelvedata.com', path: reqPath, method: 'GET' }, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve(parseFloat(JSON.parse(d).price) || 0); } catch(_) { resolve(0); }
      });
    });
    req.on('error', () => resolve(0));
    req.end();
  });
}

// ─── WebSocket — single master connection ─────────────────────────────────────
let _ws             = null;
let _wsReady        = false;
let _subscribed     = new Set();
let _wsRetry        = 0;
let _reconnectTimer = null;
let _status         = 'disconnected';

function _connectWS() {
  if (!TD_KEY) return;
  if (_reconnectTimer) { clearTimeout(_reconnectTimer); _reconnectTimer = null; }
  _status = 'connecting';
  _ws     = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${TD_KEY}`);

  _ws.on('open', () => {
    _wsReady = true;
    _wsRetry = 0;
    _status  = 'connected';
    console.log('[TD WS] connected');
    // Auto-subscribe precache symbols so live ticks flow without waiting for a client
    for (const sym of PRECACHE_SYMBOLS) {
      const tdSym = toTDSymbol(sym);
      _registerSym(sym);
      _subscribed.add(tdSym);
    }
    if (_subscribed.size > 0) {
      _ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: [..._subscribed].join(',') } }));
    }
  });

  _ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.event !== 'price') return;
      const internalSym = _reverseMap[msg.symbol];
      if (!internalSym) return;
      const price = parseFloat(msg.price);
      if (!price) return;
      const ts = (msg.timestamp || 0) * 1000 || Date.now();
      for (const tf of Object.keys(TF_MS)) {
        store.writeTick(SOURCE, internalSym, tf, TF_MS[tf], price, 0, ts);
      }
    } catch(_) {}
  });

  _ws.on('close', () => {
    _wsReady = false;
    _status  = 'disconnected';
    const delay = Math.min(5000 * Math.pow(2, _wsRetry), 300000);
    _wsRetry++;
    console.log(`[TD WS] closed — reconnecting in ${Math.round(delay / 1000)}s`);
    _reconnectTimer = setTimeout(_connectWS, delay);
  });

  _ws.on('error', e => {
    console.error('[TD WS] error:', e.message);
    _status = 'error';
    try { _ws.terminate(); } catch(_) {}
  });
}

// ─── Subscribe / unsubscribe on-demand ───────────────────────────────────────
function subscribe(sym) {
  const tdSym = toTDSymbol(sym);
  _registerSym(sym);
  if (_subscribed.has(tdSym)) return;
  _subscribed.add(tdSym);
  if (_wsReady && _ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ action: 'subscribe', params: { symbols: tdSym } }));
    console.log(`[TD WS] subscribed ${tdSym}`);
  }
}

function unsubscribe(sym) {
  const tdSym = toTDSymbol(sym);
  _subscribed.delete(tdSym);
  if (_wsReady && _ws && _ws.readyState === WebSocket.OPEN) {
    _ws.send(JSON.stringify({ action: 'unsubscribe', params: { symbols: tdSym } }));
  }
}

// ─── Disk cache load ─────────────────────────────────────────────────────────
function loadCache() {
  const dir = path.join(__dirname, '..', '..', 'candle_cache', SOURCE);
  if (!fs.existsSync(dir)) return;
  try {
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));
    for (const f of files) {
      const sym = f.replace(/\.json$/, '');
      store.loadFromDisk(SOURCE, sym);
      _registerSym(sym);
    }
    console.log(`[TD] loadCache — ${files.length} symbols restored`);
  } catch (e) {
    console.error('[TD] loadCache error:', e.message);
  }
}

// ─── Boot-time precache fetch (sequential, rate-limit-friendly) ──────────────
let _precacheRunning = false;
async function fetchAllHistory() {
  if (!TD_KEY) return;
  if (_precacheRunning) return;
  _precacheRunning = true;
  console.log(`[TD] fetchAllHistory — starting ${PRECACHE_SYMBOLS.length} symbols`);
  try {
    for (const sym of PRECACHE_SYMBOLS) {
      try {
        await fetchHistory(sym);
      } catch (e) {
        console.error(`[TD] fetchAllHistory ${sym}:`, e.message);
      }
      // 2s gap between symbols to stay under rate limits even on lower tiers
      await new Promise(r => setTimeout(r, 2000));
    }
    console.log('[TD] fetchAllHistory — all symbols done');
  } finally {
    _precacheRunning = false;
  }
}

function getSymbols() {
  return PRECACHE_SYMBOLS.slice();
}

// ─── Init ────────────────────────────────────────────────────────────────────
function connect() {
  if (!TD_KEY) {
    console.warn('[TD] TWELVEDATA_API_KEY not set — source disabled');
    return;
  }
  _connectWS();
}

// ─── Status ───────────────────────────────────────────────────────────────────
function getStatus() {
  return {
    status:         _status,
    subscribed:     [..._subscribed],
    retryCount:     _wsRetry,
    hasKey:         !!TD_KEY,
    backfillActive: _precacheRunning,
  };
}

module.exports = {
  SOURCE,
  TF_MS,
  PRECACHE_SYMBOLS,
  connect,
  loadCache,
  fetchAllHistory,
  getSymbols,
  subscribe,
  unsubscribe,
  fetchHistory,
  fetchCurrentPrice,
  toTDSymbol,
  getStatus,
};
