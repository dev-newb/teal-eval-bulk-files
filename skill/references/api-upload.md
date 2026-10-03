# Optional API uploads

Requires extension and CLI 0.10.1 (API uploads were introduced in 0.10.0). Persistent transport still requires bridge 0.1.3.

The wrapper accepts `-UploadMode native|api` for `plan-upload`, `apply-upload`, `list`, and `verify`. It defaults to API for plan-upload, list, and verify. The raw Node CLI accepts `--upload-mode native|api` and keeps native as its compatibility default. An apply with no explicit method uses the saved token's method. An explicit mismatch is rejected before transfer.

```powershell
$plan = & "<skill-root>\scripts\invoke-teal-cli.ps1" `
  -ExtensionRoot "<extension-root>" `
  -PersistentBridgePath "<absolute-path-to-stdio-proxy.mjs>" `
  -Issue DEMO-204 -Command plan-upload -UploadMode api `
  -Files "C:\packet\source.pdf","C:\packet\data.xlsx" | ConvertFrom-Json

# Check actionableFiles and skipped before apply.
& "<skill-root>\scripts\invoke-teal-cli.ps1" `
  -ExtensionRoot "<extension-root>" `
  -PersistentBridgePath "<absolute-path-to-stdio-proxy.mjs>" `
  -Issue DEMO-204 -Command apply-upload -PlanToken $plan.token

& "<skill-root>\scripts\invoke-teal-cli.ps1" `
  -ExtensionRoot "<extension-root>" `
  -PersistentBridgePath "<absolute-path-to-stdio-proxy.mjs>" `
  -Issue DEMO-204 -Command list -UploadMode api
```

The exact user upload request remains the authority. Do not ask for a second approval for the same file set. Each registered file can create an automatic Linear comment. API mode changes the upload method, not that effect.

API requests run in the selected browser session. The current CLI transfer still provides verified local File objects to the extension. Never copy cookies or signed URLs into the shell or model transcript. Do not silently change to a separate direct browser client.

Use API inventory for plan checks and post-upload verification. The native React table can remain stale, so do not use it alone to decide that an upload failed. Do not reload a page with unsaved question, rubric, or answer-table edits.

Read the full terminal arrays and exit code. If completion is uncertain, use a fresh read-only API list and compare each exact name and full SHA-256. Do not replay apply or registration. A storage upload with failed registration can leave an unregistered object; report that possibility without claiming cleanup. A new plan needs the applicable user authority.

Chrome itself can resend a POST after a connection reset before headers, even with one extension fetch call. Duplicate rows cause an indeterminate result. Do not claim exactly-once server writes or delete a duplicate automatically; that needs separate authority and exact row identification.
