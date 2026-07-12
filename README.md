# Reference Guard

Reference Guard is a Zotero 9 reader plugin for more reliable reference-jump highlighting.

The project was implemented by OpenAI Codex.

Version 0.3 uses the same core interaction architecture as Google Scholar PDF Reader, adapted to Zotero's existing PDF.js renderer:

- indexes native PDF annotation bounds and destinations before the user clicks;
- maps the pointer directly to one annotation rectangle without parsing nearby citation text;
- navigates with the annotation's exact named destination, page, and PDF coordinates;
- highlights only the nearest target text item in the same PDF viewport geometry;
- leaves PDFs without internal links to Zotero instead of guessing a plausible reference.

## Status

Version 0.3.0 is the first usable formal release. It is optimized from real Zotero Reader failures observed in academic PDFs and does not replace Zotero's parser or add OCR.

Tested with Zotero 9.

## How It Works

1. Read each rendered page's PDF.js link annotations and cache `{bounds, destination}` records.
2. Capture pointer input before Zotero's native link action and hit-test the page-local point against those bounds.
3. Resolve the selected destination to an exact page and PDF coordinate, then navigate through Zotero's reader API.
4. Convert the destination and target text through the active viewport and draw a temporary highlight over the nearest text item.

This is an independent Zotero implementation informed by Google Scholar PDF Reader 0.5.2's pre-indexed internal-annotation flow. No Google extension code is bundled in this project.

## Scope and Limitations

- Highlights are temporary visual overlays, not Zotero annotations.
- Exact jumping requires a native internal PDF link annotation.
- Visible highlighting additionally requires a usable target text layer and a destination with a vertical coordinate.
- Scanned, flattened, or malformed PDFs without internal links keep Zotero's native behavior; Reference Guard does not infer a destination from citation text.

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

Run the annotation-mapping tests:

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
