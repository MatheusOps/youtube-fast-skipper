# Contributing

Use Node.js 22.12+ (24 recommended). Install dependencies with
`npm ci --ignore-scripts`, then run `npm run check` and `npm test`.
Extension files are loaded directly; no build step is required.

## Project structure

- `manifest.json`: version, permissions, and entry points.
- `content.js`: controls, playback speed, audio, and Skip button detection.
- `background.js`: browser-generated clicks and their checks.
- `popup.*`: settings and diagnostics in the Chrome toolbar popup.
- `anuncio.css`: progress bar styling during ads.
- `icons/`: icons used by Chrome and the popup.
- `assets/`: the original logo supplied for the project.
- `tests/`: local scenarios using a simulated DOM and browser APIs.
- `scripts/`: validation and reproducible packaging.

## Making changes

Preserve the worker's sender, URL, focus, target, cancellation, and cleanup
checks. Do not leave debugging sessions attached between attempts. Avoid
runtime dependencies and network requests in the distributed extension.

Add tests for behavior changes. In bug reports, include the Chrome and extension
versions, reproduction steps, and the copyable diagnostic report when helpful.
Review the report before sharing it and do not include personal information.

After updating the extension and refreshing the page, manually check:

1. An ad that starts with sound and content that was already muted.
2. Audio and playback speed restoration after the ad.
3. Speed up ads enabled and disabled, including toggling during an ad.
4. An enabled Skip button, a countdown, and consecutive ads.
5. Settings staying synchronized between the popup and the in-video gear.
6. Shorts speed controls with no regular progress bar, scrolling to the next
   Short, reusing a video element, and returning to a regular video.

## Publishing on GitHub

The folder containing this file is the repository root. The repository name is
`youtube-fast-skipper`. Include source files, tests, documentation, and
`package-lock.json`. Git ignores `node_modules/` and `dist/`.

Before a release, synchronize the version in `manifest.json`, `package.json`,
`content.js`, and `popup.html`, and update the lockfile and changelog. Run the
checks and `python scripts/package.py`. Attach the ZIP from `dist/` to a GitHub
Release; publishing to the Chrome Web Store is not required.
The ZIP with `source` in its name contains the project for sharing; the other
contains only the installable extension, installation notes, and license.

The workflow validates pull requests and pushes with read-only repository
access, and uploads the ZIPs as artifacts. It does not create Releases or
publish code automatically to other services.
