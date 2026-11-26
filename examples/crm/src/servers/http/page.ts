import { readFile } from 'node:fs/promises';

const html = 'text/html; charset=utf-8';

const contentTypes: Readonly<Record<string, string>> = {
  html,
  js: 'text/javascript; charset=utf-8',
  css: 'text/css; charset=utf-8',
  svg: 'image/svg+xml',
  png: 'image/png',
  ico: 'image/x-icon',
  woff2: 'font/woff2',
};

function contentTypeOf(name: string): string {
  return (
    contentTypes[name.split('.').at(-1) ?? ''] ?? 'application/octet-stream'
  );
}

async function file(at: URL): Promise<Uint8Array<ArrayBuffer> | undefined> {
  try {
    // A plain Uint8Array, which every runtime's Response takes.
    return new Uint8Array(await readFile(at));
  } catch {
    return undefined;
  }
}

/**
 * Serves the built web page from `root`, Vite's output, at `/`. A file
 * under `/assets/` is content-hashed, so it is cached for good; any other
 * path is a client route, such as `/admin/deals`, and gets index.html,
 * never cached, so a reload on a deep link renders and a deploy shows at
 * once. The edge sends it only the paths that are not the API's.
 */
export function webPage(root: URL): (request: Request) => Promise<Response> {
  return async (request) => {
    const path = new URL(request.url).pathname.slice(1);
    if (path.startsWith('assets/')) {
      const name = path.slice('assets/'.length);
      // A plain file name only: no directory, so no path leaves `assets/`.
      const body = /^[\w.-]+$/.test(name)
        ? await file(new URL(`assets/${name}`, root))
        : undefined;
      if (body === undefined) return new Response('Not Found', { status: 404 });
      return new Response(body, {
        headers: {
          'content-type': contentTypeOf(name),
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
    }
    const index = await file(new URL('index.html', root));
    if (index === undefined) {
      return new Response('The web page is not built: run npm run build.', {
        status: 404,
      });
    }
    return new Response(index, {
      headers: {
        'content-type': html,
        'cache-control': 'no-cache',
      },
    });
  };
}
