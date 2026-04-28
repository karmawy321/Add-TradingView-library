


    /* ══════════════════════════════════════════════════════
       SUPABASE CONFIG — paste your keys here
       ══════════════════════════════════════════════════════ */
    var SUPABASE_URL = 'https://pvkweqyrwbmcsczpjvhj.supabase.co';
    var SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InB2a3dlcXlyd2JtY3NjenBqdmhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQwMjk5MTIsImV4cCI6MjA4OTYwNTkxMn0.RmyJM3wv63V57wnyGoFJ6q65UFoKccG91UdB683N284';
    var sb = null;
    var sbReady = false;

    function initSupabase() {
      try {
        if (typeof supabase !== 'undefined' && supabase.createClient) {
          sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
          sbReady = true;
          loadLocalSession();
          refreshSession();
          /* Keep fractal_token fresh — Supabase auto-refreshes JWT every ~50min */
          sb.auth.onAuthStateChange(function (event, session) {
            if (session && session.access_token) {
              localStorage.setItem('fractal_token', session.access_token);
              if (event === 'TOKEN_REFRESHED') console.log('[Auth] Token refreshed silently');
            } else if (event === 'SIGNED_OUT') {
              localStorage.removeItem('fractal_token');
            }
          });
        } else {
          setTimeout(initSupabase, 100);
        }
      } catch (e) {
        console.warn('Supabase init error:', e);
        loadLocalSession();
      }
    }
    initSupabase();

    /* ══ CREDIT COSTS per tool ══ */
    var TOOL_COSTS = {
      analyze: 15, fib: 12, smc: 16, vol: 12, mtf: 20, age: 15, liq: 20, proj: 25, journal: 20, bar: 12, ww: 12, sniper: 5, backtest: 40
    };

    /* Icons match the tool-result-section headers */
    var TOOLS = [
      { id: 'fib', label: 'Fibonacci', sub: 'Auto levels · Extensions', icon: '⟡', endpoint: '/fibonacci', cost: 12, tier: 'pro' },
      { id: 'smc', label: 'Smart Money', sub: 'Order blocks · BOS · FVG', icon: '⬡', endpoint: '/smc', cost: 16, tier: 'pro' },
      { id: 'vol', label: 'Volatility', sub: 'Regime · Position size', icon: '≋', endpoint: '/volatility', cost: 12, tier: 'pro' },
      { id: 'bar', label: 'Bar Pattern', sub: 'Self-similarity scan', icon: '▦', endpoint: '/bar-pattern', cost: 12, tier: 'pro' },
      { id: 'ww', label: 'Weierstrass', sub: 'Hurst · Decomposition', icon: '∿', endpoint: '/weierstrass', cost: 12, tier: 'pro' },
      { id: 'proj', label: 'Projection', sub: '3-scenario price path', icon: '↗', endpoint: '/projection', cost: 25, tier: 'pro' },
      { id: 'mtf', label: 'MTF Confluence', sub: 'Weekly · Daily · H4', icon: '⊕', endpoint: '/mtf', cost: 20, tier: 'mentor' },
      { id: 'age', label: 'Fractal Age', sub: 'Cycle timing · Urgency', icon: '⧗', endpoint: '/fractal-age', cost: 15, tier: 'mentor' },
      { id: 'liq', label: 'Liquidity Map', sub: 'Stop clusters · Sweeps', icon: '◎', endpoint: '/liquidity', cost: 20, tier: 'mentor' },
      { id: 'journal', label: 'Trade Journal', sub: 'AI graded · Coaching', icon: '✦', endpoint: '/journal', cost: 20, tier: 'mentor' },
      { id: 'sniper', label: 'Sniper', sub: 'Entry · SL · TP · Pips', icon: '⊗', endpoint: '/sniper', cost: 5, tier: 'starter' },
      { id: 'backtest', label: 'Backtest', sub: 'Walk-forward · Sharpe · MC', icon: '◈', endpoint: '/backtest', cost: 40, tier: 'mentor' }
    ];

    /* ══ SNIPER SIGNAL ══ */
    window._sniperSignal = null;

    function _snRow(label, val, color) {
      return '<div class="sn-row"><span style="color:#4e5d78">' + label + '</span><span style="color:' + color + ';font-weight:700">' + val + '</span></div>';
    }

    function renderSniper(r) {
      window._sniperSignal = r;
      var card = document.getElementById('sniperCard');
      if (!card) return;
      var isLong = (r.direction || '').toLowerCase() === 'long';
      var dirColor = isLong ? '#27ae60' : '#e74c3c';
      var dirLabel = isLong ? '▲ LONG' : '▼ SHORT';
      var conf = parseInt(r.confidence) || 0;
      var confColor = conf >= 70 ? '#27ae60' : conf >= 55 ? '#e67e22' : '#e74c3c';
      card.innerHTML =
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:9px">' +
        '<span style="font-size:13px;font-weight:700;color:' + dirColor + ';letter-spacing:.06em">' + dirLabel + '</span>' +
        '<div style="display:flex;align-items:center;gap:8px">' +
        '<span style="font-size:9px;color:#4e5d78">' + (r.pair || '') + ' · ' + (r.timeframe || '') + '</span>' +
        '<button onclick="_closeSniperCard()" style="background:none;border:none;color:#6a7a90;font-size:15px;line-height:1;cursor:pointer;padding:0 2px" title="Close">\u00d7</button>' +
        '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column">' +
        _snRow('ENTRY', r.entry, '#c9a84c') +
        _snRow('SL', r.sl + '  \u2212' + r.sl_pips + 'p / \u2212' + r.sl_pct + '%', '#e74c3c') +
        _snRow('TP1', r.tp1 + '  +' + r.tp1_pips + 'p / +' + r.tp1_pct + '%', '#27ae60') +
        _snRow('TP2', r.tp2 + '  +' + r.tp2_pips + 'p / +' + r.tp2_pct + '%', '#2ecc71') +
        _snRow('RR', (r.rr1 || '') + ' / ' + (r.rr2 || ''), 'var(--gold)') +
        _snRow('CONF', conf + '%', confColor) +
        '</div>' +
        (r.patterns && r.patterns.length > 0 ?
          '<div style="margin-top:6px;padding-top:5px;border-top:1px solid rgba(255,255,255,.04);display:flex;flex-wrap:wrap;gap:3px">' +
          r.patterns.slice(0, 4).map(function (p) {
            var bg = p.type === 'bullish' ? (p.confirmed ? 'rgba(39,174,96,.22)' : 'rgba(39,174,96,.08)')
              : p.type === 'bearish' ? (p.confirmed ? 'rgba(231,76,60,.22)' : 'rgba(231,76,60,.08)')
                : 'rgba(78,93,120,.18)';
            var bdr = p.type === 'bullish' ? 'rgba(39,174,96,.5)' : p.type === 'bearish' ? 'rgba(231,76,60,.5)' : 'rgba(78,93,120,.4)';
            var clr = p.type === 'bullish' ? '#27ae60' : p.type === 'bearish' ? '#e74c3c' : '#4e5d78';
            var dot = p.confirmed ? '\u25cf ' : '\u25cb ';
            return '<span style="font-size:7.5px;padding:2px 5px;border-radius:2px;background:' + bg + ';border:1px solid ' + bdr + ';color:' + clr + ';white-space:nowrap">' + dot + p.name + '</span>';
          }).join('') +
          '</div>'
          : '') +
        '<div style="margin-top:8px;padding-top:7px;border-top:1px solid rgba(255,255,255,.06);font-size:8px;color:#4e5d78;line-height:1.55">' + (r.reasoning || '') + '</div>' +
        '<button onclick="_copySniperSignal()" style="margin-top:9px;width:100%;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.3);color:#c9a84c;font-family:\'DM Mono\',monospace;font-size:9px;padding:5px 0;cursor:pointer;border-radius:2px;letter-spacing:.04em">Copy for Telegram \u2736</button>';
      card.style.display = 'block';
      renderChart();
    }

    function _copySniperSignal() {
      var s = window._sniperSignal;
      if (!s) return;
      var dir = (s.direction || '').toLowerCase() === 'long' ? '\uD83D\uDFE2 LONG' : '\uD83D\uDD34 SHORT';
      var txt = dir + ' ' + (s.pair || '') + ' ' + (s.timeframe || '') + '\n' +
        'Entry:  ' + s.entry + '\n' +
        'SL:     ' + s.sl + '  (-' + s.sl_pips + ' pips / -' + s.sl_pct + '%)\n' +
        'TP1:    ' + s.tp1 + '  (+' + s.tp1_pips + ' pips / +' + s.tp1_pct + '%)\n' +
        'TP2:    ' + s.tp2 + '  (+' + s.tp2_pips + ' pips / +' + s.tp2_pct + '%)\n' +
        'RR:     ' + (s.rr1 || '') + ' / ' + (s.rr2 || '') + '\n' +
        'Conf:   ' + (s.confidence || '') + '%\n\n' +
        (s.reasoning || '') + '\n\n' +
        '\uD83D\uDCCA fractalaiagent.com';
      navigator.clipboard.writeText(txt).then(function () {
        var btn = document.querySelector('#sniperCard button');
        if (btn) { btn.textContent = 'Copied! \u2713'; setTimeout(function () { btn.textContent = 'Copy for Telegram \u2736'; }, 2000); }
      });
    }

    function _closeSniperCard() {
      window._sniperSignal = null;
      var card = document.getElementById('sniperCard');
      if (card) card.style.display = 'none';
      if (typeof renderChart === 'function') renderChart();
    }

    window._drawSniperOverlay = function (ctx, W, H) {
      var sig = window._sniperSignal;
      if (!sig || !sig.entry) return;
      var PAD = { l: 8, r: 75, t: 16, b: 56, vol: 40 };
      var CH = H - PAD.t - PAD.b - PAD.vol;
      function py(price) {
        if (viewState.priceMax === viewState.priceMin) return PAD.t + CH / 2;
        return PAD.t + CH - ((price - viewState.priceMin) / (viewState.priceMax - viewState.priceMin)) * CH;
      }
      var xL = PAD.l, xR = W - PAD.r;
      var yEntry = py(sig.entry), ySL = py(sig.sl), yTP1 = py(sig.tp1), yTP2 = py(sig.tp2);
      ctx.save();
      /* Shaded zones */
      ctx.fillStyle = 'rgba(231,76,60,0.08)';
      ctx.fillRect(xL, Math.min(yEntry, ySL), xR - xL, Math.abs(ySL - yEntry));
      ctx.fillStyle = 'rgba(39,174,96,0.09)';
      ctx.fillRect(xL, Math.min(yEntry, yTP1), xR - xL, Math.abs(yTP1 - yEntry));
      ctx.fillStyle = 'rgba(46,204,113,0.05)';
      ctx.fillRect(xL, Math.min(yTP1, yTP2), xR - xL, Math.abs(yTP2 - yTP1));
      /* SL line */
      ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(xL, ySL); ctx.lineTo(xR, ySL); ctx.stroke();
      /* TP2 line */
      ctx.strokeStyle = '#2ecc71'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(xL, yTP2); ctx.lineTo(xR, yTP2); ctx.stroke();
      /* TP1 line */
      ctx.strokeStyle = '#27ae60'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(xL, yTP1); ctx.lineTo(xR, yTP1); ctx.stroke();
      /* Entry line */
      ctx.strokeStyle = '#c9a84c'; ctx.lineWidth = 2; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(xL, yEntry); ctx.lineTo(xR, yEntry); ctx.stroke();
      /* Labels — right-side badges */
      ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'left';
      var badges = [
        { y: yEntry, bg: '#c9a84c', fg: '#050810', txt: 'ENTRY ' + sig.entry },
        { y: ySL, bg: 'rgba(231,76,60,.85)', fg: '#fff', txt: 'SL \u2212' + sig.sl_pips + 'p' },
        { y: yTP1, bg: 'rgba(39,174,96,.85)', fg: '#fff', txt: 'TP1 +' + sig.tp1_pips + 'p' },
        { y: yTP2, bg: 'rgba(46,204,113,.7)', fg: '#fff', txt: 'TP2 +' + sig.tp2_pips + 'p' }
      ];
      badges.forEach(function (b) {
        ctx.fillStyle = b.bg;
        ctx.fillRect(xR + 2, b.y - 8, 70, 14);
        ctx.fillStyle = b.fg;
        ctx.fillText(b.txt, xR + 5, b.y + 3);
      });
      /* Direction arrow at entry */
      ctx.font = 'bold 13px DM Mono'; ctx.textAlign = 'left';
      ctx.fillStyle = (sig.direction || '').toLowerCase() === 'long' ? '#27ae60' : '#e74c3c';
      ctx.fillText((sig.direction || '').toLowerCase() === 'long' ? '\u25B2' : '\u25BC', xL + 6, yEntry - 5);
      /* Pattern necklines & trendlines */
      if (sig.patterns && sig.patterns.length > 0) {
        ctx.font = 'bold 8px DM Mono'; ctx.textAlign = 'left';
        sig.patterns.forEach(function (p) {
          var linePrice = p.neckline != null ? p.neckline
            : p.supportLine != null ? p.supportLine
              : null;
          var line2Price = p.resistanceLine != null ? p.resistanceLine : null;
          var lineColor = p.type === 'bullish' ? 'rgba(39,174,96,.55)'
            : p.type === 'bearish' ? 'rgba(231,76,60,.55)'
              : 'rgba(130,100,200,.55)';
          var shortName = p.name.replace('Inverse ', 'Inv ').replace(' & ', '/').replace('Broadening / ', '');
          function drawPatternLine(price, label) {
            var yP = py(price);
            if (yP < PAD.t - 10 || yP > PAD.t + CH + 10) return; // off-screen, skip
            ctx.strokeStyle = lineColor; ctx.lineWidth = 1; ctx.setLineDash([3, 6]);
            ctx.beginPath(); ctx.moveTo(xL, yP); ctx.lineTo(xR, yP); ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = lineColor;
            ctx.fillText(label, xL + 4, yP - 3);
          }
          if (linePrice != null) drawPatternLine(linePrice, shortName + (p.neckline != null ? ' neck' : ' S'));
          if (line2Price != null) drawPatternLine(line2Price, shortName + ' R');
        });
        ctx.setLineDash([]);
      }
      ctx.restore();
    };

    /* ══ BACKTEST RESULTS PANEL ══ */

    function drawEquityCurve(canvas, curve, startEquity) {
      var ctx = canvas.getContext('2d');
      var W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      if (!curve || curve.length < 2) return;
      var minV = Math.min.apply(null, curve), maxV = Math.max.apply(null, curve);
      var range = maxV - minV || 1;
      var pad = { l: 2, r: 2, t: 10, b: 6 };
      var cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
      var isProfit = curve[curve.length - 1] >= startEquity;
      function px(i) { return pad.l + (i / (curve.length - 1)) * cW; }
      function py(v) { return pad.t + cH - ((v - minV) / range) * cH; }
      ctx.fillStyle = '#080c18'; ctx.fillRect(0, 0, W, H);
      /* Start-equity reference line */
      if (startEquity >= minV && startEquity <= maxV) {
        ctx.strokeStyle = 'rgba(255,255,255,.1)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(pad.l, py(startEquity)); ctx.lineTo(W - pad.r, py(startEquity)); ctx.stroke();
        ctx.setLineDash([]);
      }
      /* Filled area */
      ctx.beginPath();
      ctx.moveTo(px(0), py(curve[0]));
      for (var i = 1; i < curve.length; i++) ctx.lineTo(px(i), py(curve[i]));
      ctx.lineTo(px(curve.length - 1), H - pad.b);
      ctx.lineTo(px(0), H - pad.b);
      ctx.closePath();
      var grad = ctx.createLinearGradient(0, 0, 0, H);
      grad.addColorStop(0, isProfit ? 'rgba(39,174,96,.4)' : 'rgba(231,76,60,.4)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad; ctx.fill();
      /* Line */
      ctx.beginPath();
      ctx.moveTo(px(0), py(curve[0]));
      for (var j = 1; j < curve.length; j++) ctx.lineTo(px(j), py(curve[j]));
      ctx.strokeStyle = isProfit ? '#27ae60' : '#e74c3c'; ctx.lineWidth = 1.5; ctx.stroke();
      /* Start / end labels */
      ctx.font = '8px DM Mono'; ctx.textAlign = 'left'; ctx.fillStyle = '#4e5d78';
      ctx.fillText('$' + Math.round(curve[0]).toLocaleString(), pad.l + 3, py(curve[0]) - 3);
      ctx.textAlign = 'right'; ctx.fillStyle = isProfit ? '#27ae60' : '#e74c3c';
      ctx.fillText('$' + Math.round(curve[curve.length - 1]).toLocaleString(), W - pad.r - 3, py(curve[curve.length - 1]) - 3);
    }

    function renderBacktest(r) {
      var bt = document.getElementById('btResult');
      if (!bt) {
        bt = document.createElement('div');
        bt.id = 'btResult';
        bt.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:500;max-height:65vh;overflow-y:auto;' +
          'background:#060a14;border-top:1px solid rgba(201,168,76,.35);box-shadow:0 -12px 40px rgba(0,0,0,.85)';
        document.body.appendChild(bt);
      }
      if (!r || !r.metrics) {
        bt.innerHTML = '<div style="padding:16px 20px;font-family:\'DM Mono\',monospace;font-size:11px;color:#4e5d78">' +
          'No trades generated. Try loading more candles or lowering the confidence threshold.</div>' +
          '<button onclick="document.getElementById(\'btResult\').style.display=\'none\'" ' +
          'style="position:absolute;top:8px;right:14px;background:none;border:none;color:#6a7a90;font-size:20px;cursor:pointer;line-height:1">×</button>';
        bt.style.display = 'block'; return;
      }
      var m = r.metrics, mc = r.monteCarlo;
      var isProfit = m.finalEquity >= m.startEquity;
      var wnC = m.winRate >= 0.55 ? '#27ae60' : m.winRate >= 0.45 ? '#e67e22' : '#e74c3c';
      var pfC = m.profitFactor >= 1.5 ? '#27ae60' : m.profitFactor >= 1.0 ? '#e67e22' : '#e74c3c';
      var shC = m.sharpe >= 1.0 ? '#27ae60' : m.sharpe >= 0 ? '#e67e22' : '#e74c3c';
      var ddC = m.maxDrawdown > 0.15 ? '#e74c3c' : m.maxDrawdown > 0.08 ? '#e67e22' : '#27ae60';
      function stat(label, val, color) {
        return '<div style="flex:1;min-width:90px;padding:8px 12px;border-right:1px solid rgba(255,255,255,.05)">' +
          '<div style="font-size:8px;color:#4e5d78;margin-bottom:3px;text-transform:uppercase;letter-spacing:.05em">' + label + '</div>' +
          '<div style="font-size:14px;font-weight:700;color:' + (color || '#dde4ee') + '">' + val + '</div></div>';
      }
      /* Period in days */
      var periodDays = (r.trades.length > 0 && r.trades[r.trades.length - 1].exitTime && r.trades[0].entryTime)
        ? Math.round((r.trades[r.trades.length - 1].exitTime - r.trades[0].entryTime) / 86400000) : '?';
      /* Trade log rows (max 50) */
      var tradeRows = (r.trades || []).slice(0, 50).map(function (t, i) {
        var pC = t.pnlR >= 0 ? '#27ae60' : '#e74c3c';
        var oC = t.outcome === 'sl_hit' ? '#e74c3c' : t.outcome === 'open' ? '#c9a84c' : '#27ae60';
        var pats = (t.patterns || []).slice(0, 2).join(', ') || '\u2014';
        return '<tr style="border-bottom:1px solid rgba(255,255,255,.03)">' +
          '<td style="padding:5px 8px;color:#4e5d78">' + (i + 1) + '</td>' +
          '<td style="padding:5px 8px;color:' + (t.direction === 'long' ? '#27ae60' : '#e74c3c') + '">' + (t.direction === 'long' ? '\u25b2 L' : '\u25bc S') + '</td>' +
          '<td style="padding:5px 8px">' + t.confidence + '%</td>' +
          '<td style="padding:5px 8px;color:#8a95a8;font-size:9px">' + (t.setup_type || '\u2014').replace(/_/g, ' ') + '</td>' +
          '<td style="padding:5px 8px;font-size:9px;color:#6a7a90;max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + (t.patterns || []).join(', ') + '">' + pats + '</td>' +
          '<td style="padding:5px 8px;color:' + oC + '">' + t.outcome.replace(/_/g, ' ') + '</td>' +
          '<td style="padding:5px 8px;color:' + pC + ';font-weight:700">' + (t.pnlR >= 0 ? '+' : '') + t.pnlR + 'R</td>' +
          '<td style="padding:5px 8px;color:#4e5d78">' + t.barsHeld + '</td></tr>';
      }).join('');

      bt.innerHTML =
        /* Header */
        '<div style="padding:10px 16px;border-bottom:1px solid rgba(255,255,255,.06);display:flex;align-items:center;justify-content:space-between;font-family:\'DM Mono\',monospace">' +
        '<span style="font-size:12px;font-weight:700;color:#c9a84c;letter-spacing:.06em">BACKTEST RESULTS</span>' +
        '<div style="display:flex;gap:16px;align-items:center">' +
        '<span style="font-size:9px;color:#4e5d78">' + m.closedTrades + ' closed trades \u00b7 ' + periodDays + 'd period \u00b7 1% risk/trade</span>' +
        '<button onclick="document.getElementById(\'btResult\').style.display=\'none\'" style="background:none;border:none;color:#6a7a90;font-size:20px;cursor:pointer;padding:0 4px;line-height:1">\u00d7</button>' +
        '</div>' +
        '</div>' +
        /* Metrics bar */
        '<div style="display:flex;flex-wrap:wrap;border-bottom:1px solid rgba(255,255,255,.06);font-family:\'DM Mono\',monospace">' +
        stat('Win Rate', (m.winRate * 100).toFixed(1) + '%', wnC) +
        stat('Profit Factor', m.profitFactor, pfC) +
        stat('Sharpe', m.sharpe, shC) +
        stat('Max Drawdown', (m.maxDrawdown * 100).toFixed(1) + '%', ddC) +
        stat('Net PnL', (m.netPnlR >= 0 ? '+' : '') + m.netPnlR + 'R', isProfit ? '#27ae60' : '#e74c3c') +
        stat('Final Equity', '$' + m.finalEquity.toLocaleString(), isProfit ? '#27ae60' : '#e74c3c') +
        stat('Avg Bars', m.avgBarsHeld, '#dde4ee') +
        stat('Trades', m.closedTrades, '#dde4ee') +
        '</div>' +
        /* Equity curve canvas */
        '<canvas id="btCanvas" style="width:100%;height:90px;display:block"></canvas>' +
        /* Monte Carlo */
        (mc ? '<div style="padding:7px 16px;font-size:9px;color:#4e5d78;border-bottom:1px solid rgba(255,255,255,.04);display:flex;gap:16px;flex-wrap:wrap;font-family:\'DM Mono\',monospace">' +
          '<span>Monte Carlo \u00b7 1000 shuffles \u2014</span>' +
          '<span>5th%: <span style="color:#e74c3c">$' + mc.p5.toLocaleString() + '</span></span>' +
          '<span>50th%: <span style="color:#c9a84c">$' + mc.p50.toLocaleString() + '</span></span>' +
          '<span>95th%: <span style="color:#27ae60">$' + mc.p95.toLocaleString() + '</span></span>' +
          '</div>' : '') +
        /* Pattern edge */
        (m.patternWinRate !== null ? '<div style="padding:7px 16px;font-size:9px;border-bottom:1px solid rgba(255,255,255,.04);color:#4e5d78;font-family:\'DM Mono\',monospace">' +
          'Pattern edge \u2014 With confirmed pattern: <span style="color:#c9a84c">' + (m.patternWinRate * 100).toFixed(1) + '%</span> win rate' +
          ' \u00b7 Without: <span style="color:#c9a84c">' + (m.noPatternWinRate * 100).toFixed(1) + '%</span>' +
          '</div>' : '') +
        /* Trade log */
        '<div style="overflow-x:auto;font-family:\'DM Mono\',monospace">' +
        '<table style="width:100%;border-collapse:collapse;font-size:10px">' +
        '<thead><tr style="background:rgba(255,255,255,.03);color:#4e5d78;text-align:left">' +
        '<th style="padding:6px 8px">#</th><th style="padding:6px 8px">Dir</th>' +
        '<th style="padding:6px 8px">Conf</th><th style="padding:6px 8px">Setup</th>' +
        '<th style="padding:6px 8px">Patterns</th><th style="padding:6px 8px">Outcome</th>' +
        '<th style="padding:6px 8px">PnL</th><th style="padding:6px 8px">Bars</th>' +
        '</tr></thead>' +
        '<tbody>' + tradeRows + '</tbody>' +
        '</table>' +
        '</div>' +
        (r.trades.length > 50 ? '<div style="padding:8px 16px;font-size:9px;color:#4e5d78;font-family:\'DM Mono\',monospace">Showing first 50 of ' + r.trades.length + ' trades</div>' : '');

      bt.style.display = 'block';

      /* Draw equity curve after layout settles */
      requestAnimationFrame(function () {
        var canvas = document.getElementById('btCanvas');
        if (canvas) {
          canvas.width = canvas.offsetWidth || 800;
          canvas.height = canvas.offsetHeight || 90;
          drawEquityCurve(canvas, r.equityCurve, m.startEquity);
        }
      });
    }

    function buildToolGrid() {
      var grid = document.getElementById('aiToolGrid') || document.getElementById('toolGrid');
      if (!grid) return;
      grid.innerHTML = '';
      var hasChart = (typeof dataUrl !== 'undefined' && dataUrl) ||
        (typeof chartCandles !== 'undefined' && chartCandles && chartCandles.length > 1);
      TOOLS.forEach(function (t) {
        var allowed = tierAllows(t.id);
        var card = document.createElement('button');
        card.className = 'ai-tc';
        card.id = 'tbtn-' + t.id;
        if (!hasChart || !allowed) card.setAttribute('disabled', true);
        card.innerHTML =
          '<div class="ai-tc-icon">' + t.icon + '</div>' +
          '<div class="ai-tc-name">' + t.label + '</div>' +
          '<div class="ai-tc-sub">' + t.sub + '</div>' +
          '<div class="ai-tc-footer">' +
          '<span class="ai-tc-cr">' + t.cost + ' cr</span>' +
          (!allowed ? '<span class="ai-tc-lock">🔒</span>' : '') +
          '</div>';
        card.onclick = function () {
          if (!tierAllows(t.id)) {
            var planMap = { starter: 'plan-starter', pro: 'plan-pro', mentor: 'plan-pro' };
            var targetId = planMap[t.tier] || 'pricing';
            var el = document.getElementById(targetId) || document.getElementById('pricing');
            if (el) {
              el.scrollIntoView({ behavior: 'smooth', block: 'center' });
              el.style.transition = 'box-shadow .3s';
              el.style.boxShadow = '0 0 0 2px rgba(201,168,76,.8)';
              setTimeout(function () { el.style.boxShadow = ''; }, 2000);
            }
            return;
          }
          runSingleTool(t);
        };
        grid.appendChild(card);
      });
    }


    /* ══ USER STATE ══ */
    var currentUser = null;
    var creditBalance = null; /* null = not loaded yet, avoids false "out of credits" */

    /* Load from localStorage (fast, sync) — refreshed from Supabase async */
    function loadLocalSession() {
      try {
        var token = localStorage.getItem('fractal_token');
        var user = JSON.parse(localStorage.getItem('fractal_user') || 'null');
        var creds = parseInt(localStorage.getItem('fractal_credits') || '-1');
        if (token && user) {
          currentUser = user;
          creditBalance = creds >= 0 ? creds : 50;
          showLoggedIn(user.email, creditBalance);
        }
      } catch (e) { }
    }

    /* Refresh from Supabase — gets real balance from DB */
    async function refreshSession() {
      if (!sb || !sbReady) return;
      var { data } = await sb.auth.getSession();
      if (!data.session) {
        localStorage.removeItem('fractal_token');
        localStorage.removeItem('fractal_user');
        localStorage.removeItem('fractal_credits');
        currentUser = null;
        showLoggedOut();
        return;
      }
      currentUser = data.session.user;
      localStorage.setItem('fractal_token', data.session.access_token);
      localStorage.setItem('fractal_user', JSON.stringify({ id: currentUser.id, email: currentUser.email }));
      /* Fetch balance + username from server (uses admin key, bypasses RLS) */
      try {
        var profResp = await fetch('/api/profile', { headers: { Authorization: 'Bearer ' + data.session.access_token } });
        var profile = await profResp.json();
        if (profile && profile.userId) {
          creditBalance = (profile.credits !== null && profile.credits !== undefined) ? profile.credits : 50;
          localStorage.setItem('fractal_credits', creditBalance);
          var displayName = profile.username || currentUser.email.split('@')[0];
          localStorage.setItem('fractal_username', displayName);
          /* Set tier for tool gating */
          var plan = profile.plan || 'free';
          userTier = (plan === 'mentor' || plan === 'elite' || plan === 'institutional') ? 'mentor'
            : (plan === 'pro') ? 'pro'
              : (plan === 'starter') ? 'starter'
                : 'free';
          buildToolGrid();
          showLoggedIn(currentUser.email, creditBalance);
        }
      } catch (e) { }
    }

    function showLoggedIn(email, credits) {
      document.getElementById('nav-loggedout').style.display = 'none';
      document.getElementById('nav-loggedin').style.display = 'flex';
      var usernameEl = document.getElementById('nav-username');
      if (usernameEl) {
        var stored = localStorage.getItem('fractal_username');
        usernameEl.textContent = stored || email.split('@')[0];
      }
      updateCreditDisplay(credits);
    }

    function showLoggedOut() {
      document.getElementById('nav-loggedout').style.display = 'flex';
      document.getElementById('nav-loggedin').style.display = 'none';
    }

    function updateCreditDisplay(n) {
      creditBalance = n;
      localStorage.setItem('fractal_credits', n);
      var el = document.getElementById('nav-credit-val');
      if (el) {
        el.textContent = n;
        el.style.color = n <= 5 ? '#e74c3c' : n <= 15 ? '#e67e22' : 'var(--gold)';
      }
    }

    async function signOut() {
      if (sb) await sb.auth.signOut();
      localStorage.removeItem('fractal_token');
      localStorage.removeItem('fractal_user');
      localStorage.removeItem('fractal_credits');
      currentUser = null; creditBalance = 0;
      showLoggedOut();
    }

    /* ══ CREDIT CHECK before any tool run ══ */
    function checkCredits(toolKey) {
      if (!currentUser) {
        if (!sbReady) { showErr('Still loading session — please try again in a moment.'); return false; }
        window.location.href = '/auth?force=1';
        return false;
      }
      var cost = TOOL_COSTS[toolKey] || 3;
      /* creditBalance may still be loading (null) — treat as sufficient and let server decide */
      if (creditBalance !== null && creditBalance !== undefined && creditBalance < cost) {
        document.getElementById('noCreditsGate').classList.add('show');
        return false;
      }
      return true;
    }

    /* Save analysis result to DB (fire-and-forget) */
    /* Map tool → canvas ID for the annotated result image */
    var TOOL_CANVAS = {
      analyze: 'outCanvas', bar: 'outCanvas', ww: 'wwDecompCanvas',
      fib: 'fibCanvas', smc: 'smcCanvas', mtf: 'mtfCanvas',
      age: 'ageCanvas', liq: 'liqCanvas', proj: 'projCanvas',
      vol: 'chartCanvas', journal: 'chartCanvas'
    };

    function captureToolCanvas(tool) {
      try {
        var canvasId = TOOL_CANVAS[tool] || 'chartCanvas';
        var canvas = document.getElementById(canvasId);
        if (!canvas || !canvas.width || !canvas.height) return null;
        var dataUrl = canvas.toDataURL('image/webp', 0.65);
        return (dataUrl && dataUrl.length > 200) ? dataUrl : null;
      } catch (e) {
        console.warn('[chart capture]', e);
        return null;
      }
    }

    function saveAnalysis(tool, result) {
      var token = localStorage.getItem('fractal_token');
      if (!token || !result) return;
      var pair = (document.getElementById('pairIn') && document.getElementById('pairIn').value) || '—';
      var tf = typeof currentInterval !== 'undefined' ? currentInterval : '—';

      /* Delay capture so canvas drawing (incl. internal setTimeouts) finishes */
      setTimeout(function () {
        var chart_data = captureToolCanvas(tool);
        fetch('/save-analysis', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tool: tool, pair: pair, timeframe: tf, result: result, credits: TOOL_COSTS[tool] || 0, chart_data: chart_data || null, _token: token })
        }).catch(function () { });
      }, 800);
    }

    /* Deduct credits locally (optimistic) + call server to deduct in DB */
    function spendCredits(toolKey) {
      var cost = TOOL_COSTS[toolKey] || 3;
      if (creditBalance !== null && creditBalance !== undefined) {
        creditBalance = Math.max(0, creditBalance - cost);
        updateCreditDisplay(creditBalance);
      }
      logUsage(toolKey, cost);
    }

    /* Log usage to localStorage for history page */
    function logUsage(toolKey, cost) {
      var toolNames = {
        analyze: 'Fractal Pattern', fib: 'Fibonacci', smc: 'Smart Money',
        vol: 'Volatility', mtf: 'MTF Confluence', age: 'Fractal Age',
        liq: 'Liquidity Map', journal: 'Trade Journal', proj: 'Projection',
        bar: 'Bar Pattern', ww: 'Weierstrass'
      };
      var pair = (document.getElementById('pairIn') && document.getElementById('pairIn').value) || '—';
      var entry = { tool: toolNames[toolKey] || toolKey, pair: pair, cost: cost, ts: Date.now() };
      var _u = null; try { _u = JSON.parse(localStorage.getItem('fractal_user')); } catch (e) { }
      var _hKey = _u && _u.id ? 'fractal_history_' + _u.id : 'fractal_history';
      var raw = localStorage.getItem(_hKey);
      var history = [];
      try { history = JSON.parse(raw) || []; } catch (e) { }
      history.push(entry);
      if (history.length > 100) history = history.slice(-100);
      localStorage.setItem(_hKey, JSON.stringify(history));
    }

    /* ══ PATCH callBackend to include auth token ══ */
    /* Endpoint → toolKey map for correct credit cost lookup */
    var ENDPOINT_TOOL_MAP = {
      '/analyze': 'analyze',
      '/fibonacci': 'fib',
      '/smc': 'smc',
      '/volatility': 'vol',
      '/mtf': 'mtf',
      '/fractal-age': 'age',
      '/liquidity': 'liq',
      '/journal': 'journal',
      '/projection': 'proj',
      '/bar-pattern': 'bar',
      '/weierstrass': 'ww'
    };

    var _origCallBackend = callBackend;
    callBackend = function (endpoint, payload) {
      var token = localStorage.getItem('fractal_token');
      if (token) payload._token = token;
      var toolKey = ENDPOINT_TOOL_MAP[endpoint] || 'analyze';
      if (!checkCredits(toolKey)) return Promise.reject(new Error('No credits'));
      spendCredits(toolKey);
      return _origCallBackend(endpoint, payload);
    };
