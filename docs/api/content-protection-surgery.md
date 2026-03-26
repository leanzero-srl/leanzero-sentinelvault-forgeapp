# Surgical Content Protection: Embed-Level Restoration

## Problem

When `pageContentTrigger()` detects that a sealed attachment embed was removed from a page, it reverts the **entire page** to the previous version. This discards all legitimate edits (text, formatting, new content) made alongside the embed removal.

## Current Flow

1. `avi:confluence:updated:page` event fires
2. `pageContentTrigger()` in `src/server/triggers.js` handles it
3. Fetches current page ADF via `readDocBody(pageId)`
4. Extracts all media file IDs via `collectMediaFileIds(adfDoc)`
5. Compares against sealed file IDs from KVS (`protection-{attachmentId}` records)
6. If any sealed media is absent → fetches the previous version ADF and writes it back wholesale

**Result:** Every change the editor made is lost, not just the embed removal.

## Desired Behavior

Only restore the specific removed embed blocks. All other page edits should be preserved.

## ADF Structure of Attachment Embeds

Confluence stores page content in Atlassian Document Format (ADF). Attachment embeds appear as `media` nodes, typically wrapped in a `mediaSingle` parent:

```json
{
  "type": "mediaSingle",
  "attrs": { "layout": "center", "width": 100 },
  "content": [
    {
      "type": "media",
      "attrs": {
        "type": "file",
        "id": "<fileId>",
        "collection": "<collection>",
        "width": 800,
        "height": 600
      }
    }
  ]
}
```

- `media.attrs.id` is the **fileId** (not the attachment REST ID)
- `mediaSingle` is a top-level block in `adfDoc.content[]`
- Media can also appear nested inside `table`, `expand`, `layoutSection`, or `bodiedExtension` nodes

The existing `collectMediaFileIds()` in `doc-surgery.js` recursively walks the ADF tree and returns a `Set<fileId>` for all `media` nodes where `attrs.type === "file"`.

## Surgical Restoration Strategy

### 1. Identify violated file IDs

Already done — the `violations` array contains `{ seal, fileId }` pairs where `fileId` is absent from the current ADF.

### 2. Extract embed blocks from the previous version

Walk the previous version's top-level `adfDoc.content[]` array. For each top-level block, check (via `collectMediaFileIds`) whether it contains any of the violated file IDs. If so, deep-clone that block.

This means:
- A standalone `mediaSingle` → extracted directly
- A `media` inside a `table` → the entire `table` block is extracted (extracting just a cell would produce invalid ADF)

### 3. Append extracted blocks to the current ADF

Insert the cloned blocks at the end of the current `adfDoc.content[]`. Attempting to restore original position is fragile because surrounding content may have changed.

### 4. Write patched ADF back

Use `writeDocBody()` with the current page's version number (not the previous version), preserving all other edits.

## Edge Cases

| Scenario | Handling |
|----------|----------|
| Media moved within page (not removed) | No violation fires — `fileId` is still present |
| Multiple sealed embeds in same block | Block extracted once (deduplication by top-level node) |
| Media inside a table/expand/layout | Entire containing top-level block is re-appended |
| Previous version also missing the media | `restoredNodes.length === 0` guard — skip restoration, log warning |
| App's own write triggers another event | Existing loop prevention: `atlassianId === appAccountId` early return |
| Version conflict on write | Retry up to 3 times with exponential backoff (existing pattern) |

## Confluence API Endpoints Used

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/wiki/api/v2/pages/{id}?body-format=atlas_doc_format` | GET | Read current page ADF |
| `/wiki/api/v2/pages/{id}?body-format=atlas_doc_format&version={n}` | GET | Read specific version ADF |
| `/wiki/api/v2/pages/{id}` | PUT | Write patched ADF back |

The PUT payload requires the double-stringify pattern for ADF:
```json
{
  "body": {
    "representation": "atlas_doc_format",
    "value": "<JSON-stringified ADF>"
  },
  "version": {
    "number": "<current + 1>",
    "message": "(Sentinel Vault restored protected attachment embeds)"
  }
}
```

## Key Files

| File | Role |
|------|------|
| `src/server/triggers.js` | `pageContentTrigger()` — detection and restoration logic |
| `src/server/infra/doc-surgery.js` | ADF utilities — `readDocBody`, `writeDocBody`, `collectMediaFileIds` |
