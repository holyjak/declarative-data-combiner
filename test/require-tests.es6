/**
 * Test that not only import but also require work as intended
 */
const { Combiner, Dictionary, List, Template } = require("../src/declarativeCombiner");

describe("combiner accessed via `require`", () => {

    describe("can be constructed and responds to combineAndResult", () => {

        it("using the explicitly exposed constructor", () => {
            expect(new Combiner()).to.be.instanceof(Combiner)
                .and.to.respondTo("combineAndResult");
        });

    });

    it("exposes the DSL", () => {
        // (We only test a few of them)
        expect(Dictionary).to.be.a("function");
        expect(List).to.be.a("function");
        expect(Template).to.be.a("function");
    });
});