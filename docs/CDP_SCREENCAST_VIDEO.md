# CDP Screencast Video Recording

Pixel-based video recording that runs alongside rrweb DOM recording. Every session gets two recordings: rrweb captures DOM semantics (network, console, interactions), screencast captures pixel truth (what the browser actually rendered).

## Architecture

```
Per session (parallel):
  rrweb:       DOM events → JSON file → Svelte player     (/recordings/{id}/player)
  screencast:  CDP frames → PNG files → ffmpeg → HLS TS   (/recordings/{id}/video/player)
```

Both recordings start when a session begins and stop when it ends. rrweb results are available immediately. Video encoding is **deferred** — frames stay on disk until someone visits the video player, then encoding triggers on-demand. Most sessions are never watched, so this avoids wasting CPU on encoding unwatched videos.

Previously, the Pydoll scraper ran its own video recording pipeline: `Page.captureScreenshot` at 5fps → Canvas → MediaRecorder → WebM → R2 upload. This was ~430 lines of Python (`screencast_recorder.py`) working around browser limitations. Moving recording to Browserless eliminated that code entirely — Pydoll just receives a `videoPlayerUrl` in the CDP event.

## How It Works

### 1. Frame Capture (`src/session/screencast-capture.ts`)

Uses CDP's `Page.startScreencast` to receive PNG frames whenever the page visually changes. This is event-driven (not polling) — Chrome sends frames only when pixels change.

**Why PNG over JPEG:** PNG encoding is trivial for Chrome compared to JPEG's lossy compression, freeing CPU for the customer's automation (Turnstile solving, network interception). Lossless PNGs also produce better H.264 output — ffmpeg compresses clean pixels instead of re-encoding JPEG artifacts. Frames go to local disk (`/tmp`), so the larger file size (~1-2MB vs ~50-100KB per frame) is negligible.

**Per target (tab):**

```
Page.startScreencast({ format: 'png', maxWidth: 1280, maxHeight: 720 })
  ↓
Page.screencastFrame event → write PNG to disk → Page.screencastFrameAck → next frame
```

Frame acknowledgment (`screencastFrameAck`) is required. Without it, Chrome stops sending frames. This provides natural backpressure — if disk I/O is slow, Chrome pauses frame delivery.

Frames are saved as `{timestamp_ms}.png` in `/tmp/browserless-recordings/{sessionId}/frames/`.

**Static page fallback:** If no screencast frame arrives within 2 seconds, `Page.captureScreenshot` fires. This handles pages like Turnstile's "Just a moment..." where nothing visually changes but we still want periodic frames.

### 2. Integration with RecordingCoordinator (`src/session/recording-coordinator.ts`)

Screencast capture hooks into the same raw WebSocket connection and `Target.setAutoAttach` flow used by rrweb:

```
Target.attachedToTarget (page target)
  ├── Page.addScriptToEvaluateOnNewDocument (rrweb)     ← existing
  ├── Runtime.runIfWaitingForDebugger                    ← existing
  └── screencastCapture.addTarget(sessionId, ...)        ← screencast starts here
```

The `Page.screencastFrame` events arrive as top-level WebSocket messages (due to `flatten: true`). The coordinator's message handler routes them to `ScreencastCapture.handleFrame()`.

When a target is destroyed, `handleTargetDestroyed()` removes it from the active set. When recording stops, `stopCapture()` sends `Page.stopScreencast` to all active targets and returns the frame count.

### 3. Video Encoding (`src/video/encoder.ts`)

Encoding is **lazy** — frames sit on disk with status `deferred` until someone visits the video player page. The player route detects `deferred` status, updates it to `pending`, and queues encoding. This saves CPU for scrapers since most sessions (~92%) are never replayed.

When encoding is triggered, frames are encoded to **HLS MPEG-TS segments** in a background queue. The key design (inspired by [Browserbase's approach](../docs/This%20week%20we%20fixed%20the%20worst%20part%20of%20Browserbase%20(1).md)): the playlist is **pre-generated before encoding starts**, so the player can load immediately and see the full duration.

**Step 1 — Generate concat file** (variable framerate from frame timestamps):

```
file 'frames/1706540000000.png'
duration 0.200
file 'frames/1706540000200.png'
duration 1.800
file 'frames/1706540002000.png'
duration 0.033
```

Durations are clamped: minimum 33ms (~30fps), maximum 10s (caps long static gaps). Last frame holds for 1 second. Total duration is accumulated during this step.

**Step 2 — Pre-generate complete VOD playlist:**

Using the accumulated `totalDuration`, a complete `playlist.m3u8` is written to disk **before ffmpeg starts**:

```
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:11
#EXT-X-PLAYLIST-TYPE:VOD
#EXTINF:10.000000,
seg000.ts
#EXTINF:10.000000,
seg001.ts
#EXTINF:5.230000,
seg002.ts
#EXT-X-ENDLIST
```

The player loads this immediately — `#EXT-X-PLAYLIST-TYPE:VOD` + `#EXT-X-ENDLIST` tells hls.js the full duration is known. Segment durations are estimates (exact durations come from ffmpeg later).

**Step 3 — Run ffmpeg (writes to temp `_encoding.m3u8`):**

```
ffmpeg -f concat -safe 0 -i frames.txt \
  -c:v libx264 -preset ultrafast -crf 28 \
  -pix_fmt yuv420p \
  -force_key_frames 'expr:gte(t,n_forced*10)' \
  -f hls -hls_time 10 -hls_list_size 0 \
  -hls_playlist_type vod \
  -hls_segment_filename 'seg%03d.ts' \
  -y _encoding.m3u8
```

- `concat` demuxer: variable framerate from timestamp deltas
- `libx264` / `ultrafast` / `crf 28`: prioritizes encoding speed over file size. The player plays at 4x, consuming a 10-second segment in 2.5s — encoding must outpace this. `ultrafast` is ~5-10x faster than `fast` (disables B-frames, CABAC, complex motion estimation). `crf 28` (vs 23) further reduces encoding work. Segments are ~2x larger but still small (~150-400KB). Quality is slightly softer but fine for screencast recordings of web pages. If tiny text readability matters, drop CRF back to 23 and keep `ultrafast`.
- `yuv420p`: browser-compatible pixel format
- `-force_key_frames`: ensures keyframes align to 10-second segment boundaries
- MPEG-TS segments (`.ts`): universal browser compatibility via hls.js transmuxing (see "Why MPEG-TS, not fMP4" below)
- `-hls_time 10`: 10-second segments
- Writes to `_encoding.m3u8` (temp) to avoid overwriting the pre-generated playlist

**Step 4 — Replace playlist with ffmpeg's exact version.** After encoding completes, `rename(_encoding.m3u8, playlist.m3u8)` replaces the estimated durations with ffmpeg's exact values.

**Step 5 — Clean up frames directory.** On failure, frames are kept for debugging.

**Sequential queue:** Only one encode runs at a time. With 20 concurrent sessions, this prevents CPU spikes from parallel ffmpeg processes. Encoding is I/O-bound anyway (reading PNGs, writing segments).

**5-minute timeout:** Each ffmpeg process is killed after 5 minutes to prevent hangs.

#### Why MPEG-TS, not fMP4

Browserbase uses fMP4 segments (`.m4s` + `init.mp4`) for their HLS. We tried this across 3 deploys and every attempt produced **black screens in Chrome**. We never identified the exact root cause — the files looked correct but Chrome MSE wouldn't render them.

**What we tried (3 deploys, all black screens):**

1. **`-hls_segment_type fmp4`** — ffmpeg produced `.m4s` segments + `init.mp4`. ffprobe confirmed valid H.264 (High profile, level 31, yuv420p, 1280x662). Chrome showed the player controls and correct duration but rendered black video. Others have hit this: [Bitmovin community report](https://community.bitmovin.com/t/playback-issue-with-ffmpeg-generated-hls-stream-using-fmp4-segments-on-chrome-edge/3053).

2. **Added `-movflags +cmaf+delay_moov+skip_trailer`** — Made it worse: no player controls rendered at all, just a black rectangle. The HLS muxer internally sets its own movflags (`frag_custom+dash+delay_moov`), and explicit `-movflags` **overrides** these, breaking fMP4 output entirely. This is in the [ffmpeg formats docs](https://ffmpeg.org/ffmpeg-formats.html) but easy to miss. **Lesson: never pass `-movflags` when using `-f hls -hls_segment_type fmp4`.**

3. **Removed `-movflags`, added `-bf 0` (disable B-frames) + `-hls_flags independent_segments`** — Controls came back, duration showed correctly, but video was still black. `-bf 0` eliminated edit lists (`edts/elst`) in the init segment which we thought was the cause. ffprobe confirmed no edit lists, valid codec params, correct file sizes. Still black.

**What we verified wasn't the problem:**
- Init segment structure: no edit lists, correct `avcC` box, proper codec parameters
- File serving: 200 status, correct content types (`video/mp4`), correct file sizes
- Playlist format: valid `#EXT-X-VERSION:7`, `#EXT-X-MAP:URI="init.mp4"`, `#EXT-X-ENDLIST`
- Encoding output: ffmpeg exited 0, all segments present on disk

**Actual root cause: unknown.** The files were structurally valid according to ffprobe but Chrome MSE rendered black. We stopped debugging after 3 failed deploys and switched to MPEG-TS which worked immediately on the first try. Suspected causes we didn't have time to verify:
- hls.js version bundled in `hls-video-element@1.2` may have fMP4 bugs
- Variable framerate from the concat demuxer may produce timing metadata that MSE can't handle in fMP4 passthrough mode (TS transmuxing normalizes this)
- Something specific to ffmpeg 8.0.1's HLS fMP4 muxer that Chrome rejects but Safari accepts
- Possibly needs explicit `codec` attribute in the `#EXT-X-STREAM-INF` tag for MSE to initialize correctly

**Why TS works:** When hls.js receives MPEG-TS segments, it **transmuxes** them to fMP4 internally before feeding them to MSE. This transmuxing normalizes timing, codec parameters, and container structure — papering over whatever ffmpeg quirk Chrome objected to. When you give hls.js raw fMP4 (passthrough mode), it skips transmuxing and passes segments directly to MSE, exposing the problem.

**What fMP4 would have given us (and why it doesn't matter):**

| fMP4 advantage | Reality for our use case |
|----------------|------------------------|
| ~10-15% smaller segments (no 188-byte TS packet overhead) | Our segments are 70-370KB. Saving ~30KB per segment is irrelevant for single-viewer playback. |
| No client-side transmuxing (fMP4 passes directly to MSE) | hls.js transmuxes TS→fMP4 in <1ms per segment on any modern machine. Invisible. |
| Better seeking precision (`sidx` index boxes in fMP4) | Doesn't matter for 10-60 second screencast recordings. |
| CMAF compatibility (same segments for HLS + DASH) | We only use HLS. No DASH clients. |

These benefits would matter at scale (thousands of concurrent viewers, multi-hour recordings, dual HLS+DASH delivery). Browserbase needs fMP4 because they serve at scale with parallel encoding. We encode one video at a time for one viewer.

**Bottom line:** MPEG-TS works in every browser with zero compatibility issues. The tradeoffs are negligible for our use case. Don't try fMP4 again unless you control the muxer at the byte level (custom binary patching of `base_media_decode_time` like Browserbase does, not ffmpeg's built-in HLS muxer).

**References:**
- [Bitmovin: fMP4 HLS works in Safari but not Chrome/Edge](https://community.bitmovin.com/t/playback-issue-with-ffmpeg-generated-hls-stream-using-fmp4-segments-on-chrome-edge/3053)
- [hls.js #7142: incomplete avcC box causes TypeError](https://github.com/video-dev/hls.js/issues/7142)
- [ffmpeg HLS muxer internal movflags conflict](https://ffmpeg.org/ffmpeg-formats.html)

### 4. Storage

```
/tmp/browserless-recordings/
  ├── recordings.db              # SQLite metadata
  ├── {sessionId}.json           # rrweb events (unchanged)
  └── {sessionId}/
      ├── playlist.m3u8          # HLS playlist (pre-generated, then replaced with ffmpeg's)
      ├── seg000.ts              # MPEG-TS video segments (10s each)
      ├── seg001.ts
      ├── ...
      └── frames/                # temp PNGs (deleted after encoding)
```

SQLite schema additions:

| Column | Type | Purpose |
|--------|------|---------|
| `frameCount` | INTEGER | Number of screencast frames captured |
| `videoPath` | TEXT | Path to HLS playlist file |
| `encodingStatus` | TEXT | `none` \| `deferred` → `pending` → `encoding` → `completed` \| `failed` |

Migration is automatic — `ALTER TABLE ADD COLUMN` with error catch for "column already exists".

### 5. Serving (`src/routes/management/http/`)

**`/recordings/{id}/video/hls/{filename}`** — Serves HLS playlist and segment files. Content types: `.m3u8` → `application/vnd.apple.mpegurl`, `.ts` → `video/mp2t`, `.m4s`/`.mp4` → `video/mp4` (legacy fMP4 compat). Playlist is served with `no-cache`; segments are `immutable` with 1-hour cache.

**Wait-for-file:** When a segment is requested during active encoding, the route polls for the file to appear on disk (up to 30 seconds, 200ms interval) instead of returning 404. This allows the player to request segments that ffmpeg hasn't produced yet — they arrive as soon as ffmpeg writes them.

**`/recordings/{id}/video/player`** — HLS video player page using `hls-video-element` + `media-chrome`. For both encoding-in-progress and completed states, the player loads the HLS playlist immediately:

| `encodingStatus` | Player shows |
|------------------|-------------|
| `completed` | HLS player with autoplay at 4× speed |
| `deferred` | Triggers encoding, then shows HLS player + progress text (transitions to `pending`) |
| `pending` / `encoding` | HLS player loads pre-generated playlist (full duration visible) + progress text below |
| `failed` | Error message with frame count |
| `none` (0 frames) | "No video available" + link to DOM replay |

**Mid-encoding playback flow:**
1. Player page renders with `src` pointing to `playlist.m3u8` (already on disk)
2. hls.js loads playlist → sees `#EXT-X-ENDLIST` → shows full duration in seek bar
3. hls.js requests `seg000.ts` → HLS route waits for ffmpeg to produce it → served
4. hls.js transmuxes TS → fMP4 internally → feeds to MSE → video renders
5. Player plays at 4× speed (consumes 10s segment in 2.5s real-time)
6. ffmpeg encodes faster than 4× playback → segments ready ahead of playhead
7. Progress text shows below player: "356 / 619 frames (58%)"
8. Encoding completes → ffmpeg's exact playlist replaces estimated one → text fades

### 6. CDP Event (`Browserless.recordingComplete`)

When a session ends, Browserless injects a custom CDP event into the client's WebSocket connection. The event now includes video fields:

```typescript
{
  id: string;              // session ID
  trackingId: string;      // unique session tracking ID
  duration: number;        // recording duration (ms)
  eventCount: number;      // rrweb events captured
  frameCount: number;      // screencast frames captured
  encodingStatus: string;  // 'deferred' | 'none'
  playerUrl: string;       // rrweb player URL
  videoPlayerUrl: string;  // video player URL
}
```

The Pydoll scraper receives this via `_get_recording_metadata_via_kill()` in `browser.py` and stores it on the `ScrapeContext` for the wide event. The `videoPlayerUrl` appears in Grafana dashboards as a clickable link.

Note: `encodingStatus` will be `'deferred'` at event emission time (encoding hasn't started yet — it triggers when someone visits the video player). The video player page handles the transition from `deferred` → `pending` → `encoding` → `completed` with auto-refresh.

## ffmpeg in Docker

The base Dockerfile uses a multi-stage `COPY --from` to include static ffmpeg binaries:

```dockerfile
COPY --from=mwader/static-ffmpeg:8.0.1 /ffmpeg /usr/bin/ffmpeg
COPY --from=mwader/static-ffmpeg:8.0.1 /ffprobe /usr/bin/ffprobe
```

This replaced a `wget` download from johnvansickle.com:
- **Pinned version** (7.1) — reproducible builds
- **No external download** — build doesn't fail if johnvansickle.com is down
- **Docker layer caching** — the `mwader/static-ffmpeg:8.0.1` image is pulled once and cached
- **Static PIE binaries** — no runtime dependencies, works on any Linux

## Lazy Encoding

Most recorded sessions are never watched. Encoding every session wastes CPU that should be running scrapers. The lazy encoding flow defers encoding until someone actually visits the video player.

### Status State Machine

```
Session ends (frameCount > 0):
  → 'deferred'     (frames on disk, no encoding)

Someone visits video player:
  → 'pending'       (queued for encoding)
  → 'encoding'      (playlist.m3u8 pre-generated, ffmpeg producing segments)
  → 'completed'     (HLS segments ready, frames cleaned up)
     or 'failed'    (ffmpeg error, frames kept)

Session ends (frameCount = 0):
  → 'none'          (no frames captured)
```

### On-Demand Trigger

The video player route (`recording-video-player.get.ts`) detects `deferred` status and:
1. Updates status to `pending` in SQLite
2. Calls `encoder.queueEncode()` to start background encoding
3. Renders the HLS player page with `src` already set (playlist is pre-generated before ffmpeg starts)
4. Progress text polls status endpoint every 1 second, fades when encoding completes

A duplicate guard in `queueEncode()` prevents double-encoding when two viewers race.

### Container Restart with Deferred Frames

`cleanupOrphans()` deletes frame directories on startup. Status stays `deferred` in SQLite. Next player visit triggers encode, encoder sees no frames directory → sets status to `failed`. Player shows "Encoding failed". The rrweb replay is still available.

## Edge Cases

**Static pages (Turnstile):** The 2-second fallback timer fires `Page.captureScreenshot` when `Page.screencastFrame` stops arriving. This ensures the "Just a moment..." interstitial page still produces frames.

**Concurrent sessions:** ~10 MB/min per session in raw frames × 20 concurrent = ~200 MB/min peak. Frames are deleted after encoding completes. TS segments (~70-370KB each) persist. The sequential encoding queue prevents CPU spikes.

**Container restart during encoding:** Orphaned frame directories on disk. `VideoEncoder.cleanupOrphans()` removes them on startup by scanning for directories with a `frames/` subdirectory.

**Encoding failure:** Status set to `failed`, frames kept on disk for debugging. The video player page shows an error message.

**Target destroyed mid-capture:** `handleTargetDestroyed()` removes the target from the active set. Other targets in the same session continue capturing. The fallback timer is tied to the last active target.

## File Map

| File | Role |
|------|------|
| `src/session/screencast-capture.ts` | CDP screencast frame capture + fallback screenshots |
| `src/video/encoder.ts` | Background ffmpeg encoding queue |
| `src/session/recording-coordinator.ts` | Orchestrates rrweb + screencast per session |
| `src/session-replay.ts` | Recording lifecycle + metadata |
| `src/recording-store.ts` | SQLite storage with video columns |
| `src/interfaces/recording-store.interface.ts` | `RecordingMetadata` type with video fields |
| `src/cdp-proxy.ts` | `RecordingCompleteParams` interface + event emission |
| `src/session/session-lifecycle-manager.ts` | Constructs + sends CDP event on session close |
| `src/routes/.../recording-video-hls.get.ts` | HLS playlist + segment serving with wait-for-file |
| `src/routes/.../recording-video-player.get.ts` | HLS video player page (media-chrome + hls-video-element) |
| `src/routes/.../recording-video-status.get.ts` | Encoding progress JSON endpoint |
| `docker/base/Dockerfile` | ffmpeg binary via `COPY --from` |
