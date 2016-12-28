'use strict';
const util = require("util");
const _ = require('lodash');
const Immutable = require('seamless-immutable//seamless-immutable.development');

import { Combiner, Dictionary, List, Template, Join, IfNoMatch, stringifyAudit /*Key, Property, JoinPredicates*/, ANCESTORS, PARENT } from "../src/declarativeCombiner";
const combiner = new Combiner();

// Individual tests can set this to true to get their audit printed - typically if they failed
let enableAuditing = false;

function combineAndResult(def, sourceElement, joins) {
    const combination = combiner.combine(def, _.cloneDeep(sourceElement), _.cloneDeep(joins), {enableAuditing: true});
    if (enableAuditing) {
        console.log("AUDIT", stringifyAudit(combination.auditReport));
    }
    return combination.result;
}

function combineAndReturnOnlyAudit(def, sourceElement, joins) {
    joins = joins || {};
    return combiner.combine(def, sourceElement, joins, {enableAuditing: true}).auditReport;
}

function myinspect(object, depth, opts) {
    return util.inspect(object, _.assign({}, opts, {depth: depth+1}));
}

Dictionary.prototype.inspect = function(depth, opts) {
  return 'Dictionary(' + this.key + " => " +
    this.value.inspect(depth++, opts) +
    (this.joins? (" JOINS: " + myinspect(this.joins, depth, opts)) : "") + ")";
};

Template.prototype.inspect = function(depth, opts) {
    const plainObj = Object.assign({}, _.chain(this).omit("joins", "inspect").value());
    const displayable = _.mapValues(plainObj, function(val) {
        if (val && (typeof val.inspect === "function")) {
            return val.inspect(depth++, opts);
        }
        return val;
    });
  return 'Template(' + myinspect(displayable, depth) + ")";
};

describe("declarativeCombiner", () => {

    const emptySourceElement = Immutable({});
    const emptyJoinSources = Immutable({});

    describe("audit", function() {
        it("adds report for each element, resets path", function() {
            const sourceElement = Immutable({
                "dummyId1": {}
            });
            const auditReport = combineAndReturnOnlyAudit(
                Dictionary({
                    key: "id",
                    value: Template({})
                }),
                sourceElement);
            expect(auditReport).to.eql([
                {path: ["<root>"], logs: ["Dictionary size=1"]},
                {path: ["<root>", "id=dummyId1"], logs: []}
            ]);
        });

        it("a complex example: a tree with more branches, deeper nesting, missing data in some branches", function() {
            const sourceElement = Immutable({
                "dummyId1": { nestedOne: { nestedTwoDict: { "nestedId1": {} } } },
                "dummyId2": { nestedOne: {} }
            });
            const auditReport = combineAndReturnOnlyAudit(
                Dictionary({
                    key: "id",
                    value: Template({
                        nestedOne: Template({
                            nestedTwoDict: Dictionary({
                                key: "nestedId",
                                value: Template({})
                            })
                        }),
                        simpleProp: "binding.value" // this should not influence the report
                    })
                }),
                sourceElement, {binding: null});
            expect(auditReport).to.eql([
                {path: ["<root>"], logs: ["Dictionary size=2"]},
                // Descend branch 1:
                {path: ["<root>", "id=dummyId1"], logs: []},
                {path: ["<root>", "id=dummyId1", "nestedOne"], logs: []},
                {path: ["<root>", "id=dummyId1", "nestedOne", "nestedTwoDict"], logs: []},
                {path: ["<root>", "id=dummyId1", "nestedOne", "nestedTwoDict", undefined], logs: ["Dictionary size=1"]},
                {path: ["<root>", "id=dummyId1", "nestedOne", "nestedTwoDict", undefined, "nestedId=nestedId1"], logs: []},
                // Descend branch 2, which doesn't have all the data:
                {path: ["<root>", "id=dummyId2"], logs: []},
                {path: ["<root>", "id=dummyId2", "nestedOne"], logs: []},
                // - we add missing objects so we descend to nestedTwoDict
                //   even though lacking from the sourceElement
                {path: ["<root>", "id=dummyId2", "nestedOne", "nestedTwoDict"], logs: []},
                {path: ["<root>", "id=dummyId2", "nestedOne", "nestedTwoDict", undefined], logs: ["Dictionary size=0"]}
            ]);
        });

        // xdescribe("proper reporting of join (mis)matches [with details on where in match prop chain]", function() {
        //
        //     var joinResults = {
        //         emptyBinding: "emptyBinding",
        //         noMatch: "noMatch",
        //         noMatchInvalidProperty: "noMatchInvalidProperty"
        //     };
        //
        //     function expectedJoinReport(join, joinResult) {
        //         if (joinResult === joinResults.emptyBinding) {
        //             return {message: "No match for join", join: join, cause: "Empty binding"};
        //         } if (joinResult === joinResults.noMatch) {
        //             return {
        //                 message: "No match for join", join: join, cause: "No match for the key in the binding",
        //                 details: {searchKey: "123", candidates: ["differentId"]}
        //             };
        //         } if (joinResult === joinResults.noMatchInvalidProperty) {
        //             return {
        //                 message: "No match for join", join: join, cause: "No match for the key in the binding",
        //                 details: {searchKey: "123", invalidPropertyPath: "The binding property path doesn't exist on any candidate element. Last found property at depth (0-based): 0"}
        //             };
        //         } else {
        //             throw new Error("Unsupported state " + joinResult);
        //         }
        //     }
        //
        //     var shipsSourceElement = {"123": {shipId: "123", name: "Enterprise"}};
        //
        //     function checkWith(config) {
        //         var auditReport = combineAndReturnOnlyAudit(
        //             Dictionary({
        //                 key: "shipId",
        //                 value: Template({shipType: "ship.x"}),
        //                 joins: [config.join]}),
        //             shipsSourceElement, config.bindings);
        //
        //         var pathLogs = _.find(auditReport, {path: ["shipId=123"]}).logs;
        //         expect(pathLogs).to.be.an("array").and.have.length(1);
        //
        //         var actualLog = _.mapValues(pathLogs[0], function(val) {
        //             return _.isFunction(val) ? val() : val;
        //         });
        //         expect(actualLog, "No match should be reported").to.eql(
        //             expectedJoinReport(config.join, config.joinResult));
        //     }
        //
        //     it("no join: an empty binding", function() {
        //         checkWith({
        //             joinResult: joinResults.emptyBinding,
        //             bindings: {fleet: null},
        //             join: { key: "fleet", on: "shipId", as: "ship"}});
        //     });
        //
        //     it("no join: no match on the property [on: 'propName']", function() {
        //         checkWith({
        //             joinResult: joinResults.noMatch,
        //             bindings: {fleet: [{shipId: "differentId", x: 7}]},
        //             join: { key: "fleet", on: "shipId", as: "ship"}});
        //     });
        //
        //     it("no join: no match on the property [on: [Key, Prop]]", function() {
        //         checkWith({
        //             joinResult: joinResults.noMatch,
        //             bindings: {fleet: {"differentId": {x: 7}}},
        //             join: { key: "fleet", on: [Key("shipId"), Property("shipId")], as: "ship"}});
        //     });
        //
        //     it("no join: no match on the property [on: [collProp, fn, keyProp]]", function() {
        //         checkWith({
        //             joinResult: joinResults.noMatch,
        //             bindings: {fleet: [{ships: [{id: "differentId"}]}]},
        //             join: { key: "fleet", on: ["ships[].id", JoinPredicates.includes, "shipId"], as: "ship"}});
        //     });
        //
        //     it("no join: no match on the property - invalid property [on: [collProp, fn, keyProp]]", function() {
        //         checkWith({
        //             joinResult: joinResults.noMatchInvalidProperty,
        //             bindings: {fleet: [{ships: [{notId: "differentId"}]}]},
        //             join: { key: "fleet", on: ["ships[].id", JoinPredicates.includes, "shipId"], as: "ship"}});
        //     });
        //
        // });

    });

    it("should return the input as-is if no joins", function() {
        const sourceElement = Immutable({
            "dummyGuid": {
                name: "dummy HW"
            }
        });
        const actual = combineAndResult(
            Dictionary({
                key: "guid",
                value: Template({})
            }),
            sourceElement,
            emptyJoinSources);
        expect(actual).to.eql(sourceElement);
    });

    it("don't override props by undefined join data (or empty arrays)", function() {
        const actual = combineAndResult(
            Template({prop: "ship.replacement", coll: "ship.replacementArray"}),
            {prop: "Original", coll: ["Original"]},
            {ship: {replacementArray: []}});
        expect(actual).to.eql({prop: "Original", coll: ["Original"]});
    });

    describe("`parent` and to `ancestors` bindings", () => {

        function storeAncestors(bindings) {
            ancestors = bindings[ANCESTORS];
            parent = bindings[PARENT];
            return "look into the ancestors and parent variables";
        }

        function getAncestorIdentificationAttributes(ancestor) {
            return _.pick(ancestor, ["key", "index", "name"]);
        }

        function getAncestorSubsets(bindings) {
            return bindings[ANCESTORS].map(getAncestorIdentificationAttributes);
        }

        function getParentSubset(bindings) {
            return bindings[PARENT] ?
                getAncestorIdentificationAttributes(bindings[PARENT]) : bindings[PARENT];
        }

        const emptyBindings = {};
        const storeAncestorsTemplate = Template({
            storeAncestors
        });
        let ancestors;
        let parent;

        beforeEach(() => {
            ancestors = null;
            parent = null;
        });

        it("should add the parent dictionary sourceElement to ancestors as `{key: the key}`", () => {
            const sourceElement = Immutable({
                "rootDictKey1": {}
            });
            combineAndResult(
                Dictionary({
                    key: "id",
                    value: storeAncestorsTemplate
                }),
                sourceElement, emptyBindings);
            expect(ancestors).to.deep.equal([
                {key: "rootDictKey1"}
            ]);
        });

        it("should add the parent list sourceElement to ancestors as `{index: the index}`", () => {
            const sourceElement = Immutable([{}]);
            combineAndResult(
                List({
                    value: storeAncestorsTemplate
                }),
                sourceElement, emptyBindings);
            expect(ancestors).to.deep.equal([
                {index: 0}
            ]);
        });

        it("should add the parent template sourceElement to ancestors", () => {
            const sourceElement = Immutable({ name: "parentElement", child: {}});
            combineAndResult(
                Template({
                    child: storeAncestorsTemplate
                }),
                sourceElement, emptyBindings);
            expect(ancestors).to.deep.equal([{
                name: "parentElement",
                child: {}
            }]);
        });

        it("should reset ancestors, parent when backtracking and descending into another branch", () => {
            const sourceElement = Immutable([
                { name: "first", child: { name: "first's child"} },
                { name: "second", child: { name: "second's child"} }
            ]);
            const result = combineAndResult(
                List({
                    value: Template({
                        child: Template({}),
                        ancestors: getAncestorSubsets,
                        parentSet: (bindings) => !!getParentSubset(bindings)
                    })
                }),
                sourceElement, emptyBindings);
            expect(result).to.deep.equal([
                {
                    name: "first",
                    child: { name: "first's child"},
                    ancestors: [{index: 0}],
                    parentSet: false
                },
                {
                    name: "second",
                    child: { name: "second's child"},
                    ancestors: [{index: 1}],
                    parentSet: false
                }
            ]);
        });

        it("complex example: should add all ancestor sourceElements to `ancestors`", () => {
            const sourceElement = Immutable({
                "dummyId1": { name: "rootDictEl1", nestedElementAtOne: { name: "nestedEl1",  nestedListAtTwo: [{ name: "leafEl1" }] } },
                "dummyId2": { name: "rootDictEl2", nestedElementAtOne: { name: "nestedEl2" } }
            });

            const result = combineAndResult(
                Dictionary({
                    key: "id",
                    value: Template({
                        ancestorSubsets: getAncestorSubsets,
                        parentSubset: getParentSubset,

                        nestedElementAtOne: Template({
                            ancestorSubsets: getAncestorSubsets,
                            parentSubset: getParentSubset,

                            nestedListAtTwo: List({
                                value: Template({
                                    ancestorSubsets: getAncestorSubsets,
                                    parentSubset: getParentSubset,
                                })
                            })
                        })
                    })
                }),
                sourceElement, emptyBindings);

            expect(result).to.containSubset({
                "dummyId1": {
                    name: "rootDictEl1",

                    ancestorSubsets: [{key: "dummyId1"}],
                    parentSubset: null,

                    nestedElementAtOne: {
                        name: "nestedEl1",

                        ancestorSubsets: [{key: "dummyId1"}, {name: "rootDictEl1"}],
                        parentSubset: {name: "rootDictEl1"},

                        nestedListAtTwo: [{
                            name: "leafEl1",

                            ancestorSubsets: [{key: "dummyId1"}, {name: "rootDictEl1"}, {index:0}],
                            parentSubset: null,
                        }]
                    }
                },
                "dummyId2": {
                    name: "rootDictEl2",

                    ancestorSubsets: [{key: "dummyId2"}],
                    parentSubset: null,

                    nestedElementAtOne: {
                        name: "nestedEl2",

                        ancestorSubsets: [{key: "dummyId2"}, {name: "rootDictEl2"}],
                        parentSubset: {name: "rootDictEl2"}
                    }
                }
            });
        });

        it("should set `parent` to the direct (non-dictionary) predcessor", () => {
            const sourceElement = Immutable({ name: "parentElement", child: {}});
            combineAndResult(
                Template({
                    child: storeAncestorsTemplate
                }),
                sourceElement, emptyBindings);
            expect(parent).containSubset({ name: "parentElement" });
        });

        it("should unset `parent` if the direct predcessor is a dictionary", () => {
            const sourceElement = Immutable({
                name: "parentElement",
                childDict: {
                    "firstDictEntry": {}
                }
            });
            combineAndResult(
                Template({
                    childDict: Dictionary({
                        key: "entryId",
                        value: storeAncestorsTemplate
                    })
                }),
                sourceElement, emptyBindings);
            expect(parent).to.equal(null);
        });

    });

    describe("(mutable x immutable source data)", () => {

        it("should work on mutable data", () => {
            const mutableData = [{ id: 123, name: "Vesp" }];
            const actual = combiner.combine(
                List({ value: Template({shipSpeed: "shipSpeed"}) }),
                mutableData,
                { shipSpeed: "awesome" }).result;
            const expected = [{ id: 123, name: "Vesp", shipSpeed: "awesome"}];
            expect(actual).to.deep.equal(expected);
        });

        it("should work on IMmutable data", () => {
            const immutableData = Immutable([{ id: 123, name: "Vesp" }]);
            const actual = combiner.combine(
                List({ value: Template({shipSpeed: "shipSpeed"}) }),
                immutableData,
                { shipSpeed: "awesome" }).result;
            const expected = [{ id: 123, name: "Vesp", shipSpeed: "awesome"}];
            expect(actual).to.deep.equal(expected);
        });

        it("should work on IMmutable data nested within mutable data", () => {
            const mutableDataWithImmutableContent = [Immutable({ id: 123, name: "Vesp" })];
            const actual = combiner.combine(
                List({ value: Template({shipSpeed: "shipSpeed"}) }),
                mutableDataWithImmutableContent,
                { shipSpeed: "awesome" }).result;
            const expected = [{ id: 123, name: "Vesp", shipSpeed: "awesome"}];
            expect(actual).to.deep.equal(expected);
        });

        it("should work on IMmutable data nested within mutable data (Dict)", () => {
            const mutableDataWithImmutableContent = { first: Immutable({ id: 123, name: "Vesp" })};
            const actual = combiner.combine(
                Dictionary({ value: Template({shipSpeed: "shipSpeed"}) }),
                mutableDataWithImmutableContent,
                { shipSpeed: "awesome" }).result;
            const expected = { first: { id: 123, name: "Vesp", shipSpeed: "awesome"} };
            expect(actual).to.deep.equal(expected);
        });

    });

    describe("List", () => {

        it("should be combined with the joins", function() {
            const bindings = { shipColors: { 123: "star blue" }};
            const shipsList = [{ id: 123, name: "Vesp" }];
            const actual = combineAndResult(
                List({
                    joins: [Join({
                        key: "shipColors",
                        as: "color",
                        fn: (shipColors, ship) => shipColors[ship.id]
                    })],
                    value: Template({shipColor: "color"})
                }),
                shipsList,
                bindings);
            const expected = [{ id: 123, name: "Vesp", shipColor: "star blue"}];
            expect(actual).to.deep.equal(expected);
        });

    });

    describe("Dictionary", () => {

        describe("valueFilter", () => {
            it("should only transform dictionary values matching the given valueFilter", function() {
                const actual = combineAndResult(
                    Dictionary({
                        value: Template({fleetName: "fleetName"}),
                        valueFilter: {shipType: "Cruiser"},
                    }),
                    {a: {shipType: "Cruiser"}, b: {shipType: "Explorer"}},
                    { fleetName: "Rapid Fleet"});
                const expected = {a: {shipType: "Cruiser", fleetName: "Rapid Fleet"}, b: {shipType: "Explorer"}};
                expect(actual).to.eql(expected);
            });
        });

        describe("joins", function() {

            const shipsSourceElement = {"123": {shipId: "123", name: "Enterprise"}};
                            fn: _.identity

            it("a simple join with an array join source", function() {
                const fleetJoinSource = [{shipId: "123", type: "Explorer"}];
                const actual = combineAndResult(
                    Dictionary({
                        value: Template({shipType: "ship.type"}),
                        joins: [Join({ key: "fleet", on: "shipId", as: "ship", fn: (fleet, v) => _.find(fleet, {shipId: v.shipId}) })]}),
                    shipsSourceElement,
                    { fleet: fleetJoinSource});
                const expected = {"123": {shipId: "123", name: "Enterprise", shipType: "Explorer"}};
                expect(actual).to.eql(expected);
            });

            it("an exception in a join fn should not crash the whole combination process", function() {
                const actual = combineAndResult(
                    Dictionary({
                        value: Template({shipType: "ship.type"}),
                        joins: [Join({ key: "fleet", on: "shipId", as: "ship", fn: () => {throw new Error("fake err");} })]}),
                    shipsSourceElement,
                    { fleet: []});
                const expected = {"123": {shipId: "123", name: "Enterprise", shipType: undefined}};
                expect(actual).to.eql(expected);
            });

            it("a simple join with a dictionary join source", function() {
                const fleetJoinSource = { "123": {shipId: "123", type: "Explorer"} };
                const actual = combineAndResult(
                    Dictionary({
                        value: Template({shipType: "ship.type"}),
                        joins: [Join({ key: "fleet", on: "shipId", as: "ship", fn: (fleet, v) => _.find(fleet, {shipId: v.shipId}) })]}),
                    shipsSourceElement,
                    { fleet: fleetJoinSource });
                const expected = {"123": {shipId: "123", name: "Enterprise", shipType: "Explorer"}};
                expect(actual).to.eql(expected);
            });

            it("should fail if the requested join source not in context", function() {
                const def = Dictionary({
                    joins: [Join({
                        key: "missingJoinDataKey",
                        on: "dummy",
                        as: "_",
                        fn: () => "ignored"
                    })],
                    value: Template({})
                });
                expect(function() { combineAndResult(def, {x: {}}, emptyJoinSources); }, "Should fail due to missing context data")
                    .to.throw(/missingJoinDataKey/);
            });

            describe("if join matched nothing", () => {

                function makeDefinitionWithIfNoMatch(ifNoMatch) {
                    return Dictionary({
                        value: Template({shipType: "noSuchShip.type", location: "definedLocation"}),
                        joins: [
                            Join({ ifNoMatch,
                                key: "fleet", on: "shipId", as: "noSuchShip",
                                fn: (fleet, v) => _.find(fleet, {shipId: v.shipId})
                            }), Join({
                                key: "location",
                                as: "definedLocation",
                                fn: _.identity
                            })
                        ]});
                }
                const sourceElements = Immutable({"123": {name: "Enterprise"}});
                const bindings = Immutable({ fleet: {}, location: "Mars" });

                it("then ifNoMatch=skip takes priority over process", () => {
                    const actual = combineAndResult(
                        Dictionary({
                            value: Template({location: "location", n1: "none1", n2: "none2"}),
                            joins: [
                                Join({ key: "src1", as: "none1", ifNoMatch: IfNoMatch.PROCESS, fn: () => undefined }),
                                Join({ key: "src2", as: "none2", ifNoMatch: IfNoMatch.SKIP, fn: () => undefined })
                            ]}),
                        {"123": {name: "Enterprise"}},
                        { src1: {}, src2: {}, location: "Mars"});
                    const expected = {"123": {name: "Enterprise"}};
                    expect(actual, "No template properties (location, n1, n2) should be added")
                        .to.deep.equal(expected);
                });

                it("then ifNoMatch=fn is called with (binding with the key, sourceElement, sourceElementKey, bindings)", () => {
                    let output = null;
                    combineAndResult(
                        Dictionary({
                            value: Template({}),
                            joins: [Join({
                                key: "fleet", as: "_",
                                ifNoMatch: (fleet, ship, shipId, bindings) => {
                                    output = `The ship ${ship.name} (#${shipId}) isn't in the fleet ${fleet.name} (updated: ${bindings.updated})`;
                                    return IfNoMatch.SKIP;
                                },
                                fn: () => undefined })]}),
                        {"123": {name: "Enterprise"}},
                        { fleet: {name: "5th Deep Space"}, updated: "today"});
                    expect(output).to.equal("The ship Enterprise (#123) isn't in the fleet 5th Deep Space (updated: today)");
                });

                [true, false].forEach(literal => {
                    it(`and ifNoMatch=skip (${literal? "literal" : "fn"}) then no template properties are added`, () => {
                        const actual = combineAndResult(
                            makeDefinitionWithIfNoMatch(literal ? IfNoMatch.SKIP : (() => IfNoMatch.SKIP)),
                            sourceElements, bindings);
                        const expected = {"123": {name: "Enterprise"}};
                        expect(actual, "No template properties (location, shipType) should be added")
                            .to.deep.equal(expected);
                    });

                    it(`and ifNoMatch=process (${literal? "literal" : "fn"}) then all template properties are added, the non-joined being undefined`, () => {
                        const actual = combineAndResult(
                            makeDefinitionWithIfNoMatch(literal ? IfNoMatch.PROCESS : (() => IfNoMatch.PROCESS)),
                            sourceElements, bindings);
                        const expected = {"123": {
                            name: "Enterprise",
                            shipType: undefined,
                            location: "Mars"}};
                        expect(actual, "Template properties are added with `undefined` for those not matched")
                            .to.deep.equal(expected);
                    });

                    it(`and ifNoMatch=remove (${literal? "literal" : "fn"}) then the element is removed from the result`, () => {
                        const actual = combineAndResult(
                            makeDefinitionWithIfNoMatch(literal ? IfNoMatch.REMOVE : (() => IfNoMatch.REMOVE)),
                            sourceElements, bindings);
                        expect(actual, "Should have removed the element")
                            .to.be.empty;
                    });

                    it(`and ifNoMatch=remove (${literal? "literal" : "fn"}) then no following joins are attempted`, () => {
                        const ifNoMatch = literal ? IfNoMatch.REMOVE : (() => IfNoMatch.REMOVE);
                        const nextJoinFn = sinon.spy();
                        const def = Dictionary({
                            joins: [
                                Join({ ifNoMatch,
                                    key: "fleet", on: "shipId", as: "noSuchShip",
                                    fn: () => undefined
                                }), Join({
                                    key: "ignoredJoin",
                                    as: "ignoredJoinElement",
                                    fn: nextJoinFn
                                })
                            ],
                            value: Template({})
                        });
                        const bindings = Immutable({ fleet: {}, ignoredJoin: {} });

                        combineAndResult(def, sourceElements, bindings);

                        expect(nextJoinFn, "The join fn should not have been called for the join should have been skipped")
                            .to.not.have.been.called;
                    });

                    it(`and ifNoMatch=skip (${literal? "literal" : "fn"}) then no following joins are attempted`, () => {
                        const ifNoMatch = literal ? IfNoMatch.SKIP : (() => IfNoMatch.SKIP);
                        const nextJoinFn = sinon.spy();
                        const def = Dictionary({
                            joins: [
                                Join({ ifNoMatch,
                                    key: "fleet", on: "shipId", as: "noSuchShip",
                                    fn: () => undefined
                                }), Join({
                                    key: "ignoredJoin",
                                    as: "ignoredJoinElement",
                                    fn: nextJoinFn
                                })
                            ],
                            value: Template({})
                        });
                        const joins = Immutable({ fleet: {}, ignoredJoin: {} });

                        combineAndResult(def, sourceElements, joins);

                        expect(nextJoinFn, "The join fn should not have been called for the join should have been skipped")
                            .to.not.have.been.called;
                    });

                });
            });

            it("should descend nested dictionary/template and sourceElement in sync", function() {
                const def = Template({
                    shipsDict: Dictionary({
                        key: "shipId",
                        value: Template({dummy: "dummy.value"})
                    })
                });
                const sourceElement = {
                    anotherProp: "hi",
                    shipsDict: {
                        "123": {
                            name: "Enterprise"
                        }
                    }
                };
                const actual = combineAndResult(def, sourceElement, {dummy: {value: "dummyVal"}});
                expect(actual).to.eql({
                    anotherProp: "hi",
                    shipsDict: {
                        "123": {
                            name: "Enterprise",
                            dummy: "dummyVal"}}});
            });

            xit("Skip processing if sourceElement doesn't have the expected data [DISABLED - OUTDATED LOGIC?]", function() {
                const def = Template({
                    shipsDict: Dictionary({
                        key: "shipId",
                        value: Template({dummy: "dummy.value"})
                    })
                });
                const sourceElement = { name: "elm w/o shipsDict"};
                const actual = combineAndResult(def, sourceElement, {dummy: {value: "dummyVal"}});
                expect(actual).to.eql(sourceElement);
            });

            it("a [Key('idProperty'), Property('idProperty')] join", function() {
                const actual = combineAndResult(
                    Dictionary({
                        value: Template({maxLoad: "specs.maxLoad"}),
                        joins: [Join({
                            key: "shipSpecsLookup",
                            //on: [Key("shipId"), Property("shipId")],
                            as: "specs",
                            fn: (shipSpecsLookup, v) => shipSpecsLookup[v.shipId]
                        })]}),
                    shipsSourceElement,
                    { shipSpecsLookup: { "123": {maxLoad: "1024"} } });
                const expected = {"123": {shipId: "123", name: "Enterprise", maxLoad: "1024"}};
                expect(actual).to.eql(expected);
            });

            it("a join may contain a `selector` to get a subset of the data", function() {
                const actual = combineAndResult(
                    Dictionary({
                        value: Template({squadronRole: "member.role"}),
                        joins: [Join({
                            key: "squadron",
                            selector: "members",
                            on: "shipId",
                            as: "member",
                            fn: (squadron, v) => _.find(squadron.members, {shipId: v.shipId} )
                        })]}),
                    shipsSourceElement,
                    { squadron: { members: [{shipId: "123", role: "carrier"}] } });
                const expected = {"123": {shipId: "123", name: "Enterprise", squadronRole: "carrier"}};
                expect(actual).to.eql(expected);
            });

            xdescribe("An 'id included in a collection' join ([aCollectionProp, .includes, 'anIdProp'])", function() {

                function checkWithSquadronShips(joinSourceMatchData, joinSourceMatchProperty, fullJoin) {
                    var actual = combineAndResult(
                        Dictionary({
                            value: Template({squadronName: "squadron.name"}),
                            joins: [{
                                key: "squadrons",
                                on: (fullJoin? joinSourceMatchProperty : [joinSourceMatchProperty, JoinPredicates.includes, "shipId"]),
                                as: "squadron"
                            }]}),
                        shipsSourceElement,
                        { squadrons: [{name: "Omega Squadron", ships: joinSourceMatchData}]});
                    var expected = {"123": {shipId: "123", name: "Enterprise", squadronName: "Omega Squadron"}};
                    expect(actual).to.eql(expected);
                }

                it("where aCollectionProp = 'anArrayProp[]'", function() {
                    checkWithSquadronShips(["123"], "ships");
                });

                it("where aCollectionProp = 'anArrayProp[].nestedId'", function() {
                    checkWithSquadronShips([{id: "123"}], "ships[].id");
                });

                it("where aCollectionProp = 'aDictionaryProp[].nestedId'", function() {
                    checkWithSquadronShips({"123": {id: "123"}}, "ships[].id");
                });

                it("where aCollectionProp returns a dictionary to check for the value", function() {
                    checkWithSquadronShips({"123": {otherProps:"..."}}, ["ships", JoinPredicates.has, "shipId"], true);
                });
            });

        });

    });

    describe("Template", () => {

        describe("properties", () => {

            it("should replace a string Template property with the value from a join", function() {
                const actual = combineAndResult(
                    Template({name: "ship.name"}),
                    emptySourceElement,
                    {ship: {name: "Enterprise"}});
                expect(actual).to.eql({name: "Enterprise"});
            });

            it("if a Template property value is a fn, replace it with its result", function() {
                const actual = combineAndResult(
                    Template({
                        fullName: function(context, sourceElement) {
                            return context.ship.name.toUpperCase() + " " + sourceElement.class;
                        }
                    }),
                    {class: "Ambassador"},
                    {ship: {name: "Enterprise"}});
                expect(actual).to.have.property("fullName", "ENTERPRISE Ambassador");
            });

            it("if a Template property value is a fn and fails, it should not crash the whole combination process", function() {
                const actual = combineAndResult(
                    Template({
                        fullName: function(context, sourceElement) {
                            throw new Error("fake error");
                        }
                    }),
                    {},
                    {});
                expect(actual).to.deep.equal({fullName: undefined});
            });

            it("if a Template property value may be an object with {source, default}", function() {
                const templateWithDefault = Template({
                    shipName: { source: "ship.name", default: "N/A"}
                });
                const actual = combineAndResult(
                    templateWithDefault,
                    {},
                    {ship: {}});
                expect(actual, "should use the default value if not present")
                    .to.have.property("shipName", "N/A");

                const actualWithMatch = combineAndResult(
                    templateWithDefault,
                    {},
                    {ship: {name: "Enterprise"}});
                expect(actualWithMatch, "use the matched value if present")
                    .to.have.property("shipName", "Enterprise");
            });
        });

        describe("options", () => {

            it("should replace the whole original object with the Template's output if the template option replace is true", () => {
                const nonEmptySourceElement = { initialProperty: "here"};
                const actual = combineAndResult(
                    Template({ addedProperty: "value"}, {replace: true}),
                    nonEmptySourceElement,
                    { value: "I have been added"});
                expect(actual).to.deep.equal({ addedProperty: "I have been added" });
            });

        });

    });

});
