<script lang="ts">
  export let label: string;
  export let duration: number;
  export let total: number;
  export let color: 'blue' | 'purple' | 'indigo' | 'red' | 'orange' | 'green' | 'accent' = 'accent';

  $: percentage = total > 0 ? (duration / total) * 100 : 0;

  const colors: Record<typeof color, string> = {
    blue: '#3b82f6',
    purple: '#8b5cf6',
    indigo: '#6366f1',
    red: '#ef4444',
    orange: '#f59e0b',
    green: '#22c55e',
    accent: 'var(--accent, #f97316)',
  };

  $: barColor = colors[color];
</script>

<style>
  .timing-bar {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .label {
    font-size: 11px;
    color: var(--text-secondary, #9ba0ab);
    min-width: 80px;
  }

  .bar-container {
    flex: 1;
    height: 8px;
    background: var(--bg-primary, #1d1f27);
    border-radius: 4px;
    overflow: hidden;
  }

  .bar-fill {
    height: 100%;
    border-radius: 4px;
    transition: width 0.2s ease;
  }

  .duration {
    font-size: 10px;
    color: var(--text-tertiary, #6b7280);
    min-width: 50px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
</style>

<div class="timing-bar">
  <span class="label">{label}</span>
  <div class="bar-container">
    <div class="bar-fill" style="width: {percentage}%; background: {barColor};"></div>
  </div>
  <span class="duration">{duration}ms</span>
</div>
