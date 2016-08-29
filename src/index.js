import template from 'babel-template';

export default function ({ types: t }) {

  const buildTemplate = template(`
    SYSTEM_GLOBAL.registerDynamic(MODULE_ID, [DEPS], false, BODY);
  `);

  const buildFactory = template(`
    (function($__require, $__exports, $__module) {
      MODULE_URI
      return BODY;
    })
  `);

  const buildModuleURIBinding = template(`
     $__module.uri = $__module.id;
  `);

  return {
    visitor: {
      CallExpression(path, { opts = {} }) {
        const callee = path.node.callee;
        const args = path.node.arguments;

        // match define(function(require) {})
        // match define(['dep1'], function(dep1) {})
        // match define('moduleName', function(dep1) {})
        // match define('moduleName', ['dep1'], function(dep1) {})
        if (!path.scope.hasBinding('define') &&
          t.isIdentifier(callee, { name: 'define' }) &&
          args.length >= 1 &&
          args.length <= 3) {

          let moduleName = null,
            dependencies = [],
            defineFactory = null;

          if (args.length === 1) {
            // first param is factory object/function
            defineFactory = args[0];
          } else if (args.length === 2) {
            // first param is either module name or dependency array
            // second param is factory object/function
            if (t.isStringLiteral(args[0])) {
              moduleName = args[0];
            } else if (t.isArrayExpression(args[0])) {
              dependencies = args[0];
            }
            defineFactory = args[1];
          } else {
            // first param is module name
            // second param is dependency array
            // third param is factory object/function
            moduleName = args[0];
            dependencies = args[1];
            defineFactory = args[2];
          }

          let isExportsInDeps = false,
            isModuleInDeps = false;

          // Call params used for the define factories wrapped in IIFEs
          var callParams = [];
          if (t.isArrayExpression(dependencies)) {
            // Test if 'exports' exists as dependency: define(['exports'], function(exports) {})
            isExportsInDeps = dependencies.elements.filter((param) => param.value === 'exports').length > 0;
            isModuleInDeps = dependencies.elements.filter((param) => param.value === 'module').length > 0;

            dependencies.elements.forEach((param) => {
              if (['require', 'module', 'exports'].indexOf(param.value) !== -1) {
                // Add all special identifiers in it's correct order and bind the to the param identifiers of the System.registerDynamic factory.
                callParams.push(t.identifier(`$__${param.value}`));
              } else {
                callParams.push(t.callExpression(t.identifier('$__require'), [param]));
              }
            });

            // Remove all special identifiers from the dependency list which will be provided by the System.registerDynamic factory.
            dependencies = dependencies.elements.filter((param) => {
              return ['require', 'module', 'exports'].indexOf(param.value) === -1;
            });
          }

          let thisBindingExpression = isExportsInDeps ? t.identifier('$__exports') : t.thisExpression();
          if (t.isFunctionExpression(defineFactory)) {
            const call = t.memberExpression(t.parenthesizedExpression(defineFactory), t.identifier('call'));
            defineFactory = t.callExpression(call, [thisBindingExpression, ...callParams]);
          } else if (t.isIdentifier(defineFactory) || t.isExpressionStatement(defineFactory)) {
            const call = t.memberExpression(defineFactory, t.identifier('call'));
            defineFactory = t.callExpression(call, [thisBindingExpression, ...callParams]);
          }

          const factory = buildFactory({
            MODULE_URI: isModuleInDeps ? buildModuleURIBinding() : null,
            BODY: defineFactory
          });

          const systemRegister = buildTemplate({
            SYSTEM_GLOBAL: t.identifier('System'),
            MODULE_ID: moduleName,
            DEPS: [...dependencies],
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
