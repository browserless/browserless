#!/usr/bin/env node
import { cp } from 'node:fs/promises';

// tsc emits JavaScript, not the GraphQL files read relative to the built schema
// loader. Copy them for both runtime execution and the published SDK package.
await cp(
  new URL('../src/bql/schema/base/', import.meta.url),
  new URL('../build/bql/schema/base/', import.meta.url),
  { recursive: true },
);
