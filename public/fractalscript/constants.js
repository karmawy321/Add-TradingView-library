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

    var LINE_STYLES = { style_solid: 'solid', style_dashed: 'dashed', style_dotted: 'dotted' };
    var BOX_STYLES  = { style_solid: 'solid', style_dashed: 'dashed', style_dotted: 'dotted' };
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