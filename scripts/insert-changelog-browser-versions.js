#!/usr/bin/env node
//
// insert-changelog-browser-versions.js
//
// Inserts a generated "Supported Libraries & Browsers" section into the newest
// (top) release section of CHANGELOG.md. Reads the block from stdin — pair it
// with changelog-browser-versions.js:
//
//   node scripts/changelog-browser-versions.js \
//     | node scripts/insert-changelog-browser-versions.js [CHANGELOG.md]
//
// The block is wrapped in HTML-comment markers and scoped to the top release
// section only, so the operation is idempotent (safe to re-run on every push
// while the Release PR is open) and never disturbs the blocks of already
// released versions further down the file.

import { readFileSync, writeFileSync } from 'node:fs';

const START = '<!-- browser-versions:start -->';
const END = '<!-- browser-versions:end -->';

const path = process.argv[2] || 'CHANGELOG.md';

const block = readFileSync(0, 'utf8').trim();
if (!block) {
  console.error('No block provided on stdin; nothing to insert.');
  process.exit(1);
}

const original = readFileSync(path, 'utf8');
const lines = original.split('\n');

// The newest release section runs from the first "## " heading (release-please
// version headings) to the next "## " heading, or end of file.
const isVersionHeading = (l) => /^## /.test(l);
const start = lines.findIndex(isVersionHeading);
if (start === -1) {
  console.error(
    `No "## " release heading found in ${path}; leaving unchanged.`,
  );
  process.exit(0);
}
let end = lines.findIndex((l, i) => i > start && isVersionHeading(l));
if (end === -1) end = lines.length;

const head = lines.slice(0, start + 1); // up to and including the version heading
const section = lines.slice(start + 1, end);
const tail = lines.slice(end); // starts at the next "## " heading (or empty)

// Drop any existing marker block within this section before re-inserting. If a
// START is somehow left without a matching END, remove from START to the end of
// the section so we never leave a duplicate/stray marker behind.
const sStart = section.findIndex((l) => l.includes(START));
if (sStart !== -1) {
  const sEnd = section.findIndex((l, i) => i >= sStart && l.includes(END));
  const count = sEnd === -1 ? section.length - sStart : sEnd - sStart + 1;
  section.splice(sStart, count);
}
// Trim trailing blank lines so the block sits flush at the end of the section.
while (section.length && section[section.length - 1].trim() === '')
  section.pop();

const insertion = ['', START, '', block, '', END, ''];
const rebuilt = [...head, ...section, ...insertion, ...tail].join('\n');

if (rebuilt === original) {
  console.error('Browser versions block already up to date.');
} else {
  writeFileSync(path, rebuilt);
  console.error(`Inserted browser versions block into ${path}.`);
}
