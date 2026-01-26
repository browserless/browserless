<script lang="ts">
  export let code: string;
  export let maxHeight: string = '300px';

  let copied = false;

  function handleCopy() {
    navigator.clipboard.writeText(code);
    copied = true;
    setTimeout(() => {
      copied = false;
    }, 1500);
  }
</script>

<style>
  .code-snippet {
    position: relative;
    background: var(--bg-secondary, #151619);
    border-radius: 4px;
    overflow: hidden;
  }

  pre {
    margin: 0;
    padding: 12px;
    font-size: 11px;
    font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
    color: var(--text-secondary, #9ba0ab);
    overflow-x: auto;
    white-space: pre-wrap;
    word-break: break-word;
  }

  .copy-btn {
    position: absolute;
    top: 6px;
    right: 6px;
    padding: 4px 8px;
    font-size: 10px;
    background: var(--bg-surface, #232429);
    border: 1px solid var(--border-color, #3c3f47);
    border-radius: 3px;
    color: var(--text-secondary, #9ba0ab);
    cursor: pointer;
    opacity: 0;
    transition: opacity 0.15s, background 0.15s;
  }

  .code-snippet:hover .copy-btn {
    opacity: 1;
  }

  .copy-btn:hover {
    background: var(--border-color, #3c3f47);
    color: var(--text-primary, #fff);
  }

  .copy-btn.copied {
    background: var(--success, #22c55e);
    color: white;
    opacity: 1;
  }
</style>

<div class="code-snippet">
  <pre style="max-height: {maxHeight};">{code}</pre>
  <button
    class="copy-btn"
    class:copied
    on:click={handleCopy}
  >
    {copied ? 'Copied!' : 'Copy'}
  </button>
</div>
