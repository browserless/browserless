<script lang="ts">
  import { createEventDispatcher, tick } from 'svelte';
  import {
    filteredItems,
    playbackIndicatorIndex,
    syncScrollPaused,
  } from '../stores/player';
  import InspectorItem from './InspectorItem.svelte';
  import { debounce } from '../utils';

  const dispatch = createEventDispatcher();

  let listContainer: HTMLElement;
  let scrollContainer: HTMLElement;
  let mouseHovering = false;
  let scrollTimeout: ReturnType<typeof setTimeout> | null = null;
  let lastAutoScrollIndex = -1;

  $: indicatorIndex = $playbackIndicatorIndex;

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
  {:else}
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
