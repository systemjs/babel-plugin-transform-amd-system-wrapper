function factory() {
  window.jquery = '1';
  return { jquery: '1' };
}

System.registerDynamic('jquery', [], false, function ($__require, $__exports, $__module) {
  if (typeof factory === 'object')
    return factory.call(this);
  else
    return factory;
});
