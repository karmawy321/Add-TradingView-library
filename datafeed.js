/* ═══════════════════════════════════════════════════════════════
   FRACTAL AI AGENT — TradingView Charting Library Datafeed
   Connects TradingView Advanced Charts to Binance live data
   ═══════════════════════════════════════════════════════════════ */

var FractalDatafeed = (function () {

  /* ── Binance interval map ── */
  var INTERVALS = {
    '1':'1m','3':'3m','5':'5m','15':'15m','30':'30m',
    '60':'1h','120':'2h','240':'4h','360':'6h','480':'8h',
    '720':'12h','1D':'1d','1W':'1w','1M':'1M'
  };

  /* ── Symbol cache ── */
  var symbolCache = {};
  var allSymbols  = [];

  /* ── Load all Binance symbols once ── */
  function loadSymbols(callback) {
    if (allSymbols.length > 0) { callback(allSymbols); return; }
    fetch('https://api.binance.com/api/v3/exchangeInfo')
      .then(function(r){ return r.json(); })
      .then(function(d){
        allSymbols = (d.symbols || []).filter(function(s){
          return s.status === 'TRADING';
        });
        callback(allSymbols);
      })
      .catch(function(){ callback([]); });
  }

  return {

    /* ── 1. onReady — tell TV what we support ── */
    onReady: function(callback) {
      setTimeout(function(){
        callback({
          supported_resolutions: ['1','3','5','15','30','60','120','240','360','720','1D','1W','1M'],
          supports_marks:        false,
          supports_timescale_marks: false,
          supports_time:         true,
          exchanges: [{ value:'BINANCE', name:'Binance', desc:'Binance Exchange' }],
          symbols_types: [{ name:'Crypto', value:'crypto' }]
        });
      }, 0);
    },

    /* ── 2. searchSymbols — dropdown search ── */
    searchSymbols: function(userInput, exchange, symbolType, onResult) {
      var query = userInput.toUpperCase();
      loadSymbols(function(symbols){
        var results = symbols
          .filter(function(s){ return s.symbol.indexOf(query) === 0; })
          .slice(0, 20)
          .map(function(s){
            return {
              symbol:      s.symbol,
              full_name:   'BINANCE:' + s.symbol,
              description: s.baseAsset + ' / ' + s.quoteAsset,
              exchange:    'BINANCE',
              type:        'crypto'
            };
          });
        onResult(results);
      });
    },

    /* ── 3. resolveSymbol — get symbol metadata ── */
    resolveSymbol: function(symbolName, onResolve, onError) {
      var clean = symbolName.replace('BINANCE:', '');
      /* Try cache first */
      if (symbolCache[clean]) { onResolve(symbolCache[clean]); return; }

      fetch('https://api.binance.com/api/v3/exchangeInfo?symbol=' + clean)
        .then(function(r){ return r.json(); })
        .then(function(d){
          if (!d.symbols || !d.symbols[0]) { onError('Symbol not found'); return; }
          var s    = d.symbols[0];
          var info = {
            name:                s.symbol,
            full_name:           'BINANCE:' + s.symbol,
            description:         s.baseAsset + ' / ' + s.quoteAsset,
            type:                'crypto',
            session:             '24x7',
            timezone:            'Etc/UTC',
            exchange:            'BINANCE',
            minmov:              1,
            pricescale:          Math.pow(10, s.filters.find(function(f){ return f.filterType==='PRICE_FILTER'; }) ? parseInt(s.filters.find(function(f){ return f.filterType==='PRICE_FILTER'; }).tickSize.replace(/0+$/,'').replace('.','').length - 1) : 2),
            has_intraday:        true,
            has_daily:           true,
            has_weekly_and_monthly: true,
            supported_resolutions: ['1','3','5','15','30','60','120','240','360','720','1D','1W','1M'],
            volume_precision:    2,
            data_status:         'streaming',
            format:              'price'
          };
          symbolCache[clean] = info;
          onResolve(info);
        })
        .catch(function(){ onError('Resolution failed'); });
    },

    /* ── 4. getBars — fetch OHLCV candles ── */
    getBars: function(symbolInfo, resolution, periodParams, onResult, onError) {
      var interval = INTERVALS[resolution] || '1h';
      var symbol   = symbolInfo.name;
      var limit    = Math.min(periodParams.countBack || 500, 1000);
      var endTime  = periodParams.to   ? periodParams.to   * 1000 : Date.now();
      var startTime= periodParams.from ? periodParams.from * 1000 : endTime - limit * 86400000;

      var url = 'https://api.binance.com/api/v3/klines'
        + '?symbol='    + symbol
        + '&interval='  + interval
        + '&startTime=' + startTime
        + '&endTime='   + endTime
        + '&limit='     + limit;

      fetch(url)
        .then(function(r){ return r.json(); })
        .then(function(data){
          if (!Array.isArray(data) || data.length === 0) {
            onResult([], { noData: true });
            return;
          }
          var bars = data.map(function(c){
            return {
              time:   c[0],           /* open time ms */
              open:   parseFloat(c[1]),
              high:   parseFloat(c[2]),
              low:    parseFloat(c[3]),
              close:  parseFloat(c[4]),
              volume: parseFloat(c[5])
            };
          });
          onResult(bars, { noData: false });
        })
        .catch(function(e){ onError('Binance error: ' + e.message); });
    },

    /* ── 5. subscribeBars — real-time updates via WebSocket ── */
    subscribeBars: function(symbolInfo, resolution, onTick, listenerGuid) {
      var interval = INTERVALS[resolution] || '1h';
      var symbol   = symbolInfo.name.toLowerCase();
      var wsUrl    = 'wss://stream.binance.com:9443/ws/' + symbol + '@kline_' + interval;

      var ws = new WebSocket(wsUrl);
      ws.onmessage = function(event){
        try {
          var msg = JSON.parse(event.data);
          if (!msg.k) return;
          var k = msg.k;
          onTick({
            time:   k.t,
            open:   parseFloat(k.o),
            high:   parseFloat(k.h),
            low:    parseFloat(k.l),
            close:  parseFloat(k.c),
            volume: parseFloat(k.v)
          });
        } catch(e){}
      };
      ws.onerror = function(){ ws.close(); };

      /* Store ws so we can close it on unsubscribe */
      FractalDatafeed._sockets = FractalDatafeed._sockets || {};
      FractalDatafeed._sockets[listenerGuid] = ws;
    },

    /* ── 6. unsubscribeBars — close WebSocket ── */
    unsubscribeBars: function(listenerGuid) {
      if (FractalDatafeed._sockets && FractalDatafeed._sockets[listenerGuid]) {
        FractalDatafeed._sockets[listenerGuid].close();
        delete FractalDatafeed._sockets[listenerGuid];
      }
    },

    /* ── 7. getServerTime ── */
    getServerTime: function(callback) {
      fetch('https://api.binance.com/api/v3/time')
        .then(function(r){ return r.json(); })
        .then(function(d){ callback(Math.floor(d.serverTime / 1000)); })
        .catch(function(){ callback(Math.floor(Date.now() / 1000)); });
    }
  };
})();
