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
  h.parseClickReferences("8", "predefined correction instructions [ 8 ] to process-based supervision"),
  [{ type: "number", number: "8", label: "8" }],
  "parses bare numeric clicks inside spaced bracketed citations"
);

assert.deepStrictEqual(
  h.parseReferenceTriggers("1", "L(theta) = 1 / N sum_n log p_theta(y_n | x_n)"),
  [],
  "does not parse formula numbers"
);

assert.deepStrictEqual(
  h.parseClickReferences("(LLMs) have demonstrated a paradigm shift from", "Recent advancements follow Snell et al., 2024a; Kumar et al., 2024."),
  [],
  "does not use citation context for non-citation prose clicks"
);

assert.deepStrictEqual(
  h.parseClickReferences("2024). Even when inputs fit", "the growth of the KV cache (Hooper et al., 2024). Even when"),
  [{ type: "author-year", author: "Hooper", year: "2024", label: "Hooper et al., 2024)" }],
  "uses context for year-fragment citation clicks"
);

assert.deepStrictEqual(
  h.parseClickReferences(
    "making inference increasingly constrained by memory and latency due to the growth of the KV cache (Hooper et al.,",
    "making inference increasingly constrained by memory and latency due to the growth of the KV cache (Hooper et al., 2024). Even when inputs fit within the model's maximum context window, Liu et al., 2024b"
  ),
  [{ type: "author-year", author: "Hooper", year: "2024", label: "Hooper et al., 2024)" }],
  "uses context to complete same-author partial author-year clicks"
);

assert.deepStrictEqual(
  h.parseClickReferences("information distributed across long contexts (Liu et al., 2024b; An et al., 2025).", ""),
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

function pdfLine(str, x, y) {
  return {
    str,
    transform: [1, 0, 0, 1, x, y],
    width: Math.max(20, str.length * 4.5),
    height: 9
  };
}

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
