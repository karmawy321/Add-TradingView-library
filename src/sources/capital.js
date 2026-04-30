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
  'GOLD':   'GOLD',   'SILVER': 'SILVER',
  'XAUUSD': 'GOLD',   'XAGUSD': 'SILVER', // Keep these for compatibility but prefer GOLD/SILVER
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

console.log('[Capital] Initialized with symbols:', Object.keys(SYMBOL_MAP).join(', '));

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
    
    ws.on('open', async () => {
      console.log('[Capital WS] Streaming connection opened');
      
      // Get unique epics to subscribe to
      const epics = Array.from(new Set(Object.values(SYMBOL_MAP)));
      console.log(`[Capital WS] Subscribing to ${epics.length} epics...`);
      
      for (let i = 0; i < epics.length; i++) {
        const epic = epics[i];
        const msg = JSON.stringify({
          destination: "marketData.subscribe",
          correlationId: "fractal_" + Date.now() + "_" + i,
          cst: cst,
          securityToken: securityToken,
          payload: { epics: [epic] }
        });
        ws.send(msg);
        // Small delay between subscriptions to avoid flooding
        await new Promise(r => setTimeout(r, 50));
      }
    });

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data);
        if (msg.destination === 'quote' && msg.payload) {
          const epic = msg.payload.epic;
          // Find ALL internal symbols that map to this epic (e.g. XAUUSD and GOLD)
          const internalSyms = Object.keys(SYMBOL_MAP).filter(key => SYMBOL_MAP[key] === epic);
          if (internalSyms.length === 0) return;

          const px = parseFloat(msg.payload.bid);
          const ts = Date.now();

          if (px) {
            for (const sym of internalSyms) {
              for (const tf of TIMEFRAMES) {
                store.writeTick(SOURCE, sym, tf, TF_MS[tf], px, 0, ts);
              }
            }
          }
        } else if (msg.status === 'ERROR' || msg.destination === 'marketData.subscribe') {
          console.log('[Capital WS] System Message:', JSON.stringify(msg));
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
  console.log(`[Capital] Fetching 1500-candle cache for ${internalSym}...`);
  for (const tf of TIMEFRAMES) {
    try {
      let allCandles = await fetchHistory(internalSym, tf, null);
      if (allCandles && allCandles.length >= 1000) {
        // Capital usually returns max 1000. Fetch another block to reach 1500.
        const oldest = allCandles[0].t;
        const more = await fetchHistory(internalSym, tf, oldest - 1);
        if (more && more.length > 0) {
          allCandles = [...more, ...allCandles];
        }
      }
      
      if (allCandles && allCandles.length > 0) {
        allCandles.sort((a, b) => a.t - b.t);
        // Trim to 1500 as requested
        if (allCandles.length > 1500) {
          allCandles = allCandles.slice(allCandles.length - 1500);
        }
        store.writeCandles(SOURCE, internalSym, tf, allCandles);
        console.log(`[Capital] Cached ${allCandles.length} candles for ${internalSym} ${tf}`);
      } else {
        console.warn(`[Capital] No candles returned for ${internalSym} ${tf}`);
      }
    } catch (e) {
      console.error(`[Capital] Error fetching recent for ${internalSym} ${tf}:`, e.message);
    }
    // Small delay to prevent rate limits
    await new Promise(r => setTimeout(r, 200));
  }
}

async function refreshAllCache() {
  const syms = Object.keys(SYMBOL_MAP);
  console.log(`[Capital] Refreshing cache for ${syms.length} symbols (1500 candles each)...`);
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
