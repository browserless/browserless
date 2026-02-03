// Entry point for the Svelte player bundle
// This file is bundled by Vite and served in the replay player page

import App from './App.svelte';
import type { Replay } from './types';

// Global export for inline script usage
declare global {
  interface Window {
    ReplayPlayer: typeof ReplayPlayer;
    __REPLAY_DATA__?: Replay;
  }
}

class ReplayPlayer {
  private app: App;

  constructor(options: { target: HTMLElement; replay: Replay }) {
    this.app = new App({
      target: options.target,
      props: {
        replay: options.replay,
      },
    });
  }

  destroy() {
    this.app.$destroy();
  }
}

// Auto-initialize if replay data is provided
if (typeof window !== 'undefined') {
  window.ReplayPlayer = ReplayPlayer;

  // Support auto-initialization when script loads
  document.addEventListener('DOMContentLoaded', () => {
    const replayData = window.__REPLAY_DATA__;
    const target = document.getElementById('app');

    if (replayData && target) {
      new ReplayPlayer({
        target,
        replay: replayData,
      });
    }
  });
}

export { ReplayPlayer };
export default ReplayPlayer;
