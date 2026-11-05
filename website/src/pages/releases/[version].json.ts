import type { APIRoute, GetStaticPaths } from 'astro';
import { getManifests } from '../../lib/release-manifests';

/** Per-version copy of the manifest (`/releases/0.10.0.json`) so a mirror or a rollback can pin a release. */
export const getStaticPaths = (async () => {
  const { all } = await getManifests();
  return all.map((m) => ({ params: { version: m.version }, props: { manifest: m } }));
}) satisfies GetStaticPaths;

export const GET: APIRoute = ({ props }) =>
  new Response(JSON.stringify(props.manifest, null, 2), {
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  });
