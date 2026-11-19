import { pathToFileURL } from 'node:url';

/**
 * Markup primitives shared by the dashboard and attention page renderers.
 */
export const escapeHtml = (text: string): string =>
  text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/** The link attributes for a file: a `file://` link in a new tab when no opener app is set (empty `markdownUrl`),
 *  else the opener's `{path}` template with the encoded path. */
export const openerAttrs = (markdownUrl: string, absPath: string): string =>
  markdownUrl
    ? `href="${escapeHtml(markdownUrl.replace('{path}', encodeURIComponent(absPath)))}"`
    : `href="${escapeHtml(pathToFileURL(absPath).href)}" target="_blank"`;

/** A project's hue: the `hue:` its README sets, else the stable hue of its name. */
export const projectHue = (name: string, hues: Readonly<Record<string, number>>): number => hues[name] ?? nameHue(name);

/** Stable hue per name (djb2 hash, full-width before the mod, so similar
 *  names land far apart) — used for project and skill badges. */
export const nameHue = (name: string): number => {
  let hash = 5381;
  for (const ch of name) hash = ((hash * 33) ^ (ch.codePointAt(0) ?? 0)) >>> 0;
  return hash % 360;
};
