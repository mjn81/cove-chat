/**
 * Product name shown in the UI. Kept out of i18n on purpose: the brand is
 * rendered in Latin script in every locale. Technical identifiers (cookie,
 * localStorage and IndexedDB names) deliberately keep the legacy `nodetalk_`
 * prefix so existing sessions and local data survive the rename.
 */
export const APP_NAME = 'Cove';
