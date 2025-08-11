#!/usr/bin/env node
/* global console, process */
'use strict';

import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

/**
 * Check if a file exists
 * @param {string} filePath - Path to check
 * @returns {Promise<boolean>}
 */
const fileExists = async (filePath) => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

/**
 * Check if build directory exists and has content
 * @returns {Promise<boolean>}
 */
const isBuildReady = async () => {
  const buildDir = path.join(process.cwd(), 'build');
  try {
    const stats = await fs.stat(buildDir);
    if (!stats.isDirectory()) return false;

    const files = await fs.readdir(buildDir);
    return files.length > 0;
  } catch {
    return false;
  }
};

/**
 * Run a command and return a promise
 * @param {string} command - The command to run
 * @param {string[]} args - Command arguments
 * @param {string} name - Name for logging
 * @returns {Promise}
 */
const runCommand = async (command, args, name) => {
  console.log(`🚀 Starting ${name}...`);
  const startTime = Date.now();

  try {
    const child = spawn(command, args, {
      stdio: 'inherit',
      shell: true,
    });

    return new Promise((resolve, reject) => {
      child.on('close', (code) => {
        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        if (code === 0) {
          console.log(`✅ ${name} completed in ${duration}s`);
          resolve();
        } else {
          console.error(`❌ ${name} failed after ${duration}s`);
          reject(new Error(`${name} failed with code ${code}`));
        }
      });

      child.on('error', (error) => {
        console.error(`❌ ${name} error:`, error);
        reject(error);
      });
    });
  } catch (error) {
    console.error(`❌ ${name} failed:`, error);
    throw error;
  }
};

/**
 * Fast development build - only rebuilds what's necessary
 */
const devFast = async () => {
  console.log('⚡ Starting fast development build...');
  const startTime = Date.now();

  try {
    // Check if we need to do a full build
    const buildReady = await isBuildReady();

    if (!buildReady) {
      console.log(
        '📁 Build directory not found or empty, running full build...',
      );
      await runCommand('node', ['scripts/build-optimized.js'], 'Full Build');
    } else {
      console.log('📁 Build directory exists, checking for changes...');

      // Only compile TypeScript (fastest step)
      console.log('🔧 Compiling TypeScript only...');
      await runCommand('npx', ['tsc'], 'TypeScript Compilation');

      // Only rebuild schemas if needed (this is the slowest part)
      console.log('📋 Checking if schema rebuild is needed...');
      const schemasExist = await fileExists(
        path.join(
          process.cwd(),
          'build/routes/chrome/http/screenshot.post.body.json',
        ),
      );

      if (!schemasExist) {
        console.log('📋 Schemas missing, rebuilding...');
        await runCommand(
          'node',
          ['scripts/build-schemas.js'],
          'Schema Generation',
        );
      } else {
        console.log('📋 Schemas exist, skipping...');
      }

      // Only rebuild OpenAPI if schemas changed
      if (!schemasExist) {
        console.log('📚 Rebuilding OpenAPI...');
        await runCommand(
          'node',
          ['scripts/build-open-api.js'],
          'OpenAPI Generation',
        );
      } else {
        console.log('📚 OpenAPI exists, skipping...');
      }
    }

    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n🎉 Fast development build completed in ${totalTime}s!`);

    // Start the development server
    console.log('\n🚀 Starting development server...');
    await runCommand(
      'env-cmd',
      ['-f', '.env', 'node', 'build'],
      'Development Server',
    );
  } catch (error) {
    console.error('\n💥 Fast development build failed:', error.message);
    process.exit(1);
  }
};

// Run the fast development build
devFast();
