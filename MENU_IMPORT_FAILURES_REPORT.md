# Menu Import Failures — Read-Only Investigation Report

**Date:** 2026-05-06
**Scope:** Why real users (Sean Glaser / The Florida Kitchen, Maggie Funk / Sweet Love, Magpie User) are visibly failing onboarding on `/admin/launch-week`.
**Status:** No backend code has been changed. This is a diagnosis + fix plan only.

---

## Executive summary

The visible signals on the admin Launch Week screen (`5 import failed`, `2 import failed`, `Last image import just now, 1 error`, `Last pdf import just now, 1 error`) are **real backend failures**, not UI bugs. They originate from a single code path that uses the Anthropic Claude API to parse PDF and image menus. The code path itself is structurally correct, but it has three concrete weaknesses that make these failures both common AND impossible for an admin to debug from the current UI:

1. **The actual error reason text is collected but never surfaced to admins.** The admin response only returns the *count* of errors, not the human-readable reason that was stored in `menu_import_logs.errors[].reason`. Without that text, neither you nor I can tell whether a failure was caused by a malformed PDF, an Anthropic rate limit, an out-of-format JSON return, a missing API key, an unsupported MIME type, or an item-level price-parse error.
2. **The "image" import path is silently routed through the PDF parser.** A user uploading a JPG/PNG of their menu hits the same endpoint as a PDF (`POST /api/owner/menus/:menuId/import/pdf`) and the only thing that distinguishes the two is `req.file.mimetype?.startsWith("image/")`. If the mimetype header is missing or wrong (common when iPhone uploads HEIC, or when the browser sends `application/octet-stream`), the file is sent to Claude as a `document` block with `media_type: application/pdf` — which Claude rejects, producing exactly the kind of one-error-per-attempt failure you see for Sean.
3. **A "complete" import with zero items imported is counted as a failure.** This is technically correct, but it conflates two very different cases (Claude returned valid JSON with zero items vs. Claude failed) under one bucket, making triage harder.

The Magpie User "stuck at setup 1/6 for 18h" case is a different category — it is **not** an import failure. They never got past business creation. Details below.

---

## 1. Where the failures are produced

| File | Lines | What it does |
|---|---|---|
| `server/routes/menuRoutes.ts` | 1247 – 1308 | `POST /api/owner/menus/:menuId/import/pdf` — accepts a multipart upload, calls `parsePdfMenuWithAi(buffer, menuId, restaurantId, mimeType)`, and writes the result to `menu_import_logs`. |
| `server/utils/menuPdfParser.ts` | 47 – 193 | The Claude call. Builds either a `document` block (PDF) or `image` block (any mimetype starting with `image/`), sends to Claude, parses returned JSON, validates each item. |
| `server/routes/admin/adminCoreOpsRoutes.ts` | 3092 – 3161 | The `/api/admin/launch-week` query — reads `menu_import_logs`, aggregates per restaurant, computes `attempts`, `failed`, and `lastFailure` shape that the admin UI consumes. |
| `client/src/pages/AdminLaunchWeek.tsx` | 754 – 766 | The OwnerCard renders the failure summary line ("Last pdf import just now, 1 error"). |

The full failure path:

```
client uploads PDF/image
  └─> POST /api/owner/menus/:menuId/import/pdf
        └─> parsePdfMenuWithAi(buffer, menuId, restaurantId, mimeType)
              ├─> branch on mimeType.startsWith("image/")
              │     true  → contentBlock = { type: "image",   media_type: mimeType }
              │     false → contentBlock = { type: "document", media_type: "application/pdf" }
              ├─> client.messages.create({ model: "claude-opus-4-5", ... })
              │     on throw → returns { imported: [], skipped: 0, errors: [{row:0, reason: "AI extraction failed: <msg>"}] }
              ├─> parse JSON return
              │     on throw → returns { imported: [], skipped: 0, errors: [{row:0, reason: "AI returned malformed JSON..."}] }
              └─> per-item validation
                    invalid price → errors.push({row, reason: `Item "<name>" has invalid price: <price>`})
                    missing name  → skipped++

  └─> menuImportLogs INSERT { source, fileName, itemsImported, itemsSkipped, errors, status }
        status = computeImportStatus(imported.length, errors.length)

  └─> /api/admin/launch-week query later joins menuImportLogs
        - errorCount = Array.isArray(errors) ? errors.length : 0   ← only the count
        - source     = source                                        ← "pdf" or "image"
        - reason text from errors[].reason is NEVER returned to client
```

The `errors` JSON column **is** populated — it just never reaches the admin UI.

---

## 2. The three concrete root causes for the failures you see

### 2A. Admin can't see the reason, only the count (P0 debug blocker)

Even if Claude is failing for a perfectly diagnosable reason ("invalid x-api-key", "rate_limit_error", "image too large", "unsupported media type image/heic"), the admin UI shows only "1 error". Without the reason text, no one — not you, not me, not your dev — can decide whether to retry, re-upload, or escalate.

**Fix:** expose the first error's `reason` (truncated to ~200 chars) in the admin Launch Week response. This is a 5-line change in `server/routes/admin/adminCoreOpsRoutes.ts` around line 3155, and a tiny additive field on the front-end type (`OwnerRow.restaurants[].lastImportFailure.reason: string | null`) plus a one-line render in `AdminLaunchWeek.tsx` near line 754.

This single change would tell you within seconds whether Sean's 5 failures are all the same Anthropic error or 5 different file-format problems — and which.

### 2B. iPhone/HEIC and unknown-mimetype uploads silently get sent as PDFs

`menuPdfParser.ts:76` — `const isImage = mimeType?.startsWith("image/") || false;`

If `mimeType` is `image/heic`, `image/heif`, `application/octet-stream`, or empty, the file falls through to the `document` branch with `media_type: "application/pdf"`. Claude rejects this with a 400 error, which becomes the single "AI extraction failed: …" entry — exactly matching Sean's "image import, 1 error" pattern when uploading from an iPhone camera roll.

**Fix options (in order of effort):**

- **Cheapest:** in `menuPdfParser.ts`, validate the mimetype upfront. If it's neither `application/pdf` nor a Claude-supported image mimetype (`image/jpeg`, `image/png`, `image/gif`, `image/webp`), return a clean error before calling Claude: `"Unsupported file type: <mime>. Please upload a PDF or JPG/PNG photo of your menu."`
- **Better:** detect mimetype from buffer magic bytes (don't trust the client header) using `file-type` (~30 KB dep). HEIC photos can be transcoded to JPEG with `sharp` (already commonly used in Node).
- **Best:** both of the above + a clear front-end "file type not supported, here's what works" message in the upload UI.

### 2C. Status `"complete"` with zero items is bucketed as `failed`

`server/routes/admin/adminCoreOpsRoutes.ts:3137` —
```ts
const failed = row.status === "failed" || (row.status === "complete" && itemsImported === 0);
```

This is defensive and not wrong, but it means Maggie's "Last pdf import just now, 1 error" could be one of:
- Claude returned a valid empty array (PDF had no extractable items — e.g. a photo of a closed-truck flyer)
- Claude returned valid items but they all had invalid prices ("MP", "Market", "$$" etc.)
- The Claude call itself threw and was already truly `failed`

Surfacing the reason text (fix 2A) immediately disambiguates these. A second-order fix is to return separate categories in the summary: `failed_call` vs `extracted_zero_items` vs `all_items_invalid`.

---

## 3. Magpie User — different problem

This user sits at `setup 1/6` for `18h` and is in the **Stuck** filter. The Stuck flag (`adminCoreOpsRoutes.ts:3223–3225`) fires when:
```
score < 3 && createdAt < now - 6h
```
Score is the count of `[emailVerified, hasBusiness, hasMenu, hasItems, isVerified, hasSubscription]` that are true. Score 1 means only `emailVerified` is true — Magpie never created their business listing.

This is **not** an import failure. It's an onboarding-flow drop-off. Possible causes (need a separate investigation):

1. They hit the onboarding flow but the business-create form errored out (insurance proof gating now requires upload — `client/src/pages/AdminLaunchWeek.tsx:828` shows "Needs insurance proof" is now treated as a hard requirement).
2. They tried, were blocked at the insurance-proof step, and emailed support → never returned.
3. The "Restaurant/Bar" category Magpie selected may have a different onboarding path than food trucks (Sean and Maggie selected Food truck and at least made it to menu-import).

**To verify this in the next pass**, I'd need to read the restaurant/bar onboarding flow file and the insurance-proof gating logic. Tell me to proceed and I will (read-only).

---

## 4. Recommended fix order (priority-ranked)

| # | Fix | Owner | Effort | Impact |
|---|---|---|---|---|
| 1 | Expose `lastImportFailure.reason` in admin Launch Week response and render it on the OwnerCard | Backend + tiny FE | 30 min | Unblocks all triage. You and your dev can finally see WHY anything is failing. |
| 2 | Up-front mimetype validation in `parsePdfMenuWithAi` with a clean user-facing error | Backend | 30 min | Stops iPhone/HEIC uploads from entering the Claude pipeline at all. |
| 3 | Front-end upload UI: "Supported types: PDF, JPG, PNG. iPhone HEIC photos must be converted first" | Front-end | 30 min | Prevents the failure before it happens. |
| 4 | HEIC → JPEG transcode before sending to Claude | Backend | 60 min | Recovers iPhone uploads without bouncing the user. |
| 5 | Investigate Restaurant/Bar onboarding flow drop-off (Magpie User class) | Backend + FE | 90 min | Different bug class. Needs the actual flow read. |

Items 1, 2, 3 should ship together. They unblock you AND prevent the next batch of failures.

---

## 5. What I will NOT do without your green light

- Modify any file in `server/` (backend code change).
- Modify the menu import endpoints, schema, or status semantics.
- Change `parsePdfMenuWithAi` or any Claude call configuration.
- Change `menu_import_logs` schema.

If you want me to ship fixes 1, 2, and 3 above, **say "ship 1, 2, 3"** (or any subset). I will then:

- For backend (#1, #2, #4): write the patches and open a PR — you or your dev review and merge.
- For front-end (#3): I'll just ship it on the next admin PR.

If you want me to investigate the Restaurant/Bar onboarding flow next (#5), say "investigate Magpie".
