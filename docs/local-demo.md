# Local demonstration and screenshot reproduction

The repository includes a complete fictional eval page for safe browser testing. It uses invented question text, rubric criteria, account text, filenames, and run history.

Never use a real Teal issue for mutation tests or public screenshots.

## Start the local page

```powershell
npm install
npm run mock
```

Open this local-only demonstration address with the generated test extension and a dedicated temporary profile:

```text
http://127.0.0.1:8769/issue/DEMO-204?docs=1
```

The production manifest does not match this address. This prevents the production extension from running on unrelated local pages.

## Generate the test manifest

```powershell
npm run test:manifest
```

The command writes a local test manifest. It adds only the exact loopback server match. Do not package it as the production manifest.

## Capture all documentation images

Install Playwright's Chromium browser once if it is not already available:

```powershell
npx playwright-core install chromium
```

Then run:

```powershell
npm run docs:capture
```

Build the single offline HTML manual after the screenshots are current:

```powershell
npm run docs:build
npm run docs:verify
```

The capture process:

1. Starts a loopback-only fictional page and fake staged-file API on an available local port.
2. Copies the extension into a dedicated temporary directory. It gives only that copy the exact demo origin, an open shadow root for selectors, and a fake browser download terminal event.
3. Starts Chromium in headless mode with a separate temporary profile. It does not use an existing browser profile or a live Teal issue.
4. Operates the real extension controls for native and Direct API uploads, ZIP preparation, deletion, confirmations, progress, stops, and terminal states.
5. Captures a full fictional eval page, each workflow state, and the temporary Chromium extension-management page. The CLI panel is clearly marked as illustrative output.
6. Writes a per-image action/source receipt to the ignored `artifacts/documentation-capture` directory, then closes the server and browser and removes only its own temporary directory.

The `download-complete.png` and `download-cancelled.png` images show the real extension response to simulated browser terminal events. No native Save As window is pictured. `download-stopped.png` is a different state: the user stops ZIP preparation before Save As starts. The Direct API upload uses only the fake loopback API and fictional bytes.

The production `extension/content.js` keeps its closed shadow root. The screenshot process does not open a foreground window and does not take focus from the user's active application.

Set `PLAYWRIGHT_CHROMIUM_PATH` to an explicit Chromium executable if the standard Playwright location is not available.

## Verify public documentation

```powershell
npm run docs:verify
```

The check requires every expected image, verifies PNG dimensions, scans public Markdown for the private internal route label, and rejects real Teal issue URLs in the public guides.

## Screenshot privacy rules

- Use only the local fictional page.
- Show no real issue ID, task text, rubric, staged file, account, cookie, token, profile path, or private browser endpoint.
- Capture page content, except for `installation.png`, which shows only the separate temporary Chromium extension-management page.
- Use placeholders for one-use plan tokens.
- Reload the local page after a source change before capture.
