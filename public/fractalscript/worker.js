importScripts('na.js', 'constants.js', 'lexer.js', 'parser.js', 'ta-context.js', 'resolver.js', 'dispatchers.js', 'evaluator.js', 'index.js');

self.onmessage = function (e) {
  var d = e.data;
  var result = FractalScriptEngine.run(d.source, d.candles, d.inputs);
  self.postMessage(result);
};
