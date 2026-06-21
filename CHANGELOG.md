# Changelog

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
