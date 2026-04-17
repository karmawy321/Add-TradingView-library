'use strict';

const https     = require('https');
const WebSocket = require('ws');
const store     = require('../candleStore');

// ─── Config ───────────────────────────────────────────────────────────────────
const SOURCE = 'td';
const TD_KEY = process.env.TWELVEDATA_API_KEY || '';

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
function _fetchSingle(tdSym, tdInterval, extra) {
  return new Promise(resolve => {
    if (!TD_KEY) { resolve([]); return; }
    const params = new URLSearchParams({
      symbol:     tdSym,
      interval:   tdInterval,
      outputsize: '1000',
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

// ─── History fetch for on-demand symbol ──────────────────────────────────────
const _loading = new Set(); // prevent concurrent fetches for same sym

async function fetchHistory(sym) {
  if (!TD_KEY || _loading.has(sym)) return;
  _loading.add(sym);
  const tdSym = toTDSymbol(sym);
  _registerSym(sym);

  try {
    // 1. Daily (derive weekly from it)
    const d1 = await _fetchSingle(tdSym, '1day');
    store.writeCandles(SOURCE, sym, '1d', d1);
    if (d1.length) {
      const weekly = _aggregate(d1, TF_MS['1w']);
      store.writeCandles(SOURCE, sym, '1w', weekly);
    }
    await new Promise(r => setTimeout(r, 400));

    // 2. Hourly (derive 4h from it)
    const h1 = await _fetchSingle(tdSym, '1h');
    store.writeCandles(SOURCE, sym, '1h', h1);
    if (h1.length) {
      const h4 = _aggregate(h1, TF_MS['4h']);
      store.writeCandles(SOURCE, sym, '4h', h4);
    }
    await new Promise(r => setTimeout(r, 400));

    // 3. 1-minute (derive 5m, 15m, 30m)
    const m1 = await _fetchSingle(tdSym, '1min');
    store.writeCandles(SOURCE, sym, '1m', m1);
    if (m1.length) {
      store.writeCandles(SOURCE, sym, '5m',  _aggregate(m1, TF_MS['5m']));
      store.writeCandles(SOURCE, sym, '15m', _aggregate(m1, TF_MS['15m']));
      store.writeCandles(SOURCE, sym, '30m', _aggregate(m1, TF_MS['30m']));
    }

    console.log(`[TD] History ready for ${sym}`);
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
        store.writeTick(SOURCE, internalSym, tf, TF_MS[tf], price, 0);
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
    status:      _status,
    subscribed:  [..._subscribed],
    retryCount:  _wsRetry,
    hasKey:      !!TD_KEY,
  };
}

module.exports = {
  SOURCE,
  TF_MS,
  connect,
  subscribe,
  unsubscribe,
  fetchHistory,
  fetchCurrentPrice,
  toTDSymbol,
  getStatus,
};
