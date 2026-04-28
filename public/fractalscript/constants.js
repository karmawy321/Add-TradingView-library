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
        },
        from_gradient: function (value, bottom_value, top_value, bottom_color, top_color) {
            if (isNaN(value) || isNa(value)) return NA;
            var t = top_value === bottom_value ? 0 : Math.max(0, Math.min(1, (value - bottom_value) / (top_value - bottom_value)));
            function parseHex(c) {
                if (!c || typeof c !== 'string') return [128, 128, 128];
                var h = c;
                if (h[0] === '#') h = h.slice(1);
                if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
                if (h.length < 6) return [128, 128, 128];
                return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
            }
            function parseRGBA(c) {
                if (!c || typeof c !== 'string') return [128, 128, 128, 1];
                if (c.indexOf('rgba') === 0) {
                    var m = c.match(/[\d.]+/g);
                    if (m && m.length >= 4) return [+m[0], +m[1], +m[2], +m[3]];
                }
                if (c.indexOf('rgb') === 0) {
                    var m2 = c.match(/[\d]+/g);
                    if (m2 && m2.length >= 3) return [+m2[0], +m2[1], +m2[2], 1];
                }
                var p = parseHex(c);
                return [p[0], p[1], p[2], 1];
            }
            var bc = parseRGBA(bottom_color);
            var tc = parseRGBA(top_color);
            var r = Math.round(bc[0] + (tc[0] - bc[0]) * t);
            var g = Math.round(bc[1] + (tc[1] - bc[1]) * t);
            var b = Math.round(bc[2] + (tc[2] - bc[2]) * t);
            var a = bc[3] + (tc[3] - bc[3]) * t;
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
        pi: Math.PI, e: Math.E,
        sin: Math.sin, cos: Math.cos, tan: Math.tan,
        asin: Math.asin, acos: Math.acos, atan: Math.atan,
        exp: Math.exp, random: function (min, max) {
            if (arguments.length === 0) return Math.random();
            if (arguments.length === 1) return Math.random() * min;
            return min + Math.random() * (max - min);
        }
    };

    var LINE_STYLES = { style_solid: 'solid', style_dashed: 'dashed', style_dotted: 'dotted' };
    var BOX_STYLES = { style_solid: 'solid', style_dashed: 'dashed', style_dotted: 'dotted' };
    var EXTEND_MODES = { none: 'none', right: 'right', left: 'left', both: 'both' };
    var LABEL_STYLES = {
        style_none: 'none',
        style_label_up: 'label_up', style_label_down: 'label_down',
        style_label_left: 'label_left', style_label_right: 'label_right',
        style_label_center: 'label_center',
        style_label_upper_left: 'label_upper_left', style_label_upper_right: 'label_upper_right',
        style_label_lower_left: 'label_lower_left', style_label_lower_right: 'label_lower_right',
        style_arrowup: 'arrowup', style_arrowdown: 'arrowdown',
        style_triangleup: 'triangleup', style_triangledown: 'triangledown',
        style_circle: 'circle', style_square: 'square', style_diamond: 'diamond',
        style_cross: 'cross', style_xcross: 'xcross', style_flag: 'flag'
    };
    var POSITIONS = {
        top_left: 'top_left', top_center: 'top_center', top_right: 'top_right',
        middle_left: 'middle_left', middle_center: 'middle_center', middle_right: 'middle_right',
        bottom_left: 'bottom_left', bottom_center: 'bottom_center', bottom_right: 'bottom_right'
    };
    var TEXT_ALIGN = {
        align_left: 'left', align_center: 'center', align_right: 'right',
        align_top: 'top', align_bottom: 'bottom'
    };

    /* ── Export ── */
    FS.COLORS = COLORS;
    FS.SHAPES = SHAPES;
    FS.LOCATIONS = LOCATIONS;
    FS.SIZES = SIZES;
    FS.MATH = MATH;
    FS.LINE_STYLES = LINE_STYLES;
    FS.BOX_STYLES = BOX_STYLES;
    FS.EXTEND_MODES = EXTEND_MODES;
    FS.LABEL_STYLES = LABEL_STYLES;
    FS.POSITIONS = POSITIONS;
    FS.TEXT_ALIGN = TEXT_ALIGN;

})(typeof window !== 'undefined' ? window : this);