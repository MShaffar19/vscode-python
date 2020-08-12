// This code was copied from https://github.com/mochajs/mocha but modified to allow spec output at the same time
// as the file.
// Note: Even when running in parallel, the output logger is sync'd. It runs in the root mocha process and not
// in the same process as the tests.
'use strict';
/**
 * @module XUnit
 */
/**
 * Module dependencies.
 */

var Base = require('../../node_modules/mocha/lib/reporters/base');
var utils = require('../../node_modules/mocha/lib/utils');
var fs = require('fs');
var path = require('path');
var errors = require('../../node_modules/mocha/lib/errors');
var createUnsupportedError = errors.createUnsupportedError;
var constants = require('../../node_modules/mocha/lib/runner').constants;
var EVENT_TEST_PASS = constants.EVENT_TEST_PASS;
var EVENT_TEST_FAIL = constants.EVENT_TEST_FAIL;
var EVENT_RUN_END = constants.EVENT_RUN_END;
var EVENT_TEST_PENDING = constants.EVENT_TEST_PENDING;
var EVENT_RUN_BEGIN = constants.EVENT_RUN_BEGIN;
var EVENT_SUITE_BEGIN = constants.EVENT_SUITE_BEGIN;
var EVENT_SUITE_END = constants.EVENT_SUITE_END;
var STATE_FAILED = require('../../node_modules/mocha/lib/runnable').constants.STATE_FAILED;
var inherits = utils.inherits;
var escape = utils.escape;
var color = Base.color;

/**
 * Save timer references to avoid Sinon interfering (see GH-237).
 */
var Date = global.Date;

/**
 * Expose `XUnit`.
 */

exports = module.exports = XUnit;

/**
 * Constructs a new `XUnit` reporter instance.
 *
 * @public
 * @class
 * @memberof Mocha.reporters
 * @extends Mocha.reporters.Base
 * @param {Runner} runner - Instance triggers reporter actions.
 * @param {Object} [options] - runner options
 */
function XUnit(runner, options) {
    Base.call(this, runner, options);

    var stats = this.stats;
    var tests = [];
    var self = this;
    var indents = 0;
    var n = 0;

    function indent() {
        return Array(indents).join('  ');
    }

    // the name of the test suite, as it will appear in the resulting XML file
    var suiteName;

    // the default name of the test suite if none is provided
    var DEFAULT_SUITE_NAME = 'Mocha Tests';

    let outputPath = process.env.MOCHA_FILE;
    if (options && options.reporterOptions) {
        if (options.reporterOptions.output && !outputPath) {
            outputPath = options.reporterOptions.output;
        }
        // get the suite name from the reporter options (if provided)
        suiteName = options.reporterOptions.suiteName;
    }
    if (outputPath) {
        if (!fs.createWriteStream) {
            throw createUnsupportedError('file output not supported in browser');
        }

        fs.mkdirSync(path.dirname(outputPath), {
            recursive: true
        });
        self.fileStream = fs.createWriteStream(outputPath);
    }

    // fall back to the default suite name
    suiteName = suiteName || DEFAULT_SUITE_NAME;

    runner.on(EVENT_TEST_PENDING, function (test) {
        tests.push(test);
        var fmt = indent() + color('pending', '  - %s');
        Base.consoleLog(fmt, test.title);
    });

    runner.on(EVENT_TEST_PASS, function (test) {
        tests.push(test);
        var fmt;
        if (test.speed === 'fast') {
            fmt = indent() + color('checkmark', '  ' + Base.symbols.ok) + color('pass', ' %s');
            Base.consoleLog(fmt, test.title);
        } else {
            fmt =
                indent() +
                color('checkmark', '  ' + Base.symbols.ok) +
                color('pass', ' %s') +
                color(test.speed, ' (%dms)');
            Base.consoleLog(fmt, test.title, test.duration);
        }
    });

    runner.on(EVENT_TEST_FAIL, function (test) {
        tests.push(test);
        Base.consoleLog(indent() + color('fail', '  %d) %s'), ++n, test.title);
    });

    runner.once(EVENT_RUN_END, function () {
        self.write(
            tag(
                'testsuite',
                {
                    name: suiteName,
                    tests: stats.tests,
                    failures: 0,
                    errors: stats.failures,
                    skipped: stats.tests - stats.failures - stats.passes,
                    timestamp: new Date().toUTCString(),
                    time: stats.duration / 1000 || 0
                },
                false
            )
        );

        tests.forEach(function (t) {
            self.test(t);
        });

        self.write('</testsuite>');

        // Print out the spec output
        self.epilogue();
    });

    runner.on(EVENT_RUN_BEGIN, function () {
        Base.consoleLog();
    });

    runner.on(EVENT_SUITE_BEGIN, function (suite) {
        ++indents;
        Base.consoleLog(color('suite', '%s%s'), indent(), suite.title);
    });

    runner.on(EVENT_SUITE_END, function () {
        --indents;
        if (indents === 1) {
            Base.consoleLog();
        }
    });
}

/**
 * Inherit from `Base.prototype`.
 */
inherits(XUnit, Base);

/**
 * Override done to close the stream (if it's a file).
 *
 * @param failures
 * @param {Function} fn
 */
XUnit.prototype.done = function (failures, fn) {
    if (this.fileStream) {
        this.fileStream.end(function () {
            fn(failures);
        });
    } else {
        fn(failures);
    }
};

/**
 * Write out the given line.
 *
 * @param {string} line
 */
XUnit.prototype.write = function (line) {
    if (this.fileStream) {
        this.fileStream.write(line + '\n');
    } else if (typeof process === 'object' && process.stdout) {
        process.stdout.write(line + '\n');
    } else {
        Base.consoleLog(line);
    }
};

/**
 * Output tag for the given `test.`
 *
 * @param {Test} test
 */
XUnit.prototype.test = function (test) {
    var attrs = {
        classname: test.parent.fullTitle(),
        name: test.title,
        time: test.duration / 1000 || 0
    };

    if (test.state === STATE_FAILED) {
        var err = test.err;
        var diff = !Base.hideDiff && Base.showDiff(err) ? '\n' + Base.generateDiff(err.actual, err.expected) : '';
        this.write(
            tag(
                'testcase',
                attrs,
                false,
                tag('failure', {}, false, escape(err.message) + escape(diff) + '\n' + escape(err.stack))
            )
        );
    } else if (test.isPending()) {
        this.write(tag('testcase', attrs, false, tag('skipped', {}, true)));
    } else {
        this.write(tag('testcase', attrs, true));
    }
};

/**
 * HTML tag helper.
 *
 * @param name
 * @param attrs
 * @param close
 * @param content
 * @return {string}
 */
function tag(name, attrs, close, content) {
    var end = close ? '/>' : '>';
    var pairs = [];
    var tag;

    for (var key in attrs) {
        if (Object.prototype.hasOwnProperty.call(attrs, key)) {
            pairs.push(key + '="' + escape(attrs[key]) + '"');
        }
    }

    tag = '<' + name + (pairs.length ? ' ' + pairs.join(' ') : '') + end;
    if (content) {
        tag += content + '</' + name + end;
    }
    return tag;
}

XUnit.description = 'XUnit-compatible XML output';
