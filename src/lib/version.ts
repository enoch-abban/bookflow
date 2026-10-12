// The app version from package.json and the commit it was built from, injected by vite.config.ts.

export const APP_VERSION: string = __APP_VERSION__;
export const APP_COMMIT: string = __APP_COMMIT__;

/** "bookflow 0.1.0 · d28c85e", or without the commit when it is unknown. */
export const versionLabel = `bookflow ${APP_VERSION}${APP_COMMIT ? ` · ${APP_COMMIT}` : ''}`;
