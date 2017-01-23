System.registerDynamic('a', [], function ($__require, $__exports, $__module) {
  return {
    a: 'a'
  };
});

System.registerDynamic('b', [], function ($__require, $__exports, $__module) {
  return {
    b: 'b'
  };
});

System.registerDynamic(['c'], function ($__require, $__exports, $__module) {
  return (function (c) {
    return c;
  }).call(this, $__require('c'));
});

System.registerDynamic('c', ['b'], function ($__require, $__exports, $__module) {
  return (function (b) {
    return {
      b: b,
      c: 'c'
    };
  }).call(this, $__require('b'));
});
