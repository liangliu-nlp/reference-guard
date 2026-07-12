# Changelog

## 0.2.48

- Remove personal-name attribution from public documentation and package metadata.
- Keep OpenAI Codex as the sole displayed implementation credit.

## 0.2.47

- Document the plugin architecture, behavior boundaries, verification workflow, and local deployment options.
- Record that the project was implemented by OpenAI Codex.

## 0.2.46

- Resolve individual numbers inside grouped citations instead of defaulting to the first reference.
- Anchor numeric and author-year fallback matching to reference-entry starts and reject ambiguous duplicate matches.
- Stop one-line references before the next entry and keep split PDF numeric labels attached to their text.
- Use exact PDF destination coordinates for reference-like landing highlights, including same-page destinations.
- Keep visible author-year highlights through title continuation lines after an early year.

## 0.2.45

- Stop using whole-page passive citation scans for post-native-jump highlighting.
- Only run passive page-change highlighting when the source click has one unique nearby citation candidate.

## 0.2.44

- Do not let fuzzy citation hits override a native PDF destination that clearly points to a different author-year reference.

## 0.2.43

- Require an explicit reference-like native destination before using landing fallback highlighting.
- Stop guessing a visible reference entry when Zotero jumps after an unrecognized or destinationless click.

## 0.2.42

- Accept unambiguous near-miss citation clicks when PDF text-layer rectangles are slightly off.
- Keep all numeric page-level citation hints for Zotero-native jumps instead of only the first one.
- Highlight the landed reference entry when Zotero jumps to a reference page but source citation hints are unreliable.
- Add diagnostics for missed post-jump highlighting and rejected clicks without references.

## 0.2.41

- Skip clearly non-reference PDF destinations such as figures, tables, equations, and sections.
- Only allow post-jump visible-reference highlighting on pages that look like a bibliography/reference page.

## 0.2.40

- Stop no-citation native links such as figures from flashing destination highlights.
- Ignore backward page changes so Zotero back navigation does not trigger reference highlighting.
- Require a visible reference match before post-jump fallback highlighting.

## 0.2.39

- Keep more source-page citation hints for post-jump visible-reference matching.

## 0.2.38

- When source-line PDF coordinate matching misses, use source-page citations only as post-jump visible-reference hints.

## 0.2.37

- Add focused diagnostics for PDF textContent source-line fallback misses.

## 0.2.36

- Fall back to PDF textContent for source-line citation hints when Zotero renders the source page without a DOM text layer.

## 0.2.35

- Broaden passive source-line capture for PDF annotation clicks so split text layers still provide citation hints.

## 0.2.34

- Use nearby source citation text only after Zotero has already changed pages, improving highlight precision without reintroducing fallback jumps.

## 0.2.33

- Use PDF annotation destinations for clicks that Zotero handles without a text-layer citation hit.
- Keep the source annotation geometry stable while Zotero is changing pages.

## 0.2.32

- Flash the landing area when Zotero handles an unrecognized native PDF link and the page changes.

## 0.2.31

- Restore longer native-link highlight retries after Zotero page jumps.
- Add diagnostics for native PDF links that jump without an exact citation-text hit.

## 0.2.30

- Require exact point-level citation hits before fallback reference jumps.
- Stop permanent reader rescans after startup and avoid repeated successful highlight retries.
- Remove unused whole-line/context click parsing that caused accidental jumps.

## 0.2.29

- Route native PDF citation links through the same exact reference text matching used by fallback clicks.
- Keep full long author-year reference entries highlighted after the year, including title continuation lines.

## 0.2.28

- Preserve Zotero Reader back navigation for plugin-handled reference jumps.

## 0.2.27

- Cache parsed PDF reference lines and reference-section detection for repeated clicks.
- Reuse per-reference matchers instead of compiling regular expressions for every line.
- Avoid repeated string joins in click-context and reference-group scans.

## 0.2.26

- Retry the destination highlight on the matched page when Zotero reports the source page during delayed flashing.

## 0.2.25

- Stop author-year highlighting before reference starts such as `Nelson F Liu`, where the middle initial has no period.

## 0.2.24

- Keep explicit square-bracket numeric citations active even when nearby text contains math-like symbols.
- Stop numeric-reference highlighting at the next numbered bibliography entry.

## 0.2.23

- Bound author-year reference highlighting at the next reference entry when Zotero exposes only a partial clicked citation.
- Complete partial author-year clicks from nearby citation context when possible.
- Preserve cross-page highlighting for references split across adjacent pages.
- Keep formula-like numeric text from being treated as reference clicks.
