# Walkthrough

Runs the root README's [Getting started](../../README.md#getting-started) as written, in an empty temp directory, then signs in to the admin it ends with and drives it in headless Chromium. The README is the script, so the two cannot drift.

```bash
npm install
npx playwright install chromium
npm run walkthrough
```

It is not part of `npm run test`: it installs from the npm registry and builds a whole app. CI runs it as its own job on every pull request.

## What it installs

Before 0.1.0 is published, it packs each published package of this checkout (`core`, `store-mongo`, `admin` and `cli`) from a copy whose version is 0.1.0, and installs those tarballs where the README names `@latticecms/*`. Every other dependency comes from the registry, at the ranges the README states. So it tests this checkout's `files`, `exports`, bins and peer ranges as a reader's install will see them.

After 0.1.0 ships, `WALKTHROUGH_FROM=registry npm run walkthrough` installs the published packages instead, with no packing and no rewrite.

## How it reads the README

It reads the section under `## Getting started`, up to the next `##` heading, and takes each fenced block in order:

| Block | What the runner does |
| --- | --- |
| ` ```bash ` | Runs it with `sh -e` in the app's directory. A non-zero exit fails the run, naming the block's line. |
| ` ```bash start ` | Starts it in the background, waits for the first URL it prints, and checks that the URL answers. One per section. |
| ` ```ts src/app.ts ` | Writes the block to that path, whole. Any language works; the path after it is what counts. |
| ` ```ts illustration ` | Skips it: shown to the reader, never run. |

A `bash`, `ts`, `tsx`, `js`, `json` or `html` block with none of these fails the run, so every block is run, written or marked. Other languages, such as `text`, are shown and not run.

Every step runs with `PORT=0`, so the server takes a free port, and without the test's own environment (vitest's variables and colors).

## What it checks in the browser

The steps the README's prose describes: sign in with the token from the start block; create a company; create a contact, picking the company by searching its name; edit the contact; try to delete the company and follow the link to the contacts that still refer to it; delete the contact, then the company; and reload a document's page.
