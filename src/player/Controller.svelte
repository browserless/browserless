<script lang="ts">
  import { EventType } from '@divmode/rrweb-types';
  import type { playerMetaData } from '@divmode/rrweb-types';
  import type {
    Replayer,
    PlayerMachineState,
    SpeedMachineState,
  } from '@divmode/rrweb';
  import { onMount, onDestroy, createEventDispatcher, afterUpdate } from 'svelte';
  import { formatTime } from './utils';
  import Switch from './components/Switch.svelte';
  import { currentPhase, consoleItems, filters } from './stores/player';

  const dispatch = createEventDispatcher();

  export let replayer: Replayer;
  export let showController: boolean;
  export let autoPlay: boolean;
  export let skipInactive: boolean;
  export let speedOption: number[];
  export let speed: number = 4;
  export let tags: Record<string, string> = {};
  export let inactiveColor: string;

  let currentTime = 0;
  $: {
    dispatch('ui-update-current-time', { payload: currentTime });
  }
  let timer: number | null = null;
  let playerState: 'playing' | 'paused' | 'live';
  $: {
    dispatch('ui-update-player-state', { payload: playerState });
  }
  let speedState: 'normal' | 'skipping';
  let progress: HTMLElement;
  let finished: boolean;

  let pauseAt: number | false = false;
  let onPauseHook: (() => unknown) | null = null;
  let loop: {
    start: number;
    end: number;
  } | null = null;

  let meta: playerMetaData;
  $: meta = replayer.getMetaData();
  let percentage: string;
  $: {
    const percent = Math.min(1, currentTime / meta.totalTime);
    percentage = `${100 * percent}%`;
    dispatch('ui-update-progress', { payload: percent });
  }

  type CustomEvent = {
    name: string;
    background: string;
    position: string;
  };

  function position(startTime: number, endTime: number, tagTime: number) {
    const sessionDuration = endTime - startTime;
    const eventDuration = endTime - tagTime;
    const eventPosition = 100 - (eventDuration / sessionDuration) * 100;
    return eventPosition.toFixed(2);
  }

  let customEvents: CustomEvent[];
  $: customEvents = (() => {
    if (!$filters.markers) return [];

    const { context } = replayer.service.state;
    const totalEvents = context.events.length;
    const start = context.events[0].timestamp;
    const end = context.events[totalEvents - 1].timestamp;
    const customEventsArr: CustomEvent[] = [];

    context.events.forEach((event) => {
      if (event.type === EventType.Custom) {
        const customEvent = {
          name: event.data.tag,
          background: tags[event.data.tag] || 'rgb(249, 115, 22)',
          position: `${position(start, end, event.timestamp)}%`,
        };
        customEventsArr.push(customEvent);
      }
    });

    return customEventsArr;
  })();

  const CONSOLE_LEVEL_COLORS: Record<string, string> = {
    log:   '#9ba0ab',
    info:  '#3b82f6',
    warn:  '#f59e0b',
    error: '#ef4444',
    debug: '#8b5cf6',
  };

  let consoleMarkers: CustomEvent[];
  $: consoleMarkers = (() => {
    if (!$filters.console) return [];

    const { context } = replayer.service.state;
    const totalEvents = context.events.length;
    const start = context.events[0].timestamp;
    const end = context.events[totalEvents - 1].timestamp;

    return $consoleItems
      .filter((item) => {
        const levelKey = item.level as keyof typeof $filters.levels;
        return !(levelKey in $filters.levels && $filters.levels[levelKey] === false);
      })
      .map((item) => ({
        name: `console.${item.level}`,
        background: CONSOLE_LEVEL_COLORS[item.level] || '#9ba0ab',
        position: `${position(start, end, item.timestamp)}%`,
      }));
  })();

  let inactivePeriods: {
    name: string;
    background: string;
    position: string;
    width: string;
  }[];
  $: inactivePeriods = (() => {
    try {
      const { context } = replayer.service.state;
      const totalEvents = context.events.length;
      const start = context.events[0].timestamp;
      const end = context.events[totalEvents - 1].timestamp;

      // Simple inactive period detection
      const periods: [number, number][] = [];
      let lastActiveTime = context.events[0].timestamp;
      const threshold = replayer.config.inactivePeriodThreshold || 10000;

      for (const event of context.events) {
        if (event.timestamp - lastActiveTime > threshold) {
          periods.push([lastActiveTime, event.timestamp]);
        }
        lastActiveTime = event.timestamp;
      }

      const getWidth = (
        startTime: number,
        endTime: number,
        tagStart: number,
        tagEnd: number
      ) => {
        const sessionDuration = endTime - startTime;
        const eventDuration = tagEnd - tagStart;
        const width = (eventDuration / sessionDuration) * 100;
        return width.toFixed(2);
      };

      return periods.map((period) => ({
        name: 'inactive period',
        background: inactiveColor,
        position: `${position(start, end, period[0])}%`,
        width: `${getWidth(start, end, period[0], period[1])}%`,
      }));
    } catch {
      return [];
    }
  })();

  const loopTimer = () => {
    stopTimer();

    function update() {
      currentTime = replayer.getCurrentTime();

      if (pauseAt && currentTime >= pauseAt) {
        if (loop) {
          playRange(loop.start, loop.end, true, undefined);
        } else {
          replayer.pause();
          if (onPauseHook) {
            onPauseHook();
            onPauseHook = null;
          }
        }
      }

      if (currentTime < meta.totalTime) {
        timer = requestAnimationFrame(update);
      }
    }

    timer = requestAnimationFrame(update);
  };

  const stopTimer = () => {
    if (timer) {
      cancelAnimationFrame(timer);
      timer = null;
    }
  };

  export const toggle = () => {
    switch (playerState) {
      case 'playing':
        pause();
        break;
      case 'paused':
        play();
        break;
      default:
        break;
    }
  };

  export const play = () => {
    if (playerState !== 'paused') {
      return;
    }
    if (finished) {
      replayer.play();
      finished = false;
    } else {
      replayer.play(currentTime);
    }
  };

  export const pause = () => {
    if (playerState !== 'playing') {
      return;
    }
    replayer.pause();
    pauseAt = false;
  };

  export const goto = (timeOffset: number, shouldPlay?: boolean) => {
    currentTime = timeOffset;
    pauseAt = false;
    finished = false;
    const resumePlaying =
      typeof shouldPlay === 'boolean' ? shouldPlay : playerState === 'playing';
    if (resumePlaying) {
      replayer.play(timeOffset);
    } else {
      replayer.pause(timeOffset);
    }
  };

  export const playRange = (
    timeOffset: number,
    endTimeOffset: number,
    startLooping = false,
    afterHook: undefined | (() => void) = undefined
  ) => {
    if (startLooping) {
      loop = {
        start: timeOffset,
        end: endTimeOffset,
      };
    } else {
      loop = null;
    }
    currentTime = timeOffset;
    pauseAt = endTimeOffset;
    onPauseHook = afterHook || null;
    replayer.play(timeOffset);
  };

  const handleProgressClick = (event: MouseEvent) => {
    if (speedState === 'skipping') {
      return;
    }
    const progressRect = progress.getBoundingClientRect();
    const x = event.clientX - progressRect.left;
    let percent = x / progressRect.width;
    if (percent < 0) {
      percent = 0;
    } else if (percent > 1) {
      percent = 1;
    }
    const timeOffset = meta.totalTime * percent;
    goto(timeOffset);
  };

  const handleProgressKeydown = (event: KeyboardEvent) => {
    if (speedState === 'skipping') {
      return;
    }
    if (event.key === 'ArrowLeft') {
      goto(currentTime - 5000);
    } else if (event.key === 'ArrowRight') {
      goto(currentTime + 5000);
    }
  };

  export const setSpeed = (newSpeed: number) => {
    const needFreeze = playerState === 'playing';
    speed = newSpeed;
    if (needFreeze) {
      replayer.pause();
    }
    replayer.setConfig({ speed });
    if (needFreeze) {
      replayer.play(currentTime);
    }
  };

  export const toggleSkipInactive = () => {
    skipInactive = !skipInactive;
  };

  export const triggerUpdateMeta = () => {
    return Promise.resolve().then(() => {
      meta = replayer.getMetaData();
    });
  };

  onMount(() => {
    playerState = replayer.service.state.value as typeof playerState;
    speedState = replayer.speedService.state.value as typeof speedState;
    replayer.on('state-change', (states) => {
      const { player, speed: speedS } = states as {
        player?: PlayerMachineState;
        speed?: SpeedMachineState;
      };
      if (player?.value && playerState !== player.value) {
        playerState = player.value as typeof playerState;
        switch (playerState) {
          case 'playing':
            loopTimer();
            break;
          case 'paused':
            stopTimer();
            break;
          default:
            break;
        }
      }
      if (speedS?.value && speedState !== speedS.value) {
        speedState = speedS.value as typeof speedState;
      }
    });
    replayer.on('finish', () => {
      finished = true;
      if (onPauseHook) {
        onPauseHook();
        onPauseHook = null;
      }
    });

    if (autoPlay) {
      replayer.play();
    }
  });

  afterUpdate(() => {
    if (skipInactive !== replayer.config.skipInactive) {
      replayer.setConfig({ skipInactive });
    }
  });

  onDestroy(() => {
    replayer.pause();
    stopTimer();
  });
</script>

<style>
  .rr-controller {
    width: 100%;
    height: 80px;
    background: var(--bg-primary, #1d1f27);
    display: flex;
    flex-direction: column;
    justify-content: space-around;
    align-items: center;
    border-radius: 0 0 5px 5px;
  }

  .rr-timeline {
    width: 90%;
    display: flex;
    align-items: center;
  }

  .rr-timeline__time {
    display: inline-block;
    width: 70px;
    text-align: center;
    color: var(--text-secondary, #9ba0ab);
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .rr-progress {
    flex: 1;
    height: 12px;
    background: var(--bg-surface, #232429);
    position: relative;
    border-radius: 6px;
    cursor: pointer;
    box-sizing: border-box;
  }

  .rr-progress.disabled {
    cursor: not-allowed;
  }

  .rr-progress__step {
    height: 100%;
    position: absolute;
    left: 0;
    top: 0;
    background: var(--accent, #f97316);
    border-radius: 6px 0 0 6px;
    opacity: 0.6;
  }

  .rr-progress__handler {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    position: absolute;
    top: 50%;
    transform: translate(-50%, -50%);
    background: var(--accent, #f97316);
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
  }

  .rr-controller__btns {
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 13px;
    gap: 8px;
  }

  .rr-controller__btns button {
    width: 32px;
    height: 32px;
    display: flex;
    padding: 0;
    align-items: center;
    justify-content: center;
    background: var(--bg-surface, #232429);
    border: none;
    border-radius: 6px;
    cursor: pointer;
    color: var(--text-secondary, #9ba0ab);
    transition: all 0.15s;
  }

  .rr-controller__btns button:hover {
    background: var(--border-color, #3c3f47);
    color: var(--text-primary, #fff);
  }

  .rr-controller__btns button.active {
    color: var(--text-primary, #fff);
    background: var(--accent, #f97316);
  }

  .rr-controller__btns button:disabled {
    cursor: not-allowed;
    opacity: 0.5;
  }

  .rr-controller__btns :global(.switch) {
    margin-left: 12px;
  }

  .window-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 10px;
    background: rgba(59, 130, 246, 0.15);
    border: 1px solid rgba(59, 130, 246, 0.3);
    border-radius: 4px;
    font-size: 12px;
    color: var(--text-primary, #fff);
    margin-right: auto;
  }

  .badge-icon {
    font-size: 14px;
  }

  .badge-label {
    font-weight: 500;
    text-transform: capitalize;
  }
</style>

{#if showController}
  <div class="rr-controller">
    <div class="rr-timeline">
      <span class="rr-timeline__time">{formatTime(currentTime)}</span>
      <div
        class="rr-progress"
        class:disabled={speedState === 'skipping'}
        bind:this={progress}
        on:click={handleProgressClick}
        on:keydown={handleProgressKeydown}
        role="slider"
        tabindex="0"
        aria-valuenow={currentTime}
        aria-valuemin={0}
        aria-valuemax={meta.totalTime}
      >
        <div class="rr-progress__step" style="width: {percentage}"></div>
        {#each inactivePeriods as period}
          <div
            title={period.name}
            style="width: {period.width}; height: 100%; position: absolute; background: {period.background}; left: {period.position}; opacity: 0.5; border-radius: 2px;"
          ></div>
        {/each}
        {#each customEvents as event}
          <div
            title={event.name}
            style="width: 4px; height: 100%; position: absolute; background: {event.background}; left: {event.position}; border-radius: 2px;"
          ></div>
        {/each}
        {#each consoleMarkers as event}
          <div
            title={event.name}
            style="width: 4px; height: 100%; position: absolute; background: {event.background}; left: {event.position}; border-radius: 2px;"
          ></div>
        {/each}
        <div class="rr-progress__handler" style="left: {percentage}"></div>
      </div>
      <span class="rr-timeline__time">{formatTime(meta.totalTime)}</span>
    </div>
    <div class="rr-controller__btns">
      {#if $currentPhase}
        <div class="window-badge">
          <span class="badge-icon">
            {$currentPhase === 'backlinks' ? '🔗' : '📊'}
          </span>
          <span class="badge-label">
            {$currentPhase === 'backlinks' ? 'Backlinks' : 'Traffic'}
          </span>
        </div>
      {/if}
      <button on:click={toggle} title={playerState === 'playing' ? 'Pause' : 'Play'}>
        {#if playerState === 'playing'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M6 4h4v16H6zM14 4h4v16h-4z" />
          </svg>
        {:else}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M8 5v14l11-7z" />
          </svg>
        {/if}
      </button>
      {#each speedOption as s}
        <button
          class:active={s === speed && speedState !== 'skipping'}
          on:click={() => setSpeed(s)}
          disabled={speedState === 'skipping'}
        >
          {s}x
        </button>
      {/each}
      <Switch
        id="skip"
        bind:checked={skipInactive}
        disabled={speedState === 'skipping'}
        label="skip inactive"
      />
      <button on:click={() => dispatch('fullscreen')} title="Fullscreen">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3" />
        </svg>
      </button>
    </div>
  </div>
{/if}
