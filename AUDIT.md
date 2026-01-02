# Melaleuca Unified Tester Audit Findings

## Findings
- High: Report download/open endpoints accept unsanitized :filename, allowing path traversal to read/open arbitrary files on the host. (server.js:437, server.js:447)
- High: Server listens on all interfaces with no auth; any network peer can trigger runs or hit report endpoints. (server.js:187, server.js:512)
- Medium: PSLP results schema mismatch (componentReports vs componentsExtracted) makes history/UI counters show 0 components. (processors/pslp-processor.js:228, server.js:147, server.js:400, public/pslp-app.js:363)
- Medium: PSLP emits completed after errors because this.results is truthy even when empty, causing false success/history entries. (processors/pslp-processor.js:247)
- Medium: PSLP progress UI never updates because processor emits progress without type, while UI switches on data.type. (processors/pslp-processor.js:167, public/pslp-app.js:290)
- Medium: Stage/UAT SKU capture requires env sign-in but only attempts Microsoft auth during SKU login; runs without Add-to-Cart never apply env auth and can fail. (config.js:614, processors/sku-processor.js:38, processors/sku-processor.js:697)
- Medium: Plaintext credentials are stored in localStorage (credential store + prefs), increasing exposure on shared machines or via XSS. (public/credentials-store.js:33, public/sku-app.js:222, public/pslp-app.js:211, public/banner-app.js:254)
- Low: NL UAT host appears typoed as productstore2-uatl, likely breaking NL UAT URLs. (config.js:36, config.js:209)
- Low: Completion status broadcasts full results (base64 screenshots) over WebSocket, which can stall UIs or hit message size limits on large runs. (processors/sku-processor.js:750, processors/banner-processor.js:358, processors/pslp-processor.js:252)

## Questions / Assumptions
- Should this tool be localhost-only, or do you need LAN access? That drives whether to bind 127.0.0.1 and/or add auth.
- For PSLP progress, do you want typed progress events added, or should the UI render the existing message field?
- Can you confirm the NL UAT hostname (is it productstore2-uatnl)?

## Notes
- No code changes were made during this audit.
