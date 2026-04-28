    /* ── ANALYZER ── */
    var dataUrl = null;
    var fileIn = document.getElementById('fileIn');
    var dropZone = document.getElementById('dropZone');
    var imgPv = document.getElementById('imgPv');
    var prevImg = document.getElementById('prevImg');
    var rmX = document.getElementById('rmX');
    var azBtn = document.getElementById('azBtn');
    var azSpin = document.getElementById('azSpin');
    var azTxtEl = document.getElementById('azTxt');
    var BACKEND_URL = ''; /* same domain */

    /* Guard — elements may not exist in new layout */
    if (dropZone) {
      dropZone.addEventListener('dragover', function (e) { e.preventDefault(); dropZone.classList.add('drag'); });
      dropZone.addEventListener('dragleave', function () { dropZone.classList.remove('drag'); });
      dropZone.addEventListener('drop', function (e) {
        e.preventDefault(); dropZone.classList.remove('drag');
        var f = e.dataTransfer.files[0];
        if (f && f.type.startsWith('image/')) handleFile(f);
      });
    }
    if (fileIn) fileIn.addEventListener('change', function () { if (fileIn.files[0]) handleChartUpload(fileIn.files[0]); });
    if (rmX) rmX.addEventListener('click', resetUp);

    var _uploadedMode = false;
    function handleChartUpload(f) {
      var r = new FileReader();
      r.onload = function (e) {
        var cv = document.getElementById('chartCanvas');
        var ctx = cv ? cv.getContext('2d') : null;
        if (!ctx) { return; }
        var img = new Image();
        img.onload = function () {
          if (chartSSE) { chartSSE.close(); chartSSE = null; }
          stopPricePolling();
          /* Disable coin input while image is on canvas */
          var pIn = document.getElementById('pairIn');
          if (pIn) { pIn.disabled = true; pIn.style.opacity = '0.4'; }
          var dpr = window.devicePixelRatio || 1;
          var cssW = cv.parentElement ? cv.parentElement.clientWidth : 800;
          if (!cssW || cssW < 100) cssW = 800;
          var aspect = img.naturalHeight / img.naturalWidth;
          var cssH = Math.max(300, Math.min(680, Math.round(cssW * aspect)));
          cv.width = Math.round(cssW * dpr);
          cv.height = Math.round(cssH * dpr);
          cv.style.width = cssW + 'px';
          cv.style.height = cssH + 'px';
          ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
          ctx.drawImage(img, 0, 0, cssW, cssH);
          /* Hide welcome overlay */
          var empty = document.getElementById('chartEmpty');
          if (empty) empty.style.display = 'none';
          /* Show CLEAR, hide UPLOAD */
          var clrBtn = document.getElementById('clearUploadBtn');
          var uplLbl = document.getElementById('uploadLabel');
          if (clrBtn) clrBtn.style.display = 'inline-block';
          if (uplLbl) uplLbl.style.display = 'none';
          dataUrl = e.target.result;
          var ab = document.getElementById('azBtn');
          if (ab) ab.disabled = false;
          if (typeof drawings !== 'undefined') window.drawings = []; drawings = window.drawings;
          _uploadedMode = true;
        };
        img.src = e.target.result;
      };
      r.readAsDataURL(f);
    }

    function terminateChart() {
      /* Stop all live data, clear canvas, show welcome */
      if (chartSSE) { chartSSE.close(); chartSSE = null; }
      if (typeof stopPricePolling === 'function') stopPricePolling();
      chartCandles = [];
      currentSymbol = '';
      dataUrl = null;
      _uploadedMode = false;
      if (typeof drawings !== 'undefined') window.drawings = []; drawings = window.drawings;
      /* Re-enable inputs */
      var pIn = document.getElementById('pairIn');
      if (pIn) { pIn.disabled = false; pIn.style.opacity = ''; pIn.value = ''; }
      var clrBtn = document.getElementById('clearUploadBtn');
      var uplLbl = document.getElementById('uploadLabel');
      if (clrBtn) clrBtn.style.display = 'none';
      if (uplLbl) uplLbl.style.display = '';
      if (fileIn) fileIn.value = '';
      var ab = document.getElementById('azBtn');
      if (ab) ab.disabled = true;
      /* Show welcome overlay */
      var empty = document.getElementById('chartEmpty');
      if (empty) empty.style.display = 'flex';
      /* Clear canvas */
      if (chartCtx && chartCanvas) {
        var dpr = window.devicePixelRatio || 1;
        var W = chartCanvas.width / dpr, H = chartCanvas.height / dpr;
        chartCtx.fillStyle = '#06080d';
        chartCtx.fillRect(0, 0, W, H);
      }
      /* Hide live price */
      var lb = document.getElementById('livePriceBar');
      if (lb) lb.classList.remove('show');
      if (sa) { sa.style.display = 'none'; sa.textContent = ''; }
    }

    function clearUploadedChart() {
      _uploadedMode = false;
      dataUrl = null;
      var clrBtn = document.getElementById('clearUploadBtn');
      var uplLbl = document.getElementById('uploadLabel');
      if (clrBtn) clrBtn.style.display = 'none';
      if (uplLbl) uplLbl.style.display = '';
      if (fileIn) fileIn.value = '';
      if (typeof drawings !== 'undefined') window.drawings = []; drawings = window.drawings;
      var ab = document.getElementById('azBtn');
      if (ab) ab.disabled = true;
      /* Re-enable coin input */
      var pIn2 = document.getElementById('pairIn');
      if (pIn2) { pIn2.disabled = false; pIn2.style.opacity = ''; }
      /* If a coin was loaded, reload it; else show welcome */
      if (typeof currentSymbol !== 'undefined' && currentSymbol) {
        if (typeof chartCandles !== 'undefined') chartCandles = [];
        if (typeof loadChart === 'function') loadChart(currentSymbol, currentInterval);
      } else {
        var empty = document.getElementById('chartEmpty');
        if (empty) empty.style.display = 'flex';
        /* Clear canvas */
        var cv = document.getElementById('chartCanvas');
        var ctx2 = cv ? cv.getContext('2d') : null;
        if (ctx2 && cv) {
          var dpr2 = window.devicePixelRatio || 1;
          ctx2.fillStyle = '#06080d';
          ctx2.fillRect(0, 0, cv.width / dpr2, cv.height / dpr2);
        }
      }
      if (azBtn) azBtn.disabled = true;
      if (typeof drawings !== 'undefined') window.drawings = []; drawings = window.drawings;
    }

    function resetUp() {
      dataUrl = null;
      if (fileIn) fileIn.value = '';
      if (imgPv) imgPv.style.display = 'none';
      if (dropZone) dropZone.style.display = 'flex';
      if (azBtn) azBtn.disabled = true;
      currentSymbol = '';
      var ud = document.getElementById('uniDash'); if (ud) ud.style.display = 'none';
      var re = document.getElementById('rEmpty2'); if (re) re.style.display = 'flex';
      var er = document.getElementById('rErr'); if (er) er.style.display = 'none';
      var ag = document.getElementById('analysisGate'); if (ag) ag.style.display = 'none';
      var ce = document.getElementById('chartEmpty'); if (ce) ce.style.display = 'block';
    }

    function showDash() {
      document.getElementById('rEmpty2').style.display = 'none';
      document.getElementById('rErr').style.display = 'none';
      document.getElementById('uniDash').style.display = 'flex';
    }
    function showErr(msg) {
      document.getElementById('rEmpty2').style.display = 'none';
      document.getElementById('uniDash').style.display = 'none';
      var e = document.getElementById('rErr');
      e.style.display = 'block'; e.textContent = 'Error: ' + msg;
    }

    function setToolStatus(tool, state) {
      var dot = document.getElementById('tsd-' + tool);
      var st = document.getElementById('tss-' + tool);
      var sec = document.getElementById(tool === 'fractal' ? 'fractalStatus' : tool === 'bar' ? 'barStatus' : 'wwStatus');
      if (dot) { dot.className = 'tb-dot ' + (state === 'running' ? 'running' : state === 'done' ? 'done' : 'err'); }
      if (st) { st.textContent = state === 'running' ? '…' : state === 'done' ? '✓' : '!'; }
      if (sec) {
        if (state === 'running') { sec.style.display = 'flex'; sec.className = 'ud-sec-status'; sec.innerHTML = '<div class="ud-spin"></div> Analyzing…'; }
        if (state === 'done') { sec.style.display = 'flex'; sec.className = 'ud-sec-status ud-done'; sec.innerHTML = '✓ Done'; }
        if (state === 'error') { sec.style.display = 'flex'; sec.className = 'ud-sec-status'; sec.style.color = '#e74c3c'; sec.innerHTML = '✗ Failed'; }
      }
    }

    /* ── Backend calls ── */
    function callBackend(endpoint, payload, _retry) {
      return fetch(BACKEND_URL + endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
        .then(function (res) {
          if (res.status === 429 && !_retry) {
            /* back off 8 s then retry once */
            return new Promise(function (resolve) { setTimeout(resolve, 8000); })
              .then(function () { return callBackend(endpoint, payload, true); });
          }
          return res.json();
        })
        .then(function (data) {
          if (data && data.error) throw new Error(data.error);
          return data;
        });
    }
    function callClaude(prompt, base64, mType) { return callBackend('/analyze', { image: base64, mediaType: mType, language: lang }); }

    /* ══ MAIN BUTTON: fire all 3 tools in parallel ══ */
    /* ══ FREEMIUM SYSTEM ══ */
    var FREE_LIMIT = 999;
    var isPro = true; /* DEV MODE — unlimited */

    function getUsed() { return parseInt(localStorage.getItem('fractal_uses') || '0'); }
    function setUsed(n) { localStorage.setItem('fractal_uses', n); }
    function updateUsageBar() {
      var used = getUsed();
      var left = Math.max(0, FREE_LIMIT - used);
      document.getElementById('usageLeft').textContent = left;
      var pct = (left / FREE_LIMIT) * 100;
      var fill = document.getElementById('usageFill');
      fill.style.width = pct + '%';
      fill.className = 'usage-fill' + (left <= 1 ? ' warn' : '');
    }
    function scrollToPricing() { document.getElementById('pricing').scrollIntoView({ behavior: 'smooth' }); }
    function switchChart(mode, btn) {
      document.querySelectorAll('.nd-tab').forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      document.getElementById('outCanvas').style.display = mode === 'annotated' ? 'block' : 'none';
      document.getElementById('predCanvas').style.display = mode === 'predicted' ? 'block' : 'none';
      document.getElementById('bpCanvas').style.display = mode === 'barmap' ? 'block' : 'none';
    }
    function switchAdv(pane, btn) {
      document.querySelectorAll('.nd-adv-tab').forEach(function (b) { b.classList.remove('on'); });
      btn.classList.add('on');
      document.querySelectorAll('.nd-adv-pane').forEach(function (p) { p.classList.remove('on'); });
      var el = document.getElementById('advPane-' + pane);
      if (el) el.classList.add('on');
    }
    function onBpSlider() {
      var sim = document.getElementById('bpSimSlider').value;
      var dim = document.getElementById('bpDimSlider').value / 100;
      var clust = document.getElementById('bpClustSlider').value;
      document.getElementById('bpSimVal').textContent = sim + '%';
      document.getElementById('bpDimVal').textContent = dim.toFixed(2);
      document.getElementById('bpClustVal').textContent = clust;
      drawLiveBpMap();
    }
    function onWwSlider() {
      var h = document.getElementById('wwHurstSlider').value / 100;
      var amp = document.getElementById('wwAmpSlider').value / 100;
      var period = document.getElementById('wwPeriodSlider').value;
      var a = document.getElementById('wwASlider').value / 100;
      var b = document.getElementById('wwBSlider').value;
      var n = document.getElementById('wwNSlider').value;
      document.getElementById('wwHurstVal').textContent = h.toFixed(2);
      document.getElementById('wwAmpVal').textContent = amp.toFixed(2);
      document.getElementById('wwPeriodVal').textContent = period;
      document.getElementById('wwAVal').textContent = a.toFixed(2);
      document.getElementById('wwBVal').textContent = b;
      document.getElementById('wwNVal').textContent = n;
      document.getElementById('wwADisp').textContent = a.toFixed(2);
      document.getElementById('wwBDisp').textContent = b;
      document.getElementById('wwHDisp').textContent = h > 0.55 ? 'Trending' : h < 0.45 ? 'Mean-Rev' : 'Random';
      drawLiveWwDecomp(h, amp, parseInt(period));
      drawLiveWwHarmonics(a, parseInt(b), parseInt(n));
    }
    function drawLiveBpMap() {
      var canvas = document.getElementById('bpLiveCanvas');
      if (!canvas) return;
      canvas.width = canvas.offsetWidth || 300; canvas.height = canvas.offsetHeight || 120;
      var ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
      var sim = document.getElementById('bpSimSlider').value / 100;
      var clust = parseInt(document.getElementById('bpClustSlider').value);
      ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);
      var colors = ['#c9a84c', '#3498db', '#9b8fe8', '#27ae60', '#e74c3c'];
      for (var i = 0; i < clust; i++) {
        var y1 = 8 + (i / (clust + 1)) * H * 0.8, y2 = y1 + H * 0.15;
        ctx.fillStyle = hA(colors[i % colors.length], 0.12);
        ctx.fillRect(W * 0.05, y1, W * 0.38, y2 - y1 + 6);
        ctx.fillRect(W * 0.57, y1, W * 0.38, y2 - y1 + 6);
        ctx.strokeStyle = colors[i % colors.length]; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(W * 0.43, y1 + 3); ctx.lineTo(W * 0.57, y1 + 3); ctx.stroke();
        ctx.setLineDash([]);
        ctx.font = '8px DM Mono'; ctx.fillStyle = colors[i % colors.length]; ctx.textAlign = 'left';
        ctx.fillText(Math.round(sim * 80 + i * 5) + '%', W * 0.44, y1 + 7);
      }
      ctx.fillStyle = 'rgba(201,168,76,.6)'; ctx.font = '8px DM Mono'; ctx.textAlign = 'left';
      ctx.fillText('▸ LIVE CLUSTER MAP', 5, H - 5);
    }
    function drawLiveWwDecomp(H_exp, amp, period) {
      var canvas = document.getElementById('wwDecompCanvas');
      if (!canvas) return;
      canvas.width = canvas.offsetWidth || 300; canvas.height = canvas.offsetHeight || 120;
      var ctx = canvas.getContext('2d'), W = canvas.width, H2 = canvas.height;
      var N = 80;
      ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H2);
      for (var g = 0; g <= 4; g++) { ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(0, H2 / 4 * g); ctx.lineTo(W, H2 / 4 * g); ctx.stroke(); }
      var layers = [
        { fn: function (i) { return (H_exp - 0.5) * 0.6 * (i / N); }, color: '#27ae60', lw: 2, dash: [6, 4] },
        { fn: function (i) { return amp * Math.sin(2 * Math.PI * i / (N / period * 4)); }, color: '#3498db', lw: 1.5, dash: [] },
        { fn: function (i) { return 0.08 * (Math.sin(7 * i / N * Math.PI) + 0.5 * Math.cos(13 * i / N * Math.PI)); }, color: '#9b8fe8', lw: 1, dash: [] }
      ];
      var labels = ['Trend', 'Cycle', 'Noise'];
      layers.forEach(function (l, li) {
        var pts = []; for (var i = 0; i < N; i++) pts.push(l.fn(i));
        var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts), rng = mx - mn || .01;
        var mid = H2 * (.2 + li * .28);
        if (l.dash.length) ctx.setLineDash(l.dash); else ctx.setLineDash([]);
        ctx.strokeStyle = l.color; ctx.lineWidth = l.lw;
        ctx.beginPath();
        pts.forEach(function (v, i) { var x = 4 + (i / (N - 1)) * (W - 8), y = mid - ((v - mn) / rng) * H2 * .22; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = l.color; ctx.font = '8px DM Mono'; ctx.textAlign = 'right';
        ctx.fillText(labels[li], W - 4, mid - H2 * .1);
      });
    }
    function drawLiveWwHarmonics(a, b, n) {
      var canvas = document.getElementById('wwHarmonicsCanvas');
      if (!canvas) return;
      canvas.width = canvas.offsetWidth || 300; canvas.height = canvas.offsetHeight || 120;
      var ctx = canvas.getContext('2d'), W = canvas.width, H2 = canvas.height;
      var N = 200;
      ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H2);
      for (var g = 0; g <= 3; g++) { ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(0, H2 / 3 * g); ctx.lineTo(W, H2 / 3 * g); ctx.stroke(); }
      var pts = []; for (var i = 0; i < N; i++) { var x = i / N, v = 0; for (var k = 0; k < n; k++) v += Math.pow(a, k) * Math.cos(Math.pow(b, k) * Math.PI * x); pts.push(v); }
      var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts), rng = mx - mn || .01;
      ctx.strokeStyle = '#9b8fe8'; ctx.lineWidth = 1.5;
      ctx.beginPath(); pts.forEach(function (v, i) { var x = 4 + (i / (N - 1)) * (W - 8), y = 6 + ((mx - v) / rng) * (H2 - 12); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }); ctx.stroke();
      ctx.fillStyle = 'rgba(155,143,232,.8)'; ctx.font = '8px DM Mono'; ctx.textAlign = 'left';
      ctx.fillText('W(x) N=' + n + ' a=' + a.toFixed(2) + ' b=' + b, 5, H2 - 5);
    }

    updateUsageBar();

    azBtn.addEventListener('click', function () {
      /* Allow analysis WITHOUT a chart if live price is available */
      var hasPair = document.getElementById('pairIn').value.trim();
      var hasChart = !!dataUrl;

      if (!hasChart && !hasPair) {
        showErr('Enter a pair or upload a screenshot to analyze.');
        return;
      }
      /* If no screenshot yet — ask user to capture first */
      if (!hasChart && lwChartInstance) {
        takeSnapshot();
        return;
      }

      /* ── FREEMIUM CHECK ── */
      if (!isPro) {
        var used = getUsed();
        if (used >= FREE_LIMIT) {
          document.getElementById('rEmpty2').style.display = 'none';
          document.getElementById('uniDash').style.display = 'none';
          document.getElementById('analysisGate').style.display = 'flex';
          return;
        }
        setUsed(used + 1);
        updateUsageBar();
      }

      azBtn.disabled = true; azSpin.style.display = 'block';
      var pairVal = document.getElementById('pairIn').value.trim();
      azTxtEl.textContent = pairVal ? 'Analyzing ' + pairVal + '…' : 'Running…';
      showDash();
      document.getElementById('aiCtrlStatus').style.display = 'grid';

      /* Show pro gate if free user */
      document.getElementById('proGate').style.display = 'none';

      /* Capture screenshot for outCanvas background (preserves visual style) */
      captureAndStore();

      /* Capture visible candle data for accurate AI analysis (capped at 80 to control token cost) */
      var _vBars = Math.max(20, Math.floor(chartCandles.length / chartView.zoom));
      var _sIdx = Math.max(0, chartCandles.length - _vBars - chartView.offset);
      var _eIdx = Math.min(chartCandles.length, _sIdx + _vBars);
      var _visC = chartCandles.slice(_sIdx, _eIdx);
      if (_visC.length > 80) _visC = _visC.slice(_visC.length - 80);
      var _pMin = Math.min.apply(null, _visC.map(function (c) { return c.l; }));
      var _pMax = Math.max.apply(null, _visC.map(function (c) { return c.h; }));
      var _rng = _pMax - _pMin;
      _pMin -= _rng * 0.05; _pMax += _rng * 0.05;
      window._lastVisiblePriceMin = _pMin;
      window._lastVisiblePriceMax = _pMax;
      window._lastVisibleCandleCount = _visC.length;

      var pair = document.getElementById('pairIn').value || 'the asset';
      var tf = document.getElementById('tfIn').value || 'auto-detected';
      var focus = document.getElementById('focusIn').value;
      var nM = parseInt(document.getElementById('matchIn').value);

      setToolStatus('fractal', 'running');
      setToolStatus('bar', 'running'); setToolStatus('ww', 'running');

      /* Always run fractal (free) */
      callBackend('/analyze', { candles: _visC, priceMin: _pMin, priceMax: _pMax, pair: pair, timeframe: tf, focus: focus, matches: nM, language: lang })
        .then(function (d) { renderFractal(d); setToolStatus('fractal', 'done'); saveAnalysis('analyze', d); })
        .catch(function (e) { setToolStatus('fractal', 'error'); console.error('Fractal:', e); });

      /* All tools run in dev mode */
      if (true) {
        callBackend('/bar-pattern', { candles: _visC, priceMin: _pMin, priceMax: _pMax, pair: pair, timeframe: tf, language: lang })
          .then(function (d) { renderBarPattern(d); setToolStatus('bar', 'done'); saveAnalysis('bar', d); })
          .catch(function (e) { setToolStatus('bar', 'error'); console.error('Bar:', e); });

        callBackend('/weierstrass', { candles: _visC, priceMin: _pMin, priceMax: _pMax, pair: pair, timeframe: tf, language: lang })
          .then(function (d) { renderWeierstrass(d); setToolStatus('ww', 'done'); saveAnalysis('ww', d); })
          .catch(function (e) { setToolStatus('ww', 'error'); console.error('WW:', e); });
      }

      setTimeout(function () {
        azBtn.disabled = false; azSpin.style.display = 'none'; azTxtEl.textContent = 'Fractal · Bar Pattern · Weierstrass';
      }, 3000);
    });

    function handleFile(f) {
      var r = new FileReader();
      r.onload = function (e) {
        dataUrl = e.target.result;
        prevImg.src = dataUrl;
        dropZone.style.display = 'none';
        imgPv.style.display = 'block';
        azBtn.disabled = false;
      };
      r.readAsDataURL(f);
    }

    function resetUp() {
      dataUrl = null; fileIn.value = '';
      imgPv.style.display = 'none';
      dropZone.style.display = 'flex';
      azBtn.disabled = true;
      document.getElementById('uniDash').style.display = 'none';
      document.getElementById('rEmpty2').style.display = 'flex';
      document.getElementById('rErr').style.display = 'none';
      document.getElementById('analysisGate').style.display = 'none';
    }

    /* Show/hide the unified dashboard */
    function showDash() {
      document.getElementById('rEmpty2').style.display = 'none';
      document.getElementById('rErr').style.display = 'none';
      document.getElementById('uniDash').style.display = 'flex';
    }
    function showErr(msg) {
      document.getElementById('rEmpty2').style.display = 'none';
      document.getElementById('uniDash').style.display = 'none';
      var e = document.getElementById('rErr');
      e.style.display = 'block'; e.textContent = 'Error: ' + msg;
    }

    /* Tool status badges */
    function setToolStatus(tool, state) {
      /* state: 'running' | 'done' | 'error' */
      var dot = document.getElementById('tsd-' + tool);
      var st = document.getElementById('tss-' + tool);
      var sec = document.getElementById(tool === 'fractal' ? 'fractalStatus' : tool === 'bar' ? 'barStatus' : 'wwStatus');
      if (dot) { dot.className = 'tb-dot ' + (state === 'running' ? 'running' : state === 'done' ? 'done' : 'err'); }
      if (st) { st.textContent = state === 'running' ? '…' : state === 'done' ? '✓' : '!'; }
      if (sec) {
        if (state === 'running') { sec.style.display = 'flex'; sec.className = 'ud-sec-status'; sec.innerHTML = '<div class="ud-spin"></div> Analyzing…'; }
        if (state === 'done') { sec.style.display = 'flex'; sec.className = 'ud-sec-status ud-done'; sec.innerHTML = '✓ Done'; }
        if (state === 'error') { sec.style.display = 'flex'; sec.className = 'ud-sec-status'; sec.style.color = '#e74c3c'; sec.innerHTML = '✗ Failed'; }
      }
    }

    /* ══ MAIN BUTTON: fire all 3 tools in parallel ══ */
    /* ══ RENDER: Fractal Pattern Matcher ══ */
