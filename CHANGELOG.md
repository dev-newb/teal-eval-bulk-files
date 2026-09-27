# Changelog

## Documentation - 2026-09-27

- Add an illustrated user manual for upload, API upload, duplicates, download, deletion, confirmations, progress, errors, and stop controls.
- Explain agent access, one-use plans, the PowerShell wrapper, direct Node module commands, JSON output, exit codes, and component lifetimes.
- Add an offline HTML edition and reproducible screenshots from a complete fictional eval page in a headless browser.

## 0.10.0 - 2026-09-26

- Default the agent PowerShell wrapper to API upload plans and inventory reads. Keep apply bound to its saved mode, and retain explicit native fallback.
- Include agent instructions in the extension folder so file agents can use its CLI without writing API request code.
- Allow upload-URL preparation and server registration up to ten minutes within the batch deadline; reconcile late results with bounded read-only checks instead of repeating a POST.

- Add optional API uploads in the extension and CLI while keeping native upload as the default.
- Bind the chosen upload method to the one-use upload token and extension authorization.
- Use the signed-in browser for prepare, raw-byte PUT, registration, and fresh inventory verification.
- Verify complete file hashes and sizes; keep duplicate handling, stop controls, private snapshots, and no-replay rules.
- Add API inventory reads for list and verify without requiring the native staged-file panel.
- Keep persistent bridge 0.1.3 and update the wrapper, skill, and API upload guide.
- Add local fake-service tests for success, rejected requests, uncertain registration, and unchanged table fields.

## 0.9.8 - 2026-08-17

- Require `chrome-devtools-persistent-gateway` 0.1.3 and keep exact MCP identity checks before browser dispatch.
- Keep the default cooperative lease wait at 120 seconds while bridge 0.1.3 releases authenticated idle owners without an idle-owner delay.
- Verify that `plan-upload`, `apply-upload`, and `list` send the 120000 ms default to every persistent proxy session.
- Keep proved pre-dispatch lease failures at exit code `3`, with no fill, confirmation, replay, or indeterminate result.
- Report `tokenConsumed: true` when a proved lease failure occurs after an apply claims its one-use token. The token stays consumed and the CLI does not replay the apply.
- Tell agents to use the persistent PowerShell wrapper and not start direct `chrome-devtools-mcp` or Claude `--chrome` sessions for Teal file work.
- Keep the existing visual interface unchanged.

## 0.9.7 - 2026-08-17

- Add bounded cooperative lease waiting so several CLI agents can share one persistent Chrome bridge.
- Require `chrome-devtools-persistent-gateway` 0.1.2 and validate its MCP identity before browser dispatch.
- Wait only before the first `list_pages` dispatch. Keep `select_page` and the target tool in the same proxy session and lease.
- Keep queue timeout as `lease_busy` with `dispatched: false`, exit code `3`, and no automatic confirmation or tool resend.
- Preserve one-use apply tokens, exact issue, target, page, inventory, and authorization binding, and all no-replay rules.
- Keep the existing visual interface unchanged.

## 0.9.6

- Added upload token schema v2, private verified upload snapshots, strict snapshot lifetimes, and safer post-transfer failure reporting.
- Preserved exact download and delete bindings, one-use apply behavior, and indeterminate no-replay handling.
