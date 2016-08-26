(function(root, factory) {
  if ('function' === 'function' && true) {
    System.registerDynamic(['cjs.js'], false, function($__require, $__exports, $__module) {
      // factory is called  with "$__exports" in the case where "exports" is required by AMD, OR when using AMD "function" form
      return factory.call($__exports, $__require, $__exports, $__require('cjs.js'));
    });
  } else if (typeof exports === 'object') {
    module.exports = factory(require, exports, module);
  } else {
    root.wAnalytics = factory();
  }
}(this, function(require, exports) {
  require('cjs.js');
  exports.umd = 'detection';
}));