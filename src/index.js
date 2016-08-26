import template from 'babel-template';

export default function ({ types: t }) {

  const buildTemplate = template(`
    SYSTEM_GLOBAL.registerDynamic(DEPS, false, BODY);
  `);

  const buildFactory = template(`
    (function($__require, $__exports, $__module) {
      return BODY;
    })
  `);

  return {
    visitor: {
      CallExpression(path, { opts = {} }) {
        const callee = path.node.callee;
        const args = path.node.arguments;

        // match define(['dep1'], function(dep1) {})
        if (t.isIdentifier(callee, { name: 'define' }) && args.length === 2) {

          var requireCalls = [];
          if (t.isArrayExpression(args[0])) {
            args[0].elements.forEach((params) => {
              requireCalls.push(t.callExpression(t.identifier('$__require'), [params]));
            });
          }

          let defineFactory = args[1];
          if (t.isFunctionExpression(args[1])) {
            const call = t.memberExpression(t.parenthesizedExpression(args[1]), t.identifier('call'));
            defineFactory = t.callExpression(call, [t.thisExpression(), ...requireCalls]);
          }

          const factory = buildFactory({
            BODY: defineFactory
          });

          const systemRegister = buildTemplate({
            SYSTEM_GLOBAL: t.identifier('System'),
            DEPS: args[0],
            BODY: factory
          });

          path.replaceWith(systemRegister);
        }
      }
    }
  };
}
