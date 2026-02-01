<script lang="ts">
  import type { ConsoleItem } from '../../types';
  import CodeSnippet from '../../components/CodeSnippet.svelte';

  export let item: ConsoleItem;

  $: hasStackTrace = item.trace && item.trace.length > 0;
  $: fullMessage = item.message;
  $: stackTrace = hasStackTrace ? item.trace.join('\n') : '';
</script>

<style>
  .console-detail {
    font-size: 12px;
  }

  .level-indicator {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 8px;
  }

  .level-badge {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    padding: 3px 8px;
    border-radius: 3px;
  }

  .level-badge.log {
    background: var(--bg-primary, #1d1f27);
    color: var(--text-secondary, #9ba0ab);
  }
  .level-badge.info {
    background: rgba(59, 130, 246, 0.2);
    color: var(--info, #3b82f6);
  }
  .level-badge.warn {
    background: rgba(245, 158, 11, 0.2);
    color: var(--warning, #f59e0b);
  }
  .level-badge.error {
    background: rgba(239, 68, 68, 0.2);
    color: var(--danger, #ef4444);
  }
  .level-badge.debug {
    background: rgba(139, 92, 246, 0.2);
    color: #8b5cf6;
  }

  .repeat-note {
    font-size: 11px;
    color: var(--text-tertiary, #6b7280);
    margin: 0 0 8px;
  }

  .repeat-note b {
    color: var(--accent, #f97316);
  }

  .section-title {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary, #6b7280);
    text-transform: uppercase;
    margin: 12px 0 6px;
  }

  .section-title:first-of-type {
    margin-top: 8px;
  }

  .timestamp {
    font-size: 10px;
    color: var(--text-tertiary, #6b7280);
    margin-top: 8px;
  }
</style>

<div class="console-detail">
  <div class="level-indicator">
    <span class="level-badge {item.level}">{item.level}</span>
  </div>

  {#if item.count && item.count > 1}
    <p class="repeat-note">This log occurred <b>{item.count}</b> times.</p>
  {/if}

  <div class="section-title">Message</div>
  <CodeSnippet code={fullMessage} maxHeight="200px" />

  {#if hasStackTrace}
    <div class="section-title">Stack Trace</div>
    <CodeSnippet code={stackTrace} language="text" maxHeight="200px" />
  {/if}

  <p class="timestamp">
    Logged at: {new Date(item.timestamp).toISOString()}
  </p>
</div>
