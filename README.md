# Reference Guard

Reference Guard is a Zotero 9 reader plugin for more reliable reference-jump highlighting.

The project was implemented by OpenAI Codex.

It keeps Zotero's native PDF navigation behavior and adds a small guard layer around citation clicks:

- suppresses formula-like numeric false positives such as isolated `1`, `(3)`, or `1/N`;
- recognizes numeric and author-year citations, including suffixes such as `2024b`;
- resolves individual numbers inside grouped citations such as `[6, 15]`;
- flashes the matched bibliography entry after a jump;
- uses reference-like PDF destinations as exact landing anchors when available;
- bounds the flash to the current reference entry, including common two-column and cross-page layouts.

## Status

This plugin is experimental and optimized from real Zotero Reader failures observed in academic PDFs. It does not replace Zotero's parser. It tries to recover when Zotero jumps without a visible destination highlight or when the clicked citation text is split across PDF text-layer spans.

Tested with Zotero 9.

## How It Works

1. Capture citation clicks inside Zotero's PDF.js reader while preserving native navigation.
2. Resolve exact citation subranges, PDF annotations, and named destinations before using text fallback matching.
3. Read and cache PDF text geometry, then match one unambiguous bibliography entry on the native target page when possible.
4. Convert PDF coordinates through the active viewport and draw temporary, non-interactive highlight overlays.

Native PDF destinations are treated as stronger evidence than fuzzy text matches. Ambiguous citation groups, duplicate references, backward navigation without an explicit reference destination, and non-reference destinations are not guessed.

## Scope and Limitations

- Highlights are temporary visual overlays, not Zotero annotations.
- Text matching requires a usable PDF text layer; scanned PDFs without OCR rely on native PDF destinations.
- The plugin intentionally rejects ambiguous matches instead of jumping to the first plausible entry.
- Reference formats outside numeric and common author-year styles may fall back to Zotero's native behavior.

## Install

Download `reference-guard.xpi` from the GitHub release page, then install it in Zotero:

1. Open `Tools -> Plugins`.
2. Drag `reference-guard.xpi` into the Plugins window.
3. Restart Zotero if prompted.

Zotero plugins have full access to Zotero and your computer. Install only code you trust.

## Build From Source

```powershell
powershell -ExecutionPolicy Bypass -File .\package.ps1
```

The XPI is written to:

```text
dist/reference-guard.xpi
```

The package contains only `manifest.json`, `bootstrap.js`, `src/ref-guard.js`, and `src/ref-guard.css`.

## Development

Run the heuristic tests:

```powershell
node .\tests\ref-guard-heuristics.test.js
```

Run a syntax check:

```powershell
node --check .\src\ref-guard.js
```

Build the XPI after both checks pass:

```powershell
powershell -ExecutionPolicy Bypass -File .\package.ps1
```

For local Zotero development, create an extension proxy file in your Zotero profile `extensions` directory. The file name must match the add-on id:

```text
reference-guard@liangliu-nlp.github.io
```

Its content should be the absolute path to this repository, for example:

```text
E:\Documents\Zotero Plugin
```

Start Zotero with debug output while developing:

```powershell
zotero.exe -purgecaches -ZoteroDebugText -jsconsole
```

Reference Guard also writes a focused diagnostic log to the Zotero profile:

```text
reference-guard.log
```

For direct local deployment, copy the packaged XPI into the active Zotero profile's `extensions` directory and restart Zotero. Keep the installed filename stable so subsequent builds replace the same local add-on.

## Release Notes

`manifest.json` points `applications.zotero.update_url` to `updates.json` on the `main` branch. Before publishing a release, make sure `updates.json` points to the matching GitHub release asset.

Zotero 9 requires `applications.zotero` in `manifest.json`. Zotero update manifests use Mozilla-style JSON update manifests.

## License

MIT

## Attribution

Reference Guard was implemented and iteratively refined by OpenAI Codex.
