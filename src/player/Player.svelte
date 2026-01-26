<script lang="ts">
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { Replayer } from '@divmode/rrweb';
  import type { eventWithTime } from '@divmode/rrweb-types';
  import {
    inlineCss,
    openFullscreen,
    exitFullscreen,
    isFullscreen,
    onFullscreenChange,
    typeOf,
  } from './utils';
  import Controller from './Controller.svelte';
  import type { PlayerOptions } from './types';

  const dispatch = createEventDispatcher();

  export let width: number = 1024;
  export let height: number = 576;
  export let maxScale: number = 1;
  export let events: eventWithTime[];
  export let skipInactive: boolean = true;
  export let autoPlay: boolean = true;
  export let speedOption: number[] = [1, 2, 4, 8];
  export let speed: number = 4;
  export let showController: boolean = true;
  export let tags: Record<string, string> = {};
  export let inactiveColor: string = '#D4D4D4';

  let replayer: Replayer;

  export const getMirror = () => replayer.getMirror();

  const controllerHeight = 80;
  let player: HTMLElement;
  let frame: HTMLElement;
  let fullscreenListener: undefined | (() => void);
  let _width: number = width;
  let _height: number = height;
  let controller: {
    toggle: () => void;
    setSpeed: (speed: number) => void;
    toggleSkipInactive: () => void;
  } & Controller;

  let style: string;
  $: style = inlineCss({
    width: `${width}px`,
    height: `${height}px`,
  });
  let playerStyle: string;
  $: playerStyle = inlineCss({
    width: `${width}px`,
    height: `${height + (showController ? controllerHeight : 0)}px`,
  });

  const updateScale = (
    el: HTMLElement,
    frameDimension: { width: number; height: number }
  ) => {
    const widthScale = width / frameDimension.width;
    const heightScale = height / frameDimension.height;
    const scale = [widthScale, heightScale];
    if (maxScale) scale.push(maxScale);
    const finalScale = Math.min(...scale);
    // Calculate offset to center the scaled content
    const scaledWidth = frameDimension.width * finalScale;
    const scaledHeight = frameDimension.height * finalScale;
    const offsetX = (width - scaledWidth) / 2;
    const offsetY = (height - scaledHeight) / 2;
    el.style.transform = `translate(${offsetX}px, ${offsetY}px) scale(${finalScale})`;
  };

  export const triggerResize = () => {
    updateScale(replayer.wrapper, {
      width: replayer.iframe.offsetWidth,
      height: replayer.iframe.offsetHeight,
    });
  };

  export const toggleFullscreen = () => {
    if (player) {
      isFullscreen() ? exitFullscreen() : openFullscreen(player);
    }
  };

  export const addEventListener = (
    event: string,
    handler: (detail: unknown) => unknown
  ) => {
    replayer.on(event, handler);
    switch (event) {
      case 'ui-update-current-time':
      case 'ui-update-progress':
      case 'ui-update-player-state':
        controller.$on(event, ({ detail }) => handler(detail));
      default:
        break;
    }
  };

  export const addEvent = (event: eventWithTime) => {
    replayer.addEvent(event);
    controller.triggerUpdateMeta();
  };
  export const getMetaData = () => replayer.getMetaData();
  export const getReplayer = () => replayer;

  // Pass controller methods as public API
  export const toggle = () => {
    controller.toggle();
  };
  export const setSpeed = (newSpeed: number) => {
    controller.setSpeed(newSpeed);
  };
  export const toggleSkipInactive = () => {
    controller.toggleSkipInactive();
  };
  export const play = () => {
    controller.play();
  };
  export const pause = () => {
    controller.pause();
  };
  export const goto = (timeOffset: number, shouldPlay?: boolean) => {
    controller.goto(timeOffset, shouldPlay);
  };
  export const playRange = (
    timeOffset: number,
    endTimeOffset: number,
    startLooping = false,
    afterHook: undefined | (() => void) = undefined
  ) => {
    controller.playRange(timeOffset, endTimeOffset, startLooping, afterHook);
  };

  onMount(() => {
    // Runtime type check
    if (speedOption !== undefined && typeOf(speedOption) !== 'array') {
      throw new Error('speedOption must be array');
    }
    speedOption.forEach((item) => {
      if (typeOf(item) !== 'number') {
        throw new Error('item of speedOption must be number');
      }
    });
    if (speedOption.indexOf(speed) < 0) {
      throw new Error(`speed must be one of speedOption`);
    }

    replayer = new Replayer(events, {
      speed,
      root: frame,
      ...$$restProps,
    });

    replayer.on('resize', (dimension) => {
      updateScale(replayer.wrapper, dimension as { width: number; height: number });
    });

    // Set initial scale after iframe is rendered
    setTimeout(() => {
      if (replayer.iframe) {
        updateScale(replayer.wrapper, {
          width: replayer.iframe.offsetWidth,
          height: replayer.iframe.offsetHeight,
        });
      }
    }, 0);

    fullscreenListener = onFullscreenChange(() => {
      if (isFullscreen()) {
        setTimeout(() => {
          _width = width;
          _height = height;
          width = player.offsetWidth;
          height = player.offsetHeight - (showController ? controllerHeight : 0);
          updateScale(replayer.wrapper, {
            width: replayer.iframe.offsetWidth,
            height: replayer.iframe.offsetHeight,
          });
        }, 0);
      } else {
        width = _width;
        height = _height;
        updateScale(replayer.wrapper, {
          width: replayer.iframe.offsetWidth,
          height: replayer.iframe.offsetHeight,
        });
      }
    });
  });

  onDestroy(() => {
    fullscreenListener && fullscreenListener();
  });
</script>

<style>
  .rr-player {
    position: relative;
    background: #000;
    border-radius: 5px;
    overflow: hidden;
  }

  .rr-player__frame {
    position: relative;
    overflow: hidden;
  }

  :global(.replayer-wrapper) {
    position: relative;
    transform-origin: top left;
  }

  :global(.replayer-wrapper > iframe) {
    border: none;
    display: block;
  }

  :global(.replayer-mouse-tail) {
    position: absolute;
    top: 0;
    left: 0;
    pointer-events: none;
  }

  :global(.replayer-mouse) {
    position: absolute;
    width: 20px;
    height: 20px;
    transition: 0.05s linear;
  }

  :global(.replayer-mouse::after) {
    content: '';
    display: block;
    width: 20px;
    height: 20px;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23f97316' d='M4.5 2L19.5 12.5L12 13L8.5 20L4.5 2Z'/%3E%3Cpath fill='%23fff' d='M5.5 4L17 12L11.5 12.5L8.5 18L5.5 4Z'/%3E%3C/svg%3E");
    background-size: contain;
    background-repeat: no-repeat;
  }

  :global(.replayer-mouse.active::after) {
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath fill='%23ef4444' d='M4.5 2L19.5 12.5L12 13L8.5 20L4.5 2Z'/%3E%3Cpath fill='%23fff' d='M5.5 4L17 12L11.5 12.5L8.5 18L5.5 4Z'/%3E%3C/svg%3E");
  }
</style>

<div class="rr-player" bind:this={player} style={playerStyle}>
  <div class="rr-player__frame" bind:this={frame} {style}></div>
  {#if replayer}
    <Controller
      bind:this={controller}
      {replayer}
      {showController}
      {autoPlay}
      {speed}
      {speedOption}
      {skipInactive}
      {tags}
      {inactiveColor}
      on:fullscreen={() => toggleFullscreen()}
      on:ui-update-current-time
      on:ui-update-progress
      on:ui-update-player-state
    />
  {/if}
</div>
