// An app's view of the package: its entry point by name, so `exports`
// resolves it to the built dist. tsconfig.dist.json checks these
// declarations with skipLibCheck off, as an app that turns it off would.
export * as admin from '@latticecms/admin';
