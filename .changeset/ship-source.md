---
'@latticecms/core': patch
'@latticecms/store-mongo': patch
---

Each package ships its TypeScript source next to `dist`, so the source maps resolve and go-to-definition opens the real code. The published declarations type-check with `skipLibCheck` off.
