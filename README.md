# babel-plugin-transform-amd-system-wrapper

Wraps AMD modules into `System.registerDynamic(...`

## Example

**In**

```js
define(['bar'], function(bar, require, module) {
    module.exports = {
	  bar: bar
	}
});
```

**Babel Options**
```js
{
  plugins: [
    ['transform-amd-system-wrapper', {
		// TBD
    }]
  ]
}
```

**Out**

```js
System.registerDynamic(['bar'], false, function ($__require, $__exports, $__module) {
  'use strict';

  $__module.uri = $__module.id;
  return (function(bar, require, module) {
    module.exports = {
	  bar: bar
	}
  }).call(this, $__require('bar'), $__require, $__module);
});
```

## Installation

```sh
$ npm install babel-plugin-transform-amd-system-wrapper
```

## Usage

### Via `.babelrc`

**.babelrc**

```json
{
  "plugins": [
    ["transform-amd-system-wrapper", {
      // TBD
    }]
  ]
}
```

### Via CLI

```sh
$ babel --plugins transform-amd-system-wrapper script.js
```

### Via Node API (Recommended)

```javascript
require("babel-core").transform("code", {
  plugins: [
    ["transform-amd-system-wrapper", {
      // TBD
    }]
  ]
});
```
