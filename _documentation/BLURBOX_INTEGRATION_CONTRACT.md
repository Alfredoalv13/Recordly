# BlurBox Integration Contract (VybeClip side)

VybeClip and [BlurBox](https://github.com/a3BlurBox/BlurBox) are separate
apps with no runtime coupling. This is VybeClip's side of the one
integration point between them — a local file BlurBox writes and VybeClip
reads. The authoritative version of this contract lives in BlurBox's repo at
`BlurBox_Foundational_Documents/26_VybeClip_Integration_Contract.md`; this
document mirrors it for VybeClip developers and must be kept in sync if
either side changes.

## What this enables

While recording, a user sometimes covers sensitive on-screen content with a
BlurBox overlay. The window between the content appearing and it being
fully covered is an awkward moment VybeClip can auto-detect and suggest
trimming from the finished recording — see
`src/components/video-editor/timeline/redactionSuggestionUtils.ts` for the
detection/clustering logic and
`src/components/video-editor/timeline/RedactionSuggestionsPanel.tsx` for the
review UI.

## The file

```
~/Library/Application Support/BlurBox/redaction-events.jsonl
```

JSON Lines, one event per line, append-only, written by BlurBox only when
its "help VybeClip auto-cut redaction fumbles" preference is on (default
off). VybeClip only ever reads this file — never writes to it.

Path resolution: `electron/ipc/blurbox/eventLog.ts`'s
`getBlurBoxEventLogPath()`. macOS-only (returns `null` on every other
platform). Supports a `RECORDLY_BLURBOX_EVENT_LOG_PATH_OVERRIDE` env var for
local testing — see `_documentation/BLURBOX_INTEGRATION_TESTING.md`.

## Event schema (`v: 1`)

| field | type | present on | notes |
|---|---|---|---|
| `v` | int | always | Schema version. Lines with an unrecognized `v` are skipped, not treated as an error — see `parseBlurBoxEventLine` in `eventLog.ts`. |
| `type` | string enum | always | `create_action_started` \| `overlay_created` \| `overlay_updated` \| `overlay_removed` |
| `ts` | int (epoch ms) | always | Directly comparable to `Date.now()` — same machine, same clock. |
| `overlayId` | UUID string | all except `create_action_started` | No overlay exists yet when a create action starts. |
| `frame` | `{x,y,width,height}` | `overlay_created` / `overlay_updated` | Position/size only — parsed but not currently used downstream of `eventLog.ts` (dropped by `normalizeBlurBoxEvents`). |
| `action` | `"instant" \| "drag"` | `create_action_started` only | Which BlurBox hotkey path started this. |

VybeClip's read path (`electron/ipc/register/blurbox.ts`'s
`get-blurbox-redaction-events` handler) never throws on a malformed line,
an unrecognized schema version, or a missing file — all degrade to "no
events," never a crash or a broken read of the rest of the file.

## Correlation

Raw events are wall-clock timestamps; VybeClip needs them as video-relative
elapsed milliseconds. `electron/ipc/recordingClock.ts`'s
`mapWallClockToElapsedMs()` does this, walking the recording's actual
pause/resume history (`recordingPauseIntervals` in `electron/ipc/state.ts`)
rather than a running total — required because a naive running-total
subtraction is wrong for a *historical* timestamp read back after the fact
(see that file's doc comment for why).

**Scope limitation, by design:** correlation only works for a recording
finished in the *current* VybeClip app session — the clock anchors
(`cursorCaptureStartTimeMs`, `recordingStoppedAtMs`) are in-memory only, not
persisted to a sidecar file. This matches the existing auto-zoom feature's
own scope (computed only for a freshly-loaded recording, never for
reopening an old project from a previous session) and avoided needing to
hook into any capture-backend-specific finalization code. If this
limitation ever needs lifting, the natural fix is a persisted sidecar
(mirroring `${videoPath}.cursor.json`) written at recording-stop time —
deliberately not done here to keep this feature's blast radius small.

## What VybeClip does with it

`redactionSuggestionUtils.ts` clusters raw events into episodes, merges
nearby ones, and filters/flags by duration — see that file's doc comments
for the exact algorithm. Nothing is ever applied to the timeline
automatically; `RedactionSuggestionsPanel.tsx` requires an explicit Accept
per suggestion (or Accept All) before anything is cut, reusing the existing
`applySilenceSpansToClipRegions` excision logic so acceptance lands on the
normal undo stack.

## Versioning

Any change to the meaning of an existing field, or removal of a field
either side depends on, requires bumping `v` on BOTH sides and updating
both copies of this contract. Purely additive fields don't require a bump,
but should still be documented in both places.
