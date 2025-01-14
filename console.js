// Store the original console methods before they are overridden so we can still use them!
const originalConsole = {
    log: console.log,
    warn: console.warn,
    info: console.info,
    error: console.error,
    exception: console.exception,
    table: console.table,
    trace: console.trace
};

function interceptJS(originalFunction, methodName) {
    const interceptedFunction = function (...args) {
        originalConsole.log(`Called '${methodName}' but turns out we dont care. ;_; `);
        // originalFunction.apply(this, args); // Optionally call the original function
    };

    interceptedFunction.toString = function () {
        return `function ${methodName}() { [native code JK!LOL! ] }`;
    };

    return interceptedFunction;
}

(function () {
    let globalObject;
    try {
        const getGlobalObject = Function("return (function() {}.constructor('return this')( ));");
        globalObject = getGlobalObject();
    } catch (e) {
        globalObject = window;
    }

    const customConsole = globalObject.console = globalObject.console || {};
    const consoleMethods = ["log", 'warn', "info", "error", "exception", 'table', "trace", "log.toString"];

    for (let i = 0; i < consoleMethods.length; i++) {
        const originalMethod = customConsole[consoleMethods[i]] || function () { };
        const methodName = consoleMethods[i];

        customConsole[methodName] = interceptJS(originalMethod, methodName);
    }
})(this);


console.log("This is a test log.");


const originalConsole = {
    log: console.log,
    warn: console.warn,
    info: console.info,
    error: console.error,
    exception: console.exception,
    table: console.table,
    trace: console.trace
};

function _0x58fa5f(originalFunction, methodName) {
    const interceptedFunction = function (...args) {
        originalConsole.log(`Console method '${methodName}' was called, but its functionality is intercepted.`);
        // originalFunction.apply(this, args); // Optionally call the original function
    };

    interceptedFunction.toString = function () {
        return `function ${methodName}() { [native code] }`;
    };

    return interceptedFunction;
}

(function () {
    let globalObject;
    try {
        const getGlobalObject = Function("return (function() {}.constructor('return this')( ));");
        globalObject = getGlobalObject();
    } catch (e) {
        globalObject = window;
    }

    const customConsole = globalObject.console = globalObject.console || {};
    const consoleMethods = ["log", 'warn', "info", "error", "exception", 'table', "trace"];

    for (let i = 0; i < consoleMethods.length; i++) {
        const originalMethod = customConsole[consoleMethods[i]] || function () { };
        const methodName = consoleMethods[i];

        customConsole[methodName] = _0x58fa5f(originalMethod, methodName);
    }
})(this);

// Example usage
console.log("This is a test log."); // Will be intercepted
console.log.toString(); // Will show a misleading representation
