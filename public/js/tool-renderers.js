    function renderFractal(r) {
      var b = document.getElementById('sigBadge');
      b.textContent = (r.signal || 'neutral').toUpperCase();
      b.className = 'sig ' + (r.signal === 'bullish' ? 's-bull' : r.signal === 'bearish' ? 's-bear' : 's-n');
      var fb = document.getElementById('fractalBadge');
      fb.textContent = (r.signal || 'neutral').toUpperCase();
      fb.className = 'ud-sec-badge sig ' + (r.signal === 'bullish' ? 's-bull' : r.signal === 'bearish' ? 's-bear' : 's-n');
      document.getElementById('acPair').textContent = [r.pair, r.pattern].filter(Boolean).join(' · ');
      document.getElementById('acTf').textContent = [r.timeframe, r.wave, r.confidence && r.confidence + ' confidence', r.rr && 'R:R ' + r.rr].filter(Boolean).join(' · ');
      document.getElementById('acBody').innerHTML = (r.analysis || '').replace(/\n/g, '<br>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
      document.getElementById('levelsEl').innerHTML = [{ c: 'lv-e', n: 'Entry', v: r.entry }, { c: 'lv-s', n: 'SL', v: r.stop_loss }, { c: 'lv-t1', n: 'TP1', v: r.target_1 }, { c: 'lv-t2', n: 'TP2', v: r.target_2 }]
        .filter(function (l) { return l.v && l.v !== 'N/A'; })
        .map(function (l) { return '<div class="lv ' + l.c + '"><div class="lv-n">' + l.n + '</div><div class="lv-v">' + l.v + '</div></div>'; }).join('');
      drawAnnotated(r.annotations || []);
      drawPrediction(r.predicted_path || []);
      document.getElementById('predBody').innerHTML = (r.prediction_summary || '').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');

      /* Patterns row */
      var m = r.matches || [];
      var mb = document.getElementById('matchesBadge');
      mb.textContent = m.length + ' matches · ' + (r.win_rate || '—') + '% win · R:R ' + (r.avg_rr || '—');
      mb.style.color = 'var(--muted)'; mb.style.fontFamily = "'DM Mono',monospace"; mb.style.fontSize = '8px';
      document.getElementById('matchesStatus').style.display = 'flex';
      document.getElementById('wrRow').innerHTML = [
        { v: (r.win_rate || 67) + '%', l: 'Win Rate', c: '#27ae60' },
        { v: r.avg_rr || '—', l: 'Avg R:R', c: 'var(--gold)' },
        { v: r.wins || 0, l: 'Wins', c: '#27ae60' },
        { v: r.losses || 0, l: 'Losses', c: '#e74c3c' }
      ].map(function (x) { return '<div class="wr-b"><div class="wr-v" style="color:' + x.c + '">' + x.v + '</div><div class="wr-l">' + x.l + '</div></div>'; }).join('');
      var mc = document.getElementById('mcardsEl'); mc.innerHTML = '';
      m.forEach(function (match, idx) {
        var ob = match.outcome === 'win' ? 'ob-w' : match.outcome === 'loss' ? 'ob-l' : 'ob-p';
        var lc = match.outcome === 'win' ? '#27ae60' : match.outcome === 'loss' ? '#e74c3c' : '#c9a84c';
        var obTxt = match.outcome === 'win' ? 'WIN' : match.outcome === 'loss' ? 'LOSS' : 'PARTIAL';
        var d = document.createElement('div'); d.className = 'mcard';
        d.innerHTML = '<div class="mcard-hd"><span class="mcard-t">' + match.date + ' · ' + match.pair + ' · ' + match.timeframe + '</span><span class="mcard-s">' + match.similarity + '%</span></div>'
          + '<div class="mcard-ch"><div><div class="mcard-cl"><span>' + (match.pattern_name || '') + '</span></div><canvas class="mini" id="mp' + idx + '" width="200" height="55"></canvas></div>'
          + '<div class="mcd"></div><div><div class="mcard-cl"><span>After</span><span class="ob ' + ob + '">' + obTxt + '</span></div><canvas class="mini" id="ma' + idx + '" width="200" height="55"></canvas></div></div>'
          + '<div class="mcard-ft"><strong>' + (match.outcome_detail || '') + '</strong> — ' + (match.setup_description || '') + '</div>';
        mc.appendChild(d);
        setTimeout(function () {
          drawMini(document.getElementById('mp' + idx), match.price_path || [], '#c9a84c');
          drawMini(document.getElementById('ma' + idx), match.after_path || [], lc);
        }, 60);
      });
    }

    /* ══ RENDER: Bar Pattern ══ */
    function renderBarPattern(r) {
      var b = document.getElementById('bpSigBadge');
      if (b) { b.textContent = (r.signal || 'neutral').toUpperCase(); b.className = 'sig ' + (r.signal === 'bullish' ? 's-bull' : r.signal === 'bearish' ? 's-bear' : 's-n'); }
      var bb = document.getElementById('barBadge');
      if (bb) { bb.textContent = 'Sim ' + (r.self_similarity_score || '—') + '% · D=' + (r.fractal_dimension || '—'); bb.style.color = 'var(--muted)'; bb.style.fontFamily = 'DM Mono,monospace'; bb.style.fontSize = '8px'; }
      var bpP = document.getElementById('bpPair'); if (bpP) bpP.textContent = [r.pair, r.dominant_pattern].filter(Boolean).join(' · ');
      var bpM = document.getElementById('bpMeta'); if (bpM) bpM.textContent = [r.timeframe, r.confidence && r.confidence + ' confidence'].filter(Boolean).join(' · ');
      var bpMet = document.getElementById('bpMetrics');
      if (bpMet) bpMet.innerHTML = [
        { v: (r.self_similarity_score || 0) + '%', l: 'Self-Similarity', c: 'var(--gold)' },
        { v: r.fractal_dimension || '—', l: 'Fractal Dim.', c: '#3498db' },
        { v: r.confidence || '—', l: 'Confidence', c: '#27ae60' }
      ].map(function (m) { return '<div class="wr-b"><div class="wr-v" style="color:' + m.c + '">' + m.v + '</div><div class="wr-l">' + m.l + '</div></div>'; }).join('');
      var bpImp = document.getElementById('bpImplication'); if (bpImp) bpImp.innerHTML = '<strong>Implication:</strong> ' + (r.trading_implication || '');
      var scales = r.scale_levels || [];
      var bpSc = document.getElementById('bpScales');
      if (bpSc) bpSc.innerHTML = scales.map(function (s) {
        var sc = s.strength === 'high' ? '#27ae60' : s.strength === 'medium' ? 'var(--gold)' : 'var(--muted)';
        return '<div class="wr-b"><div class="wr-v" style="font-size:11px;color:' + sc + '">' + s.level + '</div><div class="wr-l">' + s.bars + ' bars · ' + (s.pattern || '') + '</div></div>';
      }).join('');
      var clusters = r.bar_clusters || [];
      var cc = document.getElementById('bpClusters'); if (cc) cc.innerHTML = '';
      clusters.forEach(function (cl) {
        var d = document.createElement('div'); d.className = 'mcard';
        d.innerHTML = '<div class="mcard-hd"><span class="mcard-t" style="color:' + (cl.color || '#c9a84c') + '">' + cl.name + '</span><span class="mcard-s">' + cl.similarity_pct + '% match</span></div>'
          + '<div class="mcard-ch"><div><div class="mcard-cl"><span>' + (cl.location_a && cl.location_a.label || 'A') + '</span></div><canvas class="mini" id="bpc' + cl.id + 'a" width="200" height="55"></canvas></div>'
          + '<div class="mcd"></div><div><div class="mcard-cl"><span>' + (cl.location_b && cl.location_b.label || 'B') + '</span></div><canvas class="mini" id="bpc' + cl.id + 'b" width="200" height="55"></canvas></div></div>'
          + '<div class="mcard-ft">' + cl.description + '</div>';
        cc.appendChild(d);
        setTimeout(function () {
          drawMini(document.getElementById('bpc' + cl.id + 'a'), cl.bar_sequence || [], cl.color || '#c9a84c');
          drawMini(document.getElementById('bpc' + cl.id + 'b'), cl.bar_sequence || [], cl.color || '#c9a84c');
        }, 60);
      });
      drawBarPatternMap(r);
      /* Feed into Self-Similarity demo */
      var simScore = (r.self_similarity_score || 50) / 100;
      document.getElementById('mfR').value = Math.round(Math.min(Math.max(simScore * 100, 25), 75));
      var fd = parseFloat(r.fractal_dimension) || 1.5;
      document.getElementById('mfD').value = Math.round(Math.min(Math.max((fd - 1.0) * 5, 1), 5));
    }

    /* ══ RENDER: Weierstrass ══ */
    function renderWeierstrass(r) {
      var edge = (r.noise_signal && r.noise_signal.edge) || 'neutral';
      var b = document.getElementById('wwSigBadge');
      if (b) { b.textContent = edge.toUpperCase(); b.className = 'sig ' + (edge === 'bullish' ? 's-bull' : edge === 'bearish' ? 's-bear' : 's-n'); }
      var wb = document.getElementById('wwBadge');
      if (wb) { wb.textContent = 'H=' + (r.hurst_exponent || '—') + ' · D=' + (r.fractal_dimension || '—') + ' · ' + (r.market_regime || ''); wb.style.color = 'var(--muted)'; wb.style.fontFamily = 'DM Mono,monospace'; wb.style.fontSize = '8px'; }
      var wwP = document.getElementById('wwPair'); if (wwP) wwP.textContent = [r.pair, 'H=' + r.hurst_exponent, 'D=' + r.fractal_dimension].filter(Boolean).join(' · ');
      var wwM = document.getElementById('wwMeta'); if (wwM) wwM.textContent = [r.timeframe, r.market_regime, r.noise_signal && r.noise_signal.confidence + ' confidence'].filter(Boolean).join(' · ');
      var wf = r.weierstrass_fit || {};
      var wwMet = document.getElementById('wwMetrics');
      if (wwMet) wwMet.innerHTML = [
        { v: r.hurst_exponent || '—', l: 'Hurst H', c: 'var(--gold)' },
        { v: r.fractal_dimension || '—', l: 'Fractal Dim', c: '#3498db' },
        { v: r.roughness_index || '—', l: 'Roughness', c: '#9b8fe8' },
        { v: (wf.quality || '—'), l: 'W-Fit', c: '#27ae60' }
      ].map(function (m) { return '<div class="wr-b"><div class="wr-v" style="font-size:12px;color:' + m.c + '">' + m.v + '</div><div class="wr-l">' + m.l + '</div></div>'; }).join('');
      var wwN = document.getElementById('wwNoise');
      if (wwN) wwN.innerHTML = (wf.description || '') + (r.scale_invariance ? ' <strong style="color:var(--gold)">Scale-invariance: ' + (r.scale_invariance.confirmed ? '✓' : '✗') + '</strong>' : '');
      drawWWDecomp(r);
      drawWWHarmonics(r);
      var dc = r.decomposition || {};
      var tr = dc.trend, cy = dc.cycle, fn = dc.fractal_noise;
      var wwDC = document.getElementById('wwDecompCards'); if (wwDC) wwDC.innerHTML = [
        { t: 'Trend', v: tr && tr.direction, s: tr && tr.description, c: 'var(--gold)', detail: tr && 'Strength: ' + (tr.strength || '—') },
        { t: 'Cycle', v: cy && cy.phase, s: cy && cy.description, c: '#3498db', detail: cy && (cy.period_bars + ' bars · amp ' + cy.amplitude) },
        { t: 'Fractal Noise', v: fn && fn.color, s: fn && fn.description, c: '#9b8fe8', detail: fn && ('W(a=' + fn.weierstrass_a + ', b=' + fn.weierstrass_b + ')') },
        { t: 'W-Score', v: (wf.score || '—') + '%', s: 'Harmonic fit quality', c: '#27ae60', detail: 'Freq: ' + (wf.dominant_frequency || '—') }
      ].map(function (x) { return '<div class="acard" style="border-color:' + hA(x.c, .2) + '"><div class="ac-hd"><span class="sig" style="color:' + x.c + ';border-color:' + hA(x.c, .3) + ';background:' + hA(x.c, .08) + '">' + (x.v || '—').toString().toUpperCase() + '</span><div class="ac-tf">' + x.t + '</div></div><div class="ac-body">' + x.s + '<br><span style="color:' + x.c + ';font-size:10px">' + x.detail + '</span></div></div>'; }).join('');
      var wwInt = document.getElementById('wwInterpretation'); if (wwInt) wwInt.innerHTML = (r.noise_signal && r.noise_signal.interpretation) || '';
      /* Feed into Weierstrass science demo */
      var aVal = (wf.weierstrass_a) || (fn && fn.weierstrass_a) || 0.7;
      var bVal = (wf.weierstrass_b) || (fn && fn.weierstrass_b) || 3;
      var nVal = (wf.harmonics && wf.harmonics.length) || 8;
      document.getElementById('mwA').value = Math.round(Math.min(Math.max(aVal * 100, 50), 95));
      document.getElementById('mwB').value = Math.min(Math.max(Math.round(bVal), 2), 9);
      document.getElementById('mwN').value = Math.min(Math.max(nVal, 1), 20);
      /* Redraw demos with AI values */
      drawMW();
      if (dc.trend) drawMTSLive(dc);
    }

    /* ══ DRAW HELPERS ══ */

    function hA(hex, a) { var r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16); return 'rgba(' + r + ',' + g + ',' + b + ',' + a + ')'; }

    function drawAnnotated(annotations) {
      var canvas = document.getElementById('outCanvas'), ctx = canvas.getContext('2d'), img = new Image();
      img.onload = function () {
        canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0);
        var W = canvas.width, H = canvas.height, fs = Math.max(10, Math.min(W, H) * .022);
        /* Convert real prices → normalized y (0=top/high, 1=bottom/low) */
        var _pMn = window._lastVisiblePriceMin || 0, _pMx = window._lastVisiblePriceMax || 1;
        var _nC = window._lastVisibleCandleCount || 100;
        function _p2y(p) { var v = parseFloat(String(p).replace(/[^0-9.]/g, '')) || 0; return 1 - (v - _pMn) / (_pMx - _pMn); }
        function _b2x(idx) { return Math.max(0, Math.min(1, (idx || 0) / _nC)); }
        var annotations2 = (annotations || []).map(function (a) {
          var n = Object.assign({}, a);
          if (a.price !== undefined) n.y = _p2y(a.price);
          if (a.priceFrom !== undefined) n.y1 = _p2y(a.priceFrom);
          if (a.priceTo !== undefined) n.y2 = _p2y(a.priceTo);
          if (a.price1 !== undefined) { n.y1 = _p2y(a.price1); n.x1 = _b2x(a.barIndex1); }
          if (a.price2 !== undefined) { n.y2 = _p2y(a.price2); n.x2 = _b2x(a.barIndex2); }
          if (a.barIndex !== undefined) n.x = _b2x(a.barIndex);
          return n;
        });
        annotations2.forEach(function (a) {
          ctx.save();
          if (a.type === 'hline') { var y = a.y * H; ctx.strokeStyle = a.color || '#c9a84c'; ctx.lineWidth = Math.max(1.5, H * .003); if (a.dashed) ctx.setLineDash([7, 4]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); ctx.setLineDash([]); if (a.label) { var tw = ctx.measureText(a.label).width; ctx.fillStyle = 'rgba(6,8,13,.75)'; ctx.fillRect(5, y - fs * 1.1, tw + 10, fs * 1.3); ctx.fillStyle = a.color || '#c9a84c'; ctx.font = fs * .85 + 'px sans-serif'; ctx.textAlign = 'left'; ctx.fillText(a.label, 9, y - fs * .08); } }
          else if (a.type === 'arrow') { var x = a.x * W, ay = a.y * H, up = a.dir === 'up', sz = Math.max(13, W * .019); ctx.fillStyle = a.color || (up ? '#27ae60' : '#e74c3c'); ctx.beginPath(); if (up) { ctx.moveTo(x, ay - sz * .6); ctx.lineTo(x - sz * .45, ay + sz * .3); ctx.lineTo(x + sz * .45, ay + sz * .3); } else { ctx.moveTo(x, ay + sz * .6); ctx.lineTo(x - sz * .45, ay - sz * .3); ctx.lineTo(x + sz * .45, ay - sz * .3); } ctx.closePath(); ctx.fill(); if (a.label) { ctx.font = '500 ' + fs * .78 + 'px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = a.color || (up ? '#27ae60' : '#e74c3c'); ctx.fillText(a.label, x, up ? ay + sz * .9 : ay - sz * .65); } }
          else if (a.type === 'zone') { var y1 = a.y1 * H, y2 = a.y2 * H; ctx.fillStyle = hA(a.color || '#c9a84c', .1); ctx.fillRect(0, y1, W, y2 - y1); ctx.strokeStyle = hA(a.color || '#c9a84c', .4); ctx.lineWidth = .8; ctx.setLineDash([5, 3]); ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(W, y1); ctx.stroke(); ctx.beginPath(); ctx.moveTo(0, y2); ctx.lineTo(W, y2); ctx.stroke(); ctx.setLineDash([]); if (a.label) { ctx.font = fs * .78 + 'px sans-serif'; ctx.fillStyle = hA(a.color || '#c9a84c', .85); ctx.textAlign = 'right'; ctx.fillText(a.label, W - 7, y1 + (y2 - y1) / 2 + 4); } }
          else if (a.type === 'tline') { ctx.strokeStyle = a.color || '#f39c12'; ctx.lineWidth = Math.max(1.5, H * .003); ctx.beginPath(); ctx.moveTo(a.x1 * W, a.y1 * H); ctx.lineTo(a.x2 * W, a.y2 * H); ctx.stroke(); if (a.label) { var mx2 = ((a.x1 + a.x2) / 2) * W, my2 = ((a.y1 + a.y2) / 2) * H; ctx.font = fs * .78 + 'px sans-serif'; ctx.fillStyle = a.color || '#f39c12'; ctx.textAlign = 'center'; ctx.fillText(a.label, mx2, my2 - 5); } }
          ctx.restore();
        });
        ctx.save(); ctx.font = Math.max(9, W * .011) + 'px serif'; ctx.fillStyle = 'rgba(201,168,76,.22)'; ctx.textAlign = 'right'; ctx.fillText('FRACTAL AI AGENT', W - 7, H - 7); ctx.restore();
        document.getElementById('dlBtn').onclick = function () { var a = document.createElement('a'); a.download = 'fractal-analysis.png'; a.href = canvas.toDataURL(); a.click(); };
      };
      img.src = dataUrl;
    }

    function drawMini(canvas, path, color) {
      if (!canvas || !path || !path.length) return;
      var ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
      ctx.fillStyle = '#0d1018'; ctx.fillRect(0, 0, W, H);
      var mn = Math.min.apply(null, path), mx = Math.max.apply(null, path), r = mx - mn || .1, n = path.length;
      var px = function (i) { return 4 + (i / (n - 1)) * (W - 8); }, py = function (v) { return 4 + ((mx - v) / r) * (H - 8); };
      ctx.beginPath(); path.forEach(function (v, i) { i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)); });
      ctx.lineTo(W - 4, H); ctx.lineTo(4, H); ctx.closePath(); ctx.fillStyle = hA(color, .07); ctx.fill();
      ctx.beginPath(); ctx.strokeStyle = color; ctx.lineWidth = 1.2; path.forEach(function (v, i) { i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)); }); ctx.stroke();
    }

    function drawPrediction(predicted) {
      var canvas = document.getElementById('predCanvas'), ctx = canvas.getContext('2d'), img = new Image();
      img.onload = function () {
        canvas.width = img.width; canvas.height = img.height; ctx.drawImage(img, 0, 0);
        var W = canvas.width, H = canvas.height;
        if (predicted && predicted.length > 1) {
          /* Normalize predicted_path: support both real prices and legacy 0-1 floats */
          var _pMn = window._lastVisiblePriceMin || 0, _pMx = window._lastVisiblePriceMax || 1;
          var isRealPrices = predicted[0] > 1; /* real prices are never between 0 and 1 */
          var normalized = isRealPrices
            ? predicted.map(function (v) { return 1 - (v - _pMn) / (_pMx - _pMn); })
            : predicted;
          var n = normalized.length, sX = W * .6, eX = W * .93;
          var px = function (i) { return sX + (i / (n - 1)) * (eX - sX); }, py = function (v) { return v * H; };
          predicted = normalized;
          ctx.fillStyle = 'rgba(41,128,185,.06)'; ctx.beginPath(); ctx.moveTo(px(0), py(predicted[0]) - H * .05);
          predicted.forEach(function (v, i) { ctx.lineTo(px(i), py(v) - H * .025 * (1 + i / n)); });
          predicted.slice().reverse().forEach(function (v, i) { ctx.lineTo(px(n - 1 - i), py(v) + H * .025 * (1 + (n - 1 - i) / n)); });
          ctx.closePath(); ctx.fill();
          ctx.strokeStyle = 'rgba(41,128,185,.85)'; ctx.lineWidth = 2; ctx.setLineDash([6, 4]);
          ctx.beginPath(); predicted.forEach(function (v, i) { i === 0 ? ctx.moveTo(px(i), py(v)) : ctx.lineTo(px(i), py(v)); }); ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(41,128,185,.8)'; ctx.font = Math.max(9, W * .011) + 'px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('Predicted \u2192', px(0) + 5, py(predicted[0]) - H * .06);
          ctx.fillStyle = '#2980b9'; ctx.beginPath(); ctx.arc(px(0), py(predicted[0]), 4, 0, Math.PI * 2); ctx.fill();
        }
        ctx.save(); ctx.font = Math.max(9, W * .011) + 'px serif'; ctx.fillStyle = 'rgba(201,168,76,.22)'; ctx.textAlign = 'right'; ctx.fillText('FRACTAL AI AGENT', W - 7, H - 7); ctx.restore();
      };
      img.src = dataUrl;
    }

    function drawBarPatternMap(r) {
      var canvas = document.getElementById('bpCanvas'), ctx = canvas.getContext('2d'), img = new Image();
      img.onload = function () {
        canvas.width = img.width; canvas.height = img.height;
        var W = canvas.width, H = canvas.height;
        ctx.drawImage(img, 0, 0, W, H);
        var clusters = r.bar_clusters || [];
        clusters.forEach(function (cl) {
          var col = cl.color || '#c9a84c';
          [cl.location_a, cl.location_b].forEach(function (loc, i) {
            if (!loc) return;
            var x1 = (loc.x1 || 0) * W, x2 = (loc.x2 || 1) * W;
            ctx.fillStyle = hA(col, .15); ctx.fillRect(x1, 0, x2 - x1, H);
            ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.setLineDash(i === 0 ? [] : [4, 3]);
            ctx.strokeRect(x1, 2, x2 - x1, H - 4); ctx.setLineDash([]);
            ctx.fillStyle = col; ctx.font = '9px sans-serif'; ctx.textAlign = 'center';
            ctx.fillText(loc.label || '', (x1 + x2) / 2, H - 6);
          });
        });
        if (r.next_expected_sequence && r.next_expected_sequence.length) {
          var seq = r.next_expected_sequence, ns = seq.length;
          var sX = W * 0.8, eX = W * 0.98;
          var smn = Math.min.apply(null, seq), smx = Math.max.apply(null, seq), srng = smx - smn || 0.1;
          ctx.strokeStyle = 'rgba(41,128,185,.9)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 3]);
          ctx.beginPath();
          seq.forEach(function (v, i) { var x = sX + (i / (ns - 1)) * (eX - sX), y = 4 + ((smx - v) / srng) * (H - 12); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
          ctx.stroke(); ctx.setLineDash([]);
          ctx.fillStyle = 'rgba(41,128,185,.8)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'center';
          ctx.fillText('Expected \u2192', (sX + eX) / 2, H - 4);
        }
      };
      img.src = dataUrl;
    }

    function drawWWDecomp(r) {
      var canvas = document.getElementById('wwDecompCanvas'), ctx = canvas.getContext('2d');
      var W = canvas.offsetWidth || 400, H = 130;
      canvas.width = W; canvas.height = H;
      ctx.fillStyle = '#0d1018'; ctx.fillRect(0, 0, W, H);
      var dc = r.decomposition || {};
      var layers = [
        { path: dc.trend && dc.trend.path, color: '#c9a84c', label: 'Trend', lw: 2 },
        { path: dc.cycle && dc.cycle.path, color: '#3498db', label: 'Cycle', lw: 1.2 },
        { path: dc.fractal_noise && dc.fractal_noise.path, color: '#9b8fe8', label: 'Noise', lw: 1 }
      ];
      if (r.predicted_decomposed_path) layers.push({ path: r.predicted_decomposed_path, color: 'rgba(41,128,185,.6)', label: 'Predicted', lw: 1.5, dash: [5, 3] });
      var allPts = []; layers.forEach(function (l) { if (l.path) allPts = allPts.concat(l.path); });
      var mn = allPts.length ? Math.min.apply(null, allPts) : -0.2, mx2 = allPts.length ? Math.max.apply(null, allPts) : 1.2, rng = mx2 - mn || 1;
      var pad = 14;
      function ppx(i, n) { return pad + (i / (n - 1)) * (W - pad * 2); }
      function ppy(v) { return pad + ((mx2 - v) / rng) * (H - pad * 2); }
      [0, .25, .5, .75, 1].forEach(function (v) { var y = ppy(mn + v * rng); ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); });
      layers.forEach(function (l) {
        if (!l.path || l.path.length < 2) return;
        ctx.strokeStyle = l.color; ctx.lineWidth = l.lw;
        if (l.dash) ctx.setLineDash(l.dash); else ctx.setLineDash([]);
        ctx.beginPath(); l.path.forEach(function (v, i) { i === 0 ? ctx.moveTo(ppx(i, l.path.length), ppy(v)) : ctx.lineTo(ppx(i, l.path.length), ppy(v)); });
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = l.color; ctx.font = '8px sans-serif'; ctx.textAlign = 'left';
        ctx.fillText(l.label, pad + 2, ppy(l.path[0]) - 3);
      });
    }

    function drawWWHarmonics(r) {
      var canvas = document.getElementById('wwHarmonicsCanvas'), ctx = canvas.getContext('2d');
      var W = canvas.offsetWidth || 400, H = 90;
      canvas.width = W; canvas.height = H;
      ctx.fillStyle = '#0d1018'; ctx.fillRect(0, 0, W, H);
      var harmonics = (r.weierstrass_fit && r.weierstrass_fit.harmonics) || [];
      if (!harmonics.length) return;
      var maxW2 = Math.max.apply(null, harmonics.map(function (h) { return h.weight || 0; }));
      var barW = Math.floor((W - 20) / harmonics.length) - 4, pad = 10;
      harmonics.forEach(function (h, i) {
        var bh = ((h.weight || 0) / maxW2) * (H - 20);
        var x = pad + i * (barW + 4);
        var alpha = 0.3 + 0.7 * (h.weight / maxW2);
        ctx.fillStyle = 'rgba(201,168,76,' + alpha + ')'; ctx.fillRect(x, H - 10 - bh, barW, bh);
        ctx.fillStyle = 'rgba(201,168,76,.7)'; ctx.font = '7px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText('n=' + h.n, x + barW / 2, H - 2);
        ctx.fillStyle = 'rgba(255,255,255,.4)'; ctx.fillText(h.frequency, x + barW / 2, H - 10 - bh - 3);
      });
      ctx.fillStyle = 'rgba(255,255,255,.2)'; ctx.font = '8px sans-serif'; ctx.textAlign = 'left'; ctx.fillText('Frequency', 2, 10);
    }

    /* ══ SCIENCE DEMOS ══ */

    function swSciM(i, el) {
      document.querySelectorAll('.sci-tab-m').forEach(function (t) { t.classList.remove('active'); });
      document.querySelectorAll('.sci-pan-m').forEach(function (p) { p.classList.remove('active'); });
      el.classList.add('active');
      document.getElementById('smp' + i).classList.add('active');
      if (i === 0) drawMW();
      if (i === 1) drawMTS();
      if (i === 2) drawMF();
    }

    function scSetup(canvas) {
      var W = canvas.offsetWidth || (canvas.parentElement && canvas.parentElement.offsetWidth) || 600;
      canvas.width = W;
      return { ctx: canvas.getContext('2d'), W: W, H: canvas.height };
    }

    function weierstrassVal(x, a, b, n) {
      var s = 0; for (var k = 0; k < n; k++)s += Math.pow(a, k) * Math.cos(Math.pow(b, k) * Math.PI * x); return s;
    }

    function drawMW() {
      var n = parseInt(document.getElementById('mwN').value);
      var a = parseInt(document.getElementById('mwA').value) / 100;
      var b = parseInt(document.getElementById('mwB').value);
      document.getElementById('mwNv').textContent = n;
      document.getElementById('mwAv').textContent = a.toFixed(2);
      document.getElementById('mwBv').textContent = b;
      var canvas = document.getElementById('mwCanvas');
      var r = scSetup(canvas); var ctx = r.ctx, W = r.W, H = r.H;
      var PAD = 8, CW = W - PAD * 2, CH = H - PAD * 2, steps = 900, pts = [];
      for (var i = 0; i <= steps; i++)pts.push(weierstrassVal((i / steps) * 4 - 2, a, b, n));
      var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts), rng = mx - mn || 1;
      ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);
      for (var g = 0; g <= 4; g++) { var gy = PAD + (g / 4) * CH; ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(PAD, gy); ctx.lineTo(W - PAD, gy); ctx.stroke(); }
      [3, 1.5, 0].forEach(function (lw, pi) {
        ctx.beginPath();
        ctx.strokeStyle = pi === 0 ? 'rgba(155,143,232,.06)' : pi === 1 ? 'rgba(155,143,232,.18)' : 'rgba(155,143,232,.9)';
        ctx.lineWidth = pi === 0 ? 6 : pi === 1 ? 3 : 1.2;
        pts.forEach(function (v, i) { var x = PAD + (i / steps) * CW, y = PAD + CH - ((v - mn) / rng) * CH; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
        ctx.stroke();
      });
      var zY = PAD + CH - ((0 - mn) / rng) * CH;
      ctx.strokeStyle = 'rgba(201,168,76,.18)'; ctx.lineWidth = .6; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(PAD, zY); ctx.lineTo(W - PAD, zY); ctx.stroke(); ctx.setLineDash([]);
      var iW = 140, iH = 64, iX = W - iW - 10, iY = 10;
      ctx.fillStyle = 'rgba(6,8,13,.92)'; ctx.fillRect(iX, iY, iW, iH);
      ctx.strokeStyle = 'rgba(201,168,76,.28)'; ctx.lineWidth = .6; ctx.strokeRect(iX, iY, iW, iH);
      ctx.fillStyle = 'rgba(201,168,76,.5)'; ctx.font = '8px DM Mono'; ctx.textAlign = 'left'; ctx.fillText('zoom \xd78', iX + 4, iY + 10);
      var zS = Math.floor(steps * .45), zE = Math.floor(steps * .55), zPts = pts.slice(zS, zE);
      var zmn = Math.min.apply(null, zPts), zmx = Math.max.apply(null, zPts), zr = zmx - zmn || .01;
      ctx.beginPath(); ctx.strokeStyle = 'rgba(201,168,76,.85)'; ctx.lineWidth = 1.2;
      zPts.forEach(function (v, i) { var x = iX + 4 + (i / (zPts.length - 1)) * (iW - 8), y = iY + 6 + ((zmx - v) / zr) * (iH - 12); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.stroke();
    }

    function drawMTS() {
      var n = 400, t = [];
      for (var i = 0; i < n; i++)t.push(i / n);
      var trend = t.map(function (x) { return .3 * x + .08 * Math.sin(x * Math.PI); });
      var cycle = t.map(function (x) { return .18 * Math.sin(x * Math.PI * 6) + .09 * Math.sin(x * Math.PI * 10); });
      var noise = t.map(function (x) { var s = 0; for (var k = 0; k < 8; k++)s += Math.pow(.65, k) * Math.cos(Math.pow(3, k) * Math.PI * x * 2); return s * .055; });
      var price = t.map(function (_, i) { return trend[i] + cycle[i] + noise[i]; });
      var canvas = document.getElementById('mtsCanvas');
      var r = scSetup(canvas); var ctx = r.ctx, W = r.W, H = r.H;
      var PAD = 8, CW = W - PAD * 2, CH = H - PAD * 2;
      function nY(arr, v) { var mn = Math.min.apply(null, arr), mx = Math.max.apply(null, arr); return PAD + CH - ((v - mn) / (mx - mn || 1)) * CH; }
      ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);
      for (var g = 0; g <= 4; g++) { var gy = PAD + (g / 4) * CH; ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(PAD, gy); ctx.lineTo(W - PAD, gy); ctx.stroke(); }
      ctx.fillStyle = 'rgba(52,152,219,.05)'; ctx.beginPath();
      trend.forEach(function (v, i) { ctx.lineTo(PAD + (i / (n - 1)) * CW, nY(price, v + cycle[i])); });
      trend.slice().reverse().forEach(function (v, i) { ctx.lineTo(PAD + ((n - 1 - i) / (n - 1)) * CW, nY(price, v)); });
      ctx.closePath(); ctx.fill();
      ctx.setLineDash([6, 4]); ctx.strokeStyle = 'rgba(46,204,113,.45)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); trend.forEach(function (v, i) { var x = PAD + (i / (n - 1)) * CW; i === 0 ? ctx.moveTo(x, nY(price, v)) : ctx.lineTo(x, nY(price, v)); }); ctx.stroke(); ctx.setLineDash([]);
      ctx.strokeStyle = '#c9a84c'; ctx.lineWidth = 2;
      ctx.beginPath(); price.forEach(function (v, i) { var x = PAD + (i / (n - 1)) * CW, y = nY(price, v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }); ctx.stroke();
      ctx.beginPath(); price.forEach(function (v, i) { var x = PAD + (i / (n - 1)) * CW, y = nY(price, v); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
      ctx.lineTo(W - PAD, H); ctx.lineTo(PAD, H); ctx.closePath(); ctx.fillStyle = 'rgba(201,168,76,.04)'; ctx.fill();
      ctx.font = '500 10px DM Mono'; ctx.textAlign = 'right';
      ctx.fillStyle = '#c9a84c'; ctx.fillText('Price (T+C+N)', W - PAD - 4, PAD + 14);
      ctx.fillStyle = 'rgba(46,204,113,.7)'; ctx.fillText('Trend (T)', W - PAD - 4, PAD + 28);
      ctx.fillStyle = 'rgba(52,152,219,.6)'; ctx.fillText('Cycle band', W - PAD - 4, PAD + 42);
      ctx.fillStyle = 'rgba(155,143,232,.7)'; ctx.fillText('Fractal noise', W - PAD - 4, H - PAD - 6);
      function drawComp(id, arr, color) {
        var c = document.getElementById(id); if (!c) return;
        c.width = c.offsetWidth || 220; c.height = 70;
        var cx = c.getContext('2d'), W2 = c.width, H2 = c.height;
        var mn = Math.min.apply(null, arr), mx = Math.max.apply(null, arr), rng = mx - mn || .01;
        cx.fillStyle = '#0d1018'; cx.fillRect(0, 0, W2, H2);
        cx.beginPath(); arr.forEach(function (v, i) { var x = 4 + (i / (n - 1)) * (W2 - 8), y = 6 + ((mx - v) / rng) * (H2 - 12); i === 0 ? cx.moveTo(x, y) : cx.lineTo(x, y); });
        cx.lineTo(W2 - 4, H2); cx.lineTo(4, H2); cx.closePath(); cx.fillStyle = hA(color, .07); cx.fill();
        cx.beginPath(); cx.strokeStyle = color; cx.lineWidth = 1.3; arr.forEach(function (v, i) { var x = 4 + (i / (n - 1)) * (W2 - 8), y = 6 + ((mx - v) / rng) * (H2 - 12); i === 0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }); cx.stroke();
      }
      setTimeout(function () { drawComp('mtsT', trend, '#27ae60'); drawComp('mtsC', cycle, '#3498db'); drawComp('mtsN', noise, '#9b8fe8'); }, 30);
    }

    function drawMTSLive(dc) {
      var canvas = document.getElementById('mtsCanvas');
      var r = scSetup(canvas); var ctx = r.ctx, W = r.W, H = r.H;
      var PAD = 8, CW = W - PAD * 2, CH = H - PAD * 2;
      ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);
      for (var g = 0; g <= 4; g++) { var gy = PAD + (g / 4) * CH; ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(PAD, gy); ctx.lineTo(W - PAD, gy); ctx.stroke(); }
      var layers = [
        { path: dc.trend && dc.trend.path, color: '#27ae60', label: 'Trend (AI)', lw: 2, dash: [6, 4] },
        { path: dc.cycle && dc.cycle.path, color: '#3498db', label: 'Cycle (AI)', lw: 1.5, dash: [] },
        { path: dc.fractal_noise && dc.fractal_noise.path, color: '#9b8fe8', label: 'Fractal Noise (AI)', lw: 1, dash: [] }
      ];
      var allV = []; layers.forEach(function (l) { if (l.path) allV = allV.concat(l.path); });
      var mn = allV.length ? Math.min.apply(null, allV) : -0.5, mx = allV.length ? Math.max.apply(null, allV) : 1, rng = mx - mn || 1;
      function py(v) { return PAD + CH - ((v - mn) / rng) * CH; }
      layers.forEach(function (l) {
        if (!l.path || l.path.length < 2) return;
        var n = l.path.length;
        if (l.dash.length) ctx.setLineDash(l.dash); else ctx.setLineDash([]);
        ctx.strokeStyle = l.color; ctx.lineWidth = l.lw;
        ctx.beginPath(); l.path.forEach(function (v, i) { var x = PAD + (i / (n - 1)) * CW; i === 0 ? ctx.moveTo(x, py(v)) : ctx.lineTo(x, py(v)); });
        ctx.stroke(); ctx.setLineDash([]);
        ctx.font = '500 10px DM Mono'; ctx.textAlign = 'right'; ctx.fillStyle = l.color;
        ctx.fillText(l.label, W - PAD - 4, py(l.path[0]) - 3);
      });
      ctx.fillStyle = 'rgba(201,168,76,.12)'; ctx.fillRect(PAD, PAD, 148, 18);
      ctx.strokeStyle = 'rgba(201,168,76,.35)'; ctx.lineWidth = .6; ctx.strokeRect(PAD, PAD, 148, 18);
      ctx.fillStyle = 'var(--gold)'; ctx.font = '500 9px DM Mono'; ctx.textAlign = 'left';
      ctx.fillText('\u25b8 LIVE AI DECOMPOSITION', PAD + 5, PAD + 12);
      function drawCompLive(id, arr, color) {
        var c = document.getElementById(id); if (!c || !arr || !arr.length) return;
        c.width = c.offsetWidth || 220; c.height = 70;
        var cx = c.getContext('2d'), W2 = c.width, H2 = c.height;
        var mn2 = Math.min.apply(null, arr), mx2 = Math.max.apply(null, arr), rng2 = mx2 - mn2 || .01;
        cx.fillStyle = '#0d1018'; cx.fillRect(0, 0, W2, H2);
        cx.beginPath(); arr.forEach(function (v, i) { var x = 4 + (i / (arr.length - 1)) * (W2 - 8), y = 6 + ((mx2 - v) / rng2) * (H2 - 12); i === 0 ? cx.moveTo(x, y) : cx.lineTo(x, y); });
        cx.lineTo(W2 - 4, H2); cx.lineTo(4, H2); cx.closePath(); cx.fillStyle = hA(color, .1); cx.fill();
        cx.beginPath(); cx.strokeStyle = color; cx.lineWidth = 1.5; arr.forEach(function (v, i) { var x = 4 + (i / (arr.length - 1)) * (W2 - 8), y = 6 + ((mx2 - v) / rng2) * (H2 - 12); i === 0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }); cx.stroke();
        cx.fillStyle = hA(color, .8); cx.font = '8px DM Mono'; cx.textAlign = 'left'; cx.fillText('AI', 5, H2 - 4);
      }
      setTimeout(function () {
        drawCompLive('mtsT', dc.trend && dc.trend.path, '#27ae60');
        drawCompLive('mtsC', dc.cycle && dc.cycle.path, '#3498db');
        drawCompLive('mtsN', dc.fractal_noise && dc.fractal_noise.path, '#9b8fe8');
      }, 30);
    }

    function buildFractalM(depth, amp, ratio, n) {
      var pts = new Array(n).fill(0);
      for (var d = 0; d < depth; d++) {
        var scale = Math.pow(ratio, d), freq = Math.pow(2, d);
        for (var i = 0; i < n; i++) { var x = i / n; pts[i] += amp * scale * (Math.sin(freq * Math.PI * 2 * x) + .4 * Math.sin(freq * Math.PI * 4 * x + .5) + .2 * Math.cos(freq * Math.PI * 7 * x + 1.2)); }
      }
      return pts;
    }

    function drawMF() {
      var depth = parseInt(document.getElementById('mfD').value);
      var amp = parseInt(document.getElementById('mfAmp').value) / 100;
      var ratio = parseInt(document.getElementById('mfR').value) / 100;
      document.getElementById('mfDv').textContent = depth;
      document.getElementById('mfAv').textContent = amp.toFixed(2);
      document.getElementById('mfRv').textContent = ratio.toFixed(2);
      var n = 600, colors = ['#c9a84c', '#3498db', '#9b8fe8', '#27ae60', '#e74c3c'];
      var full = buildFractalM(depth, amp, ratio, n);
      var canvas = document.getElementById('mfCanvas');
      var r = scSetup(canvas); var ctx = r.ctx, W = r.W, H = r.H;
      var PAD = 8, CW = W - PAD * 2, CH = H - PAD * 2;
      var mn = Math.min.apply(null, full), mx = Math.max.apply(null, full), rng = mx - mn || 1;
      ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);
      for (var g = 0; g <= 4; g++) { var gy = PAD + (g / 4) * CH; ctx.strokeStyle = 'rgba(255,255,255,.04)'; ctx.lineWidth = .5; ctx.beginPath(); ctx.moveTo(PAD, gy); ctx.lineTo(W - PAD, gy); ctx.stroke(); }
      for (var d = 0; d < Math.min(depth, 5); d++) {
        var layer = buildFractalM(d + 1, amp, ratio, n);
        ctx.beginPath(); ctx.strokeStyle = d === depth - 1 ? colors[d % 5] : hA(colors[d % 5], .2); ctx.lineWidth = d === depth - 1 ? 2 : .8;
        layer.forEach(function (v, i) { var x = PAD + (i / (n - 1)) * CW, y = PAD + CH - ((v - mn) / rng) * CH; i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }); ctx.stroke();
      }
      var zRegions = [{ s: 0, e: n - 1, color: '#c9a84c' }, { s: Math.floor(n * .15), e: Math.floor(n * .45), color: '#3498db' }, { s: Math.floor(n * .22), e: Math.floor(n * .34), color: '#9b8fe8' }];
      zRegions.slice(1).forEach(function (reg) {
        var x1 = PAD + (reg.s / (n - 1)) * CW, x2 = PAD + (reg.e / (n - 1)) * CW;
        var sl = full.slice(reg.s, reg.e + 1), smn = Math.min.apply(null, sl), smx = Math.max.apply(null, sl);
        var y1 = PAD + CH - ((smx - mn) / rng) * CH - 6, y2 = PAD + CH - ((smn - mn) / rng) * CH + 6;
        ctx.strokeStyle = hA(reg.color, .4); ctx.lineWidth = .8; ctx.setLineDash([3, 3]); ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); ctx.setLineDash([]);
      });
      setTimeout(function () {
        var zIds = ['mfZ1', 'mfZ2', 'mfZ3'];
        zRegions.forEach(function (zr, zi) {
          var c = document.getElementById(zIds[zi]); if (!c) return;
          c.width = c.offsetWidth || 200; c.height = 70;
          var cx = c.getContext('2d'), W2 = c.width, H2 = c.height;
          var sl = full.slice(zr.s, zr.e + 1), smn = Math.min.apply(null, sl), smx = Math.max.apply(null, sl), sr = smx - smn || 1;
          cx.fillStyle = '#0d1018'; cx.fillRect(0, 0, W2, H2);
          cx.beginPath(); sl.forEach(function (v, i) { cx.lineTo(4 + (i / (sl.length - 1)) * (W2 - 8), 4 + ((smx - v) / sr) * (H2 - 8)); });
          cx.lineTo(W2 - 4, H2); cx.lineTo(4, H2); cx.closePath(); cx.fillStyle = hA(zr.color, .07); cx.fill();
          cx.beginPath(); cx.strokeStyle = zr.color; cx.lineWidth = 1.5; sl.forEach(function (v, i) { var x = 4 + (i / (sl.length - 1)) * (W2 - 8), y = 4 + ((smx - v) / sr) * (H2 - 8); i === 0 ? cx.moveTo(x, y) : cx.lineTo(x, y); }); cx.stroke();
        });
      }, 30);
    }


    /* ══════════════════════════════════════════════════════
       TIER SYSTEM & TOOL RUNNER
       ══════════════════════════════════════════════════════ */

    /* Tier config: which tools are available per plan */
    var TOOL_TIERS = {
      fib: 'pro',
      smc: 'pro',
      vol: 'pro',
      mtf: 'mentor',
      age: 'mentor',
      liq: 'mentor',
      journal: 'mentor',
      proj: 'pro',
      sniper: 'starter',
      backtest: 'mentor'
    };

    /* User tier: 'free' | 'pro' | 'mentor' — set via auth later */
    var userTier = 'free'; /* default until refreshSession sets it from DB */

    function tierAllows(tool) {
      var t = TOOL_TIERS[tool];
      if (t === 'starter') return userTier === 'starter' || userTier === 'pro' || userTier === 'mentor';
      if (t === 'pro') return userTier === 'pro' || userTier === 'mentor';
      if (t === 'mentor') return userTier === 'mentor';
      return true;
    }

    function updateToolButtons() {
      Object.keys(TOOL_TIERS).forEach(function (tool) {
        var btn = document.getElementById(tool + '-btn');
        if (!btn) return;
        var allowed = tierAllows(tool);
        btn.disabled = !dataUrl || !allowed;
        btn.textContent = allowed ? 'Run' : '🔒 Upgrade';
        btn.title = allowed ? '' : 'This tool requires a higher plan';
      });
      buildToolGrid();
    }

    /* Call updateToolButtons whenever image is uploaded */
    var _origHandleFile = window.handleFile;
    function handleFile(f) {
      var r = new FileReader();
      r.onload = function (e) {
        dataUrl = e.target.result;
        document.getElementById('prevImg').src = dataUrl;
        document.getElementById('dropZone').style.display = 'none';
        document.getElementById('imgPv').style.display = 'block';
        document.getElementById('azBtn').disabled = false;
        updateToolButtons();
      };
      r.readAsDataURL(f);
    }

    function toggleResult(tool) {
      var body = document.getElementById(tool + '-body');
      var chev = document.getElementById(tool + '-chev');
      if (!body) return;
      var open = body.classList.contains('open');
      body.classList.toggle('open', !open);
      if (chev) chev.classList.toggle('open', !open);
    }

    function setToolRunning(tool, running) {
      var status = document.getElementById(tool + '-status');
      var btn = document.getElementById(tool + '-btn');
      if (status) status.style.display = running ? 'flex' : 'none';
      if (btn) btn.disabled = running;
    }

    function runTool(tool) {
      if (!chartCandles || chartCandles.length < 2) { alert('Load a chart first — select a symbol to connect live data.'); return; }
      if (!tierAllows(tool)) { scrollToPricing(); return; }
      /* Capture screenshot for outCanvas background (preserves visual style) */
      captureAndStore();

      /* Capture visible candle data for accurate AI analysis (capped at 80 to control token cost) */
      var _tvBars = Math.max(20, Math.floor(chartCandles.length / chartView.zoom));
      var _tsIdx = Math.max(0, chartCandles.length - _tvBars - chartView.offset);
      var _teIdx = Math.min(chartCandles.length, _tsIdx + _tvBars);
      var _tvisC = chartCandles.slice(_tsIdx, _teIdx);
      if (_tvisC.length > 80) _tvisC = _tvisC.slice(_tvisC.length - 80);
      var _tpMin = Math.min.apply(null, _tvisC.map(function (c) { return c.l; }));
      var _tpMax = Math.max.apply(null, _tvisC.map(function (c) { return c.h; }));
      var _trng = _tpMax - _tpMin;
      _tpMin -= _trng * 0.05; _tpMax += _trng * 0.05;
      window._lastVisiblePriceMin = _tpMin;
      window._lastVisiblePriceMax = _tpMax;
      window._lastVisibleCandleCount = _tvisC.length;

      var pair = document.getElementById('pairIn').value || 'the asset';
      var tf = document.getElementById('tfIn').value || 'auto-detected';

      setToolRunning(tool, true);
      /* Auto-open the result panel */
      var body = document.getElementById(tool + '-body');
      var chev = document.getElementById(tool + '-chev');
      if (body && !body.classList.contains('open')) { body.classList.add('open'); if (chev) chev.classList.add('open'); }

      var payload = { candles: _tvisC, priceMin: _tpMin, priceMax: _tpMax, pair: pair, timeframe: tf, language: lang };

      if (tool === 'vol') {
        payload.account_size = parseFloat(document.getElementById('vol-acct').value) || 10000;
        payload.risk_pct = parseFloat(document.getElementById('vol-risk').value) || 1;
      }
      if (tool === 'journal') {
        payload.trade_notes = document.getElementById('journal-notes').value;
        payload.outcome = document.getElementById('journal-outcome').value;
        payload.pnl = document.getElementById('journal-pnl').value;
      }

      var endpoints = { fib: '/fibonacci', smc: '/smc', vol: '/volatility', mtf: '/mtf', age: '/fractal-age', liq: '/liquidity', journal: '/journal', proj: '/projection' };

      callBackend(endpoints[tool], payload)
        .then(function (d) {
          setToolRunning(tool, false);
          if (tool === 'fib') renderFibonacci(d);
          if (tool === 'smc') renderSMC(d);
          if (tool === 'vol') renderVolatility(d);
          if (tool === 'mtf') renderMTF(d);
          if (tool === 'age') renderFractalAge(d);
          if (tool === 'liq') renderLiquidity(d);
          if (tool === 'journal') renderJournal(d);
          if (tool === 'proj') renderProjection(d);
          saveAnalysis(tool, d);
        })
        .catch(function (e) { setToolRunning(tool, false); console.error(tool, e); });
    }

    /* ══ RENDER: FIBONACCI ══ */
    function renderFibonacci(r) {
      var sig = document.getElementById('fib-sig');
      sig.textContent = (r.signal || 'neutral').toUpperCase();
      sig.className = 'sig ' + (r.signal === 'bullish' ? 's-bull' : r.signal === 'bearish' ? 's-bear' : 's-n');
      document.getElementById('fib-trend').textContent = (r.trend || '—').toUpperCase();
      document.getElementById('fib-conf').textContent = (r.confidence || '—').toUpperCase();
      document.getElementById('fib-key-label').textContent = r.key_level ? 'Key: ' + r.key_level.level + ' — ' + r.key_level.reason : '';
      document.getElementById('fib-analysis').textContent = r.analysis || '';
      /* Levels list */
      var rets = r.retracements || [];
      document.getElementById('fib-levels').innerHTML = rets.map(function (l) {
        var str = l.strength === 'strong' ? 'font-weight:600' : '';
        return '<div style="display:flex;justify-content:space-between;align-items:center;padding:3px 7px;background:rgba(255,255,255,.02);border-left:2px solid ' + l.color + '">'
          + '<span style="font-family:DM Mono,monospace;font-size:9px;color:' + l.color + ';' + str + '">' + l.level + '</span>'
          + '<span style="font-size:11px;color:var(--light);' + str + '">' + l.price + '</span>'
          + '<span style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted)">' + l.strength + '</span>'
          + '</div>';
      }).join('');
      /* Draw on canvas */
      drawFibCanvas(r);
    }

    function drawFibCanvas(r) {
      var canvas = document.getElementById('fibCanvas');
      if (!canvas) return;
      var W = canvas.offsetWidth || 400; var H = 200;
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      /* Draw uploaded chart as background */
      var img = new Image();
      img.onload = function () {
        ctx.drawImage(img, 0, 0, W, H);
        ctx.fillStyle = 'rgba(6,8,13,.55)'; ctx.fillRect(0, 0, W, H);
        /* Draw fib levels */
        var levels = (r.retracements || []).concat(r.extensions || []);
        levels.forEach(function (l) {
          var y = l.y * H;
          if (y < 0 || y > H) return;
          ctx.strokeStyle = l.color || '#c9a84c'; ctx.lineWidth = l.strength === 'strong' ? 1.5 : .8;
          ctx.setLineDash(l.strength === 'strong' ? [] : [3, 3]);
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
          ctx.setLineDash([]);
          ctx.fillStyle = l.color || '#c9a84c'; ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'left';
          ctx.fillText(l.level + ' · ' + l.price, 4, y - 2);
        });
        /* Swing points */
        if (r.swing_high) { var hy = r.swing_high.y * H, hx = r.swing_high.x * W; ctx.fillStyle = '#27ae60'; ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'center'; ctx.fillText('▲ H', hx, hy - 4); }
        if (r.swing_low) { var ly = r.swing_low.y * H, lx = r.swing_low.x * W; ctx.fillStyle = '#e74c3c'; ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'center'; ctx.fillText('▼ L', lx, ly + 12); }
        /* Key level highlight */
        if (r.key_level) { var ky = r.key_level.y * H || H / 2; ctx.fillStyle = 'rgba(201,168,76,.15)'; ctx.fillRect(0, ky - 6, W, 12); }
      };
      img.src = dataUrl;
    }

    /* ══ RENDER: SMART MONEY CONCEPTS ══ */
    function renderSMC(r) {
      var sig = document.getElementById('smc-sig');
      sig.textContent = (r.signal || 'neutral').toUpperCase();
      sig.className = 'sig ' + (r.signal === 'bullish' ? 's-bull' : r.signal === 'bearish' ? 's-bear' : 's-n');
      document.getElementById('smc-struct').textContent = (r.market_structure || '—').toUpperCase();
      document.getElementById('smc-zone').textContent = (r.premium_discount && r.premium_discount.current_zone || '—').toUpperCase();
      document.getElementById('smc-bias').textContent = (r.bias || '—').toUpperCase();
      document.getElementById('smc-bos-label').textContent = r.last_bos ? r.last_bos.type + ' · ' + r.last_bos.direction : '';
      document.getElementById('smc-analysis').textContent = r.analysis || '';
      /* Entry model */
      var em = r.entry_model || {};
      document.getElementById('smc-entry').innerHTML = [
        { l: 'Trigger', v: em.trigger || '—' }, { l: 'Entry', v: em.entry || '—' },
        { l: 'SL', v: em.sl || '—', c: '#e74c3c' }, { l: 'TP1', v: em.tp1 || '—', c: '#27ae60' },
        { l: 'TP2', v: em.tp2 || '—', c: '#2ecc71' }, { l: 'R:R', v: em.rr || '—', c: 'var(--gold)' }
      ].map(function (x) {
        return '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
          + '<span style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted)">' + x.l + '</span>'
          + '<span style="font-size:11px;color:' + (x.c || 'var(--light)') + '">' + x.v + '</span></div>';
      }).join('');
      drawSMCCanvas(r);
    }

    function drawSMCCanvas(r) {
      var canvas = document.getElementById('smcCanvas');
      if (!canvas) return;
      var W = canvas.offsetWidth || 360; var H = 180;
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      var img = new Image();
      img.onload = function () {
        ctx.drawImage(img, 0, 0, W, H);
        ctx.fillStyle = 'rgba(6,8,13,.5)'; ctx.fillRect(0, 0, W, H);
        /* Order blocks */
        (r.order_blocks || []).forEach(function (ob) {
          var x1 = ob.x1 * W, x2 = ob.x2 * W, y1 = ob.y1 * H, y2 = ob.y2 * H;
          ctx.fillStyle = hA(ob.color || '#27ae60', .18); ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeStyle = ob.color || '#27ae60'; ctx.lineWidth = 1; ctx.setLineDash([]);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
          ctx.fillStyle = ob.color || '#27ae60'; ctx.font = '8px DM Mono'; ctx.textAlign = 'left';
          ctx.fillText((ob.type === 'bullish' ? '▲' : '▼') + ' OB', x1 + 3, y1 + 10);
        });
        /* FVG */
        (r.fvg || []).forEach(function (f) {
          var x1 = f.x1 * W, x2 = f.x2 * W, y1 = f.y1 * H, y2 = f.y2 * H;
          ctx.fillStyle = hA(f.color || '#3498db', .12); ctx.fillRect(x1, y1, x2 - x1, y2 - y1);
          ctx.strokeStyle = hA(f.color || '#3498db', .4); ctx.lineWidth = .7; ctx.setLineDash([2, 2]);
          ctx.strokeRect(x1, y1, x2 - x1, y2 - y1); ctx.setLineDash([]);
          ctx.fillStyle = f.color || '#3498db'; ctx.font = '8px DM Mono'; ctx.textAlign = 'left';
          ctx.fillText('FVG', x1 + 2, (y1 + y2) / 2 + 3);
        });
        /* BOS */
        if (r.last_bos) {
          var bx = r.last_bos.x * W, by = r.last_bos.y * H;
          ctx.strokeStyle = '#e74c3c'; ctx.lineWidth = 1.5; ctx.setLineDash([]);
          ctx.beginPath(); ctx.moveTo(0, by); ctx.lineTo(W, by); ctx.stroke();
          ctx.fillStyle = '#e74c3c'; ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'left';
          ctx.fillText(r.last_bos.type, bx + 3, by - 3);
        }
        /* POI */
        if (r.poi) {
          var px1 = r.poi.x1 * W, px2 = r.poi.x2 * W, py1 = r.poi.y1 * H, py2 = r.poi.y2 * H;
          ctx.fillStyle = 'rgba(201,168,76,.15)'; ctx.fillRect(px1, py1, px2 - px1, py2 - py1);
          ctx.strokeStyle = 'rgba(201,168,76,.6)'; ctx.lineWidth = 1; ctx.setLineDash([4, 2]);
          ctx.strokeRect(px1, py1, px2 - px1, py2 - py1); ctx.setLineDash([]);
          ctx.fillStyle = 'var(--gold)'; ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'center';
          ctx.fillText(r.poi.label, (px1 + px2) / 2, py1 - 3);
        }
      };
      img.src = dataUrl;
    }

    /* ══ RENDER: VOLATILITY ══ */
    function renderVolatility(r) {
      var regimes = { low: '#27ae60', medium: 'var(--gold)', high: '#e67e22', extreme: '#e74c3c' };
      var reg = r.regime || 'medium';
      document.getElementById('vol-regime').textContent = reg.toUpperCase();
      document.getElementById('vol-regime').style.color = regimes[reg] || 'var(--gold)';
      var fill = document.getElementById('vol-gauge-fill');
      fill.style.width = (r.regime_score || 50) + '%';
      fill.style.background = regimes[reg] || 'var(--gold)';
      var ps = r.position_sizing || {};
      document.getElementById('vol-size').textContent = ps.max_position_size || '—';
      document.getElementById('vol-risk-amt').textContent = ps.risk_amount ? '$' + ps.risk_amount.toFixed(2) : '—';
      var rc = r.regime_characteristics || {};
      document.getElementById('vol-chars').innerHTML = [
        { l: 'Mean Reversion Prob.', v: ((rc.mean_reversion_probability || 0) * 100).toFixed(0) + '%' },
        { l: 'Trend Continuation', v: ((rc.trend_continuation_probability || 0) * 100).toFixed(0) + '%' },
        { l: 'Expected Daily Range', v: rc.expected_daily_range || '—' },
        { l: 'Breakout Likelihood', v: (rc.breakout_likelihood || '—').toUpperCase() },
        { l: 'Recommended Approach', v: (r.strategy_adaptation && r.strategy_adaptation.recommended_approach) || '—' },
        { l: 'Leverage Warning', v: ps.leverage_warning || '—' }
      ].map(function (x) {
        return '<div style="display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.04)">'
          + '<span style="font-family:DM Mono,monospace;font-size:9px;color:var(--muted)">' + x.l + '</span>'
          + '<span style="font-size:10px;color:var(--light)">' + x.v + '</span></div>';
      }).join('');
      document.getElementById('vol-analysis').textContent = r.analysis || '';
    }

    /* ══ RENDER: MTF CONFLUENCE ══ */
    function renderMTF(r) {
      var sig = document.getElementById('mtf-sig');
      sig.textContent = (r.signal || 'neutral').toUpperCase();
      sig.className = 'sig ' + (r.signal === 'bullish' ? 's-bull' : r.signal === 'bearish' ? 's-bear' : 's-n');
      var score = r.confluence_score || 0;
      var scoreEl = document.getElementById('mtf-score');
      scoreEl.textContent = score + '%';
      scoreEl.style.color = score >= 75 ? '#27ae60' : score >= 50 ? 'var(--gold)' : '#e74c3c';
      document.getElementById('mtf-analysis').textContent = r.analysis || '';
      /* Timeframe cards */
      document.getElementById('mtf-tfs').innerHTML = (r.timeframes || []).map(function (tf) {
        var c = tf.bias === 'bullish' ? '#27ae60' : tf.bias === 'bearish' ? '#e74c3c' : 'var(--muted)';
        return '<div class="res-card"><div class="res-card-v" style="color:' + c + ';font-size:11px">' + tf.tf + '</div>'
          + '<div style="font-size:9px;color:' + c + '">' + tf.bias + '</div>'
          + '<div class="res-card-l">' + tf.fractal_phase + '</div></div>';
      }).join('');
      /* Confluence zones */
      document.getElementById('mtf-zones').innerHTML = (r.confluence_zones || []).map(function (z) {
        return '<div style="display:flex;align-items:center;gap:8px;padding:5px 8px;border:1px solid rgba(201,168,76,.2);background:rgba(201,168,76,.04)">'
          + '<div style="width:3px;height:28px;background:' + z.color + '"></div>'
          + '<div><div style="font-size:10px;color:var(--white)">' + z.label + ' · ' + z.price + '</div>'
          + '<div style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted)">' + z.strength + ' · ' + (z.timeframes_aligned || []).join(', ') + '</div></div></div>';
      }).join('');
      drawMTFCanvas(r);
    }

    function drawMTFCanvas(r) {
      var canvas = document.getElementById('mtfCanvas');
      if (!canvas) return;
      var W = canvas.offsetWidth || 400; var H = 160;
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);
      var colors = ['#c9a84c', '#3498db', '#9b8fe8'];
      var N = 10;
      (r.timeframes || []).forEach(function (tf, ti) {
        if (!tf.path || !tf.path.length) return;
        var pts = tf.path;
        var mn = Math.min.apply(null, pts), mx = Math.max.apply(null, pts), rng = mx - mn || .01;
        ctx.strokeStyle = colors[ti % colors.length]; ctx.lineWidth = ti === 0 ? 2 : 1.2;
        ctx.setLineDash(ti === 0 ? [] : [4, 3]);
        ctx.beginPath();
        pts.forEach(function (v, i) { var x = 10 + (i / (N - 1)) * (W - 20), y = 10 + ((mx - v) / rng) * (H - 20); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
        ctx.stroke(); ctx.setLineDash([]);
        ctx.fillStyle = colors[ti % colors.length]; ctx.font = '8px DM Mono'; ctx.textAlign = 'left';
        ctx.fillText(tf.tf, 10, 12 + ti * 12);
      });
      /* Confluence zones */
      (r.confluence_zones || []).forEach(function (z) {
        var y = z.y * H;
        ctx.strokeStyle = z.color || '#c9a84c'; ctx.lineWidth = 1.5;
        ctx.setLineDash([]); ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        ctx.fillStyle = hA(z.color || '#c9a84c', .12); ctx.fillRect(0, y - 4, W, 8);
      });
    }

    /* ══ RENDER: FRACTAL AGE ══ */
    function renderFractalAge(r) {
      var fa = r.fractal_age || {};
      document.getElementById('age-pct').textContent = (fa.completion_pct || 0) + '%';
      document.getElementById('age-phase').textContent = (fa.phase || '—').toUpperCase();
      document.getElementById('age-urgency').textContent = (r.urgency || '—').toUpperCase();
      document.getElementById('age-analysis').textContent = r.analysis || '';
      /* Scenarios */
      document.getElementById('age-scenarios').innerHTML = (r.time_projections || []).map(function (s) {
        var c = s.direction === 'bullish' ? '#27ae60' : s.direction === 'bearish' ? '#e74c3c' : 'var(--muted)';
        var pct = Math.round((s.probability || 0) * 100);
        return '<div style="border:1px solid rgba(255,255,255,.07);padding:7px 10px">'
          + '<div style="display:flex;justify-content:space-between;margin-bottom:4px">'
          + '<span style="font-family:Cinzel,serif;font-size:11px;color:var(--white)">' + s.scenario + '</span>'
          + '<span style="font-family:DM Mono,monospace;font-size:9px;color:' + c + '">' + pct + '%</span></div>'
          + '<div style="display:flex;gap:10px;font-family:DM Mono,monospace;font-size:9px;color:var(--muted)">'
          + '<span style="color:' + c + '">' + s.direction + '</span><span>' + s.bars_to_resolution + ' bars</span><span>' + s.target_price + '</span></div>'
          + '<div style="height:3px;background:rgba(255,255,255,.06);margin-top:5px;border-radius:2px">'
          + '<div style="height:100%;width:' + pct + '%;background:' + c + ';border-radius:2px"></div></div></div>';
      }).join('');
      drawAgeCanvas(r);
    }

    function drawAgeCanvas(r) {
      var canvas = document.getElementById('ageCanvas');
      if (!canvas) return;
      var W = canvas.offsetWidth || 400; var H = 140;
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#07090f'; ctx.fillRect(0, 0, W, H);
      var fa = r.fractal_age || {};
      var cp = r.cycle_position || {};
      /* Draw cycle path */
      var path = cp.cycle_path || [];
      if (path.length > 1) {
        var mn = Math.min.apply(null, path), mx = Math.max.apply(null, path), rng = mx - mn || .01;
        ctx.strokeStyle = '#9b8fe8'; ctx.lineWidth = 1.5;
        ctx.beginPath();
        path.forEach(function (v, i) { var x = 10 + (i / (path.length - 1)) * (W - 20), y = 10 + ((mx - v) / rng) * (H - 20); i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); });
        ctx.stroke();
      }
      /* Age marker */
      var pct = (fa.completion_pct || 50) / 100;
      var mx2 = W - 20; var markerX = 10 + pct * mx2;
      ctx.strokeStyle = 'var(--gold)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(markerX, 0); ctx.lineTo(markerX, H); ctx.stroke();
      ctx.fillStyle = 'var(--gold)'; ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'center';
      ctx.fillText('NOW ' + fa.completion_pct + '%', markerX, H - 4);
      ctx.fillStyle = 'rgba(201,168,76,.08)'; ctx.fillRect(markerX, 0, W - markerX, H);
    }

    /* ══ RENDER: LIQUIDITY ══ */
    function renderLiquidity(r) {
      var c = r.smart_money_direction === 'bullish' ? '#27ae60' : r.smart_money_direction === 'bearish' ? '#e74c3c' : 'var(--muted)';
      document.getElementById('liq-dir').textContent = (r.smart_money_direction || '—').toUpperCase();
      document.getElementById('liq-dir').style.color = c;
      var li = r.liquidity_imbalance || {};
      document.getElementById('liq-buy').textContent = li.buy_side_weight ? Math.round(li.buy_side_weight * 100) + '%' : '—';
      document.getElementById('liq-sell').textContent = li.sell_side_weight ? Math.round(li.sell_side_weight * 100) + '%' : '—';
      document.getElementById('liq-analysis').textContent = r.analysis || '';
      /* Hunt targets */
      document.getElementById('liq-targets').innerHTML = (r.hunt_targets || []).map(function (t) {
        var tc = t.direction === 'up' ? '#27ae60' : '#e74c3c';
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:5px 8px;border:1px solid rgba(255,255,255,.07)">'
          + '<span style="font-size:10px;color:var(--white)">' + t.label + '</span>'
          + '<span style="font-family:DM Mono,monospace;font-size:9px;color:' + tc + '">' + (t.direction === 'up' ? '↑' : '↓') + ' ' + t.price + '</span>'
          + '<span style="font-family:DM Mono,monospace;font-size:8px;color:var(--muted)">~' + t.bars_estimate + ' bars</span>'
          + '<span style="font-family:DM Mono,monospace;font-size:8px;color:var(--gold)">' + t.probability + '</span></div>';
      }).join('');
      drawLiqCanvas(r);
    }

    function drawLiqCanvas(r) {
      var canvas = document.getElementById('liqCanvas');
      if (!canvas) return;
      var W = canvas.offsetWidth || 400; var H = 220;
      canvas.width = W; canvas.height = H;
      var ctx = canvas.getContext('2d');
      var img = new Image();
      img.onload = function () {
        ctx.drawImage(img, 0, 0, W, H);
        ctx.fillStyle = 'rgba(6,8,13,.55)'; ctx.fillRect(0, 0, W, H);
        /* Stop clusters */
        (r.stop_clusters || []).forEach(function (sc) {
          var y = sc.y * H;
          ctx.fillStyle = sc.color || 'rgba(231,76,60,.12)';
          ctx.fillRect(0, y - 8, W, 16);
        });
        /* Liquidity pools */
        (r.liquidity_pools || []).forEach(function (lp) {
          var y = lp.y * H; var x = lp.x_position * W || W / 2;
          ctx.strokeStyle = lp.color || '#e74c3c'; ctx.lineWidth = 1.5;
          ctx.setLineDash([4, 3]);
          ctx.beginPath(); ctx.moveTo(10, y); ctx.lineTo(W - 10, y); ctx.stroke();
          ctx.setLineDash([]);
          if (!lp.swept) {
            ctx.fillStyle = lp.color || '#e74c3c'; ctx.font = 'bold 9px DM Mono'; ctx.textAlign = 'right';
            ctx.fillText(lp.label, W - 6, y - 3);
          }
        });
        /* Hunt targets */
        (r.hunt_targets || []).forEach(function (t) {
          var y = t.y * H; var tc = t.direction === 'up' ? '#27ae60' : '#e74c3c';
          ctx.fillStyle = tc; ctx.font = 'bold 10px DM Mono'; ctx.textAlign = 'center';
          ctx.fillText((t.direction === 'up' ? '⬆' : '⬇') + ' ' + t.label, W / 2, y);
        });
      };
      img.src = dataUrl;
    }

    /* ══ RENDER: JOURNAL ══ */
    function renderJournal(r) {
      document.getElementById('journal-result-empty').style.display = 'none';
      document.getElementById('journal-result').style.display = 'block';
      var g = r.overall_grade || 'C';
      var circle = document.getElementById('journal-grade-circle');
      circle.textContent = g;
      circle.className = 'grade-circle grade-' + g;
      document.getElementById('journal-lesson').textContent = r.key_lesson || '';
      document.getElementById('journal-coach').textContent = r.coach_message || '';
      var cats = r.categories || {};
      document.getElementById('journal-cats').innerHTML = Object.keys(cats).map(function (k) {
        var cat = cats[k]; var score = cat.score || 0;
        var c = score >= 75 ? '#27ae60' : score >= 50 ? 'var(--gold)' : '#e74c3c';
        return '<div class="res-card"><div class="res-card-v" style="color:' + c + '">' + score + '</div>'
          + '<div class="res-card-l">' + k.replace(/_/g, ' ').toUpperCase() + '</div>'
          + '<div class="res-card-sub">' + cat.improvement + '</div></div>';
      }).join('');
    }
