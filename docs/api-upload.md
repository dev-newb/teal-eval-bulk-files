# API upload mode

Release 0.10.0 adds API uploads. The agent PowerShell wrapper defaults to API mode for upload plans, list, and verify. The human interface and raw Node CLI retain native as their default. Both methods use the signed-in browser and the same approval and verification rules. Persistent CLI use still requires bridge 0.1.3.

## Choose a method

In the extension's upload view, select **Direct API** under **Upload method**. Select your files, review the confirmation, and upload. Each registered file can create one automatic Linear comment, as with the native method.

For the CLI, select the method when you make the plan:

The wrapper already selects API by default; the explicit option below makes the choice clear. Agents give files to the CLI, and the extension performs the API requests. The bundled [agent instructions](../extension/AGENTS.md) also describe the workflow for agents that find the extension folder directly.

```powershell
$plan = & "<skill-root>\scripts\invoke-teal-cli.ps1" `
  -ExtensionRoot "<extension-root>" `
  -PersistentBridgePath "<absolute-path-to-stdio-proxy.mjs>" `
  -Issue DEMO-204 -Command plan-upload -UploadMode api `
  -Files "C:\packet\evidence.pdf","C:\packet\measurements.xlsx" | ConvertFrom-Json

& "<skill-root>\scripts\invoke-teal-cli.ps1" `
  -ExtensionRoot "<extension-root>" `
  -PersistentBridgePath "<absolute-path-to-stdio-proxy.mjs>" `
  -Issue DEMO-204 -Command apply-upload -PlanToken $plan.token
```

Apply uses the method saved in the token. An explicit conflicting method is rejected. Node CLI users can pass `--upload-mode api` on `plan-upload`; omitting it selects `native`.

Use `-Command list -UploadMode api` to read the API inventory. Use `-Command verify -UploadMode api -Files ...` only when the paths describe the complete intended staged-file set. For a partial batch, compare each planned filename and full SHA-256 against the fresh inventory.

The method option applies to upload planning, upload apply, list, and verify. It does not change download or deletion.

## What changes

The API method requests a signed upload URL, sends the original file bytes, and registers the file against the selected issue. It then reads the server inventory and checks the full SHA-256 and byte size. It does not click the native file input or depend on its label or location.

The browser keeps its login credentials. This is a UI-independent upload method, not a new standalone login system. Local files still reach the extension through the existing approved CLI transfer. Use `-PersistentBridgePath` for agent work. Do not start another `chrome-devtools-mcp` or Claude `--chrome` session for this mode.

The native page table may show old rows after a direct API upload. Use the extension's API result or an API list for verification. Refresh the page when it is convenient and after you have saved any question or table edits. The extension does not reload the page automatically.

## Failure handling

Inventory GET requests have a 60-second limit. Upload-URL preparation and registration POST requests can use up to ten minutes, capped by the remaining batch time. File transfer can use the remaining two-hour batch time. Registration includes server hashing and its comment. A missing or uncertain registration result gets up to two minutes of read-only inventory checks, subject to the batch deadline. These checks never repeat registration.

- The upload method is bound to the one-use plan token.
- Existing names are checked before each upload. Skipped files remain separate from successful files.
- A failed or lost registration response is not retried automatically. A read-only inventory check determines what can be verified.
- Chrome can repeat a network POST after a connection reset before response headers arrive, even when the extension calls fetch only once. The client cannot promise exactly one server write without server-side idempotency. If reconciliation finds more than one row, the result is indeterminate and apply remains consumed.
- A hash mismatch is a failure, even when registration returned success.
- Stop finishes the current file and prevents the next upload.
- A successful storage PUT followed by a failed registration can leave an unregistered object. Do not assume that it was deleted, and do not repeat the apply token.

Keep signed URLs, storage credentials, and browser secrets out of logs and model messages. The extension accepts only the fixed staged-file API operations; API mode is not a general fetch command.

## Validation

The API browser test uses a local fake service and a separate headless profile. Run it with `npm run test:api-upload-browser`. It does not use your open browser, real task data, or a production issue.
