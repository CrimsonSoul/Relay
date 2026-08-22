'use strict';

const implementation = require('brace-expansion-patched');
const expand = implementation.expand;

Object.assign(expand, implementation);
expand.expand = expand;

module.exports = expand;
