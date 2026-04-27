/* ═══════════════════════════════════════════════════════════════
   FractalScript — Entry Point / Build
   
   Stitches together the modular FractalScript engine.
   Load order matters: na → constants → lexer → parser → 
   ta-context → resolver → dispatchers → evaluator → API.
   
   Exports: window.FractalScriptEngine = { compile, evaluate, run }
   ═══════════════════════════════════════════════════════════════ */

/* ── Module loaders (for Node.js testing) ── */
var fs, path;
if (typeof require !== 'undefined') {
    try { fs = require('fs'); path = require('path'); } catch (e) { }
}

/* ── Load all sub-modules in dependency order ── */
/* When included via <script> tags, each module is already loaded.
   When testing with Node.js, we need to eval them in order. */

var _loadedMods = {};
function _loadMod(modName) {
    if (_loadedMods[modName]) return;
    _loadedMods[modName] = true;

    var modPath = path ? path.join(__dirname, modName + '.js') : null;
    var code;

    if (modPath && fs) {
        code = fs.readFileSync(modPath, 'utf8');
        eval(code);
    }
    /* In browser context, <script> tags already loaded these */
}

/* Ensure modules are loaded */
if (typeof FractalScript === 'undefined' || !FractalScript.NA) {
    /* Loading order: na => constants => lexer => parser => ta-context => resolver => dispatchers => evaluator */
    _loadMod('na');
    _loadMod('constants');
    _loadMod('lexer');
    _loadMod('parser');
    _loadMod('ta-context');
    _loadMod('resolver');
    _loadMod('dispatchers');
    _loadMod('evaluator');
}

/* ── Wire up compile/run using the sub-module functions ── */
(function (global) {
    var FS = global.FractalScript;
    if (!FS || !FS.lexer || !FS.parser || !FS.evaluate) return;

    FS.compile = function (source) {
        var lexResult = FS.lexer(source);
        if (lexResult.error) return { ast: null, inputs: [], error: lexResult.error };
        var ast = FS.parser(lexResult.tokens);
        if (ast && ast.error) return { ast: null, inputs: [], error: ast.error };
        return { ast: ast, inputs: [], error: null };
    };

    FS.run = function (source, candles, inputOverrides) {
        var compiled = FS.compile(source);
        if (compiled.error) return { plots: [], shapes: [], hlines: [], bgcolors: [], inputs: [], errors: [compiled.error] };
        var result = FS.evaluate(compiled.ast, candles, inputOverrides || {});
        if (result.error) return { plots: [], shapes: [], hlines: [], bgcolors: [], inputs: result.inputs || [], errors: [result.error] };
        return result;
    };
})(typeof window !== 'undefined' ? window : this);

/* ────────────────────────────────────────────────────────────────
   PUBLIC API
   ──────────────────────────────────────────────────────────────── */

(function (global) {
    'use strict';

    var FS = global.FractalScript;

    if (!FS || !FS.compile) {
        /* Fallback: if modules didn't load properly, create a stub error */
        global.FractalScriptEngine = {
            compile: function () { return { ast: null, inputs: [], error: { line: 1, col: 1, message: 'FractalScript modules failed to load' } }; },
            evaluate: function () { return { plots: [], shapes: [], hlines: [], bgcolors: [], inputs: [], errors: [{ line: 1, col: 1, message: 'FractalScript modules failed to load' }] }; },
            run: function () { return this.evaluate(); },
            NA: null,
            isNa: function () { return false; }
        };
        return;
    }

    function compile(source) {
        return FS.compile(source);
    }

    function evaluate(ast, candles, inputOverrides) {
        return FS.evaluate(ast, candles, inputOverrides);
    }

    function run(source, candles, inputOverrides) {
        return FS.run(source, candles, inputOverrides);
    }

    global.FractalScriptEngine = {
        compile: compile,
        evaluate: evaluate,
        run: run,
        NA: FS.NA,
        isNa: FS.isNa
    };

})(typeof window !== 'undefined' ? window : this);

/* ── Node.js module export ── */
if (typeof module !== 'undefined' && module.exports) {
    module.exports = (typeof FractalScriptEngine !== 'undefined') ? FractalScriptEngine : null;
}