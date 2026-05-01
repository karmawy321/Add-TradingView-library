/* ═══════════════════════════════════════════════════════════════
   FractalScript AI Assistant — Frontend Logic (v2 with History)
   ═══════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var _lastError = null;
  var _isFixing = false;
  var _isGenerating = false;
  var _history = JSON.parse(localStorage.getItem('fs-ai-history') || '[]');

  /* ── Initialization ── */
  window.addEventListener('DOMContentLoaded', function() {
    renderHistory();
    setupAutoResize();
    watchErrors();
  });

  /* ── Show/hide Fix button when error appears ── */
  function watchErrors() {
    var errEl = document.getElementById('fractalErrors');
    var fixBtn = document.getElementById('fs-ai-fix-btn');
    if (!errEl || !fixBtn) return;

    var observer = new MutationObserver(function() {
      var msg = errEl.textContent.trim();
      if (msg && errEl.style.display !== 'none' && !msg.startsWith('AI Error:')) {
        var m = msg.match(/Line (\d+):(\d+)\s*[—–\-]\s*(.*)/);
        _lastError = m
          ? { line: parseInt(m[1]), col: parseInt(m[2]), message: m[3].trim() }
          : { line: 1, col: 1, message: msg };
        fixBtn.classList.add('visible');
      } else {
        fixBtn.classList.remove('visible');
        _lastError = null;
      }
    });

    observer.observe(errEl, { childList: true, characterData: true, subtree: true });
  }

  /* ── Auto-resize Textarea ── */
  function setupAutoResize() {
    var area = document.getElementById('fs-ai-generate-input');
    var modal = document.getElementById('fractalModalContent');
    if (!area) return;

    area.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = (this.scrollHeight) + 'px';
      
      /* Adapt modal width if text is long */
      if (modal) {
        if (this.value.length > 100) {
          modal.style.width = '1000px';
        } else {
          modal.style.width = '720px';
        }
      }
    });
  }

  /* ── History Logic ── */
  window._fsAiToggleHistory = function() {
    var panel = document.getElementById('fs-ai-history-panel');
    if (panel) panel.classList.toggle('visible');
  };

  function saveToHistory(prompt) {
    if (!prompt || !prompt.trim()) return;
    prompt = prompt.trim();
    
    /* Remove if already exists (move to top) */
    _history = _history.filter(function(h) { return h !== prompt; });
    _history.unshift(prompt);
    
    /* Keep last 20 */
    if (_history.length > 20) _history.pop();
    
    localStorage.setItem('fs-ai-history', JSON.stringify(_history));
    renderHistory();
  }

  function renderHistory() {
    var list = document.getElementById('fs-ai-history-list');
    if (!list) return;
    
    if (_history.length === 0) {
      list.innerHTML = '<div style="padding:16px;color:rgba(255,255,255,0.2);font-size:12px;text-align:center;">No recent prompts</div>';
      return;
    }

    list.innerHTML = _history.map(function(prompt) {
      return '<div class="fs-ai-history-item" onclick="window._fsAiLoadPrompt(\'' + prompt.replace(/'/g, "\\'") + '\')">' + 
             escapeHtml(prompt) + 
             '</div>';
    }).join('');
  }

  window._fsAiLoadPrompt = function(prompt) {
    var area = document.getElementById('fs-ai-generate-input');
    if (area) {
      area.value = prompt;
      area.dispatchEvent(new Event('input')); /* Trigger resize */
      window._fsAiToggleHistory(); /* Close panel */
    }
  };

  function escapeHtml(text) {
    var div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /* ── Core AI Actions ── */
  window._fsAiFix = async function () {
    if (_isFixing) return;
    
    var promptEl = document.getElementById('fs-ai-generate-input');
    var promptInstructions = promptEl ? promptEl.value.trim() : '';
    
    _isFixing = true;
    
    var fixBtn = document.getElementById('fs-ai-fix-btn');
    var fixBarBtn = document.getElementById('fs-ai-fix-bar-btn');
    var originalText = fixBtn ? fixBtn.innerHTML : '✨ Fixing...';
    var originalBarText = fixBarBtn ? fixBarBtn.innerHTML : '🔧 Fix Code';
    
    if (fixBtn) { fixBtn.innerHTML = '✨ Fixing...'; fixBtn.style.opacity = '0.7'; }
    if (fixBarBtn) { fixBarBtn.innerHTML = '⏳ Fixing...'; fixBarBtn.disabled = true; }

    try {
      var response = await fetch('/api/ai/fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: document.getElementById('fractalEditor').value,
          error: _lastError,
          instructions: promptInstructions
        })
      });
      
      if (!response.ok) {
        var errData = await response.json();
        throw new Error(errData.error || 'Server error ' + response.status);
      }

      var data = await response.json();
      var code = data.fixed || data.code;
      if (code) {
        document.getElementById('fractalEditor').value = code;
        if (window._runFractalFromModal) window._runFractalFromModal();
      }
    } catch (err) {
      console.error('AI Fix failed:', err);
      var errEl = document.getElementById('fractalErrors');
      if (errEl) {
        errEl.textContent = 'AI Error: ' + err.message + '\nCheck console or /api/ai/debug';
        errEl.style.display = 'block';
      }
    } finally {
      if (fixBtn) { fixBtn.innerHTML = originalText; fixBtn.style.opacity = '1'; }
      if (fixBarBtn) { fixBarBtn.innerHTML = originalBarText; fixBarBtn.disabled = false; }
      _isFixing = false;
    }
  };

  window._fsAiGenerate = async function () {
    var promptEl = document.getElementById('fs-ai-generate-input');
    if (!promptEl || _isGenerating) return;

    var prompt = promptEl.value.trim();
    if (!prompt) return;

    _isGenerating = true;
    var genBtn = document.getElementById('fs-ai-generate-btn');
    var originalText = genBtn.innerHTML;
    genBtn.innerHTML = '⏳ Generating...';
    genBtn.disabled = true;

    try {
      var response = await fetch('/api/ai/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: prompt })
      });

      if (!response.ok) {
        var errData = await response.json();
        throw new Error(errData.error || 'Server error ' + response.status);
      }

      var data = await response.json();
      if (data.code) {
        document.getElementById('fractalEditor').value = data.code;
        saveToHistory(prompt);
        if (window._runFractalFromModal) window._runFractalFromModal();
        promptEl.value = '';
        promptEl.style.height = '46px';
      }
    } catch (err) {
      console.error('AI Generation failed:', err);
      var errEl = document.getElementById('fractalErrors');
      if (errEl) {
        errEl.textContent = 'AI Error: ' + err.message + '\nCheck console or /api/ai/debug';
        errEl.style.display = 'block';
      }
    } finally {
      genBtn.innerHTML = originalText;
      genBtn.disabled = false;
      _isGenerating = false;
    }
  };

  /* Start error watcher */
  watchErrors();

})();
