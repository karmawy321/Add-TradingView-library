/* ═══════════════════════════════════════════════════════════════
   FractalScript AI Assistant — Frontend Client
   
   Handles the "Fix with AI" button and "Generate from English"
   input field in the FractalScript editor modal.
   
   Dependencies: None (vanilla JS, uses fetch API)
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ── State ── */
  var _lastError = null;      // { line, col, message }
  var _isFixing = false;
  var _isGenerating = false;

  /* ── DOM helpers ── */
  function getEditor() { return document.getElementById('fractalEditor'); }
  function getErrorEl() { return document.getElementById('fractalErrors'); }

  /* ── Inject UI elements ── */
  function init() {
    injectStyles();
    injectFixButton();
    injectGenerateBar();
    hookErrorDisplay();
  }

  /* ── CSS ── */
  function injectStyles() {
    if (document.getElementById('fs-ai-styles')) return;
    var style = document.createElement('style');
    style.id = 'fs-ai-styles';
    style.textContent = `
      /* Fix Button */
      #fs-ai-fix-btn {
        display: none;
        align-items: center;
        gap: 6px;
        margin-top: 8px;
        padding: 6px 14px;
        background: rgba(139, 92, 246, 0.15);
        border: 1px solid rgba(139, 92, 246, 0.4);
        color: #a78bfa;
        border-radius: 6px;
        font-family: 'DM Sans', sans-serif;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        letter-spacing: 0.3px;
      }
      #fs-ai-fix-btn:hover {
        background: rgba(139, 92, 246, 0.25);
        color: #c4b5fd;
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(139, 92, 246, 0.2);
      }
      #fs-ai-fix-btn.loading {
        pointer-events: none;
        opacity: 0.7;
      }
      #fs-ai-fix-btn .spinner {
        width: 14px;
        height: 14px;
        border: 2px solid rgba(139, 92, 246, 0.3);
        border-top-color: #a78bfa;
        border-radius: 50%;
        animation: fs-spin 0.6s linear infinite;
      }
      @keyframes fs-spin {
        to { transform: rotate(360deg); }
      }

      /* Generate Bar */
      #fs-ai-generate-bar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 10px 24px;
        border-top: 1px solid rgba(139, 92, 246, 0.15);
        background: rgba(139, 92, 246, 0.04);
      }
      #fs-ai-generate-input {
        flex: 1;
        background: rgba(255, 255, 255, 0.05);
        border: 1px solid rgba(139, 92, 246, 0.2);
        border-radius: 6px;
        padding: 8px 12px;
        color: #e2e8f0;
        font-family: 'DM Sans', sans-serif;
        font-size: 13px;
        outline: none;
        transition: border-color 0.2s;
      }
      #fs-ai-generate-input:focus {
        border-color: rgba(139, 92, 246, 0.5);
        box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.1);
      }
      #fs-ai-generate-input::placeholder {
        color: rgba(255, 255, 255, 0.25);
        font-style: italic;
      }
      #fs-ai-generate-btn {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 8px 16px;
        background: rgba(139, 92, 246, 0.15);
        border: 1px solid rgba(139, 92, 246, 0.4);
        color: #a78bfa;
        border-radius: 6px;
        font-family: 'DM Sans', sans-serif;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        white-space: nowrap;
      }
      #fs-ai-generate-btn:hover {
        background: rgba(139, 92, 246, 0.25);
        color: #c4b5fd;
      }
      #fs-ai-generate-btn.loading {
        pointer-events: none;
        opacity: 0.7;
      }

      /* AI badge on the modal header */
      .fs-ai-badge {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 2px 8px;
        background: rgba(139, 92, 246, 0.15);
        border: 1px solid rgba(139, 92, 246, 0.3);
        border-radius: 10px;
        font-size: 9px;
        font-weight: 700;
        color: #a78bfa;
        letter-spacing: 0.5px;
        font-family: 'DM Sans', sans-serif;
      }
    `;
    document.head.appendChild(style);
  }

  /* ── Fix Button — injected after the error display ── */
  function injectFixButton() {
    var errEl = getErrorEl();
    if (!errEl || document.getElementById('fs-ai-fix-btn')) return;

    var btn = document.createElement('button');
    btn.id = 'fs-ai-fix-btn';
    btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/></svg> Fix with AI';
    btn.onclick = handleFix;
    errEl.parentNode.insertBefore(btn, errEl.nextSibling);

    // Add AI badge to modal header
    var headerDiv = document.querySelector('#fractalModalInner > div:first-child > div:first-child');
    if (headerDiv && !headerDiv.querySelector('.fs-ai-badge')) {
      var badge = document.createElement('span');
      badge.className = 'fs-ai-badge';
      badge.innerHTML = '✦ AI';
      headerDiv.appendChild(badge);
    }
  }

  /* ── Generate Bar — injected before the footer ── */
  function injectGenerateBar() {
    var modalInner = document.getElementById('fractalModalInner');
    if (!modalInner || document.getElementById('fs-ai-generate-bar')) return;

    var footer = modalInner.querySelector('div:last-child');
    if (!footer) return;

    var bar = document.createElement('div');
    bar.id = 'fs-ai-generate-bar';
    bar.innerHTML = [
      '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.5" style="flex-shrink:0;opacity:0.6;">',
      '  <path d="M12 2L2 7l10 5 10-5-10-5z"/>',
      '  <path d="M2 17l10 5 10-5"/>',
      '  <path d="M2 12l10 5 10-5"/>',
      '</svg>',
      '<input id="fs-ai-generate-input" type="text" placeholder="Describe an indicator... e.g. RSI with overbought/oversold background" />',
      '<button id="fs-ai-generate-btn">',
      '  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"></polygon></svg>',
      '  Generate',
      '</button>'
    ].join('');

    modalInner.insertBefore(bar, footer);

    // Wire up events
    document.getElementById('fs-ai-generate-btn').onclick = handleGenerate;
    document.getElementById('fs-ai-generate-input').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') handleGenerate();
    });
  }

  /* ── Hook into the error display to show/hide the fix button ── */
  function hookErrorDisplay() {
    var errEl = getErrorEl();
    if (!errEl) return;

    // Watch for changes to the error element
    var observer = new MutationObserver(function () {
      var fixBtn = document.getElementById('fs-ai-fix-btn');
      if (!fixBtn) return;

      var errorText = errEl.textContent.trim();
      if (errorText && errEl.style.display !== 'none') {
        // Parse the error
        var match = errorText.match(/Line (\d+):(\d+)\s*[—–-]\s*(.*)/);
        if (match) {
          _lastError = { line: parseInt(match[1]), col: parseInt(match[2]), message: match[3] };
        } else {
          _lastError = { line: 1, col: 1, message: errorText };
        }
        fixBtn.style.display = 'inline-flex';
        fixBtn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/></svg> Fix with AI';
        fixBtn.classList.remove('loading');
      } else {
        fixBtn.style.display = 'none';
        _lastError = null;
      }
    });

    observer.observe(errEl, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ['style'] });
  }

  /* ── Fix handler ── */
  function handleFix() {
    if (_isFixing || !_lastError) return;
    _isFixing = true;

    var btn = document.getElementById('fs-ai-fix-btn');
    var editor = getEditor();
    var code = editor ? editor.value : '';

    btn.classList.add('loading');
    btn.innerHTML = '<div class="spinner"></div> Fixing...';

    fetch('/api/ai/fix', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code, error: _lastError })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      _isFixing = false;
      btn.classList.remove('loading');

      if (data.error) {
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef5350" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Failed';
        setTimeout(function () {
          btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10"/><path d="M12 6v6l4 2"/></svg> Fix with AI';
        }, 2000);
        return;
      }

      if (data.fixed && editor) {
        editor.value = data.fixed;
        btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#4ade80" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Fixed! Running...';
        btn.style.borderColor = 'rgba(74, 222, 128, 0.4)';
        btn.style.color = '#4ade80';
        btn.style.background = 'rgba(74, 222, 128, 0.15)';

        // Auto-run the fixed code
        setTimeout(function () {
          if (typeof window._runFractalFromModal === 'function') {
            window._runFractalFromModal();
          }
          // Reset button style after run
          setTimeout(function () {
            btn.style.borderColor = '';
            btn.style.color = '';
            btn.style.background = '';
          }, 1000);
        }, 300);
      }
    })
    .catch(function (err) {
      _isFixing = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef5350" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> Network error';
      console.error('[AI Fix]', err);
    });
  }

  /* ── Generate handler ── */
  function handleGenerate() {
    if (_isGenerating) return;
    var input = document.getElementById('fs-ai-generate-input');
    var btn = document.getElementById('fs-ai-generate-btn');
    var prompt = input ? input.value.trim() : '';
    if (!prompt) { input.focus(); return; }

    _isGenerating = true;
    btn.classList.add('loading');
    btn.innerHTML = '<div class="spinner"></div> Generating...';

    fetch('/api/ai/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: prompt })
    })
    .then(function (r) { return r.json(); })
    .then(function (data) {
      _isGenerating = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"></polygon></svg> Generate';

      if (data.error) {
        alert('AI Error: ' + data.error);
        return;
      }

      if (data.code) {
        var editor = getEditor();
        if (editor) {
          editor.value = data.code;
          input.value = '';
          // Auto-run
          if (typeof window._runFractalFromModal === 'function') {
            window._runFractalFromModal();
          }
        }
      }
    })
    .catch(function (err) {
      _isGenerating = false;
      btn.classList.remove('loading');
      btn.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10"></polygon></svg> Generate';
      console.error('[AI Generate]', err);
    });
  }

  /* ── Bootstrap ── */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    // DOM already loaded, but modal might not exist yet — retry
    var _initRetries = 0;
    var _initTimer = setInterval(function () {
      _initRetries++;
      if (document.getElementById('fractalEditor') || _initRetries > 50) {
        clearInterval(_initTimer);
        if (document.getElementById('fractalEditor')) init();
      }
    }, 200);
  }

})();
