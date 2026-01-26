<script lang="ts">
  import type { NetworkItem } from '../../types';
  import CodeSnippet from '../../components/CodeSnippet.svelte';
  import TimingBar from './TimingBar.svelte';
  import { formatJson, truncateString } from '../../utils';

  export let item: NetworkItem;

  let activeTab = 'overview';

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'headers', label: 'Headers' },
    { id: 'payload', label: 'Payload' },
    { id: 'response', label: 'Response' },
  ];

  $: method = item.request?.method || item.response?.method || 'GET';
  $: url = item.request?.url || item.response?.url || 'Unknown';
  $: status = item.response?.status;
  $: statusText = item.response?.statusText || '';
  $: duration = item.response?.duration || 0;
  $: error = item.error?.error;
  $: requestHeaders = item.request?.requestHeaders || {};
  $: responseHeaders = item.response?.responseHeaders || {};
  $: requestBody = item.request?.requestBody;
  $: responseBody = item.response?.responseBody;

  function getStatusClass(status: number | undefined): string {
    if (!status) return '';
    if (status >= 500) return 'danger';
    if (status >= 400) return 'warning';
    return 'success';
  }

  function formatHeaders(headers: Record<string, string>): string {
    return Object.entries(headers)
      .map(([key, value]) => `${key}: ${value}`)
      .join('\n');
  }
</script>

<style>
  .network-detail {
    font-size: 12px;
  }

  .detail-summary {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
    padding-bottom: 12px;
    border-bottom: 1px solid var(--border-color, #3c3f47);
  }

  .method {
    font-weight: 700;
    text-transform: uppercase;
    font-size: 11px;
    padding: 2px 6px;
    background: var(--bg-primary, #1d1f27);
    border-radius: 3px;
  }

  .method.GET { color: var(--success, #22c55e); }
  .method.POST { color: var(--info, #3b82f6); }
  .method.PUT { color: var(--warning, #f59e0b); }
  .method.DELETE { color: var(--danger, #ef4444); }
  .method.PATCH { color: var(--accent, #f97316); }

  .status {
    font-weight: 600;
    font-size: 13px;
  }

  .status.success { color: var(--success, #22c55e); }
  .status.warning { color: var(--warning, #f59e0b); }
  .status.danger { color: var(--danger, #ef4444); }

  .duration {
    color: var(--text-secondary, #9ba0ab);
    font-weight: 500;
  }

  .url {
    flex: 1;
    font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
    font-size: 11px;
    color: var(--text-secondary, #9ba0ab);
    word-break: break-all;
  }

  .error-message {
    padding: 8px 12px;
    background: rgba(239, 68, 68, 0.1);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 4px;
    color: var(--danger, #ef4444);
    margin-bottom: 12px;
    font-size: 11px;
  }

  .tabs {
    display: flex;
    gap: 4px;
    margin-bottom: 12px;
    border-bottom: 1px solid var(--border-color, #3c3f47);
    padding-bottom: 8px;
  }

  .tab-btn {
    padding: 4px 10px;
    font-size: 11px;
    font-weight: 500;
    background: none;
    border: none;
    color: var(--text-secondary, #9ba0ab);
    cursor: pointer;
    border-radius: 4px;
    transition: all 0.15s;
  }

  .tab-btn:hover {
    background: var(--bg-primary, #1d1f27);
    color: var(--text-primary, #fff);
  }

  .tab-btn.active {
    background: var(--accent, #f97316);
    color: white;
  }

  .tab-content {
    min-height: 100px;
  }

  .section-title {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-tertiary, #6b7280);
    text-transform: uppercase;
    margin: 12px 0 6px;
  }

  .section-title:first-child {
    margin-top: 0;
  }

  .timing-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .no-data {
    color: var(--text-tertiary, #6b7280);
    font-style: italic;
    font-size: 11px;
  }
</style>

<div class="network-detail">
  <div class="detail-summary">
    <span class="method {method}">{method}</span>
    {#if error}
      <span class="status danger">Error</span>
    {:else if status}
      <span class="status {getStatusClass(status)}">{status} {statusText}</span>
    {:else}
      <span class="status">Pending</span>
    {/if}
    <span class="duration">{duration ? `${duration}ms` : '-'}</span>
  </div>

  <div class="url">{url}</div>

  {#if error}
    <div class="error-message">{error}</div>
  {/if}

  <div class="tabs">
    {#each tabs as tab}
      <button
        class="tab-btn"
        class:active={activeTab === tab.id}
        on:click={() => (activeTab = tab.id)}
      >
        {tab.label}
      </button>
    {/each}
  </div>

  <div class="tab-content">
    {#if activeTab === 'overview'}
      <div class="timing-section">
        <div class="section-title">Timing</div>
        {#if duration > 0}
          <TimingBar label="Total" duration={duration} total={duration} color="accent" />
        {:else}
          <p class="no-data">No timing data available</p>
        {/if}
      </div>

      <div class="section-title">Details</div>
      <p style="margin: 0; font-size: 11px; color: var(--text-secondary);">
        Type: {item.request?.type || item.response?.type || 'unknown'}<br />
        Timestamp: {new Date(item.timestamp).toISOString()}
      </p>
    {:else if activeTab === 'headers'}
      <div class="section-title">Request Headers</div>
      {#if Object.keys(requestHeaders).length > 0}
        <CodeSnippet code={formatHeaders(requestHeaders)} maxHeight="150px" />
      {:else}
        <p class="no-data">No request headers captured</p>
      {/if}

      <div class="section-title">Response Headers</div>
      {#if Object.keys(responseHeaders).length > 0}
        <CodeSnippet code={formatHeaders(responseHeaders)} maxHeight="150px" />
      {:else}
        <p class="no-data">No response headers captured</p>
      {/if}
    {:else if activeTab === 'payload'}
      <div class="section-title">Request Body</div>
      {#if requestBody}
        <CodeSnippet code={truncateString(requestBody, 5000)} maxHeight="200px" />
      {:else}
        <p class="no-data">No request body</p>
      {/if}
    {:else if activeTab === 'response'}
      <div class="section-title">Response Body</div>
      {#if responseBody}
        <CodeSnippet code={truncateString(responseBody, 5000)} maxHeight="300px" />
      {:else}
        <p class="no-data">No response body captured</p>
      {/if}
    {/if}
  </div>
</div>
