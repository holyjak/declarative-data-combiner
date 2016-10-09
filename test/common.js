"use strict";
/**
 *  * Common configuration for all tests, required implicitly from each test file
 *   * - registration of Mocha plugins, definition of global objects etc.
 *    */

// Common setup used by all tests
// // (via `--require test/common` in mocha.opts)

global.chai = require("chai");
global.expect = require("chai").expect;
global.sinon = require("sinon");

const chaiSubset = require('chai-subset');
chai.use(chaiSubset);
