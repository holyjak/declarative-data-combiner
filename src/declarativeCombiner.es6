'use strict';
const _ = require("lodash");
const Immutable =  require('seamless-immutable'); // TODO Make it optional, define Immutable = identity if not available
// The dev version (that actually freezes data etc.) is 2-3 times slower with our large data

const DEBUG = false; // Change to true when troubleshooting
let auditingDisabled = true && !DEBUG; // Disable to save some 10s of % of processing time
const SYM_REMOVE = Symbol("marker to remove the given element from a dict/list");

/**
 * Define how to process source data in the form of a dictionary (key => value, i.e. an object; also applicable to arrays).
 * The `value` describe how to process each value of the input dictionary (which becomes the current `sourceElement`).
 * The dictionary can be filtered based on a `valueFilter` or the result of joins (see below).
 * (The documentation uses JSDoc format; param name in `[]` means that the param is optional.)
 *
 * NOTE: The combiner processes a (tree) data structure recursively, matching it to the combination definition (Dictionary|List|Template).
 * The element of the source data structure that is currently being processed is referred to as the sourceElement.
 * (At start it is the full data structure.)
 *
 * @param {Object} properties
 * @param {Join[]} [properties.joins] an array of of joins, defining how to join the other data, adding them to the current bindings
 * @param {string} [properties.key] document what is the key of the property (e.x.: "socialSecurityNumber"); primarily for information purposes
 *         and for better logs in an audit
 * @param {(Dictionary|List|Template)} properties.value - declare how to process each value (which becomes the current `sourceElement`)
 * @param {(string|Object|function(Object))} [properties.valueFilter] - if present, the value must match it or be skipped (left as is); see `_.matches`
 */
export function Dictionary(properties) {
    if (! (this instanceof Dictionary)) {
        return new Dictionary(properties);
    }
    assertKeys(properties, {required: ["value"], optional: ["key", "joins", "valueFilter"]});
    Object.assign(this, properties);
}

/**
 * Just as Dictionary for for arrays instead of object.
 * The only difference is that `key` is not supported.
 *
 * Documentation copied from Dictionary (so replace "dictionary" with "list" while reading):
 *
 * Define how to process source data in the form of a dictionary (key => value, i.e. an object; also applicable to arrays).
 * The `value` describe how to process each value of the input dictionary (which becomes the current `sourceElement`).
 * The dictionary can be filtered based on a `valueFilter` or the result of joins (see below).
 * (The documentation uses JSDoc format; param name in `[]` means that the param is optional.)
 *
 * NOTE: The combiner processes a (tree) data structure recursively, matching it to the combination definition (Dictionary|List|Template).
 * The element of the source data structure that is currently being processed is referred to as the sourceElement.
 * (At start it is the full data structure.)
 *
 * @param {Object} properties
 * @param {Join[]} [properties.joins] an array of of joins, defining how to join the other data, adding them to the current bindings
 * @param {(Dictionary|List|Template)} properties.value - declare how to process each value (which becomes the current `sourceElement`)
 * @param {(string|Object|function(Object))} [properties.valueFilter] - if present, the value must match it or be skipped (left as is); see `_.matches`
 */
export function List(properties) {
    if (! (this instanceof List)) {
        return new List(properties);
    }
    assertKeys(properties, {required: ["value"], optional: ["joins", "valueFilter"]});
    _.assign(this, properties);
}

/**
 * Define how to join other data based on the current element and already existing bindings and, optionally,
 * what to do if there is no data to join.
 * (Initial bindings can be passed to `combine` and are added to based on the joins. Bindings is a key => value dict.)
 *
 * Essentially it takes in a data structure (typically an array or a dict) and looks up an element in it and returns it.
 *
 * @param {Object} properties
 * @param {string} properties.key - the data to join; `bindings[key]` will be passed as the first argument to the `fn`
 * @param {string} properties.as - how to name the result in the current bindings (=> it sets `bindings[as]`)
 * @param {function(*, object, (string|integer)} properties.fn - a function that performs the join; arguments:
 *        the selected binding (see `key`), sourceElement (the current dictionary value being processed), its dictionary key, bindings
 * @param {(IfNoMatch|function)} [properties.ifNoMatch] - what to do if `fn` returns null/undefined;
 *        If it is a function, it must return one of IfNoMatch and is invoked with (the binding, sourceElement, its key, bindings)
 * @param {string} [properties.on] - UNUSED until we re-implement declarative joins
 * @param {string} [properties.selector] - UNUSED until we re-implement declarative joins
 *
 * TODO Add Join "subclass" `Require` used on the top-level Dictionary to document+check what bindings should be passed
 *      to `combine` if there is no Join that has them as `key` (e.g. because they are used somewhere deeper down)
 */
export function Join(properties) {
    if (! (this instanceof Join)) {
        return new Join(properties);
    }
    assertKeys(properties, {required: ["key", "as", "fn"], optional: ["ifNoMatch", /* Unused: */ "on", "selector"]});
    _.assign(this, properties);
}

/**
 * Define what to do if a join produces no match (i.e. null).
 * @enum {string}
 */
export const IfNoMatch = {
    SKIP: "skip" /** Do not process the value further and leave it in the dictionary as-is */,
    REMOVE: "remove" /** Do not process the value further and remove if from the dictionary */,
    PROCESS: "process" /** (default) process the value anyway */
}

// /** *CURRENTLY NOT USED* Indicate that the join property `name` value should be taken from a dictionary key. */
// export function Key(name) { // The name serves currently only a documentation purpose
//     if (! (this instanceof Key)) {
//         return new Key(name);
//     }
//     this.name = name;
// }
//
// /** *CURRENTLY NOT USED* Indicate that the join property `name` value should be taken from a property. */
// export function Property(name) {
//     if (! (this instanceof Property)) {
//         return new Property(name);
//     }
//     this.name = name;
// }
//
// /** *CURRENTLY NOT USED* */
// export const JoinPredicates = {
//     includes: _.includes,
//     has: _.has
// };

/**
 * A Template will add new properties to the current sourceElement (unless replace=true) with the defined
 * properties, their values based on the joined data.
 *
 * @param {(string|function(Object, Object)|{source: string, default: *})} properties - definition of
 *        the properties+values of the resulting object. Each key is kept as-is while
 *        the value is either:
 *        - a string of the form `<binding key>[.propertyName]*` - path to a value in `bindings`
 *        - or a function taking (bindings, the current sourceElement)
 *        - or an object with `{source, default}` where the source is the same as the plain string above, `default` is any value; TODO replace with a DSL class instance? `Property("path", { default: ... })`
 *        - TODO support `Literal(<any value>)` (as an alternative to `() => <any value>`)
 *        - TODO support FirstOf("property path", ...) instead of e.g. `({ pricePlansContainer, virtualBundle }) => virtualBundle ? virtualBundle.pricePlans : pricePlansContainer.pricePlans,`
 * @param {Object} [options] possible extra options
 * @param {Object} [options.replace = false] if true, the current element is replaced otherwise the new properties are merged into it
 */
export function Template(properties, options) {
    if (! (this instanceof Template)) {
        return new Template(properties, options);
    }
    Object.assign(this, properties);
    this._options = Immutable(options);
}

/**
 * Create a new combiner with custom options.
 * @param {function(string,Error)}[loggerWarn=console.log] - the function to invoke with warnings, f.ex. when a join `fn` fails
 * @constructor
 */
export function Combiner({ loggerWarn } = {}) {
    this.loggerWarn = loggerWarn || ((msg, err) => console.log(msg, err));
}
Combiner.prototype.combineAndAudit = combineAndAudit;
Combiner.prototype.combineAndResult = combineAndResult;
Combiner.prototype.combine = combine;
Combiner.prototype._process = process;
Combiner.prototype._processValues = processValues;
Combiner.prototype._processValue = processValue;
Combiner.prototype._resolveJoins = resolveJoins;
Combiner.prototype._resolveJoin = resolveJoin;

/**
 * Convenience for the old-style require - make it possible to:
 *
 *    const Combiner = require(...);
 *    const { List, Join, ...} = Combiner.DSL;
 */
export default Combiner;

/**
 * Process recursively the sourceElement (tree-like) data structure (dictionary, array),
 * combining it with data from other joined data structures, passed in through the initial bindings and derived.
 * Think of a SQL join performed on trees.
 *
 * ** For documentation of the DSL, see Dictionary, Template etc. and the unit tests. **
 *
 * @param {(Dictionary|List)} def the definition of the combination - a combination of
 *        Dictionary, Template etc. matching and extending the structure
 *        of the sourceElement
 * @param {(Array|Object)} sourceElement the main data structure that we want to extend with
 *        additional properties from the bindings
 * @param {Object<string, *>} bindings a map of key => data structure of data we want to join onto and
 *        combine with the sourceElement
 * @param {Object} [options]
 * @param {boolean} [options.enableAuditing = false] collect a report of missed joins etc.; for troubleshooting; exppensive
 * @return {{result: *, audit: Array}} where result is a copy of sourceElement with
 *       new properties as defined by the def and audit (if enabled) is a list
 *       of {path, logs} for each point in the processing
 *
 * TODO Perhaps/eventually 1) Re-add declarative joins in an efficient way
 *
 * ### Limitations
 *
 * 1. No support for arrays of Templates, only Dictionaries as of now (though a JS array is also an object)
 *
 * ### Troubleshooting
 *
 * 0. Set `DEBUG = true` above and observer the logs starting with 'declarativeCombiner:'
 *    (logs primarily elements skiped/removed due to no match)
 * 1. Use a debugger, set a breakpoint in `combine` or `process` etc. It is simple
 *    to debug as we are just looping over some data.
 * 2. Run with `{enableAuditing: true}` to collect an audit log of which paths in
 * the sourceElement data structure were processed with logs of joins that yielded
 * no matches
 * 3. Add `audit: true` to a join ({key, join, as, audit}) to have its outcome
 * included in the audit log even on a successful match
 *
 * ### Performance
 *
 * In the HW combiner it took ±130ms (or 50 when in run 10* in a loop, likely due to JIT)
 * cloneDeep of joins and sourceElement would add another 100 ms.
 *
 * Immutable: Immutable code (initial wrapping + merge) takes cca 150 ms (while
 * cloneDeep cca 100 ms). Since the input values are already cloned by the cache,
 * this is unnecessary overhead. However, if the cache itself used Immutable, then
 * we could re-add it (perhaps using mutable merge instead of immutable one)
 */
function combine(def, sourceElement, bindings, options) {
    options = options || {};
    const auditingDisabledOrig = auditingDisabled;
    if (options.enableAuditing) {
        auditingDisabled = false;
    }
    const context = {
        bindings,
        audit: ({path: [], report: []})
    };

    try {
        const result = Immutable(this._process(context, def, null, sourceElement, "<root>"));
        return {
            result: result,
            auditReport: context.audit.report, // TODO Deprecated, use the simpler `audit`
            audit: context.audit.report
        };
    } finally {
        auditingDisabled = auditingDisabledOrig; // reset
    }
}

/** As `combine` but returns the resulting data structure directly, without the audit.
 * @see combine
 */
function combineAndResult(def, sourceElement, bindings) {
    return this.combine(def, sourceElement, bindings).result;
}

/** As `combine` but enables auditing and returns `{ result, audit }`.
 * You can explicitly disable auditing with options = `{ enableAuditing: false }`.
 * @see combine
 */
function combineAndAudit(def, sourceElement, bindings, options) {
    return this.combine(def, sourceElement, bindings, Object.assign({ enableAuditing: true }, options));
}

/**
 * Process a Dictionary/Template/..., iterating over it in sync with the current `sourceElement`. Recursive.
 *
 * @param {Object} context - the current context with bindings, ...
 * @param {(Dictionary|List|Template)} def - the current part of the combination definition being applied to the current `sourceElement`.
 * @param {Join[]} joinsDef - the value of `joins: ...` on the current def == Dict./List
 * @param {Object} sourceElement - the current source data subtree being matched to the `def` and combined
 * @param {string} [maybeSourceElementKey] - if `def` is a Dictionary then sourceElement is one of the map's values
 *         while `maybeSourceElementKey` is its key
 */
function process(context, def, joinsDef, sourceElement, maybeSourceElementKey) {
    assert(typeof sourceElement === "object",
        "sourceElement must be an object; is: " + (typeof sourceElement) + ", value: " + sourceElement,
        context);

    context = set(context, "maybeSourceElementKey", maybeSourceElementKey);

    // 1. Has joins prop? => exec, add to context
    if (joinsDef) {
        const {resolvedBindings, elementAction} = this._resolveJoins(sourceElement, context, joinsDef);
        context.bindings = resolvedBindings;
        // 1. "remove" has top priority
        if (elementAction.remove) {
            // TODO: currently this only works properly if sourceElement is
            // an element of a Dictionary or List (which is ok since we only support
            // joins on those so far)
            return SYM_REMOVE;
        }
        // 2. "skip" has priority two
        if (elementAction.skip) {
            return sourceElement;// return as-is, unprocessed
        }
        // 3. "process" (the default) has the lowest priority
        // do not return anything, allowing the rest of the function to execute

    }

    // SWITCH:
    if (def instanceof Dictionary || def instanceof List) {
        pushToAuditPath(context, maybeSourceElementKey);
        pushAuditReportAtCurrentPath(context, def.constructor.name +  " size=" + _.size(sourceElement));
        try {
            if (def instanceof Dictionary) {
                // A) Dictionary: process values recursively
                // Precondition: _.every(_.isObject, _.values(sourceElement))
                assert((sourceElement || {}) instanceof Object, "the def is a Dictionary so the sourceElement should be an Object, is: " + (typeof sourceElement), context);
                return _.chain(sourceElement)
                    .mapValues((value, key) => {
                        if (def.valueFilter && !_.matches(def.valueFilter)(value)) {
                            return value; // skip, no transformation
                        }
                        pushToAuditPath(context, (def.key || "<unnamed key>") + "=" + key);
                        try {
                            return this._process(context, def.value, def.joins, value, key);
                        } finally {
                            popAuditPath(context);
                        }
                    })
                    .omitBy(v => v === SYM_REMOVE) // if a join had no match and ifNoMatch=remove
                    .value();
            } else if (def instanceof List) {
                // B) List: process values recursively
                // Precondition: _.every(_.isObject, _.values(sourceElement))
                const definedSourceElement = (sourceElement || []);
                assert(definedSourceElement instanceof Array, "the def is a List so the sourceElement should be an Array, is: " + (typeof sourceElement), context);
                return definedSourceElement
                    .map((value, index) => {
                        if (def.valueFilter && !_.matches(def.valueFilter)(value)) {
                            return value; // skip, no transformation
                        }
                        pushToAuditPath(context, "index=" + index);
                        try {
                            return this._process(context, def.value, def.joins, value, index);
                        } finally {
                            popAuditPath(context);
                        }
                    })
                    .filter(v => v !== SYM_REMOVE); // if a join had no match and ifNoMatch=remove
            }
        } finally {
            popAuditPath(context);
        }
    } else if (def instanceof Template) {
        // C) Template: fill values, recurse
        assert((sourceElement || {}) instanceof Object, "the def is a Template so the sourceElement should be an Object, is: " + (typeof sourceElement), context);
        assert(! def.joins, "`joins` isn't supported on Templates, only on Dictionaries, Lists", context);
        const replace = def._options && def._options.replace;

        const resolvedProperties = this._processValues(context, def, sourceElement, maybeSourceElementKey);

        // ignoreNonValuesMerger: Omit "empty" - the joined data may override
        // stuff in the source element but if not, we preserve the original value
        return replace ? resolvedProperties : mergeResolved(sourceElement, resolvedProperties);
    }
}

/** Process the value of a Template property, replacing it with what is requested. */
function processValues(context, templateDef, sourceElement, maybeSourceElementKey) {

    const self = this;

    function updateLocationAndProcessValue(propertyValueTemplate, propertyName) {
        let newSourceElement = sourceElement;
        const descend = isDef(propertyValueTemplate);
        if (descend) {
            // => we need to descend the source data tree in sync with the def
            if (! sourceElement[propertyName]) {
                sourceElement = set(sourceElement, propertyName, defaultFor(propertyValueTemplate));
            }
            newSourceElement = sourceElement[propertyName];
        }

        pushToAuditPath(context, propertyName, descend); // FIXME descend should not be false if the value is a fn that itself calls the combiner; fix by a DSL for this case
        try {
            return self._processValue(context, newSourceElement, propertyValueTemplate, maybeSourceElementKey);
        } finally {
            popAuditPath(context, descend);
        }
    }

    const resolvedProperties = _.mapValues(
            stripNonValueProperties(templateDef),
            updateLocationAndProcessValue);

    return resolvedProperties;
}

/** Process the value of a property inside a Template */
function processValue(context, sourceElement, valueDef, sourceElementKey) {

    if (typeof valueDef === "string") {
        // Ex.: "contextObject", "contextObject.property"
        const propertyPath = valueDef;
        return _.get(context.bindings, propertyPath);
    } else if (typeof valueDef === "function") {
        const valueFn = valueDef;
        try {
            return valueFn(context.bindings, sourceElement, sourceElementKey);
        } catch (err) {
            this.loggerWarn(
                `declarativeCombiner.processValue: fn failed with ${err}. Bindings: ${_.keys(context.bindings)}, sourceElement keys: ${_.keys(sourceElement)}.` + maybePathInfo(context),
                err);
            return undefined;
        }
    } else if (isDef(valueDef)) {
        return this._process(context, valueDef, null, sourceElement);
    } else if (typeof valueDef === "object" && valueDef.source) {
        const result = _.get(context.bindings, valueDef.source);
        return result || valueDef.default;
    } else {
        throw new Error("Unsupported value type " +
            valueDef.constructor.name + ": " + JSON.stringify(valueDef) + maybePathInfo(context));
    }
}

function resolveJoins(sourceElement, context, joinsDef) {
    let resolvedBindings = context.bindings;
    for (const join of joinsDef) {
        resolvedBindings = this._resolveJoin(sourceElement, context, resolvedBindings, join);

        const noMatch = resolvedBindings[join.as] === undefined;
        const ifNoMatch = (typeof join.ifNoMatch === "function") ?
            join.ifNoMatch(context.bindings[join.key], sourceElement, context.maybeSourceElementKey, context.bindings) :
            join.ifNoMatch;
        const stopProcessing = _.includes([IfNoMatch.REMOVE, IfNoMatch.SKIP], ifNoMatch);

        if (noMatch && stopProcessing) {
            if (DEBUG) console.info(`declarativeCombiner: ${ifNoMatch}-ing the element due to no match for the join ${join.key}->${join.as} at ${context.audit.path}. The element: `, sourceElement); // eslint-disable-line no-console
            // Do not proceed with other joins as this element will not
            // be processed anyway (and the joins may depend on this one)
            return {
                resolvedBindings,
                elementAction: {
                    remove: ifNoMatch === IfNoMatch.REMOVE,
                    skip: ifNoMatch === IfNoMatch.SKIP
                }
            };
        }
    }
    return {
        resolvedBindings,
        elementAction: {
            process: true
        }
    };
}

function resolveJoin(sourceElement, context, bindings, join) {
    //assertKeys(join, {required: ["key", "on", "as"], optional: ["selector", "audit", "fn"]});
    assertKeys(join,
        {required: ["fn", "key", "as"],
        optional: ["on", "selector", "audit", "ifNoMatch"]},
        context
    );

    const joinData = bindings[join.key];

    assert(joinData || _.chain(bindings).keys().includes(join.key).value(),
        "join.key '" + join.key + "' not found among the current bindings keys: [" + _.keys(bindings) + "]",
        context
    );

    if (! joinData) {
        // May be empty due to coming from a previous join that did not match anything
        pushAuditReportAtCurrentPath(context, {message: "No match for join", join: join, cause: "Empty binding"});
        return merge(bindings, {[join.as]: null});
    }

    let resultValue;
    try {
        resultValue = join.fn(joinData, sourceElement, context.maybeSourceElementKey, context.bindings);
    } catch (err) {
        this.loggerWarn(
            `declarativeCombiner.resolveJoin: join.fn for ${join.key}->${join.as} failed with ${err}` + maybePathInfo(context),
            err);
    }
    let makeMismatchReport = _.constant(null);

    // var joinSource = join.selector ? joinData[join.selector] : joinData;
    //
    // var matchCondition;
    // var makeMismatchReport;
    // if (typeof join.on === "string") {
    //     // Ex.: "guid"
    //     var matchProperty = join.on;
    //     var searchKey = sourceElement[join.on];
    //     matchCondition = {[matchProperty]: searchKey};
    //     makeMismatchReport = function() {
    //         return {searchKey: searchKey, candidates: _.map(matchProperty, joinSource)};
    //     };
    // } else if (join.on.length === 2) {
    //     // Ex.: [Key(guid), Prop(guid)]
    //     var candidateProperty = join.on[0];
    //     var sourceProperty = join.on[1];
    //     var searchKey = sourceElement[sourceProperty.name];
    //     assert(candidateProperty instanceof Key &&
    //         sourceProperty instanceof Property,
    //         "Yet unsupported join condition " + join.on);
    //     matchCondition = function(_, candidateKey) {
    //         return searchKey === candidateKey;
    //     };
    //     makeMismatchReport = function() {
    //         return {searchKey: searchKey, candidates: _.keys(joinSource)};
    //     }
    // } else if (join.on.length === 3) {
    //     // Ex.: ["members[].guid", .includes, "guid"]
    //     var candidateProperty = join.on[0];
    //     var matchFn = join.on[1];
    //     var sourceProperty = join.on[2];
    //     var searchKey = sourceElement[sourceProperty];
    //     var matchReport = [];
    //     matchCondition = function(candidate) {
    //         var resolution = resolveJoinProperty(candidate, candidateProperty);
    //         var candidateValues = resolution.values;
    //         if (! auditingDisabled) {
    //             matchReport.push({
    //                 candidate: candidate,
    //                 candidateValues: candidateValues,
    //                 prematureMatchEndAtDepth: resolution.prematureMatchEndAtDepth});
    //         }
    //         // *BEWARE* the matchFn must accept arguments in this order; best
    //         // to use JoinPredicates.<fn name>
    //         return matchFn(searchKey, candidateValues);
    //     };
    //     makeMismatchReport = function() {
    //         var validPropertyPath = _.flow(
    //             _.map("prematureMatchEndAtDepth"),_.every(_.isEqual(false)))(matchReport)
    //         var result = {searchKey: searchKey};
    //         if (! validPropertyPath) {
    //             result.invalidPropertyPath = "The binding property path " +
    //                 "doesn't exist on any candidate element. Last found " +
    //                 "property at depth (0-based): " +
    //                 _.flow(_.map("prematureMatchEndAtDepth"), _.max)(matchReport);
    //         } else {
    //             result.candidates = _.flatten(_.map("candidateValues", matchReport));
    //         }
    //         return result;
    //     };
    // } else {
    //     throw new Error("Unsupported on clause in " + JSON.stringify(join, null, 2));
    // }
    //
    // // We have to use non-fp lodash b/c _.find does not get the key param when searching an object :-( => Bug 1343
    // var resultValue = _.find(joinSource, matchCondition); // _.find(matchCondition, joinSource);

    if (! resultValue) {
        pushAuditReportAtCurrentPath(context, {
            message: "No match for join",
            join: join,
            cause: "No match for the key in the binding",
            details: _.once(makeMismatchReport) // This may be expensive => only eval whe asked for it and max once
        });
    } else if (join.audit) {
        pushAuditReportAtCurrentPath(context, {
            message: "Matched a(n) " + join.as,
            value: resultValue
        });
    }

    return merge(bindings, {[join.as]: resultValue});
}

// /** Either "property" or "property[].nested" (possibly in Key or Property) */
// function resolveJoinProperty(candidate, propertyPath) {
//
//     function reductor(state, propertyName) {
//         var data = state.data;
//
//         assert(state.mapOverCollection || !(data instanceof Array),
//             "The parent of '" + propertyName + "' in '" + propertyPath +
//             "' is an array but you haven't made it explicit that you " +
//             "indeed intended to map over it by appending '[]' to it");
//
//         var plainPropertyName = propertyName.replace("[]", "");
//         var isCollectionProperty = (plainPropertyName !== propertyName);
//
//         var propertyValue = state.mapOverCollection ?
//             _.flow(_.map(plainPropertyName), _.flatten, _.reject(_.isUndefined))(data) :
//             _.result(plainPropertyName, data);
//
//         var matchDepth;
//         if (! auditingDisabled) {
//             var propertyExists;
//             if ((state.mapOverCollection && propertyValue.length > 0) ||
//                 (!state.mapOverCollection && propertyValue)) {
//                 // Optimization: If we got a value, the property must exist
//                 propertyExists = true;
//             } else {
//                 propertyExists = state.mapOverCollection ?
//                     _.some(_.has(plainPropertyName), data) :
//                     _.has(plainPropertyName, data);
//             }
//
//             matchDepth = state.matchDepth + (propertyExists ? 1 : 0);
//         }
//         return {data: propertyValue, mapOverCollection: isCollectionProperty, matchDepth: matchDepth};
//     }
//
//     var propertyNames = propertyPath.split(".");
//     var result = _.reduce(reductor, {data: candidate, matchDepth: -1}, propertyNames);
//     return {
//         values: result.data,
//         prematureMatchEndAtDepth: (result.matchDepth === (propertyNames.length-1))? false : result.matchDepth
//     };
// }

function mergeResolved(target, resolvedProperties) {
    if (Immutable.isImmutable && Immutable.isImmutable(target)) {
        return target.merge(resolvedProperties, { merger: ignoreNonValuesMerger });
    } else {
        const overrides =
            _.omitBy(resolvedProperties, (replacement, property) =>
                replacingValueWithNonValue(target[property], replacement));
        return _.assign(target, overrides);
    }
}

function replacingValueWithNonValue(value, replacement) {
    const replacingWithAnEmptyValue = _.isEmpty(replacement);
    const originalHasValue = !_.isEmpty(value);

    return originalHasValue && replacingWithAnEmptyValue;
}

/** seamless-immutable merger: obj.merge(obj2, {merger: <thisfn>}) */
function ignoreNonValuesMerger(value, replacement) {
    if (replacingValueWithNonValue(value, replacement)) {
        return value; // do not accept the replacement
    }
}

function merge(target, source) {
    if (Immutable.isImmutable && Immutable.isImmutable(target)) {
        return target.merge(source);
    }
    return _.assign(target, source);
}

function set(target, property, value) {
    if (Immutable.isImmutable && Immutable.isImmutable(target)) {
        return target.set(property, value);
    }
    target[property] = value;
    return target;
}

function pushToAuditPath(context, element, maybeCondition) {
    if (maybeCondition === false) { return; }

    const audit = context.audit;
    const newPath = audit.path.concat([element]);

    if (auditingDisabled) {
        // Only update the path
        context.audit.path = newPath; // New code => we know audit, path are mutable
    } else {
        context.audit = merge(audit, {
            path: newPath,
            report: audit.report.concat([{path: newPath, logs: []}])
        });
    }
}

function popAuditPath(context, maybeCondition) {
    if (maybeCondition === false) { return; }

    if (auditingDisabled) {
        // Only update the path
        context.audit.path = context.audit.path.slice(0, -1); // New code => we know audit, path are mutable
    } else {
        const audit = context.audit;
        context.audit = merge(audit, {
            path: audit.path.slice(0, -1)
        });
    }
}

function pushAuditReportAtCurrentPath(context, log) {
    if (auditingDisabled) { return; }
    const audit = context.audit;
    const currentReport = audit.report[audit.report.length - 1];

    // Assumption: the last entry is the current report
    if (currentReport.path !== audit.path) {
        throw new Error("Illegal state: the latest report's path " +
            currentReport.path + " doesn't match the current path " +
            audit.path);
    }

    context.audit = merge(audit, {
        report: audit.report.slice(0,-1).concat([
            merge(currentReport, {logs: currentReport.logs.concat([log])})
        ])
    });
}

function isDef(def) {
    return (def instanceof Dictionary) || (def instanceof List) || (def instanceof Template);
}

function defaultFor(def) {
    if (def instanceof List) return [];
    return {}; // Dict, Template
}

/** Strip any special properties and functions. */
function stripNonValueProperties(def) {
    // "inspect" is a fn we add in tests to make it work with console log
    return _.chain(def).omit("joins", "inspect", "_options").value();
}

function assertKeys(value, keys, msg, context) {
    const requiredKeys = keys.required || [];
    const optionalKeys = keys.optional || [];
    const allAllowedKeys = _.union(requiredKeys, optionalKeys);
    const actualKeys = _.keys(value);
    const missing = _.difference(requiredKeys, actualKeys);
    const invalid = _.difference(actualKeys, allAllowedKeys);

    if (missing.length > 0) {
        throw new Error("Missing required keys " +
            JSON.stringify(missing) + "; actual: " +
            JSON.stringify(actualKeys) + " " + (msg? msg : "") +
            maybePathInfo(context)
        );
    }
    if (invalid.length > 0) {
        throw new Error("Unsupported keys " +
            JSON.stringify(invalid) + "; supported: " +
            JSON.stringify(allAllowedKeys) + " " + (msg? msg : "") +
            maybePathInfo(context)
        );
    }
}

/** For troubleshooting */
function maybePathInfo(maybeContext) {
    if (!maybeContext) return "";
    return " AT " + maybeContext.audit.path.join(".");
}

function assert(check, msg, context) {
    if (!check) {
        throw new Error("Assertion failure: " + msg + maybePathInfo(context));
    }
    return check;
}

/** Transform the full audit, resolving lazy properties such as join mismatch details. */
export function stringifyAudit (audit) {
    return JSON.stringify(audit, function(key, value) {
        if (key === "details" && typeof value === "function") {
            return value();
        }
        if (key === "candidates") {
            return JSON.stringify(value); // w/o formatting
        }
        return value;
    }, 2);
}


