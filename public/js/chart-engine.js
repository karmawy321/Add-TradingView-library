
    /* ══ INIT ══ */

    /* ─── Sanitize candles: strip any bar with NaN/zero/negative OHLC
         These cause the giant red spike rendering during replay ─── */
    function sanitizeCandles(arr) {
      if (!Array.isArray(arr)) return [];
      return arr.filter(function (c) {
        if (!c || !c.t) return false;
        var o = +c.o, h = +c.h, l = +c.l, cl = +c.c;
        // All four prices must be finite positive numbers
        if (!isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(cl)) return false;
        if (o <= 0 || h <= 0 || l <= 0 || cl <= 0) return false;
        return true;
      });
    }


    /* ══════════════════════════════════════════════════════════════
       BACKTEST MODE — Time Curtain
       Hides candles after a chosen cutoff so the AI can't see the future.
       Use: toggle mode → drag slider → run any AI tool → Reveal & Score
       ══════════════════════════════════════════════════════════════ */

    var _btActive = false;  /* is backtest mode on? */
    var _btAllCandles = null;   /* full candle set (past + future) */
    /* ── TRADINGVIEW STYLE REPLAY ENGINE ── */
    var _replayIndex = 0;
    var _replayState = 'idle'; /* 'idle' | 'select' | 'paused' | 'playing' */
    var _replayIntId = null;

    function toggleBacktestMode() {
      if (_btActive) { exitBacktestMode(); return; }
      if (!chartCandles || chartCandles.length < 20) {
        showErr('Load a chart first — need at least 20 candles.');
        return;
      }

      _btActive = true;
      var btBtn = document.getElementById('btModeBtn');
      if (btBtn) btBtn.classList.add('active');

      var w = document.getElementById('replayWidget');
      if (w) w.style.display = 'flex';

      _btAllCandles = chartCandles.slice();

      _replayState = 'select';
      document.getElementById('rpPlayControls').style.display = 'none';
      document.getElementById('rpSelectMsg').style.display = 'block';

      renderChart();
    }

    function exitBacktestMode() {
      _btActive = false;
      _replayState = 'idle';
      _replayIndex = 0;
      if (_replayIntId) clearInterval(_replayIntId);
      _replayIntId = null;

      var btBtn = document.getElementById('btModeBtn');
      if (btBtn) btBtn.classList.remove('active');

      var w = document.getElementById('replayWidget');
      if (w) w.style.display = 'none';

      if (_btAllCandles && _btAllCandles.length) {
        chartCandles = _btAllCandles;
        _btAllCandles = null;
      }

      renderChart();

      if (chartCandles && chartCandles.length > 0) {
        var cv = document.getElementById('chartCanvas');
        if (cv) { dataUrl = cv.toDataURL('image/png'); }
      }
    }
    /* Deep-copy a candle array so live tick mutations on _btAllCandles
       cannot bleed into the replay chartCandles slice */
    function _deepSlice(arr, end) {
      var out = [];
      for (var _di = 0; _di < end && _di < arr.length; _di++) {
        var s = arr[_di];
        out.push({ t: s.t, o: s.o, h: s.h, l: s.l, c: s.c, v: s.v });
      }
      return out;
    }



    function startReplayAt(idx) {
      _replayIndex = Math.max(10, Math.min(_btAllCandles.length - 1, idx));
      _replayState = 'paused';

      document.getElementById('rpSelectMsg').style.display = 'none';
      document.getElementById('rpPlayControls').style.display = 'flex';
      document.getElementById('rpPlayIcon').innerHTML = '<path d="M8 5v14l11-7z"/>';

      chartCandles = _deepSlice(_btAllCandles, _replayIndex);
      renderChart();
    }

    function toggleReplayPlay() {
      if (_replayState === 'playing') {
        _replayState = 'paused';
        if (_replayIntId) clearInterval(_replayIntId);
        document.getElementById('rpPlayIcon').innerHTML = '<path d="M8 5v14l11-7z"/>';
      } else if (_replayState === 'paused') {
        if (_replayIndex >= _btAllCandles.length - 1) return;
        _replayState = 'playing';
        document.getElementById('rpPlayIcon').innerHTML = '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>';

        var speed = parseInt(document.getElementById('rpSpeed').value) || 300;
        _replayIntId = setInterval(function () {
          if (_replayIndex >= _btAllCandles.length - 1) {
            toggleReplayPlay();
            return;
          }
          _replayIndex++;
          chartCandles = _deepSlice(_btAllCandles, _replayIndex);
          renderChart();
        }, speed);
      }
    }

    function stepReplayForward() {
      if (_replayState === 'playing') toggleReplayPlay();
      if (_replayState !== 'paused' || !_btAllCandles) return;
      if (_replayIndex >= _btAllCandles.length - 1) return;

      _replayIndex++;
      chartCandles = _deepSlice(_btAllCandles, _replayIndex);
      renderChart();
    }

    document.addEventListener('DOMContentLoaded', function () {
      /* Restore timezone selector from localStorage */
      var tzSel = document.getElementById('tzSelect');
      if (tzSel) tzSel.value = (localStorage.getItem('chartTzOffset') || '0');

      var speedEl = document.getElementById('rpSpeed');
      if (speedEl) {
        speedEl.addEventListener('change', function () {
          if (_replayState === 'playing') {
            toggleReplayPlay(); // pause
            toggleReplayPlay(); // resume with new speed
          }
        });
      }
    });

    /* Patch renderChart to draw the curtain line when in backtest mode */
    var _origRenderChart = null;
    (function patchRenderChartForBacktest() {
      var _checkInterval = setInterval(function () {
        if (typeof renderChart !== 'function') return;
        clearInterval(_checkInterval);
        var _orig = renderChart;
        renderChart = function () {
          _orig.apply(this, arguments);
          if (!_btActive || !_btAllCandles) return;

          var cv = document.getElementById('chartCanvas');
          var ctx = cv && cv.getContext('2d');
          if (!ctx) return;
          var dpr = window.devicePixelRatio || 1;
          var W = cv.width / dpr;
          var H = cv.height / dpr;
          var PAD = { l: 8, r: 75, t: 16, b: 56 };
          var CW = W - PAD.l - PAD.r;

          /* In 'select' mode, draw a vertical blue dashed line where the user is hovering */
          if (_replayState === 'select' && _hoverReplayIdx >= 0 && chartCandles && chartCandles.length) {
            var x = worldToScreenX(_hoverReplayIdx);
            if (x >= PAD.l && x <= W - PAD.r) {
              ctx.save();
              ctx.strokeStyle = '#3498db';
              ctx.lineWidth = 1.5;
              ctx.setLineDash([4, 4]);
              ctx.beginPath();
              ctx.moveTo(x, PAD.t);
              ctx.lineTo(x, H - PAD.b);
              ctx.stroke();

              /* Tooltip handle at bottom */
              ctx.fillStyle = '#3498db';
              ctx.font = 'bold 10px DM Mono';
              ctx.textAlign = 'center';
              ctx.fillText('✂️ Click to Start', x, H - PAD.b + 14);
              ctx.restore();
            }
          }
        };
      }, 200);
    })();

    /* Setup Canvas listeners for Replay Selection */
    var _hoverReplayIdx = -1;
    (function initReplayEngine() {
      var _waitForCanvas = setInterval(function () {
        var cv = document.getElementById('chartCanvas');
        if (!cv) return;
        clearInterval(_waitForCanvas);

        function _getHoverAbsoluteIdx(clientX) {
          if (!chartCandles || !chartCandles.length || !_btAllCandles) return -1;
          var rect = cv.getBoundingClientRect();
          var mouseX = clientX - rect.left;
          return Math.max(0, Math.min(chartCandles.length - 1, Math.round(screenToWorldX(mouseX))));
        }

        cv.addEventListener('mousemove', function (e) {
          if (!_btActive || _replayState !== 'select') {
            if (_hoverReplayIdx !== -1) { _hoverReplayIdx = -1; renderChart(); }
            return;
          }
          var idx = _getHoverAbsoluteIdx(e.clientX);
          if (idx !== _hoverReplayIdx) {
            _hoverReplayIdx = idx;
            renderChart();
          }
        });

        cv.addEventListener('mouseleave', function () {
          if (_hoverReplayIdx !== -1) { _hoverReplayIdx = -1; renderChart(); }
        });

        cv.addEventListener('mousedown', function (e) {
          if (!_btActive || _replayState !== 'select' || e.button !== 0) return;
          var idx = _getHoverAbsoluteIdx(e.clientX);
          if (idx > 0 && idx < _btAllCandles.length) {
            _hoverReplayIdx = -1;
            startReplayAt(idx);
            e.preventDefault();
            e.stopPropagation();
          }
        }, true);

        cv.addEventListener('touchstart', function (e) {
          if (!_btActive || _replayState !== 'select') return;
          var touch = e.touches[0];
          var idx = _getHoverAbsoluteIdx(touch.clientX);
          if (idx > 0 && idx < _btAllCandles.length) {
            _hoverReplayIdx = -1;
            startReplayAt(idx);
            e.preventDefault();
            e.stopPropagation();
          }
        }, { capture: true });

      }, 300);
    })();

    /* session init handled by initSupabase() above */


    /* ══ TOOL: PRICE PATH PROJECTION ══ */

    /* Which scenarios are visible — toggled by buttons */
    var projVisibility = { 0: true, 1: true, 2: true };
    var projData = null;

    function renderProjection(r) {
      projData = r;
      projVisibility = { 0: true, 1: true, 2: true };

      /* Signal badge */
      var sig = document.getElementById('proj-sig');
      sig.textContent = (r.signal || 'neutral').toUpperCase();
      sig.className = 'sig ' + (r.signal === 'bullish' ? 's-bull' : r.signal === 'bearish' ? 's-bear' : 's-n');

      document.getElementById('proj-pair').textContent = [r.pair, r.chart_context && r.chart_context.last_pattern].filter(Boolean).join(' · ');
      document.getElementById('proj-meta').textContent = [r.timeframe, r.confidence && r.confidence + ' confidence', r.chart_context && r.chart_context.wave_position].filter(Boolean).join(' · ');
      document.getElementById('proj-analysis').textContent = r.analysis || '';
      document.getElementById('proj-basis').textContent = r.fractal_basis || '';

      /* Entry / SL levels */
      var ez = r.entry_zone || {};
      var sl = r.stop_loss || {};
      document.getElementById('proj-levels').innerHTML = [
        { l: 'Entry From', v: ez.price_from || '—', c: 'var(--gold)' },
        { l: 'Entry To', v: ez.price_to || '—', c: 'var(--gold)' },
        { l: 'Stop Loss', v: sl.price || '—', c: '#e74c3c' }
      ].map(function (x) {
        return '<div class="res-card"><div class="res-card-v" style="color:' + x.c + ';font-size:12px">' + x.v + '</div><div class="res-card-l">' + x.l + '</div></div>';
      }).join('');

      /* Scenario cards */
      var scenarios = r.scenarios || [];
      document.getElementById('projScenarioCards').innerHTML = scenarios.map(function (s, i) {
        var pct = Math.round((s.probability || 0) * 100);
        return '<div class="res-card" style="border-color:' + hA(s.color || '#c9a84c', .3) + ';cursor:pointer" onclick="toggleScenario(' + i + ')" id="proj-sc-card-' + i + '">'
          + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
          + '<div style="font-family:Cinzel,serif;font-size:11px;color:var(--white);font-weight:600">' + s.label + '</div>'
          + '<div style="font-family:DM Mono,monospace;font-size:10px;color:' + (s.color || '#c9a84c') + '">' + pct + '%</div></div>'
          + '<div style="height:3px;background:rgba(255,255,255,.06);border-radius:2px;margin-bottom:6px">'
          + '<div style="height:100%;width:' + pct + '%;background:' + (s.color || '#c9a84c') + ';border-radius:2px"></div></div>'
          + '<div style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted)">' + (s.direction || '').toUpperCase() + ' · ' + s.bars + ' bars · ' + s.target_price + '</div>'
          + '</div>';
      }).join('');

      /* Scenario toggle overlay buttons */
      document.getElementById('projScenarioBtns').innerHTML = scenarios.map(function (s, i) {
        return '<button onclick="toggleScenario(' + i + ')" id="proj-sc-btn-' + i + '" style="font-family:DM Mono,monospace;font-size:8px;padding:3px 8px;background:' + hA(s.color || '#c9a84c', .25) + ';border:1px solid ' + (s.color || '#c9a84c') + ';color:' + (s.color || '#c9a84c') + ';cursor:pointer;border-radius:1px;text-align:left">● ' + s.label + '</button>';
      }).join('');

      /* Draw */
      drawProjectionCanvas(r);

      /* Save button */
      document.getElementById('projDlBtn').onclick = function () {
        var c = document.getElementById('projCanvas');
        var a = document.createElement('a');
        a.download = 'fractal-projection.png';
        a.href = c.toDataURL('image/png');
        a.click();
      };
    }

    function toggleScenario(idx) {
      projVisibility[idx] = !projVisibility[idx];
      /* Update card opacity */
      var card = document.getElementById('proj-sc-card-' + idx);
      var btn = document.getElementById('proj-sc-btn-' + idx);
      if (card) card.style.opacity = projVisibility[idx] ? '1' : '0.35';
      if (btn) btn.style.opacity = projVisibility[idx] ? '1' : '0.4';
      drawProjectionCanvas(projData);
    }

    function drawProjectionCanvas(r) {
      var canvas = document.getElementById('projCanvas');
      if (!canvas || !dataUrl) return;

      var W = canvas.offsetWidth || 700;
      var H = Math.round(W * 0.52); /* ~16:8 ratio */
      canvas.width = W;
      canvas.height = H;

      var ctx = canvas.getContext('2d');

      /* Draw original chart as background */
      var img = new Image();
      img.onload = function () {
        /* Chart background */
        ctx.drawImage(img, 0, 0, W, H);

        /* Subtle dark overlay on right 40% — the "future" zone */
        var futureX = W * 0.62;
        ctx.fillStyle = 'rgba(6,8,13,.35)';
        ctx.fillRect(futureX, 0, W - futureX, H);

        /* Vertical divider — "NOW" line */
        ctx.strokeStyle = 'rgba(201,168,76,.6)';
        ctx.lineWidth = 1.5;
        ctx.setLineDash([4, 3]);
        ctx.beginPath();
        ctx.moveTo(futureX, 0);
        ctx.lineTo(futureX, H);
        ctx.stroke();
        ctx.setLineDash([]);

        /* NOW label */
        ctx.fillStyle = 'rgba(201,168,76,.9)';
        ctx.font = 'bold 9px DM Mono';
        ctx.textAlign = 'left';
        ctx.fillText('NOW', futureX + 4, 14);

        /* Entry zone band */
        if (r.entry_zone) {
          var ey1 = r.entry_zone.y1 * H;
          var ey2 = r.entry_zone.y2 * H;
          ctx.fillStyle = 'rgba(201,168,76,.08)';
          ctx.fillRect(futureX - 20, ey1, W - futureX + 20, ey2 - ey1);
          ctx.strokeStyle = 'rgba(201,168,76,.3)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(futureX - 20, (ey1 + ey2) / 2);
          ctx.lineTo(W - 8, (ey1 + ey2) / 2);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(201,168,76,.8)';
          ctx.font = '8px DM Mono';
          ctx.textAlign = 'right';
          ctx.fillText('ENTRY ZONE', W - 6, (ey1 + ey2) / 2 - 3);
        }

        /* Stop loss line */
        if (r.stop_loss) {
          var sly = r.stop_loss.y * H;
          ctx.strokeStyle = 'rgba(231,76,60,.5)';
          ctx.lineWidth = 1;
          ctx.setLineDash([5, 3]);
          ctx.beginPath();
          ctx.moveTo(futureX - 20, sly);
          ctx.lineTo(W - 8, sly);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(231,76,60,.8)';
          ctx.font = '8px DM Mono';
          ctx.textAlign = 'right';
          ctx.fillText('SL ' + (r.stop_loss.price || ''), W - 6, sly - 3);
        }

        /* Draw each scenario path */
        var scenarios = r.scenarios || [];
        scenarios.forEach(function (s, si) {
          if (!projVisibility[si]) return;
          var path = s.path || [];
          var nPts = path.length;
          if (nPts < 2) return;

          var color = s.color || '#c9a84c';
          var startX = futureX;
          var endX = W - 12;
          var pct = Math.round((s.probability || 0) * 100);

          /* Smooth path using bezier curves */
          ctx.strokeStyle = color;
          ctx.lineWidth = si === 0 ? 2.5 : 1.5;
          ctx.globalAlpha = si === 0 ? 1 : 0.7;
          ctx.setLineDash(si === 0 ? [] : [6, 3]);

          ctx.beginPath();
          path.forEach(function (v, i) {
            var x = startX + (i / (nPts - 1)) * (endX - startX);
            var y = v * H;
            if (i === 0) {
              ctx.moveTo(x, y);
            } else {
              /* Smooth bezier */
              var px = startX + ((i - 1) / (nPts - 1)) * (endX - startX);
              var py = path[i - 1] * H;
              var cpx = (px + x) / 2;
              ctx.bezierCurveTo(cpx, py, cpx, y, x, y);
            }
          });
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.globalAlpha = 1;

          /* Filled area under/above path */
          var lastY = path[nPts - 1] * H;
          var firstY = path[0] * H;
          ctx.globalAlpha = 0.06;
          ctx.fillStyle = color;
          ctx.beginPath();
          path.forEach(function (v, i) {
            var x = startX + (i / (nPts - 1)) * (endX - startX);
            var y = v * H;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          });
          ctx.lineTo(endX, H);
          ctx.lineTo(startX, H);
          ctx.closePath();
          ctx.fill();
          ctx.globalAlpha = 1;

          /* Target dot + label at end */
          var endY = path[nPts - 1] * H;
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(endX, endY, 4, 0, Math.PI * 2);
          ctx.fill();

          ctx.fillStyle = color;
          ctx.font = 'bold 9px DM Mono';
          ctx.textAlign = 'right';
          var labelY = endY > H - 20 ? endY - 6 : endY + 12;
          ctx.fillText(s.label + ' ' + pct + '%', endX - 8, labelY);

          /* Key levels */
          (s.key_levels || []).forEach(function (kl) {
            var kly = kl.y * H;
            ctx.strokeStyle = hA(color, .35);
            ctx.lineWidth = .8;
            ctx.setLineDash([2, 3]);
            ctx.beginPath();
            ctx.moveTo(futureX + 10, kly);
            ctx.lineTo(endX - 20, kly);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.fillStyle = hA(color, .8);
            ctx.font = '8px DM Mono';
            ctx.textAlign = 'left';
            ctx.fillText(kl.label + ' ' + kl.price, futureX + 12, kly - 3);
          });
        });

        /* Watermark */
        ctx.fillStyle = 'rgba(201,168,76,.08)';
        ctx.font = 'bold 11px DM Mono';
        ctx.textAlign = 'center';
        ctx.fillText('FRACTAL AI AGENT — PROJECTION', W / 2, H - 8);
      };
      img.src = dataUrl;
    }

    /* Update footer auth link */
    (function () {
      var fl = document.getElementById('footer-auth-link');
      if (!fl) return;
      var token = localStorage.getItem('fractal_token');
      if (token) { fl.textContent = 'My Profile'; fl.href = 'profile.html'; }
    })();


    /* ══════════════════════════════════════════════════════
       LIGHTWEIGHT CHARTS ENGINE
       ══════════════════════════════════════════════════════ */

    /* ══ CANVAS CHART ENGINE ══ */
    var chartCanvas = document.getElementById('chartCanvas');
    var chartCtx = chartCanvas ? chartCanvas.getContext('2d') : null;
    var chartCandles = [];
    var currentSymbol = '';
    var currentInterval = '4h';
    var currentDataSource = 'twelvedata'; /* 'twelvedata' | 'oanda' */
    /* Symbols served natively (OANDA or Binance) — no TwelveData fallback for these */
    var _OANDA_SYMBOLS = new Set([
      /* Metals / Commodities */
      'GOLD', 'SILVER', 'XAUUSD', 'XAU/USD', 'XAGUSD', 'XAG/USD', 'OILWTI', 'USDBRL',
      /* Forex majors */
      'EURUSD', 'EUR/USD', 'GBPUSD', 'GBP/USD', 'USDJPY', 'USD/JPY', 'USDCHF', 'USD/CHF',
      'AUDUSD', 'AUD/USD', 'NZDUSD', 'NZD/USD', 'USDCAD', 'USD/CAD',
      /* Forex crosses */
      'EURJPY', 'EUR/JPY', 'GBPJPY', 'GBP/JPY',
      /* Indices */
      'US500', 'US30', 'US100',
      /* Crypto — Binance direct (native, not OANDA) */
      'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'DOTUSDT', 'LINKUSDT', 'AVAXUSDT', 'MATICUSDT', 'ATOMUSDT', 'ADAUSDT',
      /* NOTE: TSLA/NVDA/AAPL/MSFT/GOOGL/AMZN/META/AMD/NFLX/COIN/PLTR/SPY/QQQ/GLD/SLV are
         TwelveData-only (no OANDA fallback) — intentionally NOT in this set so the
         source switcher stays hidden and the chart defaults to TwelveData. */
    ]);
    var _historyLoading = false;
    var _historyDepleted = false;
    var chartSSE = null;
    var sma50On = false;
    var sma200On = false;
    var sma400On = false;
    var sma900On = false;
    var smaCrossZoneOn = false;
    var fractalPathsOn = false;
    var vpvrOn = false;
    var liqHeatmapOn = false;
    var volBubblesOn = false;
    var hurstOn = false;
    var fmOn = false;
    var garchBandsOn = false;
    var fractalSignalOn = false;
    var gbmOn = false;
    var ouOn = false;
    var kalmanOn = false;
    var maCascadeOn = false;
    var fractalOverlayOn = false;
    var fractalResult = null;
    var fractalSource = localStorage.getItem('fractalSource') || '';
    var _FRACTALRevalTimer = null;
    var vpvrAnchorX = null;  /* null = auto right edge (W-PAD.r-2); set by drag */
    var _vpvrDragging = false;
    var _vpvrDragOff = 0;
    var allCandleData = {}; /* cache disabled — kept as empty object to avoid reference errors */
    var lwChartInstance = null; /* truthy flag for compatibility */
    var chartView = { offset: 0, zoom: 1.0, rightPad: 0, yScale: 1 };
    var C = { 
      up: '#26a69a', 
      dn: '#ef5350', 
      bg: '#06080d', 
      grid: 'rgba(255,255,255,0.06)', 
      text: 'rgba(220,232,255,1)',
      mutedText: 'rgba(180,200,230,0.7)',
      sma50: '#c9a84c', 
      sma200: '#26a69a', 
      sma400: '#3498db', 
      sma900: '#9b8fe8', 
      crosshair: 'rgba(201,168,76,0.4)' 
    };

    var _chartTheme = localStorage.getItem('chartTheme') || 'dark';
    function setTheme(mode) {
      _chartTheme = mode;
      if (mode === 'light') {
        C.bg = '#ffffff';
        C.grid = 'rgba(0,0,0,0.08)';
        C.text = '#1a1d23';
        C.mutedText = 'rgba(0,0,0,0.5)';
      } else {
        C.bg = '#06080d';
        C.grid = 'rgba(255,255,255,0.06)';
        C.text = 'rgba(220,232,255,1)';
        C.mutedText = 'rgba(180,200,230,0.7)';
      }
      localStorage.setItem('chartTheme', mode);
      var themeBtn = document.getElementById('themeToggleBtn');
      if (themeBtn) {
        themeBtn.innerHTML = mode === 'light' ? 
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' : 
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';
      }
      var area = document.getElementById('chartArea');
      if (area) area.style.background = C.bg;
      if (typeof renderChart === 'function') renderChart();
    }
    /* Init theme */
    setTimeout(function() { setTheme(_chartTheme); }, 50);


    /* ═══════════════════════════════════════════════════
       WORLD-SPACE VIEWPORT  (Phase 1 — new coordinate system)
       offsetX  : pixels from PAD.l to bar-0 centre  (positive = scrolled into history)
       scaleX   : pixels per bar  (zoom)
       priceMin/Max : set each render from visible price range
       ═══════════════════════════════════════════════════ */
    var viewState = {
      offsetX: 0,   /* horizontal pixel offset                  */
      scaleX: 8,   /* pixels per bar                           */
      priceMin: 0,   /* set by renderChart each frame            */
      priceMax: 1,   /* set by renderChart each frame            */
      priceOffset: 0    /* Y-pan: fraction of range to shift up (+) */
    };
    var _lastCH = 0;    /* chart-area height in px, set by renderChart */
    var _chartPAD = { l: 8, r: 75, t: 16, b: 56, vol: 40 }; /* canonical PAD used by transforms */
    var _fsMaximized = false;      /* FractalScript sub-pane fullscreen state */
    var _fsMaxBtnBounds = null;    /* Click region for the maximize/restore button */
    var _fsBadges = [];            /* Badges collected during clipped render, drawn after restore */

    /* worldToScreenX(k) returns the screen X of the CENTRE of bar k */
    function worldToScreenX(barIndex) {
      return _chartPAD.l + (barIndex + 0.5) * viewState.scaleX + viewState.offsetX;
    }
    function worldToScreenY(price) {
      if (viewState.priceMax === viewState.priceMin) return _chartPAD.t + _lastCH / 2;
      return _chartPAD.t + _lastCH - ((price - viewState.priceMin) / (viewState.priceMax - viewState.priceMin)) * _lastCH;
    }
    /* screenToWorldX(x) returns the fractional bar index under screen position x */
    function screenToWorldX(x) {
      if (viewState.scaleX === 0) return 0;
      return (x - _chartPAD.l - viewState.offsetX) / viewState.scaleX - 0.5;
    }
    function screenToWorldY(y) {
      if (_lastCH === 0) return viewState.priceMin;
      return viewState.priceMin + ((_chartPAD.t + _lastCH - y) / _lastCH) * (viewState.priceMax - viewState.priceMin);
    }

    function resizeCanvas() {
      if (!chartCanvas) return;
      var dpr = window.devicePixelRatio || 1;
      var p = chartCanvas.parentElement;
      var area = document.getElementById('chartArea');
      var cssW = p ? p.clientWidth : 800;
      /* Read height from #chartArea (controlled by CSS) so media queries apply */
      var cssH = (area && area.clientHeight > 100 ? area.clientHeight : 0)
        || parseInt(chartCanvas.style.height)
        || (p ? p.clientHeight : 560)
        || 560;
      if (cssH < 100) cssH = 560;
      /* Backing store = CSS size × DPR for crispness */
      chartCanvas.width = Math.round(cssW * dpr);
      chartCanvas.height = Math.round(cssH * dpr);
      chartCanvas.style.width = cssW + 'px';
      chartCanvas.style.height = cssH + 'px';
      if (chartCtx) chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      renderChart();
    }
    /* Re-read DPR dynamically in renderChart too */
    var DPR = 1; /* legacy compat — real DPR used per call */
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', function () { setTimeout(resizeCanvas, 200); });
    setTimeout(resizeCanvas, 100);

    /* ── Watermark reverse-letter animation ── */
    (function () {
      var wm = document.getElementById('chartWatermark');
      var logo = document.getElementById('wmLogo');
      var textEl = document.getElementById('wmText');
      if (!wm || !logo || !textEl) return;

      var text = 'Fractal AI Agent';
      var letters = text.split('').map(function (char, i) {
        var span = document.createElement('span');
        span.textContent = char;
        span.style.display = 'inline-block';
        span.style.opacity = '1';
        span.style.transition = 'opacity 0.03s ease-out';
        span.style.transitionDelay = '0s';
        textEl.appendChild(span);
        return span;
      });

      var hoverTimer;
      wm.addEventListener('mouseenter', function () {
        clearTimeout(hoverTimer);
        /* Scale logo up */
        logo.style.transform = 'scale(1.4)';
        /* Hide letters from right to left (reverse order) */
        for (var i = letters.length - 1; i >= 0; i--) {
          var delay = (letters.length - 1 - i) * 0.015; /* 15ms per letter */
          letters[i].style.transitionDelay = delay + 's';
          letters[i].style.opacity = '0';
        }
      });

      wm.addEventListener('mouseleave', function () {
        clearTimeout(hoverTimer);
        /* Restore logo size */
        logo.style.transform = 'scale(1)';
        /* Show letters from left to right (normal order) */
        hoverTimer = setTimeout(function () {
          for (var i = 0; i < letters.length; i++) {
            var delay = i * 0.015; /* 15ms per letter */
            letters[i].style.transitionDelay = delay + 's';
            letters[i].style.opacity = '1';
          }
        }, 50);
      });
    })();

    function formatPrice(v) {
      if (!v && v !== 0) return '—';
      if (v >= 1000) return v.toFixed(2);
      if (v >= 1) return v.toFixed(4);
      return v.toFixed(6);
    }
    function formatVol(v) {
      if (!v && v !== 0) return '—';
      if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B';
      if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M';
      if (v >= 1e3) return (v / 1e3).toFixed(1) + 'K';
      return v.toFixed(2);
    }

    /* ══ LIVE TICKER STRIP — Binance public API, no key needed ══ */
    (function () {
      var TICKER_COINS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT'];
      var tickerData = {};
      var tickerAnim = null;
      var tickerOffset = 0;

      function buildTickerHTML() {
        var html = '';
        TICKER_COINS.forEach(function (sym) {
          var d = tickerData[sym] || {};
          var price = d.price ? parseFloat(d.price).toFixed(d.price >= 1000 ? 2 : d.price >= 1 ? 4 : 6) : '—';
          var chg = d.chg ? parseFloat(d.chg) : '';
          var up = chg >= 0;
          var col = chg === '' ? '#8a95a8' : up ? '#26a69a' : '#ef5350';
          var sign = up ? '+' : '';
          var label = sym.replace('USDT', '');
          html += '<div style="display:inline-flex;align-items:center;gap:6px;padding:0 14px;border-right:1px solid rgba(255,255,255,.05);height:26px;flex-shrink:0">'
            + '<span style="font-family:DM Mono,monospace;font-size:9px;color:rgba(201,168,76,.7);letter-spacing:.06em">' + label + '</span>'
            + '<span style="font-family:DM Mono,monospace;font-size:10px;color:#dde4ee;font-weight:600">' + price + '</span>'
            + (chg !== '' ? '<span style="font-family:DM Mono,monospace;font-size:9px;color:' + col + '">' + sign + parseFloat(chg).toFixed(2) + '%</span>' : '')
            + '</div>';
        });
        /* Duplicate for seamless loop */
        return html + html;
      }

      function updateTicker() {
        var track = document.getElementById('liveTickerTrack');
        if (track) track.innerHTML = buildTickerHTML();
      }

      function animateTicker() {
        var track = document.getElementById('liveTickerTrack');
        if (!track) return;
        var totalW = track.scrollWidth / 2 || 1;
        tickerOffset -= 0.4;
        if (Math.abs(tickerOffset) >= totalW) tickerOffset = 0;
        track.style.transform = 'translateX(' + tickerOffset + 'px)';
        tickerAnim = requestAnimationFrame(animateTicker);
      }

      function fetchTicker() {
        fetch('https://api.binance.com/api/v3/ticker/24hr?symbols=[%22' + TICKER_COINS.join('%22,%22') + '%22]')
          .then(function (r) { return r.json(); })
          .then(function (arr) {
            arr.forEach(function (d) {
              tickerData[d.symbol] = { price: d.lastPrice, chg: d.priceChangePercent };
            });
            updateTicker();
          }).catch(function () { });
      }

      window.addEventListener('load', function () {
        fetchTicker();
        setInterval(fetchTicker, 8000);
        animateTicker();
      });
    })();
    /* Timezone-aware date: applies chartTzOffsetHours offset then uses UTC methods */
    function tzDate(ts) {
      return new Date(ts + chartTzOffsetHours * 3600000);
    }
    function formatTime(ts, tf) {
      /* Legacy — only used by hover tooltip now */
      var d = tzDate(ts);
      var mo = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getUTCMonth()];
      var hh = d.getUTCHours().toString().padStart(2, '0');
      var mm = d.getUTCMinutes().toString().padStart(2, '0');
      var ss = d.getUTCSeconds().toString().padStart(2, '0');
      return d.getUTCDate() + ' ' + mo + ' ' + d.getUTCFullYear().toString().slice(2) + ' ' + hh + ':' + mm + ':' + ss;
    }

    /* ── Smart time axis — purely zoom-driven, not tf-driven ── */
    function renderTimeAxis(visible, px, W, H, PAD) {
      if (!visible || visible.length < 2) return;
      var n = visible.length;
      var MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

      /* Calculate total visible time span in milliseconds */
      var spanMs = visible[n - 1].t - visible[0].t;
      var spanSec = spanMs / 1000;
      var spanMin = spanSec / 60;
      var spanHr = spanMin / 60;
      var spanDay = spanHr / 24;

      /* Choose the primary label unit based on visible span */
      /* Also choose grid spacing: aim for ~6-8 labels across width */
      var labelFn, tickUnit, boundaryFn;

      if (spanDay > 365) {
        /* Years visible — show year, mark month boundaries */
        tickUnit = 'month';
        labelFn = function (d) { return MO[d.getUTCMonth()] + ' ' + d.getUTCFullYear(); };
        boundaryFn = function (d, prev) { return d.getUTCFullYear() !== prev.getUTCFullYear(); };
      } else if (spanDay > 60) {
        /* Months visible — show month+year, mark year boundaries */
        tickUnit = 'month';
        labelFn = function (d) { return MO[d.getUTCMonth()]; };
        boundaryFn = function (d, prev) { return d.getUTCMonth() !== prev.getUTCMonth() || d.getUTCFullYear() !== prev.getUTCFullYear(); };
      } else if (spanDay > 7) {
        /* Weeks visible — show day+month */
        tickUnit = 'day';
        labelFn = function (d) { return d.getUTCDate() + ' ' + MO[d.getUTCMonth()]; };
        boundaryFn = function (d, prev) { return d.getUTCMonth() !== prev.getUTCMonth(); };
      } else if (spanDay > 1) {
        /* Days visible — show day or HH:MM, mark day boundaries */
        tickUnit = 'day';
        labelFn = function (d, isB) {
          if (isB) return d.getUTCDate() + ' ' + MO[d.getUTCMonth()];
          return d.getUTCHours().toString().padStart(2, '0') + ':00';
        };
        boundaryFn = function (d, prev) { return d.getUTCDate() !== prev.getUTCDate(); };
      } else if (spanHr > 4) {
        /* Hours visible — show HH:MM, mark day boundary */
        tickUnit = 'hour';
        labelFn = function (d, isB) {
          if (isB) return d.getUTCDate() + ' ' + MO[d.getUTCMonth()];
          return d.getUTCHours().toString().padStart(2, '0') + ':' + d.getUTCMinutes().toString().padStart(2, '0');
        };
        boundaryFn = function (d, prev) { return d.getUTCDate() !== prev.getUTCDate(); };
      } else if (spanMin > 30) {
        /* Sub-hour — show HH:MM */
        tickUnit = 'minute';
        labelFn = function (d) { return d.getUTCHours().toString().padStart(2, '0') + ':' + d.getUTCMinutes().toString().padStart(2, '0'); };
        boundaryFn = function (d, prev) { return d.getUTCHours() !== prev.getUTCHours(); };
      } else {
        /* Very zoomed in — show MM:SS */
        tickUnit = 'second';
        labelFn = function (d) { return d.getUTCMinutes().toString().padStart(2, '0') + ':' + d.getUTCSeconds().toString().padStart(2, '0'); };
        boundaryFn = function (d, prev) { return d.getUTCMinutes() !== prev.getUTCMinutes(); };
      }

      /* Step: space labels ~80px apart */
      var barW = (W - PAD.l - PAD.r) / n;
      var targetGap = 80; /* px between labels */
      var step = Math.max(1, Math.round(targetGap / barW));

      chartCtx.font = 'bold 10px "DM Mono","Courier New",monospace';
      chartCtx.textAlign = 'center';

      var prevD = null;

      visible.forEach(function (c, i) {
        if (i % step !== 0) return;
        var d = tzDate(c.t);
        var x = px(i);
        var isB = prevD ? boundaryFn(d, prevD) : false;
        var label = typeof labelFn === 'function' ? labelFn(d, isB) : '';
        prevD = d;

        /* Tick */
        chartCtx.strokeStyle = isB ? 'rgba(201,168,76,.4)' : (_chartTheme === 'light' ? 'rgba(0,0,0,.1)' : 'rgba(255,255,255,.1)');
        chartCtx.lineWidth = isB ? 1 : 0.5;
        chartCtx.setLineDash([]);
        chartCtx.beginPath();
        chartCtx.moveTo(x, H - PAD.b + 1);
        chartCtx.lineTo(x, H - PAD.b + (isB ? 7 : 4));
        chartCtx.stroke();

        /* Label */
        var clampedX = Math.max(PAD.l + 24, Math.min(W - PAD.r - 24, x));
        chartCtx.fillStyle = isB ? 'rgba(201,168,76,.9)' : C.mutedText;
        chartCtx.fillText(label, clampedX, H - PAD.b + 17);
      });
    }

    var chartType = 'candles'; /* candles | bars | hollow | area | line */
    var chartTzOffsetHours = (function () { var v = parseFloat(localStorage.getItem('chartTzOffset') || '0'); return isNaN(v) ? 0 : v; })();

    function renderChart() {
      if (!chartCtx || !chartCanvas.width) return;
      /* Context has setTransform(DPR,...) so coords are CSS pixels */
      var dpr = window.devicePixelRatio || 1;
      var W = chartCanvas.width / dpr;
      var H = chartCanvas.height / dpr;
      chartCtx.fillStyle = C.bg; chartCtx.fillRect(0, 0, W, H);
      chartCtx.imageSmoothingEnabled = false;
      var candles = chartCandles;
      if (!candles || candles.length < 2) {
        chartCtx.fillStyle = 'rgba(201,168,76,.4)'; chartCtx.font = 'bold 12px DM Mono';
        chartCtx.textAlign = 'center'; chartCtx.fillText('Connecting…', W / 2, H / 2);

        return;
      }
      fractalResult = window.fractalResult;
      fractalOverlayOn = !!window.fractalOverlayOn;
      var PAD = { l: 8, r: 75, t: 16, b: 56, vol: 40 };
      var CW = W - PAD.l - PAD.r, CH = H - PAD.t - PAD.b - PAD.vol;
      /* ── viewState is the source of truth for pan/zoom ── */
      var barW = Math.max(1, viewState.scaleX);
      var candleW = Math.max(1.5, barW * 0.72);
      /* Visible bar range: include 1 extra bar each side for smooth edge rendering */
      var startIdx = Math.max(0, Math.floor(-viewState.offsetX / barW) - 1);
      var endIdx = Math.min(candles.length, Math.ceil((CW - viewState.offsetX) / barW) + 2);
      var visible = candles.slice(startIdx, endIdx);
      if (!visible.length) return;
      var n = visible.length;
      var mn = Infinity, mx = -Infinity;
      visible.forEach(function (c) {
        if (isFinite(c.l) && c.l > 0 && c.l < mn) mn = c.l;
        if (isFinite(c.h) && c.h > 0 && c.h > mx) mx = c.h;
      });
      if (!isFinite(mn) || !isFinite(mx)) return; // nothing valid to draw
      var range = mx - mn || mn * 0.001 || 0.0001;
      mn -= range * 0.05; mx += range * 0.05; range = mx - mn;
      /* Apply Y-pan offset BEFORE yScale so compression doesn't shift the view */
      if (viewState.priceOffset) {
        mn += viewState.priceOffset * range;
        mx += viewState.priceOffset * range;
      }
      if (chartView.yScale !== 1) {
        var _ymid = (mn + mx) / 2;
        var _yhalf = (mx - mn) / 2 * chartView.yScale;
        mn = _ymid - _yhalf; mx = _ymid + _yhalf; range = mx - mn;
      }
      /* Update viewState price range and CH so worldToScreenY is accurate */
      viewState.priceMin = mn; viewState.priceMax = mx; _lastCH = CH;
      var maxVol = Math.max.apply(null, visible.map(function (c) { return c.v || 0; })) || 1;
      /* px/py delegate to world-space transforms — pixel-perfect, no bar snapping */
      function px(i) { return worldToScreenX(startIdx + i); }
      function py(v) { return worldToScreenY(v); }
      /* Keep chartView in sync for legacy code that reads chartView.offset / zoom */
      _syncChartViewFromViewState();

      /* Grid — more visible lines */
      for (var gi = 0; gi <= 6; gi++) {
        var gy = PAD.t + (gi / 6) * CH;
        var price = mx - (gi / 6) * range;
        chartCtx.strokeStyle = C.grid; chartCtx.lineWidth = 0.5;
        chartCtx.beginPath(); chartCtx.moveTo(PAD.l, gy); chartCtx.lineTo(W - PAD.r, gy); chartCtx.stroke();
        /* Price labels — bright, bold, bigger */
        chartCtx.fillStyle = C.text; chartCtx.font = 'bold 11px "DM Mono","Courier New",monospace'; chartCtx.textAlign = 'left';
        chartCtx.fillText(formatPrice(price), W - PAD.r + 5, Math.round(gy) + 4);
      }

      /* ── Clip all chart drawing to the chart+volume area — nothing bleeds into axes ── */
      chartCtx.save();
      chartCtx.beginPath();
      chartCtx.rect(PAD.l, PAD.t, CW, H - PAD.t - PAD.b);
      chartCtx.clip();

      /* Volume bars */
      visible.forEach(function (c, i) {
        chartCtx.fillStyle = c.c >= c.o ? 'rgba(38,166,154,0.18)' : 'rgba(239,83,80,0.18)';
        var vh = (c.v / maxVol) * PAD.vol;
        chartCtx.fillRect(px(i) - candleW / 2, H - PAD.b - vh, candleW, vh);
      });

      /* SMAs — precomputed over full candle array so they render at any zoom level */
      function computeFullSMA(period) {
        if (candles.length < period) return null;
        var arr = new Array(candles.length).fill(null);
        var sum = 0;
        for (var j = 0; j < candles.length; j++) {
          sum += candles[j].c;
          if (j >= period) sum -= candles[j - period].c;
          if (j >= period - 1) arr[j] = sum / period;
        }
        return arr;
      }
      function drawSMAFull(smaArr, color) {
        if (!smaArr) return;
        chartCtx.strokeStyle = color; chartCtx.lineWidth = 1.4; chartCtx.setLineDash([]); chartCtx.beginPath();
        var drew = false;
        visible.forEach(function (c, i) {
          var gi = startIdx + i;
          var v = smaArr[gi];
          if (v === null) { drew = false; return; }
          var y = py(v);
          if (!drew) { chartCtx.moveTo(px(i), y); drew = true; } else { chartCtx.lineTo(px(i), y); }
        });
        chartCtx.stroke();
      }
      var _sma200arr = sma200On ? computeFullSMA(200) : null;
      var _sma400arr = sma400On ? computeFullSMA(400) : null;
      var _sma900arr = sma900On ? computeFullSMA(900) : null;
      if (sma50On) drawSMAFull(computeFullSMA(50), C.sma50);
      if (sma200On) drawSMAFull(_sma200arr, C.sma200);
      if (sma400On) drawSMAFull(_sma400arr, C.sma400);
      if (sma900On) drawSMAFull(_sma900arr, C.sma900);

      /* ── SMA Crossover markers — diamond dot where any two active SMAs cross ── */
      var _xoverPairs = [];
      if (sma200On && sma400On) _xoverPairs.push({ a: _sma200arr, b: _sma400arr, col: '#fff' });
      if (sma200On && sma900On) _xoverPairs.push({ a: _sma200arr, b: _sma900arr, col: '#fff' });
      if (sma400On && sma900On) _xoverPairs.push({ a: _sma400arr, b: _sma900arr, col: '#fff' });
      var _smaSnapPrices = [];
      _xoverPairs.forEach(function (pair) {
        visible.forEach(function (c, i) {
          var gi = startIdx + i;
          if (gi < 1) return;
          var a0 = pair.a[gi - 1], a1 = pair.a[gi], b0 = pair.b[gi - 1], b1 = pair.b[gi];
          if (a0 === null || b0 === null || a1 === null || b1 === null) return;
          if ((a0 > b0) !== (a1 > b1)) {
            var xp = px(i), yp = py((a1 + b1) / 2);
            /* Diamond shape */
            chartCtx.beginPath();
            chartCtx.moveTo(xp, yp - 7);
            chartCtx.lineTo(xp + 5, yp);
            chartCtx.lineTo(xp, yp + 7);
            chartCtx.lineTo(xp - 5, yp);
            chartCtx.closePath();
            chartCtx.fillStyle = 'rgba(255,255,255,0.9)';
            chartCtx.fill();
            chartCtx.strokeStyle = '#c9a84c';
            chartCtx.lineWidth = 1.5;
            chartCtx.stroke();
            /* Horizontal dotted guide line at cross price */
            var snapPrice = (a1 + b1) / 2;
            chartCtx.setLineDash([3, 5]);
            chartCtx.strokeStyle = 'rgba(201,168,76,0.35)';
            chartCtx.lineWidth = 0.7;
            chartCtx.beginPath();
            chartCtx.moveTo(PAD.l, yp); chartCtx.lineTo(W - PAD.r, yp);
            chartCtx.stroke();
            chartCtx.setLineDash([]);
            _smaSnapPrices.push(snapPrice);
          }
        });
      });
      window._smaSnapPrices = _smaSnapPrices;

      /* ── Fractal Geometry overlay — alternating MA-cross bridge levels ── */
      if (maCascadeOn && window.MACascade && typeof window.MACascade.draw === 'function') {
        window.MACascade.draw(chartCtx, candles, {
          PAD: PAD,
          W: W,
          worldToScreenX: worldToScreenX,
          worldToScreenY: worldToScreenY,
        });
      }

      /* ── Fractal Pattern - Specialized Paths overlay ── */
      if (fractalPathsOn && window.FractalPaths && typeof window.FractalPaths.draw === 'function') {
        window.FractalPaths.draw(chartCtx, candles, {
          PAD: PAD,
          W: W,
          worldToScreenX: worldToScreenX,
          worldToScreenY: worldToScreenY,
        });
      }

      /* ── FractalScript overlay ── */
      /* Auto-rerun if candles grew past what the result covers (debounced 1s) */
      if (fractalOverlayOn && fractalResult && fractalResult.plots && fractalResult.plots.length) {
        var _fsValLen = fractalResult.plots[0].values.length;
        if (_fsValLen < chartCandles.length && typeof _runFractalScript === 'function') {
          if (!window._fsRerunTimer) {
            window._fsRerunTimer = setTimeout(function() {
              window._fsRerunTimer = null;
              if (window.fractalOverlayOn && window.fractalSource) _runFractalScript();
            }, 1000);
          }
        }
      }
      if (fractalOverlayOn && fractalResult && fractalResult.plots) {
        var _FRACTALLEdge = PAD.l, _FRACTALREdge = W - PAD.r;
        var _fsOverlay = fractalResult.overlay !== false;

        /* Sub-pane geometry for overlay=false — bottom 28% of chart area, or full chart if maximized */
        var _fsPaneTop = 0, _fsPaneBottom = 0, _fsPaneMin = 0, _fsPaneRange = 1;
        _fsBadges = [];
        _fsMaxBtnBounds = null;
        if (!_fsOverlay) {
          var _fsPaneH;
          if (_fsMaximized) {
            _fsPaneTop = PAD.t;
            _fsPaneBottom = PAD.t + CH;
            _fsPaneH = CH;
            /* Cover the price chart area with solid bg */
            chartCtx.fillStyle = '#06080d';
            chartCtx.fillRect(PAD.l, _fsPaneTop, W - PAD.l - PAD.r, _fsPaneH);
          } else {
            _fsPaneH = Math.max(60, CH * 0.28);
            _fsPaneBottom = PAD.t + CH;
            _fsPaneTop = _fsPaneBottom - _fsPaneH;
          }
          /* Compute min/max over VISIBLE plot values only — avoids scanning 10k+ bars on every frame */
          var _fsMin = Infinity, _fsMax = -Infinity;
          var _fsVisStart = Math.max(0, startIdx), _fsVisEnd = Math.min(endIdx, fractalResult.plots.length ? fractalResult.plots[0].values.length : 0);
          for (var _fpi = 0; _fpi < fractalResult.plots.length; _fpi++) {
            var _fpv = fractalResult.plots[_fpi].values;
            var _fsVE = Math.min(endIdx, _fpv.length);
            for (var _fvi = _fsVisStart; _fvi < _fsVE; _fvi++) {
              var _fv = _fpv[_fvi];
              if (!isNaN(_fv) && isFinite(_fv)) { if (_fv < _fsMin) _fsMin = _fv; if (_fv > _fsMax) _fsMax = _fv; }
            }
          }
          if (fractalResult.hlines) {
            for (var _fhi = 0; _fhi < fractalResult.hlines.length; _fhi++) {
              var _fhp = fractalResult.hlines[_fhi].price;
              if (typeof _fhp === 'number' && !isNaN(_fhp)) {
                if (_fhp < _fsMin) _fsMin = _fhp; if (_fhp > _fsMax) _fsMax = _fhp;
              }
            }
          }
          if (!isFinite(_fsMin) || !isFinite(_fsMax)) { _fsMin = 0; _fsMax = 1; }
          if (_fsMin === _fsMax) { _fsMin -= 1; _fsMax += 1; }
          var _fsPad = (_fsMax - _fsMin) * 0.08;
          _fsMin -= _fsPad; _fsMax += _fsPad;
          _fsPaneMin = _fsMin;
          _fsPaneRange = _fsMax - _fsMin;
          /* Pane background + top separator */
          chartCtx.fillStyle = 'rgba(6,8,13,0.82)';
          chartCtx.fillRect(PAD.l, _fsPaneTop, W - PAD.l - PAD.r, _fsPaneH);
          chartCtx.strokeStyle = 'rgba(201,168,76,0.25)';
          chartCtx.lineWidth = 1;
          chartCtx.setLineDash([]);
          chartCtx.beginPath();
          chartCtx.moveTo(PAD.l, _fsPaneTop); chartCtx.lineTo(W - PAD.r, _fsPaneTop);
          chartCtx.stroke();
          /* Queue pane scale labels (plain text — null color) */
          _fsBadges.push({ y: _fsPaneTop + 10, text: _fsMax.toFixed(4), color: null });
          _fsBadges.push({ y: _fsPaneBottom - 2, text: _fsMin.toFixed(4), color: null });
          /* Maximize / restore button — top-right inside pane */
          var _btnS = 18, _btnPad = 4;
          var _btnX = _FRACTALREdge - _btnS - _btnPad;
          var _btnY = _fsPaneTop + _btnPad;
          chartCtx.fillStyle = 'rgba(201,168,76,0.12)';
          chartCtx.fillRect(_btnX, _btnY, _btnS, _btnS);
          chartCtx.strokeStyle = 'rgba(201,168,76,0.55)';
          chartCtx.lineWidth = 1;
          chartCtx.strokeRect(_btnX + 0.5, _btnY + 0.5, _btnS - 1, _btnS - 1);
          chartCtx.strokeStyle = '#c9a84c';
          chartCtx.lineWidth = 1.5;
          chartCtx.setLineDash([]);
          var _iCx = _btnX + _btnS / 2, _iCy = _btnY + _btnS / 2;
          if (_fsMaximized) {
            /* Restore icon: inner square */
            chartCtx.strokeRect(_iCx - 4, _iCy - 4, 8, 8);
          } else {
            /* Maximize icon: 4 corner brackets pointing outward */
            var _iIn = 2, _iArm = 3;
            chartCtx.beginPath();
            chartCtx.moveTo(_iCx - _iIn - _iArm, _iCy - _iIn); chartCtx.lineTo(_iCx - _iIn, _iCy - _iIn); chartCtx.lineTo(_iCx - _iIn, _iCy - _iIn - _iArm);
            chartCtx.moveTo(_iCx + _iIn + _iArm, _iCy - _iIn); chartCtx.lineTo(_iCx + _iIn, _iCy - _iIn); chartCtx.lineTo(_iCx + _iIn, _iCy - _iIn - _iArm);
            chartCtx.moveTo(_iCx - _iIn - _iArm, _iCy + _iIn); chartCtx.lineTo(_iCx - _iIn, _iCy + _iIn); chartCtx.lineTo(_iCx - _iIn, _iCy + _iIn + _iArm);
            chartCtx.moveTo(_iCx + _iIn + _iArm, _iCy + _iIn); chartCtx.lineTo(_iCx + _iIn, _iCy + _iIn); chartCtx.lineTo(_iCx + _iIn, _iCy + _iIn + _iArm);
            chartCtx.stroke();
          }
          _fsMaxBtnBounds = { x: _btnX, y: _btnY, w: _btnS, h: _btnS };
        }
        function _fsPy(v) {
          if (_fsOverlay) return py(v);
          return _fsPaneTop + (1 - (v - _fsPaneMin) / _fsPaneRange) * (_fsPaneBottom - _fsPaneTop);
        }

        /* bgcolors — always drawn on main chart */
        if (fractalResult.bgcolors) {
          for (var _bi = 0; _bi < fractalResult.bgcolors.length; _bi++) {
            var _bg = fractalResult.bgcolors[_bi];
            var _bgGi = _bg.barIndex;
            if (_bgGi < startIdx || _bgGi >= endIdx) continue;
            var _bgX = worldToScreenX(_bgGi);
            chartCtx.fillStyle = _bg.color;
            chartCtx.fillRect(_bgX - barW / 2, PAD.t, barW, CH);
          }
        }
        /* Clip plots/shapes/hlines to their pane so sub-pane lines don't bleed into price chart */
        chartCtx.save();
        chartCtx.beginPath();
        if (_fsOverlay) {
          chartCtx.rect(PAD.l, PAD.t, W - PAD.l - PAD.r, CH);
        } else {
          chartCtx.rect(PAD.l, _fsPaneTop, W - PAD.l - PAD.r, _fsPaneBottom - _fsPaneTop);
        }
        chartCtx.clip();
        /* plots — draw as lines with per-bar color continuity */
        for (var _pi = 0; _pi < fractalResult.plots.length; _pi++) {
          var _pp = fractalResult.plots[_pi];
          chartCtx.lineWidth = _pp.lineWidth || 1;
          chartCtx.setLineDash([]);
          var _activeColor = _pp.color;
          chartCtx.strokeStyle = _activeColor;
          chartCtx.beginPath();
          var _ppDrew = false;
          var _prevX = null, _prevY = null;
          var _isCircles = _pp.style === 'plot.style_circles';
          for (var _pj = 0; _pj < n; _pj++) {
            var _pgi = startIdx + _pj;
            if (_pgi < 0 || _pgi >= _pp.values.length) { _prevX = _prevY = null; continue; }
            var _pv = _pp.values[_pgi];
            if (isNaN(_pv)) {
              if (_ppDrew && !_isCircles) { chartCtx.stroke(); _ppDrew = false; }
              _prevX = _prevY = null;
              continue;
            }
            var _barColor = (_pp.colors && _pp.colors[_pgi]) ? _pp.colors[_pgi] : _pp.color;
            var _curX = px(_pj), _curY = _fsPy(_pv);
            
            if (_isCircles) {
                chartCtx.fillStyle = _barColor;
                chartCtx.beginPath();
                chartCtx.arc(_curX, _curY, _pp.lineWidth ? _pp.lineWidth + 1 : 3, 0, 2 * Math.PI);
                chartCtx.fill();
            } else {
                if (_barColor !== _activeColor) {
                  if (_ppDrew) chartCtx.stroke();
                  _activeColor = _barColor;
                  chartCtx.strokeStyle = _activeColor;
                  chartCtx.beginPath();
                  if (_prevX !== null) {
                    chartCtx.moveTo(_prevX, _prevY);
                    chartCtx.lineTo(_curX, _curY);
                  } else {
                    chartCtx.moveTo(_curX, _curY);
                  }
                  _ppDrew = true;
                } else {
                  if (!_ppDrew) { chartCtx.moveTo(_curX, _curY); _ppDrew = true; }
                  else { chartCtx.lineTo(_curX, _curY); }
                }
            }
            _prevX = _curX; _prevY = _curY;
          }
          if (_ppDrew && !_isCircles) chartCtx.stroke();

          /* Right-axis current-value badge (last non-NaN bar) */
          var _lastV = null, _lastColor = _pp.color;
          for (var _lvi = _pp.values.length - 1; _lvi >= 0; _lvi--) {
            if (!isNaN(_pp.values[_lvi])) {
              _lastV = _pp.values[_lvi];
              _lastColor = (_pp.colors && _pp.colors[_lvi]) ? _pp.colors[_lvi] : _pp.color;
              break;
            }
          }
          if (_lastV !== null) {
            var _lbY = _fsOverlay ? worldToScreenY(_lastV) : _fsPy(_lastV);
            var _inPane = _fsOverlay ? (_lbY >= PAD.t && _lbY <= H - PAD.b)
              : (_lbY >= _fsPaneTop && _lbY <= _fsPaneBottom);
            if (_inPane) {
              _fsBadges.push({ y: _lbY, text: _lastV.toFixed(3), color: _lastColor });
            }
          }
        }
        /* shapes */
        if (fractalResult.shapes) {
          for (var _si2 = 0; _si2 < fractalResult.shapes.length; _si2++) {
            var _sh = fractalResult.shapes[_si2];
            if (_sh.barIndex < startIdx || _sh.barIndex >= endIdx) continue;
            var _sx = worldToScreenX(_sh.barIndex);
            var _sy = _fsOverlay ? worldToScreenY(_sh.price) : _fsPy(_sh.price);
            var _sOff = _sh.location === 'abovebar' ? -10 : _sh.location === 'belowbar' ? 10 : 0;
            _sy += _sOff;
            chartCtx.fillStyle = _sh.color || '#4CAF50';
            chartCtx.beginPath();
            if (_sh.style === 'triangleup') {
              chartCtx.moveTo(_sx, _sy - 6); chartCtx.lineTo(_sx + 5, _sy + 4); chartCtx.lineTo(_sx - 5, _sy + 4);
            } else if (_sh.style === 'triangledown') {
              chartCtx.moveTo(_sx, _sy + 6); chartCtx.lineTo(_sx + 5, _sy - 4); chartCtx.lineTo(_sx - 5, _sy - 4);
            } else if (_sh.style === 'circle') {
              chartCtx.arc(_sx, _sy, 4, 0, Math.PI * 2);
            } else if (_sh.style === 'diamond') {
              chartCtx.moveTo(_sx, _sy - 5); chartCtx.lineTo(_sx + 4, _sy); chartCtx.lineTo(_sx, _sy + 5); chartCtx.lineTo(_sx - 4, _sy);
            } else if (_sh.style === 'cross' || _sh.style === 'xcross') {
              chartCtx.moveTo(_sx - 4, _sy - 4); chartCtx.lineTo(_sx + 4, _sy + 4); chartCtx.moveTo(_sx + 4, _sy - 4); chartCtx.lineTo(_sx - 4, _sy + 4);
              chartCtx.strokeStyle = _sh.color || '#4CAF50'; chartCtx.lineWidth = 2; chartCtx.stroke(); continue;
            } else {
              chartCtx.arc(_sx, _sy, 4, 0, Math.PI * 2);
            }
            chartCtx.closePath(); chartCtx.fill();

            /* Shape text label (Pine v5 plotshape text="..."") */
            if (_sh.text) {
              chartCtx.fillStyle = _sh.textcolor || '#2196F3';
              chartCtx.font = 'bold 11px sans-serif';
              chartCtx.textAlign = 'center';
              var _stY = _sh.location === 'abovebar' ? (_sy - 12)
                : _sh.location === 'belowbar' ? (_sy + 18)
                  : (_sy - 10);
              chartCtx.fillText(_sh.text, _sx, _stY);
            }
          }
        }
        chartCtx.restore(); /* end pane clip */
        /* hlines */
        if (fractalResult.hlines) {
          for (var _hi = 0; _hi < fractalResult.hlines.length; _hi++) {
            var _hl = fractalResult.hlines[_hi];
            var _hy = _fsOverlay ? worldToScreenY(_hl.price) : _fsPy(_hl.price);
            if (_fsOverlay && (_hy < PAD.t || _hy > H - PAD.b)) continue;
            if (!_fsOverlay && (_hy < _fsPaneTop || _hy > _fsPaneBottom)) continue;
            var _hlColor = _hl.color || '#FF9800';
            chartCtx.strokeStyle = _hlColor;
            chartCtx.lineWidth = _hl.lineWidth || 1;
            var _hls = _hl.linestyle || 'dashed';
            if (_hls === 'solid') chartCtx.setLineDash([]);
            else if (_hls === 'dotted') chartCtx.setLineDash([2, 3]);
            else chartCtx.setLineDash([4, 4]);
            chartCtx.beginPath(); chartCtx.moveTo(_FRACTALLEdge, _hy); chartCtx.lineTo(_FRACTALREdge, _hy); chartCtx.stroke();
            chartCtx.setLineDash([]);
            /* Queue right-axis price badge — drawn after outer clip is restored */
            var _hlTxt = typeof _hl.price === 'number' ? _hl.price.toFixed(3) : String(_hl.price);
            _fsBadges.push({ y: _hy, text: _hlTxt, color: _hlColor });
          }
        }
        /* P2: boxes — drawn BELOW lines/labels so annotations sit on top */
        if (fractalResult.boxes && fractalResult.boxes.length) {
          chartCtx.save();
          chartCtx.beginPath();
          chartCtx.rect(PAD.l, PAD.t, W - PAD.l - PAD.r, H - PAD.t - PAD.b);
          chartCtx.clip();
          var _bxSizePx = { tiny: 9, small: 10, normal: 12, large: 14, huge: 18, auto: 12 };
          for (var _bi = 0; _bi < fractalResult.boxes.length; _bi++) {
            var _BX = fractalResult.boxes[_bi];
            var _bx1 = worldToScreenX(_BX.left);
            var _by1 = worldToScreenY(_BX.top);
            var _bx2 = worldToScreenX(_BX.right);
            var _by2 = worldToScreenY(_BX.bottom);
            /* extend modes */
            if (_BX.extend === 'right' || _BX.extend === 'extend.right') {
              _bx2 = W - PAD.r;
            } else if (_BX.extend === 'left' || _BX.extend === 'extend.left') {
              _bx1 = PAD.l;
            } else if (_BX.extend === 'both' || _BX.extend === 'extend.both') {
              _bx1 = PAD.l; _bx2 = W - PAD.r;
            }
            /* normalize so x1<x2, y1<y2 */
            if (_bx2 < _bx1) { var _tx = _bx1; _bx1 = _bx2; _bx2 = _tx; }
            if (_by2 < _by1) { var _ty = _by1; _by1 = _by2; _by2 = _ty; }
            var _bw = _bx2 - _bx1;
            var _bh = _by2 - _by1;
            /* fill bg */
            if (_BX.bgcolor) {
              chartCtx.fillStyle = _BX.bgcolor;
              chartCtx.fillRect(_bx1, _by1, _bw, _bh);
            }
            /* stroke border */
            if (_BX.border_width > 0 && _BX.border_color) {
              chartCtx.strokeStyle = _BX.border_color;
              chartCtx.lineWidth = _BX.border_width;
              if (_BX.border_style === 'dashed') chartCtx.setLineDash([4, 4]);
              else if (_BX.border_style === 'dotted') chartCtx.setLineDash([2, 3]);
              else chartCtx.setLineDash([]);
              chartCtx.strokeRect(_bx1, _by1, _bw, _bh);
              chartCtx.setLineDash([]);
            }
            /* text inside box */
            if (_BX.text) {
              chartCtx.save();
              chartCtx.beginPath();
              chartCtx.rect(_bx1, _by1, _bw, _bh);
              chartCtx.clip();

              var _bts = _bxSizePx[_BX.text_size] || 12;
              chartCtx.font = _bts + 'px "DM Sans", sans-serif';
              chartCtx.fillStyle = _BX.text_color || '#FFFFFF';
              
              var _maxW = _bw - 8;
              if (_maxW < 20) _maxW = 20;
              
              if (!_BX._cachedLines || _BX._cachedMaxW !== _maxW) {
                var _btLines = [];
                var _rawLines = String(_BX.text).split('\n');
                
                for (var _r = 0; _r < _rawLines.length; _r++) {
                  var _line = _rawLines[_r];
                  if (chartCtx.measureText(_line).width <= _maxW) {
                    _btLines.push(_line);
                  } else {
                    var _words = _line.split(' ');
                    var _currentLine = _words[0] || '';
                    for (var _w = 1; _w < _words.length; _w++) {
                      var _word = _words[_w];
                      var _width = chartCtx.measureText(_currentLine + " " + _word).width;
                      if (_width < _maxW) {
                        _currentLine += " " + _word;
                      } else {
                        if (_currentLine) _btLines.push(_currentLine);
                        _currentLine = _word;
                      }
                    }
                    if (_currentLine) _btLines.push(_currentLine);
                  }
                }
                _BX._cachedLines = _btLines;
                _BX._cachedMaxW = _maxW;
              }
              var _btLines = _BX._cachedLines;

              chartCtx.textBaseline = (_BX.text_valign === 'top') ? 'top' :
                (_BX.text_valign === 'bottom') ? 'bottom' : 'middle';
              var _btxX, _btxY;
              if (_BX.text_halign === 'left') { chartCtx.textAlign = 'left'; _btxX = _bx1 + 4; }
              else if (_BX.text_halign === 'right') { chartCtx.textAlign = 'right'; _btxX = _bx2 - 4; }
              else { chartCtx.textAlign = 'center'; _btxX = _bx1 + _bw / 2; }
              
              if (_BX.text_valign === 'top') _btxY = _by1 + 4;
              else if (_BX.text_valign === 'bottom') _btxY = _by2 - 4;
              else _btxY = _by1 + _bh / 2;

              var _btLh = _bts + 2;
              var _btStartY = _btxY;
              if (_BX.text_valign === 'middle') {
                _btStartY = _btxY - ((_btLines.length - 1) * _btLh) / 2;
              } else if (_BX.text_valign === 'bottom') {
                _btStartY = _btxY - (_btLines.length - 1) * _btLh;
              }

              for (var _bli = 0; _bli < _btLines.length; _bli++) {
                chartCtx.fillText(_btLines[_bli], _btxX, _btStartY + _bli * _btLh);
              }
              chartCtx.restore();
            }
          }
          chartCtx.restore();
        }

        /* lines */
        if (fractalResult.lines) {
          chartCtx.save();
          chartCtx.beginPath();
          chartCtx.rect(PAD.l, PAD.t, W - PAD.l - PAD.r, H - PAD.t - PAD.b);
          chartCtx.clip();
          for (var _li = 0; _li < fractalResult.lines.length; _li++) {
            var _L = fractalResult.lines[_li];
            var _x1 = worldToScreenX(_L.x1);
            var _y1 = worldToScreenY(_L.y1);
            var _x2 = worldToScreenX(_L.x2);
            var _y2 = worldToScreenY(_L.y2);
            chartCtx.strokeStyle = _L.color || '#c9a84c';
            chartCtx.lineWidth = _L.width || 1;
            if (_L.style === 'dashed') chartCtx.setLineDash([4, 4]);
            else if (_L.style === 'dotted') chartCtx.setLineDash([2, 2]);
            else chartCtx.setLineDash([]);

            /* extend logic */
            if (_L.extend === 'right' || _L.extend === 'extend.right') {
              var dx = _x2 - _x1, dy = _y2 - _y1;
              if (dx !== 0 || dy !== 0) { _x2 += dx * 100; _y2 += dy * 100; }
            } else if (_L.extend === 'left' || _L.extend === 'extend.left') {
              var dx2 = _x1 - _x2, dy2 = _y1 - _y2;
              if (dx2 !== 0 || dy2 !== 0) { _x1 += dx2 * 100; _y1 += dy2 * 100; }
            } else if (_L.extend === 'both' || _L.extend === 'extend.both') {
              var dx3 = _x2 - _x1, dy3 = _y2 - _y1;
              if (dx3 !== 0 || dy3 !== 0) {
                _x1 -= dx3 * 100; _y1 -= dy3 * 100;
                _x2 += dx3 * 100; _y2 += dy3 * 100;
              }
            }

            /* Coordinate Clipping: Browser Canvas fails if coords are too large */
            var LIMIT = 10000;
            if (Math.abs(_x1) > LIMIT || Math.abs(_y1) > LIMIT || Math.abs(_x2) > LIMIT || Math.abs(_y2) > LIMIT) {
              // Basic clipping to keep it within a few thousand pixels of the screen
              if (_x1 < -LIMIT) _x1 = -LIMIT; if (_x1 > LIMIT) _x1 = LIMIT;
              if (_y1 < -LIMIT) _y1 = -LIMIT; if (_y1 > LIMIT) _y1 = LIMIT;
              if (_x2 < -LIMIT) _x2 = -LIMIT; if (_x2 > LIMIT) _x2 = LIMIT;
              if (_y2 < -LIMIT) _y2 = -LIMIT; if (_y2 > LIMIT) _y2 = LIMIT;
            }

            chartCtx.beginPath();
            chartCtx.moveTo(_x1, _y1);
            chartCtx.lineTo(_x2, _y2);
            chartCtx.stroke();
          }
          chartCtx.restore();
        }
        /* labels */
        if (fractalResult.labels && fractalResult.labels.length) {
          chartCtx.save();
          var _fsSizePx = { tiny: 9, small: 10, normal: 12, large: 14, huge: 18, auto: 11 };
          /* Clip to chart area (or pane) so off-screen labels don't bleed */
          if (_fsOverlay) {
            chartCtx.beginPath();
            chartCtx.rect(PAD.l, PAD.t, W - PAD.l - PAD.r, CH);
            chartCtx.clip();
          } else {
            chartCtx.beginPath();
            chartCtx.rect(PAD.l, _fsPaneTop, W - PAD.l - PAD.r, _fsPaneBottom - _fsPaneTop);
            chartCtx.clip();
          }
          for (var _lbi = 0; _lbi < fractalResult.labels.length; _lbi++) {
            var _LB = fractalResult.labels[_lbi];
            var _lx = worldToScreenX(_LB.x);
            var _ly = _fsOverlay ? worldToScreenY(_LB.y) : _fsPy(_LB.y);
            /* Skip labels clearly off-screen */
            if (_lx < -200 || _lx > W + 200) continue;
            var _lfont = (_fsSizePx[_LB.size] || 12);
            chartCtx.font = _lfont + 'px "DM Sans", sans-serif';
            chartCtx.textBaseline = 'middle';
            chartCtx.textAlign = 'center';
            var _ltext = String(_LB.text == null ? '' : _LB.text);
            var _ltlines = _ltext.split('\n');
            var _llh = _lfont + 2;
            var _ltw = 0;
            for (var _lmi = 0; _lmi < _ltlines.length; _lmi++) { var _lmw = chartCtx.measureText(_ltlines[_lmi]).width; if (_lmw > _ltw) _ltw = _lmw; }
            var _lpadX = 6, _lpadY = 3;
            var _lbw = _ltw + _lpadX * 2;
            var _lbh = _ltlines.length * _llh + _lpadY * 2;
            var _style = _LB.style || 'label_down';
            var _lbox = null; // {x, y, w, h}
            var _arrow = null; // {ax, ay, bx, by, cx, cy}
            /* Position box + arrow by style */
            if (_style === 'label_down') {
              _lbox = { x: _lx - _lbw / 2, y: _ly + 6, w: _lbw, h: _lbh };
              _arrow = { ax: _lx, ay: _ly, bx: _lx - 5, by: _ly + 6, cx: _lx + 5, cy: _ly + 6 };
            } else if (_style === 'label_up') {
              _lbox = { x: _lx - _lbw / 2, y: _ly - 6 - _lbh, w: _lbw, h: _lbh };
              _arrow = { ax: _lx, ay: _ly, bx: _lx - 5, by: _ly - 6, cx: _lx + 5, cy: _ly - 6 };
            } else if (_style === 'label_left') {
              _lbox = { x: _lx - _lbw - 6, y: _ly - _lbh / 2, w: _lbw, h: _lbh };
              _arrow = { ax: _lx, ay: _ly, bx: _lx - 6, by: _ly - 5, cx: _lx - 6, cy: _ly + 5 };
            } else if (_style === 'label_right') {
              _lbox = { x: _lx + 6, y: _ly - _lbh / 2, w: _lbw, h: _lbh };
              _arrow = { ax: _lx, ay: _ly, bx: _lx + 6, by: _ly - 5, cx: _lx + 6, cy: _ly + 5 };
            } else if (_style === 'label_center') {
              _lbox = { x: _lx - _lbw / 2, y: _ly - _lbh / 2, w: _lbw, h: _lbh };
            } else if (_style === 'label_upper_left') {
              _lbox = { x: _lx - _lbw, y: _ly - _lbh, w: _lbw, h: _lbh };
            } else if (_style === 'label_upper_right') {
              _lbox = { x: _lx, y: _ly - _lbh, w: _lbw, h: _lbh };
            } else if (_style === 'label_lower_left') {
              _lbox = { x: _lx - _lbw, y: _ly, w: _lbw, h: _lbh };
            } else if (_style === 'label_lower_right') {
              _lbox = { x: _lx, y: _ly, w: _lbw, h: _lbh };
            } else if (_style === 'none') {
              _lbox = null; // text only, no background
            } else {
              /* marker styles: arrowup/down, triangleup/down, circle, square, diamond, flag, cross, xcross */
              var _fcolor = _LB.color || '#2196F3';
              chartCtx.fillStyle = _fcolor;
              chartCtx.strokeStyle = _fcolor;
              chartCtx.lineWidth = 2;
              chartCtx.beginPath();
              if (_style === 'arrowup' || _style === 'triangleup') {
                chartCtx.moveTo(_lx, _ly - 7); chartCtx.lineTo(_lx + 6, _ly + 4); chartCtx.lineTo(_lx - 6, _ly + 4); chartCtx.closePath(); chartCtx.fill();
              } else if (_style === 'arrowdown' || _style === 'triangledown') {
                chartCtx.moveTo(_lx, _ly + 7); chartCtx.lineTo(_lx + 6, _ly - 4); chartCtx.lineTo(_lx - 6, _ly - 4); chartCtx.closePath(); chartCtx.fill();
              } else if (_style === 'circle') {
                chartCtx.arc(_lx, _ly, 5, 0, Math.PI * 2); chartCtx.fill();
              } else if (_style === 'square') {
                chartCtx.fillRect(_lx - 5, _ly - 5, 10, 10);
              } else if (_style === 'diamond') {
                chartCtx.moveTo(_lx, _ly - 6); chartCtx.lineTo(_lx + 5, _ly); chartCtx.lineTo(_lx, _ly + 6); chartCtx.lineTo(_lx - 5, _ly); chartCtx.closePath(); chartCtx.fill();
              } else if (_style === 'flag') {
                chartCtx.fillRect(_lx, _ly - 8, 8, 6);
                chartCtx.fillRect(_lx, _ly - 8, 1, 12);
              } else if (_style === 'cross' || _style === 'xcross') {
                chartCtx.moveTo(_lx - 5, _ly - 5); chartCtx.lineTo(_lx + 5, _ly + 5);
                chartCtx.moveTo(_lx + 5, _ly - 5); chartCtx.lineTo(_lx - 5, _ly + 5);
                chartCtx.stroke();
              }
              /* text below the marker if any */
              if (_ltext) {
                _lbox = { x: _lx - _lbw / 2, y: _ly + 10, w: _lbw, h: _lbh };
              }
            }
            /* Draw arrow (triangle pointer) */
            if (_arrow) {
              chartCtx.fillStyle = _LB.color || '#2196F3';
              chartCtx.beginPath();
              chartCtx.moveTo(_arrow.ax, _arrow.ay);
              chartCtx.lineTo(_arrow.bx, _arrow.by);
              chartCtx.lineTo(_arrow.cx, _arrow.cy);
              chartCtx.closePath();
              chartCtx.fill();
            }
            /* Draw box */
            if (_lbox) {
              chartCtx.fillStyle = _LB.color || '#2196F3';
              chartCtx.beginPath();
              if (chartCtx.roundRect) {
                chartCtx.roundRect(_lbox.x, _lbox.y, _lbox.w, _lbox.h, 3);
              } else {
                chartCtx.rect(_lbox.x, _lbox.y, _lbox.w, _lbox.h);
              }
              chartCtx.fill();
            }
            /* Draw text */
            if (_ltext) {
              chartCtx.fillStyle = _LB.textcolor || '#FFFFFF';
              var _tx, _ty;
              if (_lbox) {
                var _align = _LB.textalign || 'center';
                if (_align === 'left') { chartCtx.textAlign = 'left'; _tx = _lbox.x + _lpadX; }
                else if (_align === 'right') { chartCtx.textAlign = 'right'; _tx = _lbox.x + _lbox.w - _lpadX; }
                else { chartCtx.textAlign = 'center'; _tx = _lbox.x + _lbox.w / 2; }
                _ty = _lbox.y + _lbox.h / 2;
              } else {
                /* style === 'none' — draw at point */
                chartCtx.textAlign = 'center';
                _tx = _lx; _ty = _ly;
              }
              var _tly0 = _lbox ? (_lbox.y + _lpadY + _llh / 2) : (_ty - (_ltlines.length - 1) * _llh / 2);
              for (var _tli = 0; _tli < _ltlines.length; _tli++) {
                chartCtx.fillText(_ltlines[_tli], _tx, _tly0 + _tli * _llh);
              }
            }
          }
          chartCtx.restore();
        }
        /* tables */
        if (fractalResult.tables && fractalResult.tables.length) {
          chartCtx.save();
          var _tSizePx = { tiny: 8, small: 10, normal: 12, large: 14, huge: 18, auto: 12 };
          var _tPadX = 4, _tPadY = 2;
          var _tChartX = PAD.l, _tChartY = PAD.t;
          var _tChartW = W - PAD.l - PAD.r, _tChartH = CH;
          for (var _ti = 0; _ti < fractalResult.tables.length; _ti++) {
            var _T = fractalResult.tables[_ti];
            var cells = _T.cells || {};
            if (!Object.keys(cells).length) continue;
            /* compute column widths and row heights from cell text */
            var colW = new Array(_T.cols).fill(0);
            var rowH = new Array(_T.rows).fill(0);
            for (var _ck in cells) {
              var _cell = cells[_ck];
              if (_cell.col >= _T.cols || _cell.row >= _T.rows) continue;
              var _fs = _tSizePx[_cell.text_size] || 12;
              chartCtx.font = _fs + 'px "DM Sans", sans-serif';
              var _txt = _cell.text || '';
              var _tw = chartCtx.measureText(_txt).width;
              var _cw = Math.max(_tw + _tPadX * 2, _cell.width || 0);
              var _ch = Math.max(_fs + _tPadY * 2, _cell.height || 0);
              if (_cw > colW[_cell.col]) colW[_cell.col] = _cw;
              if (_ch > rowH[_cell.row]) rowH[_cell.row] = _ch;
            }
            var totalW = colW.reduce(function (a, b) { return a + b; }, 0);
            var totalH = rowH.reduce(function (a, b) { return a + b; }, 0);
            if (totalW <= 0 || totalH <= 0) continue;
            /* anchor position */
            var pos = _T.position || 'top_right';
            var ax, ay;
            if (pos.indexOf('top') === 0) ay = _tChartY + 4;
            else if (pos.indexOf('middle') === 0) ay = _tChartY + (_tChartH - totalH) / 2;
            else ay = _tChartY + _tChartH - totalH - 4;
            if (pos.indexOf('_left') > 0) ax = _tChartX + 4;
            else if (pos.indexOf('_center') > 0) ax = _tChartX + (_tChartW - totalW) / 2;
            else ax = _tChartX + _tChartW - totalW - 4;
            /* frame bg */
            if (_T.bgcolor) {
              chartCtx.fillStyle = _T.bgcolor;
              chartCtx.fillRect(ax, ay, totalW, totalH);
            }
            /* cells */
            var cellX = ax;
            for (var _cc = 0; _cc < _T.cols; _cc++) {
              var cellY = ay;
              for (var _rr = 0; _rr < _T.rows; _rr++) {
                var _c = cells[_cc + ',' + _rr];
                if (_c) {
                  if (_c.bgcolor) {
                    chartCtx.fillStyle = _c.bgcolor;
                    chartCtx.fillRect(cellX, cellY, colW[_cc], rowH[_rr]);
                  }
                  if (_T.border_color && _T.border_width > 0) {
                    chartCtx.strokeStyle = _T.border_color;
                    chartCtx.lineWidth = _T.border_width;
                    chartCtx.strokeRect(cellX, cellY, colW[_cc], rowH[_rr]);
                  }
                  if (_c.text) {
                    var _cfs = _tSizePx[_c.text_size] || 12;
                    chartCtx.font = _cfs + 'px "DM Sans", sans-serif';
                    chartCtx.fillStyle = _c.text_color || '#000000';
                    var _cha = _c.text_halign || 'center';
                    var _cva = _c.text_valign || 'center';
                    var _ctx, _cty;
                    if (_cha === 'left') { chartCtx.textAlign = 'left'; _ctx = cellX + _tPadX; }
                    else if (_cha === 'right') { chartCtx.textAlign = 'right'; _ctx = cellX + colW[_cc] - _tPadX; }
                    else { chartCtx.textAlign = 'center'; _ctx = cellX + colW[_cc] / 2; }
                    if (_cva === 'top') { chartCtx.textBaseline = 'top'; _cty = cellY + _tPadY; }
                    else if (_cva === 'bottom') { chartCtx.textBaseline = 'bottom'; _cty = cellY + rowH[_rr] - _tPadY; }
                    else { chartCtx.textBaseline = 'middle'; _cty = cellY + rowH[_rr] / 2; }
                    chartCtx.fillText(_c.text, _ctx, _cty);
                  }
                }
                cellY += rowH[_rr];
              }
              cellX += colW[_cc];
            }
            /* outer frame */
            if (_T.frame_color && _T.frame_width > 0) {
              chartCtx.strokeStyle = _T.frame_color;
              chartCtx.lineWidth = _T.frame_width;
              chartCtx.strokeRect(ax, ay, totalW, totalH);
            }
          }
          chartCtx.restore();
        }

        /* strategy markers moved — drawn after candles so they appear on top */
      }

      /* smaCrossZoneOn SMAs hidden — bar pattern drawing shows the result */

      /* ── Fractal Cross overlay ── */
      if (smaCrossZoneOn && candles.length >= 900) {
        /* Calculate SMAs for full candle array */
        function calcSMA(period) {
          var out = new Array(candles.length).fill(null);
          for (var i = period - 1; i < candles.length; i++) {
            var s = 0; for (var k = 0; k < period; k++) s += candles[i - k].c;
            out[i] = s / period;
          }
          return out;
        }
        var sma200arr = calcSMA(200);
        var sma400arr = calcSMA(400);
        var sma900arr = candles.length >= 900 ? calcSMA(900) : null;

        /* Find last cross of SMA200 x SMA400 */
        var cross200_400 = -1;
        var cross200_400_bull = false;
        for (var ci = candles.length - 1; ci >= 400; ci--) {
          var prev200 = sma200arr[ci - 1], prev400 = sma400arr[ci - 1];
          var cur200 = sma200arr[ci], cur400 = sma400arr[ci];
          if (prev200 === null || prev400 === null || cur200 === null || cur400 === null) continue;
          if (prev200 <= prev400 && cur200 > cur400) { cross200_400 = ci; cross200_400_bull = true; break; }
          if (prev200 >= prev400 && cur200 < cur400) { cross200_400 = ci; cross200_400_bull = false; break; }
        }

        /* Find last cross of SMA400 x SMA900 */
        var cross400_900 = -1;
        var cross400_900_bull = false;
        if (sma900arr) {
          for (var ci = candles.length - 1; ci >= 900; ci--) {
            var prev400b = sma400arr[ci - 1], prev900 = sma900arr[ci - 1];
            var cur400b = sma400arr[ci], cur900 = sma900arr[ci];
            if (prev400b === null || prev900 === null || cur400b === null || cur900 === null) continue;
            if (prev400b <= prev900 && cur400b > cur900) { cross400_900 = ci; cross400_900_bull = true; break; }
            if (prev400b >= prev900 && cur400b < cur900) { cross400_900 = ci; cross400_900_bull = false; break; }
          }
        }

        /* Vertical lines and mini panel hidden — bar pattern drawing is the visual */
        if (false) { /* disabled */
          function drawCrossLine(bi, color, label) {
            var vx = worldToScreenX(bi);
            if (vx < PAD.l || vx > W - PAD.r) return;
            chartCtx.strokeStyle = color; chartCtx.lineWidth = 1.5; chartCtx.setLineDash([5, 4]);
            chartCtx.beginPath(); chartCtx.moveTo(vx, PAD.t); chartCtx.lineTo(vx, PAD.t + CH); chartCtx.stroke();
            chartCtx.setLineDash([]);
            chartCtx.fillStyle = color; chartCtx.font = 'bold 9px DM Mono'; chartCtx.textAlign = 'center';
            chartCtx.fillText(label, vx, PAD.t + 12);
          }
          if (cross200_400 >= 0) drawCrossLine(cross200_400, 'rgba(100,180,255,0.85)', '200×400');
          if (cross400_900 >= 0) drawCrossLine(cross400_900, 'rgba(255,160,80,0.85)', '400×900');

          /* Draw mini bar pattern above the chart */
          var zoneStart = -1, zoneEnd = -1, isBull = false;
          if (cross200_400 >= 0 && cross400_900 >= 0) {
            zoneStart = Math.min(cross200_400, cross400_900);
            zoneEnd = Math.max(cross200_400, cross400_900);
            isBull = cross200_400_bull;
          } else if (cross200_400 >= 0) {
            zoneStart = Math.max(0, cross200_400 - 20);
            zoneEnd = cross200_400;
            isBull = cross200_400_bull;
          }

          if (zoneStart >= 0 && zoneEnd > zoneStart) {
            var patCandles = candles.slice(zoneStart, zoneEnd + 1);
            var patCount = patCandles.length;
            if (patCount > 0) {
              /* Panel: top-right corner, above chart */
              var PW = Math.min(200, patCount * 4 + 16);
              var PH = 60;
              var PX = W - PAD.r - PW - 4;
              var PY = PAD.t + 2;

              /* Background */
              chartCtx.fillStyle = 'rgba(6,8,13,0.88)';
              chartCtx.strokeStyle = isBull ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)';
              chartCtx.lineWidth = 1;
              chartCtx.setLineDash([]);
              chartCtx.beginPath(); chartCtx.roundRect ? chartCtx.roundRect(PX, PY, PW, PH, 3) : chartCtx.rect(PX, PY, PW, PH);
              chartCtx.fill(); chartCtx.stroke();

              /* Label */
              chartCtx.fillStyle = isBull ? 'rgba(38,166,154,0.9)' : 'rgba(239,83,80,0.9)';
              chartCtx.font = 'bold 8px DM Mono'; chartCtx.textAlign = 'left';
              chartCtx.fillText('SMA CROSS · ' + patCount + ' bars', PX + 5, PY + 9);

              /* Mini candles */
              var patMn = Math.min.apply(null, patCandles.map(function (c) { return c.l; }));
              var patMx = Math.max.apply(null, patCandles.map(function (c) { return c.h; }));
              var patRange = patMx - patMn || patMn * 0.001 || 1;
              var bW = Math.max(1, Math.floor((PW - 10) / patCount));
              var bW2 = Math.max(1, bW - 1);
              var cH2 = PH - 14;
              function patY(v) { return PY + 12 + (1 - (v - patMn) / patRange) * (cH2 - 2); }

              patCandles.forEach(function (c, i) {
                var bx = PX + 5 + i * bW;
                var bull = c.c >= c.o;
                var col = bull ? 'rgba(38,166,154,0.85)' : 'rgba(239,83,80,0.85)';
                chartCtx.strokeStyle = col; chartCtx.lineWidth = 1;
                /* Wick */
                chartCtx.beginPath();
                chartCtx.moveTo(bx + bW2 / 2, patY(c.h));
                chartCtx.lineTo(bx + bW2 / 2, patY(c.l));
                chartCtx.stroke();
                /* Body */
                var by1 = patY(Math.max(c.o, c.c));
                var by2 = patY(Math.min(c.o, c.c));
                var bodyH = Math.max(1, by2 - by1);
                chartCtx.fillStyle = col;
                chartCtx.fillRect(bx, by1, bW2, bodyH);
              });
            }
          }
        } /* end if(false) */
      } /* end if(smaCrossZoneOn) */

      /* Chart type rendering */
      if (chartType === 'area' || chartType === 'line') {
        /* Area / Line */
        chartCtx.beginPath();
        visible.forEach(function (c, i) { if (i === 0) chartCtx.moveTo(px(i), py(c.c)); else chartCtx.lineTo(px(i), py(c.c)); });
        if (chartType === 'area') {
          chartCtx.lineTo(px(n - 1), H - PAD.b); chartCtx.lineTo(px(0), H - PAD.b); chartCtx.closePath();
          chartCtx.fillStyle = 'rgba(201,168,76,.1)'; chartCtx.fill();
          chartCtx.beginPath();
          visible.forEach(function (c, i) { if (i === 0) chartCtx.moveTo(px(i), py(c.c)); else chartCtx.lineTo(px(i), py(c.c)); });
        }
        chartCtx.strokeStyle = '#c9a84c'; chartCtx.lineWidth = 1.5; chartCtx.setLineDash([]); chartCtx.stroke();
      } else if (chartType === 'bars') {
        /* OHLC bars */
        visible.forEach(function (c, i) {
          var col = c.c >= c.o ? C.up : C.dn, x = px(i);
          chartCtx.strokeStyle = col; chartCtx.lineWidth = 1.5;
          chartCtx.beginPath(); chartCtx.moveTo(x, py(c.h)); chartCtx.lineTo(x, py(c.l)); chartCtx.stroke();
          chartCtx.beginPath(); chartCtx.moveTo(x - barW * 0.3, py(c.o)); chartCtx.lineTo(x, py(c.o)); chartCtx.stroke();
          chartCtx.beginPath(); chartCtx.moveTo(x, py(c.c)); chartCtx.lineTo(x + barW * 0.3, py(c.c)); chartCtx.stroke();
        });
      } else if (chartType === 'hollow') {
        /* Hollow candles */
        visible.forEach(function (c, i) {
          var col = c.c >= c.o ? C.up : C.dn, x = px(i);
          chartCtx.strokeStyle = col; chartCtx.lineWidth = 1.2;
          chartCtx.beginPath(); chartCtx.moveTo(x, py(c.h)); chartCtx.lineTo(x, py(c.l)); chartCtx.stroke();
          var top = py(Math.max(c.o, c.c)), bh = Math.max(1.5, py(Math.min(c.o, c.c)) - top);
          if (c.c >= c.o) {
            chartCtx.strokeRect(x - candleW / 2, top, candleW, bh); /* hollow up */
          } else {
            chartCtx.fillStyle = col; chartCtx.fillRect(x - candleW / 2, top, candleW, bh); /* solid down */
          }
        });
      } else {
        /* Default: filled candles */
        visible.forEach(function (c, i) {
          var col = c.c >= c.o ? C.up : C.dn, x = px(i);
          chartCtx.strokeStyle = col; chartCtx.lineWidth = 1;
          chartCtx.beginPath(); chartCtx.moveTo(x, py(c.h)); chartCtx.lineTo(x, py(c.l)); chartCtx.stroke();
          var top = py(Math.max(c.o, c.c)), bh = Math.max(1.5, py(Math.min(c.o, c.c)) - top);
          chartCtx.fillStyle = col; chartCtx.fillRect(x - candleW / 2, top, candleW, bh);
        });
      }

      /* ── Strategy markers — drawn after candles so labels are always on top ── */
      window._fsTradeHits = [];
      if (fractalOverlayOn && fractalResult && fractalResult.strategyResult &&
        fractalResult.strategyResult.trades.length) {
        var _sm_trades = fractalResult.strategyResult.trades;
        var _sm_entCol = '#2196F3';
        var _sm_entSCol = '#e91e63';
        var _sm_tpCol = '#9c27b0';
        var _sm_winCol = '#26a69a';
        var _sm_lossCol = '#ef5350';

        function _smLabelBox(text, cx, cy, bgColor, textColor) {
          chartCtx.font = 'bold 11px DM Mono';
          var tw = chartCtx.measureText(text).width;
          var bw = tw + 10, bh = 16, bx = cx - bw / 2, by = cy - bh / 2;
          chartCtx.fillStyle = bgColor;
          if (chartCtx.roundRect) chartCtx.roundRect(bx, by, bw, bh, 3);
          else chartCtx.rect(bx, by, bw, bh);
          chartCtx.fill();
          chartCtx.fillStyle = textColor;
          chartCtx.textAlign = 'center';
          chartCtx.textBaseline = 'middle';
          chartCtx.fillText(text, cx, cy);
          return { x: bx, y: by, w: bw, h: bh };
        }

        chartCtx.save();
        for (var _smi = 0; _smi < _sm_trades.length; _smi++) {
          var _smt = _sm_trades[_smi];
          var _smLng = _smt.direction === 'long';
          var _smEx = worldToScreenX(_smt.entryBar);
          var _smXx = worldToScreenX(_smt.exitBar);
          var _smEy = worldToScreenY(_smt.entryPrice);
          var _smXy = worldToScreenY(_smt.exitPrice);
          var _smWin = _smt.profit >= 0;

          if (_smEx < PAD.l - 20 && _smXx < PAD.l - 20) continue;
          if (_smEx > W - PAD.r + 20 && _smXx > W - PAD.r + 20) continue;

          /* connector */
          chartCtx.strokeStyle = _smWin ? 'rgba(38,166,154,0.3)' : 'rgba(239,83,80,0.3)';
          chartCtx.lineWidth = 1;
          chartCtx.setLineDash([3, 3]);
          chartCtx.beginPath();
          chartCtx.moveTo(_smEx, _smEy);
          chartCtx.lineTo(_smXx, _smXy);
          chartCtx.stroke();
          chartCtx.setLineDash([]);

          /* entry arrow */
          var _smEC = _smLng ? _sm_entCol : _sm_entSCol;
          chartCtx.fillStyle = _smEC;
          chartCtx.beginPath();
          if (_smLng) {
            chartCtx.moveTo(_smEx, _smEy + 4); chartCtx.lineTo(_smEx - 7, _smEy + 16); chartCtx.lineTo(_smEx + 7, _smEy + 16);
          } else {
            chartCtx.moveTo(_smEx, _smEy - 4); chartCtx.lineTo(_smEx - 7, _smEy - 16); chartCtx.lineTo(_smEx + 7, _smEy - 16);
          }
          chartCtx.closePath(); chartCtx.fill();

          /* entry label box */
          var _smEntLbl = _smLng ? 'Long' : 'Short';
          var _smEntLY = _smLng ? _smEy + 26 : _smEy - 26;
          var _smEBox = _smLabelBox(_smEntLbl, _smEx, _smEntLY, _smEC, '#fff');
          window._fsTradeHits.push({ x: _smEBox.x, y: _smEBox.y, w: _smEBox.w, h: _smEBox.h, trade: _smt, kind: 'entry' });

          /* exit arrow */
          chartCtx.fillStyle = _sm_tpCol;
          chartCtx.beginPath();
          if (_smLng) {
            chartCtx.moveTo(_smXx, _smXy - 4); chartCtx.lineTo(_smXx - 7, _smXy - 16); chartCtx.lineTo(_smXx + 7, _smXy - 16);
          } else {
            chartCtx.moveTo(_smXx, _smXy + 4); chartCtx.lineTo(_smXx - 7, _smXy + 16); chartCtx.lineTo(_smXx + 7, _smXy + 16);
          }
          chartCtx.closePath(); chartCtx.fill();

          /* exit label box */
          var _smExitLbl = (_smt.id || (_smLng ? 'Long' : 'Short')) + ' TP/SL';
          var _smExtLY = _smLng ? _smXy - 26 : _smXy + 26;
          var _smXBox = _smLabelBox(_smExitLbl, _smXx, _smExtLY, _sm_tpCol, '#fff');

          /* P&L amount below exit label */
          var _smPnl = (_smWin ? '+' : '') + _smt.profit.toFixed(2);
          var _smPnlY = _smLng ? _smExtLY - 14 : _smExtLY + 14;
          chartCtx.font = 'bold 10px DM Mono';
          chartCtx.fillStyle = _smWin ? _sm_winCol : _sm_lossCol;
          chartCtx.textAlign = 'center';
          chartCtx.textBaseline = 'middle';
          chartCtx.fillText(_smPnl, _smXx, _smPnlY);

          window._fsTradeHits.push({ x: _smXBox.x, y: _smXBox.y, w: _smXBox.w, h: _smXBox.h, trade: _smt, kind: 'exit' });
        }
        chartCtx.restore();

        /* summary badge */
        var _smSr = fractalResult.strategyResult.summary;
        var _smPnl = _smSr.netProfit;
        var _smLines = [
          'Net P&L: ' + (_smPnl >= 0 ? '+' : '') + _smPnl.toFixed(2),
          'Win rate: ' + (_smSr.winRate * 100).toFixed(1) + '%',
          _smSr.totalTrades + ' trades'
        ];
        chartCtx.save();
        chartCtx.font = 'bold 11px DM Mono';
        var _smBLH = 17, _smBPad = 9, _smBW = 0;
        for (var _smBi = 0; _smBi < _smLines.length; _smBi++) {
          var _smLW = chartCtx.measureText(_smLines[_smBi]).width;
          if (_smLW > _smBW) _smBW = _smLW;
        }
        _smBW += _smBPad * 2;
        var _smBH = _smLines.length * _smBLH + _smBPad * 2;
        var _smBX = PAD.l + 8, _smBY = PAD.t + 8;
        chartCtx.fillStyle = 'rgba(6,8,13,0.88)';
        if (chartCtx.roundRect) chartCtx.roundRect(_smBX, _smBY, _smBW, _smBH, 4);
        else chartCtx.rect(_smBX, _smBY, _smBW, _smBH);
        chartCtx.fill();
        chartCtx.strokeStyle = _smPnl >= 0 ? 'rgba(38,166,154,0.7)' : 'rgba(239,83,80,0.7)';
        chartCtx.lineWidth = 1;
        if (chartCtx.roundRect) chartCtx.roundRect(_smBX, _smBY, _smBW, _smBH, 4);
        else chartCtx.rect(_smBX, _smBY, _smBW, _smBH);
        chartCtx.stroke();
        chartCtx.textAlign = 'left';
        chartCtx.textBaseline = 'middle';
        for (var _smLi = 0; _smLi < _smLines.length; _smLi++) {
          chartCtx.fillStyle = _smLi === 0 ? (_smPnl >= 0 ? '#26a69a' : '#ef5350') : 'rgba(180,190,210,0.9)';
          chartCtx.fillText(_smLines[_smLi], _smBX + _smBPad, _smBY + _smBPad + _smLi * _smBLH + _smBLH / 2);
        }
        chartCtx.restore();
      }

      /* Time axis drawn after clip restore — labels sit in the PAD.b strip below chart */
      /* (moved — see renderTimeAxis call after chartCtx.restore() below) */

      /* Current price line — dashed line only, stays inside clip bounds */
      if (candles.length > 0) {
        var liveC = candles[candles.length - 1];
        var _displayPrice = (_animLivePrice !== null) ? _animLivePrice : liveC.c;
        var pyVal = py(_displayPrice);
        var lastY = Math.max(PAD.t + 10, Math.min(H - PAD.b - 10, pyVal));
        var liveCol = (liveC.c >= liveC.o) ? '#26a69a' : '#ef5350';
        var liveLineCol = (liveC.c >= liveC.o) ? 'rgba(38,166,154,0.5)' : 'rgba(239,83,80,0.5)';
        var _liveX = worldToScreenX(candles.length - 1);
        var isLiveVisible = (_liveX >= PAD.l && _liveX <= W - PAD.r);
        if (isLiveVisible && pyVal >= PAD.t && pyVal <= H - PAD.b) {
          chartCtx.save();
          chartCtx.strokeStyle = liveLineCol;
          chartCtx.lineWidth = 1; chartCtx.setLineDash([4, 4]);
          chartCtx.beginPath(); chartCtx.moveTo(PAD.l, lastY); chartCtx.lineTo(W - PAD.r, lastY); chartCtx.stroke();
          chartCtx.setLineDash([]);
          chartCtx.restore();
        }
      }

      /* Watermarks - 5 positions */
      chartCtx.save();
      chartCtx.font = 'bold 11px DM Mono';
      chartCtx.fillStyle = 'rgba(201,168,76,0.072)';

      /* Central upper left */
      chartCtx.textAlign = 'left';
      chartCtx.fillText('FRACTAL AI AGENT', W * 0.25, H * 0.3);

      /* Center (original) */
      chartCtx.textAlign = 'center';
      chartCtx.fillText('FRACTAL AI AGENT', W / 2, H / 2 + 6);

      /* Upper right */
      chartCtx.textAlign = 'right';
      chartCtx.fillText('FRACTAL AI AGENT', W * 0.75, H * 0.3);

      /* Lower left */
      chartCtx.textAlign = 'left';
      chartCtx.fillText('FRACTAL AI AGENT', W * 0.25, H * 0.75);

      /* Lower right */
      chartCtx.textAlign = 'right';
      chartCtx.fillText('FRACTAL AI AGENT', W * 0.75, H * 0.75);

      chartCtx.restore();

      /* ── VPVR overlay — width = gap between last candle and price axis ── */
      if (vpvrOn) {
        var _vpvrRight = W - PAD.r - 2;
        var _lastCandleX = worldToScreenX(endIdx - 1) + candleW / 2;
        var _vpvrGapW = _vpvrRight - _lastCandleX;
        drawVPVR(chartCtx, visible, mn, mx, range, W, H, PAD, CW, CH, _vpvrGapW);
      }

      /* ── Liquidity Heatmap overlay ── */
      if (liqHeatmapOn) drawLiqHeatmap(chartCtx, visible, mn, mx, range, W, H, PAD, CW, CH);

      /* ── Volume Bubbles overlay ── */
      if (volBubblesOn) drawVolumeBubbles(chartCtx, visible, mn, mx, range, W, H, PAD, CW, CH, barW);

      /* ── Quantitative overlays ── */
      if (hurstOn) drawHurst(chartCtx, visible, mn, mx, range, W, H, PAD, CW, CH);
      if (garchBandsOn) drawGARCH(chartCtx, visible, mn, mx, range, W, H, PAD, CW, CH, barW);
      if (fractalSignalOn) drawFractalSignal(chartCtx, visible, mn, mx, range, W, H, PAD, CW, CH);
      if (kalmanOn) drawKalman(chartCtx, visible, mn, mx, range, W, H, PAD, CW, CH, barW);
      if (fmOn) drawFractalMomentum(chartCtx, candles, startIdx, endIdx, PAD, W, H, CH, px, py);
      if (!fmOn) { var _fmb = document.getElementById('fmBadge'); if (_fmb) _fmb.style.display = 'none'; }
      if (gbmOn) drawGBM(chartCtx, visible, mn, mx, range, W, H, PAD, CW, CH, barW);
      if (ouOn) drawOU(chartCtx, visible, mn, mx, range, W, H, PAD, CW, CH, barW);

      /* ── Restore clip — drawing below this line may use full canvas ── */
      chartCtx.restore();

      /* FractalScript sub-pane badges — queued during clipped render, drawn now */
      if (_fsBadges && _fsBadges.length) {
        chartCtx.textAlign = 'left';
        var _fbREdge = W - _chartPAD.r;
        for (var _fbI = 0; _fbI < _fsBadges.length; _fbI++) {
          var _fb = _fsBadges[_fbI];
          if (_fb.color) {
            chartCtx.font = 'bold 10px sans-serif';
            var _fbW = chartCtx.measureText(_fb.text).width + 8;
            chartCtx.fillStyle = _fb.color;
            chartCtx.fillRect(_fbREdge + 2, _fb.y - 7, _fbW, 14);
            chartCtx.fillStyle = '#000';
            chartCtx.fillText(_fb.text, _fbREdge + 6, _fb.y + 4);
          } else {
            chartCtx.font = '10px sans-serif';
            chartCtx.fillStyle = 'rgba(180,190,210,0.6)';
            chartCtx.fillText(_fb.text, _fbREdge + 4, _fb.y);
          }
        }
      }

      /* Price badge — pinned to price axis, needs to draw outside clip */
      if (candles.length > 0) {
        var _liveC2 = candles[candles.length - 1];
        var _displayPrice2 = (_animLivePrice !== null) ? _animLivePrice : _liveC2.c;
        var _pyVal2 = py(_displayPrice2);
        var _lastY2 = Math.max(PAD.t + 10, Math.min(H - PAD.b - 10, _pyVal2));
        var _liveCol2 = (_liveC2.c >= _liveC2.o) ? '#26a69a' : '#ef5350';
        chartCtx.save();
        chartCtx.font = 'bold 11px DM Mono';
        var _priceStr2 = formatPrice(_displayPrice2);
        var _bdgW2 = chartCtx.measureText(_priceStr2).width + 16;
        var _bdgX2 = W - 4 - _bdgW2;
        chartCtx.fillStyle = _liveCol2;
        chartCtx.fillRect(_bdgX2, _lastY2 - 10, _bdgW2, 20);
        chartCtx.beginPath();
        chartCtx.moveTo(_bdgX2, _lastY2 - 10);
        chartCtx.lineTo(_bdgX2 - 6, _lastY2);
        chartCtx.lineTo(_bdgX2, _lastY2 + 10);
        chartCtx.fill();
        chartCtx.fillStyle = '#fff'; chartCtx.textAlign = 'center';
        chartCtx.fillText(_priceStr2, _bdgX2 + _bdgW2 / 2, _lastY2 + 4);
        chartCtx.restore();
      }

      /* Time axis — outside clip so labels render in the PAD.b strip */
      renderTimeAxis(visible, px, W, H, PAD);

      /* History loading indicator — outside clip so it always shows at top-left */
      if (typeof _historyLoading !== 'undefined' && _historyLoading) {
        chartCtx.save();
        chartCtx.font = 'bold 10px DM Mono';
        chartCtx.fillStyle = 'rgba(201,168,76,0.7)';
        chartCtx.textAlign = 'left';
        chartCtx.fillText('⟳ loading…', PAD.l + 6, PAD.t + 14);
        chartCtx.restore();
      }
    }

    /* ── Volume Profile Visible Range (VPVR) ── */
    function drawVPVR(ctx, visible, mn, mx, range, W, H, PAD, CW, CH, gapW) {
      if (!visible || visible.length < 2) return;
      var BUCKETS = 60;
      /* Width = the gap between the last candle and the price axis, min 6px to render */
      var BAR_MAX_W = gapW || 0;
      if (BAR_MAX_W < 6) return;
      /* Fixed right edge — always flush against the price axis */
      var rightEdge = W - PAD.r - 2;

      var buckets = new Array(BUCKETS).fill(0);
      var buyBuckets = new Array(BUCKETS).fill(0);

      /* Accumulate volume into price buckets */
      visible.forEach(function (c) {
        var vol = c.v || 0;
        if (!vol) return;
        var lo = Math.max(c.l, mn), hi = Math.min(c.h, mx);
        if (hi <= lo) return;
        var idxLo = Math.max(0, Math.min(BUCKETS - 1, Math.floor((lo - mn) / range * BUCKETS)));
        var idxHi = Math.max(0, Math.min(BUCKETS - 1, Math.floor((hi - mn) / range * BUCKETS)));
        var span = idxHi - idxLo + 1;
        var perBucket = vol / span;
        var isBull = c.c >= c.o;
        for (var b = idxLo; b <= idxHi; b++) {
          buckets[b] += perBucket;
          if (isBull) buyBuckets[b] += perBucket;
        }
      });

      var maxVol = Math.max.apply(null, buckets) || 1;
      var pocIdx = buckets.indexOf(maxVol);
      var bucketH = CH / BUCKETS;

      ctx.save();

      for (var i = 0; i < BUCKETS; i++) {
        if (!buckets[i]) continue;
        var bw = (buckets[i] / maxVol) * BAR_MAX_W;
        var buw = (buyBuckets[i] / maxVol) * BAR_MAX_W;
        /* Y: bucket 0 = bottom price, bucket BUCKETS-1 = top price */
        var y = PAD.t + CH - (i + 1) * bucketH;

        /* Bear portion (red) — anchored to rightEdge, extending leftward */
        ctx.fillStyle = 'rgba(239,83,80,0.28)';
        ctx.fillRect(rightEdge - bw, y, bw, bucketH - 1);

        /* Bull portion (green) layered on top, also leftward */
        ctx.fillStyle = 'rgba(38,166,154,0.38)';
        ctx.fillRect(rightEdge - buw, y, buw, bucketH - 1);

        /* POC bucket */
        if (i === pocIdx) {
          ctx.fillStyle = 'rgba(201,168,76,0.15)';
          ctx.fillRect(rightEdge - BAR_MAX_W, y, BAR_MAX_W, bucketH - 1);
          /* POC dashed line across full chart width */
          ctx.save();
          ctx.strokeStyle = '#c9a84c';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          var midY = y + bucketH / 2;
          ctx.beginPath();
          ctx.moveTo(PAD.l, midY);
          ctx.lineTo(W - PAD.r, midY);
          ctx.stroke();
          ctx.setLineDash([]);
          /* POC label — just left of the VPVR panel */
          ctx.font = 'bold 9px "DM Mono",monospace';
          ctx.fillStyle = '#c9a84c';
          ctx.textAlign = 'right';
          var pocPrice = mn + (i + 0.5) / BUCKETS * range;
          ctx.fillText('POC ' + (pocPrice < 1 ? pocPrice.toFixed(5) : pocPrice < 100 ? pocPrice.toFixed(3) : Math.round(pocPrice)), rightEdge - BAR_MAX_W - 4, midY + 3);
          ctx.restore();
        }
      }

      /* "VPVR" label — small, top of the panel, right-aligned */
      ctx.font = 'bold 8px "DM Mono",monospace';
      ctx.fillStyle = 'rgba(201,168,76,0.55)';
      ctx.textAlign = 'right';
      ctx.fillText('VPVR', rightEdge - 2, PAD.t + 10);

      ctx.restore();
    }

    /* ── Liquidity Heatmap — equal-high / equal-low clusters + round numbers ── */
    function drawLiqHeatmap(ctx, visible, mn, mx, range, W, H, PAD, CW, CH) {
      if (!visible || visible.length < 3) return;

      var ROWS = 25;
      var rowH = CH / ROWS;
      var rowVols = new Array(ROWS).fill(0);

      /* Accumulate volume per price row — use HLC3 as representative price (LuxAlgo method) */
      visible.forEach(function (c) {
        if (!c.v) return;
        var hlc3 = (c.h + c.l + c.c) / 3;
        var row = Math.min(ROWS - 1, Math.max(0, Math.floor((hlc3 - mn) / range * ROWS)));
        rowVols[row] += c.v;
      });

      var maxVol = Math.max.apply(null, rowVols) || 1;
      var pocRow = rowVols.indexOf(maxVol);

      ctx.save();

      /* Draw colored rows — gradient: blue (low) → yellow (mid) → red (high) */
      for (var i = 0; i < ROWS; i++) {
        if (!rowVols[i]) continue;
        var ratio = rowVols[i] / maxVol;
        var y = PAD.t + CH - (i + 1) * rowH;
        var r, g, b;
        if (ratio < 0.5) {
          var t = ratio * 2;                    /* 0 → 1 */
          r = Math.round(t * 242);              /* 0   → 242 */
          g = Math.round(t * 183);              /* 0   → 183 */
          b = Math.round(255 - t * 188);        /* 255 → 67  */
        } else {
          var t = (ratio - 0.5) * 2;            /* 0 → 1 */
          r = 242;
          g = Math.round(183 - t * 128);        /* 183 → 55  */
          b = Math.round(67 - t * 67);         /* 67  → 0   */
        }
        ctx.fillStyle = 'rgba(' + r + ',' + g + ',' + b + ',' + (0.05 + ratio * 0.28).toFixed(2) + ')';
        ctx.fillRect(PAD.l, y, CW, rowH - 0.3);
      }

      /* Highlight highest-volume row (max liquidity level) */
      var pocY = PAD.t + CH - (pocRow + 1) * rowH + rowH / 2;
      ctx.strokeStyle = 'rgba(255,215,0,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 4]);
      ctx.beginPath(); ctx.moveTo(PAD.l, pocY); ctx.lineTo(W - PAD.r, pocY); ctx.stroke();
      ctx.setLineDash([]);

      /* "LIQMAP" label */
      ctx.font = 'bold 8px "DM Mono",monospace';
      ctx.fillStyle = 'rgba(201,168,76,0.55)';
      ctx.textAlign = 'left';
      ctx.fillText('LIQMAP', PAD.l + 4, PAD.t + 10);

      ctx.restore();
    }

    /* ── Volume Bubbles — daily groups, split buy/sell ellipses (LuxAlgo-style) ── */
    function drawVolumeBubbles(ctx, visible, mn, mx, range, W, H, PAD, CW, CH, barW) {
      if (!visible || visible.length < 2 || !barW) return;

      var MS_DAY = 86400000;
      var groups = [], cur = null, curDay = -1;

      /* Group candles by calendar day and compute buy/sell split */
      visible.forEach(function (c, i) {
        var day = Math.floor((c.t || 0) / MS_DAY);
        if (day !== curDay) {
          cur = { buyVol: 0, sellVol: 0, startIdx: i, count: 0, hi: c.h, lo: c.l };
          groups.push(cur);
          curDay = day;
        }
        cur.count++;
        if (c.h > cur.hi) cur.hi = c.h;
        if (c.l < cur.lo) cur.lo = c.l;

        /* LuxAlgo buy/sell volume estimation via bar structure */
        var bTop = c.h - Math.max(c.o, c.c);
        var bBot = Math.min(c.o, c.c) - c.l;
        var bRng = c.h - c.l;
        var bull = c.c >= c.o;
        var buyR = bull ? bRng : bTop + bBot;
        var selR = bull ? bTop + bBot : bRng;
        var tot = bRng + bTop + bBot;
        if (tot > 0 && c.v) {
          cur.buyVol += (buyR / tot) * c.v;
          cur.sellVol += (selR / tot) * c.v;
        }
      });

      var maxVol = 0;
      groups.forEach(function (g) { maxVol = Math.max(maxVol, g.buyVol + g.sellVol); });
      if (!maxVol) return;

      ctx.save();

      groups.forEach(function (g) {
        if (!g.count) return;
        /* Center of the bubble in canvas coords */
        var midIdx = g.startIdx + (g.count - 1) / 2;
        var cx = PAD.l + (midIdx + 0.5) * barW;
        var midP = (g.hi + g.lo) / 2;
        var cy = PAD.t + CH - ((midP - mn) / range) * CH;
        var vol = g.buyVol + g.sellVol;
        var ratio = Math.sqrt(vol / maxVol);    /* sqrt = gentler size scaling */
        var rx = Math.max(4, g.count * 0.5 * barW * ratio);
        var priceH = ((g.hi - g.lo) / range) * CH;
        var ry = Math.max(4, priceH * 0.45 * ratio);

        /* Closed ellipse with proportional horizontal fill:
           splitY = dividing line that moves up/down based on buy ratio.
           Top portion (above splitY) = teal buy, bottom = red sell.
           buyRatio=0.5 → line at center; buyRatio=0.7 → line 40% below center (teal gets more). */
        var buyRatio = vol > 0 ? g.buyVol / vol : 0.5;
        var splitY = cy + ry * (2 * buyRatio - 1);   /* cy-ry=all-teal … cy+ry=all-red */

        /* 1. Full ellipse filled red (sell = bottom color) */
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(239,83,80,0.32)';
        ctx.fill();

        /* 2. Clip to rect above splitY, overdraw teal (buy = top color) */
        ctx.save();
        ctx.beginPath();
        ctx.rect(cx - rx - 1, cy - ry - 1, (rx + 1) * 2, splitY - (cy - ry) + 1);
        ctx.clip();
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        ctx.fillStyle = 'rgba(38,166,154,0.40)';
        ctx.fill();
        ctx.restore();

        /* 3. Ellipse outline */
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
        ctx.strokeStyle = 'rgba(180,180,180,0.35)';
        ctx.lineWidth = 0.8;
        ctx.stroke();

        /* 4. Percentage dividing chord */
        var dy = (splitY - cy) / ry;                            /* normalized −1..+1 */
        var chordHW = rx * Math.sqrt(Math.max(0, 1 - dy * dy));     /* half-width at splitY */
        ctx.strokeStyle = 'rgba(201,168,76,0.75)';
        ctx.lineWidth = 0.7;
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        ctx.moveTo(cx - chordHW, splitY);
        ctx.lineTo(cx + chordHW, splitY);
        ctx.stroke();
        ctx.setLineDash([]);

        /* 5. Volume labels — buy above chord, sell below chord */
        if (ry > 12) {
          ctx.font = '7px "DM Mono",monospace';
          ctx.textAlign = 'center';
          var buyLabelY = Math.max(cy - ry + 9, (cy - ry + splitY) / 2 + 3);
          var selLabelY = Math.min(cy + ry - 2, (splitY + cy + ry) / 2 + 3);
          ctx.fillStyle = 'rgba(38,166,154,0.90)';
          ctx.fillText(formatVol(g.buyVol), cx, buyLabelY);
          ctx.fillStyle = 'rgba(239,83,80,0.90)';
          ctx.fillText(formatVol(g.sellVol), cx, selLabelY);
        }

        /* Dashed day-boundary separator at last candle of group */
        if (g.count > 1) {
          var sepX = PAD.l + (g.startIdx + g.count) * barW;
          var topY = PAD.t + CH - ((g.hi - mn) / range) * CH;
          var botY = PAD.t + CH - ((g.lo - mn) / range) * CH;
          ctx.strokeStyle = 'rgba(160,160,160,0.22)';
          ctx.lineWidth = 0.5;
          ctx.setLineDash([2, 5]);
          ctx.beginPath(); ctx.moveTo(sepX, topY); ctx.lineTo(sepX, botY); ctx.stroke();
          ctx.setLineDash([]);
        }
      });

      ctx.restore();
    }

    /* ════════════════════════════════════════════════════
       QUANTITATIVE ANALYSIS — HURST · GARCH · SIGNAL
       ════════════════════════════════════════════════════ */

    /* R/S Hurst Exponent on an array of close prices */
    function _computeHurst(prices) {
      var n = prices.length;
      if (n < 10) return 0.5;
      var logR = [];
      for (var i = 1; i < n; i++) {
        if (prices[i - 1] > 0 && prices[i] > 0)
          logR.push(Math.log(prices[i] / prices[i - 1]));
      }
      var m = logR.length;
      if (m < 5) return 0.5;
      var mean = logR.reduce(function (s, v) { return s + v; }, 0) / m;
      var acc = 0, cumDev = [];
      for (var i = 0; i < m; i++) { acc += logR[i] - mean; cumDev.push(acc); }
      var R = Math.max.apply(null, cumDev) - Math.min.apply(null, cumDev);
      var S = Math.sqrt(logR.reduce(function (s, v) { return s + (v - mean) * (v - mean); }, 0) / m);
      if (!R || !S) return 0.5;
      return Math.max(0.1, Math.min(0.9, Math.log(R / S) / Math.log(m)));
    }

    /* GARCH(1,1) — returns per-candle σ array (one value per visible candle) */
    function _computeGARCH(visible) {
      if (visible.length < 5) return [];
      var omega = 2e-6, alpha = 0.1, beta = 0.85;
      var logR = [0];
      for (var i = 1; i < visible.length; i++)
        logR.push(visible[i - 1].c > 0 && visible[i].c > 0 ? Math.log(visible[i].c / visible[i - 1].c) : 0);
      var init = logR.slice(1, Math.min(21, logR.length));
      var mu = init.reduce(function (s, v) { return s + v; }, 0) / (init.length || 1);
      var iv = init.reduce(function (s, v) { return s + (v - mu) * (v - mu); }, 0) / (init.length || 1);
      var sig = [Math.sqrt(Math.max(iv, 1e-10))];
      for (var i = 1; i < visible.length; i++) {
        var e = logR[i] - mu;
        var s2 = omega + alpha * e * e + beta * sig[sig.length - 1] * sig[sig.length - 1];
        sig.push(Math.sqrt(s2));
      }
      return sig;
    }

    /* ── Hurst Exponent overlay — tint + regime badge ── */
    function drawHurst(ctx, visible, mn, mx, range, W, H, PAD, CW, CH) {
      if (!visible || visible.length < 10) return;
      var hv = _computeHurst(visible.map(function (c) { return c.c; }));
      var rv, gv, bv;
      if (hv > 0.55) { rv = 38; gv = 166; bv = 154; } /* teal  — trending      */
      else if (hv < 0.45) { rv = 63; gv = 84; bv = 186; } /* blue  — mean-reverting */
      else { rv = 201; gv = 168; bv = 76; } /* gold  — random noise  */

      ctx.save();
      ctx.fillStyle = 'rgba(' + rv + ',' + gv + ',' + bv + ',0.04)';
      ctx.fillRect(PAD.l, PAD.t, CW, CH);

      var label = hv > 0.55 ? 'TREND' : hv < 0.45 ? 'REVERT' : 'NOISE';
      ctx.font = 'bold 9px "DM Mono",monospace';
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgba(' + rv + ',' + gv + ',' + bv + ',0.80)';
      ctx.fillText('H=' + hv.toFixed(2) + '  ' + label, W - PAD.r - 4, PAD.t + 24);
      ctx.restore();
    }

    /* ── GARCH Volatility Bands — ±2σ dynamic channel ── */
    function drawGARCH(ctx, visible, mn, mx, range, W, H, PAD, CW, CH, barW) {
      if (!visible || visible.length < 5 || !barW) return;
      var sig = _computeGARCH(visible);
      var upper = [], lower = [];

      for (var i = 0; i < visible.length; i++) {
        var bw = visible[i].c * sig[i] * 2;
        var uP = visible[i].c + bw, lP = visible[i].c - bw;
        if (uP > mx * 1.15 || lP < mn * 0.85) continue;
        var x = PAD.l + (i + 0.5) * barW;
        upper.push([x, PAD.t + CH - ((uP - mn) / range) * CH]);
        lower.push([x, PAD.t + CH - ((lP - mn) / range) * CH]);
      }
      if (upper.length < 2) return;

      ctx.save();

      /* fill between bands */
      ctx.beginPath();
      ctx.moveTo(upper[0][0], upper[0][1]);
      for (var i = 1; i < upper.length; i++) ctx.lineTo(upper[i][0], upper[i][1]);
      for (var i = lower.length - 1; i >= 0; i--) ctx.lineTo(lower[i][0], lower[i][1]);
      ctx.closePath();
      ctx.fillStyle = 'rgba(201,168,76,0.05)';
      ctx.fill();

      ctx.setLineDash([3, 5]);
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(201,168,76,0.50)';

      ctx.beginPath(); ctx.moveTo(upper[0][0], upper[0][1]);
      for (var i = 1; i < upper.length; i++) ctx.lineTo(upper[i][0], upper[i][1]);
      ctx.stroke();

      ctx.beginPath(); ctx.moveTo(lower[0][0], lower[0][1]);
      for (var i = 1; i < lower.length; i++) ctx.lineTo(lower[i][0], lower[i][1]);
      ctx.stroke();

      ctx.setLineDash([]);
      ctx.font = 'bold 8px "DM Mono",monospace';
      ctx.fillStyle = 'rgba(201,168,76,0.60)';
      ctx.textAlign = 'left';
      ctx.fillText('GARCH ±2σ', PAD.l + 4, PAD.t + 24);
      ctx.restore();
    }

    /* ── Fractal Signal — composite gauge: Trend(H) × Volatility(GARCH) ── */
    function drawFractalSignal(ctx, visible, mn, mx, range, W, H, PAD, CW, CH) {
      if (!visible || visible.length < 10) return;
      var hv = _computeHurst(visible.map(function (c) { return c.c; }));
      var sig = _computeGARCH(visible);
      var volNorm = sig[sig.length - 1] / (Math.max.apply(null, sig) || 1);
      var dir = visible[visible.length - 1].c >= visible[0].c ? 1 : -1;
      var trend = Math.max(0, (hv - 0.5) * 2);                  /* 0..1, only for H>0.5 */
      var signal = Math.max(-1, Math.min(1, dir * trend * (1 - volNorm * 0.5)));

      var gY = PAD.t + 3, gH = 5, gX = PAD.l, mid = gX + CW / 2;

      ctx.save();

      /* gauge track */
      ctx.fillStyle = 'rgba(255,255,255,0.06)';
      ctx.fillRect(gX, gY, CW, gH);

      /* signal fill */
      var fw = Math.abs(signal) * CW / 2;
      var fx = signal >= 0 ? mid : mid - fw;
      var col = signal >= 0 ? 'rgba(38,166,154,0.82)' : 'rgba(239,83,80,0.82)';
      ctx.fillStyle = col;
      ctx.fillRect(fx, gY, fw, gH);

      /* center tick */
      ctx.strokeStyle = 'rgba(255,255,255,0.20)';
      ctx.lineWidth = 0.5;
      ctx.beginPath(); ctx.moveTo(mid, gY); ctx.lineTo(mid, gY + gH); ctx.stroke();

      /* score label */
      var score = Math.round(Math.abs(signal) * 100);
      var regime = hv > 0.55 ? 'TREND' : hv < 0.45 ? 'REVERT' : 'NOISE';
      var arrow = signal >= 0 ? '▲' : '▼';
      ctx.font = 'bold 8px "DM Mono",monospace';
      ctx.textAlign = 'center';
      ctx.fillStyle = signal >= 0 ? 'rgba(38,166,154,1)' : 'rgba(239,83,80,1)';
      ctx.fillText(arrow + ' ' + score + '%  ' + regime, W / 2, gY + gH + 9);

      ctx.restore();
    }

    /* ── Kalman Filter — adaptive noise-filtered trend line + channel ── */
    function drawKalman(ctx, visible, mn, mx, range, W, H, PAD, CW, CH, barW) {
      if (!visible || visible.length < 10 || !barW) return;
      var closes = visible.map(function (c) { return c.c; });
      var n = closes.length;
      /* Auto-tune Q and R from price variance */
      var mean0 = 0; for (var i = 0; i < n; i++) mean0 += closes[i]; mean0 /= n;
      var varC = 0; for (var i = 0; i < n; i++) varC += (closes[i] - mean0) * (closes[i] - mean0); varC /= n;
      var Q = varC * 0.001, R = varC * 0.1;
      /* Pass 1: run Kalman filter, collect estimates */
      var xEst = closes[0], P = varC;
      var ests = new Array(n), gains = new Array(n);
      for (var i = 0; i < n; i++) {
        var Pp = P + Q, K = Pp / (Pp + R);
        xEst = xEst + K * (closes[i] - xEst); P = (1 - K) * Pp;
        ests[i] = xEst; gains[i] = K;
      }
      /* Pass 2: rolling std of residuals (window=20) for channel width */
      var WIN = Math.max(5, Math.min(20, Math.floor(n / 4)));
      var bandStd = new Array(n).fill(0);
      for (var i = WIN - 1; i < n; i++) {
        var sm = 0; for (var j = i - WIN + 1; j <= i; j++) sm += (closes[j] - ests[j]); sm /= WIN;
        var sv = 0; for (var j = i - WIN + 1; j <= i; j++) { var d = closes[j] - ests[j] - sm; sv += d * d; } sv /= WIN;
        bandStd[i] = Math.sqrt(sv);
      }
      /* Build canvas coords */
      function py(p) { return PAD.t + CH - ((p - mn) / range) * CH; }
      var chartTop = PAD.t, chartBot = PAD.t + CH;
      var upper2 = [], lower2 = [], upper1 = [], lower1 = [], mainLine = [];
      for (var i = 0; i < n; i++) {
        var x = PAD.l + (i + 0.5) * barW, s = bandStd[i];
        mainLine.push([x, py(ests[i])]);
        upper1.push([x, py(ests[i] + s)]);
        lower1.push([x, py(ests[i] - s)]);
        upper2.push([x, py(ests[i] + 2 * s)]);
        lower2.push([x, py(ests[i] - 2 * s)]);
      }
      ctx.save();
      /* Subtle background tint */
      var lastClose = closes[n - 1], lastEst = ests[n - 1];
      ctx.fillStyle = lastClose > lastEst ? 'rgba(38,166,154,0.025)' : 'rgba(239,83,80,0.025)';
      ctx.fillRect(PAD.l, PAD.t, CW, CH);
      /* Fill ±1σ band */
      ctx.beginPath();
      ctx.moveTo(upper1[0][0], upper1[0][1]);
      for (var i = 1; i < n; i++) ctx.lineTo(upper1[i][0], upper1[i][1]);
      for (var i = n - 1; i >= 0; i--) ctx.lineTo(lower1[i][0], lower1[i][1]);
      ctx.closePath(); ctx.fillStyle = 'rgba(38,166,154,0.06)'; ctx.fill();
      /* ±2σ lines */
      ctx.strokeStyle = 'rgba(38,166,154,0.25)'; ctx.lineWidth = 0.8; ctx.setLineDash([2, 3]);
      ctx.beginPath(); for (var i = 0; i < n; i++) i === 0 ? ctx.moveTo(upper2[i][0], upper2[i][1]) : ctx.lineTo(upper2[i][0], upper2[i][1]); ctx.stroke();
      ctx.beginPath(); for (var i = 0; i < n; i++) i === 0 ? ctx.moveTo(lower2[i][0], lower2[i][1]) : ctx.lineTo(lower2[i][0], lower2[i][1]); ctx.stroke();
      /* ±1σ lines */
      ctx.strokeStyle = 'rgba(38,166,154,0.45)'; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
      ctx.beginPath(); for (var i = 0; i < n; i++) i === 0 ? ctx.moveTo(upper1[i][0], upper1[i][1]) : ctx.lineTo(upper1[i][0], upper1[i][1]); ctx.stroke();
      ctx.beginPath(); for (var i = 0; i < n; i++) i === 0 ? ctx.moveTo(lower1[i][0], lower1[i][1]) : ctx.lineTo(lower1[i][0], lower1[i][1]); ctx.stroke();
      ctx.setLineDash([]);
      /* Main Kalman line — colour-coded by direction */
      for (var i = 1; i < n; i++) {
        var rising = ests[i] >= ests[i - 1];
        ctx.strokeStyle = rising ? 'rgba(38,166,154,0.95)' : 'rgba(239,83,80,0.85)';
        ctx.lineWidth = 1.5; ctx.setLineDash([]);
        ctx.beginPath(); ctx.moveTo(mainLine[i - 1][0], mainLine[i - 1][1]); ctx.lineTo(mainLine[i][0], mainLine[i][1]); ctx.stroke();
      }
      /* Velocity dot at last bar */
      var vel = ests[n - 1] - ests[Math.max(0, n - 2)];
      var dotCol = vel >= 0 ? '#26a69a' : '#ef5350';
      ctx.fillStyle = dotCol;
      ctx.beginPath(); ctx.arc(mainLine[n - 1][0], mainLine[n - 1][1], 3, 0, Math.PI * 2); ctx.fill();
      /* Labels */
      var trendArrow = lastClose > lastEst ? '\u25b2' : '\u25bc';
      var trendCol = lastClose > lastEst ? 'rgba(38,166,154,0.9)' : 'rgba(239,83,80,0.9)';
      ctx.font = 'bold 9px "DM Mono",monospace'; ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(38,166,154,0.85)';
      ctx.fillText('KALMAN  K=' + gains[n - 1].toFixed(3), PAD.l + 4, PAD.t + 50);
      ctx.fillStyle = trendCol;
      ctx.fillText(trendArrow + ' ' + formatPrice(lastEst), PAD.l + 4, PAD.t + 62);
      ctx.restore();
    }

    /* ── Geometric Brownian Motion — forward projection fan ── */
    function drawGBM(ctx, visible, mn, mx, range, W, H, PAD, CW, CH, barW) {
      if (!visible || visible.length < 20 || !barW) return;
      /* Estimate drift (μ) and volatility (σ) from log returns */
      var logR = [];
      for (var i = 1; i < visible.length; i++) logR.push(Math.log(visible[i].c / visible[i - 1].c));
      var n = logR.length;
      var muR = logR.reduce(function (a, b) { return a + b; }, 0) / n;
      var varR = logR.reduce(function (s, r) { return s + (r - muR) * (r - muR); }, 0) / (n - 1);
      var sigma = Math.sqrt(varR);
      var drift = muR - 0.5 * varR; /* GBM log-drift */
      var S0 = visible[visible.length - 1].c;
      var STEPS = Math.min(50, Math.round(visible.length * 0.25));
      var lastX = PAD.l + (visible.length - 0.5) * barW;
      function py(p) { return PAD.t + CH - ((p - mn) / range) * CH; }
      ctx.save();
      /* Fill between ±1σ bands */
      var u1 = [], l1 = [];
      for (var t = 1; t <= STEPS; t++) {
        var x = lastX + t * barW; if (x > W - PAD.r) break;
        u1.push([x, S0 * Math.exp(drift * t + sigma * Math.sqrt(t))]);
        l1.push([x, S0 * Math.exp(drift * t - sigma * Math.sqrt(t))]);
      }
      if (u1.length > 1) {
        ctx.beginPath();
        ctx.moveTo(lastX, py(S0));
        for (var i = 0; i < u1.length; i++) ctx.lineTo(u1[i][0], py(u1[i][1]));
        for (var i = l1.length - 1; i >= 0; i--) ctx.lineTo(l1[i][0], py(l1[i][1]));
        ctx.closePath(); ctx.fillStyle = 'rgba(201,168,76,0.06)'; ctx.fill();
      }
      /* Quantile paths: Z = -2, -1, 0, +1, +2 */
      var qs = [
        { z: -2, col: 'rgba(231,76,60,0.45)', lbl: '-2\u03c3', w: 1, dash: [3, 3] },
        { z: -1, col: 'rgba(231,76,60,0.70)', lbl: '-1\u03c3', w: 1, dash: [3, 3] },
        { z: 0, col: 'rgba(201,168,76,0.95)', lbl: 'E[S]', w: 1.5, dash: [] },
        { z: 1, col: 'rgba(39,174,96,0.70)', lbl: '+1\u03c3', w: 1, dash: [3, 3] },
        { z: 2, col: 'rgba(39,174,96,0.45)', lbl: '+2\u03c3', w: 1, dash: [3, 3] },
      ];
      qs.forEach(function (q) {
        ctx.strokeStyle = q.col; ctx.lineWidth = q.w; ctx.setLineDash(q.dash); ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(lastX, py(S0));
        var endX = lastX, endP = S0;
        for (var t = 1; t <= STEPS; t++) {
          var x = lastX + t * barW; if (x > W - PAD.r) break;
          var price = S0 * Math.exp(drift * t + sigma * Math.sqrt(t) * q.z);
          var y = py(price);
          ctx.lineTo(x, y); endX = x; endP = price;
        }
        ctx.stroke(); ctx.setLineDash([]);
        var ey = py(endP);
        if (ey >= PAD.t && ey <= PAD.t + CH) {
          ctx.font = 'bold 8px DM Mono'; ctx.fillStyle = q.col;
          ctx.textAlign = 'left'; ctx.fillText(q.lbl, endX + 3, ey + 3);
        }
      });
      /* Label */
      ctx.font = 'bold 9px "DM Mono",monospace'; ctx.fillStyle = 'rgba(201,168,76,0.85)';
      ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      ctx.fillText('GBM  \u03c3=' + (sigma * 100).toFixed(2) + '%/bar', PAD.l + 4, PAD.t + 50);
      ctx.restore();
    }

    /* ── Ornstein-Uhlenbeck Process — mean reversion model ── */
    function drawOU(ctx, visible, mn, mx, range, W, H, PAD, CW, CH, barW) {
      if (!visible || visible.length < 20 || !barW) return;
      var closes = visible.map(function (c) { return c.c; });
      var n = closes.length;
      /* AR(1) fit: X(t+1) = a + b*X(t) + ε  →  θ = 1-b,  μ = a/(1-b) */
      var mx0 = 0, my0 = 0;
      for (var i = 0; i < n - 1; i++) { mx0 += closes[i]; my0 += closes[i + 1]; }
      mx0 /= (n - 1); my0 /= (n - 1);
      var cov = 0, vx = 0;
      for (var i = 0; i < n - 1; i++) { cov += (closes[i] - mx0) * (closes[i + 1] - my0); vx += (closes[i] - mx0) * (closes[i] - mx0); }
      var b = Math.max(0.001, Math.min(0.9999, cov / (vx + 1e-12)));
      var a = my0 - b * mx0;
      var ouMu = a / (1 - b);                /* long-run mean */
      var theta = 1 - b;                   /* mean-reversion speed per bar */
      /* Residual std (diffusion per bar) */
      var rss = 0;
      for (var i = 0; i < n - 1; i++) { var res = closes[i + 1] - (a + b * closes[i]); rss += res * res; }
      var sigBar = Math.sqrt(rss / Math.max(1, n - 3));
      /* Stationary std dev: σ_stat = σ / √(2θ) */
      var sigStat = sigBar / Math.sqrt(2 * theta + 1e-9);
      var halfLife = Math.log(2) / (theta + 1e-9);
      var S0 = closes[n - 1];
      var STEPS = Math.min(60, Math.round(halfLife * 3) || 30);
      var lastX = PAD.l + (n - 0.5) * barW;
      function py(p) { return PAD.t + CH - ((p - mn) / range) * CH; }
      var chartTop = PAD.t, chartBot = PAD.t + CH;
      ctx.save();
      /* ±2σ fill */
      var p2u = ouMu + 2 * sigStat, p2l = ouMu - 2 * sigStat;
      var y2u = py(p2u), y2l = py(p2l);
      if (y2u < chartBot && y2l > chartTop) {
        ctx.fillStyle = 'rgba(52,152,219,0.04)';
        ctx.fillRect(PAD.l, Math.max(chartTop, y2u), CW, Math.min(chartBot, y2l) - Math.max(chartTop, y2u));
      }
      /* Band lines ±1σ, ±2σ */
      [-2, -1, 1, 2].forEach(function (m) {
        var by = py(ouMu + m * sigStat); if (by < chartTop || by > chartBot) return;
        ctx.strokeStyle = Math.abs(m) === 2 ? 'rgba(52,152,219,0.30)' : 'rgba(52,152,219,0.55)';
        ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.moveTo(PAD.l, by); ctx.lineTo(W - PAD.r, by); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = 'bold 8px DM Mono'; ctx.fillStyle = 'rgba(52,152,219,0.65)';
        ctx.textAlign = 'right'; ctx.fillText((m > 0 ? '+' : '') + m + '\u03c3', W - PAD.r - 2, by - 3);
      });
      /* Long-run mean line */
      var meanY = py(ouMu);
      if (meanY >= chartTop && meanY <= chartBot) {
        ctx.strokeStyle = 'rgba(52,152,219,0.65)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
        ctx.beginPath(); ctx.moveTo(PAD.l, meanY); ctx.lineTo(W - PAD.r, meanY); ctx.stroke(); ctx.setLineDash([]);
        ctx.font = 'bold 8px DM Mono'; ctx.fillStyle = 'rgba(52,152,219,0.8)';
        ctx.textAlign = 'right'; ctx.fillText('\u03bc ' + formatPrice(ouMu), W - PAD.r - 2, meanY - 3);
      }
      /* Expected reversion path: E[X(t)] = μ + (S0-μ)·e^(-θt) */
      ctx.strokeStyle = 'rgba(52,152,219,0.90)'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
      ctx.beginPath(); ctx.moveTo(lastX, py(S0));
      for (var t = 1; t <= STEPS; t++) {
        var x = lastX + t * barW; if (x > W - PAD.r) break;
        var ep = ouMu + (S0 - ouMu) * Math.exp(-theta * t);
        var y = py(ep); if (y < chartTop - 5 || y > chartBot + 5) break;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
      /* Deviation badge */
      var devSig = (S0 - ouMu) / (sigStat + 1e-10);
      var devCol = devSig > 0 ? 'rgba(231,76,60,0.9)' : 'rgba(39,174,96,0.9)';
      ctx.font = 'bold 9px "DM Mono",monospace'; ctx.textAlign = 'left'; ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(52,152,219,0.85)';
      ctx.fillText('O-U  \u03b8=' + theta.toFixed(3) + '  t\u00bd=' + halfLife.toFixed(1) + 'bars', PAD.l + 4, PAD.t + 50);
      ctx.fillStyle = devCol;
      ctx.fillText('dev=' + (devSig >= 0 ? '+' : '') + devSig.toFixed(2) + '\u03c3', PAD.l + 4, PAD.t + 62);
      ctx.restore();
    }

    /* ── Fractal Momentum: compute + draw ── */
    function _fmEMA(src, len) {
      var k = 2 / (len + 1), out = new Array(src.length).fill(NaN);
      for (var i = 0; i < src.length; i++) {
        if (isNaN(src[i])) continue;
        out[i] = (i === 0 || isNaN(out[i - 1])) ? src[i] : src[i] * k + out[i - 1] * (1 - k);
      }
      return out;
    }
    function _fmRMA(src, len) {
      var k = 1 / len, out = new Array(src.length).fill(NaN);
      for (var i = 0; i < src.length; i++) {
        if (isNaN(src[i])) continue;
        out[i] = (i === 0 || isNaN(out[i - 1])) ? src[i] : src[i] * k + out[i - 1] * (1 - k);
      }
      return out;
    }
    function _fmATR(candles, len) {
      var tr = candles.map(function (c, i) {
        if (i === 0) return c.h - c.l;
        var pc = candles[i - 1].c;
        return Math.max(c.h - c.l, Math.abs(c.h - pc), Math.abs(c.l - pc));
      });
      return _fmRMA(tr, len);
    }
    function _computeFM(candles) {
      var n = candles.length;
      if (n < 30) return null;
      var close = candles.map(function (c) { return c.c; });
      var high  = candles.map(function (c) { return c.h; });
      var low   = candles.map(function (c) { return c.l; });

      /* MACD: EMA(100) - EMA(26), signal EMA(50) */
      var ema100 = _fmEMA(close, 100);
      var ema26  = _fmEMA(close, 26);
      var macd   = ema100.map(function (v, i) { return isNaN(v) || isNaN(ema26[i]) ? NaN : v - ema26[i]; });
      var sigLine = _fmEMA(macd, 50);

      /* omed: Keltner channel position (scl=5, mcl=15) */
      var ma5  = _fmRMA(close, 5),  atr5  = _fmATR(candles, 5);
      var ma15 = _fmRMA(close, 15), atr15 = _fmATR(candles, 15);
      var omed = new Array(n).fill(NaN);
      for (var i = 9; i < n; i++) {
        if (isNaN(ma5[i - 2]) || isNaN(ma15[i - 7])) continue;
        var sct = ma5[i - 2] + atr5[i], scb = ma5[i - 2] - atr5[i];
        var mct = ma15[i - 7] + 3 * atr15[i], mcb = ma15[i - 7] - 3 * atr15[i];
        var d = mct - mcb;
        if (d > 0) omed[i] = ((sct + scb) / 2 - mcb) / d;
      }

      /* SMI: 10-bar, 3-period double-smooth, then EMA(10) */
      var rdiff = new Array(n).fill(NaN), diff = new Array(n).fill(NaN);
      for (var i = 9; i < n; i++) {
        var ll = Infinity, hh = -Infinity;
        for (var j = i - 9; j <= i; j++) { if (low[j] < ll) ll = low[j]; if (high[j] > hh) hh = high[j]; }
        diff[i]  = hh - ll;
        rdiff[i] = close[i] - (hh + ll) / 2;
      }
      var avgrel  = _fmEMA(_fmEMA(rdiff, 3), 3);
      var avgdiff = _fmEMA(_fmEMA(diff, 3), 3);
      var smi = avgrel.map(function (v, i) {
        var ad = avgdiff[i];
        return (isNaN(v) || isNaN(ad) || ad === 0) ? NaN : (v / (ad / 2)) * 100;
      });
      var emasig = _fmEMA(smi, 10);

      /* MACD crossovers */
      var crosses = [];
      for (var i = 1; i < n; i++) {
        if (isNaN(macd[i]) || isNaN(sigLine[i]) || isNaN(macd[i - 1]) || isNaN(sigLine[i - 1])) continue;
        var prev = macd[i - 1] > sigLine[i - 1], curr = macd[i] > sigLine[i];
        if (!prev && curr) crosses.push({ i: i, dir: 'up' });
        else if (prev && !curr) crosses.push({ i: i, dir: 'dn' });
      }
      return { omed: omed, emasig: emasig, crosses: crosses };
    }
    function drawFractalMomentum(ctx, candles, startIdx, endIdx, PAD, W, H, CH, pxFn, pyFn) {
      var fm = _computeFM(candles);
      if (!fm) return;
      var n = candles.length;

      /* Crossover triangle markers on the price chart */
      ctx.save();
      for (var k = 0; k < fm.crosses.length; k++) {
        var co = fm.crosses[k];
        var gi = co.i;
        if (gi < startIdx || gi >= endIdx) continue;
        var xp = pxFn(gi - startIdx), c = candles[gi];
        if (co.dir === 'up') {
          var yp = pyFn(c.l) + 14;
          ctx.beginPath(); ctx.moveTo(xp, yp - 9); ctx.lineTo(xp + 5, yp); ctx.lineTo(xp - 5, yp); ctx.closePath();
          ctx.fillStyle = 'rgba(38,166,154,0.88)'; ctx.fill();
        } else {
          var yp = pyFn(c.h) - 14;
          ctx.beginPath(); ctx.moveTo(xp, yp + 9); ctx.lineTo(xp + 5, yp); ctx.lineTo(xp - 5, yp); ctx.closePath();
          ctx.fillStyle = 'rgba(239,83,80,0.88)'; ctx.fill();
        }
      }
      ctx.restore();

      /* Signal badge — get latest non-NaN values */
      var badge = document.getElementById('fmBadge');
      if (!badge) return;
      var omedVal = NaN, smiVal = NaN;
      for (var i = n - 1; i >= 0; i--) { if (!isNaN(fm.omed[i]))  { omedVal = fm.omed[i];  break; } }
      for (var i = n - 1; i >= 0; i--) { if (!isNaN(fm.emasig[i])) { smiVal  = fm.emasig[i]; break; } }
      var oCol  = omedVal >= 0.8 ? '#e74c3c' : omedVal <= 0.2 ? '#27ae60' : '#4e9af1';
      var oTxt  = omedVal >= 0.8 ? ' SELL' : omedVal <= 0.2 ? ' BUY' : '';
      var sCol  = smiVal  >= 60  ? '#e74c3c' : smiVal  <= -60  ? '#27ae60' : '#4e9af1';
      var sTxt  = smiVal  >= 60  ? ' SELL' : smiVal  <= -60  ? ' BUY' : '';
      badge.innerHTML =
        '<div style="font-size:8px;letter-spacing:.08em;color:#4e5d78;margin-bottom:5px">FRACTAL MOMENTUM</div>' +
        '<div style="display:flex;justify-content:space-between;gap:12px;margin-bottom:2px">' +
          '<span style="color:#4e5d78">CHANNEL</span>' +
          '<span style="color:' + oCol + ';font-weight:700">' + (isNaN(omedVal) ? '—' : omedVal.toFixed(3)) + oTxt + '</span>' +
        '</div>' +
        '<div style="display:flex;justify-content:space-between;gap:12px">' +
          '<span style="color:#4e5d78">SMI</span>' +
          '<span style="color:' + sCol + ';font-weight:700">' + (isNaN(smiVal) ? '—' : smiVal.toFixed(1)) + sTxt + '</span>' +
        '</div>';
      badge.style.display = 'block';
    }

    if (chartCanvas) {
      /* OHLC tooltip — fixed top-left of canvas, TradingView style */
      var _ohlcTip = document.createElement('div');
      _ohlcTip.id = 'ohlcTip';
      _ohlcTip.style.cssText =
        'position:absolute;top:6px;left:52px;pointer-events:none;display:none;' +
        'background:rgba(7,9,14,.0);border:none;' +
        'padding:0;font-family:"DM Mono",monospace;font-size:10px;' +
        'line-height:1.9;z-index:50;white-space:nowrap';
      chartCanvas.parentElement.appendChild(_ohlcTip);

      /* Fractal Momentum signal badge — bottom-right corner of chart */
      var _fmBadge = document.createElement('div');
      _fmBadge.id = 'fmBadge';
      _fmBadge.style.cssText =
        'position:absolute;bottom:64px;right:82px;pointer-events:none;display:none;' +
        'background:rgba(6,8,13,.88);border:1px solid rgba(201,168,76,.2);border-radius:3px;' +
        'padding:7px 11px;font-family:"DM Mono",monospace;font-size:10px;' +
        'line-height:1.8;z-index:50;white-space:nowrap;min-width:148px';
      chartCanvas.parentElement.appendChild(_fmBadge);

      chartCanvas.addEventListener('mousemove', function (e) {
        if (typeof isBrushing !== 'undefined' && isBrushing) return;
        var r = chartCanvas.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        var cssX = e.clientX - r.left, cssY = e.clientY - r.top;
        /* Skip all drawing when photo is uploaded */
        if (typeof _uploadedMode !== 'undefined' && _uploadedMode) return;
        renderChart();
        var W = chartCanvas.width / dpr, H = chartCanvas.height / dpr;
        var PAD2 = { t: 16, b: 56, l: 8, r: 75, vol: 40 };
        var vis = Math.max(20, Math.floor((chartCandles.length || 0) / chartView.zoom));
        var si2 = Math.max(0, (chartCandles.length || 0) - vis - chartView.offset);
        var visible2 = chartCandles.slice(si2, Math.min(chartCandles.length, si2 + vis));
        if (!visible2.length) return;
        var CW2 = W - PAD2.l - PAD2.r, CH2 = H - PAD2.t - PAD2.b - PAD2.vol;
        var mn2 = Math.min.apply(null, visible2.map(function (c) { return c.l; }));
        var mx2 = Math.max.apply(null, visible2.map(function (c) { return c.h; }));
        var rng2 = mx2 - mn2 || mn2 * .001 || .0001;
        mn2 -= rng2 * .05; mx2 += rng2 * .05; rng2 = mx2 - mn2;
        /* Match renderChart rightGapBars so hover snaps to the same bar positions */
        var rightGapBars2 = Math.max(4, Math.round(visible2.length * 0.08));
        var barW2 = CW2 / Math.max(visible2.length + rightGapBars2, 1);
        var bi2 = Math.max(0, Math.min(visible2.length - 1, Math.round((cssX - PAD2.l) / barW2 - 0.5)));
        var price2 = mx2 - ((cssY - PAD2.t) / CH2) * rng2;
        /* Date tooltip handles the HTML label. Canvas shapes are now drawn inside drawCursorOverlay() */
        var candle2 = visible2[bi2];
        if (candle2) {
          /* ── Top-left fixed OHLCV HTML label ── */
          var isUp = candle2.c >= candle2.o;
          var col = isUp ? '#26a69a' : '#ef5350';
          var chgPct = candle2.o !== 0 ? (((candle2.c - candle2.o) / candle2.o) * 100).toFixed(2) : '0.00';
          var chgAbs = (candle2.c - candle2.o).toFixed(candle2.c >= 1 ? 2 : 5);
          var chgSign = isUp ? '+' : '';
          _ohlcTip.innerHTML =
            '<span style="color:rgba(201,168,76,.55)">O</span> <span style="color:' + col + '">' + formatPrice(candle2.o) + '</span>'
            + '<span style="margin:0 8px;color:rgba(255,255,255,.12)">│</span>'
            + '<span style="color:rgba(201,168,76,.55)">H</span> <span style="color:#26a69a">' + formatPrice(candle2.h) + '</span>'
            + '<span style="margin:0 8px;color:rgba(255,255,255,.12)">│</span>'
            + '<span style="color:rgba(201,168,76,.55)">L</span> <span style="color:#ef5350">' + formatPrice(candle2.l) + '</span>'
            + '<span style="margin:0 8px;color:rgba(255,255,255,.12)">│</span>'
            + '<span style="color:rgba(201,168,76,.55)">C</span> <span style="color:' + col + '">' + formatPrice(candle2.c) + '</span>'
            + '<span style="margin:0 8px;color:rgba(255,255,255,.12)">│</span>'
            + '<span style="color:rgba(201,168,76,.55)">V</span> <span style="color:rgba(180,200,230,.8)">' + formatVol(candle2.v) + '</span>'
            + '<span style="margin:0 8px;color:rgba(255,255,255,.12)">│</span>'
            + '<span style="color:' + col + '">' + chgSign + chgAbs + ' (' + chgSign + chgPct + '%)</span>';
          _ohlcTip.style.display = 'block';
        }
      });
      chartCanvas.addEventListener('mouseleave', function () {
        if (typeof _uploadedMode === 'undefined' || !_uploadedMode) renderChart();
        _ohlcTip.style.display = 'none';

        var lbl = document.getElementById('crosshairLabel'); if (lbl) lbl.style.display = 'none';
      });
      chartCanvas.addEventListener('wheel', function (e) {
        e.preventDefault();
        var dpr = window.devicePixelRatio || 1;
        var r = chartCanvas.getBoundingClientRect();
        /* Anchor zoom on cursor when Ctrl/Meta/Shift held, otherwise anchor on right edge */
        var cssX = (e.ctrlKey || e.metaKey || e.shiftKey)
          ? (e.clientX - r.left)
          : (chartCanvas.width / dpr - _chartPAD.r);
        /* Bar index currently under the anchor point — stays fixed after zoom */
        var pivotBar = screenToWorldX(cssX);
        /* Zoom factor: ~10% per scroll tick, clamped to sensible scaleX range */
        var factor = Math.pow(1.10, -Math.sign(e.deltaY));
        var newScaleX = Math.max(2, Math.min(300, viewState.scaleX * factor));
        /* Keep pivotBar at cssX: worldToScreenX(pivotBar) = PAD.l + (pivotBar+0.5)*newScaleX + newOffsetX = cssX */
        var newOffX = cssX - _chartPAD.l - (pivotBar + 0.5) * newScaleX;
        /* Guard: newest bar must stay at or right of the 20%-from-left line so chart never goes blank.
           Same limit the pan clamp uses: minOff = CW*0.2 - (n-0.5)*scaleX */
        var n2 = (chartCandles && chartCandles.length) || 1;
        var CW2 = chartCanvas.width / dpr - _chartPAD.l - _chartPAD.r;
        var minOff = CW2 * 0.2 - (n2 - 0.5) * newScaleX;
        viewState.offsetX = Math.max(minOff, newOffX);
        viewState.scaleX = newScaleX;
        renderChart();
        if (typeof _scheduleHistoryCheck === 'function') _scheduleHistoryCheck();
      }, { passive: false });

      /* ── Touch events for mobile ── */
      var _touchStartX = 0, _touchStartY = 0, _touchLastX = 0, _touchLastY = 0, _touchStartOffsetX = 0, _touchStartScaleX = 1;
      var _lastTouchDist = 0, _lastTouchCX = 0, _pinching = false;

      chartCanvas.addEventListener('touchstart', function (e) {
        e.preventDefault();
        if (e.touches.length === 2) {
          _pinching = true;
          var dx = e.touches[0].clientX - e.touches[1].clientX;
          var dy = e.touches[0].clientY - e.touches[1].clientY;
          _lastTouchDist = Math.sqrt(dx * dx + dy * dy);
          _lastTouchCX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
          _touchStartScaleX = viewState.scaleX;
          _touchStartOffsetX = viewState.offsetX;
        } else if (e.touches.length === 1) {
          _pinching = false;
          _touchStartX = e.touches[0].clientX;
          _touchLastX = e.touches[0].clientX;
          _touchLastY = e.touches[0].clientY;
          _touchStartOffsetX = viewState.offsetX;
        }
      }, { passive: false });

      chartCanvas.addEventListener('touchmove', function (e) {
        e.preventDefault();
        if (e.touches.length === 2 && _pinching) {
          /* Pinch zoom — anchored to midpoint between fingers */
          var dx = e.touches[0].clientX - e.touches[1].clientX;
          var dy = e.touches[0].clientY - e.touches[1].clientY;
          var dist = Math.sqrt(dx * dx + dy * dy);
          var r = chartCanvas.getBoundingClientRect();
          var cx = (e.touches[0].clientX + e.touches[1].clientX) / 2 - r.left;
          var pivotBar = (_touchStartOffsetX === viewState.offsetX)
            ? screenToWorldX(cx)
            : screenToWorldX(cx);
          var newScaleX = Math.max(2, Math.min(300, _touchStartScaleX * (dist / _lastTouchDist)));
          var newOffXt = cx - _chartPAD.l - (pivotBar + 0.5) * newScaleX;
          var nt = (chartCandles && chartCandles.length) || 1;
          var CWt = chartCanvas.width / (window.devicePixelRatio || 1) - _chartPAD.l - _chartPAD.r;
          viewState.offsetX = Math.max(CWt * 0.2 - (nt - 0.5) * newScaleX, newOffXt);
          viewState.scaleX = newScaleX;
          renderChart();
        } else if (e.touches.length === 1 && !_pinching) {
          /* Pan — incremental with clamp */
          var dx2 = e.touches[0].clientX - _touchLastX;
          var dy2 = e.touches[0].clientY - _touchLastY;
          _touchLastX = e.touches[0].clientX;
          _touchLastY = e.touches[0].clientY;
          _applyPanDelta(dx2, dy2);
          /* Show OHLC on touch */
          var r2 = chartCanvas.getBoundingClientRect();
          var tx = e.touches[0].clientX - r2.left;
          var ty = e.touches[0].clientY - r2.top;
          var PAD2 = { t: 16, b: 44, l: 8, r: 75, vol: 40 };
          var CW2 = W - PAD2.l - PAD2.r, CH2 = (chartCanvas.height / dpr) - PAD2.t - PAD2.b - PAD2.vol;
          var si2 = Math.max(0, (chartCandles.length || 0) - vis - chartView.offset);
          var visible2 = chartCandles.slice(si2, Math.min(chartCandles.length, si2 + vis));
          if (visible2.length) {
            var barW2 = CW2 / visible2.length;
            var bi2 = Math.max(0, Math.min(visible2.length - 1, Math.round((tx - PAD2.l) / barW2)));
            var candle2 = visible2[bi2];
            var tip = document.getElementById('ohlcTip');
            if (tip && candle2) {
              var isUp = candle2.c >= candle2.o, col = isUp ? '#26a69a' : '#ef5350';
              var chgPctT = candle2.o !== 0 ? (((candle2.c - candle2.o) / candle2.o) * 100).toFixed(2) : '0.00';
              var chgAbsT = (candle2.c - candle2.o).toFixed(candle2.c >= 1 ? 2 : 5);
              var chgSignT = isUp ? '+' : '';
              tip.innerHTML =
                '<span style="color:rgba(201,168,76,.55)">O</span> <span style="color:' + col + '">' + formatPrice(candle2.o) + '</span>'
                + '<span style="margin:0 6px;color:rgba(255,255,255,.1)">│</span>'
                + '<span style="color:rgba(201,168,76,.55)">H</span> <span style="color:#26a69a">' + formatPrice(candle2.h) + '</span>'
                + '<span style="margin:0 6px;color:rgba(255,255,255,.1)">│</span>'
                + '<span style="color:rgba(201,168,76,.55)">L</span> <span style="color:#ef5350">' + formatPrice(candle2.l) + '</span>'
                + '<span style="margin:0 6px;color:rgba(255,255,255,.1)">│</span>'
                + '<span style="color:rgba(201,168,76,.55)">C</span> <span style="color:' + col + '">' + formatPrice(candle2.c) + '</span>'
                + '<span style="margin:0 6px;color:rgba(255,255,255,.1)">│</span>'
                + '<span style="color:rgba(201,168,76,.55)">V</span> <span style="color:rgba(180,200,230,.85)">' + formatVol(candle2.v) + '</span>'
                + '<span style="margin:0 6px;color:rgba(255,255,255,.1)">│</span>'
                + '<span style="color:' + col + '">' + chgSignT + chgAbsT + ' (' + chgSignT + chgPctT + '%)</span>';
              tip.style.left = '52px';
              tip.style.top = '6px';
              tip.style.display = 'block';
            }
          }
        }
      }, { passive: false });

      chartCanvas.addEventListener('touchend', function (e) {
        _pinching = false;
        var tip = document.getElementById('ohlcTip');
        if (tip) setTimeout(function () { tip.style.display = 'none'; }, 1500);
      }, { passive: false });

      /* Pan — left-click crosshair OR middle-click; drag right = history, drag left = future gap */
      window._panStart = null; window._panOffset = 0; window._panRightPad = 0;
      /* Inertia state */
      var _panVelX = 0, _panLastX = 0, _panLastY = 0, _panLastT = 0, _panAccum = 0, _inertiaRaf = null;

      /* Global chart render throttle */
      var _mainRafPending = false;
      function requestRenderChart() {
        if (!_mainRafPending && typeof renderChart === 'function') {
          _mainRafPending = true;
          requestAnimationFrame(function () {
            renderChart();
            _mainRafPending = false;
          });
        }
      }

      /* Live price glide animation — smooth MT5-style price line interpolation */
      var _animLivePrice = null;
      var _animTargetPrice = null;
      var _animLivePriceRaf = null;

      function updateLivePriceAnim(targetPrice) {
        _animTargetPrice = targetPrice;
        if (_animLivePrice === null) _animLivePrice = targetPrice;
        if (!_animLivePriceRaf) {
          var animLoop = function () {
            if (_animLivePrice === null || _animTargetPrice === null) { _animLivePriceRaf = null; return; }
            var diff = _animTargetPrice - _animLivePrice;
            if (Math.abs(diff) < 0.000001) {
              _animLivePrice = _animTargetPrice;
              _animLivePriceRaf = null;
              requestRenderChart();
              return;
            }
            _animLivePrice += diff * 0.2;
            requestRenderChart();
            _animLivePriceRaf = requestAnimationFrame(animLoop);
          };
          _animLivePriceRaf = requestAnimationFrame(animLoop);
        }
      }

      /* dx > 0 = drag right = older bars; dy < 0 = drag up = higher prices */
      function _applyPanDelta(dx, dy) {
        if (!dx && !dy) return;
        var n = (chartCandles && chartCandles.length) || 0;
        var dpr = window.devicePixelRatio || 1;
        var W = chartCanvas.width / dpr;
        var barW = Math.max(1, viewState.scaleX);
        /* X clamp:
           maxOffX: bar 0 (oldest) at LEFT edge — can't pan further right than first bar
           minOffX: bar n-1 (newest) stays ~5 bars from right edge (future gap)        */
        var CW2 = W - _chartPAD.l - _chartPAD.r;
        /* maxOffX: allow bar 0 to reach left edge (pan all the way into history) */
        var maxOffX = 0;
        /* minOffX: newest bar sits at least 20% from right edge (small future gap) */
        var minOffX = CW2 * 0.2 - (n - 0.5) * barW;
        if (dx) viewState.offsetX = Math.min(maxOffX, Math.max(minOffX, viewState.offsetX + dx));
        /* Y pan: drag down (dy>0) = content moves down = see lower prices */
        if (dy && _lastCH > 0) {
          var newOff = viewState.priceOffset + dy / _lastCH;
          viewState.priceOffset = Math.min(1, Math.max(-1, newOff));
        }
        requestRenderChart();
        if (typeof _scheduleHistoryCheck === 'function') _scheduleHistoryCheck();
      }

      function _startInertia() {
        if (_inertiaRaf) cancelAnimationFrame(_inertiaRaf);
        _panAccum = 0;
        (function loop() {
          if (Math.abs(_panVelX) < 0.5) { _panVelX = 0; return; }
          _applyPanDelta(_panVelX);
          _panVelX *= 0.88;
          _inertiaRaf = requestAnimationFrame(loop);
        })();
      }

      chartCanvas.addEventListener('mousedown', function (e) {
        if (e.button !== 1) return;
        e.preventDefault();
        if (_inertiaRaf) { cancelAnimationFrame(_inertiaRaf); _inertiaRaf = null; }
        _panVelX = 0; _panAccum = 0;
        window._panStart = e.clientX;
        _panLastX = e.clientX; _panLastY = e.clientY; _panLastT = Date.now();
        chartCanvas.style.cursor = 'grabbing';
      });
      document.addEventListener('mousemove', function (e) {
        if (window._panStart === null) return;
        var now = Date.now(), dt = now - _panLastT;
        /* velocity in px/frame (16ms), positive = dragging right */
        if (dt > 0) _panVelX = (e.clientX - _panLastX) / (dt / 16);
        var dx = e.clientX - _panLastX;
        var dy = e.clientY - _panLastY;
        _panLastX = e.clientX; _panLastY = e.clientY; _panLastT = now;
        if (dx || dy) _applyPanDelta(dx, dy);
      });
      document.addEventListener('mouseup', function (e) {
        if (window._panStart !== null && (e.button === 1 || e.button === 0)) {
          window._panStart = null;
          chartCanvas.style.cursor = (typeof activeItem !== 'undefined' && activeItem) ? (activeItem.cur || 'crosshair') : 'crosshair';
          if (Math.abs(_panVelX) > 1) _startInertia();
        }
      });
      chartCanvas.addEventListener('mouseleave', function () {
        if (window._panStart === null) chartCanvas.style.cursor = 'crosshair';
      });

      /* ── FractalScript sub-pane maximize/restore button ── */
      chartCanvas.addEventListener('mousedown', function (e) {
        if (e.button !== 0 || !_fsMaxBtnBounds) return;
        var dpr = window.devicePixelRatio || 1;
        var r = chartCanvas.getBoundingClientRect();
        var mx = (e.clientX - r.left);
        var my = (e.clientY - r.top);
        var b = _fsMaxBtnBounds;
        if (mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h) {
          e.preventDefault();
          e.stopPropagation();
          _fsMaximized = !_fsMaximized;
          renderChart();
        }
      }, true);

      /* ── VPVR drag: left-click on the handle pill to move it horizontally ── */
      chartCanvas.addEventListener('mousedown', function (e) {
        if (!vpvrOn || e.button !== 0) return;
        var dpr = window.devicePixelRatio || 1;
        var r = chartCanvas.getBoundingClientRect();
        var cx = (e.clientX - r.left);
        var cy = (e.clientY - r.top);
        var h = drawVPVR;
        if (!h._w) return;
        /* Hit-test the drag handle pill */
        if (cx >= h._x && cx <= h._x + h._w && cy >= h._hy && cy <= h._hy + h._hh) {
          _vpvrDragging = true;
          _vpvrDragOff = cx - h._x;
          e.stopPropagation();
        }
      });

      document.addEventListener('mousemove', function (e) {
        if (!_vpvrDragging) return;
        var dpr = window.devicePixelRatio || 1;
        var r = chartCanvas.getBoundingClientRect();
        var cx = (e.clientX - r.left);
        vpvrAnchorX = cx - _vpvrDragOff;
        requestRenderChart();
      });

      document.addEventListener('mouseup', function (e) {
        if (_vpvrDragging) { _vpvrDragging = false; }
      });

      /* ── Date-axis drag (bottom strip): horizontal stretch/compress ── */
      var _dateAxisDrag = null;
      /* ── Price-axis drag (right strip): vertical stretch/compress ── */
      var _priceAxisDrag = null;

      chartCanvas.addEventListener('mousedown', function (e) {
        if (e.button !== 0) return;
        var dpr = window.devicePixelRatio || 1;
        var r = chartCanvas.getBoundingClientRect();
        var cx = e.clientX - r.left;
        var cy = e.clientY - r.top;
        var H2 = chartCanvas.height / dpr;
        var W2 = chartCanvas.width / dpr;
        /* Price axis: right 75px strip */
        if (cx > W2 - 75) {
          _priceAxisDrag = { startY: e.clientY, startYScale: chartView.yScale };
          chartCanvas.style.cursor = 'ns-resize';
          e.stopPropagation(); return;
        }
        /* Date axis: bottom 56px strip */
        if (cy > H2 - 56) {
          /* Pivot the zoom on the centre of the visible chart */
          var pivotX = W2 / 2;
          _dateAxisDrag = {
            startX: e.clientX, startScaleX: viewState.scaleX,
            startOffsetX: viewState.offsetX, pivotBar: screenToWorldX(pivotX), pivotX: pivotX
          };
          chartCanvas.style.cursor = 'ew-resize';
          e.stopPropagation(); return;
        }
      });

      /* ── Strategy trade marker click → tooltip ── */
      (function () {
        var _tip = document.createElement('div');
        _tip.id = 'fsTradeTip';
        _tip.style.cssText = 'position:fixed;display:none;background:rgba(6,8,13,0.95);border:1px solid rgba(150,150,180,0.4);border-radius:6px;padding:8px 12px;font:12px DM Mono,monospace;color:#e0e4f0;pointer-events:none;z-index:9999;line-height:1.6;min-width:160px';
        document.body.appendChild(_tip);

        chartCanvas.addEventListener('click', function (e) {
          var hits = window._fsTradeHits;
          if (!hits || !hits.length) { _tip.style.display = 'none'; return; }
          var dpr = window.devicePixelRatio || 1;
          var r = chartCanvas.getBoundingClientRect();
          var cx = (e.clientX - r.left);
          var cy = (e.clientY - r.top);
          for (var i = 0; i < hits.length; i++) {
            var h = hits[i];
            if (cx >= h.x && cx <= h.x + h.w && cy >= h.y && cy <= h.y + h.h) {
              var t = h.trade;
              var win = t.profit >= 0;
              var pnlColor = win ? '#26a69a' : '#ef5350';
              _tip.innerHTML =
                '<div style="font-weight:bold;color:' + (t.direction === 'long' ? '#2196F3' : '#e91e63') + ';margin-bottom:4px">' +
                (t.direction === 'long' ? '▲ Long' : '▼ Short') + '</div>' +
                'Entry:  <b>' + t.entryPrice.toFixed(4) + '</b> (bar ' + t.entryBar + ')<br>' +
                'Exit:   <b>' + t.exitPrice.toFixed(4) + '</b> (bar ' + t.exitBar + ')<br>' +
                'P&L: <b style="color:' + pnlColor + '">' + (win ? '+' : '') + t.profit.toFixed(4) + '</b>';
              var tipX = e.clientX + 14;
              var tipY = e.clientY - 10;
              if (tipX + 200 > window.innerWidth) tipX = e.clientX - 214;
              _tip.style.left = tipX + 'px';
              _tip.style.top = tipY + 'px';
              _tip.style.display = 'block';
              e.stopPropagation();
              return;
            }
          }
          _tip.style.display = 'none';
        });

        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') _tip.style.display = 'none';
        });
      })();

      document.addEventListener('mousemove', function (e) {
        if (_dateAxisDrag) {
          var dx = e.clientX - _dateAxisDrag.startX;
          /* drag left = zoom in (fewer bars = larger scaleX), drag right = zoom out */
          var n4 = (chartCandles && chartCandles.length) || 1;
          var dpr4 = window.devicePixelRatio || 1;
          var CW4 = chartCanvas.width / dpr4 - _chartPAD.l - _chartPAD.r;
          var minScale4 = Math.max(0.5, CW4 / (n4 + 1));
          var newScaleX = Math.max(minScale4, Math.min(300, _dateAxisDrag.startScaleX * Math.pow(1.003, -dx)));
          /* Keep pivot bar at the same screen position */
          viewState.scaleX = newScaleX;
          viewState.offsetX = _dateAxisDrag.pivotX - _chartPAD.l - (_dateAxisDrag.pivotBar + 0.5) * newScaleX;
          requestRenderChart(); return;
        }
        if (_priceAxisDrag) {
          var dy = e.clientY - _priceAxisDrag.startY;
          /* drag up (dy<0) = zoom in (tighter range), drag down = zoom out (wider range) */
          chartView.yScale = Math.max(0.1, Math.min(10, _priceAxisDrag.startYScale * Math.pow(1.003, dy)));
          viewState.priceOffset = 0; /* pure compression — don't mix with Y pan */
          requestRenderChart(); return;
        }
      });

      document.addEventListener('mouseup', function (e) {
        if (_dateAxisDrag) { _dateAxisDrag = null; chartCanvas.style.cursor = 'crosshair'; }
        if (_priceAxisDrag) { _priceAxisDrag = null; chartCanvas.style.cursor = 'crosshair'; }
      });

      /* Double-click price axis = reset vertical zoom */
      chartCanvas.addEventListener('dblclick', function (e) {
        var dpr = window.devicePixelRatio || 1;
        var r = chartCanvas.getBoundingClientRect();
        var cx = e.clientX - r.left;
        var W2 = chartCanvas.width / dpr;
        if (cx > W2 - 75) { chartView.yScale = 1; renderChart && renderChart(); }
      });
    }

    function captureChart() {
      if (typeof dataUrl !== 'undefined' && dataUrl) { if (typeof runPendingTool === 'function') runPendingTool(); return; }
      var cv = document.getElementById('chartCanvas');
      if (cv && chartCandles && chartCandles.length > 0) {
        dataUrl = cv.toDataURL('image/png');
        if (typeof runPendingTool === 'function') runPendingTool(); return;
      }
      if (typeof showCapturePrompt === 'function') showCapturePrompt();
    }
    function captureForTool() {
      /* 1. Prefer live chart canvas if candles are loaded */
      var cv = document.getElementById('chartCanvas');
      if (cv && chartCandles && chartCandles.length > 0) return cv.toDataURL('image/png');
      /* 2. Fall back to uploaded image or previously snapped dataUrl */
      if (typeof dataUrl !== 'undefined' && dataUrl) return dataUrl;
      return null;
    }
    function captureAndStore() {
      var cv = document.getElementById('chartCanvas');
      if (cv && chartCandles && chartCandles.length > 0) dataUrl = cv.toDataURL('image/png');
    }
    function takeSnapshot() {
      var btn = document.getElementById('snapBtn'), txt = document.getElementById('snapTxt');
      var azBtn = document.getElementById('azBtn');
      var cv = document.getElementById('chartCanvas');
      if (!cv || !chartCandles || chartCandles.length < 2) { if (txt) txt.textContent = 'Load a chart first'; return; }
      dataUrl = cv.toDataURL('image/png');
      if (txt) txt.textContent = '✓ Chart captured';
      if (btn) { btn.style.borderColor = 'rgba(39,174,96,.4)'; btn.style.color = '#27ae60'; }
      if (azBtn) azBtn.disabled = false;
      if (typeof buildToolGrid === 'function') buildToolGrid();
    }

    /* ── Called once when candle data first arrives to set a sensible initial view ── */
    function _initViewState(candles) {
      var dpr = window.devicePixelRatio || 1;
      var W = (chartCanvas && chartCanvas.width > 0) ? chartCanvas.width / dpr : 800;
      var CW = W - _chartPAD.l - _chartPAD.r;
      var n = candles.length;
      /* Show ~120 bars by default (enough context without being too zoomed out) */
      var defaultVis = Math.min(120, Math.max(30, n));
      /* Newest bar sits at 85% across the chart area, leaving ~15% future gap */
      var targetX = _chartPAD.l + CW * 0.85;
      viewState.scaleX = Math.max(0.05, Math.min(20, CW / (defaultVis + 1)));
      /* worldToScreenX(n-1) = PAD.l + (n-0.5)*scaleX + offsetX = targetX */
      viewState.offsetX = targetX - _chartPAD.l - (n - 0.5) * viewState.scaleX;
      viewState.priceOffset = 0;
    }

    /* ── Keep chartView in sync for any code that still reads chartView.offset / zoom ── */
    function _syncChartViewFromViewState() {
      if (!chartCandles || !chartCandles.length) return;
      var n = chartCandles.length;
      var dpr = window.devicePixelRatio || 1;
      var W = chartCanvas ? chartCanvas.width / dpr : 800;
      var CW = W - _chartPAD.l - _chartPAD.r;
      var barW = Math.max(1, viewState.scaleX);
      var visibleBars = Math.max(10, Math.round(CW / barW));
      chartView.zoom = n / Math.max(1, visibleBars);
      var startIdx = Math.max(0, Math.floor(-viewState.offsetX / barW) - 1);
      chartView.offset = Math.max(0, n - visibleBars - startIdx);
      chartView.rightPad = 0;
    }

    function loadChart(symbol, interval) {
      if (!symbol) return;
      var sym = symbol.toUpperCase().replace('/', '-'); // Keep URL safe but preserve format
      if (currentSymbol && currentSymbol !== sym) {
        var ud = document.getElementById('uniDash'); if (ud) ud.style.display = 'none';
        var re = document.getElementById('rEmpty2'); if (re) re.style.display = 'flex';
        dataUrl = null;
      }
      currentSymbol = sym; currentInterval = interval || '4h';
      vpvrAnchorX = null; chartView.rightPad = 0; /* reset VPVR gap on new symbol */
      var empty = document.getElementById('chartEmpty'); if (empty) empty.style.display = 'none';
      if (chartSSE) { chartSSE.close(); chartSSE = null; }
      chartCandles = []; _historyLoading = false; _historyDepleted = false;
      _animLivePrice = null; _animTargetPrice = null;
      resizeCanvas();
      if (chartCtx) {
        var _dpr = window.devicePixelRatio || 1;
        var _cw = chartCanvas.width / _dpr, _ch = chartCanvas.height / _dpr;
        chartCtx.fillStyle = C.bg; chartCtx.fillRect(0, 0, _cw, _ch);
        chartCtx.fillStyle = 'rgba(201,168,76,.4)'; chartCtx.font = '11px DM Mono'; chartCtx.textAlign = 'center';
        chartCtx.fillText('Loading ' + sym + '…', _cw / 2, _ch / 2);
      }
      /* Update badge immediately for new symbol */
      var _lm = document.getElementById('livePriceMeta'), _lv = document.getElementById('livePriceVal'), _lb = document.getElementById('livePriceBar');
      if (_lm) _lm.textContent = 'LIVE · ' + sym; if (_lv) _lv.textContent = '—'; if (_lb) _lb.classList.add('show');
      _updateSrcSwitch(sym);
      startPricePolling(sym);

      var _srcParam = (currentDataSource === 'oanda' || currentDataSource === 'capital') ? '&source=' + currentDataSource : '';
      fetch(BACKEND_URL + '/candles/' + sym + '?tf=' + currentInterval + _srcParam)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.loading) {
            /* OANDA history loading in background — retry in 4s */
            showChartMsg('Loading OANDA data for ' + sym + '…');
            setTimeout(function () { if (currentSymbol === sym && currentDataSource === 'oanda') loadChart(sym, currentInterval); }, 4000);
            return;
          }
          if (d.candles && d.candles.length > 0) {
            chartCandles = sanitizeCandles(d.candles);
            _initViewState(d.candles);
            renderChart();
            lwChartInstance = true;
            var btn = document.getElementById('azBtn'); if (btn) btn.disabled = false;
            if (typeof buildToolGrid === 'function') buildToolGrid();
          } else {
            if (currentDataSource === 'oanda') {
              showChartMsg('Market closed or no data available for ' + sym);
            } else {
              fetchTwelveDataFallback(sym, currentInterval);
            }
          }
        }).catch(function () {
          if (currentDataSource === 'oanda') {
            showChartMsg('Failed to load OANDA data for ' + sym);
          } else {
            fetchTwelveDataFallback(sym, currentInterval);
          }
        });

      chartSSE = new EventSource(BACKEND_URL + '/subscribe/' + sym + ((currentDataSource === 'oanda' || currentDataSource === 'capital') ? '?source=' + currentDataSource : ''));
      chartSSE.onmessage = function (e) {
        try {
          var data = JSON.parse(e.data);
          if (data.status === 'loading') { showChartMsg('Loading ' + sym + '\u2026'); return; }
          if (sym !== currentSymbol) return;

          /* ── Full history on initial connect ── */
          if (data.candles) {
            if (!data.candles[currentInterval]) return;
            if (typeof _btActive !== 'undefined' && _btActive) { _btAllCandles = sanitizeCandles(data.candles[currentInterval]); return; }
            chartCandles = sanitizeCandles(data.candles[currentInterval]);
            renderChart();
            var last0 = chartCandles[chartCandles.length - 1];
            var prev0 = chartCandles.length > 1 ? chartCandles[chartCandles.length - 2].c : last0.o;
            showLivePrice({ symbol: sym, price: last0.c, change_24h: ((last0.c - prev0) / prev0 * 100).toFixed(3), trend_24h: last0.c >= prev0 ? 'up' : 'dn' });
            lwChartInstance = true;
            var btn0 = document.getElementById('azBtn'); if (btn0) btn0.disabled = false;
            if (typeof buildToolGrid === 'function') buildToolGrid();
            return;
          }

          /* ── Tick delta: only the latest candle per timeframe ── */
          if (data.tick) {
            var tc = data.tick[currentInterval];

            /* 4h/1d/1w receive no streaming ticks (broker-offset issue — see oanda.js TICK_TFS).
               Extract the live price from the most granular tick available and apply it directly
               to the current higher-TF candle so the chart and price bar stay live.
               *** MUST check _btActive first — during replay this path has no other guard *** */
            if (!tc) {
              /* Replay guard — never touch chartCandles while replaying */
              if (typeof _btActive !== 'undefined' && _btActive) return;
              var _stfs = ['1m', '5m', '15m', '30m', '1h'];
              var _lp = null;
              for (var _si = 0; _si < _stfs.length; _si++) {
                if (data.tick[_stfs[_si]]) { _lp = data.tick[_stfs[_si]].c; break; }
              }
              if (!_lp || !chartCandles.length) return;
              var _cb = chartCandles[chartCandles.length - 1];
              _cb.c = _lp;
              if (_lp > _cb.h) _cb.h = _lp;
              if (_lp < _cb.l) _cb.l = _lp;
              updateLivePriceAnim(_lp);
              renderChart();
              var _prv = chartCandles.length > 1 ? chartCandles[chartCandles.length - 2].c : _cb.o;
              showLivePrice({ symbol: sym, price: _lp, change_24h: ((_lp - _prv) / _prv * 100).toFixed(3), trend_24h: _lp >= _prv ? 'up' : 'dn' });
              return;
            }

            /* Backtest guard — update _btAllCandles directly, never touch chartCandles (replay slice) */
            if (typeof _btActive !== 'undefined' && _btActive) {
              if (_btAllCandles && _btAllCandles.length) {
                var btLast = _btAllCandles[_btAllCandles.length - 1];
                if (btLast.t === tc.t) { btLast.c = tc.c; btLast.h = tc.h; btLast.l = tc.l; btLast.v = tc.v; }
                else { _btAllCandles.push(tc); }
              }
              return;
            }
            if (!chartCandles.length) return;
            var last = chartCandles[chartCandles.length - 1];
            if (last.t === tc.t) {
              /* Update current candle in-place */
              last.c = tc.c; last.h = tc.h; last.l = tc.l; last.v = tc.v;
            } else {
              /* New candle opened */
              chartCandles.push(tc);
              if (chartCandles.length > 500) chartCandles.shift();
            }
            updateLivePriceAnim(tc.c);
            renderChart();
            var last2 = chartCandles[chartCandles.length - 1];
            var prev2 = chartCandles.length > 1 ? chartCandles[chartCandles.length - 2].c : last2.o;
            showLivePrice({ symbol: sym, price: last2.c, change_24h: ((last2.c - prev2) / prev2 * 100).toFixed(3), trend_24h: last2.c >= prev2 ? 'up' : 'dn' });
          }
        } catch (err) { }
      };
      chartSSE.onerror = function () { console.warn('[SSE] error for', sym); };

      fetch(BACKEND_URL + '/price/' + sym)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.price && sym === currentSymbol)
            showLivePrice({ symbol: sym, price: d.price, change_24h: d.change_pct, trend_24h: parseFloat(d.change_pct || 0) >= 0 ? 'up' : 'dn' });
        })
        .catch(function () { fetchTwelveDataPrice(sym); });
    }

    function isForexSymbol(sym) {
      var s = sym.toUpperCase();
      return FOREX_FULL.includes(s) || s.startsWith('XAU') || s.startsWith('XAG') ||
        (s.length === 6 && ['USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD'].some(function (q) { return s.endsWith(q); }));
    }

    function fetchTwelveDataFallback(sym, tf) {
      showChartMsg('Loading ' + sym + '\u2026');
      var attempts = 0;
      var retryTimer = setInterval(function () {
        attempts++;
        var _srcP = (currentDataSource === 'oanda' || currentDataSource === 'capital') ? '&source=' + currentDataSource : '';
        fetch(BACKEND_URL + '/candles/' + sym + '?tf=' + tf + _srcP)
          .then(function (r) { return r.json(); })
          .then(function (d) {
            if (d.candles && d.candles.length > 0) {
              clearInterval(retryTimer);
              chartCandles = d.candles;
              _initViewState(d.candles);
              renderChart();
              lwChartInstance = true;
              var btn = document.getElementById('azBtn'); if (btn) btn.disabled = false;
              if (typeof buildToolGrid === 'function') buildToolGrid();
              if (sym === currentSymbol) {
                var last = d.candles[d.candles.length - 1], prev = d.candles.length > 1 ? d.candles[d.candles.length - 2].c : last.o;
                showLivePrice({ symbol: sym, price: last.c, change_24h: ((last.c - prev) / prev * 100).toFixed(3), trend_24h: last.c >= prev ? 'up' : 'dn' });
              }
            } else if (attempts >= 25) {
              clearInterval(retryTimer);
              showChartMsg('Could not load ' + sym + '.\nCheck server logs or TwelveData API key.');
            }
          })
          .catch(function () {
            if (attempts >= 25) { clearInterval(retryTimer); showChartMsg('Could not load chart data. Please try again.'); }
          });
      }, 350);
    }

    function fetchTwelveDataPrice(sym) {
      /* Use Railway /price endpoint which has the latest tick */
      fetch(BACKEND_URL + '/price/' + sym)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.price && sym === currentSymbol)
            showLivePrice({ symbol: sym, price: d.price, change_24h: d.change_pct || '0', trend_24h: parseFloat(d.change_pct || 0) >= 0 ? 'up' : 'dn' });
        }).catch(function () { });
    }

    function showChartMsg(msg) {
      if (!chartCtx || !chartCanvas) return;
      var _dpr = window.devicePixelRatio || 1;
      var _cw = chartCanvas.width / _dpr, _ch = chartCanvas.height / _dpr;
      chartCtx.fillStyle = C.bg; chartCtx.fillRect(0, 0, _cw, _ch);
      chartCtx.fillStyle = 'rgba(201,168,76,.5)'; chartCtx.font = '11px DM Mono'; chartCtx.textAlign = 'center';
      var lines = msg.split('\n'), cy = _ch / 2 - (lines.length - 1) * 12;
      lines.forEach(function (l, i) { chartCtx.fillText(l, _cw / 2, cy + i * 22); });
    }

    function fetchBinanceFallback(sym, tf) {
      /* Removed — all data comes from TwelveData via server */
      console.warn('[fetchBinanceFallback] called for', sym, tf, '— skipped, using TwelveData');
    }


    function onTfChange() {
      var tf = document.getElementById('tfIn');
      if (!tf || !currentSymbol) return;
      currentInterval = tf.value;
      _historyLoading = false; _historyDepleted = false;
      var _srcQ = (currentDataSource === 'oanda' || currentDataSource === 'capital') ? '&source=' + currentDataSource : '';
      fetch(BACKEND_URL + '/candles/' + currentSymbol + '?tf=' + currentInterval + _srcQ)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          if (d.candles && d.candles.length > 0) {
            chartCandles = d.candles;
            _initViewState(d.candles);
            renderChart();
          } else {
            if (currentDataSource === 'oanda') {
              showChartMsg('Market closed or no data for ' + currentSymbol);
            } else {
              fetchTwelveDataFallback(currentSymbol, currentInterval);
            }
          }
        }).catch(function () {
          if (currentDataSource === 'oanda') {
            showChartMsg('Failed to load OANDA data for ' + currentSymbol);
          } else {
            fetchTwelveDataFallback(currentSymbol, currentInterval);
          }
        });
    }

    var _historyCheckTimer = null;
    function _scheduleHistoryCheck() {
      clearTimeout(_historyCheckTimer);
      _historyCheckTimer = setTimeout(function () {
        if (!chartCandles.length || !currentSymbol || _historyLoading || _historyDepleted) return;
        /* Compute start index using viewState (world-space coordinates) */
        var barW = Math.max(1, viewState.scaleX);
        var si = Math.max(0, Math.floor(-viewState.offsetX / barW) - 1);
        /* Pre-fetch when within 300 bars of the oldest loaded candle — gives enough runway */
        if (si < 300) _fetchMoreHistory();
      }, 50);
    }

    function _fetchMoreHistory() {
      if (_historyLoading || _historyDepleted || !chartCandles.length || !currentSymbol) return;
      _historyLoading = true;
      renderChart && renderChart(); /* show loading indicator immediately */
      var endTime = chartCandles[0].t - 1;
      var _hSrcQ = (currentDataSource === 'oanda' || currentDataSource === 'capital') ? '&source=' + currentDataSource : '';
      fetch(BACKEND_URL + '/history/' + currentSymbol + '?tf=' + currentInterval + '&endTime=' + endTime + _hSrcQ)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          _historyLoading = false;
          if (!d.candles || d.candles.length < 2) { _historyDepleted = true; renderChart && renderChart(); return; }
          var batch = sanitizeCandles(d.candles.filter(function (c) { return c.t < chartCandles[0].t; }));
          if (!batch.length) { _historyDepleted = true; renderChart && renderChart(); return; }
          /* Prepend batch — shift viewState.offsetX so existing bars stay in place (no jump) */
          Array.prototype.unshift.apply(chartCandles, batch);
          viewState.offsetX -= batch.length * Math.max(1, viewState.scaleX);
          renderChart && renderChart();
        })
        .catch(function () { _historyLoading = false; renderChart && renderChart(); });
    }

    function toggleSMA(period) {
      var chart = null; /* TV removed */
      if (period === 50) {
        sma50On = !sma50On;
        var b = document.getElementById('sma50Btn'); if (b) b.style.opacity = sma50On ? '1' : '0.35';
        if (chart) {
          if (sma50On && !tvStudyIds.sma50) tvStudyIds.sma50 = chart.createStudy('Moving Average@tv-basicstudies-1', false, false, { length: 50 }, { 'Plot.color': '#c9a84c' });
          else if (!sma50On && tvStudyIds.sma50) { chart.removeEntity(tvStudyIds.sma50); tvStudyIds.sma50 = null; }
        }
      } else if (period === 200) {
        sma200On = !sma200On;
        var b = document.getElementById('sma200Btn'); if (b) { b.style.opacity = sma200On ? '1' : '0.35'; b.style.color = sma200On ? C.sma200 : '#8a95a8'; b.style.borderColor = sma200On ? 'rgba(38,166,154,.4)' : 'rgba(255,255,255,.08)'; }
        if (chart) {
          if (sma200On && !tvStudyIds.sma200) tvStudyIds.sma200 = chart.createStudy('Moving Average@tv-basicstudies-1', false, false, { length: 200 }, { 'Plot.color': '#3498db' });
          else if (!sma200On && tvStudyIds.sma200) { chart.removeEntity(tvStudyIds.sma200); tvStudyIds.sma200 = null; }
        }
      } else if (period === 400) {
        sma400On = !sma400On;
        var b = document.getElementById('sma400Btn'); if (b) { b.style.opacity = sma400On ? '1' : '0.35'; b.style.color = sma400On ? C.sma400 : '#8a95a8'; b.style.borderColor = sma400On ? 'rgba(52,152,219,.4)' : 'rgba(255,255,255,.08)'; }
        if (chart) {
          if (sma400On && !tvStudyIds.sma400) tvStudyIds.sma400 = chart.createStudy('Moving Average@tv-basicstudies-1', false, false, { length: 400 }, { 'Plot.color': '#3498db' });
          else if (!sma400On && tvStudyIds.sma400) { chart.removeEntity(tvStudyIds.sma400); tvStudyIds.sma400 = null; }
        }
      } else if (period === 900) {
        sma900On = !sma900On;
        var b = document.getElementById('sma900Btn'); if (b) { b.style.opacity = sma900On ? '1' : '0.35'; b.style.color = sma900On ? C.sma900 : '#8a95a8'; b.style.borderColor = sma900On ? 'rgba(155,143,232,.4)' : 'rgba(255,255,255,.08)'; }
      }
      if (!chart) renderChart();
    }

    function toggleSmaCrossZone() {
      smaCrossZoneOn = !smaCrossZoneOn;
      var b = document.getElementById('smaCrossZoneBtn');
      if (b) { b.style.opacity = smaCrossZoneOn ? '1' : '0.35'; b.style.color = smaCrossZoneOn ? '#c9a84c' : '#8a95a8'; b.style.borderColor = smaCrossZoneOn ? 'rgba(201,168,76,.4)' : 'rgba(255,255,255,.08)'; }

      /* On enable — also inject candles as a draggable bar pattern drawing */
      if (smaCrossZoneOn && window.addDrawing) {
        var candles = chartCandles;
        if (!candles || candles.length < 400) { renderChart(); return; }

        function _calcSMA(period) {
          var out = new Array(candles.length).fill(null);
          for (var i = period - 1; i < candles.length; i++) {
            var s = 0; for (var k = 0; k < period; k++) s += candles[i - k].c;
            out[i] = s / period;
          }
          return out;
        }
        var sma200 = _calcSMA(200), sma400 = _calcSMA(400);
        var sma900 = candles.length >= 900 ? _calcSMA(900) : null;

        var cross1 = -1;
        for (var i = candles.length - 1; i >= 400; i--) {
          if (sma200[i - 1] === null || sma400[i - 1] === null) continue;
          if ((sma200[i - 1] - sma400[i - 1]) * (sma200[i] - sma400[i]) < 0) { cross1 = i; break; }
        }
        var cross2 = -1;
        if (sma900) {
          for (var i = candles.length - 1; i >= 900; i--) {
            if (sma400[i - 1] === null || sma900[i - 1] === null) continue;
            if ((sma400[i - 1] - sma900[i - 1]) * (sma400[i] - sma900[i]) < 0) { cross2 = i; break; }
          }
        }

        var zoneStart = -1, zoneEnd = -1;
        if (cross1 >= 0 && cross2 >= 0) { zoneStart = Math.min(cross1, cross2); zoneEnd = Math.max(cross1, cross2); }
        else if (cross1 >= 0) { zoneStart = Math.max(0, cross1 - 30); zoneEnd = cross1; }

        if (zoneStart >= 0 && zoneEnd > zoneStart) {
          var caps = candles.slice(zoneStart, zoneEnd + 1);
          if (caps.length >= 2) {
            var bpPmx = Math.max.apply(null, caps.map(function (c) { return c.h; }));
            var bpPmn = Math.min.apply(null, caps.map(function (c) { return c.l; }));
            var ghostScale = Math.min(1, 40 / Math.max(1, caps.length));
            window.addDrawing({
              type: 'barpattern', barpattern: true, pixelOnly: false,
              candles: caps,
              p1: { bi: zoneStart, price: bpPmx },
              p2: { bi: zoneEnd, price: bpPmn }
            });
            return; /* addDrawing calls renderChart */
          }
        }
      }
      renderChart();
    }

    function toggleFM() {
      fmOn = !fmOn;
      var b = document.getElementById('fmBtn');
      if (b) {
        b.style.opacity     = fmOn ? '1' : '0.35';
        b.style.color       = fmOn ? '#c9a84c' : '#8a95a8';
        b.style.borderColor = fmOn ? 'rgba(201,168,76,.4)' : 'rgba(255,255,255,.08)';
      }
      if (!fmOn) { var badge = document.getElementById('fmBadge'); if (badge) badge.style.display = 'none'; }
      renderChart();
    }

    function yToPrice(y) {
      if (!chartCandles.length) return 0;
      var mn = Math.min.apply(null, chartCandles.slice(-100).map(function (c) { return c.l; }));
      var mx = Math.max.apply(null, chartCandles.slice(-100).map(function (c) { return c.h; }));
      return mx - y * (mx - mn);
    }

    function drawToolResultOnChart(toolId, result) {
      if (!chartCtx || !chartCandles.length) return;
      renderChart();
      var W = chartCanvas.width, H = chartCanvas.height;
      var PAD = { t: 12, b: 40, l: 8, r: 64, vol: 45 };
      var CH = H - PAD.t - PAD.b - PAD.vol;
      var mn = Math.min.apply(null, chartCandles.slice(-100).map(function (c) { return c.l; }));
      var mx = Math.max.apply(null, chartCandles.slice(-100).map(function (c) { return c.h; }));
      var rng = mx - mn || 0.0001; mn -= rng * 0.04; mx += rng * 0.04; rng = mx - mn;
      function pyN(y) { return PAD.t + CH - (1 - y) * CH; }
      if (toolId === 'fib' && result.retracements) {
        result.retracements.forEach(function (r) {
          var y = pyN(r.y);
          chartCtx.strokeStyle = r.color || '#c9a84c'; chartCtx.lineWidth = 0.8; chartCtx.setLineDash([4, 3]);
          chartCtx.beginPath(); chartCtx.moveTo(PAD.l, y); chartCtx.lineTo(W - PAD.r, y); chartCtx.stroke(); chartCtx.setLineDash([]);
          chartCtx.fillStyle = r.color || '#c9a84c'; chartCtx.font = '8px DM Mono'; chartCtx.textAlign = 'right';
          chartCtx.fillText(r.level + (r.price ? ' ' + r.price : ''), W - PAD.r - 2, y - 2);
        });
      }
      if (toolId === 'smc') {
        if (result.order_blocks) result.order_blocks.forEach(function (ob) {
          var y1 = pyN(ob.y1 || 0.5), y2 = pyN(ob.y2 || 0.55);
          chartCtx.fillStyle = ob.type === 'bullish' ? 'rgba(39,174,96,0.12)' : 'rgba(239,83,80,0.12)';
          chartCtx.fillRect(PAD.l, y1, W - PAD.l - PAD.r, y2 - y1);
          chartCtx.strokeStyle = ob.color || '#27ae60'; chartCtx.lineWidth = 0.8;
          chartCtx.strokeRect(PAD.l, y1, W - PAD.l - PAD.r, y2 - y1);
        });
        if (result.liquidity_pools) result.liquidity_pools.forEach(function (lp) {
          var y = pyN(lp.y || 0.5);
          chartCtx.strokeStyle = lp.color || '#c9a84c'; chartCtx.lineWidth = 1; chartCtx.setLineDash([6, 3]);
          chartCtx.beginPath(); chartCtx.moveTo(PAD.l, y); chartCtx.lineTo(W - PAD.r, y); chartCtx.stroke(); chartCtx.setLineDash([]);
        });
      }
    }

    var pairInputTimer = null;
    /* Resolve short input to full symbol */
    var FOREX_FULL = [];
    var CRYPTO_AUTO = {
      'BTC': 'BTCUSDT', 'ETH': 'ETHUSDT', 'SOL': 'SOLUSDT', 'BNB': 'BNBUSDT',
      'XRP': 'XRPUSDT', 'ADA': 'ADAUSDT', 'DOGE': 'DOGEUSDT', 'AVAX': 'AVAXUSDT',
      'LINK': 'LINKUSDT', 'DOT': 'DOTUSDT', 'MATIC': 'MATICUSDT', 'LTC': 'LTCUSDT',
      'UNI': 'UNIUSDT', 'ATOM': 'ATOMUSDT', 'NEAR': 'NEARUSDT', 'APT': 'APTUSDT'
    };
    /* Forex base currencies — 3-letter codes that are NOT crypto */
    var FOREX_BASES = ['EUR', 'GBP', 'USD', 'JPY', 'AUD', 'CAD', 'CHF', 'NZD', 'XAU', 'XAG'];

    function resolveSymbol(raw) {
      var s = raw.toUpperCase().replace('/', '').replace('-', '').replace(' ', '');
      /* Already a full known forex pair */
      if (FOREX_FULL.includes(s)) return s;
      /* Known crypto shorthand */
      if (CRYPTO_AUTO[s]) return CRYPTO_AUTO[s];
      /* 6-char: check if it looks like a forex pair (base + quote both in FOREX_BASES) */
      if (s.length === 6) {
        var base = s.slice(0, 3);
        var quote = s.slice(3, 6);
        if (FOREX_BASES.includes(base) && FOREX_BASES.includes(quote)) return s; /* forex */
      }
      /* Already has a crypto quote suffix */
      var cryptoQuotes = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'BNB'];
      if (cryptoQuotes.some(function (q) { return s.endsWith(q) && s.length > q.length; })) return s;
      /* XAU/XAG with USD */
      if (s.startsWith('XAU') || s.startsWith('XAG')) return s.length === 3 ? s + 'USD' : s;
      /* 3-letter forex base typed alone → append USD */
      if (s.length === 3 && FOREX_BASES.includes(s) && s !== 'BTC' && s !== 'ETH' && s !== 'BNB') return s + 'USD';
      /* Default for unknown short → try USDT */
      if (s.length <= 5) return s + 'USDT';
      return s;
    }

    /* ── Coin suggestion list ── */
    var COIN_LIST = [
      'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT',
      'DOTUSDT', 'MATICUSDT', 'LINKUSDT', 'LTCUSDT', 'ATOMUSDT', 'NEARUSDT', 'UNIUSDT', 'AAVEUSDT',
      'ARBUSDT', 'OPUSDT', 'INJUSDT', 'SUIUSDT', 'APTUSDT', 'SEIUSDT', 'TIAUSDT', 'TONUSDT',
      'FETUSDT', 'RENDERUSDT', 'LDOUSDT', 'WLDUSDT', 'PENDLEUSDT', 'DYDXUSDT', 'GMXUSDT',
      'SHIBUSDT', 'PEPEUSDT', 'FLOKIUSDT', 'WIFUSDT', 'BONKUSDT',
      'FILUSDT', 'XLMUSDT', 'TRXUSDT', 'ETCUSDT', 'ICPUSDT', 'HBARUSDT', 'VETUSDT', 'ALGOUSDT',
      'SANDUSDT', 'MANAUSDT', 'AXSUSDT', 'GALAUSDT', 'CHZUSDT', 'GRTUSDT',
      'CRVUSDT', 'COMPUSDT', 'MKRUSDT', 'SNXUSDT', 'SUSHIUSDT', 'YFIUSDT',
      'QNTUSDT', 'FTMUSDT', 'ZILUSDT', 'ONEUSDT', 'IOSTUSDT',
      'BTCUSDC', 'ETHUSDC', 'SOLUSDC', 'XRPUSDC', 'BNBUSDC',
      'ETHUSD', 'BTCUSD', 'GOLD', 'SILVER', 'EURUSD', 'GBPUSD', 'JPYUSD'
    ];

    function selectPair(sym) {
      currentDataSource = 'twelvedata'; /* reset to default source */
      var inp = document.getElementById('pairIn');
      if (inp) inp.value = sym;

      /* In multi-layout mode just forward */
      if (typeof activeIframeId !== 'undefined' && activeIframeId !== null && !isEmbedded) {
        var iframe = document.getElementById(activeIframeId);
        if (iframe && iframe.contentWindow)
          iframe.contentWindow.postMessage({ type: 'setPair', symbol: sym }, '*');
        return;
      }

      loadChart(sym, document.getElementById('tfIn') ? document.getElementById('tfIn').value : '4h');
    }

    var _searchDebounce = null;
    var _currentSearchType = '';

    function openSearchModal() {
      var mod = document.getElementById('searchModal');
      if (mod) {
        mod.style.display = 'flex';
        var inp = document.getElementById('searchInputReal');
        if (inp) {
          inp.value = '';
          _currentSearchType = '';
          document.querySelectorAll('.s-tab').forEach(function (tt) { tt.classList.remove('s-tab-active'); });
          var allTab = document.querySelector('.s-tab[data-type=""]');
          if (allTab) allTab.classList.add('s-tab-active');
          executeSearch();
          setTimeout(function () { inp.focus(); }, 100);
        }
      }
    }

    function closeSearchModal() {
      var mod = document.getElementById('searchModal');
      if (mod) mod.style.display = 'none';
    }

    document.addEventListener('keydown', function (e) {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        openSearchModal();
      }
      if (e.key === 'Escape') closeSearchModal();
    });

    document.addEventListener('DOMContentLoaded', function () {
      // Bind tabs
      var tabs = document.querySelectorAll('.s-tab');
      tabs.forEach(function (t) {
        t.addEventListener('click', function () {
          tabs.forEach(function (tt) { tt.classList.remove('s-tab-active'); });
          t.classList.add('s-tab-active');
          _currentSearchType = t.getAttribute('data-type');
          executeSearch();
        });
      });

      // Bind input
      var inp = document.getElementById('searchInputReal');
      if (inp) {
        inp.addEventListener('input', function () {
          clearTimeout(_searchDebounce);
          _searchDebounce = setTimeout(executeSearch, 350);
        });
      }

      // Close modal when clicking outside
      document.addEventListener('mousedown', function (e) {
        var mod = document.getElementById('searchModal');
        if (mod && mod.style.display === 'flex' && e.target === mod) {
          closeSearchModal();
        }
      });
    });

    function executeSearch() {
      var inp = document.getElementById('searchInputReal');
      var query = inp ? inp.value.trim() : '';
      var resDiv = document.getElementById('searchResults');
      if (!resDiv) return;

      var loadingHtml = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.5)">Searching...</div>';
      resDiv.innerHTML = loadingHtml;

      // Intelligently feed default results when the search bar is empty based on the tab chosen
      if (query.length === 0) {
        if (_currentSearchType === 'Physical Currency') query = 'USD';
        else if (_currentSearchType === 'Commodity') query = 'GOLD';
        else if (_currentSearchType === 'Index') query = 'US';
        else if (_currentSearchType === 'Digital Currency') query = 'BTC';
        else if (_currentSearchType === 'Common Stock') query = 'A';
        else if (_currentSearchType === 'ETF') query = 'SPY';
        else if (_currentSearchType === 'Mutual Fund') query = 'VFIAX';
        else query = 'XAU';
      }

      var url = BACKEND_URL + '/search?q=' + encodeURIComponent(query);

      fetch(url)
        .then(function (r) { return r.json(); })
        .then(function (d) {
          var results = d.data || [];
          if (_currentSearchType) {
            results = results.filter(function (r) {
              return r.instrument_type === _currentSearchType;
            });
          }
          if (results.length === 0) {
            resDiv.innerHTML = '<div style="padding:24px;text-align:center;color:rgba(255,255,255,0.3)">No symbols found.</div>';
            return;
          }
          resDiv.innerHTML = results.map(function (r) {
            var sym = r.symbol;
            if (r.currency && sym.indexOf(r.currency) === -1 && r.instrument_type === 'Physical Currency') sym += r.currency;
            var isOanda = r.source === 'oanda';
            var isBinance = r.source === 'binance';
            var isCapital = r.source === 'capital';
            var isCrypto = r.instrument_type === 'Digital Currency';
            var onclick = isOanda
              ? "selectPairWithSource('" + sym + "','oanda');closeSearchModal()"
              : isBinance
                ? "selectPairWithSource('" + sym + "','binance');closeSearchModal()"
                : isCapital
                  ? "selectPairWithSource('" + sym + "','capital');closeSearchModal()"
                  : "selectPair('" + sym + "');closeSearchModal()";
            /* Source badge — check OANDA first so crypto from OANDA gets OANDA badge */
            var badge;
            if (isOanda) {
              badge = '<span style="display:inline-flex;align-items:center;gap:3px;background:#00274d;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px;letter-spacing:0.4px">'
                + '<span style="color:#00c896;font-size:12px;line-height:1">✓</span>OANDA</span>';
            } else if (isCapital) {
              badge = '<span style="display:inline-flex;align-items:center;gap:3px;background:linear-gradient(135deg, #c9a84c, #9a7a2e);color:#0a0c12;font-size:10px;font-weight:800;padding:2px 7px;border-radius:3px;letter-spacing:0.5px">'
                + '<span style="color:#fff;font-size:11px;line-height:1">✦</span>CAPITAL</span>';
            } else if (isCrypto) {
              badge = '<span style="display:inline-flex;align-items:center;gap:3px;background:#F3BA2F;color:#1a1a1a;font-size:10px;font-weight:700;padding:2px 7px;border-radius:3px;letter-spacing:0.4px">'
                + '<svg width="9" height="9" viewBox="0 0 24 24" fill="#1a1a1a" style="flex-shrink:0"><path d="M12 0L7.5 4.5 12 9l4.5-4.5L12 0zM3 9l-3 3 3 3 3-3-3-3zm18 0l-3 3 3 3 3-3-3-3zM7.5 13.5 12 18l4.5-4.5L12 9l-4.5 4.5zM12 15l-3 3 3 3 3-3-3-3z"/></svg>'
                + 'BINANCE</span>';
            } else {
              badge = '<span style="display:inline-flex;align-items:center;background:#1e1e1e;color:#fff;font-size:10px;padding:2px 7px;border-radius:3px">'
                + '<span style="font-weight:700">twelve</span><span style="font-weight:400;color:rgba(255,255,255,0.55)">data</span></span>';
            }
            var isSelected = (sym === currentSymbol || sym.replace('/', '') === currentSymbol)
              && (isOanda ? currentDataSource === 'oanda' : isCapital ? currentDataSource === 'capital' : currentDataSource !== 'oanda' && currentDataSource !== 'capital');
            return '<div class="s-res-item' + (isSelected ? ' s-res-active' : '') + '" onclick="' + onclick + '">'
              + '<div class="s-res-info" style="min-width:0">'
              + '<div class="s-res-symbol">' + sym + '</div>'
              + '<div class="s-res-name" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + (r.instrument_name || '') + '</div>'
              + '</div>'
              + '<div class="s-res-meta">'
              + '<span>' + (r.instrument_type || '').replace('Common Stock', 'Stock').replace('Physical Currency', 'Forex').replace('Digital Currency', 'Crypto').replace('Commodity', 'Commodity').replace('Index', 'Index') + '</span>'
              + badge
              + '</div>'
              + '</div>';
          }).join('');
        }).catch(function () {
          resDiv.innerHTML = '<div style="padding:24px;text-align:center;color:#ef5350">Error fetching results.</div>';
        });
    }

    function selectPairWithSource(symbol, source) {
      currentDataSource = source || 'twelvedata';
      var p = document.getElementById('pairIn'); if (p) p.value = symbol;
      loadChart(symbol, document.getElementById('tfIn') ? document.getElementById('tfIn').value : '4h');
    }

    function quickLoad(symbol) {
      var p = document.getElementById('pairIn'); if (p) p.value = symbol;
      loadChart(symbol, document.getElementById('tfIn') ? document.getElementById('tfIn').value : '4h');
    }

    function showLivePrice(d) {
      var bar = document.getElementById('livePriceBar'), val = document.getElementById('livePriceVal');
      var chg = document.getElementById('livePriceChange'), meta = document.getElementById('livePriceMeta');
      if (!bar || !val) return;
      bar.classList.add('show');
      val.textContent = formatPrice(parseFloat(d.price));
      val.style.color = parseFloat(d.change_24h || 0) >= 0 ? '#27ae60' : '#ef5350';
      if (chg) { chg.textContent = (parseFloat(d.change_24h || 0) >= 0 ? '+' : '') + parseFloat(d.change_24h || 0).toFixed(3) + '%'; chg.style.color = val.style.color; }
      if (meta) meta.textContent = 'LIVE · ' + d.symbol;
    }
    function hideLivePrice() { var b = document.getElementById('livePriceBar'); if (b) b.classList.remove('show'); }

    function _updateSrcSwitch(sym) {
      var sw = document.getElementById('srcSwitch');
      if (!sw) return;
      if (_OANDA_SYMBOLS.has(sym)) {
        sw.classList.add('show');
        currentDataSource = 'capital';
      } else {
        sw.classList.remove('show');
        currentDataSource = 'twelvedata';
      }
      document.getElementById('srcBtnTD').classList.toggle('active', currentDataSource === 'twelvedata');
      document.getElementById('srcBtnOanda').classList.toggle('active', currentDataSource === 'oanda');
    }

    function setDataSource(src) {
      if (currentDataSource === src) return;
      currentDataSource = src;
      document.getElementById('srcBtnTD').classList.toggle('active', src === 'twelvedata');
      document.getElementById('srcBtnOanda').classList.toggle('active', src === 'capital' || src === 'oanda');
      /* Reload chart with new source */
      if (currentSymbol) loadChart(currentSymbol, currentInterval);
    }

    /* ── Live price polling — direct Binance every 5s ── */
    var _pricePollerTimer = null;
    function stopPricePolling() { if (_pricePollerTimer) { clearInterval(_pricePollerTimer); _pricePollerTimer = null; } }
    function startPricePolling(sym) {
      /* Binance direct polling removed — price comes via SSE from server */
      stopPricePolling();
    }

    function showCapturePrompt() {
      var overlay = document.getElementById('capturePrompt');
      if (overlay) { overlay.style.display = 'flex'; return; }
      overlay = document.createElement('div');
      overlay.id = 'capturePrompt';
      overlay.style.cssText = 'position:fixed;inset:0;background:rgba(6,8,13,.92);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px;padding:32px';
      overlay.innerHTML = '<div style="font-family:Cinzel,serif;font-size:16px;color:#f0f4fa;letter-spacing:.08em">No chart loaded</div>'
        + '<div style="font-size:13px;color:#8a95a8;text-align:center;max-width:360px;line-height:1.6">Type a pair to load a live chart, or upload a screenshot.</div>'
        + '<div style="display:flex;gap:12px"><label style="font-family:DM Mono,monospace;font-size:11px;padding:10px 20px;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.3);color:#c9a84c;cursor:pointer">📁 UPLOAD<input type="file" accept="image/*" style="display:none" onchange="handleCaptureUpload(this)"></label>'
        + '<button onclick="closeCapturePrompt()" style="font-family:DM Mono,monospace;font-size:11px;padding:10px 20px;background:transparent;border:1px solid rgba(138,149,168,.3);color:#8a95a8;cursor:pointer">CANCEL</button></div>';
      (document.fullscreenElement || document.body).appendChild(overlay);
    }
    function closeCapturePrompt() { var o = document.getElementById('capturePrompt'); if (o) o.style.display = 'none'; window._pendingTool = null; }
    function runPendingTool() { if (window._pendingTool) { var t = window._pendingTool; window._pendingTool = null; if (dataUrl) executeTool(t, dataUrl); } }
    function handleCaptureUpload(input) {
      if (!input.files || !input.files[0]) return;
      var r = new FileReader();
      r.onload = function (e) { dataUrl = e.target.result; var o = document.getElementById('capturePrompt'); if (o) o.style.display = 'none'; runPendingTool(); };
      r.readAsDataURL(input.files[0]);
    }

    function executeTool(tool, imgData, candlePayload) {
      var btn = document.getElementById('tbtn-' + tool.id);
      function resetCard(stateIcon, stateColor) {
        if (!btn) return;
        btn.innerHTML =
          '<div class="ai-tc-icon">' + tool.icon + '</div>' +
          '<div class="ai-tc-name">' + tool.label + '</div>' +
          '<div class="ai-tc-sub">' + tool.sub + '</div>' +
          '<div class="ai-tc-footer">' +
          '<span class="ai-tc-cr">' + tool.cost + ' cr</span>' +
          (!tierAllows(tool.id) ? '<span class="ai-tc-lock">🔒</span>' : '') +
          '</div>' +
          (stateIcon ? '<div class="ai-tc-state" style="color:' + stateColor + '">' + stateIcon + '</div>' : '');
      }
      if (!candlePayload && !imgData) { showErr('Load a chart first'); return; }
      if (imgData) dataUrl = imgData;
      if (btn) { btn.setAttribute('disabled', true); resetCard('…', 'rgba(201,168,76,.8)'); }

      /* Show spinner on the tool-result-hd row + auto-open panel */
      var _statusEl = document.getElementById(tool.id + '-status');
      var _bodyEl = document.getElementById(tool.id + '-body');
      var _chevEl = document.getElementById(tool.id + '-chev');
      var _runBtn = document.getElementById(tool.id + '-btn');
      if (_statusEl) { _statusEl.style.display = 'flex'; _statusEl.className = 'ud-sec-status'; _statusEl.innerHTML = '<div class="ud-spin"></div>'; }
      if (_bodyEl && !_bodyEl.classList.contains('open')) { _bodyEl.classList.add('open'); if (_chevEl) _chevEl.classList.add('open'); }
      if (_runBtn) _runBtn.disabled = true;

      var pair = currentSymbol || (document.getElementById('pairIn') || {}).value || '';
      var token = localStorage.getItem('fractal_token');
      var langVal = localStorage.getItem('fractal_lang') || 'en';
      var _smaCtx = (typeof smaContextStr !== 'undefined') ? smaContextStr : '';
      var _ep_payload = candlePayload
        ? Object.assign({ pair: pair, timeframe: currentInterval, language: langVal, _token: token }, candlePayload)
        : (function () { var b64 = imgData.split(',')[1], mType = imgData.split(';')[0].split(':')[1]; return { image: b64, mediaType: mType, pair: pair, timeframe: currentInterval, language: langVal, _token: token, sma_context: _smaCtx }; })();
      if (tool.id === 'vol') { _ep_payload.account_size = parseFloat((document.getElementById('vol-acct') || {}).value) || 10000; _ep_payload.risk_pct = parseFloat((document.getElementById('vol-risk') || {}).value) || 1; }
      if (tool.id === 'journal') { _ep_payload.trade_notes = (document.getElementById('journal-notes') || {}).value; _ep_payload.outcome = (document.getElementById('journal-outcome') || {}).value; _ep_payload.pnl = (document.getElementById('journal-pnl') || {}).value; }
      callBackend(tool.endpoint, _ep_payload)
        .then(function (result) {
          if (result && result.error) {
            showErr(result.error);
            if (btn) btn.removeAttribute('disabled'); resetCard('', '');
            if (_statusEl) { _statusEl.style.display = 'none'; }
            if (_runBtn) _runBtn.disabled = false;
            return;
          }
          drawToolResultOnChart(tool.id, result);
          if (tool.id === 'backtest' && typeof renderBacktest === 'function') {
            renderBacktest(result);
            if (btn) btn.removeAttribute('disabled'); resetCard('\u2713', '#27ae60');
            if (_statusEl) { _statusEl.className = 'ud-sec-status ud-done'; _statusEl.innerHTML = '\u2713 Done'; }
            if (_runBtn) _runBtn.disabled = false;
            setTimeout(function () { resetCard('', ''); if (_statusEl) { _statusEl.style.display = 'none'; _statusEl.innerHTML = '<div class="ud-spin"></div>'; } }, 4000);
            return;
          }
          if (tool.id === 'fib' && typeof renderFibonacci === 'function') renderFibonacci(result);
          else if (tool.id === 'smc' && typeof renderSMC === 'function') renderSMC(result);
          else if (tool.id === 'proj' && typeof renderProjection === 'function') renderProjection(result);
          else if (tool.id === 'vol' && typeof renderVolatility === 'function') renderVolatility(result);
          else if (tool.id === 'mtf' && typeof renderMTF === 'function') renderMTF(result);
          else if (tool.id === 'age' && typeof renderFractalAge === 'function') renderFractalAge(result);
          else if (tool.id === 'liq' && typeof renderLiquidity === 'function') renderLiquidity(result);
          else if (tool.id === 'journal' && typeof renderJournal === 'function') renderJournal(result);
          else if (tool.id === 'sniper' && typeof renderSniper === 'function') renderSniper(result);
          var ud = document.getElementById('uniDash'); if (ud) ud.style.display = 'flex';
          var re = document.getElementById('rEmpty2'); if (re) re.style.display = 'none';
          if (btn) btn.removeAttribute('disabled');
          resetCard('✓', '#27ae60');
          /* Update status to Done and scroll result into view */
          if (_statusEl) { _statusEl.className = 'ud-sec-status ud-done'; _statusEl.innerHTML = '✓ Done'; }
          if (_runBtn) _runBtn.disabled = false;
          var _sec = document.getElementById('sec-' + tool.id);
          if (_sec) setTimeout(function () { _sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }, 120);
          setTimeout(function () {
            resetCard('', '');
            if (_statusEl) { _statusEl.style.display = 'none'; _statusEl.innerHTML = '<div class="ud-spin"></div>'; }
          }, 4000);
        })
        .catch(function (e) {
          showErr(tool.label + ' failed: ' + e.message);
          if (btn) btn.removeAttribute('disabled');
          resetCard('', '');
          if (_statusEl) { _statusEl.style.display = 'flex'; _statusEl.className = 'ud-sec-status'; _statusEl.style.color = '#e74c3c'; _statusEl.innerHTML = '✗ Failed'; }
          if (_runBtn) _runBtn.disabled = false;
          setTimeout(function () {
            if (_statusEl) { _statusEl.style.display = 'none'; _statusEl.style.color = ''; _statusEl.innerHTML = '<div class="ud-spin"></div>'; }
          }, 4000);
        });
    }

    function runSingleTool(tool) {
      /* Backtest uses ALL loaded candles, not just the visible slice */
      if (tool.id === 'backtest') {
        if (!chartCandles || chartCandles.length < 170) {
          showErr('Load a chart first \u2014 need at least 170 candles for backtest.'); return;
        }
        executeTool(tool, null, { candles: chartCandles, options: { minConfidence: 50 } });
        return;
      }
      if (chartCandles && chartCandles.length >= 2) {
        captureAndStore();
        var _sBars = Math.max(20, Math.floor(chartCandles.length / chartView.zoom));
        var _sStart = Math.max(0, chartCandles.length - _sBars - chartView.offset);
        var _sEnd = Math.min(chartCandles.length, _sStart + _sBars);
        var _sVisC = chartCandles.slice(_sStart, _sEnd);
        if (_sVisC.length > 300) _sVisC = _sVisC.slice(_sVisC.length - 300);
        var _sPMin = Math.min.apply(null, _sVisC.map(function (c) { return c.l; }));
        var _sPMax = Math.max.apply(null, _sVisC.map(function (c) { return c.h; }));
        var _sRng = _sPMax - _sPMin;
        _sPMin -= _sRng * 0.05; _sPMax += _sRng * 0.05;
        window._lastVisiblePriceMin = _sPMin;
        window._lastVisiblePriceMax = _sPMax;
        window._lastVisibleCandleCount = _sVisC.length;
        executeTool(tool, dataUrl, { candles: _sVisC, priceMin: _sPMin, priceMax: _sPMax });
      } else {
        var img = captureForTool();
        if (!img) { showErr('Load a chart first — type a pair or upload a screenshot.'); return; }
        executeTool(tool, img, null);
      }
    }


    function buildDropdown(symbols) {
      removeDropdown();
      var inp = document.getElementById('pairIn');
      if (!inp) return;
      inp.parentNode.style.position = 'relative';
      var dd = document.createElement('div');
      dd.id = 'pairDD';
      dd.style.cssText = 'position:absolute;top:100%;left:0;min-width:180px;z-index:9999;background:#131720;border:1px solid rgba(201,168,76,.3);border-top:none;max-height:240px;overflow-y:auto;box-shadow:0 12px 32px rgba(0,0,0,.6)';
      symbols.forEach(function (sym) {
        var row = document.createElement('div');
        row.textContent = sym;
        row.style.cssText = 'padding:7px 12px;font-family:DM Mono,monospace;font-size:11px;color:#dde4ee;cursor:pointer;border-bottom:1px solid rgba(255,255,255,.04)';
        row.onmouseover = function () { this.style.background = 'rgba(201,168,76,.1)'; this.style.color = '#c9a84c'; };
        row.onmouseout = function () { this.style.background = ''; this.style.color = '#dde4ee'; };
        row.onmousedown = function (e) {
          e.preventDefault();
          inp.value = sym;
          removeDropdown();
          loadChart(sym, document.getElementById('tfIn') ? document.getElementById('tfIn').value || '4h' : '4h');
        };
        dd.appendChild(row);
      });
      inp.parentNode.appendChild(dd);
    }

    function removeDropdown() { var d = document.getElementById('pairDD'); if (d) d.remove(); }
    document.addEventListener('click', function (e) { if (e.target && e.target.id !== 'pairIn') removeDropdown(); });

    /* init on load */
    window.addEventListener('load', function () {
      setTimeout(function () { drawMW(); }, 100);
      buildToolGrid();
      resizeCanvas();
    });
    window.addEventListener('resize', function () {
      if (document.getElementById('smp0').classList.contains('active')) drawMW();
      if (document.getElementById('smp1').classList.contains('active')) drawMTS();
      if (document.getElementById('smp2').classList.contains('active')) drawMF();
    });

    (function () {
      'use strict';

      /* ══ SHARED PAD — must match renderChart exactly ══ */
      var PAD = { l: 8, r: 75, t: 16, b: 56, vol: 40 };

      /* ── SVG icons ── */
      function S(p, vb) { return '<svg width="16" height="16" viewBox="' + (vb || '0 0 16 16') + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + p + '</svg>'; }

      /* ── Tool groups ── */
      var GROUPS = [
        /* ── Cursor ── */
        {
          id: 'cursor', icon: S('<path d="M3 2l9 6-4 1-1.5 5z" fill="currentColor" stroke="none"/>'), tooltip: 'Cursor',
          items: [
            { id: 'cursor', label: 'Cross cursor', icon: S('<line x1="8" y1="1" x2="8" y2="15"/><line x1="1" y1="8" x2="15" y2="8"/>'), cur: 'crosshair' },
            { id: 'dot', label: 'Dot cursor', icon: S('<circle cx="8" cy="8" r="3.5" fill="currentColor" stroke="none"/>'), cur: 'crosshair' },
            { id: 'arrow_cur', label: 'Arrow cursor', icon: S('<path d="M3 2l9 6-4 1-1.5 5z" fill="currentColor" stroke="none"/>'), cur: 'default' },
          ]
        },
        'sep',
        /* ── Lines ── */
        {
          id: 'lines_grp', icon: S('<line x1="2" y1="13" x2="14" y2="3"/><circle cx="2" cy="13" r="1.8" fill="currentColor" stroke="none"/><circle cx="14" cy="3" r="1.8" fill="currentColor" stroke="none"/>'), tooltip: 'Lines',
          items: [
            { id: 'trendline', label: 'Trend Line', icon: S('<line x1="2" y1="13" x2="14" y2="3"/><circle cx="2" cy="13" r="1.8" fill="currentColor" stroke="none"/><circle cx="14" cy="3" r="1.8" fill="currentColor" stroke="none"/>'), cur: 'crosshair', points: 2 },
            { id: 'ray', label: 'Ray', icon: S('<line x1="2" y1="11" x2="15" y2="4"/><circle cx="2" cy="11" r="1.8" fill="currentColor" stroke="none"/><path d="M13 3l3 1-1 3"/>'), cur: 'crosshair', points: 2, ray: true },
            { id: 'extline', label: 'Extended Line', icon: S('<line x1="1" y1="8" x2="15" y2="8"/><path d="M2 6l-2 2 2 2"/><path d="M14 6l2 2-2 2"/>'), cur: 'crosshair', points: 2, extended: true },
            { id: 'infoline', label: 'Trend Angle', icon: S('<line x1="2" y1="13" x2="14" y2="5"/><path d="M2 13 a5 5 0 0 1 4.5-4"/><text x="7" y="15" font-size="6" fill="currentColor" stroke="none">°</text>'), cur: 'crosshair', points: 2, angle: true },
            { id: 'hline', label: 'Horizontal Line', icon: S('<line x1="1" y1="8" x2="15" y2="8"/>'), cur: 'crosshair', hline: true },
            { id: 'hray', label: 'Horizontal Ray', icon: S('<line x1="1" y1="8" x2="15" y2="8"/><path d="M14 6l2 2-2 2"/>'), cur: 'crosshair', hline: true, ray: true },
            { id: 'vline', label: 'Vertical Line', icon: S('<line x1="8" y1="1" x2="8" y2="15"/>'), cur: 'crosshair', vline: true },
          ]
        },
        /* ── Channels ── */
        {
          id: 'channels_grp', icon: S('<line x1="2" y1="5" x2="14" y2="8"/><line x1="2" y1="10" x2="14" y2="13"/>'), tooltip: 'Channels',
          items: [
            { id: 'parallel', label: 'Parallel Channel', icon: S('<line x1="2" y1="4" x2="14" y2="7"/><line x1="2" y1="9" x2="14" y2="12"/>'), cur: 'crosshair', points: 2, channel: 'parallel' },
            { id: 'flattop', label: 'Flat Top/Bottom', icon: S('<line x1="2" y1="4" x2="14" y2="4"/><line x1="2" y1="11" x2="14" y2="7"/>'), cur: 'crosshair', points: 2, channel: 'flat' },
          ]
        },
        /* ── Shapes ── */
        {
          id: 'shapes_grp', icon: S('<rect x="2" y="5" width="12" height="8" rx="1"/>'), tooltip: 'Shapes',
          items: [
            { id: 'rect', label: 'Rectangle', icon: S('<rect x="2" y="5" width="12" height="8" rx="1"/>'), cur: 'crosshair', points: 2, shape: 'rect' },
            { id: 'ellipse', label: 'Ellipse', icon: S('<ellipse cx="8" cy="8" rx="6" ry="4.5"/>'), cur: 'crosshair', points: 2, shape: 'ellipse' },
            { id: 'triangle', label: 'Triangle', icon: S('<path d="M8 2l7 12H1z"/>'), cur: 'crosshair', points: 2, shape: 'triangle' },
            { id: 'gannbox', label: 'Gann Box', icon: S('<rect x="2" y="2" width="12" height="12" fill="none"/><line x1="2" y1="2" x2="14" y2="14"/><line x1="14" y1="2" x2="2" y2="14"/>'), cur: 'crosshair', points: 2, shape: 'gannbox' },
            { id: 'arrow', label: 'Arrow Line', icon: S('<line x1="3" y1="13" x2="13" y2="3"/><path d="M13 3l-5 1.5 1.5-5z" fill="currentColor" stroke="none"/>'), cur: 'crosshair', points: 2, arrowline: true },
          ]
        },
        /* ── Annotations ── */
        {
          id: 'annot_grp', icon: S('<text x="3" y="13" font-size="12" font-family="serif" fill="currentColor" stroke="none" font-weight="bold">A</text>'), tooltip: 'Annotations',
          items: [
            { id: 'arrowup', label: 'Arrow Up mark', icon: S('<line x1="8" y1="13" x2="8" y2="4"/><path d="M4 7l4-4 4 4" fill="none"/>'), cur: 'crosshair', arrowmark: true, dir: 'up' },
            { id: 'arrowdn', label: 'Arrow Down mark', icon: S('<line x1="8" y1="3" x2="8" y2="12"/><path d="M4 9l4 4 4-4" fill="none"/>'), cur: 'crosshair', arrowmark: true, dir: 'down' },
            { id: 'text', label: 'Text label', icon: S('<text x="4" y="13" font-size="13" font-family="serif" fill="currentColor" stroke="none" font-weight="bold">T</text>'), cur: 'text', textdraw: true },
            { id: 'callout', label: 'Callout box', icon: S('<rect x="2" y="2" width="10" height="8" rx="1"/><path d="M4 10l2 4 3-4"/>'), cur: 'text', textdraw: true, callout: true },
            { id: 'barpattern', label: 'Bar Pattern', icon: S('<rect x="2" y="5" width="3" height="8"/><rect x="6.5" y="3" width="3" height="10"/><rect x="11" y="6" width="3" height="6"/><line x1="3.5" y1="3" x2="3.5" y2="5"/><line x1="3.5" y1="13" x2="3.5" y2="15"/><line x1="8" y1="1" x2="8" y2="3"/><line x1="8" y1="13" x2="8" y2="15"/>'), cur: 'crosshair', points: 2, barpattern: true },
          ]
        },
        'sep',
        /* ── Overlays ── */
        {
          id: 'overlays_grp', overlaysgroup: true,
          icon: S('<rect x="2" y="3" width="12" height="2" rx="0.5" opacity=".9"/><rect x="2" y="7" width="12" height="2" rx="0.5" opacity=".65"/><rect x="2" y="11" width="12" height="2" rx="0.5" opacity=".4"/>'),
          tooltip: 'Chart Overlays',
          items: [
            { id: 'vpvr', label: 'Volume Profile (VPVR)', icon: S('<rect x="9" y="3" width="5" height="2" rx="0.5"/><rect x="6" y="6" width="8" height="2" rx="0.5"/><rect x="4" y="9" width="10" height="2" rx="0.5"/><rect x="7" y="12" width="6" height="2" rx="0.5"/>'), toggle: true, vpvrtool: true, getState: function () { return vpvrOn; } },
            { id: 'liqheatmap', label: 'Liquidity Heatmap', icon: S('<rect x="2" y="3" width="12" height="2" rx="0.4" fill="rgba(239,83,80,0.85)"/><rect x="2" y="7" width="12" height="2" rx="0.4" fill="rgba(201,168,76,0.7)"/><rect x="2" y="11" width="12" height="2" rx="0.4" fill="rgba(38,166,154,0.85)"/>'), toggle: true, liqheatmaptool: true, getState: function () { return liqHeatmapOn; } },
            { id: 'volbubbles', label: 'Volume Bubbles', icon: S('<ellipse cx="8" cy="5.5" rx="5.5" ry="3.2" fill="rgba(38,166,154,0.75)" stroke="rgba(38,166,154,1)" stroke-width="0.6"/><ellipse cx="8" cy="10.5" rx="5.5" ry="3.2" fill="rgba(239,83,80,0.75)" stroke="rgba(239,83,80,1)" stroke-width="0.6"/>'), toggle: true, volbubblestool: true, getState: function () { return volBubblesOn; } },
            { id: 'macascade', label: 'Fractal Geometry', icon: S('<line x1="2" y1="4" x2="14" y2="4" stroke-width="1" opacity=".9"/><line x1="3" y1="10" x2="9" y2="7" stroke-width="1"/><line x1="9" y1="7" x2="14" y2="7" stroke-width="0.9" stroke-dasharray="2 2" opacity=".75"/><line x1="3" y1="13" x2="8" y2="11" stroke-width="0.9" opacity=".6"/><line x1="8" y1="11" x2="14" y2="11" stroke-width="0.8" stroke-dasharray="2 2" opacity=".5"/>'), toggle: true, macascadetool: true, getState: function () { return maCascadeOn; } },
          ]
        },
        /* ── Quantitative Analysis ── */
        {
          id: 'quant_grp', quantgroup: true,
          icon: S('<path d="M2 12 Q5 5 8 9 Q11 13 14 4" stroke-width="1.5" fill="none"/><circle cx="14" cy="4" r="1.5" fill="currentColor" stroke="none"/>'),
          tooltip: 'Quantitative Analysis',
          items: [
            { id: 'hurst', label: 'Hurst Exponent', icon: S('<path d="M2 12 L5 4 L8 9 L11 4 L14 9" stroke-width="1.5" fill="none"/>'), toggle: true, hursttool: true, getState: function () { return hurstOn; } },
            { id: 'garch', label: 'GARCH Volatility Bands', icon: S('<path d="M2 4 Q8 2.5 14 4" stroke-width="1.5"/><path d="M2 12 Q8 13.5 14 12" stroke-width="1.5"/><path d="M2 8 Q8 8 14 8" stroke-width="1" stroke-dasharray="3 2" opacity=".6"/>'), toggle: true, garchbandstool: true, getState: function () { return garchBandsOn; } },
            { id: 'fractalsig', label: 'Fractal Signal Score', icon: S('<circle cx="8" cy="10" r="5" stroke-width="1.2"/><path d="M8 10 L11 6" stroke-width="1.5"/><path d="M3.4 12.5 A5 5 0 0 1 12.6 12.5" stroke-width="1" stroke-dasharray="1.5 2" opacity=".6"/>'), toggle: true, fractalsignaltool: true, getState: function () { return fractalSignalOn; } },
            { id: 'kalman', label: 'Kalman Filter', icon: S('<path d="M2 11 Q5 9 8 7 Q11 5 14 4" stroke-width="1.5" fill="none"/><path d="M2 13 Q5 11 8 9 Q11 7 14 6" stroke-width="0.8" stroke-dasharray="2 2" opacity=".5" fill="none"/><path d="M2 9 Q5 7 8 5 Q11 3 14 2" stroke-width="0.8" stroke-dasharray="2 2" opacity=".5" fill="none"/>'), toggle: true, kalmantool: true, getState: function () { return kalmanOn; } },
            { id: 'fractalpaths', label: 'Fractal Specialized Paths', icon: S('<path d="M2 8 L8 8 L14 4 M8 8 L14 12" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>'), toggle: true, fractalpathstool: true, getState: function () { return fractalPathsOn; } },
          ]
        },
        /* ── Stochastic Models ── */
        {
          id: 'stoch_grp', stochgroup: true,
          icon: S('<path d="M2 10 Q5 3 8 8 Q11 13 14 6" stroke-width="1.5" fill="none"/><path d="M2 8 L14 8" stroke-width="0.7" stroke-dasharray="2 2" opacity=".4"/>'),
          tooltip: 'Stochastic Models',
          items: [
            { id: 'gbm', label: 'Brownian Motion (GBM)', icon: S('<path d="M2 8 L6 8"/><line x1="6" y1="8" x2="13" y2="4" opacity=".9"/><line x1="6" y1="8" x2="13" y2="6" opacity=".7"/><line x1="6" y1="8" x2="13" y2="8" opacity=".5"/><line x1="6" y1="8" x2="13" y2="10" opacity=".7"/><line x1="6" y1="8" x2="13" y2="12" opacity=".9"/>'), toggle: true, gbmtool: true, getState: function () { return gbmOn; } },
            { id: 'ou', label: 'Ornstein-Uhlenbeck Process', icon: S('<line x1="2" y1="8" x2="14" y2="8" stroke-dasharray="3 2" opacity=".5"/><path d="M2 5 Q5 3 8 8 Q11 13 14 8" stroke-width="1.5" fill="none"/>'), toggle: true, outool: true, getState: function () { return ouOn; } },
          ]
        },
        'sep',
        /* ── Fibonacci ── */
        {
          id: 'fib_grp', icon: S('<line x1="2" y1="2" x2="14" y2="2"/><line x1="2" y1="6" x2="14" y2="6" opacity=".7"/><line x1="2" y1="10" x2="14" y2="10" opacity=".5"/><line x1="2" y1="14" x2="14" y2="14" opacity=".3"/><line x1="4" y1="2" x2="4" y2="14"/>'), tooltip: 'Fibonacci',
          items: [
            { id: 'fib', label: 'Fib Retracement', icon: S('<line x1="2" y1="2" x2="14" y2="2"/><line x1="2" y1="6" x2="14" y2="6" opacity=".7"/><line x1="2" y1="10" x2="14" y2="10" opacity=".4"/><line x1="4" y1="2" x2="4" y2="14"/>'), cur: 'crosshair', points: 2, fibtype: 'retrace' },
            { id: 'fibext', label: 'Fib Extension', icon: S('<line x1="2" y1="13" x2="14" y2="3"/><line x1="9" y1="2" x2="15" y2="2" stroke-dasharray="2 2"/><line x1="9" y1="5" x2="15" y2="5" stroke-dasharray="2 2"/>'), cur: 'crosshair', points: 2, fibtype: 'ext' },
            { id: 'fibcirc', label: 'Fib Circles', icon: S('<circle cx="6" cy="8" r="5"/><circle cx="6" cy="8" r="3"/><circle cx="6" cy="8" r="1.2" fill="currentColor" stroke="none"/>'), cur: 'crosshair', points: 2, fibtype: 'circle' },
            { id: 'fibfan', label: 'Fib Fan', icon: S('<line x1="2" y1="13" x2="14" y2="5"/><line x1="2" y1="13" x2="14" y2="8" opacity=".6"/><line x1="2" y1="13" x2="14" y2="11" opacity=".4"/>'), cur: 'crosshair', points: 2, fibtype: 'fan' },
            { id: 'fibspiral', label: 'Fib Spiral', icon: S('<path d="M8 8 m0-5 a5 5 0 0 1 5 5 a3.8 3.8 0 0 1-3.8 3.8 a2.9 2.9 0 0 1-2.9-2.9 a2.2 2.2 0 0 1 2.2-2.2"/>'), cur: 'crosshair', points: 2, fibtype: 'spiral' },
            { id: 'fibtimezones', label: 'Fib Time Zones', icon: S('<line x1="2" y1="3" x2="2" y2="13"/><line x1="5" y1="3" x2="5" y2="13" opacity=".8"/><line x1="9" y1="3" x2="9" y2="13" opacity=".6"/><line x1="14" y1="3" x2="14" y2="13" opacity=".4"/>'), cur: 'crosshair', points: 2, fibtype: 'timezones' },
            { id: 'fibspiral_fc', label: 'Spiral Forecasting', icon: S('<path d="M2 12 Q5 2 9 12" fill="none" stroke-width="1.3"/><path d="M2 12 Q8 1 15 12" fill="none" stroke-width="1" opacity=".6"/><circle cx="2" cy="12" r="1.5" fill="currentColor" stroke="none"/>'), cur: 'crosshair', points: 2, fibtype: 'spiral_forecast' },
            { id: 'fibfractal_spiral', label: 'Fractal Spiral Model', icon: S('<path d="M8 8 m0-5 a5 5 0 0 1 5 5 a3.8 3.8 0 0 1-3.8 3.8 a2.9 2.9 0 0 1-2.9-2.9" stroke-width="1.3"/><path d="M11.5 5 m0-2 a2 2 0 0 1 2 2 a1.5 1.5 0 0 1-1.5 1.5" stroke-width="1" opacity=".55"/>'), cur: 'crosshair', points: 2, fibtype: 'fractal_spiral' },
          ]
        },
        'sep',
        /* ── Brush / Draw ── */
        {
          id: 'brush_grp', icon: S('<path d="M2 13c3-3 5-7 8-9s4 2 2 4c-1 2-4 3-6 6c-1 1-2 2-3 2s-1-1-1-3z"/>'), tooltip: 'Draw',
          items: [
            { id: 'brush', label: 'Freehand draw', icon: S('<path d="M2 13c3-3 5-7 8-9s4 2 2 4c-1 2-4 3-6 6c-1 1-2 2-3 2s-1-1-1-3z"/>'), cur: 'crosshair', brush: true },
            { id: 'eraser2', label: 'Brush eraser', icon: S('<path d="M3 11l8-8 4 4-8 8z"/><line x1="3" y1="11" x2="11" y2="11"/>'), cur: 'cell', erbrush: true },
          ]
        },
        /* ── Measure / Zoom / Magnet ── */
        {
          id: 'measure_grp', measuregroup: true,
          icon: S('<path d="M2 12l12-8"/><path d="M2 12l2-2"/><path d="M14 4l-2 2"/><line x1="2" y1="14" x2="14" y2="14"/>'),
          tooltip: 'Measure & View',
          items: [
            { id: 'measure_t', label: 'Measure', icon: S('<path d="M2 12l12-8"/><path d="M2 12l2-2"/><path d="M14 4l-2 2"/><line x1="2" y1="14" x2="14" y2="14"/>'), measuretool: true },
            { id: 'zoom_t', label: 'Zoom In', icon: S('<circle cx="7" cy="7" r="4.5"/><line x1="10.5" y1="10.5" x2="14" y2="14"/><line x1="5" y1="7" x2="9" y2="7"/><line x1="7" y1="5" x2="7" y2="9"/>'), zoomtool: true },
            { id: 'magnet_t', label: 'Magnet snap', icon: S('<path d="M5 3a4 4 0 0 1 6 0v4a1 1 0 0 1-2 0V5a2 2 0 0 0-2 0v2a1 1 0 0 1-2 0z"/><path d="M4 11h8"/>'), toggle: true, magnettool: true, getState: function () { return magnetOn; } },
          ]
        },
        'sep',
        /* ── Undo / Redo / Erase ── */
        {
          id: 'edit_grp', icon: S('<path d="M3 8a6 6 0 1 1 1 6"/><path d="M3 4v4h4"/>'), tooltip: 'Edit / Undo / Erase',
          items: [
            { id: 'undo_i', label: 'Undo  (Ctrl+Z)', icon: S('<path d="M3 8a6 6 0 1 1 1 6"/><path d="M3 4v4h4"/>'), cur: 'default', undotool: true },
            { id: 'redo_i', label: 'Redo  (Ctrl+Y)', icon: S('<path d="M13 8a6 6 0 1 0-1 6"/><path d="M13 4v4h-4"/>'), cur: 'default', redotool: true },
            { id: 'ptreraser', label: 'Click to erase one', icon: S('<path d="M2 12l9-9 4 4-9 9z"/><line x1="2" y1="12" x2="12" y2="12"/>'), cur: 'crosshair', ptreraser: true },
            { id: 'eraser_all', label: 'Clear all drawings', icon: S('<path d="M2 12l9-9 4 4-9 9z"/><line x1="2" y1="12" x2="12" y2="12"/><path d="M9 3l4 4-7 7H2v-4z" fill="currentColor" opacity=".3"/>'), cur: 'default', erasertool: true },
            { id: 'clear_tools', label: 'Clear all tools', icon: S('<circle cx="8" cy="8" r="5.5" stroke-width="1.4"/><line x1="5.5" y1="5.5" x2="10.5" y2="10.5"/><line x1="10.5" y1="5.5" x2="5.5" y2="10.5"/>'), cur: 'default', clearalltools: true },
          ]
        },
      ];

      /* ── State ── */
      window.window.drawings = []; drawings = window.drawings; var drawings = window.drawings;
      var undoStack = []; /* snapshots for undo */
      var redoStack = []; /* snapshots for redo */
      var eraserActive = false;
      var activeTool = 'cursor';
      var activeItem = GROUPS[0].items[0];
      var isDrawing = false;
      var drawStart = null;
      var hoverPoint = null;
      var magnetOn = false;
      var lockedDraw = false;
      var isBrushing = false;
      var brushPath = [];
      var measuring = false;
      var measurePts = [];
      var brushColor = '#c9a84c'; /* default gold — changed by color picker */
      var BRUSH_COLORS = ['#c9a84c', '#ef5350', '#26a69a', '#ffffff'];
      var _bpDrag = null; /* {idx, point:'p1'|'p2'|'body', startX, startY, origP1, origP2} */
      var _bpClick1 = null; /* first click bar index for two-click bar pattern */
      var _drawDrag = null; /* {idx, point:'p1'|'p2'|'body', startX, startY, origP1, origP2} */

      /* ── Color picker swatch strip — injected below toolbar ── */
      function buildColorPicker() {
        var tb = document.getElementById('drawToolbar');
        if (!tb || document.getElementById('brushColorPicker')) return;
        var strip = document.createElement('div');
        strip.id = 'brushColorPicker';
        strip.style.cssText = 'display:none;flex-direction:column;align-items:center;gap:4px;padding:6px 0;border-top:1px solid rgba(255,255,255,.07)';
        BRUSH_COLORS.forEach(function (c) {
          var sw = document.createElement('button');
          sw.dataset.color = c;
          sw.style.cssText = 'width:18px;height:18px;border-radius:50%;background:' + c + ';border:2px solid transparent;cursor:pointer;flex-shrink:0;transition:border-color .15s';
          if (c === brushColor) sw.style.borderColor = 'rgba(255,255,255,.8)';
          sw.title = c;
          sw.onclick = function (e) {
            e.stopPropagation();
            brushColor = c;
            strip.querySelectorAll('button').forEach(function (b) { b.style.borderColor = 'transparent'; });
            sw.style.borderColor = 'rgba(255,255,255,.8)';
          };
          strip.appendChild(sw);
        });
        tb.appendChild(strip);
      }

      /* ── Build toolbar ── */
      function buildToolbar() {
        var tb = document.getElementById('drawToolbar');
        if (!tb) return;
        tb.innerHTML = '';
        GROUPS.forEach(function (g) {
          if (g === 'sep') {
            var s = document.createElement('div'); s.className = 'tb-sep'; tb.appendChild(s); return;
          }
          var wrap = document.createElement('div'); wrap.className = 'tb-group';
          var btn = document.createElement('button');
          btn.className = 'tb-main' + ((isActive(g) || (g.quantgroup && (hurstOn || garchBandsOn || fractalSignalOn || kalmanOn || fractalPathsOn)) || (g.stochgroup && (gbmOn || ouOn)) || (g.overlaysgroup && (vpvrOn || liqHeatmapOn || volBubblesOn || maCascadeOn || fractalOverlayOn)) || (g.measuregroup && (activeTool === 'measure' || magnetOn))) ? ' active' : '');
          btn.innerHTML = g.icon + ((!g.single && g.items && g.items.length > 1) ? '<span class="tb-arr"></span>' : '');

          if (g.single) {
            if (g.toggle) btn.classList.toggle('active', g.magnettool ? magnetOn : g.vpvrtool ? vpvrOn : g.liqheatmaptool ? liqHeatmapOn : g.volbubblestool ? volBubblesOn : lockedDraw);
            btn.title = g.tooltip;
            btn.onclick = function (e) { e.stopPropagation(); handleSingle(g); };
            var tip = document.createElement('div'); tip.className = 'tb-tooltip'; tip.textContent = g.tooltip;
            wrap.addEventListener('mouseenter', function () {
              var r = wrap.getBoundingClientRect();
              tip.style.top = (r.top + r.height / 2 - 9) + 'px'; tip.style.display = 'block';
            });
            wrap.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
            wrap.appendChild(btn); wrap.appendChild(tip);
          } else if (g.items && g.items.length === 1) {
            btn.onclick = function (e) { e.stopPropagation(); pickItem(g.items[0]); };
            var tip = document.createElement('div'); tip.className = 'tb-tooltip'; tip.textContent = g.items[0].label;
            wrap.addEventListener('mouseenter', function () {
              var r = wrap.getBoundingClientRect();
              tip.style.top = (r.top + r.height / 2 - 9) + 'px'; tip.style.display = 'block';
            });
            wrap.addEventListener('mouseleave', function () { tip.style.display = 'none'; });
            wrap.appendChild(btn); wrap.appendChild(tip);
          } else {
            btn.onclick = function (e) { e.stopPropagation(); pickItem(g._last || g.items[0]); };
            var fly = document.createElement('div'); fly.className = 'tb-flyout';
            var _flyTimer = null;
            function showFly() {
              clearTimeout(_flyTimer);
              var rect = wrap.getBoundingClientRect();
              var flyH = g.items.length * 32 + 8;
              var topPos = Math.min(rect.top, window.innerHeight - flyH - 8);
              /* Calculate left based on toolbar's actual screen position */
              var tbRect = document.getElementById('drawToolbar').getBoundingClientRect();
              fly.style.top = topPos + 'px';
              fly.style.left = (tbRect.right + 2) + 'px';
              fly.style.display = 'flex';
            }
            function hideFly() { _flyTimer = setTimeout(function () { fly.style.display = 'none'; }, 220); }
            wrap.addEventListener('mouseenter', showFly);
            wrap.addEventListener('mouseleave', hideFly);
            fly.addEventListener('mouseenter', function () { clearTimeout(_flyTimer); });
            fly.addEventListener('mouseleave', hideFly);
            fly.addEventListener('click', function () { clearTimeout(_flyTimer); });
            g.items.forEach(function (item) {
              var _itemActive = (activeItem && activeItem.id === item.id) || (item.getState && item.getState());
              var row = document.createElement('button'); row.className = 'tb-item' + (_itemActive ? ' active' : '');
              /* Fib Spiral — show $1 lock badge if not yet paid */
              var lockBadge = '';
              if (item.id === 'fibspiral') {
                lockBadge = '<span style="font-family:DM Mono,monospace;font-size:7px;color:var(--gold);background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.25);padding:1px 5px;border-radius:1px;margin-left:auto">$15/m</span>';
              }
              if (item.id === 'fibfractal_spiral') {
                lockBadge = '<span style="font-family:DM Mono,monospace;font-size:7px;color:var(--gold);background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.25);padding:1px 5px;border-radius:1px;margin-left:auto">$25/m</span>';
              }
              row.innerHTML = item.icon + '<span>' + item.label + '</span>' + lockBadge;
              row.onclick = function (e) { e.stopPropagation(); g._last = item; btn.innerHTML = item.icon + '<span class="tb-arr"></span>'; pickItem(item); };
              fly.appendChild(row);
            });
            wrap.appendChild(btn); wrap.appendChild(fly);
          }
          tb.appendChild(wrap);
        });
      }

      function isActive(g) {
        if (!activeItem || g.single) return false;
        if (g.items) return g.items.some(function (i) { return i.id === activeItem.id; });
        return false;
      }

      function pickItemById(id) {
        for (var g of GROUPS) {
          if (g === 'sep') continue;
          if (g.items) {
            for (var i of g.items) { if (i.id === id) { pickItem(i); return; } }
          } else {
            if (g.id === id) { pickItem(g); return; }
          }
        }
      }

      function pickItem(item) {
        /* MULTI-LAYOUT MASTER OVERRIDE: Forward generic tool commands to the active iframe */
        if (typeof activeIframeId !== 'undefined' && activeIframeId !== null && !isEmbedded) {
          var iframe = document.getElementById(activeIframeId);
          if (iframe && iframe.contentWindow) {
            iframe.contentWindow.postMessage({ type: 'setTool', toolId: item.id }, '*');
            activeTool = item.id; activeItem = item;
            // Rebuild parent toolbar so it VISUALLY appears selected on the Master window
            if (typeof buildToolbar === 'function') buildToolbar();
            return;
          }
        }

        /* Immediate-action tools — fire on toolbar click, don't become active tool */
        if (item.undotool) { doUndo(); return; }
        if (item.redotool) { doRedo(); return; }
        if (item.erasertool) { saveUndo(); window.drawings = []; drawings = window.drawings; renderChart && renderChart(); return; }
        if (item.clearalltools) { vpvrOn = liqHeatmapOn = volBubblesOn = hurstOn = garchBandsOn = fractalSignalOn = kalmanOn = gbmOn = ouOn = maCascadeOn = fractalPathsOn = fractalOverlayOn = false; fractalResult = null; buildToolbar(); renderChart && renderChart(); return; }

        /* ── Quantitative overlays — toggle on/off from dropdown ── */
        if (item.hursttool) { hurstOn = !hurstOn; buildToolbar(); renderChart && renderChart(); return; }
        if (item.garchbandstool) { garchBandsOn = !garchBandsOn; buildToolbar(); renderChart && renderChart(); return; }
        if (item.fractalsignaltool) { fractalSignalOn = !fractalSignalOn; buildToolbar(); renderChart && renderChart(); return; }
        if (item.kalmantool) { kalmanOn = !kalmanOn; buildToolbar(); renderChart && renderChart(); return; }
        if (item.fractalpathstool) { fractalPathsOn = !fractalPathsOn; buildToolbar(); renderChart && renderChart(); return; }
        if (item.gbmtool) { gbmOn = !gbmOn; buildToolbar(); renderChart && renderChart(); return; }
        if (item.outool) { ouOn = !ouOn; buildToolbar(); renderChart && renderChart(); return; }
        if (item.vpvrtool) { vpvrOn = !vpvrOn; buildToolbar(); renderChart && renderChart(); return; }
        if (item.liqheatmaptool) { liqHeatmapOn = !liqHeatmapOn; buildToolbar(); renderChart && renderChart(); return; }
        if (item.volbubblestool) { volBubblesOn = !volBubblesOn; buildToolbar(); renderChart && renderChart(); return; }
        if (item.macascadetool) {
          if (!window._featureStatus || !window._featureStatus.fractal_geometry) { window.showFeatureModal && window.showFeatureModal('fractal_geometry'); return; }
          maCascadeOn = !maCascadeOn; buildToolbar(); renderChart && renderChart(); return;
        }
        if (item.FractalScripttool) { fractalOverlayOn = !fractalOverlayOn; if (fractalOverlayOn) { _showfractalModal(); if (!fractalResult && fractalSource) _runFractalScript(); } buildToolbar(); renderChart && renderChart(); return; }
        if (item.measuretool) { activeTool = 'measure'; activeItem = item; measuring = true; measurePts = []; setCursor('crosshair'); buildToolbar(); return; }
        if (item.zoomtool) { chartView.zoom = Math.min(8, chartView.zoom * 1.5); renderChart && renderChart(); return; }
        if (item.magnettool) { magnetOn = !magnetOn; buildToolbar(); return; }

        /* ── Fib Spiral & Fractal Spiral gate ── */
        if (item.fibtype === 'spiral' || item.fibtype === 'spiral_forecast') {
          if (!window._featureStatus || !window._featureStatus.fib_spiral) { window.showFeatureModal && window.showFeatureModal('fib_spiral'); return; }
        }
        if (item.fibtype === 'fractal_spiral') {
          if (!window._featureStatus || !window._featureStatus.fractal_spiral) { window.showFeatureModal && window.showFeatureModal('fractal_spiral'); return; }
        }

        /* Cancel any in-progress bar pattern or drawing drag */
        _bpClick1 = null;
        _drawDrag = null;
        _bpDrag = null;

        activeTool = item.id; activeItem = item;
        measuring = false; measurePts = [];
        setCursor(item.cur || 'crosshair');
        /* Show color picker only for brush tool */
        var picker = document.getElementById('brushColorPicker');
        if (picker) picker.style.display = (item.brush) ? 'flex' : 'none';
        buildToolbar();
        /* Mobile drawing state machine hook */
        if (typeof window._mobOnPickItem === 'function') window._mobOnPickItem(item);
      }

      function handleSingle(g) {
        if (g.erasertool) { saveUndo(); window.drawings = []; drawings = window.drawings; renderChart && renderChart(); return; }
        if (g.undotool) { doUndo(); return; }
        if (g.redotool) { doRedo(); return; }
        if (g.zoomtool) { chartView.zoom = Math.min(8, chartView.zoom * 1.5); renderChart && renderChart(); return; }
        if (g.magnettool) { magnetOn = !magnetOn; buildToolbar(); return; }
        if (g.locktool) { lockedDraw = !lockedDraw; buildToolbar(); return; }
        if (g.measuretool) { activeTool = 'measure'; activeItem = g; measuring = true; measurePts = []; setCursor('crosshair'); buildToolbar(); return; }
        if (g.vpvrtool) { vpvrOn = !vpvrOn; buildToolbar(); renderChart && renderChart(); return; }
        if (g.liqheatmaptool) { liqHeatmapOn = !liqHeatmapOn; buildToolbar(); renderChart && renderChart(); return; }
        if (g.volbubblestool) { volBubblesOn = !volBubblesOn; buildToolbar(); renderChart && renderChart(); return; }
        if (g.macascadetool) { maCascadeOn = !maCascadeOn; buildToolbar(); renderChart && renderChart(); return; }
        if (g.FractalScripttool) { fractalOverlayOn = !fractalOverlayOn; if (fractalOverlayOn) { _showfractalModal(); if (!fractalResult && fractalSource) _runFractalScript(); } buildToolbar(); renderChart && renderChart(); return; }
      }

      function setCursor(cur) {
        var cv = document.getElementById('chartCanvas');
        /* Hide native cursor for all crosshair/drawing tools — custom dot handles it.
           Keep native cursor only for arrow_cur tool (explicitly 'default'). */
        if (cv) cv.style.cursor = (cur === 'crosshair') ? 'none' : (cur || 'none');
      }

      /* ── Shared coord helper — PAD MUST match renderChart ── */
      function getCoords(e) {
        var cv = document.getElementById('chartCanvas');
        if (!cv) return null;
        var r = cv.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        var scX = (cv.width / dpr) / r.width, scY = (cv.height / dpr) / r.height;
        var mx = (e.clientX - r.left) * scX, my = (e.clientY - r.top) * scY;
        var W = cv.width / dpr, H = cv.height / dpr;
        var barW = Math.max(1, viewState.scaleX);
        var CW = W - _chartPAD.l - _chartPAD.r;
        var CH = _lastCH || (H - _chartPAD.t - _chartPAD.b - _chartPAD.vol);
        /* Pixel-only mode when no chart data (uploaded photo) */
        if (!chartCandles || chartCandles.length < 2) {
          return {
            x: mx, y: my, price: 0, bi: 0, W: W, H: H, CW: CW, CH: CH,
            mn: 0, rng: 1, barW: barW, si: 0, visible: [], pixelOnly: true
          };
        }
        /* Visible slice from viewState */
        var si = Math.max(0, Math.floor(-viewState.offsetX / barW) - 1);
        var eiEnd = Math.min(chartCandles.length, Math.ceil((CW - viewState.offsetX) / barW) + 2);
        var visible = chartCandles.slice(si, eiEnd);
        /* Bar index under cursor (absolute) */
        var bi = Math.max(0, Math.min(chartCandles.length - 1, Math.round(screenToWorldX(mx))));
        /* Price under cursor */
        var price = screenToWorldY(my);
        /* Magnet snap — OHLC */
        if (magnetOn && chartCandles[bi]) {
          var _mc = chartCandles[bi];
          var snaps = [_mc.o, _mc.h, _mc.l, _mc.c];
          price = snaps.reduce(function (a, b) { return Math.abs(b - price) < Math.abs(a - price) ? b : a; });
        }
        /* SMA crossover snap — always active when crossover markers are visible (within ~12px) */
        if (window._smaSnapPrices && window._smaSnapPrices.length) {
          var _snapRng = viewState.priceMax - viewState.priceMin || 1;
          var _snapThresh = _snapRng * (_chartPAD.vol > 0 ? 12 : 12) / (CH || 200); /* 12px in price units */
          window._smaSnapPrices.forEach(function (sp) {
            if (Math.abs(sp - price) < _snapThresh) price = sp;
          });
        }
        var mn = viewState.priceMin, rng = viewState.priceMax - viewState.priceMin || 1;
        return { x: mx, y: my, price: price, bi: bi, W: W, H: H, CW: CW, CH: CH, mn: mn, rng: rng, barW: barW, si: si, visible: visible };
      }

      /* cpY/cpX now delegate to world-space transforms — co is kept for signature compat */
      function cpY(price, co) { return worldToScreenY(price); }
      function cpX(bi, co) { return worldToScreenX(bi); }

      /* ── Mouse events ── */
      /* Save state for undo before every drawing action */
      function saveUndo() {
        undoStack.push(JSON.stringify(drawings));
        if (undoStack.length > 50) undoStack.shift(); /* cap at 50 steps */
        redoStack = []; /* new action clears redo */
      }
      window.saveUndo = saveUndo;
      window.addDrawing = function (d) { saveUndo(); drawings.push(d); renderChart && renderChart(); };
      function doUndo() {
        if (!undoStack.length) return;
        redoStack.push(JSON.stringify(drawings));
        drawings = JSON.parse(undoStack.pop());
        renderChart();
      }
      function doRedo() {
        if (!redoStack.length) return;
        undoStack.push(JSON.stringify(drawings));
        drawings = JSON.parse(redoStack.pop());
        renderChart();
      }

      function initDrawEvents() {
        var cv = document.getElementById('chartCanvas');
        if (!cv) return;

        /* ══════════════════════════════════════════════════════
           MOBILE 3-TOUCH DRAWING STATE MACHINE
           State: 'idle' | 'p1' (waiting P1 tap) | 'p2' (hover + confirm)
           Only active when a drawing tool is selected (not cursor/arrow_cur/dot).
           Desktop mouse events are completely unaffected.
           ══════════════════════════════════════════════════════ */
        var _mobDraw = {
          state: 'idle',       /* 'idle' | 'p1' | 'p2' */
          p1co: null,         /* getCoords snapshot for point 1 */
          xhCo: null,         /* current crosshair getCoords (frozen when finger lifted) */
          touchOriginX: 0,     /* where this finger-down started (client coords) */
          touchOriginY: 0,
          xhOriginX: 0,        /* crosshair position when finger went down */
          xhOriginY: 0,
          dragging: false
        };

        /* Helper: is a "drawing" tool currently active (not cursor/pointer) */
        function _mobToolActive() {
          if (!activeItem) return false;
          var id = activeItem.id;
          return id !== 'cursor' && id !== 'arrow_cur' && id !== 'dot';
        }

        /* Make a synthetic getCoords result at canvas pixel (cx, cy) */
        function _coAt(cx, cy) {
          var r = cv.getBoundingClientRect();
          var dpr = window.devicePixelRatio || 1;
          var scX = (cv.width / dpr) / r.width, scY = (cv.height / dpr) / r.height;
          return getCoords({ clientX: r.left + cx / scX, clientY: r.top + cy / scY });
        }

        /* Draw the mobile crosshair + HUD on top of the chart (called from renderChart patch) */
        window._drawMobCrosshair = function (ctx, W, H) {
          if (_mobDraw.state === 'idle' || !_mobDraw.xhCo) return;
          var co = _mobDraw.xhCo;
          var cx = co.x, cy = co.y;
          ctx.save();
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1;
          ctx.strokeStyle = 'rgba(201,168,76,.7)';
          /* Vertical line */
          ctx.beginPath(); ctx.moveTo(cx, _chartPAD.t); ctx.lineTo(cx, H - _chartPAD.b); ctx.stroke();
          /* Horizontal line */
          ctx.beginPath(); ctx.moveTo(_chartPAD.l, cy); ctx.lineTo(W - _chartPAD.r, cy); ctx.stroke();
          ctx.setLineDash([]);
          /* Centre dot */
          ctx.fillStyle = '#c9a84c';
          ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
          /* Price label on Y axis */
          var priceStr = typeof formatPrice === 'function' ? formatPrice(co.price) : co.price.toFixed(2);
          ctx.fillStyle = '#c9a84c'; ctx.font = 'bold 10px DM Mono,monospace'; ctx.textAlign = 'left';
          var py = Math.max(_chartPAD.t + 8, Math.min(H - _chartPAD.b - 8, cy - 6));
          ctx.fillRect(W - _chartPAD.r + 1, py - 2, _chartPAD.r - 3, 14);
          ctx.fillStyle = '#06080d'; ctx.fillText(priceStr, W - _chartPAD.r + 4, py + 9);
          /* P2 phase: draw live preview line + HUD */
          if (_mobDraw.state === 'p2' && _mobDraw.p1co) {
            var p1 = _mobDraw.p1co;
            var p1x = worldToScreenX(p1.bi), p1y = worldToScreenY(p1.price);
            /* Preview line */
            ctx.strokeStyle = 'rgba(201,168,76,.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
            ctx.beginPath(); ctx.moveTo(p1x, p1y); ctx.lineTo(cx, cy); ctx.stroke();
            ctx.setLineDash([]);
            /* P1 dot */
            ctx.fillStyle = '#e8c97a'; ctx.beginPath(); ctx.arc(p1x, p1y, 5, 0, Math.PI * 2); ctx.fill();
            /* HUD — price delta + candle count */
            var dPrice = co.price - p1.price;
            var dBars = co.bi - p1.bi;
            var pct = (p1.price !== 0 ? (dPrice / p1.price * 100) : 0).toFixed(2);
            var sign = dPrice >= 0 ? '+' : '';
            var hudTxt = sign + (typeof formatPrice === 'function' ? formatPrice(Math.abs(dPrice)) : Math.abs(dPrice).toFixed(2))
              + ' (' + sign + pct + '%)  ' + Math.abs(dBars) + ' bars';
            ctx.font = '10px DM Mono,monospace'; ctx.textAlign = 'center';
            var hudW = ctx.measureText(hudTxt).width + 16, hudH = 18;
            var hudX = Math.max(hudW / 2 + 4, Math.min(W - hudW / 2 - 4, (p1x + cx) / 2));
            var hudY = Math.max(_chartPAD.t + hudH, (p1y + cy) / 2 - 8);
            ctx.fillStyle = 'rgba(6,8,13,.85)';
            ctx.fillRect(hudX - hudW / 2, hudY - hudH + 3, hudW, hudH);
            ctx.strokeStyle = 'rgba(201,168,76,.3)'; ctx.lineWidth = 1;
            ctx.strokeRect(hudX - hudW / 2, hudY - hudH + 3, hudW, hudH);
            ctx.fillStyle = dPrice >= 0 ? '#26a69a' : '#ef5350';
            ctx.fillText(hudTxt, hudX, hudY);
          }
          ctx.restore();
        };

        /* Commit the drawing at current crosshair position */
        function _mobCommit() {
          var p1 = _mobDraw.p1co, p2 = _mobDraw.xhCo;
          if (!p1 || !p2) return;
          /* Single-point tools */
          if (activeItem.vline) { saveUndo(); drawings.push({ type: 'vline', bi: p2.bi }); }
          else if (activeItem.hline) { saveUndo(); drawings.push({ type: 'hline', price: p2.price, ray: activeItem.ray }); }
          else if (activeItem.arrowmark) { saveUndo(); drawings.push({ type: 'arrowmark', price: p2.price, bi: p2.bi, dir: activeItem.dir }); }
          else { saveUndo(); drawings.push(makeDrawing(p1, p2)); }
          if (!lockedDraw) {
            pickItem(GROUPS[0].items[0]); /* _mobOnPickItem called inside, cancels draw */
          } else {
            /* Stay on same tool — re-enter p1 (free crosshair for next drawing) */
            _mobDraw.state = 'idle'; _mobDraw.p1co = null;
            hoverPoint = null; drawStart = null; isDrawing = false;
            window._mobOnPickItem && window._mobOnPickItem(activeItem);
          }
          if (_mobDraw.state !== 'p1') {
            _mobDraw.state = 'idle'; _mobDraw.p1co = null; _mobDraw.xhCo = null;
            hoverPoint = null; drawStart = null; isDrawing = false;
            renderChart();
          }
        }

        /* Cancel mobile draw (called when tool button re-tapped or cursor selected) */
        window._mobCancelDraw = function () {
          _mobDraw.state = 'idle'; _mobDraw.p1co = null; _mobDraw.xhCo = null;
          hoverPoint = null; drawStart = null; isDrawing = false;
          renderChart();
        };

        /* Called when a drawing tool is selected — immediately enter p1 (free crosshair) */
        window._mobOnPickItem = function (item) {
          if (!item || item.id === 'cursor' || item.id === 'arrow_cur' || item.id === 'dot') {
            window._mobCancelDraw && window._mobCancelDraw(); return;
          }
          if (!('ontouchstart' in window)) return; /* desktop: skip */
          _mobDraw.state = 'p1'; _mobDraw.p1co = null; _mobDraw.dragging = false;
          /* Init crosshair at chart center if not already positioned */
          var cv2 = document.getElementById('chartCanvas');
          if (cv2) {
            var dpr2 = window.devicePixelRatio || 1;
            var W2 = cv2.width / dpr2, H2 = cv2.height / dpr2;
            var cx = _chartPAD.l + (W2 - _chartPAD.l - _chartPAD.r) / 2;
            var cy = _chartPAD.t + (H2 - _chartPAD.t - _chartPAD.b - _chartPAD.vol) / 2;
            var r2 = cv2.getBoundingClientRect();
            var scX2 = (cv2.width / dpr2) / r2.width, scY2 = (cv2.height / dpr2) / r2.height;
            _mobDraw.xhCo = getCoords({ clientX: r2.left + cx / scX2, clientY: r2.top + cy / scY2 });
            _mobDraw.xhOriginX = cx; _mobDraw.xhOriginY = cy;
          }
          _mobDraw.touchOriginX = 0; _mobDraw.touchOriginY = 0;
          if (typeof renderChart === 'function') renderChart();
        };

        /* ── touchstart ── */
        cv.addEventListener('touchstart', function (e) {
          if (e.touches.length !== 1) return;
          var t = e.touches[0];

          /* ── No tool or idle: let pan/zoom handle it ── */
          if (!_mobToolActive() || _mobDraw.state === 'idle') {
            /* pass through to pan handler */
            return;
          }

          /* ── Tool is active and drawing in progress: hijack touch ── */
          e.stopImmediatePropagation();
          e.preventDefault();

          var fake = { clientX: t.clientX, clientY: t.clientY };
          var co = getCoords(fake); if (!co) return;

          if (_mobDraw.state === 'p1' || _mobDraw.state === 'p2') {
            /* New finger-down: record delta origin — crosshair stays where it was, doesn't jump */
            _mobDraw.touchOriginX = t.clientX; _mobDraw.touchOriginY = t.clientY;
            if (_mobDraw.xhCo) {
              _mobDraw.xhOriginX = _mobDraw.xhCo.x;
              _mobDraw.xhOriginY = _mobDraw.xhCo.y;
            }
            _mobDraw.dragging = false;
          }
        }, { passive: false, capture: true });

        /* ── touchmove ── */
        cv.addEventListener('touchmove', function (e) {
          if (e.touches.length !== 1) return;
          if (_mobDraw.state !== 'p2' && _mobDraw.state !== 'p1') return;
          e.stopImmediatePropagation();
          e.preventDefault();

          var t = e.touches[0];
          var dpr = window.devicePixelRatio || 1;
          var r = cv.getBoundingClientRect();
          var scX = (cv.width / dpr) / r.width, scY = (cv.height / dpr) / r.height;
          /* Delta from where this finger started */
          var dx = (t.clientX - _mobDraw.touchOriginX) * scX;
          var dy = (t.clientY - _mobDraw.touchOriginY) * scY;
          if (Math.abs(dx) > 2 || Math.abs(dy) > 2) _mobDraw.dragging = true;
          /* New crosshair canvas position */
          var newCX = _mobDraw.xhOriginX + dx;
          var newCY = _mobDraw.xhOriginY + dy;
          /* Clamp to chart area */
          newCX = Math.max(_chartPAD.l, Math.min((cv.width / dpr) - _chartPAD.r, newCX));
          newCY = Math.max(_chartPAD.t, Math.min((cv.height / dpr) - _chartPAD.b, newCY));
          /* Build a co from canvas coords */
          _mobDraw.xhCo = getCoords({ clientX: r.left + newCX / scX, clientY: r.top + newCY / scY });
          hoverPoint = _mobDraw.xhCo;
          renderChart();
        }, { passive: false, capture: true });

        /* ── touchend ── */
        cv.addEventListener('touchend', function (e) {
          if (!_mobToolActive() || _mobDraw.state === 'idle') return;
          e.stopImmediatePropagation();
          e.preventDefault();

          if (_mobDraw.state === 'p1') {
            if (_mobDraw.dragging) {
              /* Finger was dragging — freeze crosshair at last position, stay in p1 */
              _mobDraw.dragging = false;
              return;
            }
            /* Single tap (no drag) → place P1 at current crosshair position */
            var p1co = _mobDraw.xhCo; if (!p1co) return;
            if (activeItem.vline || activeItem.hline || activeItem.arrowmark) {
              _mobDraw.p1co = p1co; _mobCommit(); return;
            }
            _mobDraw.p1co = p1co; _mobDraw.state = 'p2';
            _mobDraw.touchOriginX = 0; _mobDraw.touchOriginY = 0;
            _mobDraw.xhOriginX = p1co.x; _mobDraw.xhOriginY = p1co.y;
            _mobDraw.dragging = false;
            hoverPoint = p1co; drawStart = p1co; isDrawing = true;
            renderChart();
          } else if (_mobDraw.state === 'p2') {
            /* Lift finger: if it barely moved → confirm P2 at current crosshair */
            if (!_mobDraw.dragging) {
              _mobCommit();
            }
            /* If it was a drag, freeze crosshair at last position — wait for next tap to confirm */
            _mobDraw.dragging = false;
          }
        }, { passive: false, capture: true });

        cv.addEventListener('mousedown', function (e) {
          if (e.button !== 0) return; /* only left click triggers drawing tools */
          var co = getCoords(e); if (!co) return;

          /* ── Bar Pattern: p1/p2 handle + body drag ── */
          if (!activeItem || activeItem.id === 'cursor' || activeItem.id === 'arrow_cur' || activeItem.id === 'dot') {
            for (var bpi = 0; bpi < drawings.length; bpi++) {
              var bpd = drawings[bpi];
              if (!bpd.barpattern || !bpd._rb || bpd._locked) continue;
              var rb = bpd._rb, HR2 = rb.HR + 5;
              /* p1 handle */
              var dp1x = co.x - rb.x1, dp1y = co.y - rb.y1;
              if (Math.sqrt(dp1x * dp1x + dp1y * dp1y) <= HR2) {
                _bpDrag = {
                  idx: bpi, point: 'p1', startX: co.x, startY: co.y,
                  origP1: { bi: bpd.p1.bi, price: bpd.p1.price },
                  origP2: { bi: bpd.p2.bi, price: bpd.p2.price }
                };
                e.preventDefault(); return;
              }
              /* p2 handle */
              var dp2x = co.x - rb.x2, dp2y = co.y - rb.y2;
              if (Math.sqrt(dp2x * dp2x + dp2y * dp2y) <= HR2) {
                _bpDrag = {
                  idx: bpi, point: 'p2', startX: co.x, startY: co.y,
                  origP1: { bi: bpd.p1.bi, price: bpd.p1.price },
                  origP2: { bi: bpd.p2.bi, price: bpd.p2.price }
                };
                e.preventDefault(); return;
              }
              /* Body hit — use normalized bounding box */
              if (co.x >= rb.bx1 && co.x <= rb.bx2 && co.y >= rb.by1 && co.y <= rb.by2) {
                _bpDrag = {
                  idx: bpi, point: 'body', startX: co.x, startY: co.y,
                  origP1: { bi: bpd.p1.bi, price: bpd.p1.price },
                  origP2: { bi: bpd.p2.bi, price: bpd.p2.price }
                };
                cv.style.cursor = 'grabbing'; e.preventDefault(); return;
              }
            }
          }

          /* ── Universal drawing drag — click near any drawing to move it ── */
          if (!activeItem || activeItem.id === 'cursor' || activeItem.id === 'arrow_cur' || activeItem.id === 'dot') {
            if (!co.pixelOnly && co.visible && co.visible.length > 1) {
              var HIT = 14; /* px proximity threshold */
              for (var ddi = 0; ddi < drawings.length; ddi++) {
                var ddd = drawings[ddi];
                if (ddd.barpattern) continue; /* handled by ghost drag above */
                if (ddd.type === 'brush') continue; /* skip brush */
                if (ddd._locked) continue; /* skip locked drawings */
                var dp1x, dp1y, dp2x, dp2y;
                if (ddd.type === 'hline') {
                  var hly = cpY(ddd.price, co);
                  if (Math.abs(co.y - hly) < HIT) {
                    _drawDrag = {
                      idx: ddi, point: 'body', startX: co.x, startY: co.y,
                      origP1: { price: ddd.price, bi: ddd.bi || 0 }
                    };
                    e.preventDefault(); return;
                  }
                  continue;
                }
                if (ddd.type === 'vline') {
                  var vlx = cpX(ddd.bi, co);
                  if (Math.abs(co.x - vlx) < HIT) {
                    _drawDrag = {
                      idx: ddi, point: 'body', startX: co.x, startY: co.y,
                      origP1: { bi: ddd.bi, price: 0 }
                    };
                    e.preventDefault(); return;
                  }
                  continue;
                }
                if (ddd.type === 'arrowmark' || ddd.type === 'text' || ddd.type === 'callout') {
                  dp1x = cpX(ddd.bi, co); dp1y = cpY(ddd.price, co);
                  if (Math.sqrt((co.x - dp1x) * (co.x - dp1x) + (co.y - dp1y) * (co.y - dp1y)) < HIT + 4) {
                    _drawDrag = {
                      idx: ddi, point: 'body', startX: co.x, startY: co.y,
                      origP1: { bi: ddd.bi, price: ddd.price }
                    };
                    e.preventDefault(); return;
                  }
                  continue;
                }
                if (!ddd.p1 || !ddd.p2) continue;
                dp1x = cpX(ddd.p1.bi, co); dp1y = cpY(ddd.p1.price, co);
                dp2x = cpX(ddd.p2.bi, co); dp2y = cpY(ddd.p2.price, co);
                var d1 = Math.sqrt((co.x - dp1x) * (co.x - dp1x) + (co.y - dp1y) * (co.y - dp1y));
                var d2 = Math.sqrt((co.x - dp2x) * (co.x - dp2x) + (co.y - dp2y) * (co.y - dp2y));
                if (d1 < HIT) {
                  _drawDrag = {
                    idx: ddi, point: 'p1', startX: co.x, startY: co.y,
                    origP1: { bi: ddd.p1.bi, price: ddd.p1.price },
                    origP2: { bi: ddd.p2.bi, price: ddd.p2.price }
                  };
                  e.preventDefault(); return;
                }
                if (d2 < HIT) {
                  _drawDrag = {
                    idx: ddi, point: 'p2', startX: co.x, startY: co.y,
                    origP1: { bi: ddd.p1.bi, price: ddd.p1.price },
                    origP2: { bi: ddd.p2.bi, price: ddd.p2.price }
                  };
                  e.preventDefault(); return;
                }
                /* Body: click on or near the line/shape */
                var ldx = dp2x - dp1x, ldy = dp2y - dp1y, lLen = ldx * ldx + ldy * ldy;
                var lt = lLen ? Math.max(0, Math.min(1, ((co.x - dp1x) * ldx + (co.y - dp1y) * ldy) / lLen)) : 0;
                var lDist = Math.sqrt((co.x - dp1x - lt * ldx) * (co.x - dp1x - lt * ldx) + (co.y - dp1y - lt * ldy) * (co.y - dp1y - lt * ldy));
                if (lDist < HIT) {
                  _drawDrag = {
                    idx: ddi, point: 'body', startX: co.x, startY: co.y,
                    origP1: { bi: ddd.p1.bi, price: ddd.p1.price },
                    origP2: { bi: ddd.p2.bi, price: ddd.p2.price }
                  };
                  e.preventDefault(); return;
                }
              }
            }
          }

          /* Brush tool */
          if (activeItem && (activeItem.brush || activeItem.erbrush)) {
            isBrushing = true; brushPath = [{ x: co.x, y: co.y }]; return;
          }

          /* Click eraser — find and delete nearest drawing */
          if (activeItem && activeItem.ptreraser) {
            var hit = -1, bestDist = 20;
            drawings.forEach(function (d, idx) {
              var dist = 9999;
              if (d.type === 'hline') { var ey = cpY(d.price, co); dist = Math.abs(co.y - ey); }
              else if (d.type === 'vline') { var ex = cpX(d.bi, co); dist = Math.abs(co.x - ex); }
              else if (d.p1 && d.p2) {
                var ex1 = cpX(d.p1.bi, co), ey1 = cpY(d.p1.price, co);
                var ex2 = cpX(d.p2.bi, co), ey2 = cpY(d.p2.price, co);
                var edx = ex2 - ex1, edy = ey2 - ey1, eLen = edx * edx + edy * edy;
                var et = eLen ? Math.max(0, Math.min(1, ((co.x - ex1) * edx + (co.y - ey1) * edy) / eLen)) : 0;
                dist = Math.sqrt(Math.pow(co.x - ex1 - et * edx, 2) + Math.pow(co.y - ey1 - et * edy, 2));
              } else if (d.type === 'brush' && d.path) {
                dist = Math.min.apply(null, d.path.map(function (pt) {
                  return Math.sqrt((co.x - pt.x) * (co.x - pt.x) + (co.y - pt.y) * (co.y - pt.y));
                }));
              }
              if (dist < bestDist) { bestDist = dist; hit = idx; }
            });
            if (hit >= 0) { saveUndo(); drawings.splice(hit, 1); renderChart(); }
            return;
          }

          /* Measure tool — 2 clicks = show, 3rd click resets */
          if (activeTool === 'measure') {
            if (measurePts.length >= 2) measurePts = [];
            measurePts.push({ x: co.x, y: co.y, price: co.price, bi: co.bi });
            renderChart();
            return;
          }
          /* Handle non-drawing tool items immediately on click */
          if (activeItem && activeItem.undotool) { doUndo(); return; }
          if (activeItem && activeItem.redotool) { doRedo(); return; }
          if (activeItem && activeItem.erasertool) { saveUndo(); window.drawings = []; drawings = window.drawings; renderChart(); return; }

          /* Crosshair Left-Click Panning */
          if (!activeItem || activeItem.id === 'cursor' || activeItem.id === 'arrow_cur' || activeItem.id === 'dot') {
            if (typeof _inertiaRaf !== 'undefined' && _inertiaRaf) { cancelAnimationFrame(_inertiaRaf); _inertiaRaf = null; }
            if (typeof _panVelX !== 'undefined') _panVelX = 0;
            if (typeof _panAccum !== 'undefined') _panAccum = 0;
            window._panStart = e.clientX;
            window._panOffset = chartView.offset;
            window._panRightPad = chartView.rightPad || 0;
            if (typeof _panLastX !== 'undefined') { _panLastX = e.clientX; _panLastY = e.clientY; _panLastT = Date.now(); }
            cv.style.cursor = 'grabbing';
            return;
          }

          /* Text tool */
          if (activeItem.textdraw) {
            var lbl = prompt(activeItem.callout ? 'Callout text:' : 'Label:');
            if (lbl) { saveUndo(); drawings.push({ type: activeItem.id, price: co.price, bi: co.bi, label: lbl, callout: activeItem.callout }); renderChart(); }
            return;
          }
          if (activeItem.vline) { if (!co.pixelOnly) { saveUndo(); drawings.push({ type: 'vline', bi: co.bi }); if (!lockedDraw) pickItem(GROUPS[0].items[0]); renderChart(); } return; }
          if (activeItem.hline) { if (!co.pixelOnly) { saveUndo(); drawings.push({ type: 'hline', price: co.price, ray: activeItem.ray }); if (!lockedDraw) pickItem(GROUPS[0].items[0]); renderChart(); } return; }
          if (activeItem.arrowmark) { if (!co.pixelOnly) { saveUndo(); drawings.push({ type: 'arrowmark', price: co.price, bi: co.bi, dir: activeItem.dir }); if (!lockedDraw) pickItem(GROUPS[0].items[0]); renderChart(); } return; }

          /* ── Bar Pattern: two single-clicks, bar-top magnet snap ── */
          if (activeItem && activeItem.barpattern) {
            if (co.pixelOnly || !co.visible || co.visible.length < 2) return;
            /* Snap to nearest bar index by cursor X */
            var snapBiAbs2 = Math.max(0, Math.min(chartCandles.length - 1, Math.round(screenToWorldX(co.x))));
            if (_bpClick1 === null) {
              /* First click — anchor bar */
              _bpClick1 = { bi: snapBiAbs2 };
              renderChart();
            } else {
              /* Second click — commit range */
              var s = Math.min(_bpClick1.bi, snapBiAbs2);
              var e2 = Math.max(_bpClick1.bi, snapBiAbs2);
              if (e2 > s && chartCandles && chartCandles.length > s) {
                var caps = chartCandles.slice(Math.max(0, s), Math.min(chartCandles.length, e2 + 1));
                if (caps.length > 1) {
                  var bpPmx = Math.max.apply(null, caps.map(function (c) { return c.h; }));
                  var bpPmn = Math.min.apply(null, caps.map(function (c) { return c.l; }));
                  saveUndo();
                  drawings.push({
                    type: 'barpattern', barpattern: true, pixelOnly: false,
                    candles: caps,
                    p1: { bi: s, price: bpPmx },
                    p2: { bi: e2, price: bpPmn }
                  });
                }
              }
              _bpClick1 = null;
              pickItem(GROUPS[0].items[0]); /* auto-switch to cursor */
              renderChart();
            }
            return;
          }

          isDrawing = true; drawStart = co;
        });

        var _rafPending = false;
        cv.addEventListener('mousemove', function (e) {
          hoverPoint = getCoords(e);
          /* Bar Pattern drag — p1, p2, or body */
          if (_bpDrag !== null && hoverPoint && !hoverPoint.pixelOnly) {
            var bd = _bpDrag, drw = drawings[bd.idx];
            if (!drw) { _bpDrag = null; return; }
            var pricePerPx = hoverPoint.rng / hoverPoint.CH;
            var barDelta = Math.round((hoverPoint.x - bd.startX) / hoverPoint.barW);
            var priceDelta = (hoverPoint.y - bd.startY) * pricePerPx;
            if (bd.point === 'p1') {
              drw.p1 = { bi: bd.origP1.bi + barDelta, price: bd.origP1.price - priceDelta };
            } else if (bd.point === 'p2') {
              drw.p2 = { bi: bd.origP2.bi + barDelta, price: bd.origP2.price - priceDelta };
            } else {
              drw.p1 = { bi: bd.origP1.bi + barDelta, price: bd.origP1.price - priceDelta };
              drw.p2 = { bi: bd.origP2.bi + barDelta, price: bd.origP2.price - priceDelta };
            }
            if (!_rafPending) { _rafPending = true; requestAnimationFrame(function () { renderChart(); _rafPending = false; }); }
            return;
          }
          /* Universal drawing drag */
          if (_drawDrag !== null && hoverPoint && !hoverPoint.pixelOnly) {
            var dxPx2 = hoverPoint.x - _drawDrag.startX;
            var dyPx2 = hoverPoint.y - _drawDrag.startY;
            var pricePerPx2 = hoverPoint.rng / hoverPoint.CH;
            var barDelta2 = Math.round(dxPx2 / hoverPoint.barW);
            var priceDelta2 = dyPx2 * pricePerPx2;
            var ddd2 = drawings[_drawDrag.idx];
            if (!ddd2) { _drawDrag = null; return; }
            if (ddd2.type === 'hline') {
              ddd2.price = _drawDrag.origP1.price - priceDelta2;
            } else if (ddd2.type === 'vline') {
              ddd2.bi = (_drawDrag.origP1.bi + barDelta2);
            } else if (ddd2.type === 'arrowmark' || ddd2.type === 'text' || ddd2.type === 'callout') {
              ddd2.bi = _drawDrag.origP1.bi + barDelta2;
              ddd2.price = _drawDrag.origP1.price - priceDelta2;
            } else if (ddd2.p1 && ddd2.p2) {
              if (_drawDrag.point === 'p1') {
                ddd2.p1 = {
                  bi: _drawDrag.origP1.bi + barDelta2, price: _drawDrag.origP1.price - priceDelta2,
                  x: ddd2.p1.x, y: ddd2.p1.y
                };
              } else if (_drawDrag.point === 'p2') {
                ddd2.p2 = {
                  bi: _drawDrag.origP2.bi + barDelta2, price: _drawDrag.origP2.price - priceDelta2,
                  x: ddd2.p2.x, y: ddd2.p2.y
                };
              } else { /* body — move both */
                ddd2.p1 = {
                  bi: _drawDrag.origP1.bi + barDelta2, price: _drawDrag.origP1.price - priceDelta2,
                  x: ddd2.p1.x, y: ddd2.p1.y
                };
                ddd2.p2 = {
                  bi: _drawDrag.origP2.bi + barDelta2, price: _drawDrag.origP2.price - priceDelta2,
                  x: ddd2.p2.x, y: ddd2.p2.y
                };
              }
            }
            if (!_rafPending) { _rafPending = true; requestAnimationFrame(function () { renderChart(); _rafPending = false; }); }
            return;
          }
          if (isBrushing && hoverPoint) {
            brushPath.push({ x: hoverPoint.x, y: hoverPoint.y });
            /* Render immediately for smooth brush stroke */
            if (!_rafPending) { _rafPending = true; requestAnimationFrame(function () { renderChart(); _rafPending = false; }); }
            return;
          }
          if (!_rafPending && chartCandles && chartCandles.length > 1) {
            /* Update cursor to show resize/move hints over bar pattern */
            if (!activeItem || activeItem.id === 'cursor' || activeItem.id === 'arrow_cur' || activeItem.id === 'dot') {
              var cursorSet = false;
              for (var _rci = 0; _rci < drawings.length; _rci++) {
                var _rcd = drawings[_rci];
                if (!_rcd.barpattern || !_rcd._rb) continue;
                var _rb2 = _rcd._rb, _HR3 = _rb2.HR + 5;
                /* Check p1/p2 handle hits */
                var _dp1x = hoverPoint.x - _rb2.x1, _dp1y = hoverPoint.y - _rb2.y1;
                var _dp2x = hoverPoint.x - _rb2.x2, _dp2y = hoverPoint.y - _rb2.y2;
                if (Math.sqrt(_dp1x * _dp1x + _dp1y * _dp1y) <= _HR3 || Math.sqrt(_dp2x * _dp2x + _dp2y * _dp2y) <= _HR3) {
                  cv.style.cursor = 'nwse-resize'; cursorSet = true; break;
                }
                /* Check body hit — use normalized bounding box */
                if (hoverPoint.x >= _rb2.bx1 && hoverPoint.x <= _rb2.bx2 && hoverPoint.y >= _rb2.by1 && hoverPoint.y <= _rb2.by2) {
                  cv.style.cursor = 'grab'; cursorSet = true; break;
                }
              }
              if (!cursorSet) {
                var _dpr2 = window.devicePixelRatio || 1, _rc2 = cv.getBoundingClientRect();
                var _cx2 = e.clientX - _rc2.left, _cy2 = e.clientY - _rc2.top;
                var _W2 = cv.width / _dpr2, _H2 = cv.height / _dpr2;
                if (_cx2 > _W2 - 75) cv.style.cursor = 'ns-resize';
                else if (_cy2 > _H2 - 56) cv.style.cursor = 'ew-resize';
                else cv.style.cursor = (activeItem && activeItem.cur === 'default') ? 'default' : 'none';
              }
            }
            _rafPending = true;
            requestAnimationFrame(function () { renderChart(); _rafPending = false; });
          }
        });

        /* mouseup on document to catch releases outside canvas */
        document.addEventListener('mouseup', function (e) {
          /* Release ghost drag */
          if (_bpDrag !== null) { _bpDrag = null; cv.style.cursor = (activeItem && activeItem.cur === 'default') ? 'default' : 'none'; renderChart(); return; }
          /* Release universal drawing drag */
          if (_drawDrag !== null) { _drawDrag = null; renderChart(); return; }
          if (isBrushing) {
            isBrushing = false;
            if (brushPath.length > 1) {
              if (activeItem && activeItem.erbrush) {
                /* Eraser brush — remove last drawing */
                if (drawings.length > 0) drawings.pop();
              } else {
                /* Smooth the path with simple averaging, then auto-close */
                var smoothed = brushPath.slice();
                for (var si2 = 1; si2 < smoothed.length - 1; si2++) {
                  smoothed[si2] = {
                    x: (brushPath[si2 - 1].x + brushPath[si2].x + brushPath[si2 + 1].x) / 3,
                    y: (brushPath[si2 - 1].y + brushPath[si2].y + brushPath[si2 + 1].y) / 3
                  };
                }
                /* Auto-close if endpoints are close — makes a shape */
                var first = smoothed[0], last = smoothed[smoothed.length - 1];
                var dist = Math.sqrt((last.x - first.x) * (last.x - first.x) + (last.y - first.y) * (last.y - first.y));
                if (dist < 80) smoothed.push({ x: first.x, y: first.y }); /* close shape */
                saveUndo(); drawings.push({ type: 'brush', path: smoothed, closed: dist < 80, color: brushColor });
              }
            }
            brushPath = []; if (!lockedDraw) pickItem(GROUPS[0].items[0]); renderChart(); return;
          }
          if (!isDrawing || !drawStart) return;
          var co = getCoords(e); isDrawing = false;
          if (!co || (Math.abs(co.x - drawStart.x) < 3 && Math.abs(co.y - drawStart.y) < 3)) { drawStart = null; return; }
          if (!lockedDraw) {
            saveUndo(); drawings.push(makeDrawing(drawStart, co));
            drawStart = null;
            /* All tools one-shot — switch back to cursor after drawing */
            pickItem(GROUPS[0].items[0]);
            renderChart();
          } else {
            saveUndo(); drawings.push(makeDrawing(drawStart, co));
            drawStart = null; renderChart();
            /* Stay in tool for locked mode */
          }
        });

        cv.addEventListener('mouseleave', function () {
          hoverPoint = null; isDrawing = false; drawStart = null; renderChart();
        });
      }

      function makeDrawing(p1, p2) {
        var d = {
          type: activeTool,
          p1: { price: p1.price, bi: p1.bi, x: p1.x, y: p1.y },
          p2: { price: p2.price, bi: p2.bi, x: p2.x, y: p2.y },
          pixelOnly: p1.pixelOnly || false,
          ray: activeItem.ray, extended: activeItem.extended, angle: activeItem.angle,
          shape: activeItem.shape, fibtype: activeItem.fibtype,
          channel: activeItem.channel, arrowline: activeItem.arrowline,
          barpattern: activeItem.barpattern || false
        };
        /* Capture candles at draw time for proportional replay */
        if (activeItem.barpattern && chartCandles && chartCandles.length > 1) {
          var s = Math.min(p1.bi, p2.bi), e = Math.max(p1.bi, p2.bi);
          d.candles = chartCandles.slice(Math.max(0, s), Math.min(chartCandles.length, e + 1));
          d.ghostDX = 0; d.ghostDY = -90;
        }
        return d;
      }

      /* ── Draw everything ── */
      function drawAnnotations(ctx, co) {
        drawings.forEach(function (d) {
          if (d._locked) {
            ctx.save(); ctx.globalAlpha = 0.35;
            drawOne(ctx, d, co, false);
            if (d._rb) { ctx.setLineDash([]); ctx.font = '10px serif'; ctx.fillStyle = 'rgba(201,168,76,.75)'; ctx.textAlign = 'left'; ctx.fillText('🔒', d._rb.x1 + 4, d._rb.y1 - 6); }
            ctx.restore();
          } else {
            drawOne(ctx, d, co, false);
          }
        });

        /* ── Bar Pattern two-click preview ── */
        if (activeItem && activeItem.barpattern && co && co.visible && co.visible.length > 1) {
          /* Snap cursor to nearest bar — use hoverPoint.x if available */
          var hpx = hoverPoint ? hoverPoint.x : co.x;
          var snapBi2 = Math.max(0, Math.min(co.visible.length - 1, Math.round((hpx - PAD.l) / co.barW - 0.5)));
          var snapX = PAD.l + (snapBi2 + 0.5) * co.barW;
          var snapBar = co.visible[snapBi2];
          var snapY = snapBar ? cpY(snapBar.h, co) : PAD.t;

          if (_bpClick1 === null) {
            /* Before first click: show magnet dot + vertical guide snapping to bar top */
            ctx.save();
            ctx.strokeStyle = 'rgba(201,168,76,.5)'; ctx.lineWidth = 1; ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(snapX, PAD.t); ctx.lineTo(snapX, co.H - PAD.b); ctx.stroke();
            ctx.setLineDash([]);
            /* Magnet dot on bar high */
            ctx.fillStyle = '#c9a84c'; ctx.strokeStyle = 'rgba(201,168,76,.4)'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(snapX, snapY, 5, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(snapX, snapY, 8, 0, Math.PI * 2); ctx.stroke();
            ctx.restore();
          } else {
            /* After first click: show range highlight + ghost preview of captured bars */
            var anchorBi = _bpClick1.bi - co.si;
            var anchorX = PAD.l + (anchorBi + 0.5) * co.barW;
            var curBi = snapBi2;
            var lo = Math.min(anchorBi, curBi), hi = Math.max(anchorBi, curBi);

            /* Highlight selected bar range */
            ctx.save();
            ctx.fillStyle = 'rgba(201,168,76,.07)';
            ctx.fillRect(PAD.l + lo * co.barW, PAD.t, (hi - lo + 1) * co.barW, co.CH);
            /* Left and right edge lines */
            ctx.strokeStyle = 'rgba(201,168,76,.6)'; ctx.lineWidth = 1; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(anchorX, PAD.t); ctx.lineTo(anchorX, co.H - PAD.b); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(snapX, PAD.t); ctx.lineTo(snapX, co.H - PAD.b); ctx.stroke();
            /* Magnet dot on second bar */
            ctx.fillStyle = '#c9a84c';
            ctx.beginPath(); ctx.arc(snapX, snapY, 5, 0, Math.PI * 2); ctx.fill();
            /* Bar count label */
            ctx.font = 'bold 9px DM Mono'; ctx.fillStyle = 'rgba(201,168,76,.9)'; ctx.textAlign = 'center';
            ctx.fillText((hi - lo + 1) + ' bars', (anchorX + snapX) / 2, PAD.t + 14);
            /* Mini ghost preview above selection */
            if (chartCandles) {
              var s2 = Math.min(_bpClick1.bi, co.si + snapBi2);
              var e3 = Math.max(_bpClick1.bi, co.si + snapBi2);
              var previewBars = chartCandles.slice(Math.max(0, s2), Math.min(chartCandles.length, e3 + 1));
              if (previewBars.length > 1) {
                var pmn3 = Math.min.apply(null, previewBars.map(function (c) { return c.l; }));
                var pmx3 = Math.max.apply(null, previewBars.map(function (c) { return c.h; }));
                var prng3 = pmx3 - pmn3 || pmn3 * .001 || .0001;
                var pricePerPx3 = co.rng / co.CH;
                var gh3 = prng3 / pricePerPx3;
                var gw3 = co.barW;
                var gbx3 = Math.min(anchorX, snapX);
                var gby3 = PAD.t + 14;
                previewBars.forEach(function (c, ii) {
                  var isUp = c.c >= c.o;
                  var gcx3 = gbx3 + (ii + 0.5) * gw3;
                  function gsy(v) { return gby3 + ((pmx3 - v) / prng3) * gh3; }
                  ctx.strokeStyle = isUp ? 'rgba(201,168,76,.7)' : 'rgba(201,168,76,.35)'; ctx.lineWidth = 1;
                  ctx.beginPath(); ctx.moveTo(gcx3, gsy(c.h)); ctx.lineTo(gcx3, gsy(c.l)); ctx.stroke();
                  var top3 = gsy(Math.max(c.o, c.c)), cbh3 = Math.max(1, gsy(Math.min(c.o, c.c)) - top3);
                  ctx.fillStyle = isUp ? 'rgba(201,168,76,.45)' : 'rgba(201,168,76,.15)';
                  ctx.fillRect(gcx3 - gw3 * .38, top3, gw3 * .76, cbh3);
                });
              }
            }
            ctx.restore();
          }
        }

        /* In-progress preview (non-barpattern tools) */
        if (isDrawing && drawStart && hoverPoint && activeItem && !activeItem.barpattern) {
          drawOne(ctx, makeDrawing(drawStart, hoverPoint), co, true);
        }

        /* Live brush stroke preview — same context transform as saved brush */
        if (isBrushing && brushPath.length > 1) {
          ctx.save();
          ctx.strokeStyle = brushColor || '#c9a84c'; ctx.lineWidth = 2;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(brushPath[0].x, brushPath[0].y);
          for (var bpi = 1; bpi < brushPath.length - 1; bpi++) {
            var cpx2 = (brushPath[bpi].x + brushPath[bpi + 1].x) / 2;
            var cpy2 = (brushPath[bpi].y + brushPath[bpi + 1].y) / 2;
            ctx.quadraticCurveTo(brushPath[bpi].x, brushPath[bpi].y, cpx2, cpy2);
          }
          ctx.lineTo(brushPath[brushPath.length - 1].x, brushPath[brushPath.length - 1].y);
          ctx.stroke(); ctx.restore();
        }
        /* Measure overlay */
        if (activeTool === 'measure' && measurePts.length > 0) {
          drawMeasure(ctx, co);
        }

        /* Cursor overlay */
        if (hoverPoint) {
          drawCursorOverlay(ctx, co);
        }
      }

      function drawCursorOverlay(ctx, co) {
        /* In upload mode without chart data, skip price/date overlays */
        var hasChart = co && co.visible && co.visible.length > 0;
        var x = hoverPoint.x, y = hoverPoint.y;
        ctx.save();

        /* Crosshair lines — only when chart loaded */
        if (!hasChart) { ctx.restore(); return; }
        ctx.strokeStyle = 'rgba(201,168,76,.55)'; ctx.lineWidth = .9; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, co.H); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(co.W, y); ctx.stroke();
        ctx.setLineDash([]);

        /* Tool-specific cursor indicator */
        if (activeItem && activeItem.id === 'dot') {
          ctx.strokeStyle = '#c9a84c'; ctx.fillStyle = 'rgba(201,168,76,.3)'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
        } else if (activeItem && activeItem.id === 'cursor') {
          /* Simple crosshair dot */
          ctx.fillStyle = '#c9a84c';
          ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
        }

        /* Magnet indicator — show nearest OHLC snap */
        if (magnetOn && hoverPoint && hoverPoint.visible) {
          var vi = hoverPoint.bi - hoverPoint.si;
          if (vi >= 0 && vi < hoverPoint.visible.length) {
            var candle = hoverPoint.visible[vi];
            var snapP = hoverPoint.price;
            var sy = cpY(snapP, co), sx = cpX(hoverPoint.bi, co);
            ctx.strokeStyle = '#c9a84c'; ctx.fillStyle = 'rgba(201,168,76,.2)'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(sx, sy, 7, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
            /* Price tag */
            ctx.fillStyle = '#0d1018'; ctx.fillRect(co.W - PAD.r - 1, sy - 8, PAD.r, 16);
            ctx.fillStyle = '#c9a84c'; ctx.font = 'bold 10px DM Mono'; ctx.textAlign = 'left';
            ctx.fillText(formatPrice(snapP), co.W - PAD.r + 3, sy + 4);
          }
        }

        /* Price label on right axis */
        var priceAtCursor = hoverPoint.price;
        ctx.fillStyle = 'rgba(201,168,76,.85)'; ctx.fillRect(co.W - PAD.r, y - 9, PAD.r - 2, 18);
        ctx.fillStyle = '#0d1018'; ctx.font = 'bold 10px DM Mono'; ctx.textAlign = 'left';
        ctx.fillText(formatPrice(priceAtCursor), co.W - PAD.r + 3, y + 4);

        /* Date + OHLCV badge below the hovered bar */
        if (hoverPoint.visible && hoverPoint.visible.length > 0) {
          var vi = hoverPoint.bi - hoverPoint.si;
          if (vi >= 0 && vi < hoverPoint.visible.length) {
            var candle2 = hoverPoint.visible[vi];
            var MO2 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
            var d2tz = tzDate(candle2.t);
            var dayName = days[d2tz.getUTCDay()];
            var dd = d2tz.getUTCDate().toString().padStart(2, '0');
            var mo = MO2[d2tz.getUTCMonth()];
            var yy = d2tz.getUTCFullYear().toString().slice(-2);
            var hh = d2tz.getUTCHours().toString().padStart(2, '0');
            var mm = d2tz.getUTCMinutes().toString().padStart(2, '0');

            /* Full detailed TradingView style label: Day Name, Date, Month, Year, Time (24h) */
            var dtStr = dayName + ' ' + dd + ' ' + mo + " '" + yy + '  ' + hh + ':' + mm;

            var barCenterX = PAD.l + (vi + 0.5) * hoverPoint.barW;
            var dw = dtStr.length * 6.8 + 14;
            ctx.fillStyle = 'rgba(201,168,76,.9)';
            ctx.fillRect(Math.max(PAD.l, Math.min(co.W - PAD.r - dw, barCenterX - dw / 2)), co.H - 18, dw, 17);
            ctx.fillStyle = '#0d1018'; ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'center';
            ctx.fillText(dtStr, Math.max(PAD.l + dw / 2, Math.min(co.W - PAD.r - dw / 2, barCenterX)), co.H - 5);
          }
        }

        ctx.restore();
      }

      function drawMeasure(ctx, co) {
        ctx.save();
        if (measurePts.length === 1) {
          var x = cpX(measurePts[0].bi, co), y = cpY(measurePts[0].price, co);
          ctx.strokeStyle = '#c9a84c'; ctx.fillStyle = '#c9a84c'; ctx.lineWidth = 1.5;
          ctx.beginPath(); ctx.arc(x, y, 4, 0, Math.PI * 2); ctx.fill();
          if (hoverPoint) {
            var x2 = hoverPoint.x, y2 = hoverPoint.y;
            ctx.strokeStyle = 'rgba(201,168,76,.6)'; ctx.setLineDash([4, 3]);
            ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x2, y2); ctx.stroke();
            ctx.setLineDash([]);
            var pDiff = hoverPoint.price - measurePts[0].price;
            var bDiff = hoverPoint.bi - measurePts[0].bi;
            var pct = (pDiff / measurePts[0].price * 100).toFixed(2);
            var label = (pDiff >= 0 ? '+' : '') + formatPrice(Math.abs(pDiff)) + ' (' + pct + '%)  ' + Math.abs(bDiff) + ' bars';
            var lx = (x + x2) / 2, ly = (y + y2) / 2 - 12;
            var lw = ctx.measureText(label).width + 16;
            ctx.fillStyle = '#0d1018'; ctx.strokeStyle = 'rgba(201,168,76,.4)'; ctx.lineWidth = 1;
            ctx.fillRect(lx - lw / 2, ly - 12, lw, 20); ctx.strokeRect(lx - lw / 2, ly - 12, lw, 20);
            ctx.fillStyle = pDiff >= 0 ? '#27ae60' : '#ef5350'; ctx.font = 'bold 10px DM Mono'; ctx.textAlign = 'center';
            ctx.fillText(label, lx, ly + 2);
          }
        } else if (measurePts.length >= 2) {
          var x1 = cpX(measurePts[0].bi, co), y1 = cpY(measurePts[0].price, co);
          var x2c = cpX(measurePts[1].bi, co), y2c = cpY(measurePts[1].price, co);
          var pDiff = measurePts[1].price - measurePts[0].price;
          var bDiff = measurePts[1].bi - measurePts[0].bi;
          var pct = (pDiff / measurePts[0].price * 100).toFixed(2);
          /* Box */
          ctx.fillStyle = pDiff >= 0 ? 'rgba(39,174,96,.08)' : 'rgba(239,83,80,.08)';
          ctx.fillRect(Math.min(x1, x2c), Math.min(y1, y2c), Math.abs(x2c - x1), Math.abs(y2c - y1));
          ctx.strokeStyle = pDiff >= 0 ? 'rgba(39,174,96,.5)' : 'rgba(239,83,80,.5)'; ctx.lineWidth = 1;
          ctx.strokeRect(Math.min(x1, x2c), Math.min(y1, y2c), Math.abs(x2c - x1), Math.abs(y2c - y1));
          /* Label */
          var label = (pDiff >= 0 ? '+' : '') + formatPrice(Math.abs(pDiff)) + ' (' + pct + '%)  ' + Math.abs(bDiff) + ' bars';
          var lx = (x1 + x2c) / 2, ly = Math.min(y1, y2c) - 8;
          var lw = ctx.measureText(label).width + 16;
          ctx.fillStyle = '#0d1018'; ctx.strokeStyle = pDiff >= 0 ? 'rgba(39,174,96,.5)' : 'rgba(239,83,80,.5)';
          ctx.fillRect(lx - lw / 2, ly - 14, lw, 20); ctx.strokeRect(lx - lw / 2, ly - 14, lw, 20);
          ctx.fillStyle = pDiff >= 0 ? '#27ae60' : '#ef5350'; ctx.font = 'bold 10px DM Mono'; ctx.textAlign = 'center';
          ctx.fillText(label, lx, ly);
          /* Reset after showing */
          /* Keep measurePts so it stays visible — cleared on next measure click */
        }
        ctx.restore();
      }

      var FIB_R = [[0, '0%'], [.236, '23.6%'], [.382, '38.2%'], [.5, '50%'], [.618, '61.8%'], [.786, '78.6%'], [1, '100%'], [1.272, '127.2%'], [1.618, '161.8%']];
      var FIB_C = ['#e74c3c', '#e67e22', '#f1c40f', '#27ae60', '#c9a84c', '#3498db', '#9b8fe8', '#e74c3c', '#2ecc71'];

      function drawOne(ctx, d, co, prev) {
        if (!co) return;
        ctx.save();
        var gold = d._color && !prev ? d._color : (prev ? 'rgba(201,168,76,.55)' : '#c9a84c');
        ctx.strokeStyle = gold; ctx.fillStyle = gold;
        ctx.lineWidth = 1.3; ctx.setLineDash(prev ? [5, 3] : []);

        /* ── Single-point types ── */
        if (d.type === 'hline') {
          var y = cpY(d.price, co);
          if (y < PAD.t || y > co.H - PAD.b) { ctx.restore(); return; }
          ctx.beginPath(); ctx.moveTo(PAD.l, y); ctx.lineTo(co.W - PAD.r, y); ctx.stroke();
          ctx.setLineDash([]); ctx.font = 'bold 10px DM Mono'; ctx.textAlign = 'right';
          ctx.fillStyle = 'rgba(201,168,76,.9)';
          ctx.fillText(formatPrice(d.price), co.W - PAD.r - 2, y - 3);
          ctx.restore(); return;
        }
        if (d.type === 'vline') {
          var x = cpX(d.bi, co);
          ctx.beginPath(); ctx.moveTo(x, PAD.t); ctx.lineTo(x, co.H - PAD.b); ctx.stroke();
          ctx.restore(); return;
        }
        if (d.type === 'text' || d.type === 'callout') {
          var tx = cpX(d.bi, co), ty = cpY(d.price, co);
          ctx.setLineDash([]);
          if (d.callout) {
            ctx.font = 'bold 10px DM Mono';
            var tw = ctx.measureText(d.label).width + 14;
            ctx.fillStyle = 'rgba(13,16,24,.88)'; ctx.strokeStyle = gold; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect ? ctx.roundRect(tx, ty - 20, tw, 18, 3) : ctx.rect(tx, ty - 20, tw, 18);
            ctx.fill(); ctx.stroke();
            ctx.fillStyle = gold; ctx.beginPath();
            ctx.moveTo(tx + 10, ty - 2); ctx.lineTo(tx + 6, ty + 5); ctx.lineTo(tx + 16, ty - 2); ctx.closePath(); ctx.fill();
          }
          ctx.font = 'bold 10px DM Mono'; ctx.fillStyle = gold; ctx.textAlign = 'left';
          ctx.fillText(d.label, tx + 4, ty - 5);
          ctx.restore(); return;
        }
        if (d.type === 'arrowmark') {
          var ax = cpX(d.bi, co), ay = cpY(d.price, co);
          ctx.setLineDash([]);
          ctx.fillStyle = d.dir === 'up' ? '#27ae60' : '#ef5350'; ctx.strokeStyle = ctx.fillStyle;
          ctx.beginPath();
          if (d.dir === 'up') { ctx.moveTo(ax, ay - 3); ctx.lineTo(ax - 7, ay + 8); ctx.lineTo(ax + 7, ay + 8); }
          else { ctx.moveTo(ax, ay + 3); ctx.lineTo(ax - 7, ay - 8); ctx.lineTo(ax + 7, ay - 8); }
          ctx.closePath(); ctx.fill();
          ctx.restore(); return;
        }

        /* Brush stroke — has no p1/p2, uses raw CSS pixel path */
        if (d.type === 'brush' && d.path && d.path.length > 1) {
          var bCol = d.color || '#c9a84c';
          ctx.strokeStyle = bCol; ctx.lineWidth = 2;
          ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.setLineDash([]);
          ctx.beginPath();
          ctx.moveTo(d.path[0].x, d.path[0].y);
          for (var _bi = 1; _bi < d.path.length - 1; _bi++) {
            var _cx = (d.path[_bi].x + d.path[_bi + 1].x) / 2;
            var _cy = (d.path[_bi].y + d.path[_bi + 1].y) / 2;
            ctx.quadraticCurveTo(d.path[_bi].x, d.path[_bi].y, _cx, _cy);
          }
          ctx.lineTo(d.path[d.path.length - 1].x, d.path[d.path.length - 1].y);
          if (d.closed) { ctx.closePath(); ctx.fillStyle = 'rgba(201,168,76,0.04)'; ctx.fill(); }
          ctx.stroke(); ctx.restore(); return;
        }

        /* ── Two-point types ── */
        if (!d.p1 || !d.p2) { ctx.restore(); return; }
        var x1, y1, x2, y2;
        if (d.pixelOnly) {
          /* Uploaded photo — use stored pixel coords directly */
          x1 = d.p1.x || 0; y1 = d.p1.y || 0; x2 = d.p2.x || 0; y2 = d.p2.y || 0;
        } else {
          x1 = cpX(d.p1.bi, co); y1 = cpY(d.p1.price, co);
          x2 = cpX(d.p2.bi, co); y2 = cpY(d.p2.price, co);
        }
        ctx.setLineDash(prev ? [5, 3] : []);

        /* Rectangle */
        if (d.shape === 'rect') {
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.fillStyle = 'rgba(201,168,76,.05)'; ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.restore(); return;
        }
        /* Gann Box */
        if (d.shape === 'gannbox') {
          var minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
          var minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
          var w = maxX - minX, h = maxY - minY;
          var levels = [0, 0.25, 0.382, 0.5, 0.618, 0.75, 1];
          var bgH = ['rgba(243,156,18,0.15)', 'rgba(26,188,156,0.15)', 'rgba(46,204,113,0.15)', 'rgba(52,152,219,0.15)', 'rgba(155,89,182,0.15)', 'rgba(149,165,166,0.15)'];
          var bgV = ['rgba(243,156,18,0.2)', 'rgba(26,188,156,0.2)', 'rgba(46,204,113,0.2)', 'rgba(52,152,219,0.2)', 'rgba(155,89,182,0.2)', 'rgba(149,165,166,0.2)'];
          var lineColors = ['#f39c12', '#1abc9c', '#2ecc71', '#3498db', '#9b59b6', '#34495e', '#7f8c8d'];

          // Fills
          for (var i = 0; i < levels.length - 1; i++) {
            var lx1 = minX + w * levels[i];
            var lw = w * (levels[i + 1] - levels[i]);
            ctx.fillStyle = bgV[i % bgV.length];
            ctx.fillRect(lx1, minY, lw, h);

            var ty1 = minY + h * levels[i];
            var th = h * (levels[i + 1] - levels[i]);
            ctx.fillStyle = bgH[i % bgH.length];
            ctx.fillRect(minX, ty1, w, th);
          }

          // Grid Lines
          ctx.setLineDash(prev ? [5, 3] : []);
          for (var i = 0; i < levels.length; i++) {
            ctx.strokeStyle = lineColors[i] || lineColors[lineColors.length - 1];
            ctx.beginPath();
            var yy1 = minY + h * levels[i];
            ctx.moveTo(minX, yy1); ctx.lineTo(maxX, yy1);
            ctx.stroke();

            ctx.beginPath();
            var xx1 = minX + w * levels[i];
            ctx.moveTo(xx1, minY); ctx.lineTo(xx1, maxY);
            ctx.stroke();

            // Labels
            ctx.font = '10px DM Mono'; ctx.fillStyle = ctx.strokeStyle;
            ctx.textAlign = 'center'; ctx.fillText(levels[i], xx1, minY - 4);
            ctx.textAlign = 'left'; ctx.fillText(levels[i], maxX + 4, yy1 + 3);
          }

          // Date tags on X axis (Show if active/drawn)
          var isHoveredOrActive = prev;
          if (!prev && hoverPoint) {
            if (hoverPoint.x >= minX - 10 && hoverPoint.x <= maxX + 10 && hoverPoint.y >= minY - 10 && hoverPoint.y <= maxY + 10) {
              isHoveredOrActive = true;
            }
          }

          if (isHoveredOrActive) {
            ctx.strokeStyle = 'rgba(138,149,168,.5)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, co.H); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, co.H); ctx.stroke();
            ctx.setLineDash([]);

            var drawTag = function (bx, pt) {
              if (!co.visible || !pt || pt.bi === undefined) return;
              var pbi = pt.bi - co.si;
              if (pbi >= 0 && pbi < co.visible.length) {
                var c = co.visible[pbi], d2 = new Date(c.t);
                var MO2 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                var days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
                var d2tz2 = tzDate(c.t);
                var dtStr = days[d2tz2.getUTCDay()] + ' ' + d2tz2.getUTCDate().toString().padStart(2, '0') + ' ' + MO2[d2tz2.getUTCMonth()] + " '" + d2tz2.getUTCFullYear().toString().slice(-2) + '  ' + d2tz2.getUTCHours().toString().padStart(2, '0') + ':' + d2tz2.getUTCMinutes().toString().padStart(2, '0');
                var dw = dtStr.length * 6.8 + 14;
                ctx.fillStyle = '#3b82f6';
                ctx.fillRect(Math.max(PAD.l, Math.min(co.W - PAD.r - dw, bx - dw / 2)), co.H - 18, dw, 17);
                ctx.fillStyle = '#ffffff'; ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'center';
                ctx.fillText(dtStr, Math.max(PAD.l + dw / 2, Math.min(co.W - PAD.r - dw / 2, bx)), co.H - 5);
              }
            };
            drawTag(x1, d.p1);
            if (Math.abs(x1 - x2) > 5) drawTag(x2, d.p2);
          }

          ctx.restore(); return;
        }
        /* Ellipse */
        if (d.shape === 'ellipse') {
          ctx.beginPath(); ctx.ellipse((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) / 2, Math.abs(y2 - y1) / 2, 0, 0, Math.PI * 2);
          ctx.stroke(); ctx.fillStyle = 'rgba(201,168,76,.05)'; ctx.fill();
          ctx.restore(); return;
        }
        /* Triangle */
        if (d.shape === 'triangle') {
          var mx = (x1 + x2) / 2;
          ctx.beginPath(); ctx.moveTo(mx, y1); ctx.lineTo(x2, y2); ctx.lineTo(x1, y2); ctx.closePath();
          ctx.stroke(); ctx.fillStyle = 'rgba(201,168,76,.05)'; ctx.fill();
          ctx.restore(); return;
        }

        /* Fibonacci Retracement */
        if (d.fibtype === 'retrace') {
          var hiP = Math.max(d.p1.price, d.p2.price), loP = Math.min(d.p1.price, d.p2.price), diff = hiP - loP;
          var lx = Math.min(x1, x2), rx = Math.max(x1, x2);
          FIB_R.forEach(function (lv, i) {
            var pr = hiP - lv[0] * diff, fy = cpY(pr, co);
            if (fy < PAD.t || fy > co.H - PAD.b) return;
            ctx.strokeStyle = FIB_C[i]; ctx.globalAlpha = .7; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(lx, fy); ctx.lineTo(rx, fy); ctx.stroke();
            ctx.globalAlpha = 1; ctx.setLineDash([]);
            ctx.font = 'bold 9px DM Mono'; ctx.fillStyle = FIB_C[i]; ctx.textAlign = 'left';
            ctx.fillText(lv[1] + ' ' + formatPrice(pr), rx + 3, fy + 3);
          });
          ctx.strokeStyle = gold; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.restore(); return;
        }
        /* Fibonacci Extension */
        if (d.fibtype === 'ext') {
          var hiP = Math.max(d.p1.price, d.p2.price), loP = Math.min(d.p1.price, d.p2.price), diff = hiP - loP;
          var extLevels = [[1, '100%'], [1.272, '127.2%'], [1.414, '141.4%'], [1.618, '161.8%'], [2, '200%'], [2.618, '261.8%']];
          var lx = Math.min(x1, x2), rx = Math.max(x1, x2) + 60;
          extLevels.forEach(function (lv, i) {
            var pr = d.p1.price > d.p2.price ? loP - lv[0] * diff : hiP + lv[0] * diff;
            var fy = cpY(pr, co);
            if (fy < 0 || fy > co.H) return;
            ctx.strokeStyle = FIB_C[i]; ctx.globalAlpha = .65; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.moveTo(lx, fy); ctx.lineTo(rx, fy); ctx.stroke();
            ctx.globalAlpha = 1; ctx.setLineDash([]);
            ctx.font = 'bold 9px DM Mono'; ctx.fillStyle = FIB_C[i]; ctx.textAlign = 'left';
            ctx.fillText(lv[1], rx + 3, fy + 3);
          });
          ctx.strokeStyle = gold; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.restore(); return;
        }
        /* Fibonacci Circles */
        if (d.fibtype === 'circle') {
          var baseR = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
          var circleLevels = [.382, .5, .618, 1, 1.618];
          circleLevels.forEach(function (lv, i) {
            var r = baseR * lv;
            ctx.strokeStyle = FIB_C[i]; ctx.globalAlpha = .55; ctx.setLineDash([3, 3]);
            ctx.beginPath(); ctx.arc(x1, y1, r, 0, Math.PI * 2); ctx.stroke();
          });
          ctx.globalAlpha = 1; ctx.setLineDash([]);
          ctx.strokeStyle = gold;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.beginPath(); ctx.arc(x1, y1, 4, 0, Math.PI * 2); ctx.fill();
          ctx.restore(); return;
        }
        /* Fibonacci Fan */
        if (d.fibtype === 'fan') {
          var fanLevels = [[.382, '38.2%'], [.5, '50%'], [.618, '61.8%'], [.786, '78.6%']];
          var baseX = x1, baseY = y1;
          var diffP = d.p2.price - d.p1.price;
          fanLevels.forEach(function (lv, i) {
            var fanP = d.p1.price + lv[0] * diffP;
            var fy = cpY(fanP, co);
            var dx = x2 - x1, dy = fy - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
            var ux = dx / len, uy = dy / len;
            ctx.strokeStyle = FIB_C[i]; ctx.globalAlpha = .7; ctx.setLineDash([]);
            ctx.beginPath(); ctx.moveTo(baseX, baseY); ctx.lineTo(baseX + ux * 2000, baseY + uy * 2000); ctx.stroke();
            ctx.font = 'bold 9px DM Mono'; ctx.fillStyle = FIB_C[i]; ctx.globalAlpha = 1; ctx.textAlign = 'left';
            ctx.fillText(lv[1], baseX + ux * 80, baseY + uy * 80 - 4);
          });
          ctx.globalAlpha = 1;
          ctx.strokeStyle = gold; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.restore(); return;
        }

        /* ── Fibonacci Spiral — logarithmic golden ratio spiral ── */
        if (d.fibtype === 'spiral') {
          var PHI = 1.6180339887;
          /* baseR = distance p1→p2 */
          var baseR = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
          if (baseR < 4) { ctx.restore(); return; }
          /* Initial angle: direction from p1 to p2 */
          var initAngle = Math.atan2(y2 - y1, x2 - x1);
          /* Draw spiral: r(θ) = baseR * PHI^(θ/(π/2))
             We draw 2.5 full turns = 5π radians */
          var TURNS = 5 * Math.PI;
          var steps = 200;
          ctx.save();
          ctx.translate(x1, y1);
          ctx.rotate(initAngle);
          /* Outer glow */
          ctx.strokeStyle = 'rgba(201,168,76,.15)'; ctx.lineWidth = 6; ctx.setLineDash([]);
          ctx.beginPath();
          for (var si3 = 0; si3 <= steps; si3++) {
            var theta = -(si3 / steps) * TURNS;
            var rr = baseR * Math.pow(PHI, theta / (Math.PI / 2));
            var sx3 = rr * Math.cos(theta), sy3 = rr * Math.sin(theta);
            si3 === 0 ? ctx.moveTo(sx3, sy3) : ctx.lineTo(sx3, sy3);
          }
          ctx.stroke();
          /* Main spiral line */
          ctx.strokeStyle = '#c9a84c'; ctx.lineWidth = 1.5;
          ctx.beginPath();
          for (var si3 = 0; si3 <= steps; si3++) {
            var theta = -(si3 / steps) * TURNS;
            var rr = baseR * Math.pow(PHI, theta / (Math.PI / 2));
            var sx3 = rr * Math.cos(theta), sy3 = rr * Math.sin(theta);
            si3 === 0 ? ctx.moveTo(sx3, sy3) : ctx.lineTo(sx3, sy3);
          }
          ctx.stroke();
          /* Mark key Fibonacci quarter-turn rings */
          var ringLevels = [[0, '1'], [1, 'φ'], [2, 'φ²'], [3, 'φ³'], [4, 'φ⁴'], [5, 'φ⁵']];
          ringLevels.forEach(function (lv, i) {
            var rRing = baseR * Math.pow(PHI, -lv[0]);
            if (rRing < 2 || rRing > baseR * 1.1) return;
            ctx.strokeStyle = FIB_C[i % FIB_C.length]; ctx.globalAlpha = .35; ctx.lineWidth = .7; ctx.setLineDash([2, 3]);
            ctx.beginPath(); ctx.arc(0, 0, rRing, 0, Math.PI * 2); ctx.stroke();
            ctx.globalAlpha = 1; ctx.setLineDash([]);
            ctx.fillStyle = FIB_C[i % FIB_C.length]; ctx.font = 'bold 8px DM Mono'; ctx.textAlign = 'left';
            ctx.fillText(lv[1], rRing + 3, -3);
          });
          /* Center + edge dots */
          ctx.fillStyle = gold; ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(0, 0, 3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(baseR, 0, 3, 0, Math.PI * 2); ctx.fill();
          ctx.restore(); /* undo translate+rotate */
          ctx.restore(); /* undo ctx.save at top of drawOne */
          return;
        }

        /* ── Fibonacci Time Zones ── */
        if (d.fibtype === 'timezones') {
          var fibNums = [0, 1, 2, 3, 5, 8, 13, 21, 34];
          var dx = x2 - x1;
          var chartTop = PAD.t, chartBot = co.H - PAD.b;
          ctx.font = 'bold 9px DM Mono';
          fibNums.forEach(function (n, i) {
            var vx = x1 + n * dx;
            if (vx < PAD.l - 2 || vx > co.W - PAD.r + 2) return;
            ctx.strokeStyle = FIB_C[i % FIB_C.length]; ctx.globalAlpha = .65; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(vx, chartTop); ctx.lineTo(vx, chartBot); ctx.stroke();
            ctx.globalAlpha = 1; ctx.setLineDash([]);
            ctx.fillStyle = FIB_C[i % FIB_C.length]; ctx.textAlign = 'center';
            ctx.fillText(String(n), vx, chartTop + 10);
          });
          ctx.fillStyle = gold;
          ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x2, y2, 3, 0, Math.PI * 2); ctx.fill();
          ctx.restore(); return;
        }

        /* ── Spiral Forecasting ── */
        if (d.fibtype === 'spiral_forecast') {
          var PHI = 1.6180339887;
          var baseR = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
          if (baseR < 4) { ctx.restore(); return; }
          var ang = Math.atan2(y2 - y1, x2 - x1);
          var arcLevels = [0.236, 0.382, 0.5, 0.618, 0.786, 1.0, 1.618, 2.618];
          /* Draw forward-facing arcs at each Fibonacci ratio */
          arcLevels.forEach(function (lv, i) {
            var r = baseR * lv;
            ctx.strokeStyle = FIB_C[i % FIB_C.length]; ctx.globalAlpha = .6; ctx.setLineDash([3, 3]); ctx.lineWidth = 1;
            ctx.beginPath(); ctx.arc(x1, y1, r, ang - Math.PI / 2, ang + Math.PI / 2); ctx.stroke();
            ctx.globalAlpha = 1; ctx.setLineDash([]);
            ctx.fillStyle = FIB_C[i % FIB_C.length]; ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'left';
            var tipX = x1 + r * Math.cos(ang), tipY = y1 + r * Math.sin(ang);
            ctx.fillText((lv * 100).toFixed(1) + '%', tipX + 3, tipY);
          });
          /* Golden spiral path connecting the arc tips */
          var spSteps = 120;
          ctx.strokeStyle = gold; ctx.globalAlpha = .45; ctx.lineWidth = 1; ctx.setLineDash([2, 3]);
          ctx.beginPath();
          for (var si = 0; si <= spSteps; si++) {
            var t = si / spSteps;
            var spAng = ang + t * Math.PI * 1.5;
            var spR = baseR * Math.pow(PHI, t * 2 - 2);
            var sx = x1 + spR * Math.cos(spAng), sy = y1 + spR * Math.sin(spAng);
            si === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
          }
          ctx.stroke();
          ctx.globalAlpha = 1; ctx.setLineDash([]);
          ctx.strokeStyle = gold; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.fillStyle = gold;
          ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x2, y2, 3, 0, Math.PI * 2); ctx.fill();
          ctx.restore(); return;
        }

        /* ── Fractal Spiral Models ── */
        if (d.fibtype === 'fractal_spiral') {
          var PHI = 1.6180339887;
          var baseR = Math.sqrt((x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1));
          if (baseR < 4) { ctx.restore(); return; }
          var initAngle = Math.atan2(y2 - y1, x2 - x1);
          var TURNS = 4 * Math.PI; var steps = 200;
          var drawFractalArm = function (cx, cy, bR, startAngle, alpha, colorIdx) {
            ctx.save(); ctx.translate(cx, cy); ctx.rotate(startAngle);
            ctx.globalAlpha = alpha; ctx.strokeStyle = FIB_C[colorIdx % FIB_C.length]; ctx.lineWidth = 1; ctx.setLineDash([]);
            ctx.beginPath();
            for (var si = 0; si <= steps; si++) {
              var theta = -(si / steps) * TURNS;
              var rr = bR * Math.pow(PHI, theta / (Math.PI / 2));
              var sx = rr * Math.cos(theta), sy = rr * Math.sin(theta);
              si === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
            }
            ctx.stroke(); ctx.restore();
          };
          /* Main spiral */
          drawFractalArm(x1, y1, baseR, initAngle, 0.85, 0);
          /* Two nested sub-spirals at φ⁻¹ and φ⁻² scale along spiral direction */
          var sub1R = baseR / PHI, sub1Ang = initAngle + Math.PI / 2;
          var sub1X = x1 + sub1R * Math.cos(sub1Ang), sub1Y = y1 + sub1R * Math.sin(sub1Ang);
          drawFractalArm(sub1X, sub1Y, sub1R, initAngle - Math.PI / 2, 0.5, 1);
          var sub2R = baseR / (PHI * PHI), sub2Ang = initAngle + Math.PI;
          var sub2X = x1 + sub2R * Math.cos(sub2Ang), sub2Y = y1 + sub2R * Math.sin(sub2Ang);
          drawFractalArm(sub2X, sub2Y, sub2R, initAngle + Math.PI / 2, 0.3, 2);
          /* Ring labels at φ powers */
          ctx.save(); ctx.translate(x1, y1); ctx.rotate(initAngle);
          [[0, '1'], [1, 'φ'], [2, 'φ²'], [3, 'φ³']].forEach(function (lv, i) {
            var rRing = baseR * Math.pow(PHI, -lv[0]);
            if (rRing < 2 || rRing > baseR * 1.05) return;
            ctx.strokeStyle = FIB_C[i % FIB_C.length]; ctx.globalAlpha = .25; ctx.lineWidth = .7; ctx.setLineDash([2, 3]);
            ctx.beginPath(); ctx.arc(0, 0, rRing, 0, Math.PI * 2); ctx.stroke();
            ctx.globalAlpha = 1; ctx.setLineDash([]);
            ctx.fillStyle = FIB_C[i % FIB_C.length]; ctx.font = 'bold 8px DM Mono'; ctx.textAlign = 'left';
            ctx.fillText(lv[1], rRing + 3, -3);
          });
          ctx.restore();
          ctx.fillStyle = gold; ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x2, y2, 3, 0, Math.PI * 2); ctx.fill();
          ctx.restore(); return;
        }

        /* ── Bar Pattern — 2-point anchor, TradingView style ── */
        if (d.barpattern) {
          var bars = d.candles || [];
          if (bars.length < 2) { ctx.restore(); return; }

          var origPmx = Math.max.apply(null, bars.map(function (c) { return c.h; }));
          var origPmn = Math.min.apply(null, bars.map(function (c) { return c.l; }));
          var origPrng = origPmx - origPmn || origPmx * .001 || .0001;

          /* Screen coords derived entirely from p1 (top-left) and p2 (bottom-right) */
          var x1 = PAD.l + (d.p1.bi - co.si) * co.barW;
          var y1 = cpY(d.p1.price, co);
          var x2 = PAD.l + (d.p2.bi - co.si) * co.barW;
          var y2 = cpY(d.p2.price, co);
          var gw = x2 - x1, gh = y2 - y1;
          if (Math.abs(gw) < 2 || Math.abs(gh) < 2) { d._rb = null; ctx.restore(); return; }

          var bw = gw / bars.length;

          /* gSY works for both normal and mirrored (negative gh) naturally */
          function gSY(v) { return y1 + ((origPmx - v) / origPrng) * gh; }

          ctx.setLineDash([]);
          bars.forEach(function (c, ii) {
            var isUp = c.c >= c.o;
            var gcx = x1 + (ii + 0.5) * bw;
            ctx.strokeStyle = isUp ? 'rgba(201,168,76,.95)' : 'rgba(201,168,76,.55)'; ctx.lineWidth = 1;
            /* Wick — min/max handles both normal and mirrored gh */
            var wyH = gSY(c.h), wyL = gSY(c.l);
            ctx.beginPath(); ctx.moveTo(gcx, Math.min(wyH, wyL)); ctx.lineTo(gcx, Math.max(wyH, wyL)); ctx.stroke();
            /* Body — use abs so it works when gh is negative */
            var sy1 = gSY(Math.max(c.o, c.c)), sy2 = gSY(Math.min(c.o, c.c));
            var top = Math.min(sy1, sy2), cbh = Math.max(1, Math.abs(sy2 - sy1));
            ctx.fillStyle = isUp ? 'rgba(201,168,76,.55)' : 'rgba(201,168,76,.18)';
            ctx.fillRect(gcx - Math.abs(bw) * .38, top, Math.abs(bw) * .76, cbh);
          });

          /* Label — anchor to whichever corner is top-left */
          var labelX = Math.min(x1, x2), labelY = Math.min(y1, y2);
          ctx.font = 'bold 8px DM Mono'; ctx.textAlign = 'left';
          ctx.fillStyle = 'rgba(201,168,76,.6)';
          ctx.fillText('◈ ' + bars.length + ' bars', labelX + 3, labelY - 3);

          /* 2 circle handles at actual p1/p2 positions */
          var HR = 6;
          [[x1, y1], [x2, y2]].forEach(function (h) {
            ctx.beginPath(); ctx.arc(h[0], h[1], HR, 0, Math.PI * 2);
            ctx.fillStyle = '#07090e'; ctx.fill();
            ctx.strokeStyle = 'rgba(201,168,76,.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([]); ctx.stroke();
          });

          /* Store render bounds — x1/y1/x2/y2 are actual handle positions,
             bx1/by1/bx2/by2 are the normalized bounding box for body hit testing */
          d._rb = {
            x1: x1, y1: y1, x2: x2, y2: y2,
            bx1: Math.min(x1, x2), by1: Math.min(y1, y2),
            bx2: Math.max(x1, x2), by2: Math.max(y1, y2), HR: HR
          };
          ctx.restore(); return;
        }

        /* Parallel Channel */
        if (d.channel === 'parallel') {
          var dy = y2 - y1;
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.strokeStyle = 'rgba(201,168,76,.5)'; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(x1, y1 - dy); ctx.lineTo(x2, y2 - dy); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(201,168,76,.03)';
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.lineTo(x2, y2 - dy); ctx.lineTo(x1, y1 - dy); ctx.closePath(); ctx.fill();
          ctx.restore(); return;
        }
        /* Flat Top/Bottom channel */
        if (d.channel === 'flat') {
          var flatY = y1; /* flat top = first click Y */
          ctx.beginPath(); ctx.moveTo(x1, flatY); ctx.lineTo(x2, flatY); ctx.stroke();
          ctx.strokeStyle = 'rgba(201,168,76,.5)'; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(x1, y2); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(201,168,76,.03)';
          ctx.fillRect(Math.min(x1, x2), Math.min(flatY, y2), Math.abs(x2 - x1), Math.abs(y2 - flatY));
          ctx.restore(); return;
        }

        /* Trend Angle */
        if (d.angle) {
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          /* Angle arc */
          var ang = Math.atan2(y1 - y2, x2 - x1);
          var deg = (ang * 180 / Math.PI).toFixed(1);
          ctx.strokeStyle = 'rgba(201,168,76,.4)'; ctx.setLineDash([2, 2]);
          ctx.beginPath(); ctx.arc(x1, y1, 28, 0, -ang, true); ctx.stroke();
          ctx.setLineDash([]);
          /* Horizontal reference */
          ctx.strokeStyle = 'rgba(201,168,76,.25)';
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x1 + 50, y1); ctx.stroke();
          /* Label */
          ctx.font = 'bold 10px DM Mono'; ctx.fillStyle = '#c9a84c'; ctx.textAlign = 'left';
          ctx.fillText(deg + '°', x1 + 32, y1 - 6);
          /* Dots */
          ctx.fillStyle = gold; ctx.setLineDash([]);
          ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill();
          ctx.beginPath(); ctx.arc(x2, y2, 3, 0, Math.PI * 2); ctx.fill();
          ctx.restore(); return;
        }

        /* Arrow line */
        if (d.arrowline) {
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          var ang2 = Math.atan2(y2 - y1, x2 - x1);
          ctx.save(); ctx.translate(x2, y2); ctx.rotate(ang2); ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(-11, -5); ctx.lineTo(-11, 5); ctx.closePath();
          ctx.fillStyle = gold; ctx.fill(); ctx.restore();
          ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill();
          ctx.restore(); return;
        }

        /* Standard line (trendline / ray / extended) */
        var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
        var ux = dx / len, uy = dy / len, ext = 5000;
        var sx1 = x1, sy1 = y1, sx2 = x2, sy2 = y2;
        if (d.ray || d.extended) { sx2 = x1 + ux * ext; sy2 = y1 + uy * ext; }
        if (d.extended) { sx1 = x1 - ux * ext; sy1 = y1 - uy * ext; }
        ctx.beginPath(); ctx.moveTo(sx1, sy1); ctx.lineTo(sx2, sy2); ctx.stroke();
        ctx.setLineDash([]);
        ctx.beginPath(); ctx.arc(x1, y1, 3, 0, Math.PI * 2); ctx.fill();
        if (!d.ray && !d.extended) { ctx.beginPath(); ctx.arc(x2, y2, 3, 0, Math.PI * 2); ctx.fill(); }
        ctx.restore();
      }

      /* ── Patch renderChart to call drawAnnotations ── */
      function patchRenderChart() {
        if (typeof renderChart !== 'function' || renderChart._fractalPatched) return;
        var orig = renderChart;
        renderChart = function () {
          /* Skip full repaint when an uploaded image is on canvas */
          if (typeof _uploadedMode !== 'undefined' && _uploadedMode) {
            var cv2 = document.getElementById('chartCanvas');
            if (cv2 && cv2.getContext) {
              var ctx2 = cv2.getContext('2d');
              var dpr3 = window.devicePixelRatio || 1;
              var W3 = cv2.width / dpr3, H3 = cv2.height / dpr3;
              drawAnnotations(ctx2, {
                W: W3, H: H3, CW: W3 - PAD.l - PAD.r, CH: H3 - PAD.t - PAD.b - PAD.vol,
                mn: 0, rng: 1, barW: 10, si: 0, visible: []
              });
            }
            return;
          }
          orig();
          var cv = document.getElementById('chartCanvas');
          if (!cv || !chartCandles || chartCandles.length < 2) return;
          var ctx = cv.getContext('2d');
          /* Use CSS pixel dimensions (divide DPR) so coords match getCoords output */
          var dpr2 = window.devicePixelRatio || 1;
          var W = cv.width / dpr2, H = cv.height / dpr2;
          var CW = W - _chartPAD.l - _chartPAD.r, CH = H - _chartPAD.t - _chartPAD.b - _chartPAD.vol;
          var barW = Math.max(1, viewState.scaleX);
          var si = Math.max(0, Math.floor(-viewState.offsetX / barW) - 1);
          var endIdx = Math.min(chartCandles.length, Math.ceil((CW - viewState.offsetX) / barW) + 2);
          var visible = chartCandles.slice(si, endIdx);
          var mn = viewState.priceMin, mx = viewState.priceMax;
          var rng = mx - mn || mn * .001 || .0001;
          drawAnnotations(ctx, { W: W, H: H, CW: CW, CH: CH, mn: mn, rng: rng, barW: barW, si: si, visible: visible });
          /* Sniper signal overlay */
          if (typeof window._drawSniperOverlay === 'function') window._drawSniperOverlay(ctx, W, H);
          /* Mobile crosshair overlay — drawn last so it's always on top */
          if (typeof window._drawMobCrosshair === 'function') window._drawMobCrosshair(ctx, W, H);
        };
        renderChart._fractalPatched = true;
      }

      /* ── Patch loadChart / onTfChange ── */
      function patchNav() {
        if (typeof loadChart === 'function' && !loadChart._fpatch) {
          var o = loadChart;
          loadChart = function (sym, tf) { window.drawings = []; drawings = window.drawings; measurePts = []; resetSnapBtnState(); o(sym, tf); };
          loadChart._fpatch = true;
        }
        if (typeof onTfChange === 'function' && !onTfChange._fpatch) {
          var o2 = onTfChange;
          onTfChange = function () { window.drawings = []; drawings = window.drawings; measurePts = []; resetSnapBtnState(); o2(); };
          onTfChange._fpatch = true;
        }
      }

      function resetSnapBtnState() {
        var btn = document.getElementById('snapBtn'), txt = document.getElementById('snapTxt'), az = document.getElementById('azBtn');
        if (txt) txt.textContent = 'Capture Chart';
        if (btn) { btn.style.borderColor = 'rgba(255,255,255,.12)'; btn.style.color = '#8a95a8'; }
        if (az) az.disabled = true;
        if (typeof dataUrl !== 'undefined') dataUrl = null;
      }

      /* ── Fullscreen ── */
      function addFullscreen() {
        var toolbar = document.querySelector('.az-bar');
        if (!toolbar || document.getElementById('fsBtn')) return;
        var btn = document.createElement('button');
        btn.id = 'fsBtn';
        btn.title = 'Fullscreen / Expand';
        btn.style.cssText = 'margin-left:auto;background:transparent;border:1px solid rgba(201,168,76,.2);color:rgba(201,168,76,.6);cursor:pointer;padding:4px 8px;font-size:11px;border-radius:2px;letter-spacing:.04em;font-family:DM Mono,monospace;white-space:nowrap';
        var isMobile = function () { return window.innerWidth <= 900; };

        function safeResize() {
          var dpr = window.devicePixelRatio || 1;
          var cv = document.getElementById('chartCanvas');
          if (!cv) return;
          var area = document.getElementById('chartArea');
          var p = cv.parentElement;
          var cssW = p ? p.clientWidth : 800;
          var cssH = (area && area.clientHeight > 100 ? area.clientHeight : 0) || parseInt(cv.style.height) || 560;
          if (cssH < 100) cssH = 560;
          cv.width = Math.round(cssW * dpr);
          cv.height = Math.round(cssH * dpr);
          cv.style.width = cssW + 'px';
          cv.style.height = cssH + 'px';
          if (chartCtx) chartCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
          if (typeof _uploadedMode !== 'undefined' && _uploadedMode && typeof dataUrl !== 'undefined' && dataUrl) {
            var img = new Image();
            img.onload = function () {
              chartCtx.drawImage(img, 0, 0, cssW, cssH);
              if (typeof drawAnnotations === 'function' && typeof PAD !== 'undefined') {
                drawAnnotations(chartCtx, { W: cssW, H: cssH, CW: cssW - PAD.l - PAD.r, CH: cssH - PAD.t - PAD.b - PAD.vol, mn: 0, rng: 1, barW: 10, si: 0, visible: [] });
              }
            };
            img.src = dataUrl;
          } else {
            if (typeof renderChart === 'function') renderChart();
          }
        }

        /* ── Full-screen tool picker (mobile expand mode) ── */
        function _showMobToolPicker(group, groupBtn) {
          var existing = document.getElementById('_mobToolPicker'); if (existing) existing.remove();
          var panel = document.getElementById('chartToolsPanel');
          var picker = document.createElement('div');
          picker.id = '_mobToolPicker';
          picker.style.cssText = 'position:absolute;inset:0;z-index:19000;background:#06080d;display:flex;flex-direction:column;overflow:hidden;';
          /* Header */
          var hdr = document.createElement('div');
          hdr.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(201,168,76,.2);flex-shrink:0;';
          var lbl = document.createElement('span');
          lbl.textContent = (group.label || 'Select Tool').toUpperCase();
          lbl.style.cssText = 'font-family:DM Mono,monospace;font-size:11px;color:#c9a84c;letter-spacing:.12em;';
          var cls = document.createElement('button');
          cls.textContent = '✕';
          cls.style.cssText = 'background:none;border:none;color:#8a95a8;font-size:20px;cursor:pointer;padding:2px 8px;line-height:1;';
          cls.onclick = function () { picker.remove(); };
          hdr.appendChild(lbl); hdr.appendChild(cls);
          picker.appendChild(hdr);
          /* Tool list */
          var list = document.createElement('div');
          list.style.cssText = 'flex:1;overflow-y:auto;padding:8px 0;';
          group.items.forEach(function (item) {
            var row = document.createElement('button');
            var isActive2 = (typeof activeItem !== 'undefined' && activeItem && activeItem.id === item.id) || (item.getState && item.getState());
            row.style.cssText = 'width:100%;padding:16px 20px;background:' + (isActive2 ? 'rgba(201,168,76,.1)' : 'transparent') + ';border:none;border-bottom:1px solid rgba(255,255,255,.06);color:' + (isActive2 ? '#f0d878' : 'rgba(240,244,250,.85)') + ';cursor:pointer;display:flex;align-items:center;gap:16px;font-family:DM Mono,monospace;font-size:13px;text-align:left;-webkit-tap-highlight-color:transparent;';
            row.innerHTML = item.icon + '<span>' + item.label + '</span>';
            row.addEventListener('touchend', function (e) {
              e.preventDefault();
              picker.remove();
              group._last = item;
              if (groupBtn) groupBtn.innerHTML = item.icon + '<span class="tb-arr"></span>';
              pickItem(item);
            });
            row.addEventListener('click', function (e) {
              e.stopPropagation();
              picker.remove();
              group._last = item;
              if (groupBtn) groupBtn.innerHTML = item.icon + '<span class="tb-arr"></span>';
              pickItem(item);
            });
            list.appendChild(row);
          });
          picker.appendChild(list);
          (panel || document.body).appendChild(picker);
        }

        /* ── Capture-phase interceptor: show picker instead of flyout when expanded ── */
        var _pickerCaptureHandler = function (e) {
          if (!_expanded) return;
          var btn2 = e.target.closest && e.target.closest('.tb-main');
          if (!btn2) return;
          var wrap = btn2.closest('.tb-group');
          if (!wrap || !wrap.querySelector('.tb-flyout')) return; /* single-item groups: let normal click proceed */
          e.stopPropagation(); e.preventDefault();
          var allWraps = Array.from(document.getElementById('drawToolbar').querySelectorAll('.tb-group'));
          var wrapIdx = allWraps.indexOf(wrap);
          var nonSepGroups = GROUPS.filter(function (g) { return g !== 'sep'; });
          var grp = nonSepGroups[wrapIdx];
          if (!grp || !grp.items || !grp.items.length) return;
          _showMobToolPicker(grp, btn2);
        };

        /* ── CSS expand mode for mobile (iOS/Android don't support fullscreen API) ── */
        var _expanded = false;
        var _expandStyle = null;
        function expandMobile() {
          var panel = document.getElementById('chartToolsPanel');
          if (!panel) return;
          if (!_expanded) {
            _expanded = true;
            _expandStyle = document.createElement('style');
            _expandStyle.id = '_fsStyle';
            var _toolbarDiv = panel.querySelector(':scope > div:first-child');
            var _toolbarH = _toolbarDiv ? _toolbarDiv.offsetHeight : 96;
            var _chartH = window.innerHeight - _toolbarH;
            _expandStyle.textContent =
              'body{overflow:hidden!important}' +
              '#chartToolsPanel{position:fixed!important;inset:0!important;z-index:9000!important;overflow:hidden!important;background:#06080d!important;}' +
              '#chartArea{height:' + _chartH + 'px!important;min-height:0!important;}' +
              '#aiCtrlRow,#uniDash,#rEmpty2{display:none!important}' +
              'nav,footer,#home,#how,#about,#tools,#pricing,.cta-sec,.az-wrap>p,.az-wrap>h2,.az-wrap>.sec-p{display:none!important}';
            document.head.appendChild(_expandStyle);
            /* Attach capture interceptor for tool group picks */
            var tb2 = document.getElementById('drawToolbar');
            if (tb2) { tb2.addEventListener('click', _pickerCaptureHandler, true); tb2.addEventListener('touchend', _pickerCaptureHandler, true); }
            /* Inject EXIT button inside the fixed panel */
            var eb = document.createElement('button');
            eb.id = '_mobExitBtn';
            eb.textContent = '✕ EXIT';
            eb.style.cssText = 'position:absolute;top:10px;right:10px;z-index:9001;background:rgba(239,83,80,.12);border:1px solid rgba(239,83,80,.35);color:#ef5350;cursor:pointer;padding:5px 12px;font-size:11px;font-family:DM Mono,monospace;border-radius:2px;letter-spacing:.04em';
            eb.onclick = expandMobile;
            panel.appendChild(eb);
            btn.innerHTML = '✕ EXIT'; btn.style.color = '#ef5350';
            setTimeout(safeResize, 100);
            panel.scrollTop = 0;
          } else {
            _expanded = false;
            var s = document.getElementById('_fsStyle'); if (s) s.remove();
            var eb = document.getElementById('_mobExitBtn'); if (eb) eb.remove();
            var pk = document.getElementById('_mobToolPicker'); if (pk) pk.remove();
            var tb2 = document.getElementById('drawToolbar');
            if (tb2) { tb2.removeEventListener('click', _pickerCaptureHandler, true); tb2.removeEventListener('touchend', _pickerCaptureHandler, true); }
            btn.innerHTML = '⛶ EXPAND'; btn.style.color = 'rgba(201,168,76,.6)';
            setTimeout(safeResize, 100);
          }
        }

        /* ── Native fullscreen for desktop ── */
        function expandDesktop() {
          var panel = document.getElementById('chartToolsPanel');
          if (!panel) return;
          if (!document.fullscreenElement) {
            var req = panel.requestFullscreen || panel.webkitRequestFullscreen || panel.mozRequestFullScreen;
            if (req) { req.call(panel); btn.innerHTML = '✕ EXIT'; setTimeout(safeResize, 300); }
            else expandMobile(); /* fallback */
          } else {
            var ex = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen;
            if (ex) ex.call(document);
            btn.innerHTML = '⛶ EXPAND';
            setTimeout(safeResize, 300);
          }
        }

        btn.innerHTML = '⛶ EXPAND';
        btn.onclick = function () { isMobile() ? expandMobile() : expandDesktop(); };

        document.addEventListener('fullscreenchange', function () {
          var isFs = !!document.fullscreenElement;
          var panel = document.getElementById('chartToolsPanel');
          var root = isFs ? panel : document.body;
          /* Move all floating popups into/out of the fullscreen element */
          ['ctxMenu', 'pairDropdown', 'capturePrompt'].forEach(function (id) {
            var el = document.getElementById(id);
            if (el && el.parentElement !== root) root.appendChild(el);
          });
          if (!isFs) { btn.innerHTML = '⛶ EXPAND'; btn.style.color = 'rgba(201,168,76,.6)'; }
          setTimeout(safeResize, 100);
        });

        /* Exit expand on Escape */
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape' && _expanded) expandMobile();
        });

        /* ── Theme Toggle ── */
        var themeBtn = document.createElement('button');
        themeBtn.id = 'themeToggleBtn';
        themeBtn.title = 'Switch Light/Dark Mode';
        themeBtn.style.cssText = 'margin-left:8px;background:transparent;border:1px solid rgba(201,168,76,.2);color:rgba(201,168,76,.6);cursor:pointer;padding:4px;width:26px;height:26px;display:flex;align-items:center;justify-content:center;border-radius:2px;flex-shrink:0';
        themeBtn.onclick = function() {
          setTheme(_chartTheme === 'dark' ? 'light' : 'dark');
        };
        // Set initial icon
        themeBtn.innerHTML = _chartTheme === 'light' ? 
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>' : 
          '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:block"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>';

        toolbar.appendChild(btn);
        toolbar.appendChild(themeBtn);
      }

      /* ── Nearest drawing helper — shared by keyboard shortcuts and context menu ── */
      function _nearestDrawing(co) {
        if (!co || !co.visible || co.visible.length < 2) return -1;
        var HIT = 20, best = -1, bestD = HIT;
        for (var i = 0; i < drawings.length; i++) {
          var d = drawings[i]; var dist = 9999;
          if (d.barpattern && d._rb) {
            var rb = d._rb;
            if (co.x >= rb.gbx - 6 && co.x <= rb.gbx + rb.gwTotal + 6 && co.y >= rb.gby - 18 && co.y <= rb.gby + rb.gh + 18) dist = 0;
          } else if (d.type === 'hline') { dist = Math.abs(cpY(d.price, co) - co.y); }
          else if (d.type === 'vline') { dist = Math.abs(cpX(d.bi, co) - co.x); }
          else if (d.type === 'arrowmark' || d.type === 'text' || d.type === 'callout') {
            dist = Math.sqrt(Math.pow(cpX(d.bi, co) - co.x, 2) + Math.pow(cpY(d.price, co) - co.y, 2));
          } else if (d.p1 && d.p2) {
            var px1 = cpX(d.p1.bi, co), py1 = cpY(d.p1.price, co);
            var px2 = cpX(d.p2.bi, co), py2 = cpY(d.p2.price, co);
            var ldx = px2 - px1, ldy = py2 - py1, ll = ldx * ldx + ldy * ldy;
            var lt = ll ? Math.max(0, Math.min(1, ((co.x - px1) * ldx + (co.y - py1) * ldy) / ll)) : 0;
            dist = Math.sqrt(Math.pow(co.x - px1 - lt * ldx, 2) + Math.pow(co.y - py1 - lt * ldy, 2));
          }
          if (dist < bestD) { bestD = dist; best = i; }
        }
        return best;
      }

      /* Keyboard shortcuts */
      document.addEventListener('keydown', function (e) {
        if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); doUndo(); }
        if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.shiftKey && e.key === 'z'))) { e.preventDefault(); doRedo(); }
        if (e.key === 'Escape') { _bpClick1 = null; isDrawing = false; drawStart = null; renderChart && renderChart(); }
        /* Delete / Backspace — remove drawing under cursor */
        if (e.key === 'Delete' || e.key === 'Backspace') {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
          if (!hoverPoint) return;
          var di = _nearestDrawing(hoverPoint);
          if (di >= 0 && !drawings[di]._locked) { e.preventDefault(); saveUndo(); drawings.splice(di, 1); renderChart(); }
        }
        /* L — toggle lock on hovered drawing */
        if (e.key === 'l' || e.key === 'L') {
          if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
          if (!hoverPoint) return;
          var li = _nearestDrawing(hoverPoint);
          if (li >= 0) { drawings[li]._locked = !drawings[li]._locked; renderChart(); }
        }
      });

      window.addEventListener('load', function () {
        chartCanvas = document.getElementById('chartCanvas');
        if (chartCanvas) { chartCtx = chartCanvas.getContext('2d'); resizeCanvas(); }
        buildToolbar();
        buildColorPicker();
        initDrawEvents();
        patchRenderChart();
        patchNav();
        addFullscreen();

        /* ── Expose IIFE internals via window._fx for the context menu script ── */
        window._fx = {
          get drawings() { return drawings; },
          get activeItem() { return activeItem; },
          get magnetOn() { return magnetOn; },
          set magnetOn(v) { magnetOn = v; },
          get undoStack() { return undoStack; },
          get redoStack() { return redoStack; },
          get chartView() { return chartView; },
          get hoverPoint() { return hoverPoint; },
          get _bpDrag() { return _bpDrag; },
          get _drawDrag() { return _drawDrag; },
          PAD: PAD,
          GROUPS: GROUPS,
          cpX: cpX,
          cpY: cpY,
          pickItem: function (item) { pickItem(item); },
          saveUndo: function () { saveUndo(); },
          doUndo: function () { doUndo(); },
          doRedo: function () { doRedo(); },
          buildToolbar: function () { buildToolbar(); },
          renderChart: function () { if (typeof renderChart === 'function') renderChart(); },
          nearestDrawing: _nearestDrawing
        };

        /* ── Auto-load GOLD from Capital on startup ── */
        var _pairInput = document.getElementById('pairIn');
        if (_pairInput) _pairInput.value = 'GOLD';
        setTimeout(function () {
          if (typeof selectPairWithSource === 'function') selectPairWithSource('GOLD', 'capital');
        }, 100);
      });
    })();
    /* ══════════════════════════════════════════════════════
       STRIPE — PLAN + FEATURE SUBSCRIPTIONS
       ══════════════════════════════════════════════════════ */

    /* ── Plan checkout ── */
    async function startCheckout(plan, btn) {
      var token = localStorage.getItem('fractal_token');
      if (!token) { alert('Please sign in first to subscribe.'); window.location.href = '/auth'; return; }
      if (btn) { btn.disabled = true; btn.textContent = 'Redirecting…'; }
      try {
        var res = await fetch('/create-checkout', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ plan: plan, token: token }) });
        var data = await res.json();
        if (data.url) { window.location.href = data.url; }
        else { alert('Error: ' + (data.error || 'Could not create checkout session')); if (btn) { btn.disabled = false; btn.textContent = 'Get Started'; } }
      } catch (e) { alert('Network error: ' + e.message); if (btn) { btn.disabled = false; btn.textContent = 'Get Started'; } }
    }

    /* ── Feature status ── */
    window._featureStatus = { fib_spiral: false, fractal_spiral: false, fractal_geometry: false };

    async function loadFeatureStatus() {
      var token = localStorage.getItem('fractal_token');
      if (!token) return;
      try {
        var r = await fetch('/feature-status', { headers: { 'Authorization': 'Bearer ' + token } });
        if (r.ok) { window._featureStatus = await r.json(); }
      } catch (e) {}
    }
    loadFeatureStatus();

    /* ── Feature modal ── */
    var _FEATURE_META = {
      fib_spiral:       { name: 'Fibonacci Spiral',     price: '$15/mo', desc: 'Logarithmic spiral overlay for detecting fractal turning points on price.' },
      fractal_spiral:   { name: 'Fractal Spiral Model', price: '$25/mo', desc: 'Multi-level spiral pattern engine that projects nested fractal cycles.' },
      fractal_geometry: { name: 'Fractal Geometry',     price: '$15/mo', desc: 'Alternating MA-cross bridge levels revealing machine-learning support/resistance zones.' },
    };

    window.showFeatureModal = function (feature) {
      var id = 'featureModal_' + feature;
      var existing = document.getElementById(id);
      if (existing) { existing.style.display = 'flex'; return; }
      var m = _FEATURE_META[feature] || { name: feature, price: '', desc: '' };
      var modal = document.createElement('div');
      modal.id = id;
      modal.style.cssText = 'position:fixed;inset:0;background:rgba(6,8,13,.92);z-index:9999;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:20px;padding:32px;text-align:center';
      modal.innerHTML =
        '<div style="font-size:28px">◈</div>'
        + '<div style="font-family:Cinzel,serif;font-size:18px;color:var(--white);font-weight:600;letter-spacing:.06em">' + m.name + '</div>'
        + '<div style="font-family:DM Mono,monospace;font-size:11px;color:var(--gold);letter-spacing:.1em;border:1px solid rgba(201,168,76,.3);padding:6px 18px;background:rgba(201,168,76,.06)">' + m.price + ' — SUBSCRIPTION</div>'
        + '<div style="font-size:13px;color:var(--muted);max-width:360px;line-height:1.85">' + m.desc + '</div>'
        + '<div style="display:flex;gap:12px">'
        + '<button onclick="window.closeFeatureModal(\'' + feature + '\')" style="font-family:DM Mono,monospace;font-size:10px;padding:10px 22px;background:transparent;border:1px solid rgba(255,255,255,.12);color:var(--muted);cursor:pointer;border-radius:1px">Cancel</button>'
        + '<button id="featurePayBtn_' + feature + '" onclick="window.payForFeature(\'' + feature + '\')" style="font-family:Cinzel,serif;font-size:11px;letter-spacing:.1em;padding:12px 32px;background:var(--gold);color:var(--dark);border:none;cursor:pointer;font-weight:600;border-radius:1px">Subscribe with Stripe</button>'
        + '</div>'
        + '<div style="font-family:DM Mono,monospace;font-size:9px;color:rgba(138,149,168,.4)">Secured by Stripe · Cancel anytime</div>';
      document.body.appendChild(modal);
    };

    window.closeFeatureModal = function (feature) {
      var m = document.getElementById('featureModal_' + feature);
      if (m) m.style.display = 'none';
      if (typeof GROUPS !== 'undefined' && typeof pickItem === 'function') pickItem(GROUPS[0].items[0]);
    };

    window.payForFeature = async function (feature) {
      var token = localStorage.getItem('fractal_token');
      if (!token) { alert('Please sign in first.'); return; }
      var btn = document.getElementById('featurePayBtn_' + feature);
      if (btn) { btn.disabled = true; btn.textContent = 'Redirecting to Stripe…'; }
      var endpoint = '/' + feature.replace(/_/g, '-') + '-checkout';
      try {
        var res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: token }) });
        var data = await res.json();
        if (data.url) { window.location.href = data.url; }
        else { alert('Error: ' + (data.error || 'Could not start payment')); if (btn) { btn.disabled = false; btn.textContent = 'Subscribe with Stripe'; } }
      } catch (e) { alert('Network error: ' + e.message); if (btn) { btn.disabled = false; btn.textContent = 'Subscribe with Stripe'; } }
    };

    /* ── Handle Stripe redirect back after feature payment ── */
    (function () {
      var params = new URLSearchParams(window.location.search);
      var feature = params.get('feature_paid');
      if (!feature) return;
      window.history.replaceState({}, '', window.location.pathname);
      /* Wait briefly for webhook to process, then refresh status */
      setTimeout(function () {
        loadFeatureStatus().then(function () {
          var names = { fib_spiral: 'Fibonacci Spiral', fractal_spiral: 'Fractal Spiral Model', fractal_geometry: 'Fractal Geometry' };
          var toast = document.createElement('div');
          toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:rgba(201,168,76,.1);border:1px solid rgba(201,168,76,.4);color:var(--gold);font-family:DM Mono,monospace;font-size:11px;padding:14px 20px;z-index:9999;border-radius:2px;letter-spacing:.04em';
          toast.textContent = '◈ ' + (names[feature] || 'Feature') + ' unlocked';
          document.body.appendChild(toast);
          setTimeout(function () { toast.remove(); }, 5000);
        });
      }, 2000);
    })();

    /* ── Plan checkout success toast ── */
    (function () {
      var params = new URLSearchParams(window.location.search);
      if (params.get('checkout') === 'success') {
        var plan = params.get('plan') || 'plan';
        window.history.replaceState({}, '', window.location.pathname);
        var toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:rgba(39,174,96,.12);border:1px solid rgba(39,174,96,.4);color:#27ae60;font-family:DM Mono,monospace;font-size:11px;padding:14px 20px;z-index:9999;border-radius:2px';
        toast.textContent = '✓ ' + plan.charAt(0).toUpperCase() + plan.slice(1) + ' plan activated — credits added to your account';
        document.body.appendChild(toast);
        setTimeout(function () { toast.remove(); }, 6000);
      }
    })();
    (function () {
      'use strict';
      var M = document.getElementById('ctxMenu');
      var _open = false;

      function svgi(p) { return '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="12" height="12">' + p + '</svg>'; }
      function close() { M.style.display = 'none'; _open = false; }
      function pos(x, y) {
        M.style.display = 'flex'; M.style.flexDirection = 'column';
        var mw = M.offsetWidth || 210, mh = M.offsetHeight || 220;
        M.style.left = Math.min(x, window.innerWidth - mw - 6) + 'px';
        M.style.top = Math.min(y, window.innerHeight - mh - 6) + 'px';
      }

      function btn(ico, label, cls, fn) {
        var b = document.createElement('button');
        b.className = 'cx-btn' + (cls ? ' ' + cls : '');
        b.innerHTML = (ico ? svgi(ico) : '') + ' <span style="flex:1;text-align:left">' + label + '</span>';
        b.onmousedown = function (e) { e.stopPropagation(); };
        b.onclick = function (e) { e.stopPropagation(); try { fn(); } catch (x) { } close(); };
        return b;
      }
      function sep() { var d = document.createElement('div'); d.className = 'cx-sep'; return d; }
      function sec(t) { var d = document.createElement('div'); d.className = 'cx-sec'; d.textContent = t; return d; }
      function hint(t) { var d = document.createElement('div'); d.className = 'cx-hint'; d.textContent = t; return d; }

      /* Colour library */
      var COLS = [
        { c: '#c9a84c', n: 'Gold' }, { c: '#f0d878', n: 'Yellow' }, { c: '#f39c12', n: 'Orange' },
        { c: '#ef5350', n: 'Red' }, { c: '#e91e63', n: 'Pink' }, { c: '#9b59b6', n: 'Purple' },
        { c: '#3498db', n: 'Blue' }, { c: '#26a69a', n: 'Teal' }, { c: '#2ecc71', n: 'Green' },
        { c: '#ffffff', n: 'White' }, { c: '#8a95a8', n: 'Grey' }, { c: '#000000', n: 'Black' }
      ];

      function colorPalette(d, renderFn) {
        var wrap = document.createElement('div'); wrap.className = 'cx-colors';
        COLS.forEach(function (cc) {
          var sw = document.createElement('button');
          sw.className = 'cx-swatch' + (d._color === cc.c ? ' on' : '');
          sw.style.background = cc.c; sw.title = cc.n;
          sw.onmousedown = function (e) { e.stopPropagation(); };
          sw.onclick = function (e) {
            e.stopPropagation();
            d._color = cc.c;
            wrap.querySelectorAll('.cx-swatch').forEach(function (s) { s.classList.remove('on'); });
            sw.classList.add('on');
            renderFn();
          };
          wrap.appendChild(sw);
        });
        /* Reset-to-default swatch */
        var rst = document.createElement('button');
        rst.className = 'cx-swatch'; rst.title = 'Default (gold)';
        rst.style.cssText = 'background:linear-gradient(135deg,#c9a84c 50%,#222 50%)';
        rst.onmousedown = function (e) { e.stopPropagation(); };
        rst.onclick = function (e) { e.stopPropagation(); delete d._color; renderFn(); close(); };
        wrap.appendChild(rst);
        return wrap;
      }

      function f() { return window._fx || null; }

      /* ── Drawing sub-menu ── */
      function showDrawing(idx, x, y) {
        var fx = f(); if (!fx) return;
        var d = fx.drawings[idx]; if (!d) return;
        M.innerHTML = '';

        var typeName = d.barpattern ? 'BAR PATTERN' : (d.type || 'drawing').toUpperCase();
        M.appendChild(sec(typeName));

        /* Colour palette */
        M.appendChild(colorPalette(d, function () { fx.renderChart(); }));
        M.appendChild(sep());

        /* Lock / Unlock */
        M.appendChild(btn(
          d._locked
            ? '<rect x="4" y="8" width="8" height="6" rx="1"/><path d="M6 8V6a2 2 0 014 0v2"/><circle cx="8" cy="11" r="1" fill="currentColor" stroke="none"/>'
            : '<rect x="4" y="8" width="8" height="6" rx="1"/><path d="M6 8V5a2 2 0 014 0"/>',
          d._locked ? 'Unlock' : 'Lock position', '',
          function () { d._locked = !d._locked; fx.renderChart(); }
        ));

        /* Clone */
        M.appendChild(btn(
          '<rect x="5" y="5" width="8" height="9" rx="1"/><rect x="3" y="3" width="8" height="9" rx="1"/>',
          'Clone', '', function () {
            var c = JSON.parse(JSON.stringify(d)); c._auto = false;
            if (c.ghostAnchorBi !== undefined) c.ghostAnchorBi += 5;
            if (c.p1) c.p1.bi += 5; if (c.p2) c.p2.bi += 5;
            if (c.bi !== undefined) c.bi += 5;
            fx.saveUndo(); fx.drawings.splice(idx + 1, 0, c); fx.renderChart();
          }
        ));

        /* Mirror */
        M.appendChild(btn(
          '<line x1="8" y1="2" x2="8" y2="14"/><path d="M11 5l3 3-3 3"/><path d="M5 5l-3 3 3 3"/>',
          'Mirror horizontal', '', function () {
            fx.saveUndo();
            if (d.barpattern && d.candles) d.candles = d.candles.slice().reverse();
            else if (d.p1 && d.p2) {
              var mid = (d.p1.bi + d.p2.bi) / 2;
              var b1 = Math.round(2 * mid - d.p2.bi), b2 = Math.round(2 * mid - d.p1.bi);
              d.p1.bi = b1; d.p2.bi = b2;
            }
            fx.renderChart();
          }
        ));

        /* Flip vertical — 2-point drawings only */
        if (d.p1 && d.p2) {
          M.appendChild(btn(
            '<line x1="2" y1="8" x2="14" y2="8"/><path d="M5 11l3 3 3-3"/><path d="M5 5l3-3 3 3"/>',
            'Flip vertical', '', function () {
              fx.saveUndo();
              var tmp = d.p1.price; d.p1.price = d.p2.price; d.p2.price = tmp;
              fx.renderChart();
            }
          ));
        }

        M.appendChild(sep());
        M.appendChild(btn('<path d="M8 3v10M3 8l5-5 5 5"/>', 'Bring to front', '', function () {
          fx.saveUndo(); var dd = fx.drawings.splice(idx, 1)[0]; fx.drawings.push(dd); fx.renderChart();
        }));
        M.appendChild(btn('<path d="M8 13V3M3 8l5 5 5-5"/>', 'Send to back', '', function () {
          fx.saveUndo(); var dd = fx.drawings.splice(idx, 1)[0]; fx.drawings.unshift(dd); fx.renderChart();
        }));
        M.appendChild(sep());
        M.appendChild(btn(
          '<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>',
          'Delete   Del', 'red', function () {
            fx.saveUndo(); fx.drawings.splice(idx, 1); fx.renderChart();
          }
        ));

        pos(x, y); _open = true;
      }

      /* ── Canvas right-click menu ── */
      function showCanvas(x, y, idx) {
        var fx = f(); if (!fx) return;
        M.innerHTML = '';

        /* Drawing quick-actions if nearby */
        if (idx >= 0) {
          var d = fx.drawings[idx];
          M.appendChild(sec((d.barpattern ? 'BAR PATTERN' : (d.type || '').toUpperCase()) || 'DRAWING'));
          M.appendChild(colorPalette(d, function () { fx.renderChart(); }));
          M.appendChild(btn(
            d._locked ? '<rect x="4" y="8" width="8" height="6" rx="1"/><path d="M6 8V6a2 2 0 014 0v2"/>' : '<rect x="4" y="8" width="8" height="6" rx="1"/><path d="M6 8V5a2 2 0 014 0"/>',
            d._locked ? 'Unlock' : 'Lock', '', function () { d._locked = !d._locked; fx.renderChart(); }
          ));
          M.appendChild(btn('<rect x="5" y="5" width="8" height="9" rx="1"/><rect x="3" y="3" width="8" height="9" rx="1"/>', 'Clone', '', function () {
            var c = JSON.parse(JSON.stringify(d)); c._auto = false;
            if (c.ghostAnchorBi !== undefined) c.ghostAnchorBi += 5;
            if (c.p1) c.p1.bi += 5; if (c.p2) c.p2.bi += 5;
            fx.saveUndo(); fx.drawings.splice(idx + 1, 0, c); fx.renderChart();
          }));
          M.appendChild(btn('<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>', 'Delete   Del', 'red', function () {
            fx.saveUndo(); fx.drawings.splice(idx, 1); fx.renderChart();
          }));
          M.appendChild(sep());
        }

        /* Edit */
        M.appendChild(sec('Edit'));
        M.appendChild(btn('<path d="M3 8a6 6 0 101 6"/><path d="M3 4v4h4"/>', 'Undo   Ctrl+Z',
          (fx.undoStack && fx.undoStack.length) ? '' : 'dim', function () { fx.doUndo(); }));
        M.appendChild(btn('<path d="M13 8a6 6 0 10-1 6"/><path d="M13 4v4h-4"/>', 'Redo   Ctrl+Y',
          (fx.redoStack && fx.redoStack.length) ? '' : 'dim', function () { fx.doRedo(); }));
        M.appendChild(btn(
          '<path d="M2 12l9-9 4 4-9 9z"/>', 'Clear all drawings', 'red',
          function () { fx.saveUndo(); fx.drawings.splice(0, fx.drawings.length); fx.renderChart(); }
        ));
        M.appendChild(btn(
          '<circle cx="8" cy="8" r="5.5"/><line x1="5.5" y1="5.5" x2="10.5" y2="10.5"/><line x1="10.5" y1="5.5" x2="5.5" y2="10.5"/>', 'Clear all tools', 'red',
          function () { window.vpvrOn = window.liqHeatmapOn = window.volBubblesOn = window.hurstOn = window.garchBandsOn = window.fractalSignalOn = window.kalmanOn = window.gbmOn = window.ouOn = window.maCascadeOn = window.fractalPathsOn = window.fractalOverlayOn = false; window.fractalResult = null; fx.buildToolbar(); fx.renderChart(); }
        ));
        M.appendChild(sep());

        /* Chart */
        M.appendChild(sec('Chart'));
        M.appendChild(btn(
          '<path d="M5 3a4 4 0 016 0v4"/><rect x="3" y="8" width="10" height="5" rx="1"/>',
          (fx.magnetOn ? '✓ ' : '') + 'Magnet snap', '',
          function () { fx.magnetOn = !fx.magnetOn; fx.buildToolbar(); }
        ));
        M.appendChild(btn(
          '<rect x="2" y="4" width="12" height="10" rx="1"/><circle cx="8" cy="9" r="2"/><path d="M5 4l1-2h4l1 2"/>',
          'Capture snapshot', '', function () { var b = document.getElementById('snapBtn'); if (b) b.click(); }
        ));
        M.appendChild(btn('<path d="M4 8h8M8 4v8"/>', 'Reset zoom / pan', '', function () {
          if (fx.chartView) { fx.chartView.zoom = 1; fx.chartView.offset = 0; } fx.renderChart();
        }));
        M.appendChild(sep());
        M.appendChild(hint('Del=delete  L=lock  Ctrl+Z=undo  Esc=cancel'));

        pos(x, y); _open = true;
      }

      /* ── Wire events ── */
      function init() {
        var cv = document.getElementById('chartCanvas');
        if (!cv) { setTimeout(init, 400); return; }

        /* Right-click → canvas menu (desktop) */
        cv.addEventListener('contextmenu', function (e) {
          e.preventDefault();
          var fx = f(); if (!fx) return;
          var hp = fx.hoverPoint;
          var idx = (hp && fx.nearestDrawing) ? fx.nearestDrawing(hp) : -1;
          showCanvas(e.clientX, e.clientY, idx);
        });

        /* Left-click on drawing → drawing sub-menu (desktop) */
        var _mdX = 0, _mdY = 0;
        cv.addEventListener('mousedown', function (e) { _mdX = e.clientX; _mdY = e.clientY; }, true);
        cv.addEventListener('click', function (e) {
          if (Math.sqrt(Math.pow(e.clientX - _mdX, 2) + Math.pow(e.clientY - _mdY, 2)) > 5) return;
          var fx = f(); if (!fx) return;
          var ai = fx.activeItem;
          if (!ai || !(ai.id === 'cursor' || ai.id === 'arrow_cur' || ai.id === 'dot')) return;
          if (fx._bpDrag || fx._drawDrag) return;
          var hp = fx.hoverPoint; if (!hp || !hp.visible || hp.visible.length < 2) return;
          var idx = fx.nearestDrawing(hp); if (idx < 0) return;
          showDrawing(idx, e.clientX + 16, e.clientY);
        });

        /* ── Long-press → context menu on mobile ── */
        var _lpTimer = null;
        var _lpX = 0, _lpY = 0, _lpMoved = false;
        var LP_MS = 520; /* ms to hold before menu appears */

        cv.addEventListener('touchstart', function (e) {
          if (e.touches.length !== 1) return;
          _lpMoved = false;
          _lpX = e.touches[0].clientX;
          _lpY = e.touches[0].clientY;
          _lpTimer = setTimeout(function () {
            if (_lpMoved) return;
            /* Vibrate if supported — gives tactile feedback */
            if (navigator.vibrate) navigator.vibrate(40);
            var fx = f(); if (!fx) return;
            var hp = fx.hoverPoint;
            var idx = (hp && fx.nearestDrawing) ? fx.nearestDrawing(hp) : -1;
            /* If cursor mode and near a drawing → drawing sub-menu */
            var ai = fx.activeItem;
            var cursorMode = !ai || (ai.id === 'cursor' || ai.id === 'arrow_cur' || ai.id === 'dot');
            if (cursorMode && idx >= 0) {
              showDrawing(idx, _lpX, _lpY);
            } else {
              /* Otherwise → canvas menu */
              showCanvas(_lpX, _lpY, idx);
            }
          }, LP_MS);
        }, { passive: true });

        cv.addEventListener('touchmove', function (e) {
          if (!_lpTimer) return;
          var dx = e.touches[0].clientX - _lpX;
          var dy = e.touches[0].clientY - _lpY;
          /* Cancel long-press if finger moved more than 8px */
          if (Math.sqrt(dx * dx + dy * dy) > 8) {
            _lpMoved = true;
            clearTimeout(_lpTimer);
            _lpTimer = null;
          }
        }, { passive: true });

        cv.addEventListener('touchend', function () {
          clearTimeout(_lpTimer);
          _lpTimer = null;
        }, { passive: true });

        cv.addEventListener('touchcancel', function () {
          clearTimeout(_lpTimer);
          _lpTimer = null;
        }, { passive: true });

        /* Close on outside tap/click or Escape */
        document.addEventListener('mousedown', function (e) {
          if (_open && !M.contains(e.target)) close();
        });
        document.addEventListener('touchstart', function (e) {
          if (_open && !M.contains(e.target)) close();
        }, { passive: true });
        document.addEventListener('keydown', function (e) {
          if (e.key === 'Escape') close();
        });
      }

      window.addEventListener('load', function () { setTimeout(init, 500); });
    })();

  <!-- ── Strategy Report Panel JS ── -->
    (function () {

      /* ── helpers ── */
      function srpCtx(id, w, h) {
        var c = document.getElementById(id); if (!c) return null;
        var dpr = window.devicePixelRatio || 1;
        c.width = (c.offsetWidth || w) * dpr;
        c.height = (c.offsetHeight || h) * dpr;
        var ctx = c.getContext('2d'); ctx.scale(dpr, dpr); ctx.clearRect(0, 0, c.width, c.height);
        return { ctx: ctx, W: c.offsetWidth || w, H: c.offsetHeight || h };
      }

      /* Tab switching */
      window._srpTab = function (btn) {
        var tab = btn.dataset.tab;
        document.querySelectorAll('.srp-tab').forEach(function (b) { 
          b.style.background = 'transparent'; 
          b.style.color = '#787b86'; 
        });
        btn.style.background = '#2a2e39';
        btn.style.color = '#2962ff';
        
        document.querySelectorAll('.srp-pane').forEach(function (p) { p.style.display = 'none'; });
        var pane = document.getElementById('srp-' + tab);
        if (pane) {
          pane.style.display = 'block';
          pane.style.flexDirection = 'column';
        }
        var r = window._srpLastResult;
        if (!r) return;
        setTimeout(function () {
          if (tab === 'metrics') {
            _drawEquityChart(document.getElementById('srp-equity-canvas'), r);
            _drawPerformanceCharts(r);
            if (window._eqChart && typeof window._eqChart.resize === 'function') window._eqChart.resize();
            if (window._myWaterfallChart && typeof window._myWaterfallChart.resize === 'function') window._myWaterfallChart.resize();
            if (window._myBenchChart && typeof window._myBenchChart.resize === 'function') window._myBenchChart.resize();
          }
        }, 10);
      };

      window._toggleAccordion = function (id) {
        var content = document.getElementById(id);
        if (!content) return;
        var isHidden = content.style.display === 'none' || !content.style.display;
        content.style.display = isHidden ? 'block' : 'none';
        var arrow = document.getElementById(id + '-arrow');
        if (arrow) arrow.textContent = isHidden ? '▲' : '▼';
      };

      window._hideStrategyReport = function () {
        var p = document.getElementById('strategyReportPanel');
        if (p) p.classList.remove('srp-open');
        window._srpUserClosed = true;
      };

      window._buildStrategyReport = function (result) {
        if (!result || !result.strategyResult) { _hideStrategyReport(); return; }
        window._srpLastResult = result;
        var sr = result.strategyResult;
        var sum = sr.summary || {};
        var trades = Array.isArray(sr.trades) ? sr.trades : [];
        var winCount = trades.filter(function(t) { return t.profit > 0; }).length;
        
        /* ── Strategy name ── */
        var nameEl = document.getElementById('srp-stratName');
        if (nameEl) nameEl.textContent = (result.strategyName || 'Strategy Tester');

        /* ── Date Range mock ── */
        var dRange = document.getElementById('srp-date-range');
        if (dRange) {
          var today = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          dRange.textContent = 'Through ' + today;
        }

        /* ── Overview Tab Banner ── */
        var ovBanner = document.getElementById('tv-ov-banner');
        if (ovBanner) {
          var pf = isFinite(sum.profitFactor) ? sum.profitFactor.toFixed(3) : '∞';
          var pnl = sum.netProfit || 0;
          var pnlPct = sum.initialCapital ? (pnl / sum.initialCapital * 100) : 0;
          var maxDD = sum.maxDrawdown || 0;
          var totalTrades = sum.totalTrades || trades.length;
          var winRate = sum.winRate || 0;
          
          ovBanner.innerHTML = 
            '<div class="tv-metric-box"><div class="tv-metric-lbl">Total P&L</div><div class="tv-metric-val ' + (pnl >= 0 ? 'up' : 'down') + '">' + (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + ' <span style="font-size:11px; font-weight:normal; color:#787b86;">USDT</span> <span style="font-size:11px; font-weight:normal; margin-left:4px;">' + (pnlPct >= 0 ? '+' : '') + pnlPct.toFixed(2) + '%</span></div></div>' +
            '<div class="tv-metric-box"><div class="tv-metric-lbl">Max equity drawdown</div><div class="tv-metric-val down">' + (maxDD * 100).toFixed(2) + '%</div></div>' +
            '<div class="tv-metric-box"><div class="tv-metric-lbl">Total trades</div><div class="tv-metric-val">' + totalTrades + '</div></div>' +
            '<div class="tv-metric-box"><div class="tv-metric-lbl">Profitable trades</div><div class="tv-metric-val">' + (winRate * 100).toFixed(2) + '% <span style="font-size:11px; font-weight:normal; color:#787b86; margin-left:4px;">' + winCount + '/' + totalTrades + '</span></div></div>' +
            '<div class="tv-metric-box"><div class="tv-metric-lbl">Profit Factor</div><div class="tv-metric-val">' + pf + '</div></div>';
        }

        /* ── Performance & Ratios Accordions ── */
        var accDiv = document.getElementById('tv-accordions-container');
        var tDiv = document.getElementById('tv-trades-container');
        if (accDiv && tDiv) {
          var tradeCount = trades.length;
          var shouldBuildHTML = !accDiv.innerHTML.trim() || !window._srpLastTradeCount || window._srpLastTradeCount !== tradeCount;
          window._srpLastTradeCount = tradeCount;

          if (shouldBuildHTML) {
            var longT = trades.filter(function(t){ return t.direction === 'long'; });
            var shortT = trades.filter(function(t){ return t.direction === 'short'; });
            
            function calcPnl(list) { return list.reduce(function(a,t){ return a+t.profit; }, 0); }
            function calcWinRate(list) { if (!list.length) return 0; return list.filter(function(t){ return t.profit > 0; }).length / list.length; }
            
            var allPnl = sum.netProfit || 0;
            var lPnl = calcPnl(longT);
            var sPnl = calcPnl(shortT);

            var grossProfit = sum.grossProfit || 0;
            var grossLoss = sum.grossLoss || 0;

            var largestWin = Math.max.apply(null, trades.map(function(t){ return t.profit; }).concat([0]));
            var largestLoss = Math.min.apply(null, trades.map(function(t){ return t.profit; }).concat([0]));

            accDiv.innerHTML = 
              /* Accordion: Performance */
              '<div class="tv-accordion">' +
                '<div class="tv-accordion-header" onclick="_toggleAccordion(\'tv-acc-perf\')"><span>Performance</span><span id="tv-acc-perf-arrow">▼</span></div>' +
                '<div id="tv-acc-perf" class="tv-accordion-content" style="display:block;">' +
                  '<div style="display:flex; gap:20px; padding:16px; border-bottom:1px solid #2a2e39;">' +
                    '<div style="flex:1; display:flex; flex-direction:column;">' +
                      '<div style="font:bold 12px \'Trebuchet MS\',sans-serif; color:#787b86; margin-bottom:8px;">Profit structure</div>' +
                      '<div style="background:#131722; border:1px solid #2a2e39; border-radius:4px; position:relative; height:180px;">' +
                        '<canvas id="tv-profit-structure-canvas" style="width:100%; height:100%;"></canvas>' +
                      '</div>' +
                    '</div>' +
                    '<div style="flex:1; display:flex; flex-direction:column;">' +
                      '<div style="font:bold 12px \'Trebuchet MS\',sans-serif; color:#787b86; margin-bottom:8px;">Benchmarking</div>' +
                      '<div style="background:#131722; border:1px solid #2a2e39; border-radius:4px; position:relative; height:180px;">' +
                        '<canvas id="tv-benchmarking-canvas" style="width:100%; height:100%;"></canvas>' +
                      '</div>' +
                    '</div>' +
                  '</div>' +
                  '<table class="tv-perf-table">' +
                    '<thead><tr><th>Metric</th><th>All</th><th>Long</th><th>Short</th></tr></thead>' +
                    '<tbody>' +
                      '<tr><td>Net Profit</td><td class="' + (allPnl>=0?'up':'down') + '">' + allPnl.toFixed(2) + '</td><td class="' + (lPnl>=0?'up':'down') + '">' + lPnl.toFixed(2) + '</td><td class="' + (sPnl>=0?'up':'down') + '">' + sPnl.toFixed(2) + '</td></tr>' +
                      '<tr><td>Gross Profit</td><td class="up">' + grossProfit.toFixed(2) + '</td><td class="up">' + calcPnl(longT.filter(function(t){ return t.profit>0; })).toFixed(2) + '</td><td class="up">' + calcPnl(shortT.filter(function(t){ return t.profit>0; })).toFixed(2) + '</td></tr>' +
                      '<tr><td>Gross Loss</td><td class="down">' + grossLoss.toFixed(2) + '</td><td class="down">' + calcPnl(longT.filter(function(t){ return t.profit<0; })).toFixed(2) + '</td><td class="down">' + calcPnl(shortT.filter(function(t){ return t.profit<0; })).toFixed(2) + '</td></tr>' +
                      '<tr><td>Win Rate</td><td>' + (sum.winRate * 100).toFixed(2) + '%</td><td>' + (calcWinRate(longT) * 100).toFixed(2) + '%</td><td>' + (calcWinRate(shortT) * 100).toFixed(2) + '%</td></tr>' +
                    '</tbody>' +
                  '</table>' +
                '</div>' +
              '</div>' +

              /* Accordion: Returns & Details */
              '<div class="tv-accordion">' +
                '<div class="tv-accordion-header" onclick="_toggleAccordion(\'tv-acc-ret\')"><span>Returns & Details</span><span id="tv-acc-ret-arrow">▼</span></div>' +
                '<div id="tv-acc-ret" class="tv-accordion-content" style="display:none;">' +
                  '<table class="tv-perf-table">' +
                    '<thead><tr><th>Metric</th><th>Value</th></tr></thead>' +
                    '<tbody>' +
                      '<tr><td>Initial Capital</td><td>' + (sum.initialCapital || 10000) + ' USD</td></tr>' +
                      '<tr><td>Avg Trade</td><td>' + (sum.totalTrades ? (sum.netProfit / sum.totalTrades).toFixed(2) : '0.00') + '</td></tr>' +
                      '<tr><td>Largest Winning Trade</td><td class="up">' + largestWin.toFixed(2) + '</td></tr>' +
                      '<tr><td>Largest Losing Trade</td><td class="down">' + largestLoss.toFixed(2) + '</td></tr>' +
                    '</tbody>' +
                  '</table>' +
                '</div>' +
              '</div>';

            var cumPnl = 0;
            var rows = sr.trades.map(function (t, i) {
              cumPnl += t.profit;
              var win = t.profit >= 0;
              var cls = win ? 'tv-tr-win' : 'tv-tr-loss';
              var dir = t.direction === 'long' ? '▲ Long' : '▼ Short';
              return '<tr>' +
                '<td>' + (i + 1) + '</td>' +
                '<td class="' + cls + '">' + dir + '</td>' +
                '<td>' + t.entryPrice.toFixed(4) + '</td>' +
                '<td>' + t.exitPrice.toFixed(4) + '</td>' +
                '<td>' + (t.exitBar - t.entryBar) + '</td>' +
                '<td class="' + cls + '">' + (win ? '+' : '') + t.profit.toFixed(4) + '</td>' +
                '<td>' + (cumPnl >= 0 ? '+' : '') + cumPnl.toFixed(4) + '</td>' +
                '</tr>';
            }).join('');

            tDiv.innerHTML = '<table class="tv-trades-table">' +
              '<thead><tr><th>#</th><th>Type</th><th>Entry Price</th><th>Exit Price</th><th>Bars Held</th><th>Profit</th><th>Cum. Profit</th></tr></thead>' +
              '<tbody>' + (rows || '<tr><td colspan="7" style="text-align:center;color:#787b86;">No trades recorded</td></tr>') + '</tbody></table>';
          }
        }

        var panel = document.getElementById('strategyReportPanel');
        if (panel && !window._srpUserClosed) panel.classList.add('srp-open');

        setTimeout(function () {
          _drawEquityChart(document.getElementById('srp-equity-canvas'), result);
          _drawPerformanceCharts(result);
        }, 100);

        [300, 600, 1000, 1500].forEach(function(delay) {
          setTimeout(function() {
            _drawEquityChart(document.getElementById('srp-equity-canvas'), result);
            _drawPerformanceCharts(result);
            if (window._eqChart && typeof window._eqChart.resize === 'function') window._eqChart.resize();
            if (window._myWaterfallChart && typeof window._myWaterfallChart.resize === 'function') window._myWaterfallChart.resize();
            if (window._myBenchChart && typeof window._myBenchChart.resize === 'function') window._myBenchChart.resize();
          }, delay);
        });
      };

      /* ── Benchmarking and Profit waterfall charts ── */
      window._drawPerformanceCharts = function (result) {
        if (!result || !result.strategyResult) return;
        var sum = result.strategyResult.summary;
        var sr = result.strategyResult;
        
        /* 1. Profit Waterfall Chart */
        var pc = document.getElementById('tv-profit-structure-canvas');
        if (pc) {
          var gp = sum.grossProfit || 0;
          var gl = Math.abs(sum.grossLoss || 0);
          var np = sum.netProfit || 0;
          var com = Math.max(0, gp - gl - np);

          if (window._myWaterfallChart && typeof window._myWaterfallChart.update === 'function') {
            window._myWaterfallChart.data.datasets[0].data = [gp, -gl, -com, np];
            window._myWaterfallChart.update('none');
          } else {
            window._myWaterfallChart = new Chart(pc, {
              type: 'bar',
              data: {
                labels: ['Profit', 'Loss', 'Comm.', 'Total'],
                datasets: [{
                  data: [gp, -gl, -com, np],
                  backgroundColor: ['rgba(8,153,129,0.8)', 'rgba(242,54,69,0.8)', 'rgba(255,152,0,0.8)', 'rgba(41,98,255,0.8)'],
                  borderRadius: 4
                }]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  y: { grid: { color: '#2a2e39' }, ticks: { color: '#787b86' } },
                  x: { grid: { display: false }, ticks: { color: '#787b86' } }
                }
              }
            });
          }
        }
        
        /* 2. Benchmarking Chart */
        var bc = document.getElementById('tv-benchmarking-canvas');
        if (bc) {
          var stratPct = sum.initialCapital ? (sum.netProfit / sum.initialCapital * 100) : 0;
          var bhPct = 12.89; 
          if (sr.trades && sr.trades.length > 0) {
            var firstPrice = sr.trades[0].entryPrice;
            var lastPrice = sr.trades[sr.trades.length - 1].exitPrice;
            if (firstPrice && lastPrice) {
              bhPct = ((lastPrice - firstPrice) / firstPrice) * 100;
            }
          }

          if (window._myBenchChart && typeof window._myBenchChart.update === 'function') {
            window._myBenchChart.data.datasets[0].data = [bhPct, stratPct];
            window._myBenchChart.update('none');
          } else {
            window._myBenchChart = new Chart(bc, {
              type: 'bar',
              data: {
                labels: ['Buy & Hold', 'Strategy'],
                datasets: [{
                  data: [bhPct, stratPct],
                  backgroundColor: ['rgba(255,152,0,0.8)', 'rgba(41,98,255,0.8)'],
                  borderRadius: 4
                }]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                  y: { 
                    grid: { color: '#2a2e39' }, 
                    ticks: { 
                      color: '#787b86',
                      callback: function(v) { return v.toFixed(2) + '%'; }
                    } 
                  },
                  x: { grid: { display: false }, ticks: { color: '#787b86' } }
                }
              }
            });
          }
        }
      };

      var _eqChartLayers = { equity: true, buyhold: false, excursions: true, drawdowns: false };
      var _lastResult = null;

      window._changeEqView = function(layer) {
        _eqChartLayers[layer] = !_eqChartLayers[layer];
        
        var activeOpt = document.getElementById('eq-opt-' + layer);
        if (activeOpt) {
          if (_eqChartLayers[layer]) {
            activeOpt.style.color = '#d1d4dc';
            activeOpt.style.opacity = '1';
          } else {
            activeOpt.style.color = '#787b86';
            activeOpt.style.opacity = '0.5';
          }
        }
        if (_lastResult) {
          window._drawEquityChart(document.getElementById('srp-equity-canvas'), _lastResult);
        }
      };

      window._toggleExpandStrategy = function() {
        var panel = document.getElementById('strategyReportPanel');
        var btn = document.getElementById('btn-expand-strategy');
        if (panel.classList.contains('expanded')) {
          panel.classList.remove('expanded');
          btn.innerText = 'Expand';
        } else {
          panel.classList.add('expanded');
          btn.innerText = '✕ Collapse';
        }
        if (window._myEquityChart) {
          setTimeout(function() { window._myEquityChart.resize(); }, 100);
        }
      };

      window._drawEquityChart = function (canvas, result) {
        _lastResult = result;
        if (!canvas || !result || !result.strategyResult) return;
        var sr = result.strategyResult;
        var ec = sr.equityCurve;
        var cap = sr.summary.initialCapital || 10000;
        if (!ec || ec.length < 2) return;

        var vals = Array.from(ec).map(function (v) { return v - cap; });
        var labels = vals.map(function (_, i) { return i; });

        var tooltipEl = document.getElementById('tv-equity-tooltip');
        if (tooltipEl) tooltipEl.style.display = 'none';

        canvas.onmousemove = null;
        canvas.onmouseleave = null;

        var datasets = [];

        if (_eqChartLayers.equity) {
          datasets.push({
            label: 'Equity P&L',
            data: vals,
            borderColor: '#1D9E75',
            borderWidth: 1.5,
            fill: false,
            tension: 0.4,
            pointRadius: function(context) {
              var index = context.dataIndex;
              var count = context.dataset.data.length;
              var step = Math.max(1, Math.ceil(count / 12));
              return (index === 0 || index === count - 1 || index % step === 0) ? 4 : 0;
            },
            pointBackgroundColor: '#1D9E75',
            pointBorderColor: '#131722',
            pointBorderWidth: 1
          });
        }

        if (_eqChartLayers.buyhold) {
          var range = (Math.max.apply(null, vals) - Math.min.apply(null, vals)) || 1;
          var bhData = vals.map(function (_, i) { return (i / (vals.length - 1)) * range * 0.2; });
          datasets.push({
            label: 'Buy & Hold',
            data: bhData,
            borderColor: '#ff9800',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            tension: 0
          });
        }

        if (_eqChartLayers.drawdowns) {
          var curDD = 0;
          var ddData = [0];
          for (var i = 1; i < vals.length; i++) {
            if (vals[i] < vals[i-1]) curDD += (vals[i] - vals[i-1]);
            else curDD = Math.min(0, curDD + (vals[i] - vals[i-1]) * 0.5);
            ddData.push(curDD);
          }
          datasets.push({
            label: 'Drawdown',
            data: ddData,
            borderColor: '#f23645',
            borderWidth: 1.5,
            fill: false,
            pointRadius: 0,
            tension: 0
          });
        }

        if (_eqChartLayers.excursions) {
          var excData = vals.map(function () { return null; });
          var excColors = [];
          if (sr.trades) {
            sr.trades.forEach(function(t, idx) {
              if (idx + 1 < vals.length) {
                excData[idx + 1] = t.profit;
                excColors.push(t.profit >= 0 ? 'rgba(8,153,129,0.5)' : 'rgba(242,54,69,0.5)');
              }
            });
          }
          datasets.push({
            type: 'bar',
            label: 'Excursions',
            data: excData,
            backgroundColor: excColors,
            borderColor: 'transparent',
            borderWidth: 0,
            barPercentage: 0.5
          });
        }

        if (window._myEquityChart && typeof window._myEquityChart.update === 'function') {
          window._myEquityChart.data.labels = labels;
          window._myEquityChart.data.datasets = datasets;
          window._myEquityChart.update('none');
          return;
        }

        window._myEquityChart = new Chart(canvas, {
          type: 'line',
          data: {
            labels: labels,
            datasets: datasets
          },
          options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: { display: false },
              tooltip: {
                mode: 'index',
                intersect: false,
                backgroundColor: '#1e222d',
                titleColor: '#fff',
                bodyColor: '#d1d4dc',
                borderColor: '#2a2e39',
                borderWidth: 1,
                padding: 10,
                titleFont: { size: 11, family: "'Trebuchet MS', sans-serif", weight: 'bold' },
                bodyFont: { size: 11, family: "'Trebuchet MS', sans-serif" },
                displayColors: false,
                callbacks: {
                  title: function(context) {
                    return 'Point #' + context[0].dataIndex;
                  },
                  label: function(context) {
                    var idx = context.dataIndex;
                    var dataset = context.dataset;
                    var val = context.parsed.y;
                    var lines = [];
                    lines.push(dataset.label + ': ' + (val >= 0 ? '+' : '') + val.toFixed(2) + ' USD');
                    
                    if (dataset.label === 'Equity P&L' && sr.trades && sr.trades[idx - 1]) {
                      var trade = sr.trades[idx - 1];
                      lines.push('Last Trade: ' + trade.direction.toUpperCase());
                      lines.push('Trade P&L: ' + (trade.profit >= 0 ? '+' : '') + trade.profit.toFixed(2));
                    }
                    return lines;
                  }
                }
              }
            },
            scales: {
              x: {
                display: false
              },
              y: {
                grid: {
                  color: '#2a2e39'
                },
                ticks: {
                  color: '#787b86',
                  callback: function(value) {
                    return (value >= 0 ? '+' : '') + value.toFixed(0);
                  }
                }
              }
            }
          }
        });
      };

      /* helper: rounded rect replacement placeholder cleanup */
      function _rrect(ctx, x, y, w, h, r) {
        r = Math.min(r, Math.abs(h) / 2, Math.abs(w) / 2);
        ctx.beginPath();
        if (h < 0) { y += h; h = -h; }
        ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y);
        ctx.quadraticCurveTo(x + w, y, x + w, y + r);
        ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
        ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
        ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
        ctx.closePath();
      }

      /* ── Profit Structure Bar Chart ── */
      window._drawProfitBars = function (result) {
        var s = srpCtx('srp-perf-bars', 300, 210); if (!s) return;
        var ctx = s.ctx, W = s.W, H = s.H;
        var sum = result.strategyResult.summary;
        var gp = sum.grossProfit;
        var gl = Math.abs(sum.grossLoss);
        var np = sum.netProfit;
        var com = Math.max(0, gp - gl - np);
        var bars = [
          { label: 'Gross Profit', val: gp, color: '#26a69a' },
          { label: 'Gross Loss', val: -gl, color: '#ef5350' },
          { label: 'Commission', val: -com, color: '#ff9800' },
          { label: 'Net P&L', val: np, color: np >= 0 ? '#42a5f5' : '#ef5350' }
        ];
        var maxAbs = Math.max.apply(null, bars.map(function (b) { return Math.abs(b.val) || 1; }));
        var pad = { t: 18, b: 30, l: 8, r: 8 };
        var cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
        var bw = Math.floor(cW / bars.length * 0.52), gap = cW / bars.length;
        var zeroY = pad.t + cH / 2;

        /* grid */
        [0.5, 1].forEach(function (f) {
          var gy = pad.t + cH * (1 - f * 0.48);
          ctx.strokeStyle = 'rgba(255,255,255,.05)'; ctx.lineWidth = 0.5; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(W - pad.r, gy); ctx.stroke();
          var gy2 = pad.t + cH * (f * 0.48);
          ctx.beginPath(); ctx.moveTo(pad.l, gy2); ctx.lineTo(W - pad.r, gy2); ctx.stroke();
        });
        /* zero line */
        ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(pad.l, zeroY); ctx.lineTo(W - pad.r, zeroY); ctx.stroke();
        ctx.setLineDash([]);

        bars.forEach(function (b, i) {
          var cx = pad.l + i * gap + gap / 2;
          var bh = (Math.abs(b.val) / maxAbs) * (cH / 2 - 6);
          var by = b.val >= 0 ? zeroY - bh : zeroY;
          /* gradient fill */
          var gr = ctx.createLinearGradient(0, by, 0, by + bh);
          gr.addColorStop(0, b.color + 'dd');
          gr.addColorStop(1, b.color + '44');
          _rrect(ctx, cx - bw / 2, by, bw, bh, 3);
          ctx.fillStyle = gr; ctx.fill();
          /* thin border */
          _rrect(ctx, cx - bw / 2, by, bw, bh, 3);
          ctx.strokeStyle = b.color + '99'; ctx.lineWidth = 1; ctx.stroke();
          /* value label */
          ctx.fillStyle = b.color; ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'center';
          ctx.textBaseline = b.val >= 0 ? 'bottom' : 'top';
          var short = Math.abs(b.val) >= 1000 ? (b.val / 1000).toFixed(1) + 'k' : b.val.toFixed(1);
          ctx.fillText((b.val >= 0 ? '+' : '') + short, cx, b.val >= 0 ? by - 2 : by + bh + 2);
          /* bar label */
          ctx.fillStyle = 'rgba(160,175,200,.5)'; ctx.font = '7px DM Mono'; ctx.textBaseline = 'bottom';
          ctx.fillText(b.label, cx, H - 2);
        });
        var lg = document.getElementById('srp-perf-legend');
        if (lg) lg.innerHTML = bars.map(function (b) {
          return '<span><span class="srp-legend-dot" style="background:' + b.color + '"></span>' + b.label + '</span>';
        }).join('');
      };

      /* ── Benchmarking: strategy vs buy-and-hold ── */
      window._drawBenchmark = function (result) {
        var s = srpCtx('srp-bench-canvas', 300, 210); if (!s) return;
        var ctx = s.ctx, W = s.W, H = s.H;
        var sum = result.strategyResult.summary;
        var stratPct = sum.initialCapital ? (sum.netProfit / sum.initialCapital * 100) : 0;
        var bhPct = 0;
        if (window.chartCandles && window.chartCandles.length >= 2) {
          var fc = window.chartCandles[0].c, lc = window.chartCandles[window.chartCandles.length - 1].c;
          bhPct = fc > 0 ? (lc - fc) / fc * 100 : 0;
        }
        var bars = [
          { label: 'Buy & Hold', val: bhPct, color: '#ff9800' },
          { label: 'Strategy', val: stratPct, color: '#42a5f5' }
        ];
        var maxAbs = Math.max(Math.abs(bhPct), Math.abs(stratPct), 0.01);
        var pad = { t: 28, b: 30, l: 8, r: 8 };
        var cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
        var bw = Math.floor(cW / bars.length * 0.42), gap = cW / bars.length;
        var zeroY = pad.t + cH / 2;

        /* grid */
        ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(pad.l, zeroY); ctx.lineTo(W - pad.r, zeroY); ctx.stroke();
        ctx.setLineDash([]);

        bars.forEach(function (b, i) {
          var cx = pad.l + i * gap + gap / 2;
          var bh = (Math.abs(b.val) / maxAbs) * (cH / 2 - 8);
          var by = b.val >= 0 ? zeroY - bh : zeroY;
          var gr = ctx.createLinearGradient(0, by, 0, by + bh);
          gr.addColorStop(0, b.color + 'cc'); gr.addColorStop(1, b.color + '33');
          _rrect(ctx, cx - bw / 2, by, bw, bh, 4);
          ctx.fillStyle = gr; ctx.fill();
          _rrect(ctx, cx - bw / 2, by, bw, bh, 4);
          ctx.strokeStyle = b.color + 'aa'; ctx.lineWidth = 1; ctx.stroke();
          /* glow */
          ctx.save(); ctx.shadowColor = b.color; ctx.shadowBlur = 8;
          _rrect(ctx, cx - bw / 2, by, bw, bh, 4); ctx.strokeStyle = b.color + '55'; ctx.lineWidth = 1; ctx.stroke();
          ctx.restore();
          /* pct label */
          ctx.fillStyle = b.color; ctx.font = 'bold 12px DM Mono'; ctx.textAlign = 'center';
          ctx.textBaseline = b.val >= 0 ? 'bottom' : 'top';
          ctx.fillText((b.val >= 0 ? '+' : '') + b.val.toFixed(2) + '%', cx, b.val >= 0 ? by - 4 : by + bh + 4);
          ctx.fillStyle = 'rgba(160,175,200,.5)'; ctx.font = '8px DM Mono'; ctx.textBaseline = 'bottom';
          ctx.fillText(b.label, cx, H - 2);
        });
        /* difference annotation */
        var diff = stratPct - bhPct;
        ctx.fillStyle = diff >= 0 ? 'rgba(38,166,154,.75)' : 'rgba(239,83,80,.75)';
        ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        ctx.fillText((diff >= 0 ? '▲ +' : '▼ ') + diff.toFixed(2) + '% vs B&H', W / 2, pad.t - 18);
        var lg = document.getElementById('srp-bench-legend');
        if (lg) lg.innerHTML = bars.map(function (b) {
          return '<span><span class="srp-legend-dot" style="background:' + b.color + '"></span>' + b.label + '</span>';
        }).join('');
      };

      /* ── P&L Distribution Histogram ── */
      window._drawHistogram = function (result) {
        var s = srpCtx('srp-hist-canvas', 300, 210); if (!s) return;
        var ctx = s.ctx, W = s.W, H = s.H;
        var trades = result.strategyResult.trades;
        var cap = result.strategyResult.summary.initialCapital || 10000;
        if (!trades.length) return;
        var pcts = trades.map(function (t) { return t.profit / cap * 100; });
        var step = 0.5, lo = -2.5, hi = 2.5;
        var buckets = [];
        for (var v = lo; v < hi; v += step) buckets.push({ lo: v, hi: v + step, wins: 0, losses: 0 });
        pcts.forEach(function (p) {
          var idx = Math.floor((p - lo) / step);
          if (idx < 0) idx = 0;
          if (idx >= buckets.length) idx = buckets.length - 1;
          if (p >= 0) buckets[idx].wins++; else buckets[idx].losses++;
        });
        var maxCount = Math.max.apply(null, buckets.map(function (b) { return b.wins + b.losses; })) || 1;
        var pad = { t: 12, b: 26, l: 30, r: 10 };
        var cW = W - pad.l - pad.r, cH = H - pad.t - pad.b;
        var bw = cW / buckets.length;

        /* horizontal grid */
        [0.25, 0.5, 0.75, 1].forEach(function (f) {
          var gy = pad.t + cH * (1 - f);
          ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = 0.5;
          ctx.beginPath(); ctx.moveTo(pad.l, gy); ctx.lineTo(W - pad.r, gy); ctx.stroke();
        });
        /* zero bar */
        var zeroBx = pad.l + (-lo / step) * bw;
        ctx.strokeStyle = 'rgba(255,255,255,.2)'; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(zeroBx, pad.t); ctx.lineTo(zeroBx, pad.t + cH); ctx.stroke();
        ctx.setLineDash([]);

        buckets.forEach(function (b, i) {
          var total = b.wins + b.losses;
          if (!total) return;
          var bh = (total / maxCount) * cH;
          var bx = pad.l + i * bw;
          var by = pad.t + cH - bh;
          var col = b.lo < 0 ? '#ef5350' : '#26a69a';
          var gr = ctx.createLinearGradient(0, by, 0, by + bh);
          gr.addColorStop(0, col + 'cc'); gr.addColorStop(1, col + '33');
          _rrect(ctx, bx + 1, by, bw - 2, bh, 2);
          ctx.fillStyle = gr; ctx.fill();
        });

        /* avg lines */
        var winsT = trades.filter(function (t) { return t.profit > 0; });
        var lossT = trades.filter(function (t) { return t.profit < 0; });
        function avgLine(arr, color) {
          if (!arr.length) return;
          var avg = arr.reduce(function (a, t) { return a + t.profit / cap * 100; }, 0) / arr.length;
          var lx = pad.l + (avg - lo) / step * bw;
          if (lx < pad.l || lx > W - pad.r) return;
          ctx.save(); ctx.shadowColor = color; ctx.shadowBlur = 4;
          ctx.strokeStyle = color; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(lx, pad.t); ctx.lineTo(lx, pad.t + cH); ctx.stroke();
          ctx.setLineDash([]); ctx.restore();
        }
        avgLine(lossT, 'rgba(239,83,80,.95)'); avgLine(winsT, 'rgba(38,166,154,.95)');

        /* x-axis ticks */
        ctx.fillStyle = 'rgba(160,175,200,.4)'; ctx.font = '8px DM Mono'; ctx.textAlign = 'center'; ctx.textBaseline = 'top';
        [-2, -1, 0, 1, 2].forEach(function (v) {
          var lx = pad.l + (v - lo) / step * bw;
          ctx.fillText(v + '%', lx, H - pad.b + 3);
        });
        /* y-axis */
        ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
        [0, Math.ceil(maxCount / 2), maxCount].forEach(function (v) {
          var ly = pad.t + cH - (v / maxCount) * cH;
          ctx.fillText(v, pad.l - 5, ly);
        });

        var lg = document.getElementById('srp-hist-legend');
        if (lg) lg.innerHTML = '<span><span class="srp-legend-dot" style="background:#ef5350"></span>Loss</span>' +
          '<span><span class="srp-legend-dot" style="background:#26a69a"></span>Profit</span>' +
          '<span style="color:rgba(239,83,80,.85)">— Avg loss</span>' +
          '<span style="color:rgba(38,166,154,.85)">— Avg profit</span>';
      };

      /* ── Win/Loss Donut ── */
      window._drawDonut = function (result) {
        var s = srpCtx('srp-donut-canvas', 220, 210); if (!s) return;
        var ctx = s.ctx, W = s.W, H = s.H;
        var sum = result.strategyResult.summary;
        var total = sum.totalTrades;
        var wins = Math.round(sum.winRate * total);
        var losses = total - wins;
        var cx = W / 2 - 18, cy = H / 2, r = Math.min(cx, cy) - 12, ri = r * 0.58;
        var slices = [
          { val: wins, color: '#26a69a', label: 'Wins', pct: (wins / total * 100).toFixed(1) },
          { val: losses, color: '#ef5350', label: 'Losses', pct: (losses / total * 100).toFixed(1) }
        ];
        var startAngle = -Math.PI / 2;
        var GAP = 0.04;
        slices.forEach(function (sl) {
          if (!sl.val) return;
          var sweep = (sl.val / total) * Math.PI * 2 - GAP;
          /* shadow for wins slice */
          if (sl.label === 'Wins') {
            ctx.save(); ctx.shadowColor = '#26a69a'; ctx.shadowBlur = 10;
            ctx.beginPath(); ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, startAngle + GAP / 2, startAngle + GAP / 2 + sweep);
            ctx.closePath(); ctx.fillStyle = sl.color; ctx.fill();
            ctx.restore();
          } else {
            ctx.beginPath(); ctx.moveTo(cx, cy);
            ctx.arc(cx, cy, r, startAngle + GAP / 2, startAngle + GAP / 2 + sweep);
            ctx.closePath(); ctx.fillStyle = sl.color; ctx.fill();
          }
          startAngle += sweep + GAP;
        });
        /* inner ring gradient */
        var grad = ctx.createRadialGradient(cx, cy, ri * 0.6, cx, cy, ri);
        grad.addColorStop(0, '#0a0d16'); grad.addColorStop(1, '#07090f');
        ctx.beginPath(); ctx.arc(cx, cy, ri, 0, Math.PI * 2); ctx.fillStyle = grad; ctx.fill();
        /* thin ring border */
        ctx.beginPath(); ctx.arc(cx, cy, ri, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,.06)'; ctx.lineWidth = 1; ctx.stroke();
        /* Center text */
        ctx.fillStyle = '#e8ecf5'; ctx.font = 'bold 18px DM Mono'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(total, cx, cy - 8);
        ctx.fillStyle = 'rgba(160,175,200,.4)'; ctx.font = '9px DM Mono';
        ctx.fillText('TRADES', cx, cy + 8);
        /* Win rate highlight */
        ctx.fillStyle = 'rgba(38,166,154,.7)'; ctx.font = 'bold 10px DM Mono';
        ctx.fillText((sum.winRate * 100).toFixed(1) + '%', cx, cy + 22);

        /* Legend */
        var lx = W - 72, ly = H / 2 - 28;
        slices.forEach(function (sl) {
          ctx.save(); ctx.shadowColor = sl.color; ctx.shadowBlur = 4;
          ctx.fillStyle = sl.color; ctx.fillRect(lx, ly, 8, 8);
          ctx.restore();
          ctx.fillStyle = 'rgba(200,210,225,.75)'; ctx.font = '9px DM Mono'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
          ctx.fillText(sl.label, lx + 12, ly - 1);
          ctx.fillStyle = sl.color; ctx.font = 'bold 10px DM Mono';
          ctx.fillText(sl.val + ' (' + sl.pct + '%)', lx + 12, ly + 10);
          ly += 28;
        });
      };

      /* ── HTML Report Download ── */
      window._srpDownloadReport = function () {
        var r = window._srpLastResult; if (!r || !r.strategyResult) return;
        var sum = r.strategyResult.summary;
        var pnl = sum.netProfit, green = '#26a69a', red = '#ef5350';
        var pnlColor = pnl >= 0 ? green : red;
        /* Render all charts to images */
        function canvasImg(id) {
          var c = document.getElementById(id);
          return c ? c.toDataURL('image/png') : '';
        }
        /* Make sure performance/analysis charts are rendered */
        _drawProfitBars(r); _drawBenchmark(r); _drawHistogram(r); _drawDonut(r);
        setTimeout(function () {
          var equityImg = canvasImg('srp-equity-canvas');
          var perfImg = canvasImg('srp-perf-bars');
          var benchImg = canvasImg('srp-bench-canvas');
          var histImg = canvasImg('srp-hist-canvas');
          var donutImg = canvasImg('srp-donut-canvas');
          var winCount = Math.round(sum.winRate * sum.totalTrades);
          var html = '<!DOCTYPE html><html><head><meta charset="utf-8">' +
            '<title>Strategy Report</title>' +
            '<style>body{font-family:DM Mono,monospace;background:#06080d;color:#e0e4f0;margin:0;padding:24px;box-sizing:border-box}' +
            'h1{font-family:Cinzel,serif;color:#c9a84c;font-size:18px;margin:0 0 18px;letter-spacing:.1em}' +
            '.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px}' +
            '.card{background:#0d1018;border:1px solid rgba(255,255,255,.08);border-radius:8px;padding:12px 16px}' +
            '.card .lbl{font-size:10px;color:rgba(180,190,210,.45);margin-bottom:4px}' +
            '.card .val{font-size:18px;font-weight:bold}' +
            '.card .sub{font-size:9px;color:rgba(180,190,210,.4);margin-top:2px}' +
            '.charts{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px}' +
            '.chart-box{background:#0d1018;border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px}' +
            '.chart-box h3{font-size:11px;color:rgba(180,190,210,.5);margin:0 0 8px;font-weight:normal}' +
            '.chart-box img{width:100%;border-radius:4px}' +
            '.chart-full{background:#0d1018;border:1px solid rgba(255,255,255,.07);border-radius:8px;padding:12px;margin-bottom:16px}' +
            '.chart-full h3{font-size:11px;color:rgba(180,190,210,.5);margin:0 0 8px;font-weight:normal}' +
            '.chart-full img{width:100%;border-radius:4px}' +
            'footer{font-size:9px;color:rgba(180,190,210,.3);text-align:center;margin-top:24px;padding-top:12px;border-top:1px solid rgba(255,255,255,.05)}' +
            '</style></head><body>' +
            '<h1>Strategy Report</h1>' +
            '<div class="grid">' +
            '<div class="card"><div class="lbl">Net P&L</div><div class="val" style="color:' + pnlColor + '">' + (pnl >= 0 ? '+' : '') + pnl.toFixed(2) + '</div>' +
            '<div class="sub">' + (sum.initialCapital ? (pnl / sum.initialCapital * 100).toFixed(2) + '% return' : '') + '</div></div>' +
            '<div class="card"><div class="lbl">Max Drawdown</div><div class="val" style="color:' + red + '">' + (sum.maxDrawdown * 100).toFixed(2) + '%</div></div>' +
            '<div class="card"><div class="lbl">Total Trades</div><div class="val">' + sum.totalTrades + '</div></div>' +
            '<div class="card"><div class="lbl">Win Rate</div><div class="val" style="color:' + (sum.winRate >= 0.5 ? green : red) + '">' + (sum.winRate * 100).toFixed(1) + '%</div>' +
            '<div class="sub">' + winCount + ' / ' + sum.totalTrades + '</div></div>' +
            '<div class="card"><div class="lbl">Profit Factor</div><div class="val" style="color:' + (sum.profitFactor >= 1 ? green : red) + '">' + (isFinite(sum.profitFactor) ? sum.profitFactor.toFixed(2) : '∞') + '</div></div>' +
            '<div class="card"><div class="lbl">Gross Profit</div><div class="val" style="color:' + green + '">+' + sum.grossProfit.toFixed(2) + '</div></div>' +
            '<div class="card"><div class="lbl">Gross Loss</div><div class="val" style="color:' + red + '">' + sum.grossLoss.toFixed(2) + '</div></div>' +
            '<div class="card"><div class="lbl">Final Equity</div><div class="val">' + sum.finalEquity.toFixed(2) + '</div></div>' +
            '</div>' +
            (equityImg ? '<div class="chart-full"><h3>Equity Curve</h3><img src="' + equityImg + '"></div>' : '') +
            '<div class="charts">' +
            (perfImg ? '<div class="chart-box"><h3>Profit Structure</h3><img src="' + perfImg + '"></div>' : '') +
            (benchImg ? '<div class="chart-box"><h3>Benchmarking</h3><img src="' + benchImg + '"></div>' : '') +
            (histImg ? '<div class="chart-box"><h3>P&L Distribution</h3><img src="' + histImg + '"></div>' : '') +
            (donutImg ? '<div class="chart-box"><h3>Win / Loss Ratio</h3><img src="' + donutImg + '"></div>' : '') +
            '</div>' +
            '<footer>Generated by Fractal AI Agent · FractalScript Engine</footer>' +
            '</body></html>';
          var blob = new Blob([html], { type: 'text/html' });
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = 'strategy-report.html';
          a.click();
          URL.revokeObjectURL(a.href);
        }, 80);
      };

      /* ── XLSX Data Export ── */
      window._srpExportXlsx = function () {
        var r = window._srpLastResult; if (!r || !r.strategyResult) return;
        if (typeof XLSX === 'undefined') { alert('XLSX library not loaded yet, try again.'); return; }
        var sum = r.strategyResult.summary;
        var trades = r.strategyResult.trades;
        var ec = Array.from(r.strategyResult.equityCurve);
        /* Sheet 1: Summary */
        var sumRows = [
          ['Metric', 'Value'],
          ['Net P&L', sum.netProfit],
          ['Gross Profit', sum.grossProfit],
          ['Gross Loss', sum.grossLoss],
          ['Max Drawdown %', +(sum.maxDrawdown * 100).toFixed(4)],
          ['Total Trades', sum.totalTrades],
          ['Win Rate %', +(sum.winRate * 100).toFixed(4)],
          ['Profit Factor', isFinite(sum.profitFactor) ? +sum.profitFactor.toFixed(4) : null],
          ['Initial Capital', sum.initialCapital],
          ['Final Equity', sum.finalEquity]
        ];
        /* Sheet 2: Trades */
        var tradeRows = [['#', 'Direction', 'Entry Bar', 'Entry Price', 'Exit Bar', 'Exit Price', 'Bars Held', 'P&L', 'Cum P&L']];
        var cum = 0;
        trades.forEach(function (t, i) {
          cum += t.profit;
          tradeRows.push([i + 1, t.direction, t.entryBar, +t.entryPrice.toFixed(6), t.exitBar, +t.exitPrice.toFixed(6), t.exitBar - t.entryBar, +t.profit.toFixed(6), +cum.toFixed(6)]);
        });
        /* Sheet 3: Equity Curve */
        var eqRows = [['Bar', 'Equity', 'P&L vs Initial']];
        var cap = sum.initialCapital;
        ec.forEach(function (v, i) { eqRows.push([i, +v.toFixed(4), +(v - cap).toFixed(4)]); });
        var wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(sumRows), 'Summary');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(tradeRows), 'Trades');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(eqRows), 'Equity Curve');
        XLSX.writeFile(wb, 'strategy-data.xlsx');
      };

      window._hideStrategyReport = function () {
        var p = document.getElementById('strategyReportPanel');
        if (p) p.classList.remove('srp-open');
      };

    })();
    (function () {
      'use strict';
      var ta = document.getElementById('fractalEditor');
      /* Restore from localStorage */
      if (window.fractalSource) ta.value = window.fractalSource;

      /* Global toggle for the new header button */
      window._toggleFractalScript = function () {
        window.fractalOverlayOn = !window.fractalOverlayOn;
        var glow = document.getElementById('fsBtnGlow');
        var txt = document.getElementById('fsLabelText');
        if (glow) glow.style.opacity = window.fractalOverlayOn ? '1' : '0';
        if (txt) {
          txt.style.color = window.fractalOverlayOn ? '#c9a84c' : 'rgba(255,255,255,0.2)';
          txt.style.textShadow = window.fractalOverlayOn ? '0 0 10px rgba(201,168,76,0.3)' : 'none';
        }

        if (window.fractalOverlayOn) {
          _showfractalModal();
          if (!window.fractalResult && window.fractalSource) _runFractalScript();
        } else {
          if (typeof _hideStrategyReport === 'function') _hideStrategyReport();
        }

        if (typeof buildToolbar === 'function') buildToolbar();
        if (typeof renderChart === 'function') renderChart();
      };

      window._showfractalModal = function () {
        var m = document.getElementById('fractalModal');
        if (m) { m.classList.add('show'); ta.focus(); }
      };
      window._closeFractalModal = function () {
        var m = document.getElementById('fractalModal');
        if (m) m.classList.remove('show');
      };
      window._runFractalScript = function () {
        var src = ta ? ta.value : window.fractalSource;
        if (!src || !src.trim()) return;

        /* Auto-strip RTF formatting if detected */
        if (src.indexOf('{' + String.fromCharCode(92) + 'rtf') >= 0) {
          src = _stripRTF(src);
          if (ta) ta.value = src; /* Update textarea with cleaned version */
        }

        window.fractalSource = src;
        localStorage.setItem('fractalSource', src);

        /* Gather input overrides — skip empty fields so script defaults are used */
        var overrides = {};
        var fields = document.querySelectorAll('#fractalInputs input');
        for (var i = 0; i < fields.length; i++) {
          var f = fields[i];
          if (f.type === 'checkbox') {
            overrides[f.dataset.name] = f.checked;
          } else if (f.value !== '') {
            var _n = parseFloat(f.value);
            overrides[f.dataset.name] = !isNaN(_n) ? _n : f.value;
          }
        }

        var candles = window.chartCandles;
        if (!candles || candles.length < 2) { _showfractalError('No candle data available'); return; }

        /* Kill any in-flight worker before starting a new one */
        if (window._fsWorker) { window._fsWorker.terminate(); window._fsWorker = null; }

        var glow = document.getElementById('fsBtnGlow');
        var txt = document.getElementById('fsLabelText');

        var worker = new Worker('/fractalscript/worker.js');
        window._fsWorker = worker;

        worker.onmessage = function (e) {
          window._fsWorker = null;
          worker.terminate();
          var result = e.data;

          if (result.errors && result.errors.length > 0) {
            var errMsg = result.errors.map(function (e) { return 'Line ' + e.line + ':' + e.col + ' — ' + e.message; }).join('\n');
            _showfractalError(errMsg);
            if (glow) glow.style.opacity = '1';
            if (txt) {
              txt.style.color = '#c9a84c';
              txt.style.textShadow = '0 0 10px rgba(201,168,76,0.3)';
            }
            if (result.inputs && result.inputs.length > 0) _buildFractalInputs(result.inputs);
            return;
          }

          window.fractalResult = result;
          window.fractalOverlayOn = true;
          if (glow) glow.style.opacity = '1';
          if (txt) {
            txt.style.color = '#c9a84c';
            txt.style.textShadow = '0 0 10px rgba(201,168,76,0.3)';
          }
          _hidefractalError();
          if (result.inputs && result.inputs.length > 0) _buildFractalInputs(result.inputs);
          if (typeof buildToolbar === 'function') buildToolbar();
          if (typeof renderChart === 'function') renderChart();
          if (typeof _buildStrategyReport === 'function') _buildStrategyReport(result);
        };

        worker.onerror = function (err) {
          window._fsWorker = null;
          worker.terminate();
          _showfractalError('Engine error: ' + (err.message || 'unknown'));
        };

        worker.postMessage({ source: src, candles: candles, inputs: overrides });
      };
      window._runFractalFromModal = function () {
        if (ta) window.fractalSource = ta.value;
        window._srpUserClosed = false;
        _runFractalScript();
      };
      window._clearFractalScript = function () {
        if (ta) ta.value = '';
        window.fractalSource = '';
        window.fractalResult = null;
        localStorage.removeItem('fractalSource');
        _hidefractalError();
        var ia = document.getElementById('fractalInputs');
        if (ia) ia.innerHTML = '';
        if (typeof _hideStrategyReport === 'function') _hideStrategyReport();
        if (typeof renderChart === 'function') renderChart();
      };
      function _showfractalError(msg) {
        var el = document.getElementById('fractalErrors');
        if (el) { el.textContent = msg; el.style.display = 'block'; }
      }
      function _hidefractalError() {
        var el = document.getElementById('fractalErrors');
        if (el) { el.textContent = ''; el.style.display = 'none'; }
      }
      function _buildFractalInputs(inputs) {
        var area = document.getElementById('fractalInputs');
        if (!area) return;
        area.innerHTML = '';
        for (var i = 0; i < inputs.length; i++) {
          var inp = inputs[i];
          var div = document.createElement('div'); div.className = 'FRACTAL-input-field';
          var lbl = document.createElement('label'); lbl.textContent = inp.name || ('Input ' + (i + 1));
          var field = document.createElement('input');
          field.dataset.name = inp.name;
          if (inp.type === 'bool') {
            field.type = 'checkbox'; field.checked = !!inp.value; field.style.width = 'auto';
          } else {
            field.type = 'number'; field.value = inp.value; field.step = inp.type === 'float' ? '0.1' : '1';
          }
          field.addEventListener('change', function () { _runFractalScript(); });
          div.appendChild(lbl); div.appendChild(field); area.appendChild(div);
        }
      }

      /* RTF auto-stripper — converts RTF-formatted FractalScripts to plain text */
      function _stripRTF(rtf) {
        var text = rtf;
        /* Jump to //@version if present — skip all RTF header junk */
        var vi = text.indexOf('//@version');
        if (vi > 0) text = text.substring(vi);
        /* Replace \par with newline */
        text = text.split(String.fromCharCode(92) + 'par').join(String.fromCharCode(10));
        /* Remove remaining backslash-commands like \f0 \fs22 \lang9 etc */
        text = text.replace(/\\[a-zA-Z]+\d*\s?/g, '');
        /* Remove braces and null bytes */
        text = text.replace(/[{}]/g, '').replace(/\x00/g, '');
        /* Clean up whitespace */
        text = text.replace(/\r/g, '').replace(/\n{3,}/g, '\n\n');
        return text.trim();
      }

      /* Auto re-run on candle changes (debounced 1s) */
      var _origRender = window.renderChart;
      if (typeof _origRender === 'function') {
        /* We don't wrap renderChart itself — instead, use a MutationObserver-like approach.
           Simply re-run every 5s if FRACTAL is active and candles changed. */
      }
      setInterval(function () {
        if (window.fractalOverlayOn && window.fractalSource && window.chartCandles && window.chartCandles.length > 2) {
          /* Only re-run if candle count changed */
          var key = window.chartCandles.length + '_' + (window.chartCandles[window.chartCandles.length - 1] ? window.chartCandles[window.chartCandles.length - 1].c : 0);
          if (window._FRACTALLastKey !== key) {
            window._FRACTALLastKey = key;
            _runFractalScript();
          }
        }
      }, 2000);

      /* Close modal on Escape */
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          var m = document.getElementById('fractalModal');
          if (m && m.classList.contains('show')) { _closeFractalModal(); e.stopPropagation(); }
        }
      });

      /* Close modal on backdrop click */
      var modal = document.getElementById('fractalModal');
      if (modal) {
        modal.addEventListener('click', function (e) { if (e.target === modal) _closeFractalModal(); });
      }
    })();
