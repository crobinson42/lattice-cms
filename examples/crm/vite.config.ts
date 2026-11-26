import { defineConfig } from 'vite';

// The admin page: built into dist/web and served at /admin by the HTTP
// server. `npm run dev` serves it with reloads, and sends the API's
// paths to the server on port 3000.
const api = 'http://localhost:3000';

export default defineConfig({
  root: 'src/web',
  base: '/admin/',
  build: {
    outDir: '../../dist/web',
    emptyOutDir: true,
    rolldownOptions: {
      output: {
        // React in a chunk of its own, so the bundle test can hold the
        // admin's share to a budget apart from React's.
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
    proxy: {
      '/rpc': api,
      '/auth': api,
      '/catalog.json': api,
    },
  },
});
