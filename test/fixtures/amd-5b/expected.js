function factory(first) {
  return { jquery: '1', first: first };
}

System.registerDynamic('jquery', ['./first.js'], false, function($__require, $__exports, $__module) {
  return factory.call(this, $__require('./first.js'));
});