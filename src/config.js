// App identity on the shared origin (johnbui765.github.io).
// Every cache name, localStorage key and IndexedDB name is derived from APP_ID,
// and APP_ID is derived from the folder the app is served from
// (https://johnbui765.github.io/compass-control/ → "compass-control"), so two
// copies of this app deployed under different repo names can never share or
// delete each other's data. sw.js derives the same id from its scope.

export const APP_VERSION = '1.0.0';
export const DEFAULT_APP_ID = 'compass-control';

/** Last path segment of the app folder, lower-cased; DEFAULT_APP_ID at a site root. */
export function deriveAppId(appRootPathname) {
  const seg = String(appRootPathname || '').split('/').filter(Boolean).pop();
  if (!seg) return DEFAULT_APP_ID;
  let id;
  try {
    id = decodeURIComponent(seg).toLowerCase();
  } catch {
    return DEFAULT_APP_ID;
  }
  return /^[a-z0-9._-]+$/.test(id) ? id : DEFAULT_APP_ID;
}

const appRoot = new URL('../', import.meta.url);
export const APP_ROOT_PATH = appRoot.pathname; // e.g. "/compass-control/"
export const APP_ID = deriveAppId(APP_ROOT_PATH);
export const LS_PREFIX = `${APP_ID}:`;
export const DB_NAME = `${APP_ID}-db`;
/** What manifest.webmanifest "id" must be for this deployment. */
export const EXPECTED_MANIFEST_ID = APP_ROOT_PATH;
