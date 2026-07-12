"use strict";

const assert = require("assert");
const { ReferenceGuardTestHooks: hooks } = require("../src/ref-guard.js");

assert.deepStrictEqual(
  hooks.destinationPoint([{}, { name: "XYZ" }, 65.885, 436.478, null]),
  { x: 65.885, y: 436.478 },
  "keeps the exact PDF destination coordinates"
);

assert.deepStrictEqual(
  hooks.destinationPoint([{}, { name: "FitH" }, 700]),
  { x: null, y: 700 },
  "keeps horizontal-fit destination height"
);

assert.strictEqual(
  hooks.isReferenceDestination("cite.li2024evaluating"),
  true,
  "recognizes a native citation destination"
);

assert.strictEqual(
  hooks.isReferenceDestination("figure.caption.3"),
  false,
  "does not classify a figure destination as a reference"
);

assert.strictEqual(
  hooks.rectDistanceSquared(
    { x: 65, y: 436 },
    { left: 60, top: 430, right: 250, bottom: 445 }
  ),
  0,
  "selects a text item containing the exact destination point"
);

assert.strictEqual(
  hooks.rectDistanceSquared(
    { x: 50, y: 420 },
    { left: 60, top: 430, right: 250, bottom: 445 }
  ),
  200,
  "ranks nearby text items by PDF viewport distance"
);

assert.strictEqual(
  hooks.annotationLinkAtPoint([
    { dest: "cite.li", left: 231, top: 365, right: 308, bottom: 379 },
    { dest: "cite.zhang", left: 313, top: 365, right: 350, bottom: 379 }
  ], 240, 372).dest,
  "cite.li",
  "maps a page-local click directly to its pre-indexed PDF annotation"
);

assert.strictEqual(
  hooks.annotationLinkAtPoint([
    { dest: "cite.li", left: 231, top: 365, right: 308, bottom: 379 }
  ], 400, 372),
  null,
  "does not guess outside a native annotation bound"
);

console.log("reference-guard annotation overlay ok");
