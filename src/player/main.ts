// Entry point for the Svelte player bundle
// This file is bundled by Vite and served in the recording player page

import App from './App.svelte';
import type { Recording } from './types';

// Global export for inline script usage
declare global {
  interface Window {
    RecordingPlayer: typeof RecordingPlayer;
    __RECORDING_DATA__?: Recording;
  }
}

class RecordingPlayer {
  private app: App;

  constructor(options: { target: HTMLElement; recording: Recording }) {
    this.app = new App({
      target: options.target,
      props: {
        recording: options.recording,
      },
    });
  }

  destroy() {
    this.app.$destroy();
  }
}

// Auto-initialize if recording data is provided
if (typeof window !== 'undefined') {
  window.RecordingPlayer = RecordingPlayer;

  // Support auto-initialization when script loads
  document.addEventListener('DOMContentLoaded', () => {
    const recordingData = window.__RECORDING_DATA__;
    const target = document.getElementById('app');

    if (recordingData && target) {
      new RecordingPlayer({
        target,
        recording: recordingData,
      });
    }
  });
}

export { RecordingPlayer };
export default RecordingPlayer;
