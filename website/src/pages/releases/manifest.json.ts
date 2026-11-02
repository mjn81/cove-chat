import type { APIRoute } from 'astro';
import { getManifests } from '../../lib/release-manifests';

/**
 * The update control point: https://covechat.dev/releases/manifest.json. Native clients and self-hosted servers read
 * it first and fall back to the GitHub releases API. Format: docs/auto-update.md.
 */
export const GET: APIRoute = async () => {
  const { latest } = await getManifests();
  // No release data at build time: publish a document without a version, which clients reject and then fall back.
  const body = latest ?? { error: 'no release information available' };
  return new Response(JSON.stringify(body, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
};
