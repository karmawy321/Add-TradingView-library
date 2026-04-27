/* ═══════════════════════════════════════════════════════════════
   FractalScript — Constants & Built-in Values
   
   Implements Pine Script's built-in constants:
   - color.* namespace
   - shape.* namespace
   - location.* namespace
   - size.* namespace
   - math.* namespace (abs, max, min, round, sqrt, pow, log, etc.)
   
   ═══════════════════════════════════════════════════════════════ */

(function (global) {
    'use strict';

    var FS = global.FractalScript || (global.FractalScript = {});
    var isNa = FS.isNa;
    var NA = FS.NA;

    var COLORS = {
        aqua: '#00BCD4', black: '#000000', blue: '#2196F3', fuchsia: '#E91E63',
        gray: '#9E9E9E', green: '#4CAF50', lime: '#8BC34A', maroon: '#800000',
        navy: '#1A237E', olive: '#808000', orange: '#FF9800', purple: '#9C27B0',
        red: '#F44336', silver: '#BDBDBD', teal: '#009688', white: '#FFFFFF',
        yellow: '#FFEB3B',
        // TradingView extra
        new: function (r, g, b, t) {
            t = (t !== undefined) ? t : 0;
            var a = Math.max(0, Math.min(1, 1 - t / 100));
            return 'rgba(' + r + ',' + g + ',' + b + ',' + a.toFixed(3) + ')';
        }
    };

    var SHAPES = {
        triangleup: 'triangleup', triangledown: 'triangledown',
        circle: 'circle', cross: 'cross', xcross: 'xcross',
        diamond: 'diamond', square: 'square',
        arrowup: 'arrowup', arrowdown: 'arrowdown',
        labelup: 'labelup', labeldown: 'labeldown',
        flag: 'flag'
    };

    var LOCATIONS = {
        abovebar: 'abovebar', belowbar: 'belowbar',
        top: 'top', bottom: 'bottom', absolute: 'absolute'
    };

    var SIZES = {
        auto: 'auto', tiny: 'tiny', small: 'small',
        normal: 'normal', large: 'large', huge: 'huge'
    };

    var MATH = {
        abs: Math.abs, max: Math.max, min: Math.min,
        round: Math.round, floor: Math.floor, ceil: Math.ceil,
        sqrt: Math.sqrt, pow: Math.pow, log: Math.log, log10: Math.log10,
        sign: Math.sign, avg: function () {
            var s = 0, n = 0;
            for (var i = 0; i < arguments.length; i++) {
                if (!isNa(arguments[i])) { s += arguments[i]; n++; }
            }
            return n > 0 ? s / n : NA;
        },
        pi: Math.PI, e: Math.E
    };

    /* ── Export ── */
    FS.COLORS = COLORS;
    FS.SHAPES = SHAPES;
    FS.LOCATIONS = LOCATIONS;
    FS.SIZES = SIZES;
    FS.MATH = MATH;

})(typeof window !== 'undefined' ? window : this);