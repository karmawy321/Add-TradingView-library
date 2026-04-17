'use strict';

const https     = require('https');
const WebSocket = require('ws');
const store     = require('../candleStore');

// ─── Config ───────────────────────────────────────────────────────────────────
const SOURCE = 'binance';

const TF_MS = {
  '1m':60000, '5m':300000, '15m':900000, '30m':1800000,
  '1h':3600000, '4h':14400000, '1d':86400000, '1w':604800000,
};

// Add or remove symbols here — no other file needs changing.
const SYMBOLS = [
  'BNBUSDT',
  'XRPUSDT',
  'DOGEUSDT',
  'DOTUSDT',
  'LINKUSDT',
  'AVAXUSDT',
  'MATICUSDT',
  'ATOMUSDT',
];

// History targets per TF (candle counts)
const HISTORY_LIMITS = {
  '1m': 1000, '5m': 2000, '15m': 2000, '30m': 2000,
  '1h': 5000, '4h': 5000, '1d': 5000, '1w': 1000,
};

// Binance interval strings
const BN_TF = {
  '1m':'1m', '5m':'5m', '15m':'15m', '30m':'30m',
  '1h':'1h', '4h':'4h', '1d':'1d', '1w':'1w',
};

// ─── State ────────────────────────────────────────────────────────────────────
let _ws        = null;
let _wsRetry   = 0;
let _status    = 'disconnected';
let _connected = false;

// ─── REST history ─────────────────────────────────────────────────────────────
function _fetchKlines(sym, tf, limit, endTime) {
  return new Promise((resolve, reject) => {
    let url = `/api/v3/klines?symbol=${sym}&interval=${BN_TF[tf]}&limit=${Math.min(limit, 1000)}`;
    if (endTime) url += `&endTime=${endTime}`;
    const opts = {
      hostname: 'api.binance.com',
      path:     url,
      method:   'GET',
      headers:  { 'User-Agent': 'fractal-agent/1.0' },
    };
    const req = https.request(opts, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try {
          const raw = JSON.parse(d);
          if (!Array.isArray(raw)) { resolve([]); return; }
          resolve(raw.map(k => ({
            t: k[0],
            o: parseFloat(k[1]),
            h: parseFloat(k[2]),
            l: parseFloat(k[3]),
            c: parseFloat(k[4]),
            v: parseFloat(k[5]),
          })));
        } catch(e) { resolve([]); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

async function _fetchHistory(sym, tf) {
  const target  = HISTORY_LIMITS[tf] || 1000;
  const hwm     = store.highWaterMark(SOURCE, sym, tf);
  const existing = store.readCandles(SOURCE, sym, tf);

  if (existing.length >= target * 0.9 && hwm > 0) {
    // Incremental: only fetch new candles since last known
    const batch = await _fetchKlines(sym, tf, 50);
    const fresh = batch.filter(c => c.t > hwm);
    for (const c of fresh) store.writeBar(SOURCE, sym, tf, c);
    if (fresh.length) console.log(`[Binance] ${sym} ${tf}: +${fresh.length} (incremental)`);
    return;
  }

  // Full backfill with pagination
  let collected = [];
  let endTime   = undefined;

  while (collected.length < target) {
    const limit = Math.min(1000, target - collected.length);
    const batch = await _fetchKlines(sym, tf, limit, endTime);
    if (!batch.length) break;
    collected = [...batch, ...collected];
    endTime   = batch[0].t - 1;
    if (batch.length < limit) break;
    await new Promise(r => setTimeout(r, 200));
  }

  store.writeCandles(SOURCE, sym, tf, collected);
  console.log(`[Binance] ${sym} ${tf}: ${collected.length} candles`);
}

async function fetchAllHistory() {
  for (const sym of SYMBOLS) {
    for (const tf of Object.keys(TF_MS)) {
      try { await _fetchHistory(sym, tf); } catch(e) {
        console.error(`[Binance] fetchHistory ${sym} ${tf}:`, e.message);
      }
    }
    store.saveToDisk(SOURCE, sym);
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('[Binance] History fetch complete');
}

// ─── WebSocket (kline stream) ─────────────────────────────────────────────────
// Stream 1m klines for all symbols. Higher TFs are derived via writeTick.
// Binance kline WS delivers the current in-progress bar every second.
function _buildStreamUrl() {
  const streams = SYMBOLS.map(s => `${s.toLowerCase()}@kline_1m`).join('/');
  return `wss://stream.binance.com:9443/stream?streams=${streams}`;
}

function _onKline(data) {
  const k   = data.k;
  const sym = k.s; // e.g. "BNBUSDT"
  if (!SYMBOLS.includes(sym)) return;

  const bar = {
    t: k.t,                    // bar open time ms
    o: parseFloat(k.o),
    h: parseFloat(k.h),
    l: parseFloat(k.l),
    c: parseFloat(k.c),
    v: parseFloat(k.v),
  };

  // Write the live 1m bar
  store.writeBar(SOURCE, sym, '1m', bar);

  // Propagate close price as tick to all other TFs
  for (const tf of Object.keys(TF_MS)) {
    if (tf === '1m') continue;
    store.writeTick(SOURCE, sym, tf, TF_MS[tf], bar.c, bar.v);
  }
}

function connect() {
  if (!SYMBOLS.length) return;
  const url = _buildStreamUrl();
  console.log(`[Binance] Connecting WebSocket (${SYMBOLS.length} symbols)...`);
  _status    = 'connecting';
  _ws        = new WebSocket(url);

  _ws.on('open', () => {
    _connected = true;
    _wsRetry   = 0;
    _status    = 'connected';
    console.log('[Binance] WebSocket connected');
  });

  _ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.data && msg.data.e === 'kline') _onKline(msg.data);
    } catch(_) {}
  });

  _ws.on('close', () => {
    _connected = false;
    _status    = 'disconnected';
    const delay = Math.min(5000 * Math.pow(2, _wsRetry), 300000);
    _wsRetry++;
    console.log(`[Binance] WS closed — reconnecting in ${Math.round(delay / 1000)}s...`);
    setTimeout(connect, delay);
  });

  _ws.on('error', e => {
    console.error('[Binance] WS error:', e.message);
    _status = 'error';
  });
}

// ─── Load disk cache then start live feed ─────────────────────────────────────
function loadCache() {
  let n = 0;
  for (const sym of SYMBOLS) {
    try { store.loadFromDisk(SOURCE, sym); n++; } catch(e) {
      console.error(`[Binance] loadCache ${sym}:`, e.message);
    }
  }
  console.log(`[Binance] Loaded ${n} symbols from disk`);
}

// ─── Status ───────────────────────────────────────────────────────────────────
function getStatus() {
  return { status: _status, connected: _connected, retryCount: _wsRetry, symbols: SYMBOLS };
}

function getSymbols() { return SYMBOLS; }

module.exports = {
  SOURCE,
  SYMBOLS,
  TF_MS,
  connect,
  loadCache,
  fetchAllHistory,
  getStatus,
  getSymbols,
};
