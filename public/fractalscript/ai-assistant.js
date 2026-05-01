/* ═══════════════════════════════════════════════════════════════
   FractalScript AI Assistant — Frontend Logic
   
   Wires up the static AI UI elements already in index.html.
   - window._fsAiFix()      → Fix with AI button handler
   - window._fsAiGenerate() → Generate button / Enter key handler
   
   The MutationObserver watches #fractalErrors to show/hide the
   Fix button whenever an error appears or disappears.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var _lastError = null;
  var _isFixing = false;
  var _isGenerating = false;

  /* ── Show/hide Fix button when error appears ── */
  function watchErrors() {
    var errEl = document.getElementById('fractalErrors');
    var fixBtn = document.getElementById('fs-ai-fix-btn');
    if (!errEl || !fixBtn) return;

    function update() {
      var msg = errEl.textContent.trim();
      if (msg && errEl.style.display !== 'none') {
        var m = msg.match(/Line (\d+):(\d+)\s*[—–\-]\s*(.*)/);
        _lastError = m
          ? { line: parseInt(m[1]), col: parseInt(m[2]), message: m[3].trim() }
          : { line: 1, col: 1, message: msg };
        fixBtn.classList.add('visible');
      } else {
        fixBtn.classList.remove('visible');
        _lastError = null;
      }
    }

    var observer = new MutationObserver(update);
    observer.observe(errEl, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
    update(); // run once on load
  }

  /* ── Fix handler ── */
  window._fsAiFix = function () {
    if (_isFixing || !_lastError) return;
    var editor = document.getElementById('fractalEditor');
    var fixBtn = document.getElementById('fs-ai-fix-btn');
    var code = editor ? editor.value : '';
    if (!code.trim()) return;

    _isFixing = true;
    fixBtn.innerHTML = '⏳ Fixing...';
    fixBtn.style.opacity = '0.7';
    fixBtn.style.pointerEvents = 'none';

    fetch('/api/ai/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, error: _lastError })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      _isFixing = false;
      fixBtn.style.opacity = '1';
      fixBtn.style.pointerEvents = '';

      if (data.error) {
        fixBtn.innerHTML = '❌ Failed — try again';
        setTimeout(function () { fixBtn.innerHTML = '🔧 Fix with AI'; }, 2500);
        return;
      }

      if (data.fixed && editor) {
        editor.value = data.fixed;
        fixBtn.innerHTML = '✅ Fixed! Running...';
        fixBtn.style.color = '#4ade80';
        fixBtn.style.borderColor = 'rgba(74,222,128,0.4)';
        fixBtn.style.background = 'rgba(74,222,128,0.12)';

        setTimeout(function () {
          if (typeof window._runFractalFromModal === 'function') {
            window._runFractalFromModal();
          }
          setTimeout(function () {
            fixBtn.innerHTML = '🔧 Fix with AI';
            fixBtn.style.color = '';
            fixBtn.style.borderColor = '';
            fixBtn.style.background = '';
          }, 1200);
        }, 300);
      }
    })
    .catch(function (err) {
      _isFixing = false;
      fixBtn.style.opacity = '1';
      fixBtn.style.pointerEvents = '';
      fixBtn.innerHTML = '❌ Network error';
      setTimeout(function () { fixBtn.innerHTML = '🔧 Fix with AI'; }, 2500);
      console.error('[AI Fix]', err);
    });
  };

  /* ── Generate handler ── */
  window._fsAiGenerate = function () {
    if (_isGenerating) return;
    var input = document.getElementById('fs-ai-generate-input');
    var btn = document.getElementById('fs-ai-generate-btn');
    var editor = document.getElementById('fractalEditor');
    var prompt = input ? input.value.trim() : '';
    if (!prompt) { if (input) input.focus(); return; }

    _isGenerating = true;
    btn.innerHTML = '⏳ Generating...';
    btn.style.opacity = '0.7';
    btn.style.pointerEvents = 'none';

    fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      _isGenerating = false;
      btn.style.opacity = '1';
      btn.style.pointerEvents = '';
      btn.innerHTML = '⚡ Generate';

      if (data.error) {
        btn.innerHTML = '❌ Error';
        setTimeout(function () { btn.innerHTML = '⚡ Generate'; }, 2500);
        console.error('[AI Generate]', data.error);
        return;
      }

      if (data.code && editor) {
        editor.value = data.code;
        input.value = '';
        btn.innerHTML = '✅ Done! Running...';
        btn.style.color = '#4ade80';
        setTimeout(function () {
          if (typeof window._runFractalFromModal === 'function') {
            window._runFractalFromModal();
          }
          setTimeout(function () {
            btn.innerHTML = '⚡ Generate';
            btn.style.color = '';
          }, 1200);
        }, 300);
      }
    })
    .catch(function (err) {
      _isGenerating = false;
      btn.style.opacity = '1';
      btn.style.pointerEvents = '';
      btn.innerHTML = '❌ Network error';
      setTimeout(function () { btn.innerHTML = '⚡ Generate'; }, 2500);
      console.error('[AI Generate]', err);
    });
  };

  /* ── Auto-resize textarea ── */
  function setupAutoResize() {
    var input = document.getElementById('fs-ai-generate-input');
    if (!input) return;
    
    input.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = (this.scrollHeight) + 'px';
      
      // Also expand modal width if typing a lot
      var inner = document.getElementById('fractalModalInner');
      if (inner && this.value.length > 100) {
        inner.style.maxWidth = '1000px';
        inner.style.width = '96%';
      } else if (inner) {
        inner.style.maxWidth = '720px';
        inner.style.width = '92%';
      }
    });
  }

  /* ── Boot ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
      watchErrors();
      setupAutoResize();
    });
  } else {
    watchErrors();
    setupAutoResize();
  }

})();
