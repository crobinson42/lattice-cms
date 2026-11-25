import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Writes the generated pages: getting-started from the root README, and one
// page per published package from its README. Links that GitHub resolves
// against the repository are rewritten for the site.

const docsRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
);
const repoRoot = path.resolve(docsRoot, '../..');
const contentDir = path.join(docsRoot, 'src/content/docs');
const packagesDir = path.join(contentDir, 'packages');
const base = '/lattice-cms';
const repoUrl = 'https://github.com/crobinson42/lattice-cms';

const packages = await loadPackages();
const published = new Set(packages.map((pkg) => pkg.dirName));
const gettingStarted = section(
  await readText(path.join(repoRoot, 'README.md')),
  '## Getting started',
  '## Working on this repo',
);
const gettingStartedAnchors = new Set(
  headings(gettingStarted).map((heading) => slug(heading)),
);

const pages = new Map([
  ['packages/index.md', indexPage()],
  ...(await Promise.all(
    packages.map(async (pkg, index) => [
      `packages/${pkg.dirName}.md`,
      await packagePage(pkg, index + 1),
    ]),
  )),
  ['getting-started.md', await gettingStartedPage()],
]);
await writePages();

async function loadPackages() {
  const packagesRoot = path.join(repoRoot, 'packages');
  const entries = await readdir(packagesRoot, { withFileTypes: true });
  const loaded = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const manifestPath = path.join(packagesRoot, entry.name, 'package.json');
    const manifest = JSON.parse(await readText(manifestPath));
    if (manifest.private === true) continue;
    const readmePath = path.join(packagesRoot, entry.name, 'README.md');
    if (!(await exists(readmePath))) {
      throw new Error(
        `Published package ${manifest.name} is missing ${readmePath}`,
      );
    }
    loaded.push({
      dirName: entry.name,
      name: manifest.name,
      description: manifest.description ?? '',
      readme: await readText(readmePath),
    });
  }
  return loaded.sort((a, b) => a.name.localeCompare(b.name));
}

async function packagePage(pkg, order) {
  const from = `packages/${pkg.dirName}/README.md`;
  const lines = pkg.readme.split('\n');
  // The page title replaces the README's own.
  if (lines[0]?.startsWith('# ')) lines.splice(0, lines[1] === '' ? 2 : 1);
  return `${frontmatter({
    title: pkg.name,
    description: pkg.description,
    sidebar: { order },
  })}<!-- Generated from ${from}. Do not edit. -->

${await rewriteLinks(lines.join('\n').trimEnd(), from)}
`;
}

function indexPage() {
  const items = packages
    .map(
      (pkg) =>
        `- [${pkg.name}](${base}/packages/${pkg.dirName}/): ${pkg.description}`,
    )
    .join('\n');
  return `${frontmatter({
    title: 'Packages',
    description: 'The published Lattice CMS packages.',
    sidebar: { label: 'Overview', order: 0 },
  })}<!-- Generated from the published packages. Do not edit. -->

Each page is the package's README.

${items}
`;
}

async function gettingStartedPage() {
  // The section's headings move up a level, so `### 5. The admin page`
  // becomes a page section and keeps its `#5-the-admin-page` anchor.
  const promoted = mapProse(gettingStarted, (line) =>
    line.replace(/^#(#{1,5} )/, '$1'),
  );
  return `${frontmatter({
    title: 'Getting started',
    description:
      'An admin for companies and their contacts, from an empty directory.',
  })}<!-- Generated from README.md, its Getting started section. Do not edit. -->

${await rewriteLinks(promoted, 'README.md')}
`;
}

/** The lines after `start`, up to `end`, both headings of `markdown`. */
function section(markdown, start, end) {
  const lines = markdown.split('\n');
  const from = lines.indexOf(start);
  const to = lines.indexOf(end);
  if (from === -1 || to < from) {
    throw new Error(`README.md has no "${start}" section before "${end}"`);
  }
  return lines
    .slice(from + 1, to)
    .join('\n')
    .trim();
}

/** The text of each heading outside code blocks. */
function headings(markdown) {
  const found = [];
  mapProse(markdown, (line) => {
    const heading = /^#{1,6} (.+)$/.exec(line);
    if (heading?.[1] !== undefined) found.push(heading[1]);
    return line;
  });
  return found;
}

/** A heading's anchor, as GitHub and Starlight make it. */
function slug(heading) {
  return heading
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

/**
 * Each link in `markdown`, a README at `from` in the repository, pointed at
 * the site: a published package's directory to its page, an anchor in the
 * root README's Getting started to that page, and any other file or
 * directory to it on GitHub. A link to a path that does not exist fails.
 */
async function rewriteLinks(markdown, from) {
  const targets = [];
  const link = /(`+)[^`]*?\1|\[([^\]]*)\]\(([^)\s]+)\)/g;
  mapProse(markdown, (line) => {
    for (const match of line.matchAll(link)) {
      if (match[3] !== undefined) targets.push(match[3]);
    }
    return line;
  });
  const hrefs = new Map();
  for (const href of targets) hrefs.set(href, await siteHref(href, from));
  return mapProse(markdown, (line) =>
    line.replace(link, (whole, _code, text, href) =>
      href === undefined ? whole : `[${text}](${hrefs.get(href)})`,
    ),
  );
}

async function siteHref(href, from) {
  // Absolute URLs, and anchors on the same page, stay as written.
  if (/^[a-z][a-z+.-]*:/i.test(href) || href.startsWith('#')) return href;
  const [file = '', hash] = href.split('#');
  const anchor = hash === undefined ? '' : `#${hash}`;
  const target = path.posix
    .normalize(path.posix.join(path.posix.dirname(from), file))
    .replace(/\/$/, '');
  const pkg = /^packages\/([^/]+)(?:\/README\.md)?$/.exec(target)?.[1];
  if (pkg !== undefined && published.has(pkg)) {
    return `${base}/packages/${pkg}/${anchor}`;
  }
  if (target === 'README.md' && gettingStartedAnchors.has(hash)) {
    return `${base}/getting-started/${anchor}`;
  }
  const absolute = path.join(repoRoot, target);
  if (target.startsWith('..') || !(await exists(absolute))) {
    throw new Error(`${from} links to ${href}, which is not in the repository`);
  }
  const kind = (await stat(absolute)).isDirectory() ? 'tree' : 'blob';
  return `${repoUrl}/${kind}/main/${target}${anchor}`;
}

/** `markdown` with `map` applied to each line outside fenced code blocks. */
function mapProse(markdown, map) {
  let fence;
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
      if (fence === undefined && marker !== undefined) {
        fence = marker;
        return line;
      }
      if (fence !== undefined) {
        if (marker?.startsWith(fence) && line.trim() === marker) {
          fence = undefined;
        }
        return line;
      }
      return map(line);
    })
    .join('\n');
}

function frontmatter({ title, description, sidebar }) {
  const lines = [
    `title: ${JSON.stringify(title)}`,
    `description: ${JSON.stringify(description)}`,
  ];
  if (sidebar !== undefined) {
    lines.push('sidebar:');
    for (const [key, value] of Object.entries(sidebar)) {
      lines.push(`  ${key}: ${JSON.stringify(value)}`);
    }
  }
  return `---\n${lines.join('\n')}\n---\n\n`;
}

async function writePages() {
  await mkdir(packagesDir, { recursive: true });
  for (const name of await readdir(packagesDir)) {
    if (name.endsWith('.md') && !pages.has(`packages/${name}`)) {
      await rm(path.join(packagesDir, name));
    }
  }
  for (const [name, content] of pages) {
    await writeFile(path.join(contentDir, name), content);
  }
}

async function readText(file) {
  return (await readFile(file, 'utf8')).replace(/\r\n/g, '\n');
}

async function exists(file) {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}
