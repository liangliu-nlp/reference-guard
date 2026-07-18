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
  hooks.isReferenceDestination("PAX@../../emnlp2025/main/papers/1436.pax@28"),
  false,
  "keeps opaque PDF destination names out of semantic reference classification"
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

const twoColumnAnchor = { x: 287.515, y: 340.68 };
const twoColumnItems = [
  {
    text: "quence generation is necessary to obtain a learning signal.",
    rect: { left: 55.4, top: 327.7, right: 287, bottom: 337.7 }
  },
  {
    text: "Austin, J., Odena, A., Nye, M., Bosma, M., Michalewski,",
    rect: { left: 307.4, top: 344.8, right: 542.7, bottom: 354.8 }
  }
];
const twoColumnTarget = twoColumnItems.reduce((best, item) => (
  hooks.destinationTextDistanceSquared(twoColumnAnchor, item.rect)
    < hooks.destinationTextDistanceSquared(twoColumnAnchor, best.rect) ? item : best
));

assert.strictEqual(
  twoColumnTarget.text,
  "Austin, J., Odena, A., Nye, M., Bosma, M., Michalewski,",
  "uses the destination's left edge to keep a right-column target out of the left column"
);

const firstReferenceAnchor = { x: 287.515, y: 166.804 };
const firstReferenceItems = [
  {
    text: "References",
    rect: { left: 307.44, top: 151.37, right: 362.98, bottom: 163.33 }
  },
  {
    text: "Albergo, M. S. and Vanden-Eijnden, E. Building normalizing flows",
    rect: { left: 307.44, top: 170.95, right: 543.09, bottom: 180.91 }
  }
];
const firstReferenceTarget = firstReferenceItems.reduce((best, item) => (
  hooks.destinationTextDistanceSquared(firstReferenceAnchor, item.rect)
    < hooks.destinationTextDistanceSquared(firstReferenceAnchor, best.rect) ? item : best
));

assert.strictEqual(
  firstReferenceTarget.text,
  "Albergo, M. S. and Vanden-Eijnden, E. Building normalizing flows",
  "selects the first reference start instead of the heading immediately above it"
);

assert.strictEqual(
  hooks.destinationTextDistanceSquared(
    { x: null, y: 436 },
    { left: 60, top: 430, right: 250, bottom: 445 }
  ),
  0,
  "preserves vertical-only matching for FitH destinations"
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

const decodedPoint = hooks.pageLocalPoint(
  { clientX: 520, clientY: 300 },
  { left: 300, top: 100 }
);
assert.deepStrictEqual(
  decodedPoint,
  { x: 220, y: 200 },
  "keeps pointer coordinates local to the PDF iframe page"
);
assert.strictEqual(
  hooks.annotationLinkAtPoint([
    { dest: "cite.wei2022", left: 15, top: 145, right: 80, bottom: 165 }
  ], decodedPoint.x, decodedPoint.y),
  null,
  "does not subtract an outer iframe offset and turn selected text into a citation hit"
);

const nativeView = { pointerDownPosition: { pageIndex: 2, rects: [[1, 2, 3, 4]] } };
assert.strictEqual(
  hooks.clearNativePointerDownPosition(nativeView),
  true,
  "allows the native pointerup handler to run without its competing navigation target"
);
assert.strictEqual(
  nativeView.pointerDownPosition,
  null,
  "clears only the current native pointer gesture"
);

const pointerState = {
  nativePointerUpSuppression: {
    dest: "PAX@../../emnlp2025/main/papers/1436.pax@28",
    pointerId: 7,
    expiresAt: 1000
  }
};
assert.strictEqual(
  hooks.takeNativePointerUpSuppression(pointerState, { pointerId: 8 }, 500),
  null,
  "does not consume another pointer's native navigation"
);
assert.deepStrictEqual(
  hooks.takeNativePointerUpSuppression(pointerState, { pointerId: 7 }, 500),
  { dest: "PAX@../../emnlp2025/main/papers/1436.pax@28", pointerId: 7, expiresAt: 1000 },
  "suppresses opaque internal destinations on the matching pointerup once"
);
assert.strictEqual(
  hooks.takeNativePointerUpSuppression(pointerState, { pointerId: 7 }, 500),
  null,
  "does not affect later pointer gestures"
);

console.log("reference-guard annotation overlay ok");
