<script lang="ts">
  export let disabled: boolean = false;
  export let checked: boolean = false;
  export let id: string;
  export let label: string;
</script>

<style>
  .switch {
    height: 1em;
    display: flex;
    align-items: center;
  }

  .switch.disabled {
    opacity: 0.5;
  }

  .label {
    margin: 0 8px;
    color: var(--text-secondary, #9ba0ab);
    font-size: 12px;
  }

  .switch input[type='checkbox'] {
    position: absolute;
    opacity: 0;
  }

  .switch label {
    width: 2em;
    height: 1em;
    position: relative;
    cursor: pointer;
    display: block;
  }

  .switch.disabled label {
    cursor: not-allowed;
  }

  .switch label:before {
    content: '';
    position: absolute;
    width: 2em;
    height: 1em;
    left: 0.1em;
    transition: background 0.1s ease;
    background: var(--bg-surface, #232429);
    border-radius: 50px;
  }

  .switch label:after {
    content: '';
    position: absolute;
    width: 1em;
    height: 1em;
    border-radius: 50px;
    left: 0;
    transition: all 0.2s ease;
    box-shadow: 0px 2px 5px 0px rgba(0, 0, 0, 0.3);
    background: var(--text-secondary, #9ba0ab);
    z-index: 2;
  }

  .switch input[type='checkbox']:checked + label:before {
    background: var(--accent, #f97316);
  }

  .switch input[type='checkbox']:checked + label:after {
    background: white;
    left: 1.1em;
  }
</style>

<div class="switch" class:disabled>
  <input type="checkbox" {id} bind:checked {disabled} />
  <label for={id}></label>
  <span class="label">{label}</span>
</div>
