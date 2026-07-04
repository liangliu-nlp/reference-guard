# Changelog

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
