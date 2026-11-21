// An app's view of the package: each entry point by name, so `exports`
// resolves it to the built dist. tsconfig.dist.json checks these
// declarations with skipLibCheck off, as an app that turns it off would.
export * as core from '@latticecms/core';
export * as store from '@latticecms/core/store';
export * as conformance from '@latticecms/core/store/conformance';
