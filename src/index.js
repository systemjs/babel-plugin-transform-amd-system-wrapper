import template from 'babel-template';

export default function ({
  types: t
}) {

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
    pre() {
      this.amdDeps = [];
      this.anonDefine = false;
      this.anonDefineIndex = -1;
      this.anonNamed = false;
      this.bundleDefines = [];
    },
    post () {
      // Save filtered amd dependencies in the file metadata
      this.file.metadata.amdDeps = this.amdDeps;
      this.file.metadata.anonNamed = this.anonNamed;
    },
    visitor: {
      CallExpression: {
        enter(path, {
          opts = {}
        }) {
          var that = this;

          // don't perform nested transformations
          if (this.outerModuleDefinition) {
            return;
          }

          const callee = path.node.callee;
          const args = path.node.arguments;

          // match define(function(require) {})
          // match define(['dep1'], function(dep1) {})
          // match define('moduleName', function(dep1) {})
          // match define('moduleName', ['dep1'], function(dep1) {})
          if (t.isIdentifier(callee, {
            name: 'define'
          }) &&
            !path.scope.hasBinding('define') &&
            args.length >= 1 &&
            args.length <= 3) {

            // remember the outer `define()` to avoid transforming the inner ones
            this.outerModuleDefinition = path;

            if (opts.filterMode) {
              let name, depArg = -1;

              if (t.isStringLiteral(args[0]) || args[1] && t.isArrayExpression(args[1])) {
                name = args[0].value || true; // if args[0] is a string use it's literal value, else use 'true'
                if (args[1] && t.isArrayExpression(args[1])) {
                  depArg = 1; // deps array is at args index 1
                }
              }
              else if (t.isArrayExpression(args[0])) {
                depArg = 0; // anonymous define => deps array is at args index 0
              }

              var factoryArg = name && depArg === -1 ? 1 : depArg + 1; // If no deps array is present, the factory must be at index 1. Else it must be at index depArg + 1.

              if (!args[factoryArg]) {
                return; // if no factory param is present, do nothing.
              }

              // note the define index
              // so we know which one to name for the second pass
              if (!this.anonDefine || this.anonNamed)
                this.anonDefineIndex++;

              let parseamdDeps = false;

              // anonymous define
              if (!name) {
                if (this.anonDefine && !this.anonNamed)
                  throw new Error('Multiple anonymous defines.');

                this.anonDefine = true;
                this.anonNamed = false;
                parseamdDeps = true;
              }
              // named define
              else {
                if (typeof name !== 'boolean') {
                  this.bundleDefines.push(name);
                  this.amdDeps.splice(this.amdDeps.indexOf(name), 1);
                }
                if (!this.anonDefine && this.anonDefineIndex === 0 && typeof name !== 'boolean') {
                  this.anonDefine = true;
                  this.anonNamed = true;
                  parseamdDeps = true;
                }
                else if (this.anonDefine && this.anonNamed) {
                  this.anonDefine = false;
                  this.anonNamed = false;
                  this.amdDeps = [];
                }
              }

              if (!parseamdDeps) {
                return;
              }

              if (depArg !== -1 && args[depArg].elements) {
                args[depArg].elements.forEach(function (dep) {
                  if (['require', 'exports', 'module'].indexOf(dep.value) != -1)
                    return;
                  if (that.bundleDefines.indexOf(dep.value) != -1)
                    return;
                  that.amdDeps.push(dep.value);
                });
              } else if (depArg === -1 && t.isFunctionExpression(args[factoryArg])) {
                let cjsFactory = args[factoryArg],
                  fnParameters = args[factoryArg].params,
                  requireParam = fnParameters[0];

                if (requireParam) {
                  const filterAMDamdDeps = {
                    // Visitor to determine all required dependencies if no this.amdDeps array is provided but a factory function with present `require` param.
                    CallExpression(path) {
                      const callee = path.node.callee;
                      const args = path.node.arguments;

                      // Get function scope of defineFactory where param is used
                      if (path.scope.bindings[requireParam.name] &&
                        path.scope.bindings[requireParam.name].identifier === requireParam &&
                        t.isIdentifier(callee, {
                          name: requireParam.name
                        })) {
                        that.amdDeps.push(args[0].value);
                      }
                    }
                  };
                  path.traverse(filterAMDamdDeps);
                }
              }
            } else {

              let moduleName = null,
                deps = [],
                factoryArg = null,
                isExportsInDeps = false,
                isModuleInDepsOrInFactoryParam = false;

              if (args.length === 1) {
                // first param is factory object/function
                factoryArg = args[0];
                // parse factory params
                if (t.isFunctionExpression(factoryArg)) {
                  factoryArg.params.forEach((factoryParam) => {
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
                  deps = args[0];
                }
                // second param is factory object/function
                factoryArg = args[1];
              } else {
                // first param is module name
                moduleName = args[0];
                // second param is dependency array
                deps = args[1];
                // third param is factory object/function
                factoryArg = args[2];
              }

              // Call params used for the define factories wrapped in IIFEs
              var callParams = [];
              var requireParamIndex = -1;
              if (t.isArrayExpression(deps)) {
                // Test if 'exports' exists as dependency: define(['exports'], function(exports) {})
                isExportsInDeps = deps.elements.filter((param) => param.value === 'exports').length > 0;
                isModuleInDepsOrInFactoryParam = deps.elements.filter((param) => param.value === 'module').length > 0;

                deps.elements.forEach((param) => {
                  if (['require', 'module', 'exports'].indexOf(param.value) !== -1) {
                    // Add all special identifiers in it's correct order and bind the to the param identifiers of the System.registerDynamic factory.
                    callParams.push(t.identifier(`$__${param.value}`));
                    if (param.value === 'require') {
                      // Save the index of the factory's require param.
                      requireParamIndex = callParams.length - 1;
                    }
                  } else {
                    callParams.push(t.callExpression(t.identifier('$__require'), [param]));
                  }
                });

                // Removal of all special identifiers from the dependency list, which are provided by the System.registerDynamic's factory.
                deps = deps.elements.filter((param) => {
                  return ['require', 'module', 'exports'].indexOf(param.value) === -1;
                });
              }

              let newDeps = [];

              // Handle CommonJS-style factories
              if (deps.length === 0 &&
                t.isFunctionExpression(factoryArg)) {

                const detectThisAssignments = {
                  // Visitor to determine all assignments to `this` members in a cjs factory function. If so, `exports` must be used as `thisBindingExpression`.
                  ThisExpression(path) {

                    let currentPath = path;

                    // Traverse upwards until an assignment expression is reached
                    while (!t.isAssignmentExpression(currentPath.node) && currentPath.parentPath) {
                      currentPath = currentPath.parentPath;
                    }

                    if (t.isAssignmentExpression(currentPath.node)) {
                      let leftAssignmentOperand = currentPath.node.left;
                      if (t.isMemberExpression(leftAssignmentOperand)) {
                        leftAssignmentOperand = leftAssignmentOperand.object;
                        // Get base operand of member expression
                        while (leftAssignmentOperand.object) {
                          leftAssignmentOperand = leftAssignmentOperand.object;
                        }
                      }
                    }
                  }
                };

                // We need to traverse over the complete path, since we didn't get the path of the cjs factory here.
                // TODO: Find a way to provide path of the cjs factory!!!
                path.traverse(detectThisAssignments, {});

                // Iterate over each param of the cjs factory
                factoryArg.params.forEach((param, index) => {
                  switch (index) {
                    // require
                    case 0:
                      const filterAMDDeps = {
                        // Visitor to determine all required dependencies if no DEPS array is provided but a factory function with present require param.
                        CallExpression(path) {
                          const callee = path.node.callee;
                          const args = path.node.arguments;

                          // Get function scope of defineFactory where param is used
                          if (path.scope.bindings[param.name] &&
                            path.scope.bindings[param.name].identifier === param &&
                            t.isIdentifier(callee, {
                              name: param.name
                            })) {
                            newDeps.push(args[0]);
                          }
                        }
                      };

                      // We need to traverse over the complete path, since we didn't get the path of defineFactore here
                      // TODO: Find a way to provide path of the cjs factory!!!
                      path.traverse(filterAMDDeps, {});

                      // Push $__require to call params if used as factory default param
                      callParams.push(t.identifier('$__require'));
                      break;
                    // exports
                    case 1:
                      // Push $__require to call params if used as factory default param
                      callParams.push(t.identifier('$__exports'));
                      // Boolean flag which indicates that ```exports``` is present as factory param
                      isExportsInDeps = true;
                      break;
                    // module
                    case 2:
                      // Push $__require to call params if used as factory default param
                      callParams.push(t.identifier('$__module'));
                      break;
                  }
                });
              }

              if (requireParamIndex !== -1 && t.isFunctionExpression(factoryArg)) {
                const remapRequiredDeps = {
                  CallExpression(path) {
                    const callee = path.node.callee;
                    const args = path.node.arguments;
                    if (t.isIdentifier(callee, {
                      name: factoryArg.params[requireParamIndex] && factoryArg.params[requireParamIndex].name
                    }) && t.isStringLiteral(args[0])) {
                      if (typeof opts.map === 'function') {
                        args[0].value = opts.map(args[0].value);
                      }
                    }
                  }
                };
                path.traverse(remapRequiredDeps, {});
              }

              let factoryReferenceIdentifier,
                factoryAsExpressionDeclaration;
              let thisBindingExpression = isExportsInDeps ? t.identifier('$__exports') : t.thisExpression();
              if (t.isFunctionExpression(factoryArg)) {
                // If factory is passed as function argument
                const call = t.memberExpression(t.parenthesizedExpression(factoryArg), t.identifier('call'));
                factoryArg = t.callExpression(call, [thisBindingExpression, ...callParams]);
              } else if (t.isIdentifier(factoryArg)) {
                // If factory is passed as identifier argument
                factoryReferenceIdentifier = t.identifier(factoryArg.name);
                const call = t.memberExpression(factoryArg, t.identifier('call'));
                factoryArg = t.callExpression(call, [thisBindingExpression, ...callParams]);
              } else if (!t.isObjectExpression(factoryArg)) {
                // If factory is passed as expression argument
                factoryReferenceIdentifier = t.identifier('$__factory');
                factoryAsExpressionDeclaration = buildFactoryExpressionDeclaration({
                  FACTORY_EXPRESSION: t.parenthesizedExpression(factoryArg)
                });
                const call = t.memberExpression(factoryReferenceIdentifier, t.identifier('call'));
                factoryArg = t.callExpression(call, [thisBindingExpression, ...callParams]);
              }

              let factoryTypeTestNeeded = false;
              if ((!moduleName || moduleName && deps.length === 0) && factoryReferenceIdentifier) {
                // Wraps the factory in a ```if (typeof factory === 'function') {}``` test only a factory reference is present
                factoryTypeTestNeeded = true;
                factoryArg = buildFactoryTypeCheck({
                  FACTORY_REFERENCE: factoryReferenceIdentifier,
                  FACTORY_CALL: factoryArg,
                  TYPE: t.stringLiteral('function'),
                  FACTORY_DECLARATION: factoryAsExpressionDeclaration || null
                });
              }

              const factory = buildFactory({
                MODULE_URI: isModuleInDepsOrInFactoryParam ? buildModuleURIBinding() : null,
                BODY: factoryTypeTestNeeded ? factoryArg : t.returnStatement(factoryArg)
              });

              // Concat with required depencies array which contains string literals if factory default params are used
              deps = deps.concat(...newDeps);
              if (opts.deps) {
                // Concat all dependencies passed via the plugin's' options.
                deps = deps.concat(opts.deps.map(dep => {
                  return t.stringLiteral(dep);
                }).filter(loadDep => {
                  // Filter out already contained dependencies
                  return deps.filter(dep => dep.value === loadDep.value).length === 0;
                }));
              }

              // Map dependencies using the dependency mapping function hook
              if (typeof opts.map === 'function') {
                deps.forEach(e => {
                  e.value = opts.map(e.value);
                });
              }

              let moduleId = this.getModuleName();

              const systemRegister = buildTemplate({
                SYSTEM_GLOBAL: opts.systemGlobal && t.identifier(opts.systemGlobal) || t.identifier('System'),
                MODULE_ID: !opts.anonNamed && moduleName || moduleId && t.stringLiteral(moduleId),
                DEPS: [...deps],
                BODY: factory
              });

              path.replaceWith(systemRegister);
            }
          }
        },
        exit(path) {
          // are we inside a `define()`?
          if (this.outerModuleDefinition === path) {
            this.outerModuleDefinition = null;
          }
        }
      },
      MemberExpression(path, { opts }) {
        if (!opts.filterMode) {
          // Replace `define.amd` with `true` if it's used inside a logical expression,
          // and replace `typeof define.amd` with `'object'`
          if (t.isIdentifier(path.node.object, { name: 'define' }) && t.isIdentifier(path.node.property, { name: 'amd' }) &&
              !path.scope.hasBinding('define') && path.parentPath) {
            if (t.isLogicalExpression(path.parentPath))
              path.replaceWith(t.booleanLiteral(true));
            else if (t.isUnaryExpression(path.parentPath) && path.parentPath.node.operator === 'typeof')
              path.parentPath.replaceWith(t.stringLiteral('object'));
          }
        }
      },
      UnaryExpression(path, { opts }) {
        if (!opts.filterMode) {
          // Replace `typeof define` if it's used inside a unary expression.
          if (!path.scope.hasBinding('define') && path.node.operator === 'typeof' &&
              path.node.argument.name === 'define')
            path.replaceWith(t.stringLiteral('function'));
        }
      }
    }
  };
}
