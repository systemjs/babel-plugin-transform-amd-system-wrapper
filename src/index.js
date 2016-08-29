import template from 'babel-template';

export default function ({ types: t }) {

  const buildTemplate = template(`
    SYSTEM_GLOBAL.registerDynamic([DEPS], false, BODY);
  `);

  const buildFactory = template(`
    (function($__require, $__exports, $__module) {
      MODULE_ID
      return BODY;
    })
  `);

  const buildDefineGlobal = template(`
     $__module.uri = $__module.id;
  `);

  return {
    visitor: {
      CallExpression(path, { opts = {} }) {
        const callee = path.node.callee;
        const args = path.node.arguments;

        // match define(['dep1'], function(dep1) {})
        if (t.isIdentifier(callee, { name: 'define' }) && args.length === 2) {

          let isExportsInDeps = false;
          let isModuleInDeps = false;

          // Call params used for the define factories wrapped in IIFEs
          var callParams = [];
          if (t.isArrayExpression(args[0])) {
            // Test if 'exports' exists as dependency: define(['exports'], function(exports) {})
            isExportsInDeps = args[0].elements.filter((param) => param.value === 'exports').length > 0;
            isModuleInDeps = args[0].elements.filter((param) => param.value === 'module').length > 0;

            args[0].elements.forEach((param) => {
              if (['require', 'module', 'exports'].indexOf(param.value) !== -1) {
                // Add all special identifiers in it's correct order and bind the to the param identifiers of the System.registerDynamic factory.
                callParams.push(t.identifier(`$__${param.value}`));
              } else {
                callParams.push(t.callExpression(t.identifier('$__require'), [param]));
              }
            });

            // Remove all special identifiers from the dependency list which will be provided by the System.registerDynamic factory.
            args[0] = args[0].elements.filter((param) => {
              return ['require', 'module', 'exports'].indexOf(param.value) === -1;
            });
          }

          let defineFactory = args[1];
          let thisBindingExpression = isExportsInDeps ? t.identifier('$__exports') : t.thisExpression();
          if (t.isFunctionExpression(args[1])) {
            const call = t.memberExpression(t.parenthesizedExpression(args[1]), t.identifier('call'));
            defineFactory = t.callExpression(call, [thisBindingExpression, ...callParams]);
          } else {
            const call = t.memberExpression(args[1], t.identifier('call'));
            defineFactory = t.callExpression(call, [thisBindingExpression, ...callParams]);
          }

          const factory = buildFactory({
            MODULE_ID: isModuleInDeps ? buildDefineGlobal() : null,
            BODY: defineFactory
          });

          const systemRegister = buildTemplate({
            SYSTEM_GLOBAL: t.identifier('System'),
            DEPS: [...args[0]],
            BODY: factory
          });

          path.replaceWith(systemRegister);
        }
      },
      MemberExpression(path, {opts}) {
        // Replace `define.amd` with `true` if it's used inside a logical expression.
        if (!path.scope.hasBinding('define') &&
          path.parentPath &&
          t.isLogicalExpression(path.parentPath) &&
          t.isIdentifier(path.node.object, { name: 'define' }) &&
          t.isIdentifier(path.node.property, { name: 'amd' })) {
          path.replaceWith(t.booleanLiteral(true));
        }
      },
      Identifier(path, {opts}) {
        // Replace `typeof define` if it's used inside a unary expression.
        if (path.node.name == 'define' &&
          !path.scope.hasBinding('define') &&
          path.parentPath &&
          t.isUnaryExpression(path.parentPath) &&
          path.parentPath.node.operator === 'typeof') {
          path.parentPath.replaceWith(t.stringLiteral('function'));
        }
      }
    }
  };
}
