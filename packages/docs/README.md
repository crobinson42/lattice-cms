# @latticecms/docs

The Lattice CMS documentation site (Astro + Starlight), published at [crobinson42.github.io/lattice-cms](https://crobinson42.github.io/lattice-cms/) on every push to main.

`src/content/docs/index.md` is written by hand. Every other page is generated when `dev` or `build` runs: Getting started from the root README's section, and one page per published package from its `README.md`. The generated pages are gitignored. Edit the READMEs, not the pages.

`scripts/sync-package-docs.mjs` rewrites the READMEs' relative links: a package directory to its page, a Getting started anchor to that page, and any other path in the repository to GitHub. A link to a path that does not exist fails the build, and `starlight-links-validator` checks the links between pages.

```bash
npm run dev -w @latticecms/docs
```

The site is served under `/lattice-cms` (the GitHub Pages project path), locally too: http://localhost:4321/lattice-cms/. Root-relative links in Markdown include that prefix, such as `[core](/lattice-cms/packages/core/)`.
