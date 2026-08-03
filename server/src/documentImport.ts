import fs from 'fs';
import path from 'path';
import AdmZip from 'adm-zip';
import { load } from 'cheerio';
import { DIRS } from './config';
import { id } from './util';
import { resizeImageToJpeg } from './ffmpeg';
import { sanitizeDocumentHtml } from './routes/documents';

/**
 * One-time developer migration from her old Google Docs (P11 — dev-panel
 * only, English is fine, she never sees this). Google's "Web page, zipped"
 * export keeps bold/colored runs as CSS classes (not inline styles) with a
 * <style> block defining them, plus real image files — so importing means
 * resolving that class→style mapping ourselves, then flattening everything
 * else (headings, lists, tables, links, fonts) to plain paragraphs. That
 * flattening is a deliberate, confirmed trade-off, not an oversight — this
 * editor only ever supports bold, one text color, and images.
 */

export interface ImportResult {
  html: string;
  warnings: string[];
}

interface ClassRule {
  bold?: boolean;
  color?: string;
}

const COLOR_RE = /(?:^|;)\s*color\s*:\s*(#[0-9a-fA-F]{3,6}|rgb\([^)]+\))/;
const BOLD_RE = /font-weight\s*:\s*(700|800|900|bold)/i;
const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'tr', 'blockquote']);

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Crude but sufficient CSS parser: `.c1, .c2{font-weight:700;color:#ff0000}` blocks only. */
function parseClassRules(cssText: string): Map<string, ClassRule> {
  const map = new Map<string, ClassRule>();
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = ruleRe.exec(cssText))) {
    const body = m[2];
    const bold = BOLD_RE.test(body);
    const colorMatch = COLOR_RE.exec(body);
    if (!bold && !colorMatch) continue;
    for (const rawSelector of m[1].split(',')) {
      const sel = rawSelector.trim();
      if (!sel.startsWith('.')) continue;
      const cls = sel.slice(1).trim();
      if (!cls) continue;
      const existing = map.get(cls) || {};
      if (bold) existing.bold = true;
      if (colorMatch) existing.color = colorMatch[1];
      map.set(cls, existing);
    }
  }
  return map;
}

async function embedImageBuffer(buffer: Buffer, ext: string): Promise<string> {
  const tmpIn = path.join(DIRS.tmp, `imp-in-${id()}${ext || '.png'}`);
  const tmpOut = path.join(DIRS.tmp, `imp-out-${id()}.jpg`);
  fs.writeFileSync(tmpIn, buffer);
  try {
    await resizeImageToJpeg(tmpIn, tmpOut, 1400, 5);
    return `data:image/jpeg;base64,${fs.readFileSync(tmpOut).toString('base64')}`;
  } finally {
    try { fs.unlinkSync(tmpIn); } catch { /* best effort */ }
    try { fs.unlinkSync(tmpOut); } catch { /* best effort */ }
  }
}

interface WalkEnv {
  $: ReturnType<typeof load>;
  classMap: Map<string, ClassRule>;
  images: Map<string, string>; // basename -> already-embedded data URI
  warnings: string[];
}

function wrapRun(text: string, ctx: { bold: boolean; color?: string }): string {
  if (!text) return '';
  let out = escapeHtml(text);
  if (ctx.color) out = `<span style="color:${ctx.color}">${out}</span>`;
  if (ctx.bold) out = `<b>${out}</b>`;
  return out;
}

function resolveStyle(env: WalkEnv, node: any, tag: string): ClassRule {
  const rule: ClassRule = { bold: tag === 'b' || tag === 'strong' };
  const classes = (env.$(node).attr('class') || '').split(/\s+/).filter(Boolean);
  for (const cls of classes) {
    const classRule = env.classMap.get(cls);
    if (classRule?.bold) rule.bold = true;
    if (classRule?.color) rule.color = classRule.color;
  }
  const inline = env.$(node).attr('style') || '';
  if (BOLD_RE.test(inline)) rule.bold = true;
  const inlineColor = COLOR_RE.exec(inline);
  if (inlineColor) rule.color = inlineColor[1];
  return rule;
}

function walkChildren(env: WalkEnv, node: any, ctx: { bold: boolean; color?: string }): string {
  let out = '';
  env.$(node)
    .contents()
    .each((_: number, child: any) => {
      out += walkNode(env, child, ctx);
    });
  return out;
}

function walkNode(env: WalkEnv, node: any, ctx: { bold: boolean; color?: string }): string {
  if (node.type === 'text') return wrapRun(node.data || '', ctx);
  if (node.type !== 'tag') return '';
  const tag = String(node.tagName || '').toLowerCase();
  if (tag === 'style' || tag === 'script' || tag === 'head') return '';
  if (tag === 'br') return '<br>';
  if (tag === 'img') {
    const src = env.$(node).attr('src') || '';
    const embedded = env.images.get(path.basename(src));
    if (embedded) return `<img src="${embedded}">`;
    if (src) env.warnings.push(`Image not found, skipped: ${src}`);
    return '';
  }
  const style = resolveStyle(env, node, tag);
  const childCtx = { bold: ctx.bold || !!style.bold, color: style.color || ctx.color };
  const inner = walkChildren(env, node, childCtx);
  if (BLOCK_TAGS.has(tag)) {
    return inner.trim() ? `<div>${inner}</div>` : '<div><br></div>';
  }
  return inner;
}

/** Converts Google Docs' exported HTML (class-based bold/color) + resolved images into our narrow format. */
export async function convertGoogleDocsHtml(html: string, zipImages: Map<string, Buffer>): Promise<ImportResult> {
  const $ = load(html);
  const classMap = parseClassRules($('style').text());
  const warnings: string[] = [];

  const referenced = new Set<string>();
  $('img').each((_, el) => {
    const src = $(el).attr('src') || '';
    if (src) referenced.add(path.basename(src));
  });
  const resolvedImages = new Map<string, string>();
  for (const base of referenced) {
    const buf = zipImages.get(base);
    if (!buf) {
      warnings.push(`Image not found in zip, skipped: ${base}`);
      continue;
    }
    try {
      resolvedImages.set(base, await embedImageBuffer(buf, path.extname(base)));
    } catch {
      warnings.push(`Image failed to process, skipped: ${base}`);
    }
  }
  if (resolvedImages.size > 0) warnings.push(`${resolvedImages.size} image(s) embedded.`);

  const env: WalkEnv = { $, classMap, images: resolvedImages, warnings };
  const bodyEl = $('body').get(0) || $.root().get(0);
  const out = walkChildren(env, bodyEl, { bold: false });
  return { html: sanitizeDocumentHtml(out), warnings };
}

/** .txt or .md: only **bold** is understood in markdown mode, everything else stays plain. */
export function convertPlainText(text: string, isMarkdown: boolean): ImportResult {
  const warnings: string[] = [];
  if (isMarkdown) {
    warnings.push('Markdown was lightly converted: only **bold** is preserved — headings, lists and links become plain paragraphs.');
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const htmlLines = lines.map((line) => {
    let escaped = escapeHtml(line);
    if (isMarkdown) escaped = escaped.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
    return `<div>${escaped || '<br>'}</div>`;
  });
  return { html: sanitizeDocumentHtml(htmlLines.join('')), warnings };
}

export async function importDocumentFile(opts: { buffer: Buffer; originalName: string }): Promise<ImportResult> {
  const ext = path.extname(opts.originalName).toLowerCase();
  if (ext === '.zip') {
    const zip = new AdmZip(opts.buffer);
    const entries = zip.getEntries().filter((e) => !e.isDirectory);
    const htmlEntry = entries.find((e) => /\.html?$/i.test(e.entryName));
    if (!htmlEntry) throw new Error('No .html file found inside the zip.');
    const images = new Map<string, Buffer>();
    for (const e of entries) {
      if (/\.(png|jpe?g|gif|webp)$/i.test(e.entryName)) images.set(path.basename(e.entryName), e.getData());
    }
    return convertGoogleDocsHtml(htmlEntry.getData().toString('utf8'), images);
  }
  if (ext === '.html' || ext === '.htm') {
    return convertGoogleDocsHtml(opts.buffer.toString('utf8'), new Map());
  }
  if (ext === '.md') {
    return convertPlainText(opts.buffer.toString('utf8'), true);
  }
  return convertPlainText(opts.buffer.toString('utf8'), false);
}
