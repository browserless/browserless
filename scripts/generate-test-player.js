#!/usr/bin/env node
/* eslint-disable no-undef */

'use strict';

/**
 * Generate a standalone test page for the session replay player.
 * This creates static/test-player.html with mock recording data.
 *
 * Usage: bun scripts/generate-test-player.js
 * Then: npm run dev (or npm start)
 * Navigate to: http://localhost:3000/test-player.html
 */

import fs from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

const generatedFile = join(rootDir, 'src/generated/rrweb-player.ts');
const outputFile = join(rootDir, 'static/test-player.html');

// Generate mock rrweb recording events
function generateMockRecordingData() {
  const startTime = Date.now() - 10000; // 10 seconds ago
  const viewportWidth = 1920;
  const viewportHeight = 1080;

  // Create a simple page structure for the FullSnapshot
  const documentNode = {
    type: 0, // Document
    childNodes: [
      {
        type: 1, // DocumentType
        name: 'html',
        publicId: '',
        systemId: '',
      },
      {
        type: 2, // Element
        tagName: 'html',
        attributes: { lang: 'en' },
        childNodes: [
          {
            type: 2, // Element
            tagName: 'head',
            attributes: {},
            childNodes: [
              {
                type: 2,
                tagName: 'title',
                attributes: {},
                childNodes: [
                  { type: 3, textContent: 'Test Recording Page' },
                ],
                id: 3,
              },
              {
                type: 2,
                tagName: 'style',
                attributes: {},
                childNodes: [
                  {
                    type: 3,
                    textContent: `
                      * { box-sizing: border-box; margin: 0; padding: 0; }
                      body {
                        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
                        min-height: 100vh;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        color: white;
                      }
                      .container {
                        text-align: center;
                        padding: 60px;
                        background: rgba(255,255,255,0.1);
                        border-radius: 20px;
                        backdrop-filter: blur(10px);
                        box-shadow: 0 8px 32px rgba(0,0,0,0.3);
                      }
                      h1 { font-size: 48px; margin-bottom: 20px; }
                      p { font-size: 18px; opacity: 0.9; margin-bottom: 30px; }
                      .btn {
                        display: inline-block;
                        padding: 15px 40px;
                        background: #f97316;
                        color: white;
                        border-radius: 30px;
                        text-decoration: none;
                        font-weight: 600;
                        transition: transform 0.2s, box-shadow 0.2s;
                      }
                      .btn:hover {
                        transform: translateY(-2px);
                        box-shadow: 0 4px 15px rgba(249, 115, 22, 0.4);
                      }
                      .stats {
                        display: flex;
                        gap: 40px;
                        justify-content: center;
                        margin-top: 40px;
                      }
                      .stat { text-align: center; }
                      .stat-value { font-size: 36px; font-weight: bold; }
                      .stat-label { font-size: 14px; opacity: 0.7; }
                    `,
                  },
                ],
                id: 4,
              },
            ],
            id: 2,
          },
          {
            type: 2, // Element
            tagName: 'body',
            attributes: {},
            childNodes: [
              {
                type: 2,
                tagName: 'div',
                attributes: { class: 'container' },
                childNodes: [
                  {
                    type: 2,
                    tagName: 'h1',
                    attributes: {},
                    childNodes: [{ type: 3, textContent: '🎬 Session Replay Test' }],
                    id: 7,
                  },
                  {
                    type: 2,
                    tagName: 'p',
                    attributes: {},
                    childNodes: [
                      {
                        type: 3,
                        textContent:
                          'This is a mock recording to test the player CSS fixes.',
                      },
                    ],
                    id: 8,
                  },
                  {
                    type: 2,
                    tagName: 'a',
                    attributes: { class: 'btn', href: '#' },
                    childNodes: [{ type: 3, textContent: 'Get Started' }],
                    id: 9,
                  },
                  {
                    type: 2,
                    tagName: 'div',
                    attributes: { class: 'stats' },
                    childNodes: [
                      {
                        type: 2,
                        tagName: 'div',
                        attributes: { class: 'stat' },
                        childNodes: [
                          {
                            type: 2,
                            tagName: 'div',
                            attributes: { class: 'stat-value' },
                            childNodes: [{ type: 3, textContent: '1.2K' }],
                            id: 11,
                          },
                          {
                            type: 2,
                            tagName: 'div',
                            attributes: { class: 'stat-label' },
                            childNodes: [{ type: 3, textContent: 'Sessions' }],
                            id: 12,
                          },
                        ],
                        id: 10,
                      },
                      {
                        type: 2,
                        tagName: 'div',
                        attributes: { class: 'stat' },
                        childNodes: [
                          {
                            type: 2,
                            tagName: 'div',
                            attributes: { class: 'stat-value' },
                            childNodes: [{ type: 3, textContent: '45s' }],
                            id: 14,
                          },
                          {
                            type: 2,
                            tagName: 'div',
                            attributes: { class: 'stat-label' },
                            childNodes: [{ type: 3, textContent: 'Avg Duration' }],
                            id: 15,
                          },
                        ],
                        id: 13,
                      },
                      {
                        type: 2,
                        tagName: 'div',
                        attributes: { class: 'stat' },
                        childNodes: [
                          {
                            type: 2,
                            tagName: 'div',
                            attributes: { class: 'stat-value' },
                            childNodes: [{ type: 3, textContent: '98%' }],
                            id: 17,
                          },
                          {
                            type: 2,
                            tagName: 'div',
                            attributes: { class: 'stat-label' },
                            childNodes: [{ type: 3, textContent: 'Success Rate' }],
                            id: 18,
                          },
                        ],
                        id: 16,
                      },
                    ],
                    id: 19,
                  },
                ],
                id: 6,
              },
            ],
            id: 5,
          },
        ],
        id: 1,
      },
    ],
  };

  const events = [
    // Type 4: Meta event
    {
      type: 4,
      timestamp: startTime,
      data: {
        href: 'http://localhost:3000/test-page',
        width: viewportWidth,
        height: viewportHeight,
      },
    },
    // Type 2: FullSnapshot
    {
      type: 2,
      timestamp: startTime + 100,
      data: {
        node: documentNode,
        initialOffset: { top: 0, left: 0 },
      },
    },
  ];

  // Generate mouse movement events over 10 seconds
  // Move in a figure-8 pattern across the page
  const duration = 10000;
  const numMoveEvents = 50;
  const centerX = viewportWidth / 2;
  const centerY = viewportHeight / 2;
  const radiusX = 300;
  const radiusY = 150;

  for (let i = 0; i < numMoveEvents; i++) {
    const t = (i / numMoveEvents) * Math.PI * 4; // Two full cycles
    const x = centerX + radiusX * Math.sin(t);
    const y = centerY + radiusY * Math.sin(2 * t);
    const timestamp = startTime + 200 + (i * duration) / numMoveEvents;

    events.push({
      type: 3, // IncrementalSnapshot
      timestamp,
      data: {
        source: 1, // MouseMove
        positions: [
          {
            x: Math.round(x),
            y: Math.round(y),
            id: 9, // The button element
            timeOffset: 0,
          },
        ],
      },
    });
  }

  // Add some mouse clicks
  const clickTimes = [2000, 5000, 8000];
  for (const offset of clickTimes) {
    events.push({
      type: 3,
      timestamp: startTime + offset,
      data: {
        source: 2, // MouseInteraction
        type: 2, // Click
        id: 9, // Button element
        x: centerX,
        y: centerY + 50,
      },
    });
  }

  // Sort events by timestamp
  events.sort((a, b) => a.timestamp - b.timestamp);

  const metadata = {
    id: 'test-recording-' + Date.now().toString(36),
    browserType: 'chromium',
    duration: duration,
    startedAt: startTime,
    endedAt: startTime + duration,
    eventCount: events.length,
    routePath: '/test-page',
  };

  return { events, metadata };
}

// Import JS and CSS from the generated TypeScript file
// The generated file exports RRWEB_PLAYER_CSS and RRWEB_PLAYER_JS as strings
async function extractPlayerAssets() {
  // Dynamic import of the generated TS file (bun handles TS natively)
  const { RRWEB_PLAYER_CSS, RRWEB_PLAYER_JS } = await import(generatedFile);
  return { css: RRWEB_PLAYER_CSS || '', js: RRWEB_PLAYER_JS || '' };
}

// Generate the test HTML
function generateTestHTML(css, js, recording) {
  const recordingData = JSON.stringify(recording);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Session Replay Player - CSS Fix Test</title>
  <style>
/* CSS from bundled Svelte app */
${css}

/* Base styles */
* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  overflow: hidden;
}
#app {
  height: 100%;
}

/* Test page header */
.test-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  background: #1d1f27;
  color: #fff;
  padding: 8px 16px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  font-size: 12px;
  z-index: 1000;
  border-bottom: 1px solid #3c3f47;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.test-header h1 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
}

.test-header .checklist {
  display: flex;
  gap: 16px;
}

.test-header .check-item {
  display: flex;
  align-items: center;
  gap: 4px;
  color: #9ba0ab;
}

.test-header .check-item input {
  cursor: pointer;
}

/* Offset content for fixed header */
#app {
  padding-top: 40px;
}
  </style>
</head>
<body>
  <div class="test-header">
    <h1>🧪 Player CSS Fix Test</h1>
    <div class="checklist">
      <label class="check-item">
        <input type="checkbox" id="check-video">
        Video visible
      </label>
      <label class="check-item">
        <input type="checkbox" id="check-centered">
        Properly centered
      </label>
      <label class="check-item">
        <input type="checkbox" id="check-fullscreen">
        Fullscreen works
      </label>
      <label class="check-item">
        <input type="checkbox" id="check-controls">
        Controls work
      </label>
    </div>
  </div>
  <div id="app"></div>
  <script>
    // Recording data for Svelte app
    window.__RECORDING_DATA__ = ${recordingData};
  </script>
  <script>
${js}
  </script>
</body>
</html>`;
}

(async () => {
  console.log('Generating test player page...');

  try {
    // Check if generated file exists
    try {
      await fs.access(generatedFile);
    } catch {
      console.error('Error: src/generated/rrweb-player.ts not found.');
      console.error('Run "npm run bundle:rrweb" first to build the player.');
      process.exit(1);
    }

    // Extract assets from generated file
    const { css, js } = await extractPlayerAssets();

    if (!js) {
      console.error('Error: Could not extract player JS from generated file.');
      process.exit(1);
    }

    // Generate mock recording
    const recording = generateMockRecordingData();
    console.log(`Generated mock recording with ${recording.events.length} events`);

    // Generate HTML
    const html = generateTestHTML(css, js, recording);

    // Write to static directory
    await fs.writeFile(outputFile, html);
    console.log(`Generated ${outputFile}`);
    console.log('');
    console.log('To test:');
    console.log('  1. npm run dev (or npm start)');
    console.log('  2. Navigate to: http://localhost:3000/test-player.html');
    console.log('');
    console.log('Verification checklist:');
    console.log('  [ ] Video content is visible (see gradient page with stats)');
    console.log('  [ ] Video is properly centered in the player frame');
    console.log('  [ ] Click fullscreen - video fills entire screen');
    console.log('  [ ] Exit fullscreen - returns to normal view');
    console.log('  [ ] Playback controls work (play/pause, timeline, speed)');
  } catch (error) {
    console.error('Error generating test page:', error);
    process.exit(1);
  }
})();
