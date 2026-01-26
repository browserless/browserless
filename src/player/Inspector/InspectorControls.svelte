<script lang="ts">
  import { filters, searchQuery, syncScrollPaused } from '../stores/player';

  function handleSearchInput(e: Event) {
    const target = e.target as HTMLInputElement;
    $searchQuery = target.value;
  }

  function toggleLevel(level: 'log' | 'info' | 'warn' | 'error' | 'debug') {
    $filters = {
      ...$filters,
      levels: { ...$filters.levels, [level]: !$filters.levels[level] },
    };
  }
</script>

<style>
  .controls {
    padding: 8px 12px;
    border-bottom: 1px solid var(--border-color, #3c3f47);
    background: var(--bg-surface, #232429);
  }

  .search-row {
    display: flex;
    gap: 8px;
  }

  .search-input {
    flex: 1;
    padding: 6px 10px;
    font-size: 12px;
    background: var(--bg-primary, #1d1f27);
    border: 1px solid var(--border-color, #3c3f47);
    border-radius: 4px;
    color: var(--text-primary, #fff);
    outline: none;
  }

  .search-input::placeholder {
    color: var(--text-tertiary, #6b7280);
  }

  .search-input:focus {
    border-color: var(--accent, #f97316);
  }

  .levels-row {
    display: flex;
    gap: 4px;
    margin-top: 8px;
  }

  .level-btn {
    padding: 2px 6px;
    font-size: 9px;
    font-weight: 500;
    text-transform: uppercase;
    background: var(--bg-primary, #1d1f27);
    border: 1px solid var(--border-color, #3c3f47);
    border-radius: 4px;
    cursor: pointer;
    transition: all 0.15s;
  }

  .level-btn:hover {
    border-color: var(--text-secondary, #9ba0ab);
  }

  /* Level colors (inactive state) */
  .level-btn.log { color: var(--text-secondary, #9ba0ab); }
  .level-btn.info { color: var(--info, #3b82f6); }
  .level-btn.warn { color: var(--warning, #f59e0b); }
  .level-btn.error { color: var(--danger, #ef4444); }
  .level-btn.debug { color: #8b5cf6; }

  /* Active state - color MUST be in specific selectors to win specificity */
  .level-btn.log.active { color: white; background: var(--text-secondary, #9ba0ab); border-color: var(--text-secondary, #9ba0ab); }
  .level-btn.info.active { color: white; background: var(--info, #3b82f6); border-color: var(--info, #3b82f6); }
  .level-btn.warn.active { color: white; background: var(--warning, #f59e0b); border-color: var(--warning, #f59e0b); }
  .level-btn.error.active { color: white; background: var(--danger, #ef4444); border-color: var(--danger, #ef4444); }
  .level-btn.debug.active { color: white; background: #8b5cf6; border-color: #8b5cf6; }

  .sync-indicator {
    font-size: 10px;
    padding: 4px 8px;
    background: var(--bg-primary, #1d1f27);
    border: 1px solid var(--border-color, #3c3f47);
    border-radius: 4px;
    color: var(--text-tertiary, #6b7280);
    cursor: pointer;
  }

  .sync-indicator.paused {
    color: var(--warning, #f59e0b);
    border-color: var(--warning, #f59e0b);
  }

  .sync-indicator:hover {
    color: var(--text-primary, #fff);
  }
</style>

<div class="controls">
  <div class="search-row">
    <input
      type="text"
      class="search-input"
      placeholder="Search events..."
      value={$searchQuery}
      on:input={handleSearchInput}
    />
    <button
      class="sync-indicator"
      class:paused={$syncScrollPaused}
      on:click={() => ($syncScrollPaused = false)}
      title={$syncScrollPaused ? 'Click to resume auto-scroll' : 'Auto-scroll active'}
    >
      {$syncScrollPaused ? 'Sync paused' : 'Synced'}
    </button>
  </div>

  {#if $filters.console}
    <div class="levels-row">
      {#each ['log', 'info', 'warn', 'error', 'debug'] as level}
        <button
          class="level-btn {level}"
          class:active={$filters.levels[level]}
          on:click={() => toggleLevel(level)}
        >
          {level}
        </button>
      {/each}
    </div>
  {/if}
</div>
