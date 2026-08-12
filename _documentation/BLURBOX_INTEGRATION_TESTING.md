# Testing the BlurBox Redaction-Cut Integration

This feature spans two separate, independently-built apps (VybeClip and
[BlurBox](https://github.com/a3BlurBox/BlurBox)) with no shared test harness
or CI between the two repos. There is no realistic way to automate a true
cross-app end-to-end test without significant new shared infrastructure —
this document is a manual QA script instead, plus a fixture-based path for
exercising VybeClip's side alone without BlurBox installed.

See `BlurBox_Foundational_Documents/26_VybeClip_Integration_Contract.md` in
the BlurBox repo (mirrored conceptually here) for the authoritative schema —
the two must stay in sync; this doc doesn't restate it in full.

## Option A — Full manual QA (both apps)

Requires both apps built/running on the same Mac.

1. In BlurBox, open **Preferences** and enable **"Help VybeClip auto-cut
   redaction fumbles."**
2. In VybeClip, start a screen recording.
3. Pause and resume the recording at least once partway through — this
   exercises the pause-aware correlation math (`recordingClock.ts`), not
   just the simple no-pause case.
4. While still recording, trigger **both** BlurBox creation paths at least
   once each, with a few seconds of normal recording in between:
   - `⌃⌥⌘B` (instant-create), then drag the box into place over something.
   - `⌃⌥⌘V` (drag-to-create), draw a box directly over something.
5. Stop the recording and let VybeClip open it in the editor.
6. **Expected:** within a moment, the redaction-suggestions panel
   (bottom-right) appears listing the detected windows.
7. Click a suggestion to confirm the playhead seeks to roughly the right
   moment. Accept one, Reject another, use Accept All if more than one
   remains. Confirm accepted cuts actually remove the range from the
   timeline (and that `Cmd+Z` undoes it — acceptance should be a normal
   entry on the undo stack, not special-cased).
8. Export the video and confirm the accepted cut(s) are actually gone from
   the output.
9. Re-run the above with BlurBox's preference **off** — confirm the panel
   never appears and nothing else changes.
10. Re-run with BlurBox not running at all — confirm the same (no panel, no
    errors in the console).

## Option B — VybeClip-only, via the sample fixture

Useful for iterating on the clustering/review-UI without BlurBox installed,
or without repeatedly performing the manual dance above. This only
exercises VybeClip's read → normalize → cluster → review-UI pipeline — it
does not touch BlurBox at all, and does not substitute for Option A before
shipping a change to the correlation logic itself.

`_documentation/fixtures/redaction-events.sample.jsonl` is a hand-written,
schema-valid fixture (multiple overlays, both creation-action kinds, an
overlay removed with no intervening move). Its timestamps are fixed to a
date in the past, so they need to be shifted to fall inside whatever
recording you're about to test with:

```bash
# Regenerate the fixture with timestamps starting ~2s after "now" (leaving
# a moment to start the recording before the first event's ts), matching
# the sample's original relative offsets. Requires jq.
NOW_MS=$(($(date +%s) * 1000 + 2000))
jq -c --argjson base "$NOW_MS" \
  '.ts = (.ts - 1700000000000 + $base)' \
  _documentation/fixtures/redaction-events.sample.jsonl \
  > /tmp/redaction-events.regenerated.jsonl
```

Then point VybeClip's reader at it and start the app:

```bash
RECORDLY_BLURBOX_EVENT_LOG_PATH_OVERRIDE=/tmp/redaction-events.regenerated.jsonl npm run dev
```

Start a recording immediately (within a few seconds, before the fixture's
events "expire" past the recording's end), let it run past the fixture's
last event timestamp, stop, and open in the editor — the panel should
appear with suggestions derived from the fixture instead of a real BlurBox
log.

The override only takes effect on macOS (matching production — BlurBox
integration is a complete no-op on other platforms regardless of the env
var); it has no effect if BlurBox is installed and also writing to the real
log path, since VybeClip only ever reads from the overridden path when the
env var is set.
