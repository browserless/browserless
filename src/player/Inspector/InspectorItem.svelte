<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import {
    expandedItems,
    toggleExpanded,
    getHighlightClass,
    getDurationClass,
    getStatusClass,
    formatTimeOffset,
    metadata,
  } from '../stores/player';
  import type { InspectorItem, NetworkItem, ConsoleItem, MarkerItem } from '../types';
  import { truncateUrl, truncateString } from '../utils';
  import ItemNetworkDetail from './items/ItemNetworkDetail.svelte';
  import ItemConsoleDetail from './items/ItemConsoleDetail.svelte';

  export let item: InspectorItem;
  export let index: number;
  export let cloudflareCategory: string | null = null;

  const dispatch = createEventDispatcher();

  $: itemId = `${item.type}-${item.timestamp}-${index}`;
  $: isExpanded = $expandedItems.has(itemId);
  $: highlightClass = getHighlightClass(item);
  $: startTime = $metadata?.startedAt || 0;
  $: timeOffset = formatTimeOffset(item.timestamp, startTime);

  function handleClick() {
    dispatch('seek', { timestamp: item.timestamp });
  }

  function handleExpand(e: Event) {
    e.stopPropagation();
    toggleExpanded(itemId);
  }

  // Network item helpers
  function getNetworkDisplay(item: NetworkItem) {
    const method = item.request?.method || item.response?.method || 'GET';
    const url = item.request?.url || item.response?.url || 'Unknown';
    const status = item.response?.status;
    const duration = item.response?.duration || 0;
    const error = item.error?.error;
    return { method, url, status, duration, error };
  }

  // Console item helpers
  function getConsoleDisplay(item: ConsoleItem) {
    return {
      level: item.level,
      message: truncateString(item.message, 200),
    };
  }

  // Marker item helpers
  function getMarkerDisplay(item: MarkerItem) {
    const payloadStr = Object.keys(item.payload).length > 0
      ? JSON.stringify(item.payload).slice(0, 80)
      : '';
    return {
      tag: item.tag,
      payload: payloadStr,
      isTurnstile: item.tag.includes('turnstile'),
    };
  }

  // Icons
  const networkIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>`;
  const consoleIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 17l6-6-6-6M12 19h8"/></svg>`;
  const markerIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/></svg>`;
</script>

<style>
  .inspector-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color, #3c3f47);
    cursor: pointer;
    transition: background 0.1s;
    position: relative;
  }

  .inspector-item:hover {
    background: var(--bg-surface, #232429);
  }

  .inspector-item.highlight-danger {
    background: rgba(239, 68, 68, 0.1);
  }
  .inspector-item.highlight-warning {
    background: rgba(245, 158, 11, 0.1);
  }
  .inspector-item.highlight-danger:hover {
    background: rgba(239, 68, 68, 0.15);
  }
  .inspector-item.highlight-warning:hover {
    background: rgba(245, 158, 11, 0.15);
  }

  .item-time {
    font-size: 11px;
    color: var(--text-tertiary, #6b7280);
    min-width: 40px;
    font-variant-numeric: tabular-nums;
  }

  .item-icon {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-secondary, #9ba0ab);
    flex-shrink: 0;
  }

  .item-icon :global(svg) {
    width: 14px;
    height: 14px;
  }

  .item-icon.network {
    color: var(--info, #3b82f6);
  }
  .item-icon.console {
    color: var(--text-secondary, #9ba0ab);
  }
  .item-icon.marker {
    color: var(--accent, #f97316);
  }

  .item-content {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .method-tag {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 2px 4px;
    border-radius: 2px;
    background: var(--bg-surface, #232429);
    color: var(--text-secondary, #9ba0ab);
    flex-shrink: 0;
  }

  .method-tag.GET {
    color: var(--success, #22c55e);
  }
  .method-tag.POST {
    color: var(--info, #3b82f6);
  }
  .method-tag.PUT {
    color: var(--warning, #f59e0b);
  }
  .method-tag.DELETE {
    color: var(--danger, #ef4444);
  }
  .method-tag.PATCH {
    color: var(--accent, #f97316);
  }

  .item-label {
    flex: 1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: 12px;
    color: var(--text-primary, #fff);
    font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  }

  .status-badge {
    font-size: 11px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 3px;
    flex-shrink: 0;
  }

  .status-badge.success {
    color: var(--success, #22c55e);
  }
  .status-badge.warning {
    color: var(--warning, #f59e0b);
  }
  .status-badge.danger {
    color: var(--danger, #ef4444);
  }

  .item-duration {
    font-size: 11px;
    color: var(--text-tertiary, #6b7280);
    font-weight: 500;
    min-width: 50px;
    text-align: right;
    flex-shrink: 0;
  }

  .item-duration.slow {
    color: var(--warning, #f59e0b);
  }
  .item-duration.very-slow {
    color: var(--danger, #ef4444);
  }

  .console-level-badge {
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 2px 5px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .console-level-badge.log {
    background: var(--bg-surface, #232429);
    color: var(--text-secondary, #9ba0ab);
  }
  .console-level-badge.info {
    background: rgba(59, 130, 246, 0.2);
    color: var(--info, #3b82f6);
  }
  .console-level-badge.warn {
    background: rgba(245, 158, 11, 0.2);
    color: var(--warning, #f59e0b);
  }
  .console-level-badge.error {
    background: rgba(239, 68, 68, 0.2);
    color: var(--danger, #ef4444);
  }
  .console-level-badge.debug {
    background: rgba(139, 92, 246, 0.2);
    color: #8b5cf6;
  }

  .marker-tag {
    font-size: 11px;
    font-weight: 600;
    color: var(--accent, #f97316);
    flex-shrink: 0;
  }

  .marker-tag.turnstile {
    color: #f59e0b;
  }

  .source-badge {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    padding: 1px 4px;
    border-radius: 2px;
    background: rgba(20, 184, 166, 0.2);
    color: #14b8a6;
    flex-shrink: 0;
  }

  .category-badge {
    font-size: 9px;
    font-weight: 600;
    padding: 1px 4px;
    border-radius: 2px;
    flex-shrink: 0;
  }

  .category-badge.challenge {
    background: rgba(249, 115, 22, 0.2);
    color: #f97316;
  }

  .category-badge.pat {
    background: rgba(139, 92, 246, 0.2);
    color: #8b5cf6;
  }

  .category-badge.blob {
    background: rgba(59, 130, 246, 0.2);
    color: #3b82f6;
  }

  .expand-btn {
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    color: var(--text-tertiary, #6b7280);
    cursor: pointer;
    border-radius: 3px;
    transition: all 0.15s;
    flex-shrink: 0;
  }

  .expand-btn:hover {
    background: var(--border-color, #3c3f47);
    color: var(--text-primary, #fff);
  }

  .item-detail {
    padding: 12px;
    background: var(--bg-surface, #232429);
    border-bottom: 1px solid var(--border-color, #3c3f47);
  }
</style>

<div
  class="inspector-item {highlightClass}"
  on:click={handleClick}
  on:keypress={(e) => e.key === 'Enter' && handleClick()}
  role="button"
  tabindex="0"
>
  <span class="item-time">{timeOffset}</span>

  {#if item.type === 'network'}
    {@const { method, url, status, duration, error } = getNetworkDisplay(item)}
    <span class="item-icon network">{@html networkIcon}</span>
    <div class="item-content">
      <span class="method-tag {method}">{method}</span>
      {#if cloudflareCategory}
        <span class="category-badge {cloudflareCategory}">{cloudflareCategory}</span>
      {:else if item.request?.type === 'iframe' || item.response?.type === 'iframe'}
        <span class="source-badge">iframe</span>
      {/if}
      <span class="item-label" title={url}>{truncateUrl(url)}</span>
      {#if error}
        <span class="status-badge danger">ERR</span>
      {:else if status}
        <span class="status-badge {getStatusClass(status)}">{status}</span>
      {/if}
    </div>
    <span class="item-duration {getDurationClass(duration)}">{duration ? `${duration}ms` : '-'}</span>
  {:else if item.type === 'console'}
    {@const { level, message } = getConsoleDisplay(item)}
    <span class="item-icon console">{@html consoleIcon}</span>
    <div class="item-content">
      <span class="console-level-badge {level}">{level}</span>
      {#if item.source === 'iframe'}
        <span class="source-badge">iframe</span>
      {/if}
      <span class="item-label">{message}</span>
    </div>
  {:else if item.type === 'marker'}
    {@const { tag, payload, isTurnstile } = getMarkerDisplay(item)}
    <span class="item-icon marker">{@html markerIcon}</span>
    <div class="item-content">
      <span class="marker-tag" class:turnstile={isTurnstile}>{tag}</span>
      {#if payload}
        <span class="item-label">{payload}</span>
      {/if}
    </div>
  {/if}

  <button class="expand-btn" on:click={handleExpand} title={isExpanded ? 'Collapse' : 'Expand'}>
    {isExpanded ? '−' : '+'}
  </button>
</div>

{#if isExpanded}
  <div class="item-detail">
    {#if item.type === 'network'}
      <ItemNetworkDetail {item} />
    {:else if item.type === 'console'}
      <ItemConsoleDetail {item} />
    {:else if item.type === 'marker'}
      <pre style="margin: 0; font-size: 11px; color: var(--text-secondary);">{JSON.stringify(item.payload, null, 2)}</pre>
    {/if}
  </div>
{/if}
