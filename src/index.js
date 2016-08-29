import template from 'babel-template';

export default function ({ types: t }) {

  const buildTemplate = template(`
    SYSTEM_GLOBAL.registerDynamic(MODULE_ID, [DEPS], false, BODY);
  `);

  const buildFactory = template(`
    (function($__require, $__exports, $__module) {
      MODULE_URI
      BODY;
    })
  `);

  const buildFactoryTypeCheck = template(`
    FACTORY_DECLARATION
    if (typeof FACTORY_REFERENCE === TYPE) {
      return FACTORY_CALL;
    } else {
      return FACTORY_REFERENCE;
    }
  `);

  const buildFactoryExpressionDeclaration = template(`
    var $__factory = FACTORY_EXPRESSION;
  `);

  const buildModuleURIBinding = template(`
     $__module.uri = $__module.id;
  `);

  return {
    visitor: {
      CallExpression(path, { opts = {} }) {
        const callee = path.node.callee;
        const args = path.node.arguments;

        // Leave nested define untouched
        let currentPath = path;
        while (currentPath.parentPath) {
          currentPath = currentPath.parentPath;
          if (currentPath.node.callee &&
            t.isIdentifier(currentPath.node.callee.object, { name: 'System' }) &&
            t.isIdentifier(currentPath.node.callee.property, { name: 'registerDynamic' })) {
            return;
          }
        }

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
            defineFactory = null,
            isExportsInDeps = false,
            isModuleInDepsOrInFactoryParam = false;

          if (args.length === 1) {
            // first param is factory object/function
            defineFactory = args[0];
            // parse factory params
            if (t.isFunctionExpression(defineFactory)) {
              defineFactory.params.forEach((factoryParam) => {
                if (t.isIdentifier(factoryParam) && factoryParam.name === 'module') {
                  isModuleInDepsOrInFactoryParam = true;
                }
              });
            }
          } else if (args.length === 2) {
            // first param is either module name or dependency array
            if (t.isStringLiteral(args[0])) {
              moduleName = args[0];
            } else if (t.isArrayExpression(args[0])) {
              dependencies = args[0];
            }
            // second param is factory object/function
            defineFactory = args[1];
          } else {
            // first param is module name
            moduleName = args[0];
            // second param is dependency array
            dependencies = args[1];
            // third param is factory object/function
            defineFactory = args[2];
          }

          // Call params used for the define factories wrapped in IIFEs
          var callParams = [];
          if (t.isArrayExpression(dependencies)) {
            // Test if 'exports' exists as dependency: define(['exports'], function(exports) {})
            isExportsInDeps = dependencies.elements.filter((param) => param.value === 'exports').length > 0;
            isModuleInDepsOrInFactoryParam = dependencies.elements.filter((param) => param.value === 'module').length > 0;

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

          // Handle factory default params
          if (dependencies.length === 0 &&
            t.isFunctionExpression(defineFactory)) {
            defineFactory.params.forEach((factoryParam, index) => {
              switch (index) {
                case 0:
                  callParams.push(t.identifier('$__require'));
                  break;
                case 1:
                  callParams.push(t.identifier('$__exports'));
                  isExportsInDeps = true;
                  break;
                case 2:
                  callParams.push(t.identifier('$__module'));
                  break;
              }
            });
          }

          let defineFactoryReferenceIdentifier;
          let factoryExpressionDeclaration;
          let thisBindingExpression = isExportsInDeps ? t.identifier('$__exports') : t.thisExpression();
          if (t.isFunctionExpression(defineFactory)) {
            // If factory is passed as function argument
            const call = t.memberExpression(t.parenthesizedExpression(defineFactory), t.identifier('call'));
            defineFactory = t.callExpression(call, [thisBindingExpression, ...callParams]);
          } else if (t.isIdentifier(defineFactory)) {
            // If factory is passed as identifier argument
            defineFactoryReferenceIdentifier = t.identifier(defineFactory.name);
            const call = t.memberExpression(defineFactory, t.identifier('call'));
            defineFactory = t.callExpression(call, [thisBindingExpression, ...callParams]);
          } else if (!t.isObjectExpression(defineFactory)) {
            // If factory is passed as expression argument
            defineFactoryReferenceIdentifier = t.identifier('$__factory');
            factoryExpressionDeclaration = buildFactoryExpressionDeclaration({
              FACTORY_EXPRESSION: t.parenthesizedExpression(defineFactory)
            });
            const call = t.memberExpression(defineFactoryReferenceIdentifier, t.identifier('call'));
            defineFactory = t.callExpression(call, [thisBindingExpression, ...callParams]);
          }

          let factoryTypeTestNeeded = false;
          if (!moduleName && defineFactoryReferenceIdentifier) {
            // Wraps the factory in a ```if (typeof factory === 'function') {}``` test only a factory reference is present
            factoryTypeTestNeeded = true;
            defineFactory = buildFactoryTypeCheck({
              FACTORY_REFERENCE: defineFactoryReferenceIdentifier,
              FACTORY_CALL: defineFactory,
              TYPE: t.stringLiteral('function'),
              FACTORY_DECLARATION: factoryExpressionDeclaration || null
            });
          } else if (moduleName && dependencies.length === 0 && defineFactoryReferenceIdentifier) {
            // Wraps the factory in a ```if (typeof factory === 'object') {}``` test only a factory reference is present
            factoryTypeTestNeeded = true;
            defineFactory = buildFactoryTypeCheck({
              FACTORY_REFERENCE: defineFactoryReferenceIdentifier,
              FACTORY_CALL: defineFactory,
              TYPE: t.stringLiteral('object'),
              FACTORY_DECLARATION: factoryExpressionDeclaration || null
            });
          }

          const factory = buildFactory({
            MODULE_URI: isModuleInDepsOrInFactoryParam ? buildModuleURIBinding() : null,
            BODY: factoryTypeTestNeeded ? defineFactory : t.returnStatement(defineFactory)
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
