<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import {
    filteredItems,
    filters,
    cloudflareSummary,
    isConsoleNoise,
    playbackIndicatorIndex,
    syncScrollPaused,
  } from '../stores/player';
  import type { ConsoleItem, NetworkItem, MarkerItem } from '../types';
  import InspectorItem from './InspectorItem.svelte';
  import { debounce } from '../utils';

  const dispatch = createEventDispatcher();

  let listContainer: HTMLElement;
  let scrollContainer: HTMLElement;
  let mouseHovering = false;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastAutoScrollIndex = -1;

  // Cloudflare grouped view state
  let expandedSections = { markers: true, network: true, console: true };
  let noiseExpanded = false;

  function toggleSection(section: 'markers' | 'network' | 'console') {
    expandedSections = { ...expandedSections, [section]: !expandedSections[section] };
  }

  $: indicatorIndex = $playbackIndicatorIndex;
  $: isCloudflareTab = $filters.cloudflare;
  $: summary = $cloudflareSummary;

  // Group items by type for cloudflare view
  $: cloudflareMarkers = isCloudflareTab
    ? $filteredItems.filter((i): i is MarkerItem => i.type === 'marker')
    : [];
  $: cloudflareNetwork = isCloudflareTab
    ? $filteredItems.filter((i): i is NetworkItem => i.type === 'network')
    : [];
  $: cloudflareConsole = isCloudflareTab
    ? $filteredItems.filter((i): i is ConsoleItem => i.type === 'console')
    : [];
  $: consoleSignal = cloudflareConsole.filter((i) => !isConsoleNoise(i));
  $: consoleNoise = cloudflareConsole.filter((i) => isConsoleNoise(i));

  // Format summary outcome for display
  function formatOutcome(outcome: string | null): string {
    if (!outcome) return 'Pending';
    return outcome.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function formatSummaryDuration(ms: number | null): string {
    if (ms === null) return '';
    return (ms / 1000).toFixed(1) + 's';
  }

  function formatAbsoluteTime(ts: number): string {
    return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
  }

  function isOutcomeSuccess(outcome: string | null): boolean {
    return outcome === 'solved' || outcome === 'auto_solved' || outcome === 'pre_solved';
  }

  // Network category for cloudflare tab
  function getNetworkCategory(item: NetworkItem): string | null {
    const url = item.request?.url || item.response?.url || '';
    if (url.startsWith('blob:')) return 'blob';
    if (url.includes('challenge-platform')) return 'challenge';
    if (url.includes('/pat/')) return 'PAT';
    return null;
  }

  // Auto-scroll to current playback position when not paused
  $: if (!$syncScrollPaused && !mouseHovering && indicatorIndex !== lastAutoScrollIndex && indicatorIndex >= 0 && scrollContainer) {
    lastAutoScrollIndex = indicatorIndex;
    // Scroll to the current item
    tick().then(() => {
      const items = scrollContainer.querySelectorAll('.inspector-item-wrapper');
      if (items[indicatorIndex]) {
        items[indicatorIndex].scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    });
  }

  const handleScroll = debounce(() => {
    if (mouseHovering) {
      $syncScrollPaused = true;
    }
  }, 100);

  function handleMouseEnter() {
    mouseHovering = true;
  }

  function handleMouseLeave() {
    mouseHovering = false;
    // Resume auto-scroll after a short delay
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      $syncScrollPaused = false;
    }, 2000);
  }

  function handleSeek(event: CustomEvent<{ timestamp: number }>) {
    dispatch('seek', event.detail);
  }

  // Icons for empty states
  const networkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="40" height="40"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  const chevronDown = `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z" clip-rule="evenodd"/></svg>`;
  const chevronRight = `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clip-rule="evenodd"/></svg>`;
</script>

<style>
  .inspector-list {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--bg-primary, #1d1f27);
    position: relative;
    min-height: 0; /* Important for flex children to shrink properly */
  }

  .simple-list-container {
    flex: 1 1 0;
    overflow-y: auto;
    overflow-x: hidden;
  }

  .simple-list-container::-webkit-scrollbar {
    width: 8px;
  }

  .simple-list-container::-webkit-scrollbar-track {
    background: var(--bg-primary, #1d1f27);
  }

  .simple-list-container::-webkit-scrollbar-thumb {
    background: var(--border-color, #3c3f47);
    border-radius: 4px;
  }

  .simple-list-container::-webkit-scrollbar-thumb:hover {
    background: var(--text-tertiary, #6b7280);
  }

  .inspector-item-wrapper {
    contain: layout style;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px 24px;
    color: var(--text-tertiary, #6b7280);
    text-align: center;
  }

  .empty-state :global(svg) {
    width: 40px;
    height: 40px;
    margin-bottom: 12px;
    opacity: 0.4;
  }

  .empty-state p {
    margin: 0;
    font-size: 13px;
  }

  .item-count {
    padding: 8px 12px;
    font-size: 11px;
    color: var(--text-tertiary, #6b7280);
    border-bottom: 1px solid var(--border-color, #3c3f47);
    background: var(--bg-surface, #232429);
  }

  /* Cloudflare solve summary banner */
  .cf-summary {
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border-bottom: 1px solid var(--border-color, #3c3f47);
  }

  .cf-summary.success {
    background: rgba(34, 197, 94, 0.1);
    border-left: 3px solid var(--success, #22c55e);
  }

  .cf-summary.failed {
    background: rgba(239, 68, 68, 0.1);
    border-left: 3px solid var(--danger, #ef4444);
  }

  .cf-summary.pending {
    background: rgba(245, 158, 11, 0.1);
    border-left: 3px solid var(--warning, #f59e0b);
  }

  .cf-summary-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-primary, #fff);
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .cf-summary-detail {
    font-size: 11px;
    color: var(--text-secondary, #9ba0ab);
  }

  /* Section headers */
  .section-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 12px;
    background: var(--bg-surface, #232429);
    border-bottom: 1px solid var(--border-color, #3c3f47);
    cursor: pointer;
    user-select: none;
    position: sticky;
    top: 0;
    z-index: 1;
  }

  .section-header:hover {
    background: #2a2b31;
  }

  .section-chevron {
    width: 14px;
    height: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-tertiary, #6b7280);
    flex-shrink: 0;
  }

  .section-label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary, #9ba0ab);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .section-count {
    font-size: 11px;
    color: var(--text-tertiary, #6b7280);
    background: var(--bg-primary, #1d1f27);
    padding: 1px 6px;
    border-radius: 10px;
    font-weight: 400;
  }

  /* Noise toggle */
  .noise-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px 6px 20px;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border-color, #3c3f47);
    cursor: pointer;
    color: var(--text-tertiary, #6b7280);
    font-size: 11px;
    width: 100%;
    text-align: left;
  }

  .noise-toggle:hover {
    color: var(--text-secondary, #9ba0ab);
    background: var(--bg-surface, #232429);
  }

  .noise-chevron {
    width: 12px;
    height: 12px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
</style>

<div
  class="inspector-list"
  bind:this={listContainer}
  on:mouseenter={handleMouseEnter}
  on:mouseleave={handleMouseLeave}
  role="list"
>
  {#if $filteredItems.length === 0}
    <div class="empty-state">
      {@html networkIcon}
      <p>No events match your filters</p>
    </div>
  {:else if isCloudflareTab}
    <!-- Cloudflare grouped view -->
    {#if summary}
      <div class="cf-summary" class:success={isOutcomeSuccess(summary.outcome)} class:failed={summary.outcome === 'failed'} class:pending={!summary.outcome}>
        <div class="cf-summary-title">
          {summary.challengeType ? summary.challengeType.charAt(0).toUpperCase() + summary.challengeType.slice(1) : 'Unknown'} Turnstile
          <span style="color: var(--text-tertiary);">&middot;</span>
          {formatOutcome(summary.outcome)}
          {#if summary.durationMs !== null}
            <span style="color: var(--text-tertiary);">&middot;</span>
            {formatSummaryDuration(summary.durationMs)}
          {/if}
        </div>
        {#if summary.detectedAt}
          <div class="cf-summary-detail">
            {formatAbsoluteTime(summary.detectedAt)}{#if summary.solvedAt} &rarr; {formatAbsoluteTime(summary.solvedAt)}{/if}
          </div>
        {/if}
      </div>
    {/if}

    <div class="simple-list-container" bind:this={scrollContainer} on:scroll={handleScroll}>
      <!-- Markers section -->
      {#if cloudflareMarkers.length > 0}
        <div class="section-header" on:click={() => toggleSection('markers')} on:keypress={(e) => e.key === 'Enter' && toggleSection('markers')} role="button" tabindex="0">
          <span class="section-chevron">{@html expandedSections.markers ? chevronDown : chevronRight}</span>
          <span class="section-label">Markers</span>
          <span class="section-count">{cloudflareMarkers.length}</span>
        </div>
        {#if expandedSections.markers}
          {#each cloudflareMarkers as item, index (item.timestamp + '-marker-' + index)}
            <div class="inspector-item-wrapper">
              <InspectorItem {item} {index} on:seek={handleSeek} />
            </div>
          {/each}
        {/if}
      {/if}

      <!-- Network section -->
      {#if cloudflareNetwork.length > 0}
        <div class="section-header" on:click={() => toggleSection('network')} on:keypress={(e) => e.key === 'Enter' && toggleSection('network')} role="button" tabindex="0">
          <span class="section-chevron">{@html expandedSections.network ? chevronDown : chevronRight}</span>
          <span class="section-label">Network</span>
          <span class="section-count">{cloudflareNetwork.length}</span>
        </div>
        {#if expandedSections.network}
          {#each cloudflareNetwork as item, index (item.timestamp + '-network-' + index)}
            <div class="inspector-item-wrapper">
              <InspectorItem {item} {index} cloudflareCategory={getNetworkCategory(item)} on:seek={handleSeek} />
            </div>
          {/each}
        {/if}
      {/if}

      <!-- Console section -->
      {#if cloudflareConsole.length > 0}
        <div class="section-header" on:click={() => toggleSection('console')} on:keypress={(e) => e.key === 'Enter' && toggleSection('console')} role="button" tabindex="0">
          <span class="section-chevron">{@html expandedSections.console ? chevronDown : chevronRight}</span>
          <span class="section-label">Console</span>
          <span class="section-count">{cloudflareConsole.length}</span>
        </div>
        {#if expandedSections.console}
          <!-- Signal messages (non-noise) -->
          {#each consoleSignal as item, index (item.timestamp + '-console-signal-' + index)}
            <div class="inspector-item-wrapper">
              <InspectorItem {item} {index} on:seek={handleSeek} />
            </div>
          {/each}

          <!-- Noise group toggle -->
          {#if consoleNoise.length > 0}
            <button class="noise-toggle" on:click={() => noiseExpanded = !noiseExpanded}>
              <span class="noise-chevron">{@html noiseExpanded ? chevronDown : chevronRight}</span>
              Anti-debugging probes ({consoleNoise.length})
            </button>
            {#if noiseExpanded}
              {#each consoleNoise as item, index (item.timestamp + '-console-noise-' + index)}
                <div class="inspector-item-wrapper">
                  <InspectorItem {item} {index} on:seek={handleSeek} />
                </div>
              {/each}
            {/if}
          {/if}
        {/if}
      {/if}
    </div>
  {:else}
    <!-- Normal flat list view -->
    <div class="item-count">{$filteredItems.length} events</div>
    <div class="simple-list-container" bind:this={scrollContainer} on:scroll={handleScroll}>
      {#each $filteredItems as item, index (item.timestamp + '-' + index)}
        <div class="inspector-item-wrapper" class:current={index === indicatorIndex}>
          <InspectorItem {item} {index} on:seek={handleSeek} />
        </div>
      {/each}
    </div>
  {/if}
</div>
