const express = require('express');
const cors    = require('cors');
const https   = require('https');
const path    = require('path');
const fs      = require('fs');

/* ── SUPABASE ADMIN ── */
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

/* ── SHARED ANTHROPIC HELPER ── */
function callAnthropic(apiKey, model, prompt, image, mediaType, maxTokens, res) {
  const body = JSON.stringify({
    model,
    max_tokens: maxTokens || 2000,
    messages: [{ role: 'user', content: [
      { type: 'image', source: { type: 'base64', media_type: mediaType, data: image } },
      { type: 'text', text: prompt }
    ]}]
  });
  const opts = {
    hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) }
  };
  const req = https.request(opts, apiRes => {
    let data = '';
    apiRes.on('data', c => { data += c; });
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (apiRes.statusCode !== 200) return res.status(apiRes.statusCode).json({ error: (parsed.error && parsed.error.message) || 'Anthropic error' });
        let raw = parsed.content.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
        const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
        if (s === -1 || e === -1) return res.status(500).json({ error: 'No JSON in response' });
        raw = raw.slice(s, e + 1).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
        let result;
        try { result = JSON.parse(raw); }
        catch (err) {
          raw = raw.replace(/("(?:[^"\\]|\\.)*")/g, m => m.replace(/\n/g, ' ').replace(/\r/g, '').replace(/\t/g, ' '));
          try { result = JSON.parse(raw); } catch (e2) { return res.status(422).json({ error: 'Could not parse AI response' }); }
        }
        res.json(result);
      } catch (err) { res.status(500).json({ error: 'Processing error: ' + err.message }); }
    });
  });
  req.on('error', err => res.status(500).json({ error: 'Request failed: ' + err.message }));
  req.write(body); req.end();
}

function lang(l) { return l === 'ar' ? 'Arabic' : l === 'pt' ? 'Portuguese' : 'English'; }

/* ══════════════════════════════════════════════
   BINANCE LIVE DATA
   No API key needed — public endpoints only
   ══════════════════════════════════════════════ */

/* Normalise pair input → Binance symbol e.g. "BTC/USDT" → "BTCUSDT" */
function toSymbol(pair) {
  if (!pair) return null;
  return pair.replace('/', '').replace('-', '').toUpperCase();
}

/* Fetch from Binance REST (returns a Promise) */
function binanceFetch(path) {
  return new Promise((resolve, reject) => {
    const opts = {
      hostname: 'api.binance.com',
      path,
      method: 'GET',
      headers: { 'User-Agent': 'FractalAIAgent/2.0' }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Binance parse error')); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/* Get live price + 24h stats for a symbol */
async function getLivePrice(pair) {
  const symbol = toSymbol(pair);
  if (!symbol) return null;
  try {
    const [ticker, stats] = await Promise.all([
      binanceFetch(`/api/v3/ticker/price?symbol=${symbol}`),
      binanceFetch(`/api/v3/ticker/24hr?symbol=${symbol}`)
    ]);
    if (ticker.code) return null; // Binance error (symbol not found etc)
    return {
      symbol,
      price:         parseFloat(ticker.price),
      price_str:     parseFloat(ticker.price).toLocaleString('en-US', { maximumFractionDigits: 8 }),
      change_24h:    parseFloat(stats.priceChangePercent).toFixed(2),
      high_24h:      parseFloat(stats.highPrice),
      low_24h:       parseFloat(stats.lowPrice),
      volume_24h:    parseFloat(stats.quoteVolume).toFixed(0),
      open_24h:      parseFloat(stats.openPrice),
      trend_24h:     parseFloat(stats.priceChangePercent) >= 0 ? 'up' : 'down',
      timestamp:     new Date().toISOString()
    };
  } catch (e) {
    return null; // Binance unavailable — analysis continues without live data
  }
}

/* Get last N candles for context */
async function getCandles(pair, interval = '1h', limit = 24) {
  const symbol = toSymbol(pair);
  if (!symbol) return null;
  try {
    const candles = await binanceFetch(
      `/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
    if (!Array.isArray(candles)) return null;
    return candles.map(c => ({
      open:   parseFloat(c[1]),
      high:   parseFloat(c[2]),
      low:    parseFloat(c[3]),
      close:  parseFloat(c[4]),
      volume: parseFloat(c[5])
    }));
  } catch (e) {
    return null;
  }
}

/* Enrich analysis result with live Binance data */
function enrichWithLiveData(result, liveData) {
  if (!liveData) return result;
  return {
    ...result,
    live: {
      price:      liveData.price_str,
      change_24h: liveData.change_24h + '%',
      high_24h:   liveData.high_24h,
      low_24h:    liveData.low_24h,
      volume_24h: '$' + parseInt(liveData.volume_24h).toLocaleString(),
      trend_24h:  liveData.trend_24h,
      timestamp:  liveData.timestamp,
      symbol:     liveData.symbol
    }
  };
}

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json({ limit: '20mb' }));

/* ── Serve charting_library + datafeed as static ── */
app.use('/charting_library', express.static(path.join(__dirname, 'charting_library'), {
  setHeaders: function(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'public, max-age=86400');
  }
}));
app.get('/datafeed.js', function(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/javascript');
  res.sendFile(path.join(__dirname, 'datafeed.js'));
});
app.get('/chart', function(req, res) {
  res.setHeader('X-Frame-Options', 'ALLOWALL');
  res.setHeader('Content-Security-Policy', "frame-ancestors *");
  res.sendFile(path.join(__dirname, 'chart.html'));
});

app.get('/', (req, res) => res.json({ status: 'ok', service: 'Fractal AI Agent API', version: '2.0.0', hasKey: !!process.env.ANTHROPIC_API_KEY }));
app.get('/health', (req, res) => res.json({ status: 'ok' }));

/* ── GET /price/:pair — live price for any pair ── */
app.get('/price/:pair', async (req, res) => {
  const data = await getLivePrice(req.params.pair);
  if (!data) return res.status(404).json({ error: 'Symbol not found or Binance unavailable' });
  res.json(data);
});

/* ── GET /price/:pair/candles — recent candles ── */
app.get('/price/:pair/candles', async (req, res) => {
  const { interval = '1h', limit = '24' } = req.query;
  const data = await getCandles(req.params.pair, interval, parseInt(limit));
  if (!data) return res.status(404).json({ error: 'Symbol not found or Binance unavailable' });
  res.json({ symbol: toSymbol(req.params.pair), interval, candles: data });
});

/* ══════════════════════════════════════════════
   /analyze — Fractal Pattern Matcher
   ══════════════════════════════════════════════ */
app.post('/analyze', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, focus, matches, language: l, _token } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  try { await verifyAndDeduct(_token, 3); } catch(e) { return res.status(402).json({ error: e.message }); }

  const nM = matches || 3;

  /* Fetch live Binance price — runs in parallel, non-blocking */
  const liveData = await getLivePrice(pair);
  const liveCtx  = liveData
    ? `Live price now: ${liveData.price_str} (${liveData.change_24h}% 24h, H:${liveData.high_24h} L:${liveData.low_24h}). Use this as reference for entry/SL/TP levels.`
    : '';

  const p = `Fractal analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Focus: ${focus||'fractal'}. Find ${nM} historical fractal matches. ${liveCtx} Reply in ${lang(l)}. JSON only, no markdown, single-line strings.
{"signal":"bullish|bearish|neutral","pair":"str","timeframe":"str","pattern":"str","wave":"str","analysis":"5 sentences","entry":"price","stop_loss":"price","target_1":"price","target_2":"price","rr":"1:2.5","confidence":"high|medium|low","annotations":[{"type":"hline|arrow|zone|tline","label":"str","y":0.6,"color":"#hex","dashed":true,"x":0.5,"dir":"up|down","y1":0.6,"y2":0.7,"x1":0.1,"x2":0.9}],"matches":[{"id":1,"date":"str","pair":"str","timeframe":"str","similarity":88,"pattern_name":"str","setup_description":"2 sentences","outcome":"win|loss","outcome_detail":"str","price_path":[20 floats 0-1],"after_path":[10 floats 0-1]}],"win_rate":67,"avg_rr":"str","wins":2,"losses":1,"prediction_summary":"2 sentences","predicted_path":[20 floats 0-1]}
Rules: exactly ${nM} matches. y:0=top,1=bottom. x:0=left,1=right. Floats normalized 0-1.`;

  const body = JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 2500, messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: image } }, { type: 'text', text: p }] }] });
  const opts = { hostname: 'api.anthropic.com', path: '/v1/messages', method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey.trim(), 'anthropic-version': '2023-06-01', 'Content-Length': Buffer.byteLength(body) } };
  const apiReq = https.request(opts, apiRes => {
    let data = '';
    apiRes.on('data', c => { data += c; });
    apiRes.on('end', () => {
      try {
        const parsed = JSON.parse(data);
        if (apiRes.statusCode !== 200) return res.status(apiRes.statusCode).json({ error: (parsed.error && parsed.error.message) || 'Anthropic API error' });
        let raw = parsed.content.map(c => c.text || '').join('').replace(/```json|```/g, '').trim();
        const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
        if (s === -1 || e === -1) return res.status(500).json({ error: 'No JSON in response.' });
        raw = raw.slice(s, e + 1).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, '');
        let result;
        try { result = JSON.parse(raw); }
        catch (err) {
          raw = raw.replace(/("(?:[^"\\]|\\.)*")/g, m => m.replace(/\n/g, ' ').replace(/\r/g, '').replace(/\t/g, ' '));
          try { result = JSON.parse(raw); } catch (e2) { return res.status(422).json({ error: 'Could not parse AI response.' }); }
        }
        res.json(result);
      } catch (err) { res.status(500).json({ error: 'Processing error: ' + err.message }); }
    });
  });
  apiReq.on('error', err => res.status(500).json({ error: 'Request failed: ' + err.message }));
  apiReq.write(body); apiReq.end();
});

/* ══════════════════════════════════════════════
   /bar-pattern — Bar Self-Similarity
   ══════════════════════════════════════════════ */
app.post('/bar-pattern', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });

  const p = `Fractal analyst specializing in intra-chart bar self-similarity. Chart: ${pair||'asset'} ${timeframe||'auto'}. Find 2-3 self-similar bar sequences repeating at different locations within this same chart. Reply in ${lang(l)}. JSON only, no markdown, single-line strings.
{"pair":"str","timeframe":"str","dominant_pattern":"str","fractal_dimension":"1.3","self_similarity_score":82,"bar_clusters":[{"id":1,"name":"str","description":"1-2 sentences","location_a":{"x1":0.05,"x2":0.25,"label":"str"},"location_b":{"x1":0.55,"x2":0.75,"label":"str"},"similarity_pct":84,"bar_sequence":[8 floats 0-1],"color":"#hex"}],"scale_levels":[{"level":"Macro|Mid|Micro","bars":20,"pattern":"str","strength":"high|medium|low"}],"trading_implication":"2 sentences","next_expected_sequence":[8 floats 0-1],"confidence":"high|medium|low","signal":"bullish|bearish|neutral"}
x:0=left,1=right. bar_sequence normalized 0=bottom,1=top.`;

  callAnthropic(apiKey, 'claude-sonnet-4-20250514', p, image, mediaType, 2000, res);
});

/* ══════════════════════════════════════════════
   /weierstrass — Time Series Decomposition
   ══════════════════════════════════════════════ */
app.post('/weierstrass', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });

  const p = `Fractal mathematics and time series analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Decompose price via Weierstrass function. Reply in ${lang(l)}. JSON only, no markdown, single-line strings.
{"pair":"str","timeframe":"str","hurst_exponent":0.67,"fractal_dimension":1.33,"roughness_index":"high|medium|low","market_regime":"trending|mean-reverting|random-walk","decomposition":{"trend":{"direction":"up|down|sideways","strength":0.72,"description":"1 sentence","path":[10 floats 0-1]},"cycle":{"period_bars":14,"amplitude":0.08,"phase":"rising|falling|peak|trough","description":"1 sentence","path":[10 floats]},"fractal_noise":{"intensity":0.31,"color":"pink|white|brown","weierstrass_a":0.7,"weierstrass_b":3,"description":"1 sentence","path":[10 floats]}},"weierstrass_fit":{"quality":"excellent|good|fair|poor","score":78,"description":"2 sentences","dominant_frequency":0.14,"harmonics":[{"n":1,"weight":0.8,"frequency":0.14},{"n":2,"weight":0.56,"frequency":0.28},{"n":3,"weight":0.39,"frequency":0.42}]},"scale_invariance":{"confirmed":true,"scales_tested":["micro","mid","macro"],"best_scale":"mid","description":"1-2 sentences"},"noise_signal":{"interpretation":"2 sentences","edge":"bullish|bearish|neutral","confidence":"high|medium|low"},"predicted_decomposed_path":[10 floats 0-1]}
Hurst>0.5=trending,<0.5=mean-reverting. All path arrays=10 floats.`;

  callAnthropic(apiKey, 'claude-sonnet-4-20250514', p, image, mediaType, 2000, res);
});

/* ══════════════════════════════════════════════
   /fibonacci — Auto Fibonacci Levels
   ══════════════════════════════════════════════ */
app.post('/fibonacci', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });

  const p = `Fibonacci analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Identify swing high/low, calculate all Fib retracements and extensions. Reply in ${lang(l)}. JSON only, no markdown, single-line strings.
{"pair":"str","timeframe":"str","swing_high":{"price":"str","x":0.85,"y":0.15,"label":"Swing High"},"swing_low":{"price":"str","x":0.2,"y":0.82,"label":"Swing Low"},"trend":"uptrend|downtrend","retracements":[{"level":"0.236","price":"str","y":0.28,"strength":"weak|moderate|strong","color":"#3498db"},{"level":"0.382","price":"str","y":0.38,"strength":"weak|moderate|strong","color":"#2980b9"},{"level":"0.5","price":"str","y":0.48,"strength":"weak|moderate|strong","color":"#c9a84c"},{"level":"0.618","price":"str","y":0.57,"strength":"weak|moderate|strong","color":"#e67e22"},{"level":"0.786","price":"str","y":0.67,"strength":"weak|moderate|strong","color":"#e74c3c"},{"level":"1.0","price":"str","y":0.82,"strength":"weak|moderate|strong","color":"#8e44ad"}],"extensions":[{"level":"1.272","price":"str","y":0.05,"color":"#27ae60"},{"level":"1.618","price":"str","y":-0.05,"color":"#1abc9c"},{"level":"2.618","price":"str","y":-0.15,"color":"#16a085"}],"key_level":{"level":"str","price":"str","reason":"1 sentence"},"current_position":{"between_levels":"str","bias":"bullish|bearish|neutral","next_target":"str"},"analysis":"3 sentences","signal":"bullish|bearish|neutral","confidence":"high|medium|low"}
y:0=top,1=bottom.`;

  callAnthropic(apiKey, 'claude-sonnet-4-20250514', p, image, mediaType, 2000, res);
});

/* ══════════════════════════════════════════════
   /smc — Smart Money Concepts
   ══════════════════════════════════════════════ */
app.post('/smc', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });

  const p = `SMC analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Identify BOS/CHoCH, order blocks, FVGs, liquidity pools, premium/discount zones. Reply in ${lang(l)}. JSON only, no markdown, single-line strings.
{"pair":"str","timeframe":"str","market_structure":"bullish|bearish|ranging","last_bos":{"type":"BOS|CHOCH","direction":"bullish|bearish","x":0.6,"y":0.4,"label":"str","description":"1 sentence"},"order_blocks":[{"type":"bullish|bearish","x1":0.1,"x2":0.25,"y1":0.6,"y2":0.7,"strength":"strong|medium|weak","description":"1 sentence","color":"#27ae60","mitigated":false}],"fvg":[{"type":"bullish|bearish","x1":0.3,"x2":0.5,"y1":0.35,"y2":0.42,"filled":false,"color":"#3498db"}],"liquidity_pools":[{"type":"buy-side|sell-side","y":0.2,"x1":0.0,"x2":1.0,"label":"str","color":"#c9a84c","swept":false}],"premium_discount":{"current_zone":"premium|discount|equilibrium","equilibrium_y":0.5,"premium_y":0.25,"discount_y":0.75},"inducement":[{"x":0.4,"y":0.3,"label":"IDM","color":"#e74c3c"}],"bias":"bullish|bearish|neutral","poi":{"type":"str","x1":0.4,"x2":0.55,"y1":0.55,"y2":0.65,"label":"str","reason":"1 sentence"},"analysis":"4 sentences","entry_model":{"trigger":"str","entry":"str","sl":"str","tp1":"str","tp2":"str","rr":"1:3"},"signal":"bullish|bearish|neutral","confidence":"high|medium|low"}`;

  callAnthropic(apiKey, 'claude-sonnet-4-20250514', p, image, mediaType, 2500, res);
});

/* ══════════════════════════════════════════════
   /mtf — Multi-Timeframe Confluence
   ══════════════════════════════════════════════ */
app.post('/mtf', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });

  const p = `Multi-timeframe fractal analyst. Chart: ${pair||'asset'}. Infer Weekly/Daily/H4 fractal structures from visible price action. Reply in ${lang(l)}. JSON only, no markdown, single-line strings.
{"pair":"str","detected_timeframe":"str","timeframes":[{"tf":"Weekly","bias":"bullish|bearish|neutral","fractal_phase":"str","key_level":"str","weight":0.4,"path":[10 floats 0-1]},{"tf":"Daily","bias":"bullish|bearish|neutral","fractal_phase":"str","key_level":"str","weight":0.35,"path":[10 floats 0-1]},{"tf":"H4","bias":"bullish|bearish|neutral","fractal_phase":"str","key_level":"str","weight":0.25,"path":[10 floats 0-1]}],"confluence_score":78,"aligned":true,"confluence_zones":[{"price":"str","y":0.45,"strength":"high|medium|low","timeframes_aligned":["Weekly","Daily"],"color":"#c9a84c","label":"str"}],"dominant_bias":"bullish|bearish|neutral","highest_probability_move":"str","fractal_alignment":"all-aligned|partially-aligned|divergent","analysis":"4 sentences","signal":"bullish|bearish|neutral","confidence":"high|medium|low","entry":"str","stop_loss":"str","target":"str"}`;

  callAnthropic(apiKey, 'claude-opus-4-5', p, image, mediaType, 2500, res);
});

/* ══════════════════════════════════════════════
   /volatility — Volatility Regime + Sizing
   ══════════════════════════════════════════════ */
app.post('/volatility', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l, account_size, risk_pct } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  const acct = account_size || 10000; const risk = risk_pct || 1;

  const p = `Volatility and risk analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Classify regime, calculate position sizing. Account $${acct}, Risk ${risk}%. Reply in ${lang(l)}. JSON only, no markdown, single-line strings.
{"pair":"str","timeframe":"str","regime":"low|medium|high|extreme","regime_score":65,"atr_estimate":"str","volatility_percentile":72,"fractal_variance":0.34,"regime_history":[{"period":"str","regime":"low|medium|high","score":60}],"vol_path":[10 floats 0-1],"position_sizing":{"account":${acct},"risk_pct":${risk},"risk_amount":${acct*risk/100},"suggested_stop_pct":"str","max_position_size":"str","units":"str","leverage_warning":"str"},"regime_characteristics":{"mean_reversion_probability":0.6,"trend_continuation_probability":0.4,"expected_daily_range":"str","breakout_likelihood":"low|medium|high"},"strategy_adaptation":{"recommended_approach":"str","avoid":"str","position_size_multiplier":0.8},"analysis":"3 sentences","signal":"bullish|bearish|neutral","confidence":"high|medium|low"}`;

  callAnthropic(apiKey, 'claude-sonnet-4-20250514', p, image, mediaType, 2000, res);
});

/* ══════════════════════════════════════════════
   /fractal-age — Cycle Timing
   ══════════════════════════════════════════════ */
app.post('/fractal-age', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });

  const p = `Fractal cycle timing analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Determine cycle maturity, bars remaining, urgency. Reply in ${lang(l)}. JSON only, no markdown, single-line strings.
{"pair":"str","timeframe":"str","fractal_age":{"bars_into_pattern":34,"estimated_total_bars":55,"completion_pct":62,"age_label":"Mature|Young|Aging|Early","phase":"impulse|correction|distribution|accumulation"},"cycle_position":{"current_phase":"str","phases_completed":["str"],"phases_remaining":["str"],"cycle_path":[20 floats 0-1]},"time_projections":[{"scenario":"Base","bars_to_resolution":21,"direction":"bullish|bearish","probability":0.55,"target_price":"str"},{"scenario":"Bear","bars_to_resolution":13,"direction":"bearish","probability":0.3,"target_price":"str"},{"scenario":"Extended","bars_to_resolution":34,"direction":"bullish","probability":0.15,"target_price":"str"}],"historical_analogs":[{"date":"str","pair":"str","age_similarity":85,"outcome":"str","bars_taken":21}],"urgency":"now|soon|wait|early","best_entry_window":"str","analysis":"4 sentences","signal":"bullish|bearish|neutral","confidence":"high|medium|low"}`;

  callAnthropic(apiKey, 'claude-opus-4-5', p, image, mediaType, 2500, res);
});

/* ══════════════════════════════════════════════
   /liquidity — Liquidity Map
   ══════════════════════════════════════════════ */
app.post('/liquidity', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });

  const p = `Liquidity and microstructure analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Map stop clusters, liquidity pools, engineered liquidity, hunt targets. Reply in ${lang(l)}. JSON only, no markdown, single-line strings.
{"pair":"str","timeframe":"str","liquidity_pools":[{"type":"buy-stops|sell-stops|equal-highs|equal-lows","price":"str","y":0.15,"size":"large|medium|small","swept":false,"x_position":0.8,"label":"str","color":"#e74c3c","description":"1 sentence"}],"stop_clusters":[{"type":"retail-longs|retail-shorts","price":"str","y":0.72,"concentration":"high|medium|low","x1":0.0,"x2":1.0,"color":"rgba(231,76,60,0.15)"}],"engineered_liquidity":[{"description":"1 sentence","y":0.3,"x":0.6,"type":"inducement|fake-breakout|liquidity-grab","color":"#9b8fe8"}],"hunt_targets":[{"label":"str","price":"str","y":0.1,"probability":"high|medium|low","color":"#c9a84c","direction":"up|down","bars_estimate":8}],"smart_money_direction":"bullish|bearish|neutral","liquidity_imbalance":{"buy_side_weight":0.6,"sell_side_weight":0.4,"dominant":"buy-side"},"key_void":{"price_from":"str","price_to":"str","y1":0.4,"y2":0.5,"description":"1 sentence"},"analysis":"4 sentences","signal":"bullish|bearish|neutral","confidence":"high|medium|low","next_likely_sweep":"str"}`;

  callAnthropic(apiKey, 'claude-sonnet-4-20250514', p, image, mediaType, 2500, res);
});

/* ══════════════════════════════════════════════
   /journal — Trade Journal AI
   ══════════════════════════════════════════════ */
app.post('/journal', (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l, trade_notes, outcome, pnl } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });

  const p = `Trading coach and fractal analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Trade notes: "${trade_notes||'none'}". Outcome: ${outcome||'unknown'}. P&L: ${pnl||'unknown'}. Grade this trade on fractal principles. Reply in ${lang(l)}. JSON only, no markdown, single-line strings.
{"pair":"str","timeframe":"str","overall_grade":"A|B|C|D|F","grade_score":72,"categories":{"entry_quality":{"score":80,"comment":"1 sentence","improvement":"1 sentence"},"fractal_alignment":{"score":65,"comment":"1 sentence","improvement":"1 sentence"},"risk_management":{"score":70,"comment":"1 sentence","improvement":"1 sentence"},"timing":{"score":60,"comment":"1 sentence","improvement":"1 sentence"},"patience":{"score":75,"comment":"1 sentence","improvement":"1 sentence"}},"what_went_right":["str","str"],"what_went_wrong":["str","str"],"missed_fractal_signals":["str","str"],"coach_message":"3 sentences","key_lesson":"1 sentence","pattern_tendency":"str","next_focus":"str"}`;

  callAnthropic(apiKey, 'claude-opus-4-5', p, image, mediaType, 2000, res);
});

/* ══════════════════════════════════════════════
   /projection — Price Path Projection
   ══════════════════════════════════════════════ */
app.post('/projection', async (req, res) => {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });

  const p = `Fractal price projection analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Locate last candle (right edge), generate 3 forward projection scenarios from fractal structure. Reply in ${lang(l)}. JSON only, no markdown, single-line strings.
{"pair":"str","timeframe":"str","current_price":"str","last_candle_y":0.45,"signal":"bullish|bearish|neutral","confidence":"high|medium|low","fractal_basis":"1 sentence","scenarios":[{"label":"Base Case","probability":0.55,"direction":"bullish|bearish","color":"#27ae60","bars":30,"target_price":"str","target_y":0.3,"path":[30 floats starting at last_candle_y],"key_levels":[{"price":"str","y":0.35,"label":"str"}],"invalidation_price":"str","invalidation_y":0.55},{"label":"Bear Case","probability":0.30,"direction":"bearish","color":"#e74c3c","bars":20,"target_price":"str","target_y":0.65,"path":[20 floats],"key_levels":[{"price":"str","y":0.55,"label":"str"}],"invalidation_price":"str","invalidation_y":0.35},{"label":"Extended","probability":0.15,"direction":"bullish","color":"#9b8fe8","bars":40,"target_price":"str","target_y":0.05,"path":[40 floats],"key_levels":[{"price":"str","y":0.25,"label":"str"}],"invalidation_price":"str","invalidation_y":0.55}],"analysis":"4 sentences","entry_zone":{"price_from":"str","price_to":"str","y1":0.42,"y2":0.48},"stop_loss":{"price":"str","y":0.55},"chart_context":{"visible_bars":120,"trend":"uptrend|downtrend|sideways","last_pattern":"str","wave_position":"str"}}
Rules: path arrays start at last_candle_y, length=bars. y:0=top,1=bottom. Smooth realistic curves.`;

  callAnthropic(apiKey, 'claude-opus-4-5', p, image, mediaType, 3000, res);
});

app.listen(PORT, () => {
  console.log(`=== Fractal AI Agent v2.0 — port ${PORT} ===`);
  console.log('API Key set:', !!process.env.ANTHROPIC_API_KEY);
});
