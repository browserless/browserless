#!/usr/bin/env node
import { cp } from 'node:fs/promises';

await cp(
  new URL('../src/bql/schema/base/', import.meta.url),
  new URL('../build/bql/schema/base/', import.meta.url),
  { recursive: true },
);
