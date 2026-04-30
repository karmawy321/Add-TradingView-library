'use strict';

const https = require('https');
const WebSocket = require('ws');
const store = require('../candleStore');

const SOURCE = 'capital';
const API_KEY = process.env.CAPITAL_API_KEY || '';
const IDENTIFIER = process.env.CAPITAL_IDENTIFIER || '';
const PASSWORD = process.env.CAPITAL_PASSWORD || '';
const BASE_URL = 'api-capital.backend-capital.com';

const TF_MS = {
  '1m': 60000, '5m': 300000, '15m': 900000, '30m': 1800000,
  '1h': 3600000, '4h': 14400000, '1d': 86400000, '1w': 604800000,
};

const TF_MAP = {
  '1m': 'MINUTE',
  '5m': 'MINUTE_5',
  '15m': 'MINUTE_15',
  '30m': 'MINUTE_30',
  '1h': 'HOUR',
  '4h': 'HOUR_4',
  '1d': 'DAY',
  '1w': 'WEEK'
};

const TIMEFRAMES = Object.keys(TF_MAP);

const SYMBOL_MAP = {
  // Forex Majors & Minors
  'EURUSD': 'EURUSD', 'GBPUSD': 'GBPUSD', 'USDJPY': 'USDJPY',
  'AUDUSD': 'AUDUSD', 'USDCHF': 'USDCHF', 'USDCAD': 'USDCAD',
  'NZDUSD': 'NZDUSD', 'EURJPY': 'EURJPY', 'GBPJPY': 'GBPJPY',
  'EURGBP': 'EURGBP', 'EURAUD': 'EURAUD', 'EURCAD': 'EURCAD',
  'AUDJPY': 'AUDJPY', 'CADJPY': 'CADJPY', 'CHFJPY': 'CHFJPY',
  'EURNZD': 'EURNZD', 'GBPAUD': 'GBPAUD', 'GBPCAD': 'GBPCAD',
  'GBPCHF': 'GBPCHF', 'GBPNZD': 'GBPNZD', 'AUDCAD': 'AUDCAD',
  'AUDCHF': 'AUDCHF', 'AUDNZD': 'AUDNZD', 'CADCHF': 'CADCHF',
  'NZDJPY': 'NZDJPY',
  
  // Indices
  'US500':  'US500', 'US30':   'US30',  'US100':  'US100',
  'DE40':   'DE40',  'UK100':  'UK100', 'JP225':  'JP225',
  
  // Commodities
  'XAUUSD': 'GOLD', 'XAGUSD': 'SILVER',
  'BRENT':  'BRENT', 'WTI':    'OIL', 'NATGAS': 'NATGAS',
  
  // Crypto
  'BTCUSD': 'BTCUSD', 'ETHUSD': 'ETHUSD', 'XRPUSD': 'XRPUSD',
  'ADAUSD': 'ADAUSD', 'SOLUSD': 'SOLUSD',
  
  // Equities
  'AAPL': 'AAPL', 'TSLA': 'TSLA', 'NVDA': 'NVDA', 'MSFT': 'MSFT'
};

let cst = '';
let securityToken = '';
let connected = false;
let ws = null;

async function connect() {
  console.log(`[Capital] Starting connection initialization... API_KEY Present: ${!!API_KEY}`);
  if (!API_KEY || !IDENTIFIER || !PASSWORD) {
    console.log('[Capital] WARNING: Credentials missing in .env — skipping connect (Check CAPITAL_API_KEY, CAPITAL_IDENTIFIER, CAPITAL_PASSWORD)');
    return;
  }

  return new Promise((resolve) => {
    const payload = JSON.stringify({
      identifier: IDENTIFIER,
      password: PASSWORD,
      encryptedPassword: false
    });

    const opts = {
      hostname: BASE_URL,
      path: '/api/v1/session',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CAP-API-KEY': API_KEY
      }
    };

    const req = https.request(opts, (res) => {
      cst = res.headers['cst'] || '';
      securityToken = res.headers['x-security-token'] || '';
      
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200 && cst && securityToken) {
          connected = true;
          console.log('[Capital] Session authenticated successfully');
          setInterval(keepAlive, 9 * 60 * 1000);
          connectWS();
          
          /* Automatically start fetching historical data into cache */
          setTimeout(() => {
            console.log('[Capital] Bootstrapping cache for all symbols (Background)...');
            refreshAllCache().catch(e => console.error('[Capital] Background sync error:', e));
          }, 3000);
          
          resolve();
        } else {
          console.error('[Capital] Authentication failed:', data);
          resolve();
        }
      });
    });

    req.on('error', (err) => {
      console.error('[Capital] Request error during session:', err.message);
      resolve();
    });
    
    req.write(payload);
    req.end();
  });
}

function keepAlive() {
  if (!connected) return;
  const opts = {
    hostname: BASE_URL,
    path: '/api/v1/markets?searchTerm=EURUSD',
    method: 'GET',
    headers: {
      'X-CAP-API-KEY': API_KEY,
      'CST': cst,
      'X-SECURITY-TOKEN': securityToken
    }
  };
  https.get(opts, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      if (res.statusCode === 200) {
        if (res.headers['cst']) cst = res.headers['cst'];
        if (res.headers['x-security-token']) securityToken = res.headers['x-security-token'];
      } else {
        console.warn('[Capital] Keep-alive token update failed, attempting reconnect...');
        connect();
      }
    });
  }).on('error', e => console.error('[Capital] Keep-alive error:', e.message));
}

function connectWS() {
  if (!connected) return;
  try {
    ws = new WebSocket('wss://api-streaming-capital.backend-capital.com/connect', {
      headers: {
        'CST': cst,
        'X-SECURITY-TOKEN': securityToken
      }
    });
    
    ws.on('open', () => {
      console.log('[Capital WS] Streaming connection opened');
      for (const epic of Object.values(SYMBOL_MAP)) {
        const msg = JSON.stringify({
          destination: "marketData.subscribe",
          correlationId: "fractal_" + Date.now(),
          cst: cst,
          securityToken: securityToken,
          payload: { epics: [epic] }
        });
        ws.send(msg);
      }
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.destination === 'quote' && msg.payload) {
          const epic = msg.payload.epic;
          const internalSym = Object.keys(SYMBOL_MAP).find(key => SYMBOL_MAP[key] === epic);
          if (!internalSym) return;

          const px = parseFloat(msg.payload.bid);
          const ts = Date.now();

          if (px) {
            for (const tf of TIMEFRAMES) {
              store.writeTick(SOURCE, internalSym, tf, TF_MS[tf], px, 0, ts);
            }
          }
        }
      } catch (e) {
        // ignore parse errors
      }
    });

    ws.on('close', () => {
      console.log('[Capital WS] Connection closed. Reconnecting...');
      setTimeout(connectWS, 5000);
    });

    ws.on('error', (err) => {
      console.error('[Capital WS] Error:', err.message);
    });
  } catch (e) {
    console.error('[Capital WS] Init error:', e.message);
  }
}

async function searchMarkets(query) {
  return new Promise((resolve) => {
    if (!connected) return resolve([]);
    const opts = {
      hostname: BASE_URL,
      path: `/api/v1/markets?searchTerm=${encodeURIComponent(query)}`,
      method: 'GET',
      headers: {
        'X-CAP-API-KEY': API_KEY,
        'CST': cst,
        'X-SECURITY-TOKEN': securityToken
      }
    };
    https.get(opts, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.markets || !Array.isArray(json.markets)) return resolve([]);
          resolve(json.markets.map(m => ({
            symbol: m.epic, 
            instrument_name: m.instrumentName,
            instrument_type: 'CFD',
            exchange: 'Capital',
            source: 'capital'
          })));
        } catch (e) { resolve([]); }
      });
    }).on('error', () => resolve([]));
  });
}

async function subscribe(internalSym) {
  if (!connected || !ws || ws.readyState !== WebSocket.OPEN) return;
  // If not in SYMBOL_MAP, add it (assuming internalSym is the epic for new ones)
  if (!SYMBOL_MAP[internalSym]) {
    SYMBOL_MAP[internalSym] = internalSym;
  }
  const epic = SYMBOL_MAP[internalSym];
  const msg = JSON.stringify({
    destination: "marketData.subscribe",
    correlationId: "fractal_" + Date.now(),
    cst: cst,
    securityToken: securityToken,
    payload: { epics: [epic] }
  });
  ws.send(msg);
}

async function fetchHistory(internalSym, tf, endTime) {
  return new Promise((resolve) => {
    if (!connected) return resolve([]);
    // Ensure it's in the map
    if (!SYMBOL_MAP[internalSym]) SYMBOL_MAP[internalSym] = internalSym;
    
    const epic = SYMBOL_MAP[internalSym];
    if (!epic) return resolve([]);
    
    const resolution = TF_MAP[tf] || 'MINUTE';
    let path = `/api/v1/prices/${encodeURIComponent(epic)}?resolution=${resolution}&max=1000`;
    if (endTime) {
      path += `&to=${new Date(endTime).toISOString().slice(0, 19)}`;
    }

    const opts = {
      hostname: BASE_URL,
      path: path,
      method: 'GET',
      headers: {
        'X-CAP-API-KEY': API_KEY,
        'CST': cst,
        'X-SECURITY-TOKEN': securityToken
      }
    };

    https.get(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.prices || !Array.isArray(json.prices)) return resolve([]);
          
          const mapped = json.prices.map(p => ({
            t: new Date(p.snapshotTimeUTC + 'Z').getTime(),
            o: parseFloat(p.openPrice.bid || p.openPrice.ask),
            h: parseFloat(p.highPrice.bid || p.highPrice.ask),
            l: parseFloat(p.lowPrice.bid || p.lowPrice.ask),
            c: parseFloat(p.closePrice.bid || p.closePrice.ask),
            v: parseFloat(p.lastTradedVolume || 0)
          }));
          resolve(mapped);
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', () => resolve([]));
  });
}

async function fetchRecent(internalSym) {
  if (!connected) return;
  console.log(`[Capital] Fetching 1000-candle cache for ${internalSym}...`);
  for (const tf of TIMEFRAMES) {
    try {
      const candles = await fetchHistory(internalSym, tf, null);
      if (candles && candles.length > 0) {
        candles.sort((a, b) => a.t - b.t);
        store.writeCandles(SOURCE, internalSym, tf, candles);
      }
    } catch (e) {
      console.error(`[Capital] Error fetching recent for ${internalSym} ${tf}:`, e.message);
    }
    // Small delay to prevent rate limits
    await new Promise(r => setTimeout(r, 100));
  }
}

async function refreshAllCache() {
  const syms = Object.keys(SYMBOL_MAP);
  console.log(`[Capital] Refreshing cache for ${syms.length} symbols (1000 candles each)...`);
  for (const sym of syms) {
    await fetchRecent(sym);
    await new Promise(r => setTimeout(r, 500));
  }
  console.log('[Capital] Cache refresh complete.');
}

function loadCache() {
  let count = 0;
  for (const sym of Object.keys(SYMBOL_MAP)) {
    store.loadFromDisk(SOURCE, sym);
    for (const tf of TIMEFRAMES) {
      const c = store.readCandles(SOURCE, sym, tf);
      if (c && c.length > 0) count++;
    }
  }
  console.log(`[Capital] Loaded ${count} timeframe caches from disk`);
}

function getStatus() { return { status: connected ? 'connected' : 'disconnected', symbols: Object.keys(SYMBOL_MAP) }; }
function getSymbols() { return Object.keys(SYMBOL_MAP); }
function isReady() { return connected; }

module.exports = {
  SOURCE,
  SYMBOL_MAP,
  TIMEFRAMES,
  connect,
  loadCache,
  fetchRecent,
  fetchHistory,
  searchMarkets,
  subscribe,
  refreshAllCache,
  getStatus,
  getSymbols,
  isReady,
};
