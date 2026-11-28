import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import { apiPaths } from './src/servers/http/api-paths.js';

// The web page: built into dist/web and served at / by the HTTP server, with
// the admin at /admin as one of its client routes. `npm run dev` serves it
// with reloads, and sends the API's paths to the server on port 3000: the
// same list the server routes by. Each is anchored, so a client route such
// as /authors is not mistaken for /auth.
const api = 'http://localhost:3000';

export default defineConfig({
  plugins: [tailwindcss()],
  root: 'src/web',
  base: '/',
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    // .vite/manifest.json: which files each page loads, for the bundle test.
    manifest: true,
    rolldownOptions: {
      output: {
        // React in a chunk of its own, so the bundle test can hold the
        // app's share to a budget apart from React's.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/,
            },
          ],
        },
      },
      // swr and Base UI mark modules "use client" for server components. A
      // bundle for the browser drops the directive, which is what it wants.
      onwarn(warning, warn) {
        if (warning.code !== 'MODULE_LEVEL_DIRECTIVE') warn(warning);
      },
    },
  },
  server: {
    proxy: Object.fromEntries(
      apiPaths.map((path) => [`^${path.replaceAll('.', '\\.')}(/|$)`, api]),
    ),
  },
});
