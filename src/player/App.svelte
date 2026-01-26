<script lang="ts">
  import { onMount } from 'svelte';
  import Player from './Player.svelte';
  import InspectorList from './Inspector/InspectorList.svelte';
  import InspectorControls from './Inspector/InspectorControls.svelte';
  import {
    events,
    metadata,
    currentTime,
    networkItems,
    consoleItems,
    markerItems,
    filters,
  } from './stores/player';
  import type { Recording, ReplayEvent, RecordingMetadata } from './types';

  export let recording: Recording;

  let player: Player;

  // Initialize stores with recording data
  $: if (recording) {
    $events = recording.events;
    $metadata = recording.metadata;
  }

  $: startTime = $metadata?.startedAt || 0;
  $: durationSeconds = $metadata ? Math.round($metadata.duration / 1000) : 0;
  $: startDate = $metadata ? new Date($metadata.startedAt).toISOString().split('T')[0] : '';
  $: displayId = $metadata?.trackingId || $metadata?.id?.slice(0, 12) || 'Unknown';

  // Extract viewport dimensions from rrweb meta event (type 4)
  // This ensures the player matches the recorded viewport size
  function getViewportFromRecording(events: ReplayEvent[]): { width: number; height: number } {
    const metaEvent = events.find((e) => e.type === 4);
    if (metaEvent && typeof metaEvent.data === 'object' && metaEvent.data !== null) {
      const data = metaEvent.data as { width?: number; height?: number };
      console.log('[Player] Meta event viewport:', data.width, 'x', data.height);
      if (data.width && data.height) {
        // Scale down to fit in reasonable player size (max 1280x720)
        const maxWidth = 1280;
        const maxHeight = 720;
        const scale = Math.min(maxWidth / data.width, maxHeight / data.height, 1);
        console.log('[Player] Scaled viewport:', Math.round(data.width * scale), 'x', Math.round(data.height * scale), 'scale:', scale);
        return {
          width: Math.round(data.width * scale),
          height: Math.round(data.height * scale),
        };
      }
    }
    console.log('[Player] Using fallback viewport: 1024x576');
    // Fallback to 16:9 default
    return { width: 1024, height: 576 };
  }

  $: viewport = recording ? getViewportFromRecording(recording.events) : { width: 1024, height: 576 };

  // CSS rules to inject during replay for third-party widgets that lose styles (CORS)
  // Cloudflare Turnstile widget - the white box/container styles are cross-origin
  const insertStyleRules = [
    // Turnstile container - recreate the white box appearance
    `.cf-turnstile, [data-turnstile-widget], iframe[src*="challenges.cloudflare.com"] {
      background: #fff !important;
      border: 1px solid #e5e5e5 !important;
      border-radius: 4px !important;
      min-width: 300px !important;
      min-height: 65px !important;
      display: flex !important;
      align-items: center !important;
      justify-content: center !important;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1) !important;
    }`,
    // reCAPTCHA v2/v3 widgets
    `.g-recaptcha, [data-sitekey], iframe[src*="google.com/recaptcha"] {
      background: #f9f9f9 !important;
      border: 1px solid #d3d3d3 !important;
      border-radius: 3px !important;
      min-width: 302px !important;
      min-height: 76px !important;
      box-shadow: 0 0 1px rgba(0,0,0,0.1) !important;
    }`,
  ];

  function handleSeek(event: CustomEvent<{ timestamp: number }>) {
    if (!player || !$metadata) return;
    const offset = Math.max(0, event.detail.timestamp - $metadata.startedAt - 1000);
    player.goto(offset);
  }

  function handleTimeUpdate(event: CustomEvent<{ payload: number }>) {
    $currentTime = event.detail.payload;
  }

  // Get query params
  function getQueryParams() {
    const params = new URLSearchParams(window.location.search);
    return {
      speed: parseFloat(params.get('speed') || '4'),
      autoPlay: params.get('autoplay') !== 'false',
    };
  }

  $: queryParams = getQueryParams();

  // Tab state for inspector filtering
  let activeTab: 'all' | 'network' | 'console' | 'markers' = 'all';

  function setTab(tab: typeof activeTab) {
    activeTab = tab;
    if (tab === 'all') {
      $filters = { ...$filters, network: true, console: true, markers: true };
    } else {
      $filters = {
        ...$filters,
        network: tab === 'network',
        console: tab === 'console',
        markers: tab === 'markers',
      };
    }
  }
</script>

<style>
  :root {
    --bg-primary: #1d1f27;
    --bg-secondary: #151619;
    --bg-surface: #232429;
    --border-color: #3c3f47;
    --text-primary: #fff;
    --text-secondary: #9ba0ab;
    --text-tertiary: #6b7280;
    --accent: #f97316;
    --accent-hover: #fb923c;
    --success: #22c55e;
    --warning: #f59e0b;
    --danger: #ef4444;
    --info: #3b82f6;
  }

  :global(*) {
    box-sizing: border-box;
  }

  :global(body) {
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Inter', 'Segoe UI', Roboto, sans-serif;
    background: var(--bg-secondary);
    color: var(--text-primary);
    min-height: 100vh;
    font-size: 13px;
  }

  .app-container {
    display: flex;
    height: 100vh;
  }

  /* Sidebar */
  .sidebar {
    width: 420px;
    background: var(--bg-primary);
    border-right: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    position: relative;
    z-index: 1;
  }

  .sidebar-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-surface);
  }

  .back-link {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    color: var(--text-secondary);
    text-decoration: none;
    font-size: 12px;
    margin-bottom: 8px;
    transition: color 0.15s;
  }

  .back-link:hover {
    color: var(--text-primary);
  }

  .sidebar-header h2 {
    margin: 0 0 6px;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
  }

  .metadata-row {
    display: flex;
    flex-wrap: wrap;
    gap: 4px 12px;
    font-size: 11px;
    color: var(--text-tertiary);
  }

  /* Summary tabs */
  .summary-tabs {
    display: flex;
    border-bottom: 1px solid var(--border-color);
    background: var(--bg-primary);
    padding: 0 8px;
  }

  .summary-tab {
    padding: 10px 12px;
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 13px;
    font-weight: 500;
    transition: all 0.15s;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }

  .summary-tab:hover {
    color: var(--text-primary);
  }

  .summary-tab.active {
    color: var(--text-primary);
    border-bottom-color: var(--accent);
  }

  .tab-badge {
    background: var(--bg-surface);
    color: var(--text-tertiary);
    padding: 1px 6px;
    border-radius: 10px;
    font-size: 11px;
    margin-left: 6px;
    font-weight: 400;
  }

  .summary-tab.active .tab-badge {
    background: var(--accent);
    color: var(--text-primary);
  }

  /* Main content */
  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 24px;
    background: var(--bg-secondary);
  }

  .player-wrapper {
    border-radius: 8px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
    border: 1px solid var(--border-color);
  }

  /* Empty state */
  .no-events {
    color: var(--text-tertiary);
    text-align: center;
    padding: 40px;
  }

  /* Responsive adjustments */
  @media (max-width: 1200px) {
    .sidebar {
      width: 360px;
    }
  }

  @media (max-width: 900px) {
    .app-container {
      flex-direction: column;
    }

    .sidebar {
      width: 100%;
      height: 40vh;
    }

    .main-content {
      height: 60vh;
    }
  }
</style>

<div class="app-container">
  <aside class="sidebar">
    <div class="sidebar-header">
      <a href="/recordings" class="back-link">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M19 12H5M12 19l-7-7 7-7" />
        </svg>
        Recordings
      </a>
      <h2>{displayId}</h2>
      <div class="metadata-row">
        <span>{$metadata?.browserType || 'Unknown'}</span>
        <span>{durationSeconds}s</span>
        <span>{$metadata?.eventCount || 0} events</span>
        <span>{startDate}</span>
      </div>
    </div>

    <div class="summary-tabs">
      <button class="summary-tab" class:active={activeTab === 'all'} on:click={() => setTab('all')}>
        All
        <span class="tab-badge">{$networkItems.length + $consoleItems.length + $markerItems.length}</span>
      </button>
      <button class="summary-tab" class:active={activeTab === 'network'} on:click={() => setTab('network')}>
        Network
        <span class="tab-badge">{$networkItems.length}</span>
      </button>
      <button class="summary-tab" class:active={activeTab === 'console'} on:click={() => setTab('console')}>
        Console
        <span class="tab-badge">{$consoleItems.length}</span>
      </button>
      <button class="summary-tab" class:active={activeTab === 'markers'} on:click={() => setTab('markers')}>
        Markers
        <span class="tab-badge">{$markerItems.length}</span>
      </button>
    </div>

    <InspectorControls />
    <InspectorList on:seek={handleSeek} />
  </aside>

  <main class="main-content">
    {#if recording && recording.events.length > 0}
      <div class="player-wrapper">
        <Player
          bind:this={player}
          events={recording.events}
          width={viewport.width}
          height={viewport.height}
          autoPlay={queryParams.autoPlay}
          speed={queryParams.speed}
          showController={true}
          speedOption={[0.5, 1, 2, 4, 8]}
          skipInactive={true}
          {insertStyleRules}
          on:ui-update-current-time={handleTimeUpdate}
        />
      </div>
    {:else}
      <p class="no-events">No events recorded.</p>
    {/if}
  </main>
</div>
