const assert = require("assert");
const { ReferenceGuardHeuristics: h, ReferenceGuardTestHooks: hooks } = require("../src/ref-guard");

assert.strictEqual(
  h.shouldBlock("1", "L(theta) = 1 / N sum_n log p_theta(y_n | x_n)"),
  true,
  "blocks isolated formula number"
);

assert.strictEqual(
  h.shouldBlock("(3)", "E = mc^2 (3) where theta = 0"),
  true,
  "blocks equation-number-shaped hit in math"
);

assert.strictEqual(
  h.shouldBlock("[12]", "The model follows prior work [12]."),
  false,
  "keeps bracketed numeric references"
);

assert.strictEqual(
  h.shouldBlock("6", "limited by sparse, terminal supervision [6, 15]. When the reward is binary"),
  false,
  "keeps bare numeric clicks inside bracketed references"
);

assert.strictEqual(
  h.shouldBlock("(Smith, 2020)", "This follows (Smith, 2020)."),
  false,
  "keeps author-year references"
);

assert.strictEqual(
  h.shouldBlock("1", "Section 1 explains the dataset."),
  false,
  "keeps ordinary prose numbers"
);

assert.strictEqual(
  h.isReferenceTrigger("3", "This follows prior work 3 and later studies."),
  true,
  "treats bare numeric links in citation prose as reference triggers"
);

assert.strictEqual(
  h.isReferenceTrigger("1", "L(theta) = 1 / N sum_n log p_theta(y_n | x_n)"),
  false,
  "does not treat formula hits as reference triggers"
);

assert.deepStrictEqual(
  h.parseReferenceTriggers("", "the KV cache (Hooper et al., 2024). Even when"),
  [{ type: "author-year", author: "Hooper", year: "2024", label: "Hooper et al., 2024)" }],
  "parses split author-year citation context"
);

assert.deepStrictEqual(
  h.parseReferenceTriggers("Smith (2020)", "This follows Smith (2020)."),
  [{ type: "author-year", author: "Smith", year: "2020", label: "Smith (2020)" }],
  "parses parenthesized author-year citation"
);

assert.deepStrictEqual(
  h.parseReferenceTriggers("(Smith, 2020)", "This follows (Smith, 2020)."),
  [{ type: "author-year", author: "Smith", year: "2020", label: "Smith, 2020" }],
  "parses comma author-year citation"
);

assert.deepStrictEqual(
  h.parseReferenceTriggers("Hooper et al.,", "the growth of the KV cache (Hooper et al.,"),
  [{ type: "author-year", author: "Hooper", year: "", label: "Hooper et al.," }],
  "parses split author-year citation prefix"
);

assert.deepStrictEqual(
  h.parseReferenceTriggers("[12]", "The model follows prior work [12]."),
  [{ type: "number", number: "12", label: "[12]" }],
  "parses bracketed numeric reference"
);

assert.deepStrictEqual(
  h.parseReferenceTriggers("6", "limited by sparse, terminal supervision [6, 15]. When the reward is binary"),
  [{ type: "number", number: "6", label: "[6, 15]" }, { type: "number", number: "15", label: "[6, 15]" }],
  "parses bare numeric clicks inside bracketed references"
);

assert.strictEqual(
  h.shouldBlock("8", "the actor f(x) = y uses predefined correction instructions [ 8 ] to improve feedback"),
  false,
  "keeps spaced bracketed numeric citations even in math-like context"
);

assert.deepStrictEqual(
  h.parseReferenceTriggers("1", "L(theta) = 1 / N sum_n log p_theta(y_n | x_n)"),
  [],
  "does not parse formula numbers"
);

assert.deepStrictEqual(
  h.parseReferenceTriggers("information distributed across long contexts (Liu et al., 2024b; An et al., 2025).", ""),
  [
    { type: "author-year", author: "Liu", year: "2024", label: "Liu et al., 2024b", suffix: "b" },
    { type: "author-year", author: "An", year: "2025", label: "An et al., 2025)" }
  ],
  "keeps author-year suffixes such as 2024b"
);

assert.deepStrictEqual(
  h.citationCandidates("information distributed across long contexts (Liu et al., 2024b; An et al., 2025).").map((candidate) => ({
    text: candidate.text,
    refs: candidate.refs
  })),
  [
    {
      text: "Liu et al., 2024b",
      refs: [{ type: "author-year", author: "Liu", year: "2024", label: "Liu et al., 2024b", suffix: "b" }]
    },
    {
      text: "An et al., 2025)",
      refs: [{ type: "author-year", author: "An", year: "2025", label: "An et al., 2025)" }]
    }
  ],
  "extracts point-level author-year citation candidates"
);

assert.deepStrictEqual(
  h.citationCandidates("limited by sparse supervision [6, 15].")[0].refs,
  [{ type: "number", number: "6", label: "[6, 15]" }, { type: "number", number: "15", label: "[6, 15]" }],
  "extracts point-level numeric citation groups"
);

assert.deepStrictEqual(
  h.citationCandidates("limited by sparse supervision [6, 15].")[0].parts.map((part) => ({
    text: part.text,
    number: part.ref.number
  })),
  [{ text: "6", number: "6" }, { text: "15", number: "15" }],
  "keeps independent click ranges for each numeric citation"
);

let exactClickRefs = [{ type: "author-year", author: "Guo", year: "2025", label: "Guo et al., 2025" }];

assert.deepStrictEqual(
  hooks.clickReferences({ rejected: false, refs: exactClickRefs }),
  exactClickRefs,
  "uses exact point-level citation hits"
);

assert.deepStrictEqual(
  hooks.clickReferences(null),
  [],
  "does not infer references from a whole clicked text line"
);

assert.deepStrictEqual(
  hooks.clickReferences({ rejected: true, refs: [] }),
  [],
  "does not jump when the click is near but outside a citation"
);

assert.strictEqual(
  hooks.isClearlyNonReferenceDestination("figure.1"),
  true,
  "skips clearly non-reference PDF destinations"
);

assert.strictEqual(
  hooks.isClearlyNonReferenceDestination("bib.bib10"),
  false,
  "keeps bibliography-like PDF destinations"
);

assert.strictEqual(
  hooks.shouldUseLandingFallback("cite.Kamoi2024WhenCL"),
  true,
  "allows landing fallback for explicit citation destinations"
);

assert.strictEqual(
  hooks.shouldUseLandingFallback("bib.bib10"),
  true,
  "allows landing fallback for bibliography destinations"
);

assert.strictEqual(
  hooks.shouldUseLandingFallback(null),
  false,
  "does not guess landing highlights without a destination"
);

assert.strictEqual(
  hooks.shouldUseLandingFallback("figure.1"),
  false,
  "does not guess landing highlights for non-reference destinations"
);

assert.deepStrictEqual(
  hooks.destinationPoint([{}, { name: "XYZ" }, 72, 640, null]),
  { x: 72, y: 640 },
  "extracts an exact PDF anchor from XYZ destinations"
);

assert.deepStrictEqual(
  hooks.destinationPoint([{}, { name: "FitH" }, 700]),
  { x: null, y: 700 },
  "extracts the vertical anchor from FitH destinations"
);

assert.strictEqual(
  hooks.nativeDestinationContradictsRef(
    "cite.hendrycks2021math",
    { type: "author-year", author: "Yu", year: "2024", label: "Yu et al., 2024)" }
  ),
  true,
  "detects a native destination that contradicts a fuzzy author-year hit"
);

assert.strictEqual(
  hooks.nativeDestinationContradictsRef(
    "cite.yu2025dapoopensourcellmreinforcement",
    { type: "author-year", author: "Yu", year: "2025", label: "Yu et al., 2025" }
  ),
  false,
  "keeps matching author-year native destinations"
);

assert.strictEqual(
  hooks.nativeDestinationContradictsRef(
    "bib.bib10",
    { type: "author-year", author: "Yu", year: "2024", label: "Yu et al., 2024)" }
  ),
  false,
  "does not reject opaque bibliography destinations without a conflicting year"
);

assert.strictEqual(
  hooks.visibleLinesLookLikeReferences([
    { text: "lizing a large teacher model's thoughts to supervise and correct both the reasoning and reflection processes." },
    { text: "As depicted in Figure 1, in the first stage we design a cross-model teacher-student workflow." },
    { text: "Prior work such as Reflexion (Shinn et al., 2024) studies verbal reinforcement learning." }
  ]),
  false,
  "does not treat a body page with one visible citation as a references page"
);

assert.strictEqual(
  hooks.visibleLinesLookLikeReferences([
    { text: "References" },
    { text: "Noah Shinn, Federico Cassano, Ashwin Gopinath, Karthik Narasimhan, and Shunyu Yao." }
  ]),
  true,
  "recognizes an explicit references heading"
);

assert.strictEqual(
  hooks.visibleLinesLookLikeReferences([
    { text: "Noah Shinn, Federico Cassano, Ashwin Gopinath, Karthik Narasimhan, and Shunyu Yao." },
    { text: "Reflexion: Language agents with verbal reinforcement learning. NeurIPS, 2024." },
    { text: "Zhihong Shao, Peiyi Wang, Qihao Zhu, Runxin Xu, Junxiao Song, and Mingchuan Zhang." },
    { text: "Deepseek-r1: Incentivizing reasoning capability in llms via reinforcement learning, 2025." },
    { text: "Long Ouyang, Jeff Wu, Xu Jiang, Diogo Almeida, Carroll L. Wainwright, and Pamela Mishkin." }
  ]),
  true,
  "recognizes dense author-list reference pages without a visible heading"
);

let fuzzyUniqueHit = hooks.nearestUnambiguousHit([
  {
    distance: 9,
    candidate: { text: "[29]", refs: [{ type: "number", number: "29", label: "[29]" }] }
  }
]);

assert.deepStrictEqual(
  fuzzyUniqueHit.candidate.refs,
  [{ type: "number", number: "29", label: "[29]" }],
  "accepts one nearby fuzzy citation candidate"
);

assert.strictEqual(
  hooks.nearestUnambiguousHit([
    { distance: 8, candidate: { text: "[20]" } },
    { distance: 14, candidate: { text: "[44]" } }
  ]),
  null,
  "keeps ambiguous nearby citation candidates rejected"
);

assert.deepStrictEqual(
  hooks.passiveCandidateReferences("commonsense reasoning [47], mathematical reasoning [23], code generation [7], CoT [61].").map((ref) => ref.number),
  ["47", "23", "7", "61"],
  "keeps all numeric page-level citation hints instead of only the first one"
);

let onlyPassiveRef = [{ type: "author-year", author: "Liu", year: "2025", label: "Liu et al., 2025" }];

assert.deepStrictEqual(
  hooks.pageChangeHighlightReferences(onlyPassiveRef),
  onlyPassiveRef,
  "allows passive page-change highlighting for one unique nearby citation"
);

assert.deepStrictEqual(
  hooks.pageChangeHighlightReferences([
    { type: "author-year", author: "Liu", year: "2025", label: "Liu et al., 2025" },
    { type: "author-year", author: "Zhou", year: "2025", label: "Zhou et al., 2025" }
  ]),
  [],
  "blocks passive page-change highlighting when nearby citation hints are ambiguous"
);

function visibleLine(text, top, left = 56, right = 1000) {
  return { text, rect: { top, bottom: top + 14, left, right, width: right - left, height: 14 } };
}

let landingGroup = hooks.visibleReferenceEntryGroup([
  visibleLine("[59] Alex Wang, Kyunghyun Cho, and Mike Lewis. Asking and answering questions.", 430),
  visibleLine("factual consistency of summaries. arXiv preprint arXiv:2004.04228, 2020.", 456, 66),
  visibleLine("[60] Yifei Wang, Yuyang Wu, Zeming Wei, Stefanie Jegelka, and Yisen Wang.", 510),
  visibleLine("understanding of self-correction through in-context alignment.", 536, 66),
  visibleLine("[61] Jason Wei, Xuezhi Wang, Dale Schuurmans, Maarten Bosma, Fei Xia, Ed Chi, Quoc V Le,", 620),
  visibleLine("Denny Zhou, et al. Chain-of-thought prompting elicits reasoning in large language models.", 646, 66),
  visibleLine("Advances in neural information processing systems, 35:24824-24837, 2022.", 672, 66),
  visibleLine("[62] Lai Wei, Yuting Li, Chen Wang, Yue Wang, Linghe Kong, Weiran Huang, and Lichao Sun.", 738)
], 626);

assert.deepStrictEqual(
  landingGroup.map((line) => line.text),
  [
    "[61] Jason Wei, Xuezhi Wang, Dale Schuurmans, Maarten Bosma, Fei Xia, Ed Chi, Quoc V Le,",
    "Denny Zhou, et al. Chain-of-thought prompting elicits reasoning in large language models.",
    "Advances in neural information processing systems, 35:24824-24837, 2022."
  ],
  "landing fallback picks the visible reference entry nearest the jump landing band"
);

let splitLabelLandingGroup = hooks.visibleReferenceEntryGroup([
  visibleLine("[60]", 510, 56, 94),
  visibleLine("Yifei Wang, Yuyang Wu, Zeming Wei, Stefanie Jegelka, and Yisen Wang.", 510, 106),
  visibleLine("understanding of self-correction through in-context alignment.", 536, 106),
  visibleLine("[61]", 620, 56, 94),
  visibleLine("Jason Wei, Xuezhi Wang, Dale Schuurmans, Maarten Bosma, Fei Xia, Ed Chi, Quoc V Le,", 620, 106),
  visibleLine("Denny Zhou, et al. Chain-of-thought prompting elicits reasoning in large language models.", 646, 106),
  visibleLine("Advances in neural information processing systems, 35:24824-24837, 2022.", 672, 106),
  visibleLine("[62]", 738, 56, 94),
  visibleLine("Lai Wei, Yuting Li, Chen Wang, Yue Wang, Linghe Kong, Weiran Huang, and Lichao Sun.", 738, 106)
], 626);

assert.deepStrictEqual(
  splitLabelLandingGroup.map((line) => line.text),
  [
    "[61]",
    "Jason Wei, Xuezhi Wang, Dale Schuurmans, Maarten Bosma, Fei Xia, Ed Chi, Quoc V Le,",
    "Denny Zhou, et al. Chain-of-thought prompting elicits reasoning in large language models.",
    "Advances in neural information processing systems, 35:24824-24837, 2022."
  ],
  "landing fallback keeps split numeric labels attached to their reference entry"
);

function fakeVisibleWin(lines) {
  let page = {};
  let spans = lines.map((line) => ({
    textContent: line.text,
    parentElement: page,
    getBoundingClientRect() {
      return line.rect;
    }
  }));
  return {
    innerHeight: 900,
    innerWidth: 1200,
    document: {
      querySelectorAll() {
        return spans;
      }
    }
  };
}

let visibleBoundedGroup = hooks.visibleReferenceGroup(fakeVisibleWin([
  visibleLine("[61] Jason Wei, Xuezhi Wang, Dale Schuurmans, Maarten Bosma.", 620),
  visibleLine("Chain-of-thought prompting elicits reasoning in large language models.", 646, 66),
  visibleLine("[62] Lai Wei, Yuting Li, Chen Wang, Yue Wang.", 738)
]), { type: "number", number: "61", label: "[61]" });

assert.deepStrictEqual(
  visibleBoundedGroup.map((line) => line.text),
  [
    "[61] Jason Wei, Xuezhi Wang, Dale Schuurmans, Maarten Bosma.",
    "Chain-of-thought prompting elicits reasoning in large language models."
  ],
  "visible exact-reference highlighting stops at the next reference entry"
);

let visibleSplitLabelGroup = hooks.visibleReferenceGroup(fakeVisibleWin([
  visibleLine("[61]", 620, 56, 94),
  visibleLine("Jason Wei, Xuezhi Wang, Dale Schuurmans, Maarten Bosma.", 620, 106),
  visibleLine("Chain-of-thought prompting elicits reasoning in large language models.", 646, 106),
  visibleLine("[62]", 738, 56, 94),
  visibleLine("Lai Wei, Yuting Li, Chen Wang, Yue Wang.", 738, 106)
]), { type: "number", number: "61", label: "[61]" });

assert.deepStrictEqual(
  visibleSplitLabelGroup.map((line) => line.text),
  [
    "[61]",
    "Jason Wei, Xuezhi Wang, Dale Schuurmans, Maarten Bosma.",
    "Chain-of-thought prompting elicits reasoning in large language models."
  ],
  "visible exact-reference highlighting keeps split numeric labels attached"
);

let visibleApaGroup = hooks.visibleReferenceGroup(fakeVisibleWin([
  visibleLine("Smith, J. (2020). A precise first line", 510),
  visibleLine("with a title that continues after the year.", 536, 66),
  visibleLine("Taylor, R. (2021). The next reference.", 572)
]), { type: "author-year", author: "Smith", year: "2020", label: "Smith, 2020" });

assert.deepStrictEqual(
  visibleApaGroup.map((line) => line.text),
  [
    "Smith, J. (2020). A precise first line",
    "with a title that continues after the year."
  ],
  "keeps visible APA continuation lines after an early year"
);

function pdfLine(str, x, y) {
  return {
    str,
    transform: [1, 0, 0, 1, x, y],
    width: Math.max(20, str.length * 4.5),
    height: 9
  };
}

let oneLineNumericMatch = hooks.findReferenceMatch([
  {
    pageNumber: 9,
    text: "References [1] A. First title, 2020. [2] B. Second title, 2021.",
    items: [
      pdfLine("References", 50, 720),
      pdfLine("[1] A. First title, 2020.", 50, 680),
      pdfLine("[2] B. Second title, 2021.", 50, 660)
    ]
  }
], { type: "number", number: "1", label: "[1]" });

assert.deepStrictEqual(
  oneLineNumericMatch.lines.map((line) => line.text),
  ["[1] A. First title, 2020."],
  "stops a one-line numeric reference before the next entry"
);

let inlineNumericMatch = hooks.findReferenceMatch([
  {
    pageNumber: 9,
    text: "References [99] A title mentioning [1] internally. [1] Actual target.",
    items: [
      pdfLine("References", 50, 720),
      pdfLine("[99] A title mentioning [1] internally.", 50, 680),
      pdfLine("[1] Actual target.", 50, 660)
    ]
  }
], { type: "number", number: "1", label: "[1]" });

assert.deepStrictEqual(
  inlineNumericMatch.lines.map((line) => line.text),
  ["[1] Actual target."],
  "does not match a numeric citation embedded inside another reference"
);

let splitPdfLabelMatch = hooks.findReferenceMatch([
  {
    pageNumber: 9,
    text: "References [61] Jason Wei. Chain of thought, 2022. [62] Lai Wei.",
    items: [
      pdfLine("References", 50, 720),
      pdfLine("[61]", 56, 680),
      pdfLine("Jason Wei. Chain of thought,", 106, 680),
      pdfLine("Advances in NLP, 2022.", 106, 660),
      pdfLine("[62]", 56, 640),
      pdfLine("Lai Wei. The next reference.", 106, 640)
    ]
  }
], { type: "number", number: "61", label: "[61]" });

assert.deepStrictEqual(
  splitPdfLabelMatch.lines.map((line) => line.text),
  ["[61]", "Jason Wei. Chain of thought,", "Advances in NLP, 2022."],
  "keeps a split PDF numeric label attached to its entry"
);

assert.strictEqual(
  hooks.findReferenceMatch([
    {
      pageNumber: 9,
      text: "References John Smith. First work, 2020. Jane Smith. Second work, 2020.",
      items: [
        pdfLine("References", 50, 720),
        pdfLine("John Smith. First work, 2020.", 50, 680),
        pdfLine("Jane Smith. Second work, 2020.", 50, 660)
      ]
    }
  ], { type: "author-year", author: "Smith", year: "2020", label: "Smith, 2020" }),
  null,
  "rejects ambiguous same-author same-year references"
);

let resetNumberPages = [
  {
    pageNumber: 9,
    text: "References [1] Chapter one reference.",
    items: [pdfLine("References", 50, 720), pdfLine("[1] Chapter one reference.", 50, 680)]
  },
  {
    pageNumber: 19,
    text: "References [1] Chapter two reference.",
    items: [pdfLine("References", 50, 720), pdfLine("[1] Chapter two reference.", 50, 680)]
  }
];

assert.strictEqual(
  hooks.findReferenceMatch(resetNumberPages, { type: "number", number: "1", label: "[1]" }),
  null,
  "rejects reset numeric references without a native target page"
);

assert.deepStrictEqual(
  hooks.findReferenceMatch(
    resetNumberPages,
    { type: "number", number: "1", label: "[1]" },
    { expectedPage: 19 }
  ).lines.map((line) => line.text),
  ["[1] Chapter two reference."],
  "uses the native target page to disambiguate reset numeric references"
);

let crossPageMatch = hooks.findReferenceMatch([
  {
    pageNumber: 12,
    text: "Rafael Rafailov. Direct preference optimization, 2023. Ankur Samanta, Akshayaa Magesh, Kaveh 12",
    items: [
      pdfLine("Rafael Rafailov. Direct preference optimization, 2023.", 70, 130),
      pdfLine("Ankur Samanta, Akshayaa Magesh, Kaveh", 70, 90),
      pdfLine("12", 300, 20)
    ]
  },
  {
    pageNumber: 13,
    text: "Hassani, Paul Sajda, Jalaj Bhandari, et al. Structure enables effective self-localization of errors in LLMs. arXiv preprint arXiv:2602.02416, 2026. John Schulman. Trust region policy optimization.",
    items: [
      pdfLine("Hassani, Paul Sajda, Jalaj Bhandari, et al. Structure enables effective self-localization of errors in LLMs. arXiv", 80, 710),
      pdfLine("preprint arXiv:2602.02416, 2026.", 80, 695),
      pdfLine("John Schulman. Trust region policy optimization.", 70, 670)
    ]
  }
], { type: "author-year", author: "Samanta", year: "2026", label: "Samanta et al. (2026)" });

assert.ok(crossPageMatch, "matches reference entries split across adjacent pages");
assert.strictEqual(crossPageMatch.page.pageNumber, 12, "keeps the jump/highlight anchored to the first page of the split reference");
assert.deepStrictEqual(
  crossPageMatch.lines.map((line) => line.text),
  [
    "Ankur Samanta, Akshayaa Magesh, Kaveh",
    "Hassani, Paul Sajda, Jalaj Bhandari, et al. Structure enables effective self-localization of errors in LLMs. arXiv",
    "preprint arXiv:2602.02416, 2026."
  ],
  "does not include the next reference after the cross-page continuation"
);

let crossPageNewEntryMatch = hooks.findReferenceMatch([
  {
    pageNumber: 12,
    text: "Ankur Samanta, Akshayaa Magesh, Kaveh",
    items: [
      pdfLine("Ankur Samanta, Akshayaa Magesh, Kaveh", 70, 20)
    ]
  },
  {
    pageNumber: 13,
    text: "John Schulman. Trust region policy optimization, 2026.",
    items: [
      pdfLine("John Schulman. Trust region policy optimization, 2026.", 70, 710)
    ]
  }
], { type: "author-year", author: "Samanta", year: "2026", label: "Samanta et al. (2026)" });

assert.strictEqual(
  crossPageNewEntryMatch,
  null,
  "does not complete a bottom-of-page reference with the next page's new entry"
);

let boundedAuthorYearMatch = hooks.findReferenceMatch([
  {
    pageNumber: 13,
    text: "Coleman Hooper, Sehoon Kim, Hiva Mohammadzadeh, Michael W Mahoney, Yakun S Shao, Kurt Keutzer, and Amir Gholami. Kvquant: Towards 10 million context length llm inference with kv cache quantization. Advances in Neural Information Processing Systems, 37:1270-1303, 2024. Cheng-Ping Hsieh, Simeng Sun, Samuel Kriman.",
    items: [
      pdfLine("Coleman Hooper, Sehoon Kim, Hiva Mohammadzadeh, Michael W Mahoney, Yakun S Shao, Kurt Keutzer, and Amir Gholami.", 56, 700),
      pdfLine("Kvquant: Towards 10 million context length llm inference with kv cache quantization. Advances in Neural Information Processing", 66, 685),
      pdfLine("Systems, 37:1270-1303, 2024. 1", 66, 670),
      pdfLine("Cheng-Ping Hsieh, Simeng Sun, Samuel Kriman.", 56, 645)
    ]
  }
], { type: "author-year", author: "Hooper", year: "2024", label: "Hooper et al., 2024)" });

assert.ok(boundedAuthorYearMatch, "matches complete Hooper author-year reference");
assert.deepStrictEqual(
  boundedAuthorYearMatch.lines.map((line) => line.text),
  [
    "Coleman Hooper, Sehoon Kim, Hiva Mohammadzadeh, Michael W Mahoney, Yakun S Shao, Kurt Keutzer, and Amir Gholami.",
    "Kvquant: Towards 10 million context length llm inference with kv cache quantization. Advances in Neural Information Processing",
    "Systems, 37:1270-1303, 2024. 1"
  ],
  "stops author-year highlighting once the expected year is found"
);

let boundedPartialAuthorMatch = hooks.findReferenceMatch([
  {
    pageNumber: 13,
    text: "Coleman Hooper, Sehoon Kim, Hiva Mohammadzadeh, Michael W Mahoney, Yakun S Shao, Kurt Keutzer, and Amir Gholami. Kvquant: Towards 10 million context length llm inference with kv cache quantization. Advances in Neural Information Processing Systems, 37:1270-1303, 2024. Cheng-Ping Hsieh, Simeng Sun, Samuel Kriman.",
    items: [
      pdfLine("Coleman Hooper, Sehoon Kim, Hiva Mohammadzadeh, Michael W Mahoney, Yakun S Shao, Kurt Keutzer, and Amir Gholami.", 56, 700),
      pdfLine("Kvquant: Towards 10 million context length llm inference with kv cache quantization. Advances in Neural Information Processing", 66, 685),
      pdfLine("Systems, 37:1270-1303, 2024. 1", 66, 670),
      pdfLine("Cheng-Ping Hsieh, Simeng Sun, Samuel Kriman.", 56, 645),
      pdfLine("Ruler: What's the real context size of your long-context language models? arXiv preprint arXiv:2404.06654, 2024.", 66, 630)
    ]
  }
], { type: "author-year", author: "Hooper", year: "", label: "Hooper et al.," });

assert.ok(boundedPartialAuthorMatch, "matches partial Hooper reference");
assert.deepStrictEqual(
  boundedPartialAuthorMatch.lines.map((line) => line.text),
  [
    "Coleman Hooper, Sehoon Kim, Hiva Mohammadzadeh, Michael W Mahoney, Yakun S Shao, Kurt Keutzer, and Amir Gholami.",
    "Kvquant: Towards 10 million context length llm inference with kv cache quantization. Advances in Neural Information Processing",
    "Systems, 37:1270-1303, 2024. 1"
  ],
  "stops partial author highlighting at the next reference start"
);

let middleInitialAuthorStartMatch = hooks.findReferenceMatch([
  {
    pageNumber: 14,
    text: "Haotian Liu, Chunyuan Li, Qingyang Wu, and Yong Jae Lee. Visual instruction tuning. Advances in neural information processing systems, 36:34892-34916, 2023. Nelson F Liu, Kevin Lin, John Hewitt, Ashwin Paranjape, Michele Bevilacqua, Fabio Petroni, and Percy Liang. Lost in the middle: How language models use long contexts. Transactions of the association for computational linguistics, 12:157-173, 2024b. 1",
    items: [
      pdfLine("Haotian Liu, Chunyuan Li, Qingyang Wu, and Yong Jae Lee. Visual instruction tuning. Advances in neural information processing", 56, 700),
      pdfLine("systems, 36:34892-34916, 2023.", 66, 685),
      pdfLine("Nelson F Liu, Kevin Lin, John Hewitt, Ashwin Paranjape, Michele Bevilacqua, Fabio Petroni, and Percy Liang. Lost in the", 56, 660),
      pdfLine("middle: How language models use long contexts. Transactions of the association for computational linguistics, 12:157-173, 2024b. 1", 66, 645)
    ]
  }
], { type: "author-year", author: "Liu", year: "2024", label: "Liu et al., 2024b", suffix: "b" });

assert.ok(middleInitialAuthorStartMatch, "matches the Liu 2024b reference after a prior Liu entry");
assert.deepStrictEqual(
  middleInitialAuthorStartMatch.lines.map((line) => line.text),
  [
    "Nelson F Liu, Kevin Lin, John Hewitt, Ashwin Paranjape, Michele Bevilacqua, Fabio Petroni, and Percy Liang. Lost in the",
    "middle: How language models use long contexts. Transactions of the association for computational linguistics, 12:157-173, 2024b. 1"
  ],
  "does not swallow the previous Haotian Liu entry"
);

let longAuthorTitleMatch = hooks.findReferenceMatch([
  {
    pageNumber: 12,
    text: "Long Ouyang, Jeff Wu, Xu Jiang, Diogo Almeida, Carroll L. Wainwright, Pamela Mishkin, Chong Zhang, Sandhini Agarwal, Katarina Slama, Alex Ray, John Schulman, Jacob Hilton, Fraser Kelton, Luke Miller, Maddie Simens, Amanda Askell, Peter Welinder, Paul Christiano, Jan Leike, and Ryan Lowe. 2022. Training language models to follow instructions with human feedback. Liangming Pan, Michael Saxon, Wenda Xu, Deepak Nathani.",
    items: [
      pdfLine("Long Ouyang, Jeff Wu, Xu Jiang, Diogo Almeida,", 56, 700),
      pdfLine("Carroll L. Wainwright, Pamela Mishkin, Chong", 66, 685),
      pdfLine("Zhang, Sandhini Agarwal, Katarina Slama, Alex", 66, 670),
      pdfLine("Ray, John Schulman, Jacob Hilton, Fraser Kelton,", 66, 655),
      pdfLine("Luke Miller, Maddie Simens, Amanda Askell, Peter", 66, 640),
      pdfLine("Welinder, Paul Christiano, Jan Leike, and Ryan", 66, 625),
      pdfLine("Lowe. 2022. Training language models to follow", 66, 610),
      pdfLine("instructions with human feedback.", 66, 595),
      pdfLine("Liangming Pan, Michael Saxon, Wenda Xu, Deepak", 56, 570)
    ]
  }
], { type: "author-year", author: "Ouyang", year: "2022", label: "Ouyang et al., 2022)" });

assert.ok(longAuthorTitleMatch, "matches long Ouyang author-year reference");
assert.deepStrictEqual(
  longAuthorTitleMatch.lines.map((line) => line.text),
  [
    "Long Ouyang, Jeff Wu, Xu Jiang, Diogo Almeida,",
    "Carroll L. Wainwright, Pamela Mishkin, Chong",
    "Zhang, Sandhini Agarwal, Katarina Slama, Alex",
    "Ray, John Schulman, Jacob Hilton, Fraser Kelton,",
    "Luke Miller, Maddie Simens, Amanda Askell, Peter",
    "Welinder, Paul Christiano, Jan Leike, and Ryan",
    "Lowe. 2022. Training language models to follow",
    "instructions with human feedback."
  ],
  "keeps title lines after the year and stops before the next reference"
);

let boundedNumericMatch = hooks.findReferenceMatch([
  {
    pageNumber: 16,
    text: "[15] Zhihong Shao, Peiyi Wang, Qihao Zhu, Runxin Xu, Junxiao Song, Mingchuan Zhang, Y K Li, Y Wu, DeepSeek-AI. Deepseek-r1: Incentivizing reasoning capability in llms via reinforcement learning, 2025. [16] Noah Shinn, Federico Cassano, Ashwin Gopinath, Karthik Narasimhan, and Shunyu Yao.",
    items: [
      pdfLine("[15] Zhihong Shao, Peiyi Wang, Qihao Zhu, Runxin Xu, Junxiao Song, Mingchuan Zhang, Y K Li, Y Wu,", 56, 700),
      pdfLine("DeepSeek-AI. Deepseek-r1: Incentivizing reasoning capability in llms via reinforcement learning, 2025.", 66, 685),
      pdfLine("[16] Noah Shinn, Federico Cassano, Ashwin Gopinath, Karthik Narasimhan, and Shunyu Yao.", 56, 660)
    ]
  }
], { type: "number", number: "15", label: "15" });

assert.ok(boundedNumericMatch, "matches numbered RLTF reference");
assert.deepStrictEqual(
  boundedNumericMatch.lines.map((line) => line.text),
  [
    "[15] Zhihong Shao, Peiyi Wang, Qihao Zhu, Runxin Xu, Junxiao Song, Mingchuan Zhang, Y K Li, Y Wu,",
    "DeepSeek-AI. Deepseek-r1: Incentivizing reasoning capability in llms via reinforcement learning, 2025."
  ],
  "stops numeric highlighting at the next numbered reference"
);

console.log("ref-guard heuristics ok");
