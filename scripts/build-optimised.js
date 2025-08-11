#!/usr/bin/env node
/* global console, process */
'use strict';

import { spawn } from 'child_process';
import { promisify } from 'util';

/**
 * Run a command and return a promise
 * @param {string} command - The command to run
 * @param {string[]} args - Command arguments
 * @param {string} name - Name for logging
 * @param {number} timeout - Timeout in milliseconds (default: 10 minutes)
 * @returns {Promise}
 */
const runCommand = async (command, args, name, timeout = 600000) => {
  console.log(`Executing "${name}"...`);
  const startTime = Date.now();

  try {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
    });

    return new Promise((resolve, reject) => {
      // Set timeout
      const timeoutId = setTimeout(() => {
        child.kill('SIGTERM');
        reject(new Error(`${name} timed out after ${timeout / 1000}s`));
      }, timeout);

      child.on('close', (code) => {
        clearTimeout(timeoutId);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        if (code === 0) {
          console.log(`${name} completed in ${duration}s`);
          resolve();
        } else {
          console.error(
            `${name} failed after ${duration}s with code ${code}`,
          );
          reject(new Error(`${name} failed with exit code ${code}`));
        }
      });

      child.on('error', (error) => {
        clearTimeout(timeoutId);
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.error(`${name} errored after ${duration}s:`, error.message);
        reject(error);
      });
    });
  } catch (error) {
    console.error(`Failed to start ${name}:`, error.message);
    throw error;
  }
};

/**
 * Main build function
 */
const main = async () => {
  console.log('Starting optimized build process...');
  const startTime = Date.now();

  try {
    // Check if we're in a CI environment
    const isCI = process.env.CI === 'true';
    console.log(`Environment: ${isCI ? 'CI/CD' : 'Development'}`);

    // Run independent tasks in parallel
    const parallelTasks = [
      // Clean and TypeScript compilation (sequential)
      async () => {
        await runCommand('npm', ['run', 'clean'], 'Clean', 60000);
        await runCommand(
          'npm',
          ['run', 'build:ts'],
          'TypeScript Compilation',
          300000,
        );
      },

      // Install adblock (independent)
      runCommand(
        'npm',
        ['run', 'install:adblock'],
        'Adblock Installation',
        120000,
      ),

      // Install devtools (independent)
      runCommand(
        'npm',
        ['run', 'build:devtools'],
        'Devtools Installation',
        120000,
      ),
    ];

    // Run parallel tasks
    await Promise.all(parallelTasks);

    // Run schema generation (depends on TypeScript compilation)
    await runCommand(
      'node',
      ['scripts/build-schemas.js'],
      'Schema Generation',
      300000,
    );

    // Run OpenAPI generation (depends on schemas)
    await runCommand(
      'node',
      ['scripts/build-open-api.js'],
      'OpenAPI Generation',
      120000,
    );

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`Optimized build completed successfully in ${totalTime}s!`);
  } catch (error) {
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.error(`Build failed after ${totalTime}s:`, error.message);
    process.exit(1);
  }
};

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
