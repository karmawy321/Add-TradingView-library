require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const { Resend } = require('resend');
const resend    = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
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
   EMAIL
   ═══════════════════════════════════════════════════ */
async function sendWelcomeEmail(email, username) {
  if (!resend) return;
  try {
    await resend.emails.send({
      from: 'Fractal AI Agent <hello@fractalaiagent.com>',
      to: email,
      subject: 'Welcome to Fractal AI Agent',
      html: `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#0a0c12;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0a0c12;padding:40px 20px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#0d1018;border:1px solid rgba(201,168,76,0.2);border-radius:16px;overflow:hidden;max-width:560px;">
        <tr>
          <td align="center" style="padding:40px 40px 24px;border-bottom:1px solid rgba(201,168,76,0.1);">
            <img src="https://fractalaiagent.com/logo.svg" width="64" height="64" alt="Fractal AI Agent" style="display:block;margin:0 auto 16px;">
            <p style="margin:0;color:rgba(201,168,76,0.7);font-size:11px;letter-spacing:3px;text-transform:uppercase;">Fractal AI Agent</p>
          </td>
        </tr>
        <tr>
          <td style="padding:40px;">
            <h1 style="margin:0 0 8px;color:#f0d878;font-size:22px;font-weight:600;">Welcome, ${escapeHtml(username)}</h1>
            <p style="margin:0 0 24px;color:rgba(255,255,255,0.6);font-size:14px;line-height:1.7;">Your account is ready. You have <strong style="color:#c9a84c;">50 free credits</strong> to explore the platform — use them to run AI analysis on any asset.</p>
            <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;width:100%;">
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.08);">
                <span style="color:#c9a84c;margin-right:10px;">▸</span>
                <span style="color:rgba(255,255,255,0.6);font-size:14px;">Fractal &amp; SMC analysis</span>
              </td></tr>
              <tr><td style="padding:8px 0;border-bottom:1px solid rgba(201,168,76,0.08);">
                <span style="color:#c9a84c;margin-right:10px;">▸</span>
                <span style="color:rgba(255,255,255,0.6);font-size:14px;">AI price projections &amp; volatility maps</span>
              </td></tr>
              <tr><td style="padding:8px 0;">
                <span style="color:#c9a84c;margin-right:10px;">▸</span>
                <span style="color:rgba(255,255,255,0.6);font-size:14px;">Liquidity heatmaps &amp; quant overlays</span>
              </td></tr>
            </table>
            <a href="https://fractalaiagent.com" style="display:inline-block;background:linear-gradient(135deg,#9a7a2e,#c9a84c);color:#0a0c12;text-decoration:none;font-weight:700;font-size:14px;padding:14px 32px;border-radius:8px;letter-spacing:0.5px;">Open the Chart →</a>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 40px;border-top:1px solid rgba(201,168,76,0.1);">
            <p style="margin:0;color:rgba(255,255,255,0.25);font-size:12px;line-height:1.6;">You're receiving this because you created an account at fractalaiagent.com<br>© 2026 Fractal AI Agent</p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
    });
  } catch(e) {
    console.error('[Email] Welcome email failed:', e.message);
  }
}

/* ═══════════════════════════════════════════════════
   ADMIN AUTH
   ═══════════════════════════════════════════════════ */
const ADMIN_SECRET = process.env.ADMIN_SECRET || null;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function requireAdmin(req, res, next) {
  if (!ADMIN_SECRET) {
    return res.status(503).send('Admin access not configured. Set ADMIN_SECRET env var.');
  }
  const key = req.headers['x-admin-key'] || req.query.key;
  const keyBuf = Buffer.from(key || '');
  const secBuf = Buffer.from(ADMIN_SECRET);
  const valid = keyBuf.length === secBuf.length && crypto.timingSafeEqual(keyBuf, secBuf);
  if (!valid) {
    const wantsJson = req.headers.accept?.includes('application/json') || req.path.startsWith('/api/');
    return wantsJson
      ? res.status(401).json({ error: 'Unauthorized' })
      : res.status(401).send('401 Unauthorized — provide X-Admin-Key header');
  }
  next();
}

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

/* ── Helper: extract signal + save prediction for any tool ── */
async function trySavePrediction(toolName, text, pair, timeframe, userId) {
  if (!sbAdmin || !userId) return;
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return;
    const r = JSON.parse(jsonMatch[0]);

    // Get current price from Binance
    const sym = (pair||'BTCUSDT').toUpperCase().replace('/','');
    let currentPrice = 0;
    try {
      const tdSym = toTDSymbol(sym);
      const pr = await new Promise((resolve, reject) => {
        const path = `/price?symbol=${encodeURIComponent(tdSym)}&apikey=${TD_KEY}`;
        const req = https.request({ hostname:'api.twelvedata.com', path, method:'GET' }, res => {
          let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d));}catch(e){resolve({});} });
        });
        req.on('error', reject); req.end();
      });
      currentPrice = parseFloat(pr.price) || 0;
    } catch(e) {}
    if (!currentPrice) return;

    // Derive predicted price from signal + key levels
    const signal = (r.signal || r.verdict || r.smart_money_direction || '').toLowerCase();
    if (!signal || signal === 'neutral') return;

    // Use the first target price found in the response
    const targetStr = r.target_1 || r.target_price || r.targets?.[0] ||
                      r.entry_model?.tp1 || r.hunt_targets?.[0]?.price ||
                      r.entry_zone?.price_from || r.scenarios?.[0]?.target_price || '';
    const predictedPrice = parseFloat(String(targetStr).replace(/[^0-9.]/g,'')) || 0;
    if (!predictedPrice || predictedPrice === currentPrice) return;

    // Estimate target days from timeframe
    const tf = (timeframe||'').toLowerCase();
    let targetDays = 3;
    if (tf.includes('1d') || tf === '1d') targetDays = 5;
    else if (tf.includes('4h')) targetDays = 3;
    else if (tf.includes('1h')) targetDays = 2;
    else if (tf.includes('1w') || tf === '1w') targetDays = 14;

    await savePrediction({ userId, toolName, asset: sym, timeframe: timeframe||'1D',
      currentPrice, predictedPrice, targetDays, fullResponse: text });
  } catch(e) {
    console.error('[trySavePrediction]', e.message);
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
      const tdSym2 = toTDSymbol(prediction.asset);
      const response = await axios.get(
        `https://api.twelvedata.com/price?symbol=${encodeURIComponent(tdSym2)}&apikey=${TD_KEY}`
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
  if (!sbAdmin) throw new Error('Database not configured');
  if (!token)   throw new Error('Not authenticated');

  const { data: { user }, error } = await sbAdmin.auth.getUser(token);
  if (error || !user) throw new Error('Invalid token');

  let { data: profile } = await sbAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();

  if (!profile) {
    const username = user.email.split('@')[0];
    const { error: insErr } = await sbAdmin.from('profiles')
      .upsert({ id: user.id, credits: 50, plan: 'free', username }, { onConflict: 'id', ignoreDuplicates: true });
    if (insErr) throw new Error(`Database Insert Error: ${insErr.message}`);
    // Re-fetch in case another request created it first
    const { data: existing } = await sbAdmin.from('profiles').select('*').eq('id', user.id).single();
    if (existing) { profile = existing; }
    else {
      sendWelcomeEmail(user.email, username);
      profile = { credits: 50, plan: 'free' };
    }
    if ((profile.credits ?? 50) < cost) throw new Error('Insufficient credits');
  } else if (profile.credits === null || profile.credits === undefined) {
    await sbAdmin.from('profiles').update({ credits: 50 }).eq('id', user.id);
    profile.credits = 50;
    if (50 < cost) throw new Error('Insufficient credits');
  } else if (profile.credits < cost) {
    throw new Error('Insufficient credits');
  }

  const current = profile.credits;

  // Try RPC first
  const { error: deductErr } = await sbAdmin.rpc('deduct_credits', { user_id: user.id, amount: cost });
  let rpcWorked = false;
  
  if (!deductErr) {
    const { data: check } = await sbAdmin.from('profiles').select('credits').eq('id', user.id).single();
    if (check && check.credits < current) { // it decreased
       rpcWorked = true;
    }
  }

  if (!rpcWorked) {
    // Fallback if RPC failed or didn't decrease credits
    const { error: upErr } = await sbAdmin.from('profiles').update({ credits: current - cost }).eq('id', user.id);
    if (upErr) throw new Error(`Database Update Error: ${upErr.message}`);
  }
  
  return { userId: user.id };
}

async function getUserProfile(token) {
  if (!sbAdmin) return null;
  if (!token)   return null;
  const { data: { user }, error } = await sbAdmin.auth.getUser(token);
  if (error || !user) return null;
  
  let { data: profile } = await sbAdmin
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .single();
    
  if (!profile) {
    const username = user.email.split('@')[0];
    const { error: insErr } = await sbAdmin.from('profiles')
      .upsert({ id: user.id, credits: 50, plan: 'free', username }, { onConflict: 'id', ignoreDuplicates: true });
    if (insErr) {
      console.error('Profile upsert error:', insErr);
      return { credits: 50, plan: 'free', username, userId: user.id, email: user.email };
    }
    // Re-fetch to get actual row (another request may have just created it)
    const { data: created } = await sbAdmin.from('profiles').select('*').eq('id', user.id).single();
    if (created) {
      return { credits: created.credits ?? 50, plan: created.plan || 'free', username: created.username || username, userId: user.id, email: user.email };
    }
    sendWelcomeEmail(user.email, username);
    return { credits: 50, plan: 'free', username, userId: user.id, email: user.email };
  }
  
  return { ...profile, userId: user.id, email: user.email };
}

/* ═══════════════════════════════════════════════════
   CANDLE BUILDER
   ═══════════════════════════════════════════════════ */
const TF_MS = { '1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000 };
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

/* Throttle SSE: coalesce all ticks within 1 second into one push.
   Prevents 100+/sec Binance aggTrades from flooding connected clients. */
const _ssePending = {};
function pushSSE(sym) {
  const clients = sseClients[sym];
  if (!clients || clients.size === 0) return;
  if (_ssePending[sym]) return;
  _ssePending[sym] = setTimeout(() => {
    delete _ssePending[sym];
    const cs = sseClients[sym];
    if (!cs || cs.size === 0) return;
    
    const tick = {};
    TIMEFRAMES.forEach(tf => { const a = candles[sym][tf]; if (a && a.length) tick[tf] = a[a.length - 1]; });
    const msgDef = `data: ${JSON.stringify({ symbol: sym, tick })}\n\n`;
    
    const _oKey = sym.replace('/', '');
    let msgOanda = msgDef;
    if (oandaCandles[_oKey]) {
      const oTick = {};
      TIMEFRAMES.forEach(tf => { const a = oandaCandles[_oKey][tf]; if (a && a.length) oTick[tf] = a[a.length - 1]; });
      msgOanda = `data: ${JSON.stringify({ symbol: sym, tick: oTick })}\n\n`;
    }

    cs.forEach(res => { 
      try { 
        if (res.reqSource === 'oanda') res.write(msgOanda);
        else res.write(msgDef);
      } catch(e) { cs.delete(res); } 
    });
  }, 250);
}

/* ═══════════════════════════════════════════════════
   TWELVEDATA DATA SOURCE
   ═══════════════════════════════════════════════════ */
const TD_KEY  = process.env.TWELVEDATA_API_KEY || '';
const tdLoaded = {};

/* Convert internal symbol (BTCUSDT, EURUSD, XAUUSD) → TwelveData format (BTC/USD, EUR/USD, XAU/USD) */
/* Known stock tickers — TwelveData needs plain ticker (no slash) */
const _STOCK_TICKERS = new Set([
  'AAPL','MSFT','GOOGL','GOOG','AMZN','META','NVDA','TSLA','NFLX','AMD',
  'INTC','BABA','DIS','JPM','GS','BAC','V','MA','PYPL','UBER','LYFT',
  'COIN','HOOD','PLTR','RIVN','NIO','LCID','GME','AMC','SPY','QQQ','GLD','SLV'
]);

function toTDSymbol(sym) {
  const s = sym.toUpperCase();
  // Already has slash — pass through
  if (s.includes('/')) return s;
  // Known stock tickers — use as-is (TwelveData accepts plain US tickers)
  if (_STOCK_TICKERS.has(s)) return s;
  // Crypto: ends with USDT or USDC
  if (s.endsWith('USDT')) return s.replace('USDT', '/USD');
  if (s.endsWith('USDC')) return s.replace('USDC', '/USD');
  if (s.endsWith('BTC'))  return s.replace('BTC',  '/BTC');
  // Metals / forex: exactly 6 chars like XAUUSD, XAGUSD, XPTUSD, EURUSD, GBPJPY
  if (s.length === 6) return s.slice(0, 3) + '/' + s.slice(3);
  // Short tickers (1-5 chars) that aren't in known list — assume stock
  return s;
}

/* Convert TwelveData interval names */
const TD_TF = { '1m':'1min','5m':'5min','15m':'15min','30m':'30min','1h':'1h','4h':'4h','1d':'1day','1w':'1week' };

/* Parse TwelveData datetime string → Unix ms
   Handles both "2026-04-07 14:30:00" (intraday) and "2026-04-07" (daily/weekly) */
function tdTs(dt) {
  if (!dt) return 0;
  const s = dt.includes(' ') ? dt.replace(' ', 'T') + 'Z' : dt + 'T00:00:00Z';
  return new Date(s).getTime();
}

/* Aggregate lower-TF candles into higher TF (OHLCV rollup) */
function aggregateCandles(src, periodMs) {
  const out = [];
  for (const c of src) {
    const bucket = Math.floor(c.t / periodMs) * periodMs;
    const last = out[out.length - 1];
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


/* Fetch one timeframe from TwelveData REST, returns Promise<candle[]> */
function fetchTDSingle(tdSym, tdInterval, extraParams) {
  return new Promise(resolve => {
    const params = new URLSearchParams({
      symbol:     tdSym,
      interval:   tdInterval,
      outputsize: '1000',   /* Reduced from 5000 to prevent Database Timeouts on heavy assets like Gold */
      order:      'ASC',
      timezone:   'UTC',
      apikey:     TD_KEY,
      ...extraParams
    });
    const path = `/time_series?${params.toString()}`;
    const req = https.request({ hostname: 'api.twelvedata.com', path, method: 'GET' }, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status !== 'ok' || !Array.isArray(json.values)) {
            console.warn(`[TwelveData] ${tdSym} ${tdInterval}:`, json.message || json.status);
            return resolve([]);
          }
          const out = json.values.map(v => ({
            t: tdTs(v.datetime),
            o: parseFloat(v.open), h: parseFloat(v.high),
            l: parseFloat(v.low),  c: parseFloat(v.close),
            v: parseFloat(v.volume || 0)
          }));
          console.log(`[TwelveData] Loaded ${out.length} ${tdInterval} candles for ${tdSym}`);
          resolve(out);
        } catch(e) { console.error('[TwelveData] parse error', e.message); resolve([]); }
      });
    });
    req.on('error', e => { console.error('[TwelveData] request error', e.message); resolve([]); });
    req.end();
  });
}

/* ── TwelveData Crypto Cache — fetch + store into oandaCandles ── */

function _tdDateStr(ts) {
  // Format timestamp → TwelveData end_date param: "YYYY-MM-DD HH:MM:SS"
  return new Date(ts).toISOString().slice(0, 19).replace('T', ' ');
}

async function fetchTDCryptoHistory(sym, tdSym, incremental) {
  if (!TD_KEY) return;
  if (!oandaCandles[sym]) oandaCandles[sym] = {};
  TD_CRYPTO_TFS.forEach(tf => { if (!oandaCandles[sym][tf]) oandaCandles[sym][tf] = []; });

  for (const tf of TD_CRYPTO_TFS) {
    const arr    = oandaCandles[sym][tf];
    const tdIval = TD_TF[tf];
    const target = TD_CRYPTO_LIMITS[tf] || 5000;

    try {
      if (incremental && arr.length > 0) {
        // Only fetch new candles since last cached candle
        const lastT  = arr[arr.length - 1].t;
        const needed = Math.min(TD_CRYPTO_PAGE, Math.ceil((Date.now() - lastT) / TF_MS[tf]) + 5);
        if (needed <= 0) continue;
        const fresh = (await fetchTDSingle(tdSym, tdIval, { outputsize: String(needed) }))
          .filter(c => c.t > lastT);
        fresh.forEach(c => arr.push(c));
        if (fresh.length) console.log(`[TD Crypto] ${sym} ${tf}: +${fresh.length} new`);
      } else {
        // Paginated full fetch — walk backwards until target reached
        let collected = [];
        let endDate   = null; // null = start from latest

        while (collected.length < target) {
          const pageSize = Math.min(TD_CRYPTO_PAGE, target - collected.length);
          const extra    = endDate
            ? { outputsize: String(pageSize), end_date: endDate }
            : { outputsize: String(pageSize) };

          const batch = await fetchTDSingle(tdSym, tdIval, extra);
          if (!batch.length) break;

          collected = [...batch, ...collected]; // prepend older candles
          // Move end_date to just before the oldest candle in this batch
          endDate = _tdDateStr(batch[0].t - TF_MS[tf]);

          console.log(`[TD Crypto] ${sym} ${tf}: fetched ${collected.length}/${target}`);
          if (batch.length < pageSize) break; // no more history available

          await new Promise(r => setTimeout(r, 400)); // cooldown between pages
        }

        if (collected.length) {
          oandaCandles[sym][tf] = collected;
          console.log(`[TD Crypto] ${sym} ${tf}: ${collected.length} candles total`);
        }
      }
      await new Promise(r => setTimeout(r, 400)); // cooldown between TFs
    } catch(e) {
      console.error(`[TD Crypto] Error ${sym} ${tf}:`, e.message);
    }
  }
  saveCacheToDisk(sym);
}

let _tdCryptoRefreshing = false;
async function refreshTDCryptoCache(incremental = false) {
  if (!TD_KEY || _tdCryptoRefreshing) return;
  _tdCryptoRefreshing = true;
  console.log(`[TD Crypto] ${incremental ? 'Incremental' : 'Full'} refresh (${TD_CRYPTO_SYMBOLS.length} symbols)...`);
  for (const { symbol, td } of TD_CRYPTO_SYMBOLS) {
    try { await fetchTDCryptoHistory(symbol, td, incremental); }
    catch(e) { console.error(`[TD Crypto] ${symbol}:`, e.message); }
    await new Promise(r => setTimeout(r, 500));
  }
  _tdCryptoRefreshing = false;
  console.log('[TD Crypto] Cache refresh complete');
}

let _tdForexRefreshing = false;
async function refreshTDForexCache(incremental = false) {
  if (!TD_KEY || _tdForexRefreshing) return;
  _tdForexRefreshing = true;
  console.log(`[TD Forex] ${incremental ? 'Incremental' : 'Full'} refresh (${TD_FOREX_SYMBOLS.length} symbols)...`);
  for (const { symbol, td } of TD_FOREX_SYMBOLS) {
    try { await fetchTDCryptoHistory(symbol, td, incremental); }
    catch(e) { console.error(`[TD Forex] ${symbol}:`, e.message); }
    await new Promise(r => setTimeout(r, 500));
  }
  _tdForexRefreshing = false;
  console.log('[TD Forex] Cache refresh complete');
}

const _intradayLoaded = {}; /* tracks which symbols have had intraday (1m+1h) fetched */

function storeTF(symbol, tf, arr) {
  if (!arr.length) return;
  candles[symbol][tf].length = 0;
  arr.forEach(c => candles[symbol][tf].push(c));
}

function deriveFrom(symbol, src, targets) {
  if (!src.length) return;
  targets.forEach(tf => {
    if (candles[symbol][tf].length > 0) return; /* don't overwrite */
    const derived = aggregateCandles(src, TF_MS[tf]);
    storeTF(symbol, tf, derived);
    if (derived.length) console.log(`[TwelveData] Derived ${derived.length} ${tf} for ${symbol}`);
  });
}

/* Fetch daily, 1h, and 1m history sequentially to prevent burst limits */
async function fetchTDHistory(symbol) {
  if (!TD_KEY) return;
  ensureSymbol(symbol);
  const tdSym = toTDSymbol(symbol);
  
  try {
    // 1. Daily
    const d1 = await fetchTDSingle(tdSym, '1day');
    storeTF(symbol, '1d', d1);
    deriveFrom(symbol, d1, ['1w']);
    
    await new Promise(r => setTimeout(r, 400));
    
    // 2. Hourly
    const h1 = await fetchTDSingle(tdSym, '1h');
    storeTF(symbol, '1h', h1);
    deriveFrom(symbol, h1, ['4h']);
    
    await new Promise(r => setTimeout(r, 400));
    
    // 3. Minute
    const m1 = await fetchTDSingle(tdSym, '1min');
    storeTF(symbol, '1m', m1);
    deriveFrom(symbol, m1, ['5m','15m','30m']);
    
    console.log(`[TwelveData] History fully ready for ${symbol}`);
  } catch(e) {
    console.error(`[TwelveData] History fetch error for ${symbol}`, e);
  }
}

/* ═══════════════════════════════════════════════════
   TWELVEDATA WEBSOCKET — Single Master Connection
   ═══════════════════════════════════════════════════ */

/* Reverse map: TwelveData symbol → internal symbol (e.g. BTC/USD → BTCUSDT) */
const _tdToInternal = {};
function fromTDSymbol(tdSym) { return _tdToInternal[tdSym] || tdSym.replace('/', ''); }

/* Create and manage one TwelveData WebSocket connection */
function createTDSocket(name, initialSymbols) {
  if (!TD_KEY) return null;
  let ws = null;
  let subscribed = new Set(initialSymbols);
  let ready = false;
  let reconnectTimer = null;

  function connect() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    ws = new WebSocket(`wss://ws.twelvedata.com/v1/quotes/price?apikey=${TD_KEY}`);

    ws.on('open', () => {
      ready = true;
      console.log(`[TDws:${name}] connected`);
      if (subscribed.size > 0) {
        ws.send(JSON.stringify({ action:'subscribe', params:{ symbols: [...subscribed].join(',') } }));
      }
    });

    ws.on('message', raw => {
      try {
        const msg = JSON.parse(raw);
        if (msg.event === 'price') {
          const internalSym = fromTDSymbol(msg.symbol);
          const price = parseFloat(msg.price);
          if (price && internalSym) processTick(internalSym, price, 0, (msg.timestamp || 0) * 1000 || Date.now());
        }
      } catch(e) {}
    });

    ws.on('close', () => {
      ready = false;
      console.log(`[TDws:${name}] closed — reconnecting in 5s`);
      reconnectTimer = setTimeout(connect, 5000);
    });

    ws.on('error', e => {
      console.error(`[TDws:${name}] error:`, e.message);
      ws.terminate();
    });
  }

  connect();

  return {
    subscribe(tdSym) {
      subscribed.add(tdSym);
      if (ready && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action:'subscribe', params:{ symbols: tdSym } }));
        console.log(`[TDws:${name}] subscribed ${tdSym}`);
      }
    },
    unsubscribe(tdSym) {
      subscribed.delete(tdSym);
      if (ready && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ action:'unsubscribe', params:{ symbols: tdSym } }));
        console.log(`[TDws:${name}] unsubscribed ${tdSym}`);
      }
    },
    has(tdSym) { return subscribed.has(tdSym); }
  };
}

/* Initialise a single Master Socket to conserve TwelveData connection limits */
const _tdRootWS = null; /* TD_DISABLED — re-enable: TD_KEY ? createTDSocket('master', ['XAU/USD', 'BTC/USD', 'ETH/USD', 'SOL/USD']) : null */

/* Register reverse-map entries for always-on symbols */
['XAUUSD','BTCUSDT','ETHUSDT','SOLUSDT'].forEach(s => { _tdToInternal[toTDSymbol(s)] = s; });

/* ═══════════════════════════════════════════════════
   METAAPI (OANDA) DATA SOURCE
   ═══════════════════════════════════════════════════ */
const METAAPI_TOKEN      = process.env.METAAPI_TOKEN || '';
const METAAPI_ACCOUNT_ID = '620f74cf-9c2e-46d0-8073-36ab51e621c0';

/* Internal symbol → OANDA MT5 symbol name */
const _maSymMap = {
  /* ── Metals / Commodities ── */
  'XAUUSD':   'GOLD.pro',
  'XAGUSD':   'SILVER.pro',
  'OILWTI':   'OILWTI.pro',
  'OILBRNT':  'OILBRNT.pro',
  'NATGAS':   'NATGAS.pro',
  'COPPER':   'COPPER-US.pro',
  'PLATIN':   'PLATIN.pro',
  'PALLAD':   'PALLAD.pro',
  /* ── Forex majors ── */
  'EURUSD':   'EURUSD.pro',
  'GBPUSD':   'GBPUSD.pro',
  'USDJPY':   'USDJPY.pro',
  'USDCHF':   'USDCHF.pro',
  'AUDUSD':   'AUDUSD.pro',
  'NZDUSD':   'NZDUSD.pro',
  'USDCAD':   'USDCAD.pro',
  /* ── Forex crosses ── */
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
  /* ── Indices ── */
  'US500':    'US500.pro',
  'US30':     'US30.pro',
  'US100':    'US100.pro',
  'DE30':     'DE30.pro',
  'GB100':    'GB100.pro',
  'JP225':    'JP225.pro',
  'AU200':    'AU200.pro',
  'EU50':     'EU50.pro',
  'FR40':     'FR40.pro',
  /* ── Equity CFDs ── */
  'TSLA':     'TSLA_CFD.US',
  'NVDA':     'NVDA_CFD.US',
  'AAPL':     'AAPL_CFD.US',
  /* ── Crypto ── */
  'BTCUSDT':  'BTCUSD',
  'ETHUSDT':  'ETHUSD',
  'SOLUSDT':  'SOLUSD',
  'ADAUSDT':  'ADAUSD',
  'LTCUSD':   'LTCUSD',
};
const _oandaLoaded    = {};
const _oandaLastFetch = {}; /* sym → timestamp of last background fetch trigger */

/* Classify a symbol by its data source for signal tagging */
const _tdCryptoSet = new Set();   // populated after TD_CRYPTO_SYMBOLS is defined (below)
const _tdForexSet  = new Set();   // populated after TD_FOREX_SYMBOLS is defined (below)
function getDataSource(sym) {
  if (_tdForexSet.has(sym))  return 'td_forex';
  if (_tdCryptoSet.has(sym)) return 'td_crypto';
  return 'oanda';
}

/* ── TwelveData Crypto Cache ──
   Symbols not covered by OANDA, fetched via TwelveData REST and stored
   in oandaCandles so they flow through the scanner + sniper automatically. */
const TD_CRYPTO_SYMBOLS = [
  { symbol: 'BNBUSDT',   td: 'BNB/USD',  name: 'BNB / US Dollar'         },
  { symbol: 'XRPUSDT',   td: 'XRP/USD',  name: 'XRP / US Dollar'         },
  { symbol: 'DOGEUSDT',  td: 'DOGE/USD', name: 'Dogecoin / US Dollar'     },
  { symbol: 'DOTUSDT',   td: 'DOT/USD',  name: 'Polkadot / US Dollar'     },
  { symbol: 'LINKUSDT',  td: 'LINK/USD', name: 'Chainlink / US Dollar'    },
  { symbol: 'AVAXUSDT',  td: 'AVAX/USD', name: 'Avalanche / US Dollar'    },
  { symbol: 'MATICUSDT', td: 'MATIC/USD',name: 'Polygon / US Dollar'      },
  { symbol: 'ATOMUSDT',  td: 'ATOM/USD', name: 'Cosmos / US Dollar'       },
];
const TD_CRYPTO_TFS     = ['1m', '1h', '4h', '1d'];
const TD_CRYPTO_LIMITS  = { '1m': 10080, '1h': 17520, '4h': 7800, '1d': 5000 }; // match OANDA depth
const TD_CRYPTO_PAGE    = 5000; // max candles per TwelveData call

const TD_FOREX_SYMBOLS = [
  { symbol: 'EURUSD', td: 'EUR/USD', name: 'Euro / US Dollar'            },
  { symbol: 'GBPUSD', td: 'GBP/USD', name: 'British Pound / US Dollar'   },
  { symbol: 'USDJPY', td: 'USD/JPY', name: 'US Dollar / Japanese Yen'    },
  { symbol: 'USDCHF', td: 'USD/CHF', name: 'US Dollar / Swiss Franc'     },
  { symbol: 'AUDUSD', td: 'AUD/USD', name: 'Australian Dollar / USD'     },
  { symbol: 'USDCAD', td: 'USD/CAD', name: 'US Dollar / Canadian Dollar' },
  { symbol: 'NZDUSD', td: 'NZD/USD', name: 'New Zealand Dollar / USD'    },
  { symbol: 'EURJPY', td: 'EUR/JPY', name: 'Euro / Japanese Yen'         },
  { symbol: 'GBPJPY', td: 'GBP/JPY', name: 'British Pound / Yen'         },
  { symbol: 'EURGBP', td: 'EUR/GBP', name: 'Euro / British Pound'        },
  { symbol: 'USDBRL', td: 'USD/BRL', name: 'US Dollar / Brazilian Real'  },
];

/* Populate source-classification sets now that both arrays are defined */
TD_CRYPTO_SYMBOLS.forEach(s => _tdCryptoSet.add(s.symbol));
TD_FOREX_SYMBOLS.forEach(s  => _tdForexSet.add(s.symbol));

let _maAccount  = null;
let _maConn       = null;
let _maStreamConn = null;                /* streaming connection for live prices */
let _streamStatus = {};                  /* brokerSym → 'subscribed'|'failed: ...'|'pending' */
let _maReady      = false;
let _maStatus     = 'disconnected';      /* 'connecting' | 'connected' | 'disconnected' | 'error' */
let _maLastSeen   = null;
let _maRetry      = 0;
let _maWatchdog   = null;

let _lastBrokerSymbolList = [];

async function _discoverBrokerSymbols() {
  if (!_maConn) return;
  try {
    const brokerSymbols = await _maConn.getSymbols();
    if (!brokerSymbols || !brokerSymbols.length) return;

    _lastBrokerSymbolList = brokerSymbols.map(bs => bs.symbol || bs).sort();

    /* Group all broker symbols by their base name */
    const baseToSuffixes = new Map();
    for (const bs of brokerSymbols) {
      const name = bs.symbol || bs;
      const base = name.toUpperCase().replace(/[._-].*/,'');
      if (!baseToSuffixes.has(base)) baseToSuffixes.set(base, []);
      baseToSuffixes.get(base).push(name);
    }

    /* Prioritize specific account suffixes to prevent charting conflicts */
    const SUFFIX_PRIORITY = ['.sml', '.pro', '.raw', ''];

    function pickBestSymbol(base) {
      const available = baseToSuffixes.get(base);
      if (!available || available.length === 0) return null;
      
      for (const pref of SUFFIX_PRIORITY) {
        const match = available.find(s => s.toLowerCase().endsWith(pref.toLowerCase()));
        if (match) return match;
      }
      return available[0]; /* fallback to the first available */
    }

    let remapped = 0;
    for (const [internalSym, oldBrokerSym] of Object.entries(_maSymMap)) {
      /* Pass 1: match by internal symbol base (XAUUSD → XAUUSD.sml) */
      const internalBase = internalSym.toUpperCase().replace(/[._-].*/,'');
      let found = pickBestSymbol(internalBase);

      /* Pass 2: match by old broker symbol base (GOLD.pro → GOLD.sml) */
      if (!found) {
        const oldBase = oldBrokerSym.toUpperCase().replace(/[._-].*/,'');
        found = pickBestSymbol(oldBase);
      }

      if (found && found !== oldBrokerSym) {
        console.log(`[MetaApi] Remapped ${internalSym}: ${oldBrokerSym} -> ${found}`);
        _maSymMap[internalSym] = found;
        remapped++;
      } else if (!found) {
        console.warn(`[MetaApi] No broker match for ${internalSym} (was: ${oldBrokerSym})`);
      }
    }

    if (remapped > 0) console.log(`[MetaApi] Symbol discovery complete - ${remapped} remapped`);
    else console.log('[MetaApi] Symbol discovery: no changes needed');
  } catch(e) {
    console.warn('[MetaApi] _discoverBrokerSymbols error:', e.message);
  }
}

async function initMetaApi() {
  if (!METAAPI_TOKEN) return;
  _maStatus = 'connecting';
  try {
    const MetaApi = require('metaapi.cloud-sdk').default;
    const api = new MetaApi(METAAPI_TOKEN);
    _maAccount = await api.metatraderAccountApi.getAccount(METAAPI_ACCOUNT_ID);
    if (!['DEPLOYING','DEPLOYED'].includes(_maAccount.state)) await _maAccount.deploy();
    _maConn = _maAccount.getRPCConnection();
    await _maConn.connect();
    /* Give the connection 5s to settle without blocking on full sync */
    await new Promise(r => setTimeout(r, 5000));
    _maReady    = true;
    _maStatus   = 'connected';
    _maLastSeen = Date.now();
    _maRetry    = 0;
    console.log('[MetaApi] OANDA connection ready');
    /* Auto-discover broker symbol names — remaps _maSymMap to actual broker names */
    _discoverBrokerSymbols().catch(e => console.warn('[MetaApi] Symbol discovery failed:', e.message));
    _startWatchdog();
    startOandaStream(); /* non-blocking — subscribes all symbols for live prices */
  } catch(e) {
    _maStatus = 'error';
    console.error('[MetaApi] Init failed:', e.message);
    _scheduleReconnect();
  }
}

function _scheduleReconnect() {
  /* Exponential backoff: 10s, 20s, 40s, 80s … capped at 10 minutes */
  const delay = Math.min(10000 * Math.pow(2, _maRetry), 600000);
  _maRetry++;
  console.log(`[MetaApi] Reconnecting in ${Math.round(delay/1000)}s (attempt ${_maRetry})...`);
  setTimeout(async () => {
    _maReady  = false;
    _maConn   = null;
    _maAccount = null;
    await initMetaApi();
  }, delay);
}

function _startWatchdog() {
  if (_maWatchdog) clearInterval(_maWatchdog);
  /* Every 2 minutes, ping MetaAPI — if it fails or last seen > 5min ago, reconnect */
  _maWatchdog = setInterval(async () => {
    try {
      if (!_maConn) throw new Error('no connection');
      await _maConn.getSymbolPrice(_maSymMap['EURUSD']); /* lightweight ping */
      _maLastSeen = Date.now();
      _maStatus   = 'connected';
    } catch(e) {
      const staleSec = _maLastSeen ? Math.round((Date.now() - _maLastSeen) / 1000) : '?';
      console.warn(`[MetaApi] Watchdog: connection lost (last seen ${staleSec}s ago) — reconnecting...`);
      _maStatus     = 'disconnected';
      _maReady      = false;
      _maStreamConn = null;
      _streamStatus = {};
      _streamStarted = false;
      clearInterval(_maWatchdog);
      _maWatchdog = null;
      _scheduleReconnect();
    }
  }, 120000);
}

let _streamStarted = false;
async function startOandaStream() {
  if (!_maAccount || _streamStarted) return;
  _streamStarted = true;
  try {
    console.log('[Stream] Starting streaming connection...');
    _maStreamConn = _maAccount.getStreamingConnection();

    /* Price update listener — SDK may call singular or plural depending on version */
    function _handleStreamPrice(price) {
      try {
        const bid = price.bid, ask = price.ask;
        if (!bid && !ask) return;
        const mid = ((bid || ask) + (ask || bid)) / 2;
        const ts  = price.time ? new Date(price.time).getTime() : Date.now();
        const internalSym = Object.keys(_maSymMap).find(k => _maSymMap[k] === price.symbol);
        if (!internalSym) return;
        ensureOandaSym(internalSym);
        TIMEFRAMES.forEach(tf => {
          const periodMs = TF_MS[tf];
          const arr      = oandaCandles[internalSym][tf];
          const cur      = arr[arr.length - 1];
          let bucket = Math.floor(ts / periodMs) * periodMs;
          if (cur) {
            const periodsElapsed = Math.floor((ts - cur.t) / periodMs);
            bucket = cur.t + periodsElapsed * periodMs;
          }
          if (!cur || cur.t !== bucket) {
            arr.push({ t: bucket, o: mid, h: mid, l: mid, c: mid, v: 0 });
          } else {
            cur.c = mid; cur.h = Math.max(cur.h, mid); cur.l = Math.min(cur.l, mid);
          }
        });
        processTick(internalSym, mid, 0, ts);
        _maLastSeen = Date.now();
      } catch(e) { /* ignore per-tick errors */ }
    }

    _maStreamConn.addSynchronizationListener({
      onSymbolPriceUpdated(_i, price)       { _handleStreamPrice(price); },
      onSymbolPricesUpdated(_i, prices)     { (prices || []).forEach(_handleStreamPrice); },
    });

    await _maStreamConn.connect();
    /* Wait for full broker sync — required before subscribing to market data */
    try {
      await _maStreamConn.waitSynchronized({ timeoutInSeconds: 60 });
      console.log('[Stream] Connection synchronized');
    } catch(e) {
      console.warn('[Stream] Sync timeout — proceeding anyway:', e.message);
    }

    /* Symbols that OANDA does not support for streaming market data */
    const _streamUnsupported = new Set(['ADAUSD', 'LTCUSD']);

    /* Subscribe all symbols — log each result */
    const brokerSyms = Object.values(_maSymMap).filter(s => !_streamUnsupported.has(s));
    console.log(`[Stream] Subscribing ${brokerSyms.length} symbols...`);
    for (const brokerSym of brokerSyms) {
      _streamStatus[brokerSym] = 'pending';
      try {
        await _maStreamConn.subscribeToMarketData(brokerSym);
        _streamStatus[brokerSym] = 'subscribed';
        console.log(`[Stream] ${brokerSym} ✓`);
      } catch(e) {
        _streamStatus[brokerSym] = 'failed: ' + e.message;
        console.warn(`[Stream] ${brokerSym} ✗: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, 200)); /* small gap between subscriptions */
    }

    const ok   = Object.values(_streamStatus).filter(v => v === 'subscribed').length;
    const fail = Object.values(_streamStatus).filter(v => v.startsWith('failed')).length;
    console.log(`[Stream] Done — ${ok} subscribed, ${fail} failed`);
  } catch(e) {
    console.error('[Stream] Streaming connection failed:', e.message);
  }
}



/* Separate candle store for OANDA data — same structure as candles{} */
const oandaCandles = {};

/* ── Disk cache for OANDA candles ── */
const OANDA_CACHE_DIR = path.join(__dirname, 'oanda_cache');
try { if (!fs.existsSync(OANDA_CACHE_DIR)) fs.mkdirSync(OANDA_CACHE_DIR); } catch(e) {}

function saveCacheToDisk(sym) {
  try {
    fs.writeFileSync(
      path.join(OANDA_CACHE_DIR, sym + '.json'),
      JSON.stringify(oandaCandles[sym])
    );
    console.log(`[Cache] Saved ${sym}`);
  } catch(e) { console.error('[Cache] Save error ' + sym + ':', e.message); }
}

function loadCacheFromDisk() {
  let n = 0;
  const allSyms = [...new Set([
    ...Object.keys(_maSymMap),
    ...TD_CRYPTO_SYMBOLS.map(s => s.symbol),
    ...TD_FOREX_SYMBOLS.map(s => s.symbol),
  ])];
  for (const sym of allSyms) {
    const file = path.join(OANDA_CACHE_DIR, sym + '.json');
    try {
      if (!fs.existsSync(file)) continue;
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      oandaCandles[sym] = data;
      _oandaLoaded[sym] = true;
      n++;
    } catch(e) { console.error('[Cache] Load error ' + sym + ':', e.message); }
  }
  console.log('[Cache] Loaded ' + n + ' symbols from disk');
}

let _cacheRefreshing = false;
const _cacheProgress = {
  active: false,
  currentSym: null,
  currentTF: null,
  symDone: 0,
  symTotal: 0,
  tfDone: 0,
  tfTotal: 0,
  pct: 0,
  startedAt: null,
  log: [], /* last 20 messages */
};
function _cpLog(msg) {
  _cacheProgress.log.push({ t: new Date().toISOString(), msg });
  if (_cacheProgress.log.length > 20) _cacheProgress.log.shift();
}

async function refreshAllOandaCache() {
  if (!_maReady || _cacheRefreshing) return;
  _cacheRefreshing = true;
  const syms = Object.keys(_maSymMap);
  _cacheProgress.active    = true;
  _cacheProgress.symDone   = 0;
  _cacheProgress.symTotal  = syms.length;
  _cacheProgress.tfDone    = 0;
  _cacheProgress.tfTotal   = syms.length * TIMEFRAMES.length;
  _cacheProgress.pct       = 0;
  _cacheProgress.startedAt = new Date().toISOString();
  _cacheProgress.log       = [];
  _cpLog('Started full refresh (' + syms.length + ' symbols)');
  console.log('[Cache] Starting full OANDA cache refresh (' + syms.length + ' symbols)...');
  for (const sym of syms) {
    _cacheProgress.currentSym = sym;
    _cacheProgress.currentTF  = null;
    const hasData = oandaCandles[sym] && TIMEFRAMES.some(tf => (oandaCandles[sym][tf] || []).length > 0);
    try { await fetchOandaHistory(sym, hasData); } catch(e) { console.error('[Cache] Error refreshing ' + sym + ':', e.message); _cpLog('ERROR ' + sym + ': ' + e.message); }
    _cacheProgress.symDone++;
    _cacheProgress.pct = Math.round((_cacheProgress.symDone / _cacheProgress.symTotal) * 100);
    await new Promise(r => setTimeout(r, 1000));
  }
  _cacheProgress.active     = false;
  _cacheProgress.currentSym = null;
  _cacheProgress.currentTF  = null;
  _cacheRefreshing = false;
  _cpLog('Refresh complete');
  console.log('[Cache] Full OANDA cache refresh complete');
}

function ensureOandaSym(sym) {
  if (!oandaCandles[sym]) oandaCandles[sym] = {};
  /* Always ensure every current TF exists — catches symbols loaded from old disk cache missing new TFs like 1M */
  TIMEFRAMES.forEach(tf => { if (!oandaCandles[sym][tf]) oandaCandles[sym][tf] = []; });
}

function storeOandaTF(sym, tf, arr) {
  if (!arr.length) return;
  oandaCandles[sym][tf].length = 0;
  arr.forEach(c => oandaCandles[sym][tf].push(c));
}

function deriveOanda(sym, src, targets) {
  if (!src.length) return;
  targets.forEach(tf => {
    if (oandaCandles[sym][tf].length > 0) return;
    const derived = aggregateCandles(src, TF_MS[tf]);
    storeOandaTF(sym, tf, derived);
    if (derived.length) console.log(`[MetaApi] Derived ${derived.length} ${tf} for ${sym}`);
  });
}

function maToCandle(c) {
  return { t: new Date(c.time).getTime(), o: c.open, h: c.high, l: c.low, c: c.close, v: c.tickVolume || 0 };
}

async function fetchOandaCandles(maSym, tf, startTime, limit) {
  if (!_maAccount) return [];
  try {
    const raw = await _maAccount.getHistoricalCandles(maSym, tf, startTime, limit);
    return (raw || []).map(maToCandle);
  } catch(e) {
    console.error('[MetaApi] fetchOandaCandles error:', e.message);
    return [];
  }
}


/* Target candle counts per TF for full history fetch:
   1w  → 1100 (~21 years)   1d  → 5000 (~13 years)
   4h  → 7800 (~5 years)    1h  → 17520 (~2 years)
   1m  → 10080 (7 days)     others → 2000             */
const _OANDA_FULL_LIMITS = { '1w': 1100, '1d': 5000, '4h': 7800, '1h': 17520, '30m': 2000, '15m': 2000, '5m': 2000, '1m': 10080 };

const _OANDA_PAGE_SIZE = 1000; /* max candles per MetaAPI request */

async function fetchOandaHistory(internalSym, incremental) {
  if (!_maReady) return;
  const maSym = _maSymMap[internalSym];
  if (!maSym) return;
  ensureOandaSym(internalSym);

  const delay = () => new Promise(r => setTimeout(r, 500));

  try {
    for (const tf of TIMEFRAMES) {
      _cacheProgress.currentTF = tf;
      const arr    = oandaCandles[internalSym][tf];
      const target = _OANDA_FULL_LIMITS[tf] || 1000;

      /* If existing data is less than 70% of the new target, back-fill regardless of incremental flag */
      const needsBackfill = arr && arr.length > 0 && arr.length < target * 0.7;

      if (incremental && arr.length > 0 && !needsBackfill) {
        /* Incremental: only fetch candles that could have appeared since last save */
        const lastT   = arr[arr.length - 1].t;
        const elapsed = Date.now() - lastT;
        const limit   = Math.min(_OANDA_PAGE_SIZE, Math.ceil(elapsed / TF_MS[tf]) + 20);
        const batch   = await fetchOandaCandles(maSym, tf, new Date(), limit);
        const fresh   = batch.filter(c => c.t > lastT);
        fresh.forEach(c => arr.push(c));
        if (fresh.length) console.log(`[MetaApi] ${internalSym} ${tf}: +${fresh.length} new (incremental)`);
      } else {
        if (needsBackfill) console.log(`[MetaApi] ${internalSym} ${tf}: only ${arr.length}/${target} candles — back-filling history...`);
        /* Full fetch with pagination — walk backwards in time until target reached */
        let collected = [];
        let fromTime  = new Date();

        while (collected.length < target) {
          const limit = Math.min(_OANDA_PAGE_SIZE, target - collected.length);
          const batch = await fetchOandaCandles(maSym, tf, fromTime, limit);
          if (!batch.length) break;
          collected = [...batch, ...collected]; /* prepend older candles */
          fromTime  = new Date(batch[0].t - 1); /* go further back */
          if (batch.length < limit) break; /* no more history available */
          await delay();
        }

        storeOandaTF(internalSym, tf, collected);
        console.log(`[MetaApi] ${internalSym} ${tf}: ${collected.length} candles (target ${target})`);
      }

      _cacheProgress.tfDone++;
      await delay();
    }
    console.log(`[MetaApi] History ready for ${internalSym}`);
    _cpLog(`Done: ${internalSym}`);
    saveCacheToDisk(internalSym);
  } catch(e) {
    console.error('[MetaApi] fetchOandaHistory error:', e.message);
  }
}

const _oandaTickers = {};

function startOandaTicker(internalSym, maSym) {
  if (_oandaTickers[internalSym]) return; /* already running */
  _oandaTickers[internalSym] = setInterval(async () => {
    if (!_maConn) return;
    try {
      const p = await _maConn.getSymbolPrice(maSym);
      if (!p) return;
      const price = (p.bid + p.ask) / 2;
      const ts = p.time ? new Date(p.time).getTime() : Date.now();
      /* Update oandaCandles live candle */
      ensureOandaSym(internalSym);
      TIMEFRAMES.forEach(tf => {
        const periodMs = TF_MS[tf];
        const arr      = oandaCandles[internalSym][tf];
        const cur      = arr[arr.length - 1];
        
        let bucket = Math.floor(ts / periodMs) * periodMs;
        if (cur) {
          const periodsElapsed = Math.floor((ts - cur.t) / periodMs);
          bucket = cur.t + periodsElapsed * periodMs;
        }

        if (!cur || cur.t !== bucket) {
          arr.push({ t: bucket, o: price, h: price, l: price, c: price, v: 0 });
        } else {
          cur.c = price; cur.h = Math.max(cur.h, price); cur.l = Math.min(cur.l, price);
        }
      });
      /* Also feed into main candles store so SSE / live price bar works */
      processTick(internalSym, price, 0, ts);
    } catch(e) { /* ignore transient errors */ }
  }, 2000);
  console.log(`[MetaApi] Live ticker started for ${internalSym}`);
}

/* Subscribe a symbol on the master socket */
function tdWSSubscribe(internalSym) {
  const tdSym = toTDSymbol(internalSym);
  _tdToInternal[tdSym] = internalSym;
  if (_tdRootWS && !_tdRootWS.has(tdSym)) _tdRootWS.subscribe(tdSym);
}

/* Unsubscribe from the master socket when no SSE clients remain for that symbol */
function tdWSUnsubscribe(internalSym) {
  const tdSym = toTDSymbol(internalSym);
  if (_tdRootWS && _tdRootWS.has(tdSym)) _tdRootWS.unsubscribe(tdSym);
}

function connectTD(symbol) {
  /* TD_DISABLED — only OANDA active. Re-enable by restoring body below:
  const sym = symbol.toUpperCase();
  ensureSymbol(sym);
  if (!tdLoaded[sym]) { tdLoaded[sym] = true; fetchTDHistory(sym); }
  tdWSSubscribe(sym);
  */
  ensureSymbol(symbol.toUpperCase());
}

const app = express();
const PORT = process.env.PORT || 8080;

/* Trust Cloudflare so req.ip = real visitor IP */
app.set('trust proxy', 1);

/* Security headers */
app.use(helmet({ contentSecurityPolicy: false }));

/* CORS — only your domain + localhost for dev */
const _allowedOrigins = ['https://fractalaiagent.com','https://www.fractalaiagent.com','http://localhost:3000','http://localhost:8080'];
app.use(cors({ origin: (o, cb) => cb(null, !o || _allowedOrigins.includes(o)), credentials: true }));

/* Simple rate limiter — no extra package needed */
const _rlMap = new Map();
function getClientIp(req) { return req.headers['cf-connecting-ip'] || (req.headers['x-forwarded-for']||'').split(',')[0].trim() || req.ip; }
function rateLimit(max, ms) {
  const map = new Map();
  return (req, res, next) => {
    const ip = getClientIp(req), now = Date.now();
    let e = map.get(ip);
    if (!e || now > e.reset) { e = { count:0, reset:now+ms }; map.set(ip, e); }
    if (++e.count > max) return res.status(429).json({ error:'Too many requests' });
    next();
  };
}
setInterval(() => { const now = Date.now(); _rlMap.forEach((v,k) => { if (now > v.reset) _rlMap.delete(k); }); }, 600000);

app.use('/stripe-webhook', express.raw({ type: 'application/json' }));
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

/* ═══════════════════════════════════════════════════
   SERVE HTML PAGES (from public/ folder)
   ═══════════════════════════════════════════════════ */
function sendPage(file, res) {
  const p = path.join(__dirname, 'public', file);
  if (fs.existsSync(p)) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(p);
  } else res.status(404).send('Page not found: ' + file);
}

app.get('/',        (req, res) => sendPage('index.html',   res));
app.get('/auth',    (req, res) => sendPage('auth.html',    res));
app.get('/terms',   (req, res) => sendPage('terms.html',   res));
app.get('/privacy', (req, res) => sendPage('privacy.html', res));

/* ═══════════════════════════════════════════════════
   API ENDPOINTS
   ═══════════════════════════════════════════════════ */

function validSymbol(s) { return typeof s === 'string' && /^[A-Z0-9\/\-]{2,20}$/.test(s); }

app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: Date.now() }));

// /profile API endpoint (returns user data as JSON)
app.get('/api/profile', rateLimit(30, 60000), async (req, res) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  const prof  = await getUserProfile(token);
  res.json(prof || { credits: 0, plan: 'free', userId: null });
});

// /profile page redirect
app.get('/profile', (req, res) => sendPage('profile.html', res));

// Tracks in-flight lazy fetches to prevent polling loops from spamming TwelveData
const _fetchingTF = {};

// Candles endpoint — 60 req/min per IP
app.get('/candles/:symbol', rateLimit(60, 60000), async (req, res) => {
  const { symbol } = req.params;
  const tf = req.query.tf || '1h';
  const sym = symbol.toUpperCase().replace('-', '/');
  if (!validSymbol(sym)) return res.status(400).json({ error: 'Invalid symbol' });
  
  connectTD(sym);
  ensureSymbol(sym);

  /* source=oanda → serve from OANDA candle store if available */
  const _oandaKey = sym.replace('/', ''); /* XAU/USD → XAUUSD */

  if (req.query.source === 'oanda' && _maReady && _maSymMap[_oandaKey]) {
    const now       = Date.now();
    const lastFetch = _oandaLastFetch[_oandaKey] || 0;
    const cooldown  = _oandaLoaded[_oandaKey] ? 600000 : 0; /* 10min if loaded, instant if new */
    if (now - lastFetch > cooldown) {
      _oandaLoaded[_oandaKey]    = true;
      _oandaLastFetch[_oandaKey] = now;
      fetchOandaHistory(_oandaKey, !!oandaCandles[_oandaKey]); /* incremental if has data */
    }
  }

  const _oandaArr = oandaCandles[_oandaKey] && (oandaCandles[_oandaKey][tf]||[]);
  const oandaReady = _oandaArr && _oandaArr.length > 0;

  if (req.query.source === 'oanda' && !oandaReady) {
    return res.json({ candles: [], loading: true });
  }
  const useOanda = req.query.source === 'oanda' && oandaReady;
  let arr = useOanda ? (oandaCandles[_oandaKey][tf] || []) : (candles[sym][tf] || []);

  /* If empty, try to derive from a lower TF that's already loaded */
  if (arr.length === 0) {
    /* 5m/15m/30m → derive from 1m if available */
    if (['5m','15m','30m'].includes(tf) && candles[sym]['1m'] && candles[sym]['1m'].length > 0) {
      deriveFrom(sym, candles[sym]['1m'], [tf]);
      arr = candles[sym][tf] || [];
    }
    /* 4h → derive from 1h if available */
    if (tf === '4h' && candles[sym]['1h'] && candles[sym]['1h'].length > 0) {
      deriveFrom(sym, candles[sym]['1h'], ['4h']);
      arr = candles[sym][tf] || [];
    }
    /* 1w → derive from 1d if available */
    if (tf === '1w' && candles[sym]['1d'] && candles[sym]['1d'].length > 0) {
      deriveFrom(sym, candles[sym]['1d'], ['1w']);
      arr = candles[sym][tf] || [];
    }
  }

  /* Still empty — fetch directly from TwelveData (anchor TFs: 1m, 1h, 1d) */
  if (arr.length === 0 && TD_KEY) {
    const fetchKey = sym + '_' + tf;
    if (!_fetchingTF[fetchKey]) {
      _fetchingTF[fetchKey] = true;
      const tdSym = toTDSymbol(sym);
      /* For derived TFs, fetch their anchor instead */
      const anchorTf  = ['5m','15m','30m'].includes(tf) ? '1m'
                      : tf === '4h'                      ? '1h'
                      : tf === '1w'                      ? '1d'
                      : tf;
      const tdInterval = TD_TF[anchorTf] || TD_TF[tf] || '1h';
      try {
        const data = await fetchTDSingle(tdSym, tdInterval);
        storeTF(sym, anchorTf, data);
        /* Derive requested TF from anchor */
        if (anchorTf !== tf) deriveFrom(sym, data, [tf]);
      } catch(e) {
        console.error(`[candles] fetch error ${tdSym} ${tdInterval}:`, e.message);
      } finally {
        _fetchingTF[fetchKey] = false;
      }
    }
    arr = candles[sym][tf] || [];
  }

  res.json({ candles: arr });
});

// Historical candles endpoint — lazy scroll pagination via TwelveData
app.get('/history/:symbol', rateLimit(30, 60000), async (req, res) => {
  const sym      = req.params.symbol.toUpperCase().replace('-', '/');
  const tf       = req.query.tf || '4h';
  const endTime  = parseInt(req.query.endTime, 10);
  if (!validSymbol(sym)) return res.status(400).json({ candles: [] });

  /* ── OANDA history: serve from store, fetch more from MetaApi if needed ── */
  if (req.query.source === 'oanda') {
    if (!endTime || endTime < 0) return res.json({ candles: [] });
    const _oKey  = sym.replace('/', '');
    const maSym  = _maSymMap[_oKey];
    ensureOandaSym(_oKey);
    const store = oandaCandles[_oKey][tf];

    /* Check how many candles exist before the requested endTime */
    const before = endTime > 0 ? store.filter(c => c.t < endTime) : store;

    if (before.length < 50 && maSym && _maAccount) {
      /* Not enough — fetch a fresh batch from MetaApi going back from endTime */
      const limit  = 2000;
      const startT = new Date(endTime);
      try {
        const fetched = await fetchOandaCandles(maSym, tf, startT, limit);
        /* Prepend new candles to store, keeping sorted, deduplicated */
        if (fetched.length) {
          const existingTs = new Set(store.map(c => c.t));
          const newOnes    = fetched.filter(c => !existingTs.has(c.t) && c.t < endTime);
          if (newOnes.length) {
            Array.prototype.unshift.apply(store, newOnes);
            store.sort((a, b) => a.t - b.t);
            console.log(`[OANDA history] Fetched ${newOnes.length} more ${tf} for ${_oKey}`);
          }
        }
      } catch(e) {
        console.error('[OANDA history] fetch error:', e.message);
      }
    }

    const result = store.filter(c => c.t < endTime).slice(-2000);
    return res.json({ candles: result });
  }

  if (!TD_KEY) return res.status(500).json({ candles: [] });
  const tdInterval = TD_TF[tf];
  if (!tdInterval || !endTime || endTime < 0) return res.status(400).json({ candles: [] });
  const tdSym  = toTDSymbol(sym);
  const endDate = new Date(endTime).toISOString().slice(0, 19); /* UTC ISO */
  const params = new URLSearchParams({
    symbol: tdSym, interval: tdInterval,
    outputsize: '5000', order: 'ASC', timezone: 'UTC',
    end_date: endDate, apikey: TD_KEY
  });
  const path = `/time_series?${params.toString()}`;
  const treq = https.request({ hostname: 'api.twelvedata.com', path, method: 'GET' }, tres => {
    let data = '';
    tres.on('data', c => { data += c; });
    tres.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.status !== 'ok' || !Array.isArray(json.values)) return res.json({ candles: [] });
        const out = json.values.map(v => ({
          t: tdTs(v.datetime),
          o: parseFloat(v.open),  h: parseFloat(v.high),
          l: parseFloat(v.low),   c: parseFloat(v.close),
          v: parseFloat(v.volume || 0)
        }));
        res.json({ candles: out });
      } catch(e) { res.json({ candles: [] }); }
    });
  });
  treq.on('error', () => res.json({ candles: [] }));
  treq.end();
});

// Subscribe SSE — max 5 concurrent connections per IP
const _sseConnCount = new Map();
app.get('/subscribe/:symbol', rateLimit(60, 60000), (req, res) => {
  const ip = getClientIp(req);
  const cur = _sseConnCount.get(ip) || 0;
  if (cur >= 5) return res.status(429).json({ error:'Too many SSE connections' });
  if (!validSymbol(req.params.symbol.toUpperCase())) return res.status(400).json({ error: 'Invalid symbol' });
  _sseConnCount.set(ip, cur + 1);
  const sym = req.params.symbol.toUpperCase().replace('-', '/');
  connectTD(sym);
  ensureSymbol(sym);
  
  res.reqSource = req.query.source;
  
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  sseClients[sym].add(res);
  res.on('close', () => {
    sseClients[sym].delete(res);
    const n = (_sseConnCount.get(ip) || 1) - 1;
    if (n <= 0) _sseConnCount.delete(ip); else _sseConnCount.set(ip, n);
    /* Unsubscribe from dynamic WS3 when no users are watching this symbol */
    if (sseClients[sym].size === 0) tdWSUnsubscribe(sym);
  });
  
  const _oKey = sym.replace('/', '');
  /* OANDA: skip initial candle snapshot — frontend loads via REST /candles. Sending full oandaCandles would be several MB. */
  const initialCandles = res.reqSource === 'oanda' ? {} : (candles[sym] || {});
  res.write(`data: ${JSON.stringify({ symbol: sym, candles: initialCandles })}\n\n`);
});

// Current price endpoint
app.get('/price/:symbol', rateLimit(30, 60000), (req, res) => {
  const sym = req.params.symbol.toUpperCase().replace('-', '/');
  if (!validSymbol(sym)) return res.status(400).json({ price: 0 });
  connectTD(sym);
  ensureSymbol(sym);
  const tf = '1m';
  const arr = candles[sym][tf] || [];
  const lastCandle = arr[arr.length - 1];
  res.json({ price: lastCandle ? lastCandle.c : 0 });
});

// Symbol Search endpoint proxying TwelveData
app.get('/search', rateLimit(60, 60000), (req, res) => {
  const query = (req.query.q || '').trim();
  if (!query) return res.json({ data: [] });
  if (!TD_KEY) return res.json({ error: 'No TD_KEY configured', data: [] });

  const params = new URLSearchParams({
    symbol: query,
    outputsize: '120',
    apikey: TD_KEY
  });
  
  const reqUrl = `/symbol_search?${params.toString()}`;
  const sReq = https.request({ hostname: 'api.twelvedata.com', path: reqUrl, method: 'GET' }, sRes => {
    let data = '';
    sRes.on('data', c => { data += c; });
    sRes.on('end', () => {
      try {
        const json = JSON.parse(data);
        if (json.status !== 'ok') {
          return res.json({ data: [] });
        }
        const _blocked = new Set(['Warrant','Structured Product','Leverage Product','Certificate','Mini Future']);
        const _deduped = new Map();
        for (const r of (json.data || [])) {
          if (_blocked.has(r.instrument_type)) continue;
          if (!_deduped.has(r.symbol)) _deduped.set(r.symbol, r); // keep first (primary US exchange)
        }
        const filtered = Array.from(_deduped.values());

        /* Inject OANDA results — static catalog matching _maSymMap */
        const _oandaCatalog = [
          /* Metals / Commodities */
          { symbol:'XAUUSD',  instrument_name:'Gold / US Dollar',            instrument_type:'Commodity',         exchange:'OANDA', source:'oanda' },
          { symbol:'XAGUSD',  instrument_name:'Silver / US Dollar',          instrument_type:'Commodity',         exchange:'OANDA', source:'oanda' },
          { symbol:'OILWTI',  instrument_name:'WTI Crude Oil',               instrument_type:'Commodity',         exchange:'OANDA', source:'oanda' },
          { symbol:'OILBRNT', instrument_name:'Brent Crude Oil',             instrument_type:'Commodity',         exchange:'OANDA', source:'oanda' },
          { symbol:'NATGAS',  instrument_name:'Natural Gas',                 instrument_type:'Commodity',         exchange:'OANDA', source:'oanda' },
          { symbol:'COPPER',  instrument_name:'Copper',                      instrument_type:'Commodity',         exchange:'OANDA', source:'oanda' },
          { symbol:'PLATIN',  instrument_name:'Platinum',                    instrument_type:'Commodity',         exchange:'OANDA', source:'oanda' },
          { symbol:'PALLAD',  instrument_name:'Palladium',                   instrument_type:'Commodity',         exchange:'OANDA', source:'oanda' },
          /* Forex majors */
          { symbol:'EURUSD',  instrument_name:'Euro / US Dollar',            instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'GBPUSD',  instrument_name:'British Pound / US Dollar',   instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'USDJPY',  instrument_name:'US Dollar / Japanese Yen',    instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'USDCHF',  instrument_name:'US Dollar / Swiss Franc',     instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'AUDUSD',  instrument_name:'Australian Dollar / USD',     instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'NZDUSD',  instrument_name:'New Zealand Dollar / USD',    instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'USDCAD',  instrument_name:'US Dollar / Canadian Dollar', instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          /* Forex crosses */
          { symbol:'EURJPY',  instrument_name:'Euro / Japanese Yen',         instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'GBPJPY',  instrument_name:'British Pound / Japanese Yen',instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'EURGBP',  instrument_name:'Euro / British Pound',        instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'EURAUD',  instrument_name:'Euro / Australian Dollar',    instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'EURCAD',  instrument_name:'Euro / Canadian Dollar',      instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'EURCHF',  instrument_name:'Euro / Swiss Franc',          instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'EURNZD',  instrument_name:'Euro / New Zealand Dollar',   instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'GBPAUD',  instrument_name:'British Pound / Australian Dollar', instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'GBPCAD',  instrument_name:'British Pound / Canadian Dollar',   instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'GBPCHF',  instrument_name:'British Pound / Swiss Franc',       instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'GBPNZD',  instrument_name:'British Pound / New Zealand Dollar',instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'AUDCAD',  instrument_name:'Australian Dollar / Canadian Dollar',instrument_type:'Physical Currency',exchange:'OANDA', source:'oanda' },
          { symbol:'AUDCHF',  instrument_name:'Australian Dollar / Swiss Franc',   instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'AUDJPY',  instrument_name:'Australian Dollar / Japanese Yen',  instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'AUDNZD',  instrument_name:'Australian Dollar / New Zealand Dollar',instrument_type:'Physical Currency',exchange:'OANDA',source:'oanda'},
          { symbol:'CADCHF',  instrument_name:'Canadian Dollar / Swiss Franc',     instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'CADJPY',  instrument_name:'Canadian Dollar / Japanese Yen',    instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'CHFJPY',  instrument_name:'Swiss Franc / Japanese Yen',        instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          { symbol:'NZDJPY',  instrument_name:'New Zealand Dollar / Japanese Yen', instrument_type:'Physical Currency', exchange:'OANDA', source:'oanda' },
          /* Crypto — OANDA (broker-grade) */
          { symbol:'BTCUSDT', instrument_name:'Bitcoin / US Dollar',         instrument_type:'Digital Currency',  exchange:'OANDA',       source:'oanda' },
          { symbol:'ETHUSDT', instrument_name:'Ethereum / US Dollar',        instrument_type:'Digital Currency',  exchange:'OANDA',       source:'oanda' },
          { symbol:'SOLUSDT', instrument_name:'Solana / US Dollar',          instrument_type:'Digital Currency',  exchange:'OANDA',       source:'oanda' },
          { symbol:'ADAUSDT', instrument_name:'Cardano / US Dollar',         instrument_type:'Digital Currency',  exchange:'OANDA',       source:'oanda' },
          { symbol:'LTCUSD',  instrument_name:'Litecoin / US Dollar',        instrument_type:'Digital Currency',  exchange:'OANDA',       source:'oanda' },
          /* Forex exotic — TwelveData cached */
          { symbol:'USDBRL', instrument_name:'US Dollar / Brazilian Real', instrument_type:'Physical Currency', exchange:'TwelveData', source:'oanda' },
          /* Crypto — TwelveData cached */
          { symbol:'BNBUSDT',   instrument_name:'BNB / US Dollar',           instrument_type:'Digital Currency',  exchange:'TwelveData',  source:'oanda' },
          { symbol:'XRPUSDT',   instrument_name:'XRP / US Dollar',           instrument_type:'Digital Currency',  exchange:'TwelveData',  source:'oanda' },
          { symbol:'DOGEUSDT',  instrument_name:'Dogecoin / US Dollar',      instrument_type:'Digital Currency',  exchange:'TwelveData',  source:'oanda' },
          { symbol:'DOTUSDT',   instrument_name:'Polkadot / US Dollar',      instrument_type:'Digital Currency',  exchange:'TwelveData',  source:'oanda' },
          { symbol:'LINKUSDT',  instrument_name:'Chainlink / US Dollar',     instrument_type:'Digital Currency',  exchange:'TwelveData',  source:'oanda' },
          { symbol:'AVAXUSDT',  instrument_name:'Avalanche / US Dollar',     instrument_type:'Digital Currency',  exchange:'TwelveData',  source:'oanda' },
          { symbol:'MATICUSDT', instrument_name:'Polygon / US Dollar',       instrument_type:'Digital Currency',  exchange:'TwelveData',  source:'oanda' },
          { symbol:'ATOMUSDT',  instrument_name:'Cosmos / US Dollar',        instrument_type:'Digital Currency',  exchange:'TwelveData',  source:'oanda' },
          /* Equity CFDs */
          { symbol:'TSLA',    instrument_name:'Tesla Inc',                   instrument_type:'Common Stock',      exchange:'OANDA', source:'oanda' },
          { symbol:'NVDA',    instrument_name:'NVIDIA Corp',                 instrument_type:'Common Stock',      exchange:'OANDA', source:'oanda' },
          { symbol:'AAPL',    instrument_name:'Apple Inc',                   instrument_type:'Common Stock',      exchange:'OANDA', source:'oanda' },
          /* Indices */
          { symbol:'US500',   instrument_name:'S&P 500',                     instrument_type:'Index',             exchange:'OANDA', source:'oanda' },
          { symbol:'US30',    instrument_name:'Dow Jones 30',                instrument_type:'Index',             exchange:'OANDA', source:'oanda' },
          { symbol:'US100',   instrument_name:'NASDAQ 100',                  instrument_type:'Index',             exchange:'OANDA', source:'oanda' },
          { symbol:'DE30',    instrument_name:'Germany DAX 30',              instrument_type:'Index',             exchange:'OANDA', source:'oanda' },
          { symbol:'GB100',   instrument_name:'UK FTSE 100',                 instrument_type:'Index',             exchange:'OANDA', source:'oanda' },
          { symbol:'JP225',   instrument_name:'Japan Nikkei 225',            instrument_type:'Index',             exchange:'OANDA', source:'oanda' },
          { symbol:'AU200',   instrument_name:'Australia ASX 200',           instrument_type:'Index',             exchange:'OANDA', source:'oanda' },
          { symbol:'EU50',    instrument_name:'Euro Stoxx 50',               instrument_type:'Index',             exchange:'OANDA', source:'oanda' },
          { symbol:'FR40',    instrument_name:'France CAC 40',               instrument_type:'Index',             exchange:'OANDA', source:'oanda' },
        ];
        const q = query.toUpperCase().replace('/','');
        const oandaMatches = _oandaCatalog.filter(o => {
          const matchesQuery = o.symbol.includes(q) || o.instrument_name.toUpperCase().includes(q);
          const hasData = _maReady || (oandaCandles[o.symbol] && Object.keys(oandaCandles[o.symbol]).length > 0);
          return matchesQuery && hasData;
        });
        res.json({ data: [...oandaMatches, ...filtered] });
      } catch (e) {
        res.json({ data: [] });
      }
    });
  });
  sReq.on('error', () => res.json({ data: [] }));
  sReq.end();
});

/* ═══════════════════════════════════════════════════

   ANTHROPIC API HELPER
   ═══════════════════════════════════════════════════ */

function callAnthropic(apiKey, model, prompt, image, mediaType, maxTok, res, trackFn, _attempt) {
  _attempt = _attempt || 1;
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
        /* Overloaded: HTTP 529, or error type/message contains overload */
        const isOverload = apiRes.statusCode === 529
          || (obj.error && obj.error.type === 'overloaded_error')
          || (obj.error && obj.error.message && obj.error.message.toLowerCase().includes('overload'));
        if (isOverload) {
          const fallback = 'claude-sonnet-4-6';
          if (model !== fallback) {
            console.log(`[Anthropic] Overloaded on ${model}, falling back to ${fallback}`);
            return callAnthropic(apiKey, fallback, prompt, image, mediaType, maxTok, res, trackFn, 1);
          }
          return res.status(500).json({ error: 'Overloaded' });
        }
        if (obj.error) return res.status(500).json({ error: obj.error.message });
        const text = obj.content && obj.content[0] && obj.content[0].text ? obj.content[0].text : '';
        // Parse JSON string from AI and return the object directly so frontend render functions work
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (typeof trackFn === 'function') trackFn(text);
            return res.json(parsed);
          }
        } catch(parseErr) { /* fall through to raw text */ }
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
const candleLine = (c, i) => `${i+1}. O:${(+c.o).toFixed(2)} H:${(+c.h).toFixed(2)} L:${(+c.l).toFixed(2)} C:${(+c.c).toFixed(2)}`;

/* ═══════════════════════════════════════════════════
   AI TOOL ENDPOINTS
   ═══════════════════════════════════════════════════ */

// /analyze - General fractal analysis (fields match renderFractal in frontend)
app.post('/analyze', rateLimit(20, 60000), async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { candles, priceMin, priceMax, pair, timeframe, language: l, focus, matches, _token } = req.body;
  if (!candles || !candles.length) return res.status(400).json({ error: 'Missing candles data.' });
  let _azUserId = null;
  try { const _azR = await verifyAndDeduct(_token, 12); _azUserId = _azR.userId; } catch(e) { return res.status(402).json({ error: e.message }); }
  const candleText = candles.map(candleLine).join('\n');
  const p = `You are a fractal market analyst. Analyze this OHLCV data for ${pair||'the asset'} on ${timeframe||'auto-detected'} timeframe (${candles.length} candles, price range ${(priceMin||0).toFixed(4)} - ${(priceMax||0).toFixed(4)}). Reply in ${rl(l)}.

OHLCV DATA (candle 1 = oldest, candle ${candles.length} = most recent):
${candleText}

Respond with ONLY a valid JSON object using exactly these field names. Use REAL PRICES from the data, not normalized values:
{"pair":"str","timeframe":"str","signal":"bullish|bearish|neutral","pattern":"str","wave":"str","confidence":"high|medium|low","rr":"str e.g. 1:2.5","analysis":"3-4 sentence fractal analysis","entry":65400,"stop_loss":64200,"target_1":67800,"target_2":69500,"prediction_summary":"2 sentence forward outlook","annotations":[{"type":"hline","price":65400,"color":"#hex","label":"str","dashed":true|false},{"type":"arrow","barIndex":80,"price":65000,"dir":"up|down","color":"#hex","label":"str"},{"type":"zone","priceFrom":64000,"priceTo":65000,"color":"#hex","label":"str"},{"type":"tline","barIndex1":10,"price1":63000,"barIndex2":80,"price2":66000,"color":"#hex","label":"str"}],"predicted_path":[8-12 real price values showing forward price movement from current price],"matches":[{"date":"YYYY-MM","pair":"str","timeframe":"str","similarity":75,"pattern_name":"str","outcome":"win|loss","outcome_detail":"str","setup_description":"str","price_path":[10 floats 0-1],"after_path":[10 floats 0-1]}],"win_rate":65,"avg_rr":"1:2.1","wins":2,"losses":1}
Include 3-6 meaningful annotations at key price levels (support, resistance, entry zone, stop zone, trend lines). barIndex MUST be between 0 and ${candles.length - 1} (0=oldest candle, ${candles.length - 1}=most recent). Include 1-3 historical pattern matches.`;
  callAnthropic(k, 'claude-sonnet-4-5', p, null, null, 2500, res, (txt)=>trySavePrediction('Fractal Analysis',txt,pair,timeframe,_azUserId));
});

// /bar-pattern - Bar pattern self-similarity (fields match renderBarPattern in frontend)
app.post('/bar-pattern', rateLimit(20, 60000), async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { candles, priceMin, priceMax, pair, timeframe, language: l, _token } = req.body;
  if (!candles || !candles.length) return res.status(400).json({ error: 'Missing candles data.' });
  let _bpUserId = null;
  try { const _bpR = await verifyAndDeduct(_token, 12); _bpUserId = _bpR.userId; } catch(e) { return res.status(402).json({ error: e.message }); }
  const candleText = candles.map(candleLine).join('\n');
  const p = `You are a bar pattern self-similarity analyst. Analyze this OHLCV data for ${pair||'the asset'} on ${timeframe||'auto'} (${candles.length} candles, price range ${(priceMin||0).toFixed(4)} - ${(priceMax||0).toFixed(4)}). Reply in ${rl(l)}.

OHLCV DATA (candle 1 = oldest, candle ${candles.length} = most recent):
${candleText}

Respond with ONLY a valid JSON object using exactly these field names:
{"pair":"str","timeframe":"str","signal":"bullish|bearish|neutral","dominant_pattern":"str","confidence":"high|medium|low","self_similarity_score":0-100,"fractal_dimension":"1.2-1.9 as str","trading_implication":"str","scale_levels":[{"level":"Macro|Mid|Micro","bars":50,"pattern":"str","strength":"high|medium|low"}],"bar_clusters":[{"id":1,"name":"str","color":"#hex","similarity_pct":75,"description":"str","bar_sequence":[10 floats 0-1],"location_a":{"label":"Earlier","x1":0.1,"x2":0.35},"location_b":{"label":"Current","x1":0.6,"x2":0.9}}]}
Include 2-3 bar clusters showing self-similar patterns found at different locations in the data. location x1/x2 values (0-1) refer to relative position in the ${candles.length}-candle array (0=oldest, 1=newest).`;
  callAnthropic(k, 'claude-sonnet-4-5', p, null, null, 1800, res, (txt)=>trySavePrediction('Bar Pattern',txt,pair,timeframe,_bpUserId));
});

// /weierstrass - Weierstrass decomposition (fields match renderWeierstrass in frontend)
app.post('/weierstrass', rateLimit(20, 60000), async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { candles, priceMin, priceMax, pair, timeframe, language: l, _token } = req.body;
  if (!candles || !candles.length) return res.status(400).json({ error: 'Missing candles data.' });
  try { await verifyAndDeduct(_token, 12); } catch(e) { return res.status(402).json({ error: e.message }); }
  const candleText = candles.map(candleLine).join('\n');
  const p = `You are a Weierstrass fractal decomposition analyst. Analyze this OHLCV data for ${pair||'the asset'} on ${timeframe||'auto'} (${candles.length} candles, price range ${(priceMin||0).toFixed(4)} - ${(priceMax||0).toFixed(4)}). Reply in ${rl(l)}.

OHLCV DATA (candle 1 = oldest, candle ${candles.length} = most recent):
${candleText}

Respond with ONLY a valid JSON object, no markdown, no explanation. Use exactly these fields: {"pair":"str","timeframe":"str","hurst_exponent":"0.55","fractal_dimension":"1.45","roughness_index":"0.62","market_regime":"trending|mean-reverting|random-walk","scale_invariance":{"confirmed":true,"ratio":"1:3.2"},"decomposition":{"trend":{"direction":"bullish|bearish|neutral","strength":"high|medium|low","description":"str"},"cycle":{"phase":"accumulation|expansion|distribution|contraction","period_bars":20,"amplitude":"str","description":"str"},"fractal_noise":{"color":"red|pink|white|blue","weierstrass_a":0.72,"weierstrass_b":3.1,"description":"str"}},"weierstrass_fit":{"score":78,"quality":"good|fair|poor","dominant_frequency":"str","harmonics":[0.8,0.6,0.4,0.25,0.15,0.08,0.04,0.02],"weierstrass_a":0.72,"weierstrass_b":3.1,"description":"str"},"noise_signal":{"edge":"bullish|bearish|neutral","confidence":"high|medium|low","interpretation":"2 sentence trading interpretation"}}`;
  callAnthropic(k, 'claude-sonnet-4-5', p, null, null, 2000, res, null);
});

// /mtf (MTF Confluence)
app.post('/mtf', rateLimit(20, 60000), async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { candles, priceMin, priceMax, pair, timeframe, language: l, _token } = req.body;
  if (!candles || !candles.length) return res.status(400).json({ error: 'Missing candles data.' });
  let _mtfUserId = null;
  try { const _mtfR = await verifyAndDeduct(_token, 20); _mtfUserId = _mtfR.userId; } catch(e) { return res.status(402).json({ error: e.message }); }
  const candleText = candles.map(candleLine).join('\n');
  const p = `You are an MTF (Multi-Timeframe) confluence analyst. Analyze this OHLCV data for ${pair||'the asset'} on ${timeframe||'auto'} (${candles.length} candles, price range ${(priceMin||0).toFixed(4)} - ${(priceMax||0).toFixed(4)}). Reply in ${rl(l)}.

OHLCV DATA (candle 1 = oldest, candle ${candles.length} = most recent):
${candleText}

Respond with ONLY a valid JSON object, no markdown. Use exactly these fields:
{"pair":"str","timeframe":"str","signal":"bullish|bearish|neutral","confluence_score":72,"analysis":"3 sentence MTF confluence analysis","timeframes":[{"tf":"Weekly","bias":"bullish|bearish|neutral","fractal_phase":"str e.g. Impulse wave 3","path":[0.7,0.65,0.55,0.48,0.42,0.38,0.35,0.38,0.42,0.4]},{"tf":"Daily","bias":"bullish|bearish|neutral","fractal_phase":"str","path":[0.55,0.52,0.48,0.45,0.43,0.42,0.44,0.46,0.43,0.41]},{"tf":"H4","bias":"bullish|bearish|neutral","fractal_phase":"str","path":[0.48,0.46,0.44,0.43,0.42,0.41,0.42,0.43,0.41,0.4]}],"confluence_zones":[{"label":"Key Support","price":2040,"color":"#27ae60","strength":"strong","timeframes_aligned":["Weekly","Daily"]},{"label":"Resistance","price":2200,"color":"#e74c3c","strength":"medium","timeframes_aligned":["Daily","H4"]}]}
path arrays must have exactly 10 floats (0=top, 1=bottom) — these are shape indicators not price values. confluence_zones price must be a real number from the data.`;
  callAnthropic(k, 'claude-opus-4-5', p, null, null, 2000, res, (txt)=>trySavePrediction('MTF Confluence',txt,pair,timeframe,_mtfUserId));
});

// /fractal-age
app.post('/fractal-age', rateLimit(20, 60000), async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { candles, priceMin, priceMax, pair, timeframe, language: l, _token } = req.body;
  if (!candles || !candles.length) return res.status(400).json({ error: 'Missing candles data.' });
  let _ageUserId = null;
  try { const _ageR = await verifyAndDeduct(_token, 15); _ageUserId = _ageR.userId; } catch(e) { return res.status(402).json({ error: e.message }); }
  const candleText = candles.map(candleLine).join('\n');
  const p = `You are a fractal cycle age analyst. Analyze this OHLCV data for ${pair||'the asset'} on ${timeframe||'auto'} (${candles.length} candles, price range ${(priceMin||0).toFixed(4)} - ${(priceMax||0).toFixed(4)}). Reply in ${rl(l)}.

OHLCV DATA (candle 1 = oldest, candle ${candles.length} = most recent):
${candleText}

Respond with ONLY a valid JSON object, no markdown. Use exactly these fields:
{"pair":"str","timeframe":"str","urgency":"critical|high|medium|low","analysis":"3 sentence fractal age analysis","fractal_age":{"completion_pct":67,"phase":"young|developing|mature|exhausted","bars_elapsed":45,"bars_estimated_total":70},"cycle_position":{"position":"early|mid|late","cycle_path":[0.5,0.48,0.45,0.42,0.4,0.38,0.37,0.36,0.37,0.38,0.4,0.42,0.44,0.46,0.45,0.44,0.43,0.42,0.41,0.4]},"time_projections":[{"scenario":"Base — Continuation","probability":0.55,"direction":"bullish|bearish","bars_to_resolution":18,"target_price":2200},{"scenario":"Reversal","probability":0.30,"direction":"bearish|bullish","bars_to_resolution":8,"target_price":2012},{"scenario":"Extended","probability":0.15,"direction":"bullish|bearish","bars_to_resolution":35,"target_price":2350}]}
cycle_path must have 20 floats (0=top, 1=bottom) — shape indicator only. target_price must be a real number from the data.`;
  callAnthropic(k, 'claude-opus-4-5', p, null, null, 2000, res, (txt)=>trySavePrediction('Fractal Age',txt,pair,timeframe,_ageUserId));
});

// /projection - WITH PREDICTION TRACKING
app.post('/projection', rateLimit(20, 60000), async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { candles, priceMin, priceMax, pair, timeframe, language: l, _token } = req.body;
  if (!candles || !candles.length) return res.status(400).json({ error: 'Missing candles data.' });

  let userId = null;
  try {
    const verifyResult = await verifyAndDeduct(_token, 25);
    userId = verifyResult.userId;
  } catch(e) {
    return res.status(402).json({ error: e.message });
  }

  const candleText = candles.map(candleLine).join('\n');
  const lastClose = candles[candles.length - 1].c;
  const p = `You are a price projection analyst. Analyze this OHLCV data for ${pair||'asset'} on ${timeframe||'auto'} (${candles.length} candles, price range ${(priceMin||0).toFixed(4)} - ${(priceMax||0).toFixed(4)}, current price: ${lastClose}). 3 forward scenarios. Reply in ${rl(l)}.

OHLCV DATA (candle 1 = oldest, candle ${candles.length} = most recent):
${candleText}

JSON only. All prices must be real numbers from the data:
{"pair":"str","timeframe":"str","current_price":${lastClose},"signal":"bullish|bearish|neutral","confidence":"high|medium|low","fractal_basis":"1 sentence","scenarios":[{"label":"Base Case","probability":0.55,"direction":"bullish|bearish","color":"#27ae60","bars":30,"target_price":2200,"path":[30 real price values],"invalidation_price":2012},{"label":"Bear Case","probability":0.30,"direction":"bearish","color":"#e74c3c","bars":20,"target_price":1950,"path":[20 real price values],"invalidation_price":2150},{"label":"Extended","probability":0.15,"direction":"bullish","color":"#9b8fe8","bars":40,"target_price":2400,"path":[40 real price values],"invalidation_price":2012}],"analysis":"4 sentences","entry_zone":{"price_from":2090,"price_to":2110},"stop_loss":{"price":2012},"chart_context":{"trend":"uptrend|downtrend|sideways","last_pattern":"str","wave_position":"str"}}
path arrays must start near current price (${lastClose}) and project forward as real prices. barIndex 0=${candles.length-1} (most recent candle).`;

  callAnthropic(k, 'claude-opus-4-5', p, null, null, 3000, res, async (txt) => {
    try {
      const jsonMatch = txt.match(/\{[\s\S]*\}/);
      if (!jsonMatch || !userId) return;
      const parsed = JSON.parse(jsonMatch[0]);
      if (!parsed.current_price || !parsed.scenarios || !parsed.scenarios[0]) return;
      const currentPrice = parseFloat(parsed.current_price);
      const targetPrice  = parseFloat(parsed.scenarios[0].target_price);
      const bars = parseInt(parsed.scenarios[0].bars) || 30;
      let targetDays = 3;
      if (timeframe && timeframe.includes('h')) targetDays = Math.ceil((bars * parseInt(timeframe)) / 24);
      else if (timeframe && timeframe.includes('d')) targetDays = bars;
      else if (timeframe && timeframe.includes('m')) targetDays = Math.ceil(bars / (24 * 60));
      if (currentPrice && targetPrice && !isNaN(currentPrice) && !isNaN(targetPrice)) {
        await savePrediction({ userId, toolName:'Price Path Projection', asset:pair||'UNKNOWN', timeframe:timeframe||'1D',
          currentPrice, predictedPrice:targetPrice, targetDays:Math.max(1,Math.min(targetDays,30)), fullResponse:txt });
      }
    } catch(e) { console.error('[Prediction] Save error (non-fatal):', e.message); }
  });
});

/* ═══════════════════════════════════════════════════
   MISSING TOOL ENDPOINTS — Fibonacci, SMC, Volatility, Liquidity, Journal
   ═══════════════════════════════════════════════════ */

// /fibonacci - Fibonacci retracements & extensions (fields match renderFibonacci)
app.post('/fibonacci', rateLimit(20, 60000), async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { candles, priceMin, priceMax, pair, timeframe, language: l, _token } = req.body;
  if (!candles || !candles.length) return res.status(400).json({ error: 'Missing candles data.' });
  let _fibUserId = null;
  try { const _fibR = await verifyAndDeduct(_token, 12); _fibUserId = _fibR.userId; } catch(e) { return res.status(402).json({ error: e.message }); }
  const candleText = candles.map(candleLine).join('\n');
  const p = `You are a Fibonacci analysis expert. Analyze this OHLCV data for ${pair||'the asset'} on ${timeframe||'auto'} (${candles.length} candles, price range ${(priceMin||0).toFixed(4)} - ${(priceMax||0).toFixed(4)}). Reply in ${rl(l)}.

OHLCV DATA (candle 1 = oldest, candle ${candles.length} = most recent):
${candleText}

Respond with ONLY a valid JSON object, no markdown. All price fields must be real numbers from the data:
{"pair":"str","timeframe":"str","signal":"bullish|bearish|neutral","trend":"uptrend|downtrend|sideways","confidence":"high|medium|low","analysis":"3 sentence Fibonacci analysis","swing_high":{"price":2124,"barIndex":143},"swing_low":{"price":1938,"barIndex":241},"key_level":{"level":"0.618","price":2010,"reason":"strongest confluence level"},"retracements":[{"level":"0.236","price":2080,"color":"#3498db","strength":"weak|medium|strong"},{"level":"0.382","price":2053,"color":"#9b8fe8","strength":"medium"},{"level":"0.5","price":2031,"color":"#c9a84c","strength":"strong"},{"level":"0.618","price":2009,"color":"#e67e22","strength":"strong"},{"level":"0.786","price":1983,"color":"#e74c3c","strength":"medium"}],"extensions":[{"level":"1.272","price":2220,"color":"#2ecc71","strength":"medium"},{"level":"1.618","price":2286,"color":"#27ae60","strength":"strong"}]}
barIndex must be between 0 and ${candles.length - 1}.`;
  callAnthropic(k, 'claude-sonnet-4-5', p, null, null, 2000, res, (txt)=>trySavePrediction('Fibonacci',txt,pair,timeframe,_fibUserId));
});

// /smc - Smart Money Concepts (fields match renderSMC)
app.post('/smc', rateLimit(20, 60000), async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { candles, priceMin, priceMax, pair, timeframe, language: l, _token } = req.body;
  if (!candles || !candles.length) return res.status(400).json({ error: 'Missing candles data.' });
  let _smcUserId = null;
  try { const _smcR = await verifyAndDeduct(_token, 16); _smcUserId = _smcR.userId; } catch(e) { return res.status(402).json({ error: e.message }); }
  const candleText = candles.map(candleLine).join('\n');
  const p = `You are a Smart Money Concepts analyst. Analyze this OHLCV data for ${pair||'the asset'} on ${timeframe||'auto'} (${candles.length} candles, price range ${(priceMin||0).toFixed(4)} - ${(priceMax||0).toFixed(4)}). Reply in ${rl(l)}.

OHLCV DATA (candle 1 = oldest, candle ${candles.length} = most recent):
${candleText}

Respond with ONLY a valid JSON object, no markdown. Use real prices for all price fields, barIndex between 0 and ${candles.length-1}:
{"pair":"str","timeframe":"str","signal":"bullish|bearish|neutral","market_structure":"bullish|bearish|ranging","bias":"bullish|bearish|neutral","analysis":"3 sentence SMC analysis","premium_discount":{"current_zone":"premium|discount|equilibrium","equilibrium_price":2060},"last_bos":{"type":"BOS|CHoCH","direction":"bullish|bearish","barIndex":210,"price":2070},"order_blocks":[{"type":"bullish","barIndex1":180,"barIndex2":195,"priceFrom":2040,"priceTo":2065,"color":"#27ae60","label":"Bullish OB"},{"type":"bearish","barIndex1":130,"barIndex2":145,"priceFrom":2100,"priceTo":2124,"color":"#e74c3c","label":"Bearish OB"}],"fvg":[{"barIndex1":220,"barIndex2":230,"priceFrom":2075,"priceTo":2090,"color":"#3498db","filled":false}],"poi":{"label":"POI","barIndex1":180,"barIndex2":210,"priceFrom":2040,"priceTo":2070},"entry_model":{"trigger":"str","entry":2095,"sl":2012,"tp1":2200,"tp2":2300,"rr":"1:2.5"}}`;
  callAnthropic(k, 'claude-sonnet-4-5', p, null, null, 2000, res, (txt)=>trySavePrediction('Smart Money',txt,pair,timeframe,_smcUserId));
});

// /volatility - Volatility regime & position sizing (fields match renderVolatility)
app.post('/volatility', rateLimit(20, 60000), async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { candles, priceMin, priceMax, pair, timeframe, language: l, account_size, risk_pct, _token } = req.body;
  if (!candles || !candles.length) return res.status(400).json({ error: 'Missing candles data.' });
  try { await verifyAndDeduct(_token, 12); } catch(e) { return res.status(402).json({ error: e.message }); }
  const acct = account_size || 10000;
  const riskP = risk_pct || 1;
  const candleText = candles.map(candleLine).join('\n');
  const p = `You are a volatility regime analyst. Analyze this OHLCV data for ${pair||'the asset'} on ${timeframe||'auto'} (${candles.length} candles, price range ${(priceMin||0).toFixed(4)} - ${(priceMax||0).toFixed(4)}). Account size: $${acct}, Risk: ${riskP}%. Reply in ${rl(l)}.

OHLCV DATA (candle 1 = oldest, candle ${candles.length} = most recent):
${candleText}

Respond with ONLY a valid JSON object, no markdown. Use exactly these fields:
{"pair":"str","timeframe":"str","regime":"low|medium|high|extreme","regime_score":55,"analysis":"3 sentence volatility analysis","regime_characteristics":{"mean_reversion_probability":0.65,"trend_continuation_probability":0.35,"expected_daily_range":"str e.g. 1.8%","breakout_likelihood":"low|medium|high"},"position_sizing":{"max_position_size":"str e.g. 2.3 units","risk_amount":${(acct * riskP / 100).toFixed(2)},"leverage_warning":"str advice"},"strategy_adaptation":{"recommended_approach":"str e.g. Reduce size, widen stops"}}`;
  callAnthropic(k, 'claude-sonnet-4-5', p, null, null, 1500, res);
});

// /liquidity - Liquidity map & stop hunt targets (fields match renderLiquidity)
app.post('/liquidity', rateLimit(20, 60000), async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { candles, priceMin, priceMax, pair, timeframe, language: l, _token } = req.body;
  if (!candles || !candles.length) return res.status(400).json({ error: 'Missing candles data.' });
  let _liqUserId = null;
  try { const _liqR = await verifyAndDeduct(_token, 20); _liqUserId = _liqR.userId; } catch(e) { return res.status(402).json({ error: e.message }); }
  const candleText = candles.map(candleLine).join('\n');
  const p = `You are a liquidity mapping analyst. Analyze this OHLCV data for ${pair||'the asset'} on ${timeframe||'auto'} (${candles.length} candles, price range ${(priceMin||0).toFixed(4)} - ${(priceMax||0).toFixed(4)}). Reply in ${rl(l)}.

OHLCV DATA (candle 1 = oldest, candle ${candles.length} = most recent):
${candleText}

Respond with ONLY a valid JSON object, no markdown. All price fields must be real numbers from the data:
{"pair":"str","timeframe":"str","smart_money_direction":"bullish|bearish|neutral","analysis":"3 sentence liquidity analysis","liquidity_imbalance":{"buy_side_weight":0.65,"sell_side_weight":0.35},"liquidity_pools":[{"label":"Equal Highs","price":2124,"barIndex":143,"color":"#e74c3c","swept":false},{"label":"BSL","price":2096,"barIndex":200,"color":"#e74c3c","swept":false},{"label":"SSL","price":1984,"barIndex":241,"color":"#27ae60","swept":false}],"stop_clusters":[{"price":2130,"color":"rgba(231,76,60,0.18)","size":"large|medium|small"},{"price":1980,"color":"rgba(39,174,96,0.18)","size":"medium"}],"hunt_targets":[{"label":"Target 1","price":2150,"direction":"up","bars_estimate":"8-12","probability":"65%"},{"label":"Target 2","price":1960,"direction":"down","bars_estimate":"15-20","probability":"35%"}]}
barIndex must be between 0 and ${candles.length - 1}.`;
  callAnthropic(k, 'claude-opus-4-5', p, null, null, 2000, res, (txt)=>trySavePrediction('Liquidity Map',txt,pair,timeframe,_liqUserId));
});

// /journal - AI Trade Journal grader (fields match renderJournal)
app.post('/journal', rateLimit(20, 60000), async (req, res) => {
  const k = process.env.ANTHROPIC_API_KEY;
  if (!k) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set.' });
  const { candles, priceMin, priceMax, pair, timeframe, language: l, trade_notes, outcome, pnl, _token } = req.body;
  if (!candles || !candles.length) return res.status(400).json({ error: 'Missing candles data.' });
  try { await verifyAndDeduct(_token, 20); } catch(e) { return res.status(402).json({ error: e.message }); }
  const candleText = candles.map(candleLine).join('\n');
  const context = [trade_notes&&`Notes: ${trade_notes}`, outcome&&`Outcome: ${outcome}`, pnl&&`P&L: ${pnl}`].filter(Boolean).join('. ');
  const p = `You are an expert trading coach grading a trade. Asset: ${pair||'asset'} ${timeframe||'auto'} (${candles.length} candles, price range ${(priceMin||0).toFixed(4)} - ${(priceMax||0).toFixed(4)}). ${context}. Reply in ${rl(l)}.

OHLCV DATA (candle 1 = oldest, candle ${candles.length} = most recent):
${candleText}

Respond with ONLY a valid JSON object, no markdown. Use exactly these fields:
{"pair":"str","timeframe":"str","overall_grade":"A|B|C|D|F","key_lesson":"one most important lesson from this trade","coach_message":"2-3 sentence personal coaching message from the AI coach","categories":{"entry_timing":{"score":75,"improvement":"str specific improvement tip"},"risk_management":{"score":80,"improvement":"str"},"trade_management":{"score":60,"improvement":"str"},"psychology":{"score":70,"improvement":"str"},"setup_quality":{"score":85,"improvement":"str"}}}`;
  callAnthropic(k, 'claude-sonnet-4-5', p, null, null, 1500, res);
});

/* ── Sniper pip/RR math helpers ── */
const { sniperSignal: algoSniperSignal, checkSignalOutcome } = require('./sniper-engine');
const { runBacktest } = require('./backtest-engine');

/* ── CONDITION WEIGHT FEEDBACK LOOP ──
   After each outcome check, win rates are aggregated by context bucket.
   applyConditionWeight() adjusts confidence up/down based on how this
   exact condition has historically performed on this platform's signals. */

let conditionWeights = {};
let conditionWeightsRecent = {};  // Fast window (recent signals only)
const CW_MIN_SAMPLE  = 10; // min resolved signals to trust a baseline bucket
const CW_RECENT_MIN  = 5;  // lower threshold for recent window
const CW_RECENT_DAYS = 14; // fast pulse window = last 14 days
const CW_DEVIATION   = 0.10; // 10pp deviation triggers pulse adjustment

async function refreshConditionWeights() {
  if (!sbAdmin) return;
  try {
    const { data, error } = await sbAdmin
      .from('sniper_signals')
      .select('ctx_trend, ctx_session, ctx_volatility, setup_type, direction, pair, outcome, source, created_at')
      .in('outcome', ['tp1_hit', 'tp2_hit', 'sl_hit']);
    if (error || !data || data.length === 0) return;

    const recentCutoff = Date.now() - CW_RECENT_DAYS * 24 * 3600 * 1000;
    const buckets = {};
    const recentBuckets = {};
    const bump = (store, key, win) => {
      if (!key || key.includes('null') || key.includes('undefined')) return;
      if (!store[key]) store[key] = { wins: 0, total: 0 };
      store[key].total++;
      if (win) store[key].wins++;
    };

    for (const s of data) {
      const win = s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit';
      const { ctx_trend: t, ctx_session: se, ctx_volatility: v, setup_type: st, direction: d, pair: p, source: src } = s;
      /* Extract data source label from source field (scanner_oanda → oanda, scanner_td_forex → td_forex) */
      const ds = src ? src.replace('scanner_', '') : null;
      const isRecent = new Date(s.created_at).getTime() >= recentCutoff;

      const keys = [
        `${t}|${se}|${v}|${st}`, `${t}|${se}|${st}`, `${se}|${st}`, `${t}|${st}`, se, d, p,
      ];
      if (ds) keys.push(ds);

      for (const k of keys) {
        bump(buckets, k, win);
        if (isRecent) bump(recentBuckets, k, win);
      }
    }

    for (const store of [buckets, recentBuckets]) {
      for (const key of Object.keys(store)) {
        const b = store[key];
        b.win_rate = b.total > 0 ? +(b.wins / b.total).toFixed(3) : 0;
      }
    }

    conditionWeights = buckets;
    conditionWeightsRecent = recentBuckets;
    console.log(`[ConditionWeights] Refreshed: ${Object.keys(buckets).length} baseline + ${Object.keys(recentBuckets).length} recent buckets from ${data.length} resolved signals`);
  } catch(e) {
    console.error('[ConditionWeights] Refresh error:', e.message);
  }
}

function _cwAdj(wr) {
  if (wr >= 0.60) return +10;
  if (wr >= 0.50) return  +5;
  if (wr >= 0.40) return   0;
  if (wr >= 0.30) return  -5;
  return                  -10;
}

function applyConditionWeight(sig) {
  if (!sig || Object.keys(conditionWeights).length === 0) return sig;
  const { ctx_trend: t, ctx_session: se, ctx_volatility: v, setup_type: st, direction: d, pair: p } = sig;
  const keys = [
    `${t}|${se}|${v}|${st}`, `${t}|${se}|${st}`, `${se}|${st}`, `${t}|${st}`, se, d, p
  ].filter(k => k && !k.includes('null') && !k.includes('undefined'));

  for (const key of keys) {
    const b = conditionWeights[key];
    if (!b || b.total < CW_MIN_SAMPLE) continue;
    let adj = _cwAdj(b.win_rate);

    // Dual-window pulse: if recent window deviates significantly from baseline,
    // apply a capped secondary adjustment (±5 max) to catch regime shifts
    const recent = conditionWeightsRecent[key];
    if (recent && recent.total >= CW_RECENT_MIN) {
      const deviation = recent.win_rate - b.win_rate;
      if (Math.abs(deviation) >= CW_DEVIATION) {
        const pulseAdj = Math.max(-5, Math.min(5, Math.round(deviation * 20)));
        adj += pulseAdj;
        sig.condition_pulse = {
          recent_wr: +(recent.win_rate * 100).toFixed(1),
          baseline_wr: +(b.win_rate * 100).toFixed(1),
          deviation_pp: +(deviation * 100).toFixed(1),
          pulse_adj: pulseAdj,
          recent_n: recent.total,
        };
      }
    }

    sig.confidence = Math.min(95, Math.max(15, sig.confidence + adj));
    sig.condition_edge = { key, win_rate: +(b.win_rate * 100).toFixed(1), sample: b.total, adj };
    return sig;
  }
  return sig;
}

function getPipSize(price, pair) {
  const p = (pair || '').toUpperCase();
  if (p.includes('JPY')) return 0.01;
  if (p === 'XAUUSD' || p === 'GOLD') return 0.1;
  if (/^(US30|NAS100|SPX500|UK100|GER40)/.test(p)) return 1.0;
  if (/^(EUR|GBP|AUD|NZD|USD|CAD|CHF)/.test(p) && p.length === 6) return 0.0001;
  if (price >= 1000)  return 1.0;
  if (price >= 100)   return 0.1;
  if (price >= 10)    return 0.01;
  if (price >= 1)     return 0.001;
  if (price >= 0.01)  return 0.0001;
  return 0.000001;
}

function calcSniperMath(sig) {
  const entry = parseFloat(sig.entry) || 0;
  const sl    = parseFloat(sig.sl)    || 0;
  const tp1   = parseFloat(sig.tp1)   || 0;
  const tp2   = parseFloat(sig.tp2)   || 0;
  if (!entry) return sig;
  const pipSize  = getPipSize(entry, sig.pair);
  const slPips   = Math.round(Math.abs(entry - sl)  / pipSize);
  const tp1Pips  = Math.round(Math.abs(tp1 - entry) / pipSize);
  const tp2Pips  = Math.round(Math.abs(tp2 - entry) / pipSize);
  const rr1      = slPips > 0 ? (tp1Pips / slPips).toFixed(2) : '—';
  const rr2      = slPips > 0 ? (tp2Pips / slPips).toFixed(2) : '—';
  const slPct    = entry > 0 ? ((Math.abs(entry - sl)  / entry) * 100).toFixed(2) : '—';
  const tp1Pct   = entry > 0 ? ((Math.abs(tp1 - entry) / entry) * 100).toFixed(2) : '—';
  const tp2Pct   = entry > 0 ? ((Math.abs(tp2 - entry) / entry) * 100).toFixed(2) : '—';
  return Object.assign({}, sig, {
    sl_pips: slPips, tp1_pips: tp1Pips, tp2_pips: tp2Pips,
    rr1: '1:' + rr1, rr2: '1:' + rr2,
    sl_pct: slPct, tp1_pct: tp1Pct, tp2_pct: tp2Pct
  });
}

function validateSniper(sig, lastClose, priceMin, priceMax) {
  const long = (sig.direction || '').toLowerCase() === 'long';
  /* Directional ordering */
  if (long  && sig.sl  >= sig.entry) return 'SL must be below entry for long';
  if (!long && sig.sl  <= sig.entry) return 'SL must be above entry for short';
  if (long  && sig.tp1 <= sig.entry) return 'TP1 must be above entry for long';
  if (!long && sig.tp1 >= sig.entry) return 'TP1 must be below entry for short';
  if (long  && sig.tp2 <= sig.tp1)   return 'TP2 must be above TP1 for long';
  if (!long && sig.tp2 >= sig.tp1)   return 'TP2 must be below TP1 for short';
  /* Entry near last close (within 2%) */
  if (lastClose > 0) {
    const entryDrift = Math.abs(sig.entry - lastClose) / lastClose;
    if (entryDrift > 0.02) return 'Entry too far from last close (' + (entryDrift * 100).toFixed(1) + '%)';
  }
  /* Minimum RR enforcement — aligned with engine floors (1.5:1 TP1, 2.5:1 TP2)
     Uses slightly lower thresholds (1.4 / 2.4) for float-rounding tolerance */
  const slDist  = Math.abs(sig.entry - sig.sl);
  const tp1Dist = Math.abs(sig.tp1 - sig.entry);
  const tp2Dist = Math.abs(sig.tp2 - sig.entry);
  if (slDist > 0) {
    if (tp1Dist / slDist < 1.4) return 'TP1 RR below 1:1.5';
    if (tp2Dist / slDist < 2.4) return 'TP2 RR below 1:2.5';
  }
  /* Price range check — entry must be within candle range (SL exempt: ATR buffer extends beyond lows by design) */
  if (priceMin > 0 && priceMax > 0) {
    const margin = (priceMax - priceMin) * 0.1;
    const rLow = priceMin - margin, rHigh = priceMax + margin;
    if (sig.entry < rLow || sig.entry > rHigh) return 'Entry outside data range';
  }
  return null; /* null = valid */
}

// /sniper - Algorithmic trade signal (pure math, no AI API call)
app.post('/sniper', rateLimit(20, 60000), async (req, res) => {
  const { candles, priceMin, priceMax, pair, timeframe, _token } = req.body;
  if (!candles || !candles.length) return res.status(400).json({ error: 'Missing candles data.' });
  if (candles.length < 12) return res.status(400).json({ error: 'Need at least 12 candles.' });
  let _snipUserId = null;
  try { const _snipR = await verifyAndDeduct(_token, 5); _snipUserId = _snipR.userId; } catch(e) { return res.status(402).json({ error: e.message }); }

  try {
    /* ── Run the algorithmic engine ── */
    const raw = algoSniperSignal(candles, pair, timeframe);
    if (raw.error) return res.status(500).json({ error: raw.error });

    /* ── Validate — use full candle history for price range, not the visible window sent by frontend ── */
    const lastClose = +candles[candles.length - 1].c;
    let fullMin = Infinity, fullMax = -Infinity;
    for (const c of candles) { const l = +c.l, h = +c.h; if (l < fullMin) fullMin = l; if (h > fullMax) fullMax = h; }
    const validationErr = validateSniper(raw, lastClose, fullMin, fullMax);
    if (validationErr) {
      console.warn('[Sniper] Validation failed:', validationErr);
      return res.status(500).json({ error: 'Signal validation failed: ' + validationErr });
    }

    /* ── Add pip math + condition feedback adjustment ── */
    const sig = applyConditionWeight(calcSniperMath(raw));
    res.json(sig);

    /* ── Save to DB with context tags (async) ── */
    if (_snipUserId && sbAdmin) {
      sbAdmin.from('sniper_signals').insert({
        user_id: _snipUserId,
        pair: sig.pair || pair, timeframe: sig.timeframe || timeframe,
        direction: sig.direction, entry: sig.entry, sl: sig.sl, tp1: sig.tp1, tp2: sig.tp2,
        sl_pips: sig.sl_pips, tp1_pips: sig.tp1_pips, tp2_pips: sig.tp2_pips,
        rr1: sig.rr1, rr2: sig.rr2, sl_pct: sig.sl_pct, tp1_pct: sig.tp1_pct, tp2_pct: sig.tp2_pct,
        confidence: sig.confidence, reasoning: sig.reasoning, outcome: 'pending',
        setup_type: sig.setup_type || null,
        ctx_trend: sig.ctx_trend || null,
        ctx_session: sig.ctx_session || null,
        ctx_volatility: sig.ctx_volatility || null,
        source: 'user',
      }).then(({ error: dbErr }) => { if (dbErr) console.error('[Sniper DB]', dbErr.message); });
    }
  } catch(e) {
    console.error('[Sniper] Engine error:', e);
    res.status(500).json({ error: 'Signal engine error' });
  }
});

// /backtest - Walk-forward backtest using the sniper engine (no AI, pure math)
app.post('/backtest', rateLimit(5, 60000), async (req, res) => {
  const { candles, options, _token } = req.body;
  if (!candles || candles.length < 170) {
    return res.status(400).json({ error: 'Need at least 170 candles for backtest.' });
  }
  try {
    await verifyAndDeduct(_token, 40);
  } catch(e) {
    return res.status(402).json({ error: e.message });
  }
  try {
    const result = runBacktest(candles, options || {});
    if (result.error) return res.status(400).json({ error: result.error });
    res.json(result);
  } catch(e) {
    console.error('[Backtest] Engine error:', e);
    res.status(500).json({ error: 'Backtest engine error' });
  }
});

/* ═══════════════════════════════════════════════════
   SNIPER OUTCOME TRACKER
   Checks pending signals against OANDA cached candles
   to determine if TP1/TP2/SL was hit.
   ═══════════════════════════════════════════════════ */

const SNIPER_EXPIRY_DAYS = 7;

async function checkSniperOutcomes() {
  if (!sbAdmin) return;
  console.log('🎯 [Sniper Check] Starting outcome check...');

  const { data: pending, error: fetchErr } = await sbAdmin
    .from('sniper_signals')
    .select('*')
    .eq('outcome', 'pending')
    .order('created_at', { ascending: true })
    .limit(200);

  if (fetchErr) { console.error('[Sniper Check] Fetch error:', fetchErr); return; }
  if (!pending || pending.length === 0) { console.log('✅ [Sniper Check] No pending signals.'); return; }

  console.log(`📊 [Sniper Check] Checking ${pending.length} pending signals...`);
  let resolved = 0, expired = 0, skipped = 0, errors = 0;

  for (const sig of pending) {
    try {
      const sym = (sig.pair || '').toUpperCase().replace('/', '');
      const sigTime = new Date(sig.created_at).getTime();
      const ageDays = (Date.now() - sigTime) / (24 * 3600 * 1000);

      // Try to find candle data from OANDA cache
      let afterCandles = null;
      const tfKey = sig.timeframe || '1h';
      // Try exact timeframe, then fallback to 1h, then 15m
      for (const tryTf of [tfKey, '1h', '15m', '5m']) {
        const cached = oandaCandles[sym] && oandaCandles[sym][tryTf];
        if (cached && cached.length > 0) {
          afterCandles = cached.filter(c => c.t > sigTime);
          if (afterCandles.length > 0) break;
        }
      }

      if (!afterCandles || afterCandles.length === 0) {
        // Expire if too old and no data
        if (ageDays > SNIPER_EXPIRY_DAYS) {
          await sbAdmin.from('sniper_signals').update({
            outcome: 'expired', checked_at: new Date().toISOString()
          }).eq('id', sig.id);
          expired++;
        } else { skipped++; }
        continue;
      }

      // Check outcome using the engine
      const result = checkSignalOutcome(sig, afterCandles);

      if (result) {
        await sbAdmin.from('sniper_signals').update({
          outcome: result.outcome,
          actual_price: result.actual_price,
          bars_to_outcome: result.bars,
          checked_at: new Date().toISOString()
        }).eq('id', sig.id);
        resolved++;
        console.log(`  ✅ ${sym} ${sig.direction}: ${result.outcome} after ${result.bars} bars`);
      } else if (ageDays > SNIPER_EXPIRY_DAYS) {
        // Expired: no TP or SL hit within expiry window
        const lastPrice = afterCandles[afterCandles.length - 1].c;
        await sbAdmin.from('sniper_signals').update({
          outcome: 'expired', actual_price: lastPrice,
          bars_to_outcome: afterCandles.length,
          checked_at: new Date().toISOString()
        }).eq('id', sig.id);
        expired++;
      } else { skipped++; }

      // Rate limit DB calls
      await new Promise(r => setTimeout(r, 100));
    } catch(e) {
      console.error(`  ❌ [Sniper Check] Error for signal ${sig.id}:`, e.message);
      errors++;
    }
  }

  console.log(`🎯 [Sniper Check] Done: ${resolved} resolved, ${expired} expired, ${skipped} still pending, ${errors} errors`);
  if (resolved > 0 || expired > 0) refreshConditionWeights();
}

/* ── Manual trigger for sniper outcome check ── */
app.post('/api/sniper/check-now', requireAdmin, async (req, res) => {
  try {
    await checkSniperOutcomes();
    res.json({ success: true, message: 'Sniper outcome check completed' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Purge all sniper signals (engine version reset) ── */
app.delete('/api/sniper/purge', requireAdmin, async (req, res) => {
  if (!sbAdmin) return res.status(500).json({ error: 'Database not configured' });
  try {
    // Delete all rows from sniper_signals
    const { error: delErr, count } = await sbAdmin
      .from('sniper_signals')
      .delete({ count: 'exact' })
      .neq('id', '00000000-0000-0000-0000-000000000000'); // match all rows
    if (delErr) throw delErr;

    // Reset in-memory condition weights
    conditionWeights = {};
    conditionWeightsRecent = {};
    console.log(`🗑️ [Sniper Purge] Deleted ${count || 'all'} signals, condition weights reset.`);
    res.json({ success: true, deleted: count || 0, message: 'All sniper signals purged. Condition weights reset.' });
  } catch(e) {
    console.error('[Sniper Purge] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

/* ── Condition weights — current feedback loop state ── */
app.get('/api/condition-weights', requireAdmin, (req, res) => {
  const total = Object.keys(conditionWeights).length;
  const qualified = Object.entries(conditionWeights)
    .filter(([, b]) => b.total >= CW_MIN_SAMPLE)
    .sort(([, a], [, b]) => b.total - a.total)
    .map(([key, b]) => {
      const entry = { key, win_rate: +(b.win_rate * 100).toFixed(1), wins: b.wins, total: b.total, adj: _cwAdj(b.win_rate) };
      // Attach pulse data if recent window has enough samples
      const recent = conditionWeightsRecent[key];
      if (recent && recent.total >= CW_RECENT_MIN) {
        const deviation = recent.win_rate - b.win_rate;
        entry.pulse = {
          recent_wr: +(recent.win_rate * 100).toFixed(1),
          recent_n: recent.total,
          deviation_pp: +(deviation * 100).toFixed(1),
          pulse_adj: Math.abs(deviation) >= CW_DEVIATION ? Math.max(-5, Math.min(5, Math.round(deviation * 20))) : 0,
        };
      }
      return entry;
    });

  const totalRecent = Object.keys(conditionWeightsRecent).length;
  res.json({
    total_buckets: total, qualified_buckets: qualified.length, min_sample: CW_MIN_SAMPLE,
    pulse_window_days: CW_RECENT_DAYS, pulse_min_sample: CW_RECENT_MIN, pulse_recent_buckets: totalRecent,
    buckets: qualified,
  });
});

/* ═══════════════════════════════════════════════════
   SNIPER PERFORMANCE STATS API
   ═══════════════════════════════════════════════════ */

app.get('/api/sniper/stats', requireAdmin, async (req, res) => {
  if (!sbAdmin) return res.status(500).json({ error: 'Database not configured' });
  try {
    const { data: all, error } = await sbAdmin
      .from('sniper_signals')
      .select('id, pair, timeframe, direction, entry, sl, tp1, tp2, sl_pips, tp1_pips, tp2_pips, rr1, rr2, confidence, reasoning, outcome, setup_type, ctx_trend, ctx_session, ctx_volatility, actual_price, bars_to_outcome, created_at, source');
    if (error) throw error;

    const resolved = all.filter(s => s.outcome && s.outcome !== 'pending');
    const wins     = resolved.filter(s => s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit');
    const tp2Wins  = resolved.filter(s => s.outcome === 'tp2_hit');
    const losses   = resolved.filter(s => s.outcome === 'sl_hit');
    const expired  = resolved.filter(s => s.outcome === 'expired');
    const totalDecided = wins.length + losses.length; /* exclude expired from win rate */

    /* Overall stats */
    const overall = {
      total: all.length,
      pending: all.filter(s => s.outcome === 'pending').length,
      resolved: resolved.length,
      wins: wins.length,
      tp1_hits: resolved.filter(s => s.outcome === 'tp1_hit').length,
      tp2_hits: tp2Wins.length,
      sl_hits: losses.length,
      expired: expired.length,
      win_rate: totalDecided > 0 ? ((wins.length / totalDecided) * 100).toFixed(1) : '0',
      tp2_rate: totalDecided > 0 ? ((tp2Wins.length / totalDecided) * 100).toFixed(1) : '0',
      avg_bars: resolved.length > 0 ? (resolved.reduce((s, r) => s + (r.bars_to_outcome || 0), 0) / resolved.length).toFixed(1) : '0',
    };

    /* By context dimension */
    function groupBy(arr, key) {
      const map = {};
      arr.forEach(s => {
        const val = s[key] || 'unknown';
        if (!map[val]) map[val] = { total: 0, wins: 0, losses: 0, expired: 0 };
        map[val].total++;
        if (s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit') map[val].wins++;
        else if (s.outcome === 'sl_hit') map[val].losses++;
        else if (s.outcome === 'expired') map[val].expired++;
      });
      Object.keys(map).forEach(k => {
        const decided = map[k].wins + map[k].losses;
        map[k].win_rate = decided > 0 ? ((map[k].wins / decided) * 100).toFixed(1) : '0';
      });
      return map;
    }

    /* Normalize source labels for groupBy (scanner_oanda → oanda, etc.) */
    const resolvedTagged = resolved.map(s => ({
      ...s,
      data_source: s.source ? s.source.replace('scanner_', '') : 'unknown',
    }));

    const by_context = {
      trend:      groupBy(resolvedTagged, 'ctx_trend'),
      session:    groupBy(resolvedTagged, 'ctx_session'),
      volatility: groupBy(resolvedTagged, 'ctx_volatility'),
      structure:  groupBy(resolvedTagged, 'setup_type'),
      direction:  groupBy(resolvedTagged, 'direction'),
    };
    const by_pair   = groupBy(resolvedTagged, 'pair');
    const by_source = groupBy(resolvedTagged, 'data_source');

    /* Find best context combo */
    let bestCombo = { label: 'Not enough data', win_rate: 0, sample: 0 };
    if (resolved.length >= 5) {
      const combos = {};
      resolved.forEach(s => {
        const key = `${s.ctx_trend || '?'}|${s.ctx_session || '?'}|${s.setup_type || '?'}`;
        if (!combos[key]) combos[key] = { wins: 0, total: 0 };
        combos[key].total++;
        if (s.outcome === 'tp1_hit' || s.outcome === 'tp2_hit') combos[key].wins++;
      });
      let bestRate = 0;
      Object.entries(combos).forEach(([key, v]) => {
        if (v.total >= 3) { /* min 3 samples */
          const rate = v.wins / v.total;
          if (rate > bestRate) {
            bestRate = rate;
            const [trend, session, setup] = key.split('|');
            bestCombo = { label: `${trend} + ${session} + ${setup}`, win_rate: (rate * 100).toFixed(1), sample: v.total, wins: v.wins };
          }
        }
      });
    }

    /* Recent resolved signals */
    const recent = resolved
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, 30)
      .map(s => ({
        id: s.id, pair: s.pair, timeframe: s.timeframe, direction: s.direction,
        entry: s.entry, sl: s.sl, tp1: s.tp1, tp2: s.tp2,
        outcome: s.outcome, actual_price: s.actual_price,
        bars_to_outcome: s.bars_to_outcome,
        setup_type: s.setup_type, ctx_trend: s.ctx_trend,
        ctx_session: s.ctx_session, ctx_volatility: s.ctx_volatility,
        confidence: s.confidence, created_at: s.created_at,
      }));

    res.json({ overall, by_context, by_pair, by_source, best_combo: bestCombo, recent });
  } catch(e) {
    console.error('[Sniper Stats]', e);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

/* ── SNIPER ADMIN DASHBOARD ── */
app.get('/admin/sniper', requireAdmin, (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Sniper Performance Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0a0c12;color:#e0e0e0;font-family:'DM Mono',monospace;padding:24px}
  h1{color:#c9a84c;margin-bottom:8px;font-size:22px}
  .subtitle{color:rgba(255,255,255,.35);font-size:12px;margin-bottom:24px}
  .card{background:#13161f;border:1px solid rgba(201,168,76,.15);border-radius:8px;padding:20px;margin-bottom:16px}
  .row{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px}
  .stat{flex:1;min-width:100px;text-align:center;background:#0d0f18;border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:14px 8px}
  .stat .val{font-size:28px;font-weight:700;color:#c9a84c}
  .stat .lbl{font-size:10px;color:rgba(255,255,255,.4);margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
  .stat.green .val{color:#22c55e}
  .stat.red .val{color:#f87171}
  .stat.blue .val{color:#3b82f6}
  h2{color:rgba(201,168,76,.8);font-size:14px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(201,168,76,.1)}
  .ctx-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}
  .ctx-card{background:#0d0f18;border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:14px}
  .ctx-card h3{font-size:11px;color:rgba(201,168,76,.6);text-transform:uppercase;letter-spacing:1px;margin-bottom:10px}
  .ctx-row{display:flex;justify-content:space-between;align-items:center;padding:5px 0;border-bottom:1px solid rgba(255,255,255,.04)}
  .ctx-row:last-child{border-bottom:none}
  .ctx-label{font-size:12px;color:rgba(255,255,255,.6)}
  .ctx-val{font-size:12px;font-weight:700}
  .ctx-bar{height:4px;background:rgba(255,255,255,.06);border-radius:2px;flex:1;margin:0 10px;min-width:40px}
  .ctx-bar-fill{height:100%;border-radius:2px;transition:width .4s}
  .edge-box{background:linear-gradient(135deg,rgba(201,168,76,.08),rgba(201,168,76,.02));border:1px solid rgba(201,168,76,.3);border-radius:8px;padding:18px;margin-bottom:16px;text-align:center}
  .edge-box .edge-label{font-size:10px;color:rgba(201,168,76,.6);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px}
  .edge-box .edge-value{font-size:16px;color:#c9a84c;font-weight:700}
  .edge-box .edge-detail{font-size:11px;color:rgba(255,255,255,.4);margin-top:4px}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{text-align:left;color:rgba(201,168,76,.7);border-bottom:1px solid rgba(255,255,255,.08);padding:8px 6px;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
  td{padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.04);color:rgba(255,255,255,.65)}
  tr:hover td{background:rgba(255,255,255,.02)}
  .badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700}
  .b-tp1{background:rgba(34,197,94,.15);color:#22c55e}
  .b-tp2{background:rgba(34,197,94,.25);color:#4ade80}
  .b-sl{background:rgba(248,113,113,.15);color:#f87171}
  .b-exp{background:rgba(100,116,139,.15);color:#64748b}
  .b-pend{background:rgba(201,168,76,.12);color:#c9a84c}
  .b-long{color:#22c55e}
  .b-short{color:#f87171}
  #checkBtn{background:linear-gradient(135deg,#9a7a2e,#c9a84c);color:#0a0c12;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;font-family:inherit;margin-left:16px}
  #checkBtn:disabled{opacity:.4;cursor:not-allowed}
  #purgeBtn{background:rgba(248,113,113,.12);color:#f87171;border:1px solid rgba(248,113,113,.3);padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;font-family:inherit;margin-left:8px;transition:all .2s}
  #purgeBtn:hover{background:rgba(248,113,113,.25);border-color:#f87171}
  #purgeBtn:disabled{opacity:.4;cursor:not-allowed}
  .loading{text-align:center;padding:40px;color:rgba(255,255,255,.3)}
</style>
</head>
<body>
<h1>Sniper Performance Dashboard</h1>
<p class="subtitle">Algorithmic signal performance | Context-based edge discovery | <button id="checkBtn" onclick="runCheck()">Force Outcome Check</button><button id="purgeBtn" onclick="purgeAll()">Purge All Data</button></p>
<div id="content"><div class="loading">Loading stats...</div></div>
<script>
const ADMIN_KEY = new URLSearchParams(location.search).get('key') || '';
const H = { 'x-admin-key': ADMIN_KEY };

function wrColor(rate) { rate = parseFloat(rate); return rate >= 60 ? '#22c55e' : rate >= 45 ? '#c9a84c' : '#f87171'; }
function badgeClass(outcome) { return outcome === 'tp1_hit' ? 'b-tp1' : outcome === 'tp2_hit' ? 'b-tp2' : outcome === 'sl_hit' ? 'b-sl' : outcome === 'expired' ? 'b-exp' : 'b-pend'; }
function badgeLabel(outcome) { return outcome === 'tp1_hit' ? 'TP1 [OK]' : outcome === 'tp2_hit' ? 'TP2 [OK][OK]' : outcome === 'sl_hit' ? 'SL [X]' : outcome === 'expired' ? 'Expired' : 'Pending'; }

function renderCtxCard(title, data) {
  const entries = Object.entries(data).filter(([k]) => k !== 'unknown');
  if (entries.length === 0) return '';
  return '<div class="ctx-card"><h3>' + title + '</h3>' +
    entries.map(([k, v]) => {
      const wr = parseFloat(v.win_rate) || 0;
      const c = wrColor(wr);
      return '<div class="ctx-row">' +
        '<span class="ctx-label">' + k + '</span>' +
        '<div class="ctx-bar"><div class="ctx-bar-fill" style="width:' + wr + '%;background:' + c + '"></div></div>' +
        '<span class="ctx-val" style="color:' + c + '">' + wr + '%</span>' +
        '<span style="font-size:10px;color:rgba(255,255,255,.25);margin-left:6px">(' + v.total + ')</span>' +
      '</div>';
    }).join('') + '</div>';
}

async function load() {
  try {
    const r = await fetch("/api/sniper/stats?key=" + ADMIN_KEY, { headers: H });
    if (!r.ok) { document.getElementById('content').innerHTML = '<p style="color:red;padding:24px">Unauthorized</p>'; return; }
    const d = await r.json();
    const o = d.overall;
    const bc = d.best_combo;

    let html = '<div class="row">' +
      '<div class="stat"><div class="val">' + o.total + '</div><div class="lbl">Total Signals</div></div>' +
      '<div class="stat green"><div class="val">' + o.win_rate + '%</div><div class="lbl">Win Rate (TP1+)</div></div>' +
      '<div class="stat blue"><div class="val">' + o.tp2_rate + '%</div><div class="lbl">TP2 Hit Rate</div></div>' +
      '<div class="stat"><div class="val">' + o.wins + "/" + o.sl_hits + '</div><div class="lbl">Wins / Losses</div></div>' +
      '<div class="stat"><div class="val">' + o.pending + '</div><div class="lbl">Pending</div></div>' +
      '<div class="stat"><div class="val">' + o.avg_bars + '</div><div class="lbl">Avg Bars to Outcome</div></div>' +
    '</div>';

    if (bc.sample > 0) {
      html += '<div class="edge-box">' +
        '<div class="edge-label">Best Context Combination</div>' +
        '<div class="edge-value">' + bc.label + ': ' + bc.win_rate + '% win rate</div>' +
        '<div class="edge-detail">' + bc.wins + ' wins in ' + bc.sample + ' signals</div>' +
      '</div>';
    }

    if (d.by_source && Object.keys(d.by_source).length > 0) {
      const srcColors = { oanda: "#c9a84c", td_forex: "#4ade80", td_crypto: "#60a5fa", unknown: "#64748b" };
      const srcLabels = { oanda: "OANDA (MetaAPI)", td_forex: "TD Forex", td_crypto: "TD Crypto", unknown: "Legacy" };
      html += '<div class="card" style="border-color:rgba(255,255,255,.08)"><h2>Performance by Data Source</h2><div style="display:flex;gap:12px;flex-wrap:wrap">' +
        Object.entries(d.by_source).map(([k, v]) => {
          const c = srcColors[k] || "#64748b";
          const label = srcLabels[k] || k;
          const wr = parseFloat(v.win_rate) || 0;
          return '<div style="flex:1;min-width:160px;background:#0d0f18;border:1px solid ' + c + '22;border-radius:6px;padding:14px;text-align:center">' +
            '<div style="font-size:10px;color:rgba(255,255,255,.35);text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">' + label + '</div>' +
            '<div style="font-size:26px;font-weight:700;color:' + c + '">' + wr + '%</div>' +
            '<div style="font-size:10px;color:rgba(255,255,255,.3);margin-top:4px">' + v.wins + "W / " + v.losses + "L &nbsp;&middot;&nbsp; " + v.total + ' resolved</div>' +
          '</div>';
        }).join('') +
      '</div></div>';
    }

    html += '<div class="card"><h2>Context Breakdown &mdash; Edge Discovery</h2><div class="ctx-grid">' +
      renderCtxCard('Trend', d.by_context.trend) +
      renderCtxCard('Session', d.by_context.session) +
      renderCtxCard('Volatility', d.by_context.volatility) +
      renderCtxCard('Setup Type', d.by_context.structure) +
      renderCtxCard('Direction', d.by_context.direction) +
      renderCtxCard('By Pair', d.by_pair) +
    '</div></div>';

    html += '<div class="card"><h2>Recent Resolved Signals</h2>';
    if (d.recent.length === 0) {
      html += '<p style="color:rgba(255,255,255,.3);padding:16px;text-align:center">No resolved signals yet. Run some Sniper analyses and wait for the outcome checker.</p>';
    } else {
      html += '<div style="overflow-x:auto"><table><thead><tr>' +
        '<th>Pair</th><th>Dir</th><th>Entry</th><th>SL</th><th>SL Pips</th><th>TP1</th><th>TP2</th>' +
        '<th>Outcome</th><th>Bars</th><th>Setup</th><th>Trend</th><th>Session</th><th>Vol</th><th>Conf</th><th>Date</th>' +
      '</tr></thead><tbody>' +
      d.recent.map(s => '<tr>' +
        '<td><b>' + (s.pair || '-') + '</b></td>' +
        '<td class="' + (s.direction === 'long' ? 'b-long' : 'b-short') + '"><b>' + (s.direction || '-').toUpperCase() + '</b></td>' +
        '<td>' + (s.entry || '-') + '</td>' +
        '<td>' + (s.sl || '-') + '</td>' +
        '<td>' + (s.sl_pips || '-') + '</td>' +
        '<td>' + (s.tp1 || '-') + '</td>' +
        '<td>' + (s.tp2 || '-') + '</td>' +
        '<td><span class="badge ' + badgeClass(s.outcome) + '">' + badgeLabel(s.outcome) + '</span></td>' +
        '<td>' + (s.bars_to_outcome || '-') + '</td>' +
        '<td>' + (s.setup_type || '-') + '</td>' +
        '<td>' + (s.ctx_trend || '-') + '</td>' +
        '<td>' + (s.ctx_session || '-') + '</td>' +
        '<td>' + (s.ctx_volatility || '-') + '</td>' +
        '<td>' + (s.confidence || '-') + '%</td>' +
        '<td>' + (s.created_at ? new Date(s.created_at).toLocaleDateString() : '-') + '</td>' +
      '</tr>').join('') +
      '</tbody></table></div>';
    }
    html += '</div>';

    document.getElementById('content').innerHTML = html;
  } catch(e) { document.getElementById('content').innerHTML = '<p style="color:red">Error: ' + e.message + '</p>'; }
}

async function runCheck() {
  const btn = document.getElementById('checkBtn');
  btn.disabled = true; btn.textContent = 'Checking...';
  try {
    await fetch("/api/sniper/check-now?key=" + ADMIN_KEY, { method: "POST" });
    await load();
  } catch(e) { alert('Error: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Force Outcome Check';
}

async function purgeAll() {
  const countVal = document.querySelector(".stat .val");
  const total = countVal ? countVal.textContent : "?";
  if (!confirm("WARNING: This will permanently delete ALL signals and reset weights.\\n\\nContinue?")) return;
  const btn = document.getElementById('purgeBtn');
  btn.disabled = true; btn.textContent = 'Purging...';
  try {
    const r = await fetch("/api/sniper/purge?key=" + ADMIN_KEY, { method: "DELETE" });
    const d = await r.json();
    if (d.success) {
      alert("Purged successfully.");
      await load();
    } else { alert("Error: " + (d.error || "Unknown")); }
  } catch(e) { alert("Error: " + e.message); }
  btn.disabled = false; btn.textContent = "Purge All Data";
}

load();
</script>
</body>
</html>`);
});



/* ═══════════════════════════════════════════════════
   🔄 SNIPER SCANNER — Automated signal generation
   Runs across all OANDA symbols on 1h/4h/1d timeframes.
   Saves high-confidence signals to DB for outcome tracking.
   ═══════════════════════════════════════════════════ */

const SCANNER_TFS = ['1h', '4h', '1d'];
const SCANNER_MIN_CANDLES = 20;
const SCANNER_MIN_CONFIDENCE = 50; /* Wide open for data collection phase */
const SCANNER_DEDUP_HOURS = 6; /* Don't repeat same pair+direction+tf within this window */

let _scannerRunning = false;
let _scannerLastRun = null;
let _scannerStats = { lastRun: null, scanned: 0, signals: 0, skipped: 0, errors: 0, duration: 0 };

async function runSniperScanner() {
  if (!sbAdmin) return;
  if (_scannerRunning) { console.log('[Scanner] Already running, skipping.'); return; }
  _scannerRunning = true;
  const startTime = Date.now();
  console.log('\n🔄 [Scanner] Starting scan across all symbols...');

  const symbols = Object.keys(oandaCandles);
  let scanned = 0, saved = 0, skipped = 0, errors = 0;

  /* Fetch recent scanner signals for de-duplication */
  const dedupCutoff = new Date(Date.now() - SCANNER_DEDUP_HOURS * 3600 * 1000).toISOString();
  let recentSignals = [];
  try {
    const { data } = await sbAdmin.from('sniper_signals')
      .select('pair, timeframe, direction')
      .like('source', 'scanner%')
      .gte('created_at', dedupCutoff);
    recentSignals = data || [];
  } catch(e) { /* proceed without dedup */ }

  const recentKeys = new Set(recentSignals.map(s => `${s.pair}|${s.timeframe}|${s.direction}`));

  for (const sym of symbols) {
    const symData = oandaCandles[sym];
    if (!symData) continue;

    for (const tf of SCANNER_TFS) {
      const candles = symData[tf];
      if (!candles || candles.length < SCANNER_MIN_CANDLES) continue;

      scanned++;
      try {
        const raw = algoSniperSignal(candles, sym, tf);
        if (raw.error) { skipped++; continue; }
        if (raw.confidence < SCANNER_MIN_CONFIDENCE) { skipped++; continue; }

        /* De-duplicate */
        const dedupKey = `${raw.pair}|${raw.timeframe}|${raw.direction}`;
        if (recentKeys.has(dedupKey)) { skipped++; continue; }

        /* Validate */
        const lastClose = +candles[candles.length - 1].c;
        const priceMin = Math.min(...candles.map(c => +c.l));
        const priceMax = Math.max(...candles.map(c => +c.h));
        const validErr = validateSniper(raw, lastClose, priceMin, priceMax);
        if (validErr) { skipped++; continue; }

        /* Enrich with pips/RR + condition feedback adjustment */
        const sig = applyConditionWeight(calcSniperMath(raw));

        /* Save */
        const { error: dbErr } = await sbAdmin.from('sniper_signals').insert({
          pair: sig.pair, timeframe: sig.timeframe,
          direction: sig.direction, entry: sig.entry, sl: sig.sl, tp1: sig.tp1, tp2: sig.tp2,
          sl_pips: sig.sl_pips, tp1_pips: sig.tp1_pips, tp2_pips: sig.tp2_pips,
          rr1: sig.rr1, rr2: sig.rr2, sl_pct: sig.sl_pct, tp1_pct: sig.tp1_pct, tp2_pct: sig.tp2_pct,
          confidence: sig.confidence, reasoning: sig.reasoning, outcome: 'pending',
          setup_type: sig.setup_type || null,
          ctx_trend: sig.ctx_trend || null,
          ctx_session: sig.ctx_session || null,
          ctx_volatility: sig.ctx_volatility || null,
          source: 'scanner_' + getDataSource(sym),
        });

        if (dbErr) { errors++; console.error(`  ❌ ${sym} ${tf}:`, dbErr.message); }
        else { saved++; recentKeys.add(dedupKey); }

      } catch(e) { errors++; }
    }
  }

  const duration = Date.now() - startTime;
  _scannerRunning = false;
  _scannerLastRun = new Date().toISOString();
  _scannerStats = { lastRun: _scannerLastRun, scanned, signals: saved, skipped, errors, duration };
  console.log(`🔄 [Scanner] Done: ${scanned} scanned, ${saved} signals saved, ${skipped} skipped, ${errors} errors (${duration}ms)`);
}

/* ── Scanner API ── */
app.post('/api/sniper/scan-now', requireAdmin, async (req, res) => {
  try {
    await runSniperScanner();
    res.json({ success: true, stats: _scannerStats });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/sniper/scanner-status', requireAdmin, (req, res) => {
  res.json({ running: _scannerRunning, stats: _scannerStats });
});

app.get('/api/sniper/live', requireAdmin, async (req, res) => {
  if (!sbAdmin) return res.status(500).json({ error: 'DB not configured' });
  try {
    const { data, error } = await sbAdmin.from('sniper_signals')
      .select('*')
      .like('source', 'scanner%')
      .eq('outcome', 'pending')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    res.json({ signals: data || [] });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Scanner Admin Dashboard ── */
app.get('/admin/scanner', requireAdmin, (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Sniper Scanner Dashboard</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0a0c12;color:#e0e0e0;font-family:'DM Mono',monospace;padding:24px}
  h1{color:#c9a84c;margin-bottom:8px;font-size:22px}
  .subtitle{color:rgba(255,255,255,.35);font-size:12px;margin-bottom:24px}
  .card{background:#13161f;border:1px solid rgba(201,168,76,.15);border-radius:8px;padding:20px;margin-bottom:16px}
  .row{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px}
  .stat{flex:1;min-width:100px;text-align:center;background:#0d0f18;border:1px solid rgba(255,255,255,.06);border-radius:6px;padding:14px 8px}
  .stat .val{font-size:28px;font-weight:700;color:#c9a84c}
  .stat .lbl{font-size:10px;color:rgba(255,255,255,.4);margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
  .stat.green .val{color:#22c55e}
  .stat.blue .val{color:#3b82f6}
  h2{color:rgba(201,168,76,.8);font-size:14px;margin-bottom:12px;padding-bottom:8px;border-bottom:1px solid rgba(201,168,76,.1)}
  table{width:100%;border-collapse:collapse;font-size:11px}
  th{text-align:left;color:rgba(201,168,76,.7);border-bottom:1px solid rgba(255,255,255,.08);padding:8px 6px;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
  td{padding:7px 6px;border-bottom:1px solid rgba(255,255,255,.04);color:rgba(255,255,255,.65)}
  tr:hover td{background:rgba(255,255,255,.02)}
  .badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:10px;font-weight:700}
  .b-long{background:rgba(34,197,94,.12);color:#22c55e}
  .b-short{background:rgba(248,113,113,.12);color:#f87171}
  .b-pend{background:rgba(201,168,76,.12);color:#c9a84c}
  .src-oanda{background:rgba(201,168,76,.1);color:#c9a84c}
  .src-td_forex{background:rgba(22,163,74,.1);color:#4ade80}
  .src-td_crypto{background:rgba(37,99,235,.1);color:#60a5fa}
  .src-unknown{background:rgba(100,116,139,.1);color:#64748b}
  .conf-high{color:#22c55e} .conf-med{color:#c9a84c} .conf-low{color:#f87171}
  .btn{background:linear-gradient(135deg,#9a7a2e,#c9a84c);color:#0a0c12;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:700;font-size:12px;font-family:inherit;margin-left:8px}
  .btn:disabled{opacity:.4;cursor:not-allowed}
  .btn.secondary{background:rgba(201,168,76,.15);color:#c9a84c;border:1px solid rgba(201,168,76,.3)}
  .status-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px}
  .dot-on{background:#22c55e;box-shadow:0 0 6px #22c55e}
  .dot-off{background:#64748b}
  .loading{text-align:center;padding:40px;color:rgba(255,255,255,.3)}
  .empty{text-align:center;padding:24px;color:rgba(255,255,255,.25)}
  .pair-badge{font-weight:700;color:#c9a84c}
</style>
</head>
<body>
<h1>🔄 Sniper Scanner Dashboard</h1>
<p class="subtitle">
  Automated 24/7 signal scanner — OANDA + TwelveData Crypto + TwelveData Forex
  <button class="btn" id="scanBtn" onclick="runScan()">Run Scan Now</button>
  <button class="btn secondary" id="checkBtn" onclick="runCheck()">Check Outcomes</button>
</p>

<div class="card">
  <div class="row" id="statusRow">
    <div class="stat"><div class="val" id="sTotal">—</div><div class="lbl">Scanned</div></div>
    <div class="stat green"><div class="val" id="sSaved">—</div><div class="lbl">Signals Saved</div></div>
    <div class="stat"><div class="val" id="sSkipped">—</div><div class="lbl">Skipped</div></div>
    <div class="stat blue"><div class="val" id="sDuration">—</div><div class="lbl">Duration (ms)</div></div>
    <div class="stat"><div class="val" id="sLast">—</div><div class="lbl">Last Scan</div></div>
  </div>
</div>

<div class="card">
  <h2>Live Pending Signals (Scanner-Generated)</h2>
  <div id="liveTable"><div class="loading">Loading...</div></div>
</div>

<script>
const AK = new URLSearchParams(location.search).get('key') || '';
const H = { 'x-admin-key': AK };

function confClass(c) { c = parseInt(c)||0; return c >= 70 ? 'conf-high' : c >= 50 ? 'conf-med' : 'conf-low'; }

async function loadStatus() {
  try {
    const r = await fetch('/api/sniper/scanner-status?key=' + AK, { headers: H });
    const d = await r.json();
    const s = d.stats || {};
    document.getElementById('sTotal').textContent = s.scanned || '—';
    document.getElementById('sSaved').textContent = s.signals || '—';
    document.getElementById('sSkipped').textContent = s.skipped || '—';
    document.getElementById('sDuration').textContent = s.duration || '—';
    document.getElementById('sLast').textContent = s.lastRun ? new Date(s.lastRun).toLocaleTimeString() : 'Never';
  } catch(e) {}
}

async function loadLive() {
  try {
    const r = await fetch('/api/sniper/live?key=' + AK, { headers: H });
    const d = await r.json();
    const sigs = d.signals || [];
    if (sigs.length === 0) {
      document.getElementById('liveTable').innerHTML = '<div class="empty">No pending scanner signals. Run a scan to generate signals.</div>';
      return;
    }
    let html = '<div style="overflow-x:auto"><table><thead><tr>' +
      '<th>Pair</th><th>TF</th><th>Dir</th><th>Source</th><th>Entry</th><th>SL</th><th>SL Pips</th><th>TP1</th><th>TP2</th>' +
      '<th>RR</th><th>Conf</th><th>Setup</th><th>Trend</th><th>Session</th><th>Vol</th><th>Time</th>' +
    '</tr></thead><tbody>';
    sigs.forEach(s => {
      const dir = (s.direction||'').toLowerCase();
      const ds  = s.source ? s.source.replace('scanner_','') : 'unknown';
      const dsLabel = ds === 'td_forex' ? 'TD Forex' : ds === 'td_crypto' ? 'TD Crypto' : ds === 'oanda' ? 'OANDA' : ds;
      html += '<tr>' +
        '<td class="pair-badge">' + (s.pair||'—') + '</td>' +
        '<td>' + (s.timeframe||'—') + '</td>' +
        '<td><span class="badge b-' + dir + '">' + dir.toUpperCase() + '</span></td>' +
        '<td><span class="badge src-' + ds + '">' + dsLabel + '</span></td>' +
        '<td>' + (s.entry||'—') + '</td>' +
        '<td>' + (s.sl||'—') + '</td>' +
        '<td>' + (s.sl_pips||'—') + '</td>' +
        '<td>' + (s.tp1||'—') + '</td>' +
        '<td>' + (s.tp2||'—') + '</td>' +
        '<td>' + (s.rr1||'—') + ' / ' + (s.rr2||'—') + '</td>' +
        '<td class="' + confClass(s.confidence) + '"><b>' + (s.confidence||'—') + '%</b></td>' +
        '<td>' + (s.setup_type||'—') + '</td>' +
        '<td>' + (s.ctx_trend||'—') + '</td>' +
        '<td>' + (s.ctx_session||'—') + '</td>' +
        '<td>' + (s.ctx_volatility||'—') + '</td>' +
        '<td>' + (s.created_at ? new Date(s.created_at).toLocaleString() : '—') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
    document.getElementById('liveTable').innerHTML = html;
  } catch(e) {
    document.getElementById('liveTable').innerHTML = '<div class="empty">Error loading signals: ' + e.message + '</div>';
  }
}

async function runScan() {
  const btn = document.getElementById('scanBtn');
  btn.disabled = true; btn.textContent = 'Scanning...';
  try {
    await fetch('/api/sniper/scan-now', { method: 'POST', headers: H });
    await loadStatus();
    await loadLive();
  } catch(e) { alert('Error: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Run Scan Now';
}

async function runCheck() {
  const btn = document.getElementById('checkBtn');
  btn.disabled = true; btn.textContent = 'Checking...';
  try {
    await fetch('/api/sniper/check-now', { method: 'POST', headers: H });
    await loadLive();
  } catch(e) { alert('Error: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Check Outcomes';
}

loadStatus();
loadLive();
setInterval(() => { loadStatus(); loadLive(); }, 60000);
</script>
</body>
</html>`);
});

/* ═══════════════════════════════════════════════════
   📈 SMA200/400 CROSSOVER SCANNER
   ═══════════════════════════════════════════════════ */

const CROSSOVER_CANDLES = 1000;
let _crossoverRunning = false;
let _crossoverLastRun = null;
let _crossoverStats   = null;

function computeSMA(closes, period) {
  const result = new Array(closes.length).fill(null);
  let sum = 0;
  for (let i = 0; i < closes.length; i++) {
    sum += closes[i];
    if (i >= period) sum -= closes[i - period];
    if (i >= period - 1) result[i] = sum / period;
  }
  return result;
}

function detectSMACrossovers(candles, pair) {
  const slice = candles.slice(-CROSSOVER_CANDLES);
  if (slice.length < 400) return [];

  const closes = slice.map(c => parseFloat(c.c));
  const sma200 = computeSMA(closes, 200);
  const sma400 = computeSMA(closes, 400);

  const crosses = [];
  for (let i = 400; i < slice.length; i++) {
    const prev200 = sma200[i - 1], prev400 = sma400[i - 1];
    const curr200 = sma200[i],     curr400 = sma400[i];
    if (prev200 === null || prev400 === null) continue;

    const prevAbove = prev200 > prev400;
    const currAbove = curr200 > curr400;
    if (prevAbove !== currAbove) {
      crosses.push({
        pair,
        timeframe: '1m',
        direction: currAbove ? 'golden_cross' : 'death_cross',
        cross_price: parseFloat(slice[i].c),
        sma200: parseFloat(curr200.toFixed(6)),
        sma400: parseFloat(curr400.toFixed(6)),
        cross_time: new Date(slice[i].t).toISOString(),
      });
    }
  }
  return crosses;
}

async function runCrossoverScanner() {
  if (!sbAdmin) return;
  if (_crossoverRunning) { console.log('[CrossoverScanner] Already running, skipping.'); return; }
  _crossoverRunning = true;
  const startTime = Date.now();
  console.log('\n📈 [CrossoverScanner] Starting SMA200/400 scan...');

  const symbols = Object.keys(oandaCandles);
  let scanned = 0, saved = 0, skipped = 0, errors = 0;

  /* Pre-load existing cross_times for dedup (last 1000 minutes window) */
  const cutoff = new Date(Date.now() - CROSSOVER_CANDLES * 60 * 1000).toISOString();
  let existingKeys = new Set();
  try {
    const { data } = await sbAdmin.from('sma_crossovers')
      .select('pair, cross_time')
      .gte('cross_time', cutoff);
    (data || []).forEach(r => existingKeys.add(`${r.pair}|${r.cross_time}`));
  } catch(e) { /* proceed without dedup */ }

  for (const sym of symbols) {
    const m1 = (oandaCandles[sym] || {})['1m'];
    if (!m1 || m1.length < 400) { skipped++; continue; }
    scanned++;
    try {
      const crosses = detectSMACrossovers(m1, sym);
      for (const cross of crosses) {
        const key = `${cross.pair}|${cross.cross_time}`;
        if (existingKeys.has(key)) continue;
        const { error: dbErr } = await sbAdmin.from('sma_crossovers').insert(cross);
        if (dbErr) { errors++; console.error(`  ❌ ${sym}:`, dbErr.message); }
        else { saved++; existingKeys.add(key); }
      }
    } catch(e) { errors++; }
  }

  const duration = Date.now() - startTime;
  _crossoverRunning = false;
  _crossoverLastRun = new Date().toISOString();
  _crossoverStats = { lastRun: _crossoverLastRun, scanned, saved, skipped, errors, duration };
  console.log(`📈 [CrossoverScanner] Done: ${scanned} scanned, ${saved} new crosses, ${skipped} skipped, ${errors} errors (${duration}ms)`);
}

/* ── Crossover API ── */
app.post('/api/crossovers/scan-now', requireAdmin, async (_req, res) => {
  try { runCrossoverScanner(); res.json({ success: true, message: 'Scan started' }); }
  catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/crossovers/status', requireAdmin, (_req, res) => {
  res.json({ running: _crossoverRunning, stats: _crossoverStats });
});

app.get('/api/crossovers/live', requireAdmin, async (_req, res) => {
  if (!sbAdmin) return res.status(500).json({ error: 'DB not configured' });
  try {
    const { data, error } = await sbAdmin.from('sma_crossovers')
      .select('*')
      .order('cross_time', { ascending: false })
      .limit(200);
    if (error) throw error;
    const crosses = (data || []).map(r => ({ ...r, source: getDataSource(r.pair) }));
    res.json({ crosses });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Broker symbol diagnostic — shows current _maSymMap + full OANDA symbol list ── */
app.get('/api/admin/broker-symbols', requireAdmin, async (_req, res) => {
  res.json({
    symMap: _maSymMap,
    brokerList: _lastBrokerSymbolList,
    unmapped: Object.entries(_maSymMap)
      .filter(([, v]) => !_lastBrokerSymbolList.includes(v))
      .map(([k, v]) => ({ internal: k, brokerName: v }))
  });
});

/* ── Purge all crossover history ── */
app.delete('/api/crossovers/purge', requireAdmin, async (_req, res) => {
  if (!sbAdmin) return res.status(500).json({ error: 'DB not configured' });
  try {
    const { error } = await sbAdmin.from('sma_crossovers').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) throw error;
    console.log('[CrossoverScanner] All crossover history purged.');
    res.json({ success: true, message: 'All crossover history purged.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

/* ── Crossover Admin Dashboard ── */
app.get('/admin/crossovers', requireAdmin, (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>SMA Crossover Dashboard</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0d0d0d;color:#e0e0e0;font-family:'Segoe UI',sans-serif;padding:24px}
  h1{font-size:22px;margin-bottom:4px}
  .sub{color:#888;font-size:13px;margin-bottom:24px}
  .cards{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:24px}
  .card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:10px;padding:16px 24px;min-width:140px}
  .card .val{font-size:28px;font-weight:700;margin:4px 0}
  .card .lbl{font-size:12px;color:#888;text-transform:uppercase}
  .actions{display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap}
  button{background:#2563eb;color:#fff;border:none;border-radius:6px;padding:9px 18px;cursor:pointer;font-size:14px;font-weight:600}
  button:hover{background:#1d4ed8} button:disabled{opacity:.5;cursor:not-allowed}
  table{width:100%;border-collapse:collapse;font-size:13px}
  th{background:#1a1a1a;color:#888;font-weight:600;text-transform:uppercase;font-size:11px;padding:10px 12px;text-align:left;border-bottom:1px solid #2a2a2a;white-space:nowrap}
  td{padding:9px 12px;border-bottom:1px solid #1e1e1e;vertical-align:middle}
  tr:hover td{background:#161616}
  .badge{display:inline-block;padding:3px 8px;border-radius:4px;font-size:11px;font-weight:700;text-transform:uppercase}
  .golden{background:#78350f;color:#fde68a}
  .death{background:#450a0a;color:#fca5a5}
  .pair{font-weight:700;color:#60a5fa}
  .status{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:8px;padding:12px 16px;margin-bottom:20px;font-size:13px;color:#aaa}
  .empty{padding:32px;text-align:center;color:#555}
  .src-oanda{background:#1e3a5f;color:#93c5fd}
  .src-td_forex{background:#1a3320;color:#86efac}
  .src-td_crypto{background:#3b1f5e;color:#d8b4fe}
  .btn-danger{background:#7f1d1d;color:#fca5a5} .btn-danger:hover{background:#991b1b}
  @media(max-width:700px){.cards{flex-direction:column}}
</style>
</head>
<body>
<h1>SMA200/400 Crossover Dashboard</h1>
<p class="sub">1m timeframe — 1000 candles — OANDA + TD Forex + TD Crypto</p>
<div class="status" id="status">Loading...</div>
<div class="actions">
  <button onclick="runScan(this)">Run Scan Now</button>
  <button class="btn-danger" onclick="purgeAll(this)">Purge All History</button>
</div>
<div class="cards" id="cards"></div>
<div id="crossTable"></div>
<script>
const AK = '${process.env.ADMIN_KEY || 'mysecretkey123'}';
const H  = { 'x-admin-key': AK };

async function loadStatus() {
  try {
    const r = await fetch('/api/crossovers/status?key=' + AK, { headers: H });
    const d = await r.json();
    const s = d.stats;
    if (!s) { document.getElementById('status').textContent = 'No scan run yet.'; return; }
    document.getElementById('status').innerHTML =
      'Last scan: <b>' + new Date(s.lastRun).toLocaleString() + '</b> &nbsp;|&nbsp; ' +
      'Scanned: <b>' + s.scanned + '</b> &nbsp;|&nbsp; ' +
      'New crosses saved: <b>' + s.saved + '</b> &nbsp;|&nbsp; ' +
      'Skipped: <b>' + s.skipped + '</b> &nbsp;|&nbsp; ' +
      'Errors: <b>' + s.errors + '</b> &nbsp;|&nbsp; ' +
      'Duration: <b>' + s.duration + 'ms</b>' +
      (d.running ? ' &nbsp;<span style="color:#facc15">⏳ Running...</span>' : '');
  } catch(e) { document.getElementById('status').textContent = 'Error loading status.'; }
}

async function loadCrosses() {
  try {
    const r = await fetch('/api/crossovers/live?key=' + AK, { headers: H });
    const d = await r.json();
    const crosses = d.crosses || [];

    const golden = crosses.filter(c => c.direction === 'golden_cross').length;
    const death  = crosses.filter(c => c.direction === 'death_cross').length;
    document.getElementById('cards').innerHTML =
      '<div class="card"><div class="val">' + crosses.length + '</div><div class="lbl">Total Crosses</div></div>' +
      '<div class="card"><div class="val" style="color:#fde68a">' + golden + '</div><div class="lbl">Golden Cross</div></div>' +
      '<div class="card"><div class="val" style="color:#fca5a5">' + death  + '</div><div class="lbl">Death Cross</div></div>';

    if (!crosses.length) {
      document.getElementById('crossTable').innerHTML = '<div class="empty">No crossovers found yet. Run a scan.</div>';
      return;
    }
    let html = '<div style="overflow-x:auto"><table><thead><tr>' +
      '<th>Pair</th><th>Source</th><th>Direction</th><th>Cross Price</th><th>SMA200</th><th>SMA400</th><th>Cross Time</th>' +
    '</tr></thead><tbody>';
    crosses.forEach(c => {
      const isGolden = c.direction === 'golden_cross';
      const src = c.source || 'oanda';
      const srcLabel = src === 'td_forex' ? 'TD Forex' : src === 'td_crypto' ? 'TD Crypto' : 'OANDA';
      html += '<tr>' +
        '<td class="pair">' + (c.pair||'—') + '</td>' +
        '<td><span class="badge src-' + src + '">' + srcLabel + '</span></td>' +
        '<td><span class="badge ' + (isGolden ? 'golden' : 'death') + '">' + (isGolden ? 'Golden Cross' : 'Death Cross') + '</span></td>' +
        '<td>' + (c.cross_price||'—') + '</td>' +
        '<td>' + (c.sma200||'—') + '</td>' +
        '<td>' + (c.sma400||'—') + '</td>' +
        '<td>' + (c.cross_time ? new Date(c.cross_time).toLocaleString() : '—') + '</td>' +
      '</tr>';
    });
    html += '</tbody></table></div>';
    document.getElementById('crossTable').innerHTML = html;
  } catch(e) { document.getElementById('crossTable').innerHTML = '<div class="empty">Error: ' + e.message + '</div>'; }
}

async function runScan(btn) {
  btn.disabled = true; btn.textContent = 'Scanning...';
  try {
    await fetch('/api/crossovers/scan-now', { method: 'POST', headers: H });
    await new Promise(r => setTimeout(r, 3000));
    await loadStatus();
    await loadCrosses();
  } catch(e) { alert('Error: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Run Scan Now';
}

async function purgeAll(btn) {
  if (!confirm('Purge ALL crossover history? This cannot be undone.')) return;
  if (!confirm('Are you sure? All records will be deleted.')) return;
  btn.disabled = true; btn.textContent = 'Purging...';
  try {
    const r = await fetch('/api/crossovers/purge', { method: 'DELETE', headers: H });
    const d = await r.json();
    if (!d.success) throw new Error(d.error || 'Purge failed');
    await loadCrosses();
    alert('All crossover history purged.');
  } catch(e) { alert('Error: ' + e.message); }
  btn.disabled = false; btn.textContent = 'Purge All History';
}

loadStatus();
loadCrosses();
setInterval(() => { loadStatus(); loadCrosses(); }, 60000);
</script>
</body>
</html>`);
});

/* ═══════════════════════════════════════════════════
   🆕 PREDICTION TRACKING API ROUTES
   ═══════════════════════════════════════════════════ */

app.get('/api/predictions/stats', requireAdmin, async (req, res) => {
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

app.get('/admin/cache', requireAdmin, (_req, res) => {
  res.setHeader('Content-Type', 'text/html');
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>OANDA Cache Monitor</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#0a0c12;color:#e0e0e0;font-family:monospace;padding:24px}
  h1{color:#c9a84c;margin-bottom:20px;font-size:20px}
  .card{background:#13161f;border:1px solid rgba(201,168,76,0.15);border-radius:8px;padding:20px;margin-bottom:16px}
  .row{display:flex;gap:24px;flex-wrap:wrap;margin-bottom:16px}
  .stat{flex:1;min-width:120px;text-align:center}
  .stat .val{font-size:32px;font-weight:700;color:#c9a84c}
  .stat .lbl{font-size:12px;color:rgba(255,255,255,0.4);margin-top:4px}
  .bar-wrap{background:#1e2130;border-radius:4px;height:22px;overflow:hidden;margin-bottom:8px}
  .bar-fill{height:100%;background:linear-gradient(90deg,#9a7a2e,#c9a84c);transition:width 0.4s ease;display:flex;align-items:center;justify-content:flex-end;padding-right:8px;font-size:12px;font-weight:700;color:#0a0c12;white-space:nowrap}
  .status-dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:8px}
  .dot-active{background:#22c55e;box-shadow:0 0 6px #22c55e}
  .dot-idle{background:#64748b}
  .current{font-size:13px;color:rgba(255,255,255,0.6);margin-bottom:12px;min-height:20px}
  .log-box{background:#0d0f18;border:1px solid rgba(255,255,255,0.06);border-radius:4px;padding:12px;max-height:200px;overflow-y:auto;font-size:12px;line-height:1.8}
  .log-box .entry{color:rgba(255,255,255,0.45)}
  .log-box .entry .ts{color:rgba(201,168,76,0.5);margin-right:8px}
  .log-box .entry.err{color:#f87171}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th{text-align:left;color:rgba(201,168,76,0.7);border-bottom:1px solid rgba(255,255,255,0.06);padding:6px 8px}
  td{padding:6px 8px;border-bottom:1px solid rgba(255,255,255,0.04);color:rgba(255,255,255,0.7)}
  tr:hover td{background:rgba(255,255,255,0.02)}
  .badge{display:inline-block;padding:2px 8px;border-radius:3px;font-size:11px}
  .badge-ok{background:rgba(34,197,94,0.15);color:#22c55e}
  .badge-empty{background:rgba(100,116,139,0.15);color:#64748b}
  h2{color:rgba(201,168,76,0.8);font-size:14px;margin-bottom:12px}
  #refresh-btn{background:linear-gradient(135deg,#9a7a2e,#c9a84c);color:#0a0c12;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;margin-bottom:16px}
  #refresh-btn:disabled{opacity:0.4;cursor:not-allowed}
  #td-refresh-btn{background:linear-gradient(135deg,#1e3a5f,#2563eb);color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;margin-bottom:16px}
  #td-refresh-btn:disabled{opacity:0.4;cursor:not-allowed}
  #td-forex-refresh-btn{background:linear-gradient(135deg,#1a3d2e,#16a34a);color:#fff;border:none;padding:8px 20px;border-radius:6px;cursor:pointer;font-weight:700;font-size:13px;margin-bottom:16px}
  #td-forex-refresh-btn:disabled{opacity:0.4;cursor:not-allowed}
</style>
</head>
<body>
<h1>OANDA Cache Monitor</h1>
<div class="card" style="margin-bottom:16px;padding:14px 20px;display:flex;align-items:center;gap:20px;flex-wrap:wrap">
  <span style="font-size:13px;color:rgba(255,255,255,0.4)">MetaAPI</span>
  <span id="ma-dot" class="status-dot dot-idle"></span>
  <span id="ma-status" style="font-size:13px;font-weight:700">—</span>
  <span id="ma-lastseen" style="font-size:12px;color:rgba(255,255,255,0.35)"></span>
  <span id="ma-retry" style="font-size:12px;color:#f87171"></span>
</div>
<button id="refresh-btn" onclick="triggerRefresh()">Force Full Refresh</button>
<div class="card">
  <div class="row">
    <div class="stat"><div class="val" id="pct">—</div><div class="lbl">Overall %</div></div>
    <div class="stat"><div class="val" id="sym-done">—</div><div class="lbl">Symbols Done</div></div>
    <div class="stat"><div class="val" id="sym-total">—</div><div class="lbl">Total Symbols</div></div>
    <div class="stat"><div class="val" id="tf-done">—</div><div class="lbl">TFs Fetched</div></div>
    <div class="stat"><div class="val" id="tf-total">—</div><div class="lbl">Total TFs</div></div>
  </div>
  <div class="bar-wrap"><div class="bar-fill" id="bar" style="width:0%">0%</div></div>
  <div class="current" id="current-info">Idle</div>
  <h2>Activity Log</h2>
  <div class="log-box" id="log"></div>
</div>
<div class="card">
  <h2>OANDA Symbols Status</h2>
  <table>
    <thead><tr><th>Symbol</th><th>1m</th><th>5m</th><th>15m</th><th>30m</th><th>1h</th><th>4h</th><th>1d</th><th>1w</th><th>Last Candle</th><th>Status</th></tr></thead>
    <tbody id="sym-table"></tbody>
  </table>
</div>
<div class="card" style="border-color:rgba(37,99,235,0.3)">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
    <h2 style="color:rgba(96,165,250,0.85);margin:0">TwelveData Crypto Cache</h2>
    <div style="display:flex;align-items:center;gap:12px">
      <span id="td-stats" style="font-size:12px;color:rgba(255,255,255,0.4)">—</span>
      <span id="td-active-info" style="font-size:12px;color:#22c55e;display:none"><span class="status-dot dot-active" style="display:inline-block;vertical-align:middle"></span> Refreshing…</span>
      <button id="td-refresh-btn" onclick="triggerTDRefresh()">Force TD Crypto Refresh</button>
    </div>
  </div>
  <table>
    <thead><tr><th>Symbol</th><th>1m</th><th>1h</th><th>4h</th><th>1d</th><th>Last Candle</th><th>Status</th></tr></thead>
    <tbody id="td-table"></tbody>
  </table>
</div>
<div class="card" style="border-color:rgba(22,163,74,0.3)">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;flex-wrap:wrap;gap:8px">
    <h2 style="color:rgba(74,222,128,0.85);margin:0">TwelveData Forex Cache</h2>
    <div style="display:flex;align-items:center;gap:12px">
      <span id="td-forex-stats" style="font-size:12px;color:rgba(255,255,255,0.4)">—</span>
      <span id="td-forex-active-info" style="font-size:12px;color:#22c55e;display:none"><span class="status-dot dot-active" style="display:inline-block;vertical-align:middle"></span> Refreshing…</span>
      <button id="td-forex-refresh-btn" onclick="triggerTDForexRefresh()">Force TD Forex Refresh</button>
    </div>
  </div>
  <table>
    <thead><tr><th>Symbol</th><th>1m</th><th>1h</th><th>4h</th><th>1d</th><th>Last Candle</th><th>Status</th></tr></thead>
    <tbody id="td-forex-table"></tbody>
  </table>
</div>
<script>
const ADMIN_KEY = new URLSearchParams(location.search).get('key') || '';
const TFS = ['1m','5m','15m','30m','1h','4h','1d','1w'];

async function poll() {
  try {
    const r = await fetch('/admin/cache-status?key=' + ADMIN_KEY, { headers: { 'x-admin-key': ADMIN_KEY } });
    if (!r.ok) { document.body.innerHTML = '<p style="color:red;padding:24px">Unauthorized — add ?key=YOUR_ADMIN_SECRET to URL</p>'; return; }
    const d = await r.json();
    const p = d.progress;

    /* MetaAPI status bar */
    const ma = d.metaapi || {};
    const maColors = { connected:'#22c55e', connecting:'#f59e0b', disconnected:'#ef4444', error:'#ef4444' };
    const maColor = maColors[ma.status] || '#64748b';
    document.getElementById('ma-dot').style.background = maColor;
    document.getElementById('ma-dot').style.boxShadow  = ma.status === 'connected' ? '0 0 6px ' + maColor : 'none';
    document.getElementById('ma-status').textContent   = ma.status || '—';
    document.getElementById('ma-status').style.color   = maColor;
    document.getElementById('ma-lastseen').textContent = ma.lastSeen ? 'Last seen: ' + new Date(ma.lastSeen).toLocaleTimeString() : '';
    document.getElementById('ma-retry').textContent    = ma.retryCount > 0 ? 'Retry #' + ma.retryCount : '';

    document.getElementById('pct').textContent       = p.active ? p.pct + '%' : (d.loaded === d.total ? '100%' : Math.round(d.loaded/d.total*100)+'%');
    document.getElementById('sym-done').textContent  = p.active ? p.symDone : d.loaded;
    document.getElementById('sym-total').textContent = d.total;
    document.getElementById('tf-done').textContent   = p.active ? p.tfDone : '—';
    document.getElementById('tf-total').textContent  = p.active ? p.tfTotal : '—';

    const fillPct = p.active ? p.pct : (d.loaded === d.total ? 100 : Math.round(d.loaded/d.total*100));
    const bar = document.getElementById('bar');
    bar.style.width = fillPct + '%';
    bar.textContent = fillPct + '%';

    const info = document.getElementById('current-info');
    if (p.active && p.currentSym) {
      info.innerHTML = '<span class="status-dot dot-active"></span>Fetching <b style="color:#c9a84c">' + p.currentSym + '</b>' + (p.currentTF ? ' &mdash; TF: <b>' + p.currentTF + '</b>' : '');
    } else {
      info.innerHTML = '<span class="status-dot dot-idle"></span>Idle' + (p.startedAt ? ' &mdash; Last run: ' + new Date(p.startedAt).toLocaleString() : '');
    }

    const log = document.getElementById('log');
    log.innerHTML = (p.log || []).slice().reverse().map(e => {
      const isErr = e.msg.startsWith('ERROR');
      return '<div class="entry' + (isErr?' err':'') + '"><span class="ts">' + e.t.slice(11,19) + '</span>' + e.msg + '</div>';
    }).join('') || '<div class="entry">No activity yet</div>';

    const tbody = document.getElementById('sym-table');
    const allSyms = [...d.symbols, ...d.notStarted.map(s => ({ sym: s, tfs: {} }))];
    tbody.innerHTML = allSyms.map(entry => {
      const sym = entry.sym || entry;
      const tfs = entry.tfs || {};
      const isActive = p.active && p.currentSym === sym;
      const cells = TFS.map(tf => {
        const info = tfs[tf];
        if (!info || !info.candles) return '<td style="color:rgba(255,255,255,0.2)">—</td>';
        return '<td>' + info.candles.toLocaleString() + '</td>';
      }).join('');
      const lastCandle = (() => {
        let latest = null;
        TFS.forEach(tf => { if (tfs[tf]?.lastCandle) { const d = new Date(tfs[tf].lastCandle); if (!latest || d > latest) latest = d; } });
        return latest ? latest.toLocaleTimeString() : '—';
      })();
      const hasTfs = Object.keys(tfs).length > 0;
      const badge = isActive
        ? '<span class="badge" style="background:rgba(34,197,94,0.2);color:#22c55e">&#9654; fetching</span>'
        : hasTfs ? '<span class="badge badge-ok">loaded</span>' : '<span class="badge badge-empty">pending</span>';
      return '<tr' + (isActive?' style="background:rgba(201,168,76,0.05)"':'') + '><td><b>' + sym + '</b></td>' + cells + '<td>' + lastCandle + '</td><td>' + badge + '</td></tr>';
    }).join('');

    document.getElementById('refresh-btn').disabled = p.active || d.refreshing;

    /* TD Crypto section */
    const td = d.tdCrypto || {};
    const TD_TFS = ['1m','1h','4h','1d'];
    const tdLoaded = td.loaded || 0;
    const tdTotal  = td.total  || 0;
    document.getElementById('td-stats').textContent = tdLoaded + ' / ' + tdTotal + ' symbols loaded';
    const tdActiveInfo = document.getElementById('td-active-info');
    if (d.tdCryptoRefreshing) { tdActiveInfo.style.display = 'inline-flex'; }
    else { tdActiveInfo.style.display = 'none'; }
    document.getElementById('td-refresh-btn').disabled = !!d.tdCryptoRefreshing;

    function renderTDTable(section, tableId, accentColor, refreshingFlag, statsId, activeInfoId, refreshBtnId) {
      const loaded = section.loaded || 0;
      const total  = section.total  || 0;
      document.getElementById(statsId).textContent = loaded + ' / ' + total + ' symbols loaded';
      const activeEl = document.getElementById(activeInfoId);
      if (refreshingFlag) { activeEl.style.display = 'inline-flex'; } else { activeEl.style.display = 'none'; }
      document.getElementById(refreshBtnId).disabled = !!refreshingFlag;

      const allRows = [...(section.symbols || []), ...(section.notStarted || []).map(s => ({ sym: s, tfs: {} }))];
      document.getElementById(tableId).innerHTML = allRows.map(entry => {
        const sym = entry.sym || entry;
        const tfs = entry.tfs || {};
        const cells = TD_TFS.map(tf => {
          const info = tfs[tf];
          if (!info || !info.candles) return '<td style="color:rgba(255,255,255,0.2)">—</td>';
          return '<td>' + info.candles.toLocaleString() + '</td>';
        }).join('');
        const lastCandle = (() => {
          let latest = null;
          TD_TFS.forEach(tf => { if (tfs[tf]?.lastCandle) { const dt = new Date(tfs[tf].lastCandle); if (!latest || dt > latest) latest = dt; } });
          return latest ? latest.toLocaleTimeString() : '—';
        })();
        const hasTfs = Object.keys(tfs).length > 0;
        const badge = hasTfs
          ? '<span class="badge" style="background:' + accentColor + '22;color:' + accentColor + '">loaded</span>'
          : '<span class="badge badge-empty">pending</span>';
        return '<tr><td><b>' + sym + '</b></td>' + cells + '<td>' + lastCandle + '</td><td>' + badge + '</td></tr>';
      }).join('') || '<tr><td colspan="7" style="color:rgba(255,255,255,0.3);text-align:center;padding:16px">No data yet</td></tr>';
    }

    const tdAllSyms = [...(td.symbols || []), ...(td.notStarted || []).map(s => ({ sym: s, tfs: {} }))];
    renderTDTable(d.tdCrypto || {}, 'td-table',       '#60a5fa', d.tdCryptoRefreshing, 'td-stats',       'td-active-info',       'td-refresh-btn');
    renderTDTable(d.tdForex  || {}, 'td-forex-table', '#4ade80', d.tdForexRefreshing,  'td-forex-stats', 'td-forex-active-info', 'td-forex-refresh-btn');

  } catch(e) { console.error(e); }
}

async function triggerRefresh() {
  const btn = document.getElementById('refresh-btn');
  btn.disabled = true;
  await fetch('/admin/cache-refresh', { method: 'POST', headers: { 'x-admin-key': ADMIN_KEY } });
  poll();
}

async function triggerTDRefresh() {
  const btn = document.getElementById('td-refresh-btn');
  btn.disabled = true;
  await fetch('/admin/td-crypto-refresh', { method: 'POST', headers: { 'x-admin-key': ADMIN_KEY } });
  poll();
}

async function triggerTDForexRefresh() {
  const btn = document.getElementById('td-forex-refresh-btn');
  btn.disabled = true;
  await fetch('/admin/td-forex-refresh', { method: 'POST', headers: { 'x-admin-key': ADMIN_KEY } });
  poll();
}

poll();
setInterval(poll, 2000);
</script>
</body>
</html>`);
});

app.post('/admin/cache-refresh', requireAdmin, (_req, res) => {
  refreshAllOandaCache().catch(e => console.error('[Cache] Manual refresh error:', e.message));
  res.json({ ok: true, message: 'Refresh started' });
});

app.post('/admin/td-crypto-refresh', requireAdmin, (_req, res) => {
  refreshTDCryptoCache(false).catch(e => console.error('[TDCrypto] Manual refresh error:', e.message));
  res.json({ ok: true, message: 'TD Crypto full refresh started' });
});

app.post('/admin/td-forex-refresh', requireAdmin, (_req, res) => {
  refreshTDForexCache(false).catch(e => console.error('[TDForex] Manual refresh error:', e.message));
  res.json({ ok: true, message: 'TD Forex full refresh started' });
});

app.post('/api/predictions/check-now', requireAdmin, async (req, res) => {
  try {
    await checkPredictions();
    res.json({ success: true, message: 'Prediction check completed' });
  } catch (error) {
    console.error('[Manual Check] Error:', error);
    res.status(500).json({ error: 'Check failed' });
  }
});

app.get('/admin/cache-status', requireAdmin, (_req, res) => {
  const buildSymList = (syms, tfsToCheck) => {
    const done = [], empty = [];
    for (const sym of syms) {
      const d = oandaCandles[sym];
      if (!d) { empty.push(sym); continue; }
      const tfInfo = {};
      let hasAny = false;
      for (const tf of tfsToCheck) {
        const len = (d[tf] || []).length;
        const lastT = len ? d[tf][len - 1].t : null;
        tfInfo[tf] = { candles: len, lastCandle: lastT ? new Date(lastT).toISOString() : null };
        if (len > 0) hasAny = true;
      }
      if (hasAny) done.push({ sym, tfs: tfInfo }); else empty.push(sym);
    }
    return { done, empty };
  };

  const oanda    = buildSymList(Object.keys(_maSymMap), TIMEFRAMES);
  const tdCrypto = buildSymList(TD_CRYPTO_SYMBOLS.map(s => s.symbol), TD_CRYPTO_TFS);
  const tdForex  = buildSymList(TD_FOREX_SYMBOLS.map(s => s.symbol),  TD_CRYPTO_TFS);

  res.json({
    metaapi: { status: _maStatus, lastSeen: _maLastSeen ? new Date(_maLastSeen).toISOString() : null, retryCount: _maRetry },
    stream: {
      subscribed: Object.values(_streamStatus).filter(v => v === 'subscribed').length,
      failed:     Object.values(_streamStatus).filter(v => v.startsWith('failed')).length,
      pending:    Object.values(_streamStatus).filter(v => v === 'pending').length,
      details:    _streamStatus,
    },
    refreshing:         _cacheRefreshing,
    tdCryptoRefreshing: _tdCryptoRefreshing,
    tdForexRefreshing:  _tdForexRefreshing,
    total:   Object.keys(_maSymMap).length,
    loaded:  oanda.done.length,
    empty:   oanda.empty.length,
    progress: _cacheProgress,
    symbols:    oanda.done,
    notStarted: oanda.empty,
    tdCrypto: {
      total:      TD_CRYPTO_SYMBOLS.length,
      loaded:     tdCrypto.done.length,
      symbols:    tdCrypto.done,
      notStarted: tdCrypto.empty,
    },
    tdForex: {
      total:      TD_FOREX_SYMBOLS.length,
      loaded:     tdForex.done.length,
      symbols:    tdForex.done,
      notStarted: tdForex.empty,
    },
  });
});

app.get('/admin/stats', requireAdmin, async (req, res) => {
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
        ${predictions.map(p => {
          const safeResult = ['correct','wrong','pending'].includes(p.result) ? p.result : 'pending';
          const resultLabel = safeResult === 'correct' ? '✓ CORRECT' : safeResult === 'wrong' ? '✗ WRONG' : '⏳ PENDING';
          const currentPrice = isNaN(parseFloat(p.current_price)) ? '—' : '$' + parseFloat(p.current_price).toLocaleString();
          const predictedPrice = isNaN(parseFloat(p.predicted_price)) ? '—' : '$' + parseFloat(p.predicted_price).toLocaleString();
          const actualPrice = p.actual_price && !isNaN(parseFloat(p.actual_price)) ? '$' + parseFloat(p.actual_price).toLocaleString() : '—';
          const targetDate = p.target_date ? new Date(p.target_date).toLocaleDateString() : '—';
          return `
          <tr>
            <td>${escapeHtml(p.tool_name)}</td>
            <td><strong>${escapeHtml(p.asset)}</strong></td>
            <td>${escapeHtml(currentPrice)}</td>
            <td>${escapeHtml(predictedPrice)}</td>
            <td>${escapeHtml(actualPrice)}</td>
            <td>${escapeHtml(targetDate)}</td>
            <td><span class="badge badge-${escapeHtml(safeResult)}">${resultLabel}</span></td>
            <td>${p.accuracy_percentage ? escapeHtml(String(p.accuracy_percentage)) + '%' : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>

    <p style="margin-top: 30px; color: rgba(240,244,250,0.4); font-size: 11px; text-align: center;">
      💡 Don't publish stats publicly until accuracy is consistently above 70%
    </p>
  </div>

  <script>
    const _adminKey = new URLSearchParams(location.search).get('key') || '';
    async function checkNow() {
      if (!confirm('Run prediction check now?')) return;

      const btn = event.target;
      btn.disabled = true;
      btn.textContent = '⏳ Checking...';

      try {
        const res = await fetch('/api/predictions/check-now', {
          method: 'POST',
          headers: { 'x-admin-key': _adminKey }
        });
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
   ANALYSIS HISTORY
   ═══════════════════════════════════════════════════ */

const VALID_TOOLS = new Set(['analyze','fib','smc','vol','mtf','age','liq','proj','journal','bar','ww']);

app.post('/save-analysis', rateLimit(30, 60000), async (req, res) => {
  if (!sbAdmin) return res.status(500).json({ error: 'DB not configured' });
  const { tool, pair, timeframe, result, credits, chart_data, _token } = req.body;
  if (!_token) return res.status(401).json({ error: 'Not authenticated' });
  const { data: { user }, error } = await sbAdmin.auth.getUser(_token);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });
  if (!VALID_TOOLS.has(tool)) return res.status(400).json({ error: 'Invalid tool' });

  // Upload chart image server-side using admin key (no RLS needed)
  let chart_url = null;
  console.log('[save-analysis] chart_data type:', typeof chart_data, 'length:', chart_data ? String(chart_data).length : 0);
  if (typeof chart_data === 'string' && chart_data.startsWith('data:image/')) {
    try {
      const base64 = chart_data.split(',')[1];
      const buf    = Buffer.from(base64, 'base64');
      const fname  = `${user.id}/${tool}_${Date.now()}.webp`;
      const { data: upData, error: upErr } = await sbAdmin.storage
        .from('charts')
        .upload(fname, buf, { contentType: 'image/webp', upsert: false });
      if (upErr) { console.warn('[save-analysis] storage upload error:', upErr.message); }
      else if (upData) {
        const { data: pub } = sbAdmin.storage.from('charts').getPublicUrl(upData.path);
        chart_url = pub?.publicUrl || null;
        console.log('[save-analysis] chart uploaded:', chart_url);
      }
    } catch (upEx) { console.warn('[save-analysis] storage upload exception:', upEx.message); }
  }

  const { error: insertErr } = await sbAdmin.from('analyses').insert({
    user_id:   user.id,
    tool:      String(tool).slice(0, 50),
    pair:      String(pair  || '').slice(0, 20).toUpperCase(),
    timeframe: String(timeframe || '').slice(0, 10),
    result:    result || {},
    credits:   parseInt(credits) || 0,
    chart_url: chart_url
  });
  if (insertErr) return res.status(500).json({ error: insertErr.message });
  res.json({ success: true });
});

app.get('/api/analyses', rateLimit(20, 60000), async (req, res) => {
  if (!sbAdmin) return res.status(500).json({ error: 'DB not configured' });
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  const { data: { user }, error } = await sbAdmin.auth.getUser(token);
  if (error || !user) return res.status(401).json({ error: 'Unauthorized' });
  const offset = Math.max(0, parseInt(req.query.offset) || 0);
  const { data, error: fetchErr } = await sbAdmin
    .from('analyses')
    .select('id, tool, pair, timeframe, result, credits, chart_url, created_at')
    .eq('user_id', user.id)
    .order('created_at', { ascending: false })
    .range(offset, offset + 49);
  if (fetchErr) return res.status(500).json({ error: fetchErr.message });
  res.json(data || []);
});

/* ═══════════════════════════════════════════════════
   STRIPE ENDPOINTS
   ═══════════════════════════════════════════════════ */

app.post('/create-checkout', rateLimit(5, 60000), async (req, res) => {
  if (!stripe) return res.status(500).json({ error: 'Stripe not configured' });
  const { plan, token } = req.body;
  if (!plan || !PLANS[plan]) return res.status(400).json({ error: 'Invalid plan' });
  if (!token) return res.status(401).json({ error: 'Please sign in first to subscribe' });
  let userId, userEmail;
  try {
    if (!sbAdmin) {
      userId = 'dev';
    } else {
      const { data: { user }, error } = await sbAdmin.auth.getUser(token);
      if (error || !user) return res.status(401).json({ error: 'Invalid or expired token' });
      userId = user.id;
      userEmail = user.email;
    }
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

app.post('/manage-billing', rateLimit(5, 60000), async (req, res) => {
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

app.post('/fib-spiral-checkout', rateLimit(5, 60000), async (req, res) => {
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

app.post('/fib-spiral-verify', rateLimit(5, 60000), async (req, res) => {
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

  /* TD_DISABLED — prefetch skipped. Re-enable by restoring PREFETCH loop */

  /* Condition weights — load from historical signal outcomes */
  refreshConditionWeights();

  /* OANDA — load disk cache immediately, then full refresh after MetaApi ready */
  loadCacheFromDisk();

  /* TwelveData crypto — load from disk, then fetch fresh in background */
  setTimeout(() => refreshTDCryptoCache(false), 5000);

  /* TwelveData forex — staggered 10s after crypto to avoid API rate limit overlap */
  setTimeout(() => refreshTDForexCache(false), 10000);

  if (METAAPI_TOKEN) {
    setTimeout(() => {
      console.log('[MetaApi] Initializing OANDA connection...');
      initMetaApi().then(() => {
        if (_maReady) {
          refreshAllOandaCache();
          /* Refresh again every 12 hours */
          setInterval(() => refreshAllOandaCache(), 12 * 3600 * 1000);
        } else {
          console.warn('[MetaApi] Not ready — OANDA unavailable');
        }
      });
    }, 30000);
  }

  cron.schedule('0 2 * * *', () => {
    console.log('\n⏰ [Scheduled] Running daily prediction check...');
    checkPredictions();
    checkSniperOutcomes();
  });
  /* Sniper signals resolve faster — check every 6 hours */
  cron.schedule('0 */6 * * *', () => {
    console.log('\n🎯 [Scheduled] Running sniper outcome check...');
    checkSniperOutcomes();
  });
  /* Scanner — runs every 30 minutes */
  cron.schedule('*/30 * * * *', () => {
    if (Object.keys(oandaCandles).length > 0) {
      console.log('\n🔄 [Scheduled] Running sniper scanner...');
      runSniperScanner();
    }
  });
  /* SMA crossover scanner — runs every 10 minutes */
  cron.schedule('*/10 * * * *', () => {
    if (Object.keys(oandaCandles).length > 0) {
      runCrossoverScanner();
    }
  });
  /* TwelveData crypto — incremental refresh every 12 hours */
  cron.schedule('0 */12 * * *', () => {
    console.log('\n📊 [Scheduled] Refreshing TwelveData crypto cache...');
    refreshTDCryptoCache(true);
  });
  /* TwelveData forex — incremental refresh every 12 hours (offset 30min to avoid collision) */
  cron.schedule('30 */12 * * *', () => {
    console.log('\n📊 [Scheduled] Refreshing TwelveData forex cache...');
    refreshTDForexCache(true);
  });

  console.log('✅ Prediction tracking: Daily check scheduled (2:00 AM)');
  console.log('🎯 Sniper outcome tracker: Every 6 hours');
  console.log('🔄 Sniper scanner: Every 30 minutes');
  console.log('📈 SMA crossover scanner: Every 10 minutes');
  console.log('📊 TwelveData crypto cache: Every 12 hours');
  console.log('📊 TwelveData forex cache:  Every 12 hours (offset 30m)');
});
