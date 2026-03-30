require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const https     = require('https');
const WebSocket = require('ws');
const path      = require('path');
const fs        = require('fs');
const crypto    = require('crypto');

/* ═══════════════════════════════════════════════════
   SUPABASE
   ═══════════════════════════════════════════════════ */
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL     = process.env.SUPABASE_URL      || '';
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY || '';
const sbAdmin = SUPABASE_URL && SUPABASE_SERVICE
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

/* ═══════════════════════════════════════════════════
   🆕 PREDICTION TRACKING SYSTEM
   ═══════════════════════════════════════════════════ */
const cron = require('node-cron');
const axios = require('axios');

async function savePrediction(predictionData) {
  if (!sbAdmin) return { success: false, error: 'Database not configured' };
  
  const {
    userId,
    toolName,
    asset,
    timeframe,
    currentPrice,
    predictedPrice,
    targetDays,
    fullResponse
  } = predictionData;

  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() + (targetDays || 3));

  const expectedDirection = predictedPrice > currentPrice ? 'up' : 'down';

  const prediction = {
    user_id: userId,
    tool_name: toolName,
    asset: asset.toUpperCase().replace('/', ''),
    timeframe: timeframe || '1D',
    current_price: currentPrice,
    predicted_price: predictedPrice,
    target_date: targetDate.toISOString(),
    prediction_data: {
      expected_direction: expectedDirection,
      price_change_expected: ((predictedPrice - currentPrice) / currentPrice * 100).toFixed(2),
      full_response: fullResponse
    }
  };

  try {
    const { data, error } = await sbAdmin
      .from('predictions')
      .insert([prediction])
      .select()
      .single();

    if (error) {
      console.error('[Prediction] Save error:', error);
      return { success: false, error: error.message };
    }

    console.log(`[Prediction] Saved: ${toolName} | ${asset} | Target: $${predictedPrice} in ${targetDays} days`);
    return { success: true, predictionId: data.id, targetDate: targetDate };
  } catch (e) {
    console.error('[Prediction] Exception:', e);
    return { success: false, error: e.message };
  }
}

async function checkPredictions() {
  if (!sbAdmin) return;
  
  console.log('🤖 [Prediction Check] Starting...');
  
  const now = new Date().toISOString();
  
  const { data: pendingPredictions, error: fetchError } = await sbAdmin
    .from('predictions')
    .select('*')
    .eq('result', 'pending')
    .lte('target_date', now)
    .limit(100);

  if (fetchError) {
    console.error('[Prediction Check] Fetch error:', fetchError);
    return;
  }

  if (!pendingPredictions || pendingPredictions.length === 0) {
    console.log('✅ [Prediction Check] No predictions to check.');
    return;
  }

  console.log(`📊 [Prediction Check] Checking ${pendingPredictions.length} predictions...`);

  let checked = 0;
  let errors = 0;

  for (const prediction of pendingPredictions) {
    try {
      const response = await axios.get(
        `https://api.binance.com/api/v3/ticker/price?symbol=${prediction.asset}`
      );
      const actualPrice = parseFloat(response.data.price);

      if (!actualPrice) {
        console.error(`❌ [Prediction Check] Could not fetch price for ${prediction.asset}`);
        errors++;
        continue;
      }

      const marginPercent = 5;
      const difference = Math.abs(prediction.predicted_price - actualPrice);
      const percentDiff = (difference / prediction.predicted_price) * 100;
      const isCorrect = percentDiff <= marginPercent;
      
      const predictedDirection = prediction.predicted_price > prediction.current_price ? 'up' : 'down';
      const actualDirection = actualPrice > prediction.current_price ? 'up' : 'down';
      const directionCorrect = predictedDirection === actualDirection;
      
      const accuracyPercentage = Math.max(0, 100 - percentDiff).toFixed(2);

      const { error: updateError } = await sbAdmin
        .from('predictions')
        .update({
          actual_price: actualPrice,
          result: isCorrect ? 'correct' : 'wrong',
          accuracy_percentage: accuracyPercentage,
          price_direction_correct: directionCorrect,
          checked_date: new Date().toISOString()
        })
        .eq('id', prediction.id);

      if (updateError) {
        console.error(`❌ [Prediction Check] Update error ${prediction.id}:`, updateError);
        errors++;
      } else {
        checked++;
        console.log(
          `✅ ${prediction.asset}: Predicted $${prediction.predicted_price}, ` +
          `Actual $${actualPrice} → ${isCorrect ? 'CORRECT' : 'WRONG'} ` +
          `(${accuracyPercentage}% accurate)`
        );
      }

      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (error) {
      console.error(`❌ [Prediction Check] Error processing ${prediction.id}:`, error.message);
      errors++;
    }
  }

  console.log(`\n📈 [Prediction Check] Complete: ${checked} checked, ${errors} errors\n`);
}

/* ═══════════════════════════════════════════════════
   STRIPE
   ═══════════════════════════════════════════════════ */
const Stripe = require('stripe');
const stripe = process.env.STRIPE_SECRET_KEY ? Stripe(process.env.STRIPE_SECRET_KEY) : null;
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const SITE_URL = process.env.SITE_URL || 'https://fractalaiagent.com';

const PLANS = {
  starter:       { name: 'Starter',       credits: 500,   priceId: process.env.STRIPE_PRICE_STARTER       || '' },
  pro:           { name: 'Pro',           credits: 1500,  priceId: process.env.STRIPE_PRICE_PRO           || '' },
  elite:         { name: 'Elite',         credits: 4000,  priceId: process.env.STRIPE_PRICE_ELITE         || '' },
  institutional: { name: 'Institutional', credits: 15000, priceId: process.env.STRIPE_PRICE_INSTITUTIONAL || '' },
};

const FIB_SPIRAL_PRICE_CENTS = 100;

/* ═══════════════════════════════════════════════════
   AUTH HELPERS
   ═══════════════════════════════════════════════════ */
async function verifyAndDeduct(token, cost) {
  if (!sbAdmin) return { userId: 'dev' };
  if (!token)   throw new Error('Not authenticated');

  const { data: { user }, error } = await sbAdmin.auth.getUser(token);
  if (error || !user) throw new Error('Invalid token');

  const { data: profile } = await sbAdmin
    .from('profiles')
    .select('credits, plan')
    .eq('id', user.id)
    .single();

  if (!profile) {
    await sbAdmin.from('profiles').insert({ id: user.id, credits: 50, plan: 'free', username: user.email.split('@')[0] });
    if (50 < cost) throw new Error('Insufficient credits');
  } else if (profile.credits === null || profile.credits === undefined) {
    await sbAdmin.from('profiles').update({ credits: 50 }).eq('id', user.id);
    if (50 < cost) throw new Error('Insufficient credits');
  } else if (profile.credits < cost) {
    throw new Error('Insufficient credits');
  }

  const { error: deductErr } = await sbAdmin.rpc('deduct_credits', { user_id: user.id, amount: cost });
  if (deductErr) {
    const current = profile ? (profile.credits || 50) : 50;
    if (current < cost) throw new Error('Insufficient credits');
    await sbAdmin.from('profiles').update({ credits: current - cost }).eq('id', user.id);
  }
  return { userId: user.id };
}

async function getUserProfile(token) {
  if (!sbAdmin) return { credits: 9999, plan: 'dev', userId: 'dev' };
  if (!token)   return null;
  const { data: { user }, error } = await sbAdmin.auth.getUser(token);
  if (error || !user) return null;
  const { data: profile } = await sbAdmin
    .from('profiles')
    .select('credits, plan, username')
    .eq('id', user.id)
    .single();
  return profile ? { ...profile, userId: user.id, email: user.email } : null;
}

/* ═══════════════════════════════════════════════════
   CANDLE BUILDER
   ═══════════════════════════════════════════════════ */
const TF_MS = { '1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000 };
const TIMEFRAMES = Object.keys(TF_MS);
const candles    = {};
const sseClients = {};

function ensureSymbol(sym) {
  if (!candles[sym]) { candles[sym] = {}; TIMEFRAMES.forEach(tf => { candles[sym][tf] = []; }); }
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
      cur.c = price;
      cur.h = Math.max(cur.h, price);
      cur.l = Math.min(cur.l, price);
      cur.v += (volume || 0);
    }
  });
  pushSSE(sym);
}

function pushSSE(sym) {
  const clients = sseClients[sym];
  if (!clients || clients.size === 0) return;
  const msg = `data: ${JSON.stringify({ symbol: sym, candles: candles[sym] })}\n\n`;
  clients.forEach(res => { try { res.write(msg); } catch(e) { clients.delete(res); } });
}

const binanceWs      = {};
const binancePollers = {};

function connectBinance(symbol) {
  const lower = symbol.toLowerCase();
  if (binanceWs[lower]) return;
  fetchBinanceHistory(symbol.toUpperCase());
  const wsUrls = [
    `wss://stream.binance.com:9443/ws/${lower}@aggTrade`,
    `wss://stream.binance.com:443/ws/${lower}@aggTrade`,
    `wss://stream1.binance.com:9443/ws/${lower}@aggTrade`,
    `wss://stream.binance.us:9443/ws/${lower}@aggTrade`
  ];
  let urlIdx = 0;
  function tryConnect() {
    if (urlIdx >= wsUrls.length) { startBinancePolling(symbol.toUpperCase()); return; }
    const ws = new WebSocket(wsUrls[urlIdx]);
    ws.on('open',    () => console.log(`[Binance] Connected: ${symbol}`));
    ws.on('message', raw => {
      try { const m = JSON.parse(raw); processTick(symbol.toUpperCase(), parseFloat(m.p), parseFloat(m.q), m.T || Date.now()); } catch(e) {}
    });
    ws.on('close', () => { delete binanceWs[lower]; });
    ws.on('error', err => { ws.terminate(); urlIdx++; setTimeout(tryConnect, 1000); });
    binanceWs[lower] = ws;
  }
  tryConnect();
}

function startBinancePolling(symbol) {
  if (binancePollers[symbol]) return;
  binancePollers[symbol] = setInterval(() => {
    const req = https.request({ hostname: 'api.binance.com', path: `/api/v3/ticker/24hr?symbol=${symbol}`, method: 'GET' }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => { try { const d = JSON.parse(data); if (d.lastPrice) processTick(symbol, parseFloat(d.lastPrice), parseFloat(d.lastQty||0), Date.now()); } catch(e) {} });
    });
    req.on('error', () => {}); req.end();
  }, 3000);
}

function stopBinancePolling(symbol) {
  if (binancePollers[symbol]) { clearInterval(binancePollers[symbol]); delete binancePollers[symbol]; }
}

function fetchBinanceHistory(symbol) {
  const tfMap = { '1m':'1m','5m':'5m','15m':'15m','1h':'1h','4h':'4h','1d':'1d' };
  ensureSymbol(symbol);
  TIMEFRAMES.forEach(tf => {
    const binanceTf = tfMap[tf];
    if (!binanceTf) return;
    const path = `/api/v3/klines?symbol=${symbol}&interval=${binanceTf}&limit=500`;
    const req = https.request({ hostname: 'api.binance.com', path, method: 'GET' }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const klines = JSON.parse(data);
          if (Array.isArray(klines)) {
            const arr = candles[symbol][tf];
            arr.length = 0;
            klines.forEach(k => {
              arr.push({
                t: k[0],
                o: parseFloat(k[1]),
                h: parseFloat(k[2]),
                l: parseFloat(k[3]),
                c: parseFloat(k[4]),
                v: parseFloat(k[5])
              });
            });
            console.log(`[Binance] Loaded ${arr.length} ${tf} candles for ${symbol}`);
          }
        } catch(e) {}
      });
    });
    req.on('error', () => {}); req.end();
  });
}

const app = express();
const PORT = process.env.PORT || 8080;

app.use(cors({ origin: true, credentials: true }));
app.use('/stripe-webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ═══════════════════════════════════════════════════
   SERVE HTML PAGES (from public/ folder)
   ═══════════════════════════════════════════════════ */
function sendPage(file, res) {
  const p = path.join(__dirname, 'public', file);
  if (fs.existsSync(p)) res.sendFile(p);
  else res.status(404).send('Page not found: ' + file);
}

app.get('/',        (req, res) => sendPage('index.html',   res));
app.get('/auth',    (req, res) => sendPage('auth.html',    res));
app.get('/terms',   (req, res) => sendPage('terms.html',   res));
app.get('/privacy', (req, res) => sendPage('privacy.html', res));

/* ═══════════════════════════════════════════════════
   API ENDPOINTS
   ═══════════════════════════════════════════════════ */

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// /profile API endpoint (returns user data as JSON)
app.get('/api/profile', async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const prof  = await getUserProfile(token);
  res.json(prof || { credits: 0, plan: 'free', userId: null });
});

// /profile page redirect
app.get('/profile', (req, res) => sendPage('profile.html', res));

// Candles endpoint with query param (?tf=)
app.get('/candles/:symbol', (req, res) => {
  const { symbol } = req.params;
  const tf = req.query.tf || '1h';
  const sym = symbol.toUpperCase();
  connectBinance(sym);
  ensureSymbol(sym);
  const arr = candles[sym][tf] || [];
  res.json(arr);
});

// Subscribe SSE endpoint
app.get('/subscribe/:symbol', (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  connectBinance(sym);
  ensureSymbol(sym);
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients[sym].add(res);
  res.on('close', () => sseClients[sym].delete(res));
  res.write(`data: ${JSON.stringify({ symbol: sym, candles: candles[sym] })}\n\n`);
});

// Current price endpoint
app.get('/price/:symbol', (req, res) => {
  const sym = req.params.symbol.toUpperCase();
  connectBinance(sym);
  ensureSymbol(sym);
  const tf = '1m';
  const arr = candles[sym][tf] || [];
  const lastCandle = arr[arr.length - 1];
  res.json({ price: lastCandle ? lastCandle.c : 0 });
});

/* ═══════════════════════════════════════════════════
   ANTHROPIC API HELPER
   ═══════════════════════════════════════════════════ */

function callAnthropic(apiKey, model, prompt, image, mediaType, maxTok, res) {
  const messages = image
    ? [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: image } }, { type: 'text', text: prompt }] }]
    : [{ role: 'user', content: prompt }];

  const reqBody = JSON.stringify({ model, max_tokens: maxTok, messages });
  const options = {
    hostname: 'api.anthropic.com',
    path:     '/v1/messages',
    method:   'POST',
    headers:  { 'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(reqBody) }
  };

  const apiReq = https.request(options, apiRes => {
    let data = '';
    apiRes.on('data', c => { data += c; });
    apiRes.on('end', () => {
      try {
        const obj = JSON.parse(data);
        if (obj.error) return res.status(500).json({ error: obj.error.message });
        const text = obj.content && obj.content[0] && obj.content[0].text ? obj.content[0].text : '';
        res.json({ text });
      } catch(e) {
        res.status(500).json({ error: 'Failed to parse response' });
      }
    });
  });
  apiReq.on('error', e => res.status(500).json({ error: e.message }));
  apiReq.write(reqBody);
  apiReq.end();
}

const rl = l => l==='ar' ? 'Arabic' : l==='pt' ? 'Portuguese' : 'English';

/* ═══════════════════════════════════════════════════
   AI TOOL ENDPOINTS
   ═══════════════════════════════════════════════════ */

// /analyze - General analysis tool
app.post('/analyze', async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l, _token } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  try { await verifyAndDeduct(_token, 12); } catch(e) { return res.status(402).json({ error: e.message }); }
  const p = `Bar pattern analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Reply in ${rl(l)}. JSON only.\n{"pair":"str","timeframe":"str","pattern":"str","structure":"bullish|bearish|neutral","confidence":"high|medium|low","last_bar":{"type":"bullish|bearish|doji|etc","close_position":"high|mid|low"},"projection":"continue|reverse|range","entry":"str","stop":"str","target":"str","rationale":"3 sentences"}`;
  callAnthropic(k, 'claude-sonnet-4-5', p, image, mediaType, 1500, res);
});

// /bar-pattern
app.post('/bar-pattern', async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l, _token } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  try { await verifyAndDeduct(_token, 12); } catch(e) { return res.status(402).json({ error: e.message }); }
  const p = `Bar pattern analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Reply in ${rl(l)}. JSON only.\n{"pair":"str","timeframe":"str","pattern":"str","structure":"bullish|bearish|neutral","confidence":"high|medium|low","last_bar":{"type":"bullish|bearish|doji|etc","close_position":"high|mid|low"},"projection":"continue|reverse|range","entry":"str","stop":"str","target":"str","rationale":"3 sentences"}`;
  callAnthropic(k, 'claude-sonnet-4-5', p, image, mediaType, 1500, res);
});

// /weierstrass - Deprecated
app.post('/weierstrass', (req, res) => {
  res.status(410).json({ 
    error: 'This tool has been deprecated.',
    text: '{"error": "Weierstrass tool has been deprecated. Please use updated tools."}'
  });
});

// /mtf (MTF Confluence)
app.post('/mtf', async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l, _token } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  try { await verifyAndDeduct(_token, 20); } catch(e) { return res.status(402).json({ error: e.message }); }
  const p = `MTF confluence analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Reply in ${rl(l)}. JSON only.\n{"pair":"str","timeframe":"str","macro_tf":"D or W","mid_tf":"H or 4H","micro_tf":"m or H","macro":{"trend":"bullish|bearish|neutral","key_level":"price str","pattern":"str","confidence":"high|medium|low"},"mid":{"trend":"bullish|bearish|neutral","key_level":"price str","pattern":"str","confluence":"confirmed|weak|divergent"},"micro":{"structure":"impulse|correction|consolidation","entry_signal":"bool","risk_reward":"str"},"verdict":"bullish|bearish|neutral","strength":0-100,"entry_zone":{"from":"str","to":"str"},"stop_loss":"str","targets":["str","str"],"rationale":"3 sentences"}`;
  callAnthropic(k, 'claude-opus-4-5', p, image, mediaType, 2000, res);
});

// /fractal-age
app.post('/fractal-age', async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l, _token } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  try { await verifyAndDeduct(_token, 15); } catch(e) { return res.status(402).json({ error: e.message }); }
  const p = `Fractal age analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. Reply in ${rl(l)}. JSON only.\n{"pair":"str","timeframe":"str","current_fractal":{"age":"young|mid|mature|exhausted","bars_since_origin":0,"strength":0-100,"self_similarity":"high|medium|low"},"macro_cycle":{"position":"early|mid|late","bars_total":0,"expected_remaining":0},"mid_cycle":{"position":"early|mid|late","bars_total":0},"verdict":"extend|reverse|consolidate","reasoning":"3 sentences","zones":[{"type":"support|resistance","price":"str","strength":"high|medium|low"}]}`;
  callAnthropic(k, 'claude-opus-4-5', p, image, mediaType, 2000, res);
});

// /projection - WITH PREDICTION TRACKING
app.post('/projection', async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { image, mediaType, pair, timeframe, language: l, _token } = req.body;
  if (!image || !mediaType) return res.status(400).json({ error: 'Missing image or mediaType.' });
  
  let userId = null;
  try {
    const verifyResult = await verifyAndDeduct(_token, 25);
    userId = verifyResult.userId;
  } catch(e) {
    return res.status(402).json({ error: e.message });
  }
  
  const p = `Price projection analyst. Chart: ${pair||'asset'} ${timeframe||'auto'}. 3 forward scenarios. Reply in ${rl(l)}. JSON only.\n{"pair":"str","timeframe":"str","current_price":"str","last_candle_y":0.45,"signal":"bullish|bearish|neutral","confidence":"high|medium|low","fractal_basis":"1 sentence","scenarios":[{"label":"Base Case","probability":0.55,"direction":"bullish|bearish","color":"#27ae60","bars":30,"target_price":"str","target_y":0.3,"path":[30 floats],"invalidation_price":"str","invalidation_y":0.55},{"label":"Bear Case","probability":0.30,"direction":"bearish","color":"#e74c3c","bars":20,"target_price":"str","target_y":0.65,"path":[20 floats],"invalidation_price":"str","invalidation_y":0.35},{"label":"Extended","probability":0.15,"direction":"bullish","color":"#9b8fe8","bars":40,"target_price":"str","target_y":0.05,"path":[40 floats],"invalidation_price":"str","invalidation_y":0.55}],"analysis":"4 sentences","entry_zone":{"price_from":"str","price_to":"str","y1":0.42,"y2":0.48},"stop_loss":{"price":"str","y":0.55},"chart_context":{"trend":"uptrend|downtrend|sideways","last_pattern":"str","wave_position":"str"}}`;
  
  const messages = [{ role: 'user', content: [{ type: 'image', source: { type: 'base64', media_type: mediaType, data: image } }, { type: 'text', text: p }] }];
  const reqBody = JSON.stringify({ model: 'claude-opus-4-5', max_tokens: 3000, messages });
  const options = {
    hostname: 'api.anthropic.com',
    path: '/v1/messages',
    method: 'POST',
    headers: { 'Content-Type':'application/json','x-api-key':k,'anthropic-version':'2023-06-01','Content-Length':Buffer.byteLength(reqBody) }
  };

  const apiReq = https.request(options, apiRes => {
    let data = '';
    apiRes.on('data', c => { data += c; });
    apiRes.on('end', async () => {
      try {
        const obj = JSON.parse(data);
        if (obj.error) return res.status(500).json({ error: obj.error.message });
        const text = obj.content && obj.content[0] && obj.content[0].text ? obj.content[0].text : '';
        
        // Save prediction for tracking
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch && userId) {
            const parsed = JSON.parse(jsonMatch[0]);
            
            if (parsed.current_price && parsed.scenarios && parsed.scenarios[0]) {
              const currentPrice = parseFloat(parsed.current_price.replace(/[^0-9.]/g, ''));
              const targetPrice = parseFloat(parsed.scenarios[0].target_price.replace(/[^0-9.]/g, ''));
              const bars = parseInt(parsed.scenarios[0].bars) || 30;
              
              let targetDays = 3;
              if (timeframe && timeframe.includes('h')) {
                const hours = parseInt(timeframe);
                targetDays = Math.ceil((bars * hours) / 24);
              } else if (timeframe && timeframe.includes('d')) {
                targetDays = bars;
              } else if (timeframe && timeframe.includes('m')) {
                targetDays = Math.ceil(bars / (24 * 60));
              }
              
              if (currentPrice && targetPrice && !isNaN(currentPrice) && !isNaN(targetPrice)) {
                await savePrediction({
                  userId: userId,
                  toolName: 'Price Path Projection',
                  asset: pair || 'UNKNOWN',
                  timeframe: timeframe || '1D',
                  currentPrice: currentPrice,
                  predictedPrice: targetPrice,
                  targetDays: Math.max(1, Math.min(targetDays, 30)),
                  fullResponse: text
                });
              }
            }
          }
        } catch (predErr) {
          console.error('[Prediction] Save error (non-fatal):', predErr.message);
        }
        
        res.json({ text });
      } catch(e) {
        res.status(500).json({ error: 'Failed to parse response' });
      }
    });
  });
  apiReq.on('error', e => res.status(500).json({ error: e.message }));
  apiReq.write(reqBody);
  apiReq.end();
});

/* ═══════════════════════════════════════════════════
   🆕 PREDICTION TRACKING API ROUTES
   ═══════════════════════════════════════════════════ */

app.get('/api/predictions/stats', async (req, res) => {
  if (!sbAdmin) return res.status(500).json({ error: 'Database not configured' });
  
  try {
    const { data: allPredictions, error } = await sbAdmin
      .from('predictions')
      .select('tool_name, asset, result, accuracy_percentage, price_direction_correct');

    if (error) throw error;

    const verified = allPredictions.filter(p => p.result !== 'pending');
    const correct = verified.filter(p => p.result === 'correct').length;
    const wrong = verified.filter(p => p.result === 'wrong').length;
    const pending = allPredictions.filter(p => p.result === 'pending').length;

    const overall = {
      total: allPredictions.length,
      correct: correct,
      wrong: wrong,
      pending: pending,
      accuracy: verified.length > 0 ? ((correct / verified.length) * 100).toFixed(2) : '0.00'
    };

    const byTool = {};
    allPredictions.forEach(p => {
      const key = `${p.tool_name}|${p.asset}`;
      if (!byTool[key]) {
        byTool[key] = {
          tool_name: p.tool_name,
          asset: p.asset,
          total_predictions: 0,
          correct_count: 0,
          wrong_count: 0,
          pending_count: 0
        };
      }
      byTool[key].total_predictions++;
      if (p.result === 'correct') byTool[key].correct_count++;
      if (p.result === 'wrong') byTool[key].wrong_count++;
      if (p.result === 'pending') byTool[key].pending_count++;
    });

    const byToolArray = Object.values(byTool).map(stat => {
      const verified = stat.correct_count + stat.wrong_count;
      return {
        ...stat,
        accuracy_percentage: verified > 0 ? ((stat.correct_count / verified) * 100).toFixed(2) : '0.00'
      };
    });

    res.json({
      success: true,
      overall,
      byTool: byToolArray
    });

  } catch (error) {
    console.error('[Prediction Stats] Error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/predictions/check-now', async (req, res) => {
  try {
    await checkPredictions();
    res.json({ success: true, message: 'Prediction check completed' });
  } catch (error) {
    console.error('[Manual Check] Error:', error);
    res.status(500).json({ error: 'Check failed' });
  }
});

app.get('/admin/stats', async (req, res) => {
  if (!sbAdmin) return res.status(500).send('Database not configured');
  
  try {
    const { data: predictions } = await sbAdmin
      .from('predictions')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    const { data: stats } = await sbAdmin
      .from('predictions')
      .select('result');

    const verified = stats.filter(p => p.result !== 'pending');
    const correct = verified.filter(p => p.result === 'correct').length;
    const wrong = verified.filter(p => p.result === 'wrong').length;
    const pending = stats.filter(p => p.result === 'pending').length;
    const accuracy = verified.length > 0 ? ((correct / verified.length) * 100).toFixed(2) : 0;

    const html = `
<!DOCTYPE html>
<html>
<head>
  <title>🔒 Admin - Prediction Stats</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { 
      font-family: 'Courier New', monospace; 
      background: #0a0c14; 
      color: #f0f4fa; 
      padding: 20px;
    }
    .container { max-width: 1200px; margin: 0 auto; }
    h1 { 
      color: #c9a84c; 
      margin-bottom: 10px; 
      font-size: 24px;
      border-bottom: 2px solid #c9a84c;
      padding-bottom: 10px;
    }
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 15px;
      margin: 20px 0;
    }
    .stat-card {
      background: rgba(201, 168, 76, 0.1);
      border: 1px solid rgba(201, 168, 76, 0.3);
      border-radius: 8px;
      padding: 15px;
      text-align: center;
    }
    .stat-value {
      font-size: 32px;
      font-weight: bold;
      color: #c9a84c;
      margin-bottom: 5px;
    }
    .stat-label {
      font-size: 11px;
      color: rgba(240, 244, 250, 0.6);
      text-transform: uppercase;
      letter-spacing: 1px;
    }
    .green { color: #4ade80 !important; }
    .red { color: #f87171 !important; }
    .orange { color: #fb923c !important; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 20px;
      font-size: 12px;
    }
    th {
      background: rgba(201, 168, 76, 0.2);
      padding: 12px 8px;
      text-align: left;
      font-weight: 600;
      border-bottom: 2px solid #c9a84c;
    }
    td {
      padding: 10px 8px;
      border-bottom: 1px solid rgba(201, 168, 76, 0.1);
    }
    tr:hover {
      background: rgba(201, 168, 76, 0.05);
    }
    .badge {
      display: inline-block;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 10px;
      font-weight: bold;
      text-transform: uppercase;
    }
    .badge-correct { background: #4ade80; color: #0a0c14; }
    .badge-wrong { background: #f87171; color: #0a0c14; }
    .badge-pending { background: #fb923c; color: #0a0c14; }
    .refresh-btn {
      background: #c9a84c;
      color: #0a0c14;
      border: none;
      padding: 10px 20px;
      border-radius: 6px;
      cursor: pointer;
      font-weight: bold;
      margin: 10px 5px 10px 0;
    }
    .refresh-btn:hover { background: #d4b560; }
  </style>
</head>
<body>
  <div class="container">
    <h1>🔒 Admin Dashboard - Prediction Tracking</h1>
    <p style="color: rgba(240,244,250,0.6); margin-bottom: 20px; font-size: 12px;">
      Private view - Only visible to you • Data updates automatically
    </p>

    <div class="stats-grid">
      <div class="stat-card">
        <div class="stat-value">${accuracy}%</div>
        <div class="stat-label">Overall Accuracy</div>
      </div>
      <div class="stat-card">
        <div class="stat-value">${stats.length}</div>
        <div class="stat-label">Total Predictions</div>
      </div>
      <div class="stat-card">
        <div class="stat-value green">${correct}</div>
        <div class="stat-label">Correct</div>
      </div>
      <div class="stat-card">
        <div class="stat-value red">${wrong}</div>
        <div class="stat-label">Wrong</div>
      </div>
      <div class="stat-card">
        <div class="stat-value orange">${pending}</div>
        <div class="stat-label">Pending</div>
      </div>
    </div>

    <button class="refresh-btn" onclick="location.reload()">🔄 Refresh Data</button>
    <button class="refresh-btn" onclick="checkNow()">⚡ Check Predictions Now</button>

    <h2 style="color: #c9a84c; margin: 30px 0 15px; font-size: 18px;">Recent Predictions (Last 100)</h2>
    
    <table>
      <thead>
        <tr>
          <th>Tool</th>
          <th>Asset</th>
          <th>Current</th>
          <th>Predicted</th>
          <th>Actual</th>
          <th>Target Date</th>
          <th>Result</th>
          <th>Accuracy</th>
        </tr>
      </thead>
      <tbody>
        ${predictions.map(p => `
          <tr>
            <td>${p.tool_name}</td>
            <td><strong>${p.asset}</strong></td>
            <td>$${parseFloat(p.current_price).toLocaleString()}</td>
            <td>$${parseFloat(p.predicted_price).toLocaleString()}</td>
            <td>${p.actual_price ? '$' + parseFloat(p.actual_price).toLocaleString() : '—'}</td>
            <td>${new Date(p.target_date).toLocaleDateString()}</td>
            <td>
              <span class="badge badge-${p.result}">
                ${p.result === 'correct' ? '✓ CORRECT' : p.result === 'wrong' ? '✗ WRONG' : '⏳ PENDING'}
              </span>
            </td>
            <td>${p.accuracy_percentage ? p.accuracy_percentage + '%' : '—'}</td>
          </tr>
        `).join('')}
      </tbody>
    </table>

    <p style="margin-top: 30px; color: rgba(240,244,250,0.4); font-size: 11px; text-align: center;">
      💡 Don't publish stats publicly until accuracy is consistently above 70%
    </p>
  </div>

  <script>
    async function checkNow() {
      if (!confirm('Run prediction check now?')) return;
      
      const btn = event.target;
      btn.disabled = true;
      btn.textContent = '⏳ Checking...';
      
      try {
        const res = await fetch('/api/predictions/check-now', { method: 'POST' });
        const data = await res.json();
        
        if (data.success) {
          alert('✅ Check completed! Refreshing...');
          location.reload();
        } else {
          alert('❌ Failed: ' + (data.error || 'Unknown error'));
          btn.disabled = false;
          btn.textContent = '⚡ Check Predictions Now';
        }
      } catch (e) {
        alert('❌ Error: ' + e.message);
        btn.disabled = false;
        btn.textContent = '⚡ Check Predictions Now';
      }
    }
  </script>
</body>
</html>
    `;

    res.send(html);
  } catch (error) {
    console.error('[Admin Stats] Error:', error);
    res.status(500).send('Error loading stats');
  }
});

/* ═══════════════════════════════════════════════════
   STRIPE ENDPOINTS
   ═══════════════════════════════════════════════════ */

app.post('/create-checkout', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  const { plan, token } = req.body;
  if (!plan || !PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
  if (!token) return res.status(401).json({ error: 'Please sign in first to subscribe' });
  let userId = 'guest', userEmail = undefined;
  try {
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64').toString());
    userId = payload.sub || 'guest';
    userEmail = payload.email;
  } catch(e) { return res.status(401).json({ error: 'Invalid token' }); }
  const priceId = PLANS[plan].priceId;
  if (!priceId) return res.status(500).json({ error: `Stripe price not configured for ${plan}` });
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { userId, plan },
      customer_email: userEmail,
      success_url: `${SITE_URL}/?checkout=success&plan=${plan}`,
      cancel_url:  `${SITE_URL}/?checkout=cancelled`,
    });
    res.json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/manage-billing', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  const { token } = req.body;
  const profile = await getUserProfile(token);
  if (!profile) return res.status(401).json({ error: 'Not authenticated' });
  if (!sbAdmin) return res.status(500).json({ error: 'Database not configured' });
  const { data: sub } = await sbAdmin.from('subscriptions').select('stripe_customer_id').eq('user_id', profile.userId).single();
  if (!sub || !sub.stripe_customer_id) return res.status(404).json({ error: 'No active subscription found' });
  try {
    const portal = await stripe.billingPortal.sessions.create({ customer: sub.stripe_customer_id, return_url: `${SITE_URL}/profile` });
    res.json({ url: portal.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/fib-spiral-checkout', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  const { token } = req.body;
  const profile = await getUserProfile(token);
  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: FIB_SPIRAL_PRICE_CENTS,
          product_data: { name: 'Fibonacci Spiral — Session Unlock', description: 'Unlimited Fibonacci Spiral draws for this browser session' },
        },
        quantity: 1,
      }],
      metadata: { userId: profile ? profile.userId : 'guest', type: 'fib_spiral' },
      customer_email: profile ? profile.email : undefined,
      success_url: `${SITE_URL}/?fib_paid={CHECKOUT_SESSION_ID}`,
      cancel_url:  `${SITE_URL}/`,
    });
    res.json({ url: session.url });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/fib-spiral-verify', async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: 'Missing sessionId' });
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== 'paid') return res.status(402).json({ error: 'Payment not completed' });
    if (session.metadata.type !== 'fib_spiral') return res.status(400).json({ error: 'Wrong payment type' });
    const grantToken = crypto.randomBytes(32).toString('hex');
    const expiresAt  = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    if (sbAdmin) {
      await sbAdmin.from('fib_spiral_grants').upsert({ session_id: sessionId, grant_token: grantToken, expires_at: expiresAt, used: false });
    }
    res.json({ ok: true, grantToken, expiresAt });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

app.post('/stripe-webhook', async (req, res) => {
  if (!stripe) return res.status(500).send('Stripe not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (e) {
    console.error('[Stripe webhook] Signature error:', e.message);
    return res.status(400).send(`Webhook Error: ${e.message}`);
  }

  const data = event.data.object;

  if (event.type === 'checkout.session.completed' && data.mode === 'subscription') {
    const userId  = data.metadata.userId;
    const plan    = data.metadata.plan;
    const credits = PLANS[plan] ? PLANS[plan].credits : 0;
    const custId  = data.customer;
    if (sbAdmin && userId && credits) {
      await sbAdmin.from('profiles').update({ credits, plan }).eq('id', userId);
      await sbAdmin.from('subscriptions').upsert({ user_id: userId, plan, stripe_customer_id: custId, stripe_sub_id: data.subscription, status: 'active', updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      console.log(`[Stripe] Plan activated: ${plan} → user ${userId} → ${credits} cr`);
    }
  }

  if (event.type === 'invoice.paid') {
    const subId = data.subscription;
    if (!subId || !sbAdmin) return res.json({ received: true });
    const { data: sub } = await sbAdmin.from('subscriptions').select('user_id, plan').eq('stripe_sub_id', subId).single();
    if (sub && PLANS[sub.plan]) {
      const credits = PLANS[sub.plan].credits;
      await sbAdmin.from('profiles').update({ credits }).eq('id', sub.user_id);
      console.log(`[Stripe] Renewal: ${sub.plan} → user ${sub.user_id} → ${credits} cr reset`);
    }
  }

  if (event.type === 'customer.subscription.deleted') {
    if (!sbAdmin) return res.json({ received: true });
    const { data: sub } = await sbAdmin.from('subscriptions').select('user_id').eq('stripe_sub_id', data.id).single();
    if (sub) {
      await sbAdmin.from('profiles').update({ plan: 'free', credits: 0 }).eq('id', sub.user_id);
      await sbAdmin.from('subscriptions').update({ status: 'cancelled' }).eq('stripe_sub_id', data.id);
      console.log(`[Stripe] Cancelled: sub ${data.id}`);
    }
  }

  res.json({ received: true });
});

/* ═══════════════════════════════════════════════════
   START SERVER + CRON JOB
   ═══════════════════════════════════════════════════ */
app.listen(PORT, () => {
  console.log(`\n=== Fractal AI Agent v3.2 — port ${PORT} ===`);
  console.log('Anthropic key:', !!process.env.ANTHROPIC_API_KEY);
  console.log('Stripe:',        !!stripe);
  console.log('Supabase:',      !!sbAdmin);
  
  cron.schedule('0 2 * * *', () => {
    console.log('\n⏰ [Scheduled] Running daily prediction check...');
    checkPredictions();
  });
  console.log('✅ Prediction tracking: Daily check scheduled (2:00 AM)');
});
