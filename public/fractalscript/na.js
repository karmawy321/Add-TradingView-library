/* ═══════════════════════════════════════════════════════════════
   FractalScript — NA (Not Available) Utilities
   
   Implements Pine Script's na semantics:
   - na literal
   - isNa() detection
   - na-aware arithmetic (any na operand → na result)
   - na-aware comparison (any na operand → false)
   
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
    'use strict';

    var NA = Object.freeze({ __fractal_na__: true });

    function isNa(v) {
        return v === NA || v === null || v === undefined || (typeof v === 'number' && isNaN(v));
    }

    function naNum(v) {
        return isNa(v) ? NA : +v;
    }

    function naArith(a, b, op) {
        if (isNa(a) || isNa(b)) return NA;
        return op(+a, +b);
    }

    function naCmp(a, b, op) {
        if (isNa(a) || isNa(b)) return false;
        if (typeof a === 'string' || typeof b === 'string') return op(String(a), String(b));
        return op(+a, +b);
    }

    /* ── Export ── */
    var ns = global.FractalScript || (global.FractalScript = {});
    ns.NA = NA;
    ns.isNa = isNa;
    ns.naNum = naNum;
    ns.naArith = naArith;
    ns.naCmp = naCmp;

})(typeof window !== 'undefined' ? window : this);