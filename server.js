const express   = require('express');
const cors      = require('cors');
const https     = require('https');
const WebSocket = require('ws');

const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL     = process.env.SUPABASE_URL      || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || '';
const sbAdmin = SUPABASE_URL && SUPABASE_SERVICE
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

async function verifyAndDeduct(token, cost) {
  if (!sbAdmin) return { userId: 'dev' };
  if (!token)   throw new Error('Not authenticated');
  const { data: { user }, error } = await sbAdmin.auth.getUser(token);
  if (error || !user) throw new Error('Invalid token');
  const { error: deductErr } = await sbAdmin.rpc('deduct_credits', { user_id: user.id, amount: cost });
  if (deductErr) throw new Error('Insufficient credits');
  return { userId: user.id };
}

/* ═══════════════════════════════════════════════════
   CANDLE BUILDER
   Aggregates raw price ticks into OHLCV candles
   Supports: 1m 5m 15m 1h 4h 1d
   ═══════════════════════════════════════════════════ */
const TF_MS = { '1m':60000, '5m':300000, '15m':900000, '1h':3600000, '4h':14400000, '1d':86400000 };
const TIMEFRAMES = Object.keys(TF_MS);

const candles    = {};   /* candles[symbol][tf] = [{t,o,h,l,c,v}, ...] */
const sseClients = {};   /* sseClients[symbol]  = Set<res> */

function ensureSymbol(sym) {
  if (!candles[sym]) {
    candles[sym] = {};
    TIMEFRAMES.forEach(tf => { candles[sym][tf] = []; });
  }
  if (!sseClients[sym]) sseClients[sym] = new Set();
}

function processTick(sym, price, volume, tsMs) {
  ensureSymbol(sym);
  const ts = tsMs || Date.now();
  TIMEFRAMES.forEach(tf => {
    const periodMs = TF_MS[tf];
    const bucketTs = Math.floor(ts / periodMs) * periodMs;
    const arr      = candles[sym][tf];
    const cur      = arr[arr.length - 1];
    if (!cur || cur.t !== bucketTs) {
      arr.push({ t: bucketTs, o: price, h: price, l: price, c: price, v: volume || 0 });
      if (arr.length > 500) arr.shift();
    } else {
      cur.c  = price;
      cur.h  = Math.max(cur.h, price);
      cur.l  = Math.min(cur.l, price);
      cur.v += (volume || 0);
    }
  });
  pushSSE(sym);
}

function pushSSE(sym) {
  const clients = sseClients[sym];
  if (!clients || clients.size === 0) return;
  const msg = `data: ${JSON.stringify({ symbol: sym, candles: candles[sym] })}\n\n`;
  clients.forEach(res => {
    try { res.write(msg); } catch(e) { clients.delete(res); }
  });
}

/* ═══════════════════════════════════════════════════
   TWELVEDATA WEBSOCKET — Forex + Metals
   Free tier: 8 symbols, 1 persistent connection
   ═══════════════════════════════════════════════════ */
const TWELVEDATA_KEY = process.env.TWELVEDATA_API_KEY || '';
const FOREX_SYMBOLS  = ['EUR/USD','GBP/USD','USD/JPY','GBP/JPY','AUD/USD','USD/CAD','XAU/USD','XAG/USD'];
const FOREX_KEYS     = FOREX_SYMBOLS.map(s => s.replace('/',''));

let tdWs        = null;
let tdConnected = false;
let tdReconnect = null;

function connectTwelveData() {
  if (!TWELVEDATA_KEY) { console.log('[TD] No API key — forex/metals disabled'); return; }
  if (tdWs) { try { tdWs.terminate(); } catch(e) {} }
  clearTimeout(tdReconnect);

  tdWs = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${TWELVEDATA_KEY}`);

  tdWs.on('open', () => {
    tdConnected = true;
    console.log('[TD] Connected — subscribing to', FOREX_SYMBOLS.join(', '));
    tdWs.send(JSON.stringify({ action: 'subscribe', params: { symbols: FOREX_SYMBOLS.join(',') } }));
    FOREX_SYMBOLS.forEach(fetchTDHistory);
  });

  tdWs.on('message', raw => {
    try {
      const msg = JSON.parse(raw);
      if (msg.event === 'price' && msg.symbol && msg.price) {
        processTick(
          msg.symbol.replace('/',''),
          parseFloat(msg.price),
          0,
          msg.timestamp ? msg.timestamp * 1000 : Date.now()
        );
      }
    } catch(e) {}
  });

  tdWs.on('close', () => {
    tdConnected = false;
    console.log('[TD] Disconnected — reconnecting in 5s');
    tdReconnect = setTimeout(connectTwelveData, 5000);
  });

  tdWs.on('error', err => { console.error('[TD] Error:', err.message); tdWs.terminate(); });
}

function fetchTDHistory(sym) {
  if (!TWELVEDATA_KEY) return;
  const path = `/v1/time_series?symbol=${encodeURIComponent(sym)}&interval=1min&outputsize=500&apikey=${TWELVEDATA_KEY}`;
  const req  = https.request({ hostname: 'api.twelvedata.com', path, method: 'GET' }, res => {
    let data = '';
    res.on('data', c => { data += c; });
    res.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (!json.values) return;
        const key  = sym.replace('/','');
        ensureSymbol(key);
        json.values.slice().reverse().forEach(bar => {
          const ts = new Date(bar.datetime).getTime();
          TIMEFRAMES.forEach(tf => {
            const bkt = Math.floor(ts / TF_MS[tf]) * TF_MS[tf];
            const arr = candles[key][tf];
            const lst = arr[arr.length - 1];
            const [o,h,l,c,v] = [bar.open,bar.high,bar.low,bar.close,bar.volume||0].map(parseFloat);
            if (!lst || lst.t !== bkt) {
              arr.push({ t: bkt, o, h, l, c, v });
              if (arr.length > 500) arr.shift();
            } else {
              lst.h = Math.max(lst.h, h); lst.l = Math.min(lst.l, l); lst.c = c; lst.v += v;
            }
          });
        });
        console.log(`[TD] History loaded: ${sym} (${json.values.length} bars)`);
      } catch(e) { console.warn('[TD] History error:', e.message); }
    });
  });
  req.on('error', e => {});
  req.end();
}

/* ═══════════════════════════════════════════════════
   BINANCE WEBSOCKET — Crypto (on-demand per symbol)
   ═══════════════════════════════════════════════════ */
const binanceWs = {};  /* lowercase symbol → WebSocket */

function connectBinance(symbol) {
  const lower = symbol.toLowerCase();
  if (binanceWs[lower]) return;
  fetchBinanceHistory(symbol.toUpperCase());
  const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${lower}@aggTrade`);
  ws.on('open',    ()  => console.log(`[Binance] Connected: ${symbol}`));
  ws.on('message', raw => {
    try {
      const m = JSON.parse(raw);
      processTick(symbol.toUpperCase(), parseFloat(m.p), parseFloat(m.q), m.T || Date.now());
    } catch(e) {}
  });
  ws.on('close',  ()  => { console.log(`[Binance] Closed: ${symbol}`); delete binanceWs[lower]; });
  ws.on('error',  err => { console.error(`[Binance] Error ${symbol}:`, err.message); ws.terminate(); });
  binanceWs[lower] = ws;
}

function disconnectBinanceIfUnused(symbol) {
  const lower = symbol.toLowerCase();
  const key   = symbol.toUpperCase();
  if (!sseClients[key] || sseClients[key].size === 0) {
    if (binanceWs[lower]) { binanceWs[lower].terminate(); delete binanceWs[lower]; }
  }
}

function fetchBinanceHistory(symbol) {
  TIMEFRAMES.forEach(tf => {
    const path = `/api/v3/klines?symbol=${symbol}&interval=${tf}&limit=500`;
    const req  = https.request({ hostname: 'api.binance.com', path, method: 'GET' }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const bars = JSON.parse(data);
          if (!Array.isArray(bars)) return;
          ensureSymbol(symbol);
          bars.forEach(bar => {
            const ts  = bar[0];
            const bkt = Math.floor(ts / TF_MS[tf]) * TF_MS[tf];
            const arr = candles[symbol][tf];
            const lst = arr[arr.length - 1];
            const [o,h,l,c,v] = [bar[1],bar[2],bar[3],bar[4],bar[5]].map(parseFloat);
            if (!lst || lst.t !== bkt) {
              arr.push({ t: bkt, o, h, l, c, v });
              if (arr.length > 500) arr.shift();
            } else {
              lst.h = Math.max(lst.h,h); lst.l = Math.min(lst.l,l); lst.c = c; lst.v += v;
            }
          });
          console.log(`[Binance] History loaded: ${symbol} ${tf} (${bars.length} bars)`);
        } catch(e) {}
      });
    });
    req.on('error', () => {});
    req.end();
  });
}

/* ═══════════════════════════════════════════════════
   SYMBOL CLASSIFIER
   ═══════════════════════════════════════════════════ */
const CRYPTO_SUFFIXES = ['USDT','USDC','BUSD','BTC','ETH','BNB'];
function classifySymbol(sym) {
  const s = sym.toUpperCase().replace('/','').replace('-','');
  if (FOREX_KEYS.includes(s)) return 'forex';
  if (CRYPTO_SUFFIXES.some(q => s.endsWith(q))) return 'crypto';
  return 'unknown';
}

/* ═══════════════════════════════════════════════════
   ANTHROPIC HELPER
   ═══════════════════════════════════════════════════ */
function callAnthropic(apiKey, model, prompt, image, mediaType, maxTokens, res) {
  const body = JSON.stringify({
    model, max_tokens: maxTokens || 2000,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
      { type: 'text',  text: prompt }
    ]}]
  });
  const opts = {
    hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey.trim(),
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }
  };
  const req = https.request(opts, apiRes => {
    let data = '';
    apiRes.on('data', c => { data += c; });
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (apiRes.statusCode !== 200)
          return res.status(apiRes.statusCode).json({ error: (parsed.error && parsed.error.message) || 'Anthropic error' });
        let raw = parsed.content.map(c => c.text || '').join('').replace(/```json|```/g,'').trim();
        const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
        if (s===-1||e===-1) return res.status(500).json({ error: 'No JSON in response' });
        raw = raw.slice(s, e+1).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
        let result;
        try { result = JSON.parse(raw); }
        catch(err) {
          raw = raw.replace(/("(?:[^"\\]|\\.)*")/g, m => m.replace(/\n/g,' ').replace(/\r/g,'').replace(/\t/g,' '));
          try { result = JSON.parse(raw); } catch(e2) { return res.status(422).json({ error: 'Could not parse AI response' }); }
        }
        res.json(result);
      } catch(err) { res.status(500).json({ error: 'Processing error: ' + err.message }); }
    });
  });
  req.on('error', err => res.status(500).json({ error: 'Request failed: ' + err.message }));
  req.write(body); req.end();
}

function rl(l) { return l==='ar'?'Arabic':l==='pt'?'Portuguese':'English'; }

/* ═══════════════════════════════════════════════════
   EXPRESS
   ═══════════════════════════════════════════════════ */
const app  = express();
const PORT = process.env.PORT || 3000;
app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '20mb' }));

app.get('/', (req, res) => res.json({
  status: 'ok', service: 'Fractal AI Agent', version: '3.0.0',
  hasKey: !!process.env.ANTHROPIC_API_KEY,
  tdConnected,
  forexSymbols: FOREX_KEYS,
  cryptoActive: Object.keys(binanceWs)
}));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

/* ── /symbols — available symbols ── */
app.get('/symbols', (req, res) => {
  res.json({
    forex:  FOREX_KEYS.map(s => ({ symbol: s, type: 'forex',  live: tdConnected, hasData: !!(candles[s] && candles[s]['1m'].length > 0) })),
    crypto: Object.keys(binanceWs).map(s => ({ symbol: s.toUpperCase(), type: 'crypto', live: true }))
  });
});

/* ── /candles/:symbol — REST history ── */
app.get('/candles/:symbol', (req, res) => {
  const sym = req.params.symbol.toUpperCase().replace('/','').replace('-','');
  const tf  = req.query.tf || '1h';
  if (!candles[sym] || !candles[sym][tf] || candles[sym][tf].length === 0)
    return res.status(404).json({ error: `No candles for ${sym} ${tf}` });
  res.json({ symbol: sym, tf, candles: candles[sym][tf] });
});

/* ── /subscribe/:symbol — SSE live candle stream ── */
app.get('/subscribe/:symbol', (req, res) => {
  const sym  = req.params.symbol.toUpperCase().replace('/','').replace('-','');
  const type = classifySymbol(sym);

  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  ensureSymbol(sym);
  sseClients[sym].add(res);

  /* Send current snapshot immediately */
  if (candles[sym]['1m'].length > 0) {
    res.write(`data: ${JSON.stringify({ symbol: sym, candles: candles[sym] })}\n\n`);
  }

  /* Connect data source if needed */
  if (type === 'crypto') connectBinance(sym);

  /* Heartbeat */
  const hb = setInterval(() => {
    try { res.write(': ping\n\n'); } catch(e) { clearInterval(hb); }
  }, 20000);

  req.on('close', () => {
    clearInterval(hb);
    sseClients[sym].delete(res);
    if (type === 'crypto') setTimeout(() => disconnectBinanceIfUnused(sym), 15000);
  });
});

/* ── /price/:symbol — latest tick ── */
app.get('/price/:symbol', (req, res) => {
  const sym = req.params.symbol.toUpperCase().replace('/','').replace('-','');
  const arr = candles[sym] && candles[sym]['1m'];
  if (!arr || arr.length === 0) return res.status(404).json({ error: 'No data for ' + sym });
  const last = arr[arr.length - 1];
  const prev = arr.length > 1 ? arr[arr.length - 2].c : last.o;
  res.json({ symbol: sym, price: last.c, open: last.o, high: last.h, low: last.l,
             change_pct: ((last.c - prev) / prev * 100).toFixed(4), ts: last.t });
});

/* ═══════════════════════════════════════════════════
   AI ENDPOINTS
   ═══════════════════════════════════════════════════ */

app.post('/analyze', async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, focus, matches, language: l, _token } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  try { await verifyAndDeduct(_token, 3); } catch(e) { return res.status(402).json({ error: e.message }); }
  const nM = matches || 3;
  const p = `Fractal analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Focus: ${focus||'fractal'}. Find ${nM} historical fractal matches. Reply in ${rl(l)}. JSON only, no markdown, single-line strings.\n{"signal":"bullish|bearish|neutral","pair":"str","timeframe":"str","pattern":"str","wave":"str","analysis":"5 sentences","entry":"price","stop_loss":"price","target_1":"price","target_2":"price","rr":"1:2.5","confidence":"high|medium|low","annotations":[{"type":"hline|arrow|zone|tline","label":"str","y":0.6,"color":"#hex","dashed":true,"x":0.5,"dir":"up|down","y1":0.6,"y2":0.7,"x1":0.1,"x2":0.9}],"matches":[{"id":1,"date":"str","pair":"str","timeframe":"str","similarity":88,"pattern_name":"str","setup_description":"2 sentences","outcome":"win|loss","outcome_detail":"str","price_path":[20 floats 0-1],"after_path":[10 floats 0-1]}],"win_rate":67,"avg_rr":"str","wins":2,"losses":1,"prediction_summary":"2 sentences","predicted_path":[20 floats 0-1]}\nRules: exactly ${nM} matches. y:0=top,1=bottom. x:0=left,1=right.`;
  callAnthropic(k, 'claude-sonnet-4-20250514', p, image, mediaType, 2500, res);
});

app.post('/bar-pattern', (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  const p = `Fractal bar self-similarity analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Find 2-3 self-similar bar sequences. Reply in ${rl(l)}. JSON only, no markdown, single-line strings.\n{"pair":"str","timeframe":"str","dominant_pattern":"str","fractal_dimension":"1.3","self_similarity_score":82,"bar_clusters":[{"id":1,"name":"str","description":"1-2 sentences","location_a":{"x1":0.05,"x2":0.25,"label":"str"},"location_b":{"x1":0.55,"x2":0.75,"label":"str"},"similarity_pct":84,"bar_sequence":[8 floats 0-1],"color":"#hex"}],"scale_levels":[{"level":"Macro|Mid|Micro","bars":20,"pattern":"str","strength":"high|medium|low"}],"trading_implication":"2 sentences","next_expected_sequence":[8 floats 0-1],"confidence":"high|medium|low","signal":"bullish|bearish|neutral"}`;
  callAnthropic(k, 'claude-sonnet-4-20250514', p, image, mediaType, 2000, res);
});

app.post('/weierstrass', (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  const p = `Weierstrass/time-series analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Decompose price. Reply in ${rl(l)}. JSON only, no markdown, single-line strings.\n{"pair":"str","timeframe":"str","hurst_exponent":0.67,"fractal_dimension":1.33,"roughness_index":"high|medium|low","market_regime":"trending|mean-reverting|random-walk","decomposition":{"trend":{"direction":"up|down|sideways","strength":0.72,"description":"1 sentence","path":[10 floats 0-1]},"cycle":{"period_bars":14,"amplitude":0.08,"phase":"rising|falling|peak|trough","description":"1 sentence","path":[10 floats]},"fractal_noise":{"intensity":0.31,"color":"pink|white|brown","weierstrass_a":0.7,"weierstrass_b":3,"description":"1 sentence","path":[10 floats]}},"weierstrass_fit":{"quality":"excellent|good|fair|poor","score":78,"description":"2 sentences","dominant_frequency":0.14,"harmonics":[{"n":1,"weight":0.8,"frequency":0.14},{"n":2,"weight":0.56,"frequency":0.28}]},"scale_invariance":{"confirmed":true,"description":"1-2 sentences"},"noise_signal":{"interpretation":"2 sentences","edge":"bullish|bearish|neutral","confidence":"high|medium|low"},"predicted_decomposed_path":[10 floats 0-1]}`;
  callAnthropic(k, 'claude-sonnet-4-20250514', p, image, mediaType, 2000, res);
});

app.post('/fibonacci', (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  const p = `Fibonacci analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. All Fib levels. Reply in ${rl(l)}. JSON only.\n{"pair":"str","timeframe":"str","swing_high":{"price":"str","x":0.85,"y":0.15},"swing_low":{"price":"str","x":0.2,"y":0.82},"trend":"uptrend|downtrend","retracements":[{"level":"0.236","price":"str","y":0.28,"strength":"weak|moderate|strong","color":"#3498db"},{"level":"0.382","price":"str","y":0.38,"strength":"weak|moderate|strong","color":"#2980b9"},{"level":"0.5","price":"str","y":0.48,"strength":"weak|moderate|strong","color":"#c9a84c"},{"level":"0.618","price":"str","y":0.57,"strength":"weak|moderate|strong","color":"#e67e22"},{"level":"0.786","price":"str","y":0.67,"strength":"weak|moderate|strong","color":"#e74c3c"}],"extensions":[{"level":"1.272","price":"str","y":0.05,"color":"#27ae60"},{"level":"1.618","price":"str","y":-0.05,"color":"#1abc9c"},{"level":"2.618","price":"str","y":-0.15,"color":"#16a085"}],"key_level":{"level":"str","price":"str","reason":"1 sentence"},"current_position":{"between_levels":"str","bias":"bullish|bearish|neutral","next_target":"str"},"analysis":"3 sentences","signal":"bullish|bearish|neutral","confidence":"high|medium|low"}`;
  callAnthropic(k, 'claude-sonnet-4-20250514', p, image, mediaType, 2000, res);
});

app.post('/smc', (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  const p = `SMC analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. BOS/CHoCH, order blocks, FVGs, liquidity. Reply in ${rl(l)}. JSON only.\n{"pair":"str","timeframe":"str","market_structure":"bullish|bearish|ranging","last_bos":{"type":"BOS|CHOCH","direction":"bullish|bearish","x":0.6,"y":0.4,"label":"str","description":"1 sentence"},"order_blocks":[{"type":"bullish|bearish","x1":0.1,"x2":0.25,"y1":0.6,"y2":0.7,"strength":"strong|medium|weak","description":"1 sentence","color":"#27ae60","mitigated":false}],"fvg":[{"type":"bullish|bearish","x1":0.3,"x2":0.5,"y1":0.35,"y2":0.42,"filled":false,"color":"#3498db"}],"liquidity_pools":[{"type":"buy-side|sell-side","y":0.2,"x1":0.0,"x2":1.0,"label":"str","color":"#c9a84c","swept":false}],"premium_discount":{"current_zone":"premium|discount|equilibrium","equilibrium_y":0.5},"bias":"bullish|bearish|neutral","poi":{"type":"str","x1":0.4,"x2":0.55,"y1":0.55,"y2":0.65,"label":"str","reason":"1 sentence"},"analysis":"4 sentences","entry_model":{"trigger":"str","entry":"str","sl":"str","tp1":"str","tp2":"str","rr":"1:3"},"signal":"bullish|bearish|neutral","confidence":"high|medium|low"}`;
  callAnthropic(k, 'claude-sonnet-4-20250514', p, image, mediaType, 2500, res);
});

app.post('/volatility', (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  const p = `Volatility analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Regime + position sizing. Reply in ${rl(l)}. JSON only.\n{"pair":"str","timeframe":"str","regime":"low|medium|high|extreme","regime_score":65,"atr_estimate":"str","volatility_percentile":72,"fractal_variance":0.34,"vol_path":[10 floats 0-1],"position_sizing":{"suggested_stop_pct":"str","max_position_size":"str","leverage_warning":"str"},"regime_characteristics":{"mean_reversion_probability":0.6,"trend_continuation_probability":0.4,"expected_daily_range":"str","breakout_likelihood":"low|medium|high"},"strategy_adaptation":{"recommended_approach":"str","avoid":"str"},"analysis":"3 sentences","signal":"bullish|bearish|neutral","confidence":"high|medium|low"}`;
  callAnthropic(k, 'claude-sonnet-4-20250514', p, image, mediaType, 2000, res);
});

app.post('/mtf', (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  const p = `MTF fractal analyst. Chart: ${pair||'asset'}. Infer Weekly/Daily/H4. Reply in ${rl(l)}. JSON only.\n{"pair":"str","detected_timeframe":"str","timeframes":[{"tf":"Weekly","bias":"bullish|bearish|neutral","fractal_phase":"str","key_level":"str","weight":0.4,"path":[10 floats 0-1]},{"tf":"Daily","bias":"bullish|bearish|neutral","fractal_phase":"str","key_level":"str","weight":0.35,"path":[10 floats 0-1]},{"tf":"H4","bias":"bullish|bearish|neutral","fractal_phase":"str","key_level":"str","weight":0.25,"path":[10 floats 0-1]}],"confluence_score":78,"aligned":true,"confluence_zones":[{"price":"str","y":0.45,"strength":"high|medium|low","timeframes_aligned":["Weekly","Daily"],"color":"#c9a84c","label":"str"}],"dominant_bias":"bullish|bearish|neutral","fractal_alignment":"all-aligned|partially-aligned|divergent","analysis":"4 sentences","signal":"bullish|bearish|neutral","confidence":"high|medium|low","entry":"str","stop_loss":"str","target":"str"}`;
  callAnthropic(k, 'claude-opus-4-5', p, image, mediaType, 2500, res);
});

app.post('/fractal-age', (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  const p = `Fractal cycle timing analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Maturity + urgency. Reply in ${rl(l)}. JSON only.\n{"pair":"str","timeframe":"str","fractal_age":{"bars_into_pattern":34,"estimated_total_bars":55,"completion_pct":62,"age_label":"Mature|Young|Aging|Early","phase":"impulse|correction|distribution|accumulation"},"cycle_position":{"current_phase":"str","phases_completed":["str"],"phases_remaining":["str"],"cycle_path":[20 floats 0-1]},"time_projections":[{"scenario":"Base","bars_to_resolution":21,"direction":"bullish|bearish","probability":0.55,"target_price":"str"},{"scenario":"Bear","bars_to_resolution":13,"direction":"bearish","probability":0.3,"target_price":"str"},{"scenario":"Extended","bars_to_resolution":34,"direction":"bullish","probability":0.15,"target_price":"str"}],"urgency":"now|soon|wait|early","best_entry_window":"str","analysis":"4 sentences","signal":"bullish|bearish|neutral","confidence":"high|medium|low"}`;
  callAnthropic(k, 'claude-opus-4-5', p, image, mediaType, 2500, res);
});

app.post('/liquidity', (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  const p = `Liquidity analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Stop clusters, pools, hunt targets. Reply in ${rl(l)}. JSON only.\n{"pair":"str","timeframe":"str","liquidity_pools":[{"type":"buy-stops|sell-stops|equal-highs|equal-lows","price":"str","y":0.15,"size":"large|medium|small","swept":false,"x_position":0.8,"label":"str","color":"#e74c3c","description":"1 sentence"}],"stop_clusters":[{"type":"retail-longs|retail-shorts","price":"str","y":0.72,"concentration":"high|medium|low","x1":0.0,"x2":1.0,"color":"rgba(231,76,60,0.15)"}],"hunt_targets":[{"label":"str","price":"str","y":0.1,"probability":"high|medium|low","color":"#c9a84c","direction":"up|down","bars_estimate":8}],"smart_money_direction":"bullish|bearish|neutral","analysis":"4 sentences","signal":"bullish|bearish|neutral","confidence":"high|medium|low","next_likely_sweep":"str"}`;
  callAnthropic(k, 'claude-sonnet-4-20250514', p, image, mediaType, 2500, res);
});

app.post('/journal', (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l, trade_notes, outcome, pnl } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  const p = `Trading coach. Chart: ${pair||'asset'} ${timeframe||'auto'}. Notes:"${trade_notes||'none'}". Outcome:${outcome||'unknown'}. P&L:${pnl||'unknown'}. Reply in ${rl(l)}. JSON only.\n{"pair":"str","timeframe":"str","overall_grade":"A|B|C|D|F","grade_score":72,"categories":{"entry_quality":{"score":80,"comment":"1 sentence","improvement":"1 sentence"},"fractal_alignment":{"score":65,"comment":"1 sentence","improvement":"1 sentence"},"risk_management":{"score":70,"comment":"1 sentence","improvement":"1 sentence"},"timing":{"score":60,"comment":"1 sentence","improvement":"1 sentence"},"patience":{"score":75,"comment":"1 sentence","improvement":"1 sentence"}},"what_went_right":["str","str"],"what_went_wrong":["str","str"],"missed_fractal_signals":["str","str"],"coach_message":"3 sentences","key_lesson":"1 sentence","next_focus":"str"}`;
  callAnthropic(k, 'claude-opus-4-5', p, image, mediaType, 2000, res);
});

app.post('/projection', (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  const p = `Price projection analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. 3 forward scenarios. Reply in ${rl(l)}. JSON only.\n{"pair":"str","timeframe":"str","current_price":"str","last_candle_y":0.45,"signal":"bullish|bearish|neutral","confidence":"high|medium|low","fractal_basis":"1 sentence","scenarios":[{"label":"Base Case","probability":0.55,"direction":"bullish|bearish","color":"#27ae60","bars":30,"target_price":"str","target_y":0.3,"path":[30 floats],"invalidation_price":"str","invalidation_y":0.55},{"label":"Bear Case","probability":0.30,"direction":"bearish","color":"#e74c3c","bars":20,"target_price":"str","target_y":0.65,"path":[20 floats],"invalidation_price":"str","invalidation_y":0.35},{"label":"Extended","probability":0.15,"direction":"bullish","color":"#9b8fe8","bars":40,"target_price":"str","target_y":0.05,"path":[40 floats],"invalidation_price":"str","invalidation_y":0.55}],"analysis":"4 sentences","entry_zone":{"price_from":"str","price_to":"str","y1":0.42,"y2":0.48},"stop_loss":{"price":"str","y":0.55},"chart_context":{"trend":"uptrend|downtrend|sideways","last_pattern":"str","wave_position":"str"}}`;
  callAnthropic(k, 'claude-opus-4-5', p, image, mediaType, 3000, res);
});

/* ── START ── */
app.listen(PORT, () => {
  console.log(`\n=== Fractal AI Agent v3.0 — port ${PORT} ===`);
  console.log('Anthropic key:', !!process.env.ANTHROPIC_API_KEY);
  console.log('TwelveData key:', !!TWELVEDATA_KEY);
  console.log('Forex symbols:', FOREX_SYMBOLS.join(', '));
  connectTwelveData();
});
