#!/usr/bin/env node
/* global console, process */
'use strict';

import { spawn } from 'child_process';
import { promisify } from 'util';

const exec = promisify(spawn);

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
      shell: true 
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
 * Run commands in parallel with a concurrency limit
 * @param {Array} tasks - Array of task objects with command, args, and name
 * @param {number} concurrency - Maximum number of concurrent tasks
 * @returns {Promise}
 */
const runParallel = async (tasks, concurrency = 4) => {
  const results = [];
  const running = new Set();
  
  for (const task of tasks) {
    if (running.size >= concurrency) {
      await Promise.race(running);
    }
    
    const promise = runCommand(task.command, task.args, task.name)
      .then(result => {
        running.delete(promise);
        return result;
      })
      .catch(error => {
        running.delete(promise);
        throw error;
      });
    
    running.add(promise);
    results.push(promise);
  }
  
  return Promise.all(results);
};

/**
 * Main build function with optimized parallel execution
 */
const buildOptimized = async () => {
  console.log('🏗️  Starting optimized build...');
  const startTime = Date.now();
  
  try {
    // Step 1: Clean (must be first)
    console.log('\n📁 Step 1: Cleaning...');
    await runCommand('node', ['scripts/clean.js'], 'Clean');
    
    // Step 2: Run independent tasks in parallel
    console.log('\n⚡ Step 2: Running independent tasks in parallel...');
    const parallelTasks = [
      { command: 'npx', args: ['tsc'], name: 'TypeScript Compilation' },
      { command: 'node', args: ['scripts/install-adblock.js'], name: 'Install AdBlock' },
      { command: 'node', args: ['scripts/install-devtools.js'], name: 'Install DevTools' },
    ];
    
    await runParallel(parallelTasks, 3);
    
    // Step 3: Run schema generation (depends on TypeScript compilation)
    console.log('\n📋 Step 3: Generating schemas...');
    await runCommand('node', ['scripts/build-schemas.js'], 'Schema Generation');
    
    // Step 4: Run OpenAPI generation (depends on schemas)
    console.log('\n📚 Step 4: Generating OpenAPI...');
    await runCommand('node', ['scripts/build-open-api.js'], 'OpenAPI Generation');
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n🎉 Build completed successfully in ${totalTime}s!`);
    
  } catch (error) {
    console.error('\n💥 Build failed:', error.message);
    process.exit(1);
  }
};

/**
 * Development build function (includes additional dev-specific tasks)
 */
const buildDevOptimized = async () => {
  console.log('🔧 Starting optimized development build...');
  const startTime = Date.now();
  
  try {
    // First run the regular optimized build
    await buildOptimized();
    
    // Then run dev-specific tasks in parallel
    console.log('\n🔧 Step 5: Running development tasks in parallel...');
    const devTasks = [
      { command: 'node', args: ['scripts/build-function.js'], name: 'Function Build' },
      { command: 'node', args: ['scripts/install-debugger.js'], name: 'Install Debugger' },
    ];
    
    await runParallel(devTasks, 2);
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n🎉 Development build completed successfully in ${totalTime}s!`);
    
  } catch (error) {
    console.error('\n💥 Development build failed:', error.message);
    process.exit(1);
  }
};

// Handle command line arguments
const args = process.argv.slice(2);
const command = args[0];

if (command === 'dev') {
  buildDevOptimized();
} else {
  buildOptimized();
} 