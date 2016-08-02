/**
 * @author Miroslav Bajtos <miroslav@strongloop.com>
 * @license MIT and IBM StrongLoop License
 * @description
 * Based on the original services.js discovery file from the loopback-sdk-angular
 * It has been updated to fit the loopback-sdk-builder needs.
 * 
 * https://github.com/strongloop/loopback-sdk-angular/blob/master/lib/services.js
 **/
exports.describeModels = function describeModels(app) {
  var models = {};
  app.handler('rest').adapter.getClasses().forEach(function(c) {
    var name = capitalize(c.name);
    c.description = c.sharedClass.ctor.settings.description;
    // Tell SDK Builder to generate model by default, unless user 
    c.sharedClass.ctor.settings = Object.assign(
      { sdk: {  enabled: true }},
      c.sharedClass.ctor.settings
    );
    // Tell SDK to blacklist specific methods
    c.sharedClass.ctor.settings.sdk.blacklist = Object.assign(
      {}, // Will we want to add methods to blacklist by default???
      c.sharedClass.ctor.settings.sdk.blacklist || {}
    );
    if (!c.ctor) {
      // Skip classes that don't have a shared ctor
      // as they are not LoopBack models
      console.error('Skipping %j as it is not a LoopBack model', name);
      return;
    }

    // The URL of prototype methods include sharedCtor parameters like ":id"
    // Because all $resource methods are static (non-prototype) in ngResource,
    // the sharedCtor parameters should be added to the parameters
    // of prototype methods.
    c.methods.forEach(function fixArgsOfPrototypeMethods(method, key) {
      var ctor = method.restClass.ctor;
      if (!ctor || method.sharedMethod.isStatic) return;
      method.accepts = ctor.accepts.concat(method.accepts);

      if(!method.accepts) return;

      // Any extra http action arguments in the path need to be added to the
      // angular resource actions as params
      method.accepts.forEach(function findResourceParams(arg) {
        if(!arg.http) return;

        if(arg.http.source === 'path' && arg.arg !== 'id') {
          if(!method.resourceParams) {
            method.resourceParams = [];
            method.hasResourceParams = true;
          }
          method.resourceParams.push(arg);
        }
      });
    });

    c.properties = c.sharedClass.ctor.definition.properties;

    c.isUser = c.sharedClass.ctor.prototype instanceof app.loopback.User ||
      c.sharedClass.ctor.prototype === app.loopback.User.prototype;
    models[name] = c;
  });

  buildScopes(models);

  return models;
};

var SCOPE_METHOD_REGEX = /^prototype.__([^_]+)__(.+)$/;

function buildScopes(models) {
  for (var modelName in models) {
    buildScopesOfModel(models, modelName);
  }
}

function buildScopesOfModel(models, modelName) {
  var modelClass = models[modelName];

  modelClass.scopes = {};
  modelClass.methods.forEach(function(method) {
    buildScopeMethod(models, modelName, method);
  });

  return modelClass;
}

// reverse-engineer scope method
// defined by loopback-datasource-juggler/lib/scope.js
function buildScopeMethod(models, modelName, method) {
  var modelClass = models[modelName];
  var match = method.name.match(SCOPE_METHOD_REGEX);
  if (!match) return;

  var op = match[1];
  var scopeName = match[2];
  var modelPrototype = modelClass.sharedClass.ctor.prototype;
  var targetClass = modelPrototype[scopeName] &&
      modelPrototype[scopeName]._targetClass;
  if (modelClass.scopes[scopeName] === undefined) {
    if (!targetClass) {
      console.error(
        'Warning: scope %s.%s is missing _targetClass property.' +
        '\nThe Angular code for this scope won\'t be generated.' +
        '\nPlease upgrade to the latest version of' +
        '\nloopback-datasource-juggler to fix the problem.',
        modelName, scopeName);
      modelClass.scopes[scopeName] = null;
      return;
    }

    if (!findModelByName(models, targetClass)) {
      console.error(
        'Warning: scope %s.%s targets class %j, which is not exposed ' +
        '\nvia remoting. The Angular code for this scope won\'t be generated.',
        modelName, scopeName, targetClass);
        console.log(modelName, scopeName, targetClass);
      modelClass.scopes[scopeName] = null;
      return;
    }

    modelClass.scopes[scopeName] = {
      methods: {},
      targetClass: targetClass
    };
  } else if (modelClass.scopes[scopeName] === null) {
    // Skip the scope, the warning was already reported
    return;
  }

  var apiName = scopeName;
  if (op == 'get') {
    // no-op, create the scope accessor
  } else if (op == 'delete') {
    apiName += '.destroyAll';
  } else {
    apiName += '.' + op;
  }

  // Names of resources/models in Angular start with a capital letter
  var ngModelName = capitalize(modelName);
  method.internal = 'Use ' + ngModelName + '.' + apiName + '() instead.';

  // build a reverse record to be used in ngResource
  // Product.__find__categories -> Category.::find::product::categories
  var reverseName = '::' + op + '::' + modelName + '::' + scopeName;

  var reverseMethod = Object.create(method);
  reverseMethod.name = reverseName;
  reverseMethod.internal = 'Use ' + ngModelName + '.' + apiName + '() instead.';
  // override possibly inherited values
  reverseMethod.deprecated = false;

  var reverseModel = findModelByName(models, targetClass);
  reverseModel.methods.push(reverseMethod);
  var scopeMethod = Object.create(method);
  scopeMethod.name = reverseName;
  // override possibly inherited values
  scopeMethod.deprecated = false;
  scopeMethod.internal = false;
  modelClass.scopes[scopeName].methods[apiName] = scopeMethod;
  modelClass.sharedClass.ctor.relations[scopeName].targetClass = capitalize(targetClass);
}

function findModelByName(models, name) {
  for (var n in models) {
    if (n.toLowerCase() == name.toLowerCase())
      return models[n];
  }
}

function capitalize(string) {
  return string[0].toUpperCase() + string.slice(1);
}