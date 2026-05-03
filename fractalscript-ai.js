/* ═══════════════════════════════════════════════════════════════
   FractalScript AI Assistant — Server Routes
   
   Isolated module for AI-powered code fixing and generation.
   Uses Claude Haiku 3.5 via Anthropic API.
   
   Usage: require('./fractalscript-ai')(app)
   ═══════════════════════════════════════════════════════════════ */

const https = require('https');

/* ── FractalScript Reference (compact, token-efficient) ── */
const FS_REFERENCE = `You are a FractalScript code expert. FractalScript is a Pine Script v5 compatible language for trading indicators and strategies.

SYNTAX RULES:
- Must start with //@version=5
- Must have indicator("Name", ...) or strategy("Name", ...)
- Variables: x = expr (declare), x := expr (reassign), var x = expr (persistent)
- Type annotations optional: float x = 1.0, string s = "hi", int n = 5
- Functions: myFunc(a, b) => body (single-line) or multi-line with indented block
- Blocks use 4-space indentation (no braces)
- if/else, for/to/by, for/in, while, switch with => cases
- Tuple destructuring: [a, b, c] = ta.bb(close, 20, 2)
- Ternary: condition ? valueA : valueB
- History reference: close[1] (previous bar), close[5] (5 bars ago)
- Operators: +, -, *, /, %, ==, !=, <, >, <=, >=, and, or, not
- Compound: +=, -=, *=, /=
- Comments: // single line only

BUILT-IN FUNCTIONS:
- ta.sma(src, len), ta.ema(src, len), ta.wma(src, len), ta.rma(src, len)
- ta.rsi(src, len), ta.macd(src, fast, slow, sig) → [macdLine, signal, hist]
- ta.bb(src, len, mult) → [mid, upper, lower]
- ta.stoch(close, high, low, len), ta.cci(src, len), ta.atr(len)
- ta.highest(src, len), ta.lowest(src, len), ta.tr (true range)
- ta.crossover(a, b), ta.crossunder(a, b), ta.change(src, len)
- ta.cum(src), ta.valuewhen(cond, src, occurrence)
- ta.pivothigh(src, leftbars, rightbars), ta.pivotlow(src, leftbars, rightbars)
- ta.vwap(src), ta.vwap_session(src, vol, time), ta.supertrend(multiplier, period) → [st, dir]
- ta.dmi(len, smooth) → [plus, minus, adx], ta.donchian(len) → [up, low, mid]
- ta.mfi(src, len), ta.obv(), ta.standardize(src, len)
- ta.all(cond, len), ta.any(cond, len), ta.median(src, len), ta.range(src, len)

PLOTTING:
- plot(value, title="", color=color.blue, linewidth=1)
- plotshape(condition, style=shape.triangleup, location=location.belowbar, color=color.green, size=size.small)
- bgcolor(color), hline(price, title="", color=color.gray)

COLORS: color.red, color.green, color.blue, color.orange, color.purple, color.yellow, color.white, color.black, color.gray, color.aqua, color.fuchsia, color.lime, color.maroon, color.navy, color.olive, color.silver, color.teal
- color.new(baseColor, transparency) — transparency 0-100

SERIES: open, high, low, close, volume, bar_index, time
- math.abs(x), math.max(a,b), math.min(a,b), math.round(x), math.sqrt(x), math.pow(x,y), math.log(x), math.ceil(x), math.floor(x)
- str.tostring(val), str.format(fmt, args...), str.contains(s, sub), str.length(s), str.new(val)
- array.new<float>(size, val), array.push(arr, val), array.get(arr, idx), array.set(arr, idx, val), array.size(arr)
- array.standardize(arr), array.mode(arr), array.percentile_linear_interpolation(arr, perc), array.covariance(arr1, arr2)
- array.variance(arr), array.stdev(arr)
- matrix.new<float>(rows, cols, val), matrix.get(m, r, c), matrix.set(m, r, c, val), matrix.mult(m1, m2), matrix.transpose(m), matrix.inv(m)
- nz(val, replacement), na(val) — check if NA
- input(defval, title="", type=input.int) or input.int(defval, title="")
- timestamp(year, month, day, hour, min, sec)

STRATEGY (when using strategy()):
- strategy.entry(id, direction), strategy.close(id)
- strategy.long, strategy.short

SHAPES: shape.triangleup, shape.triangledown, shape.cross, shape.circle, shape.xcross, shape.diamond, shape.arrowup, shape.arrowdown, shape.flag, shape.labelup, shape.labeldown, shape.square
LOCATIONS: location.abovebar, location.belowbar, location.top, location.bottom, location.absolute
SIZES: size.auto, size.tiny, size.small, size.normal, size.large, size.huge`;

/* ── Anthropic API caller (simplified, no image support needed) ── */
function callHaiku(apiKey, systemPrompt, userPrompt, maxTokens) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: maxTokens || 2000,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }]
    });

    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => { data += c; });
      res.on('end', () => {
        try {
          const obj = JSON.parse(data);
          if (obj.error) return reject(new Error(obj.error.message));
          const text = obj.content && obj.content[0] ? obj.content[0].text : '';
          resolve(text);
        } catch (e) {
          reject(new Error('Failed to parse Anthropic response'));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/* ── Route installer ── */
module.exports = function (app) {

  /* ─────────────────────────────────────────────
     POST /api/ai/fix
     Auto-fix a parser/runtime error in FractalScript
     Body: { code: string, error: { line, col, message } }
     ───────────────────────────────────────────── */
  app.post('/api/ai/fix', async (req, res) => {
    const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim().replace(/^["'>\s]+|["'>\s]+$/g, '');
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

    const { code, error } = req.body;
    if (!code || !error) return res.status(400).json({ error: 'Missing code or error' });

    const userPrompt = `Fix this FractalScript code. The error is:
Line ${error.line}:${error.col} — ${error.message}

Return ONLY the corrected code. No explanation, no markdown fences, no comments about what you changed. Just the raw fixed code.

Code:
${code}`;

    try {
      const fixed = await callHaiku(apiKey, FS_REFERENCE + '\n\nYou are a code fixer. Return ONLY corrected code, nothing else.', userPrompt, 2000);
      
      // Strip markdown fences if Haiku wraps them
      let cleanCode = fixed.trim();
      if (cleanCode.startsWith('```')) {
        cleanCode = cleanCode.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
      }
      
      res.json({ fixed: cleanCode.trim() });
    } catch (err) {
      console.error('[AI Fix]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /* ─────────────────────────────────────────────
     POST /api/ai/generate
     Generate FractalScript from natural language
     Body: { prompt: string }
     ───────────────────────────────────────────── */
  app.post('/api/ai/generate', async (req, res) => {
    const apiKey = (process.env.ANTHROPIC_API_KEY || '').trim().replace(/^["'>\s]+|["'>\s]+$/g, '');
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set' });

    const { prompt } = req.body;
    if (!prompt) return res.status(400).json({ error: 'Missing prompt' });

    const userPrompt = `Generate a complete FractalScript indicator or strategy based on this request:

"${prompt}"

Return ONLY the complete FractalScript code starting with //@version=5. No explanation, no markdown fences. Just the raw code.`;

    try {
      const generated = await callHaiku(apiKey, FS_REFERENCE + '\n\nYou are a code generator. Return ONLY valid FractalScript code, nothing else. Always start with //@version=5 and include an indicator() or strategy() declaration.', userPrompt, 3000);
      
      let cleanCode = generated.trim();
      if (cleanCode.startsWith('```')) {
        cleanCode = cleanCode.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/, '');
      }
      
      res.json({ code: cleanCode.trim() });
    } catch (err) {
      console.error('[AI Generate]', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /* ─────────────────────────────────────────────
     GET /api/ai/debug
     Check if AI keys are configured
     ───────────────────────────────────────────── */
  app.get('/api/ai/debug', (req, res) => {
    const apiKeyRaw = process.env.ANTHROPIC_API_KEY || '';
    const apiKey = apiKeyRaw.trim().replace(/^["'>\s]+|["'>\s]+$/g, '');
    const isSet = apiKey.length > 20;
    const hiddenKey = isSet ? (apiKey.substring(0, 7) + '...' + apiKey.substring(apiKey.length - 4)) : 'NOT SET';
    
    res.json({
      configured: isSet,
      key_preview: hiddenKey,
      raw_length: apiKeyRaw.length,
      cleaned_length: apiKey.length,
      model: 'claude-haiku-4-5-20251001',
      status: isSet ? 'Ready' : 'Missing ANTHROPIC_API_KEY in .env'
    });
  });

  console.log('[FractalScript AI] Routes mounted: /api/ai/fix, /api/ai/generate');
};
