'use strict';

var flatit = require('flatit');
var args = require('fn-args');
var methods = require('methods');
var async = require('async');
var Dag = require('dag');
var needInject = require('./utils.js').needInject;

module.exports = function (app) {
    var dag = new Dag();
    var inject;

    inject = function (dependency, fn) {
        if (typeof fn !== 'function') {
            throw new Error('inject() requires a function, but got a ' + typeof fn);
        }

        args(fn).forEach(function (param) {
            dag.addEdge(dependency, param);
        });

        inject.declare.call(inject, dependency, fn);
    };

    inject.dependencies = {};

    inject.declare = function declare(name, fn) {
        this.dependencies[name] = fn;
    };

    inject.resolve = function resolve(name, cb) {
        var resolved = this.dependencies[name];
        if (!resolved) {
            return cb(new Error('Unknown dependency: ' + name));
        }
        return cb(null, resolved);
    };

    function resolveInjections(params, req, res, next, done) {
        /*jshint validthis:true */
        var self = this;

        async.map(params, function (dependency, callback) {
            if (dependency === 'req') { return callback(null, req); }
            if (dependency === 'res') { return callback(null, res); }
            if (dependency === 'next') { return callback(null, next); }

            inject.resolve.call(inject, dependency, function (err, constructor) {
                if (err) { throw err; }

                resolveInjections(
                    args(constructor),
                    req,
                    res,
                    callback,
                    function (err, results) {
                        if (err) { return done(err); }
                        constructor.apply(self, results);
                    }
                );
            });
        }, done);
    }

    app.lazyrouter();

    var _route = app._router.route.bind(app._router);
    app._router.route = function (path) {
        var route = _route(path);
        methods.forEach(function(method) {
            route[method] = wrap(route[method]);
        });
        return route;
    };

    function wrap(origin) {
        return function () {
            var callbacks = flatit([].slice.call(arguments));
            callbacks = callbacks.map(function (fn) {
                if (typeof fn !== 'function') { return fn; }
                var params = args(fn);

                if (!needInject(params)) {
                    return fn;
                }

                return function (req, res, next) {
                    var self = this;
                    resolveInjections.bind(self)(params, req, res, next, function (err, results) {
                        if (err) { return next(err); }
                        fn.apply(self, results);
                    });
                };
            });

            origin.call(this, callbacks);
        };
    }

    return inject;
};
