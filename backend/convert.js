import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import * as cheerio from 'cheerio';
import TurndownService from 'turndown';
import { getBlogHtml } from './data.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUTPUT_DIR = path.join(__dirname, 'output');
const DEFAULT_MD_FILENAME = 'post.md';

async function downloadImage(url, filepath) {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.statusText}`);
    await pipeline(response.body, fs.createWriteStream(filepath));
    return true;
  } catch (err) {
    console.error(`Error downloading ${url}:`, err.message);
    return false;
  }
}

const decodeHtmlEntities = (value) =>
  value
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

const safeSlug = (value) => {
  const replaced = value.replace(/\s+/g, '-').trim();
  const cleaned = replaced.replace(/[<>:"/\\|?*]/g, '').replace(/-+/g, '-');
  return cleaned.replace(/^-+|-+$/g, '');
};

const unescapeBracketedText = (markdown) => {
  const fenceRegex = /```[\s\S]*?```/g;
  let result = '';
  let lastIndex = 0;
  let match = null;

  while ((match = fenceRegex.exec(markdown)) !== null) {
    const before = markdown.slice(lastIndex, match.index);
    result += before.replace(/\\\[([^\]\n]+)\\\]/g, '[$1]');
    result += match[0];
    lastIndex = match.index + match[0].length;
  }

  result += markdown.slice(lastIndex).replace(/\\\[([^\]\n]+)\\\]/g, '[$1]');
  return result;
};

export async function convertSubstackToMarkdown(
  sourceLink,
  { outputDir = DEFAULT_OUTPUT_DIR, writeFile = true, mdFilename = DEFAULT_MD_FILENAME } = {}
) {
  const link = sourceLink;
  let blogHtml = '';

  try {
    blogHtml = await getBlogHtml(link);
  } catch (err) {
    throw new Error(`Failed to load HTML from ${link}: ${err.message}`);
  }

  const $ = cheerio.load(blogHtml);

  // 1. Clean Title and Subtitle (Remove line breaks and extra spaces)
  const cleanText = (selector) => $(selector).text().replace(/\s+/g, ' ').trim();

  const title = cleanText('.post-title');
  const subtitle = cleanText('.subtitle');
  const author = $('meta[name="author"]').attr('content') || 'Unknown';

  const postSlug = safeSlug(title || 'post') || 'post';
  const postDir = path.join(outputDir, postSlug);
  const imageDir = path.join(postDir, 'images');

  // Ensure directories exist
  if (!fs.existsSync(imageDir)) {
    fs.mkdirSync(imageDir, { recursive: true });
  }

  let publishedDate = '';
  try {
    const ldJson = $('script[type="application/ld+json"]').first().html();
    if (ldJson) {
      const parsed = JSON.parse(ldJson);
      const datePublished = Array.isArray(parsed)
        ? parsed.find((item) => item && item.datePublished)?.datePublished
        : parsed.datePublished;
      if (typeof datePublished === 'string' && /^\d{4}-\d{2}-\d{2}/.test(datePublished)) {
        publishedDate = datePublished.slice(0, 10);
      }
    }
  } catch {
    // Ignore malformed JSON-LD
  }
  if (!publishedDate) {
    const timeDate = $('time[datetime]').first().attr('datetime');
    if (timeDate && /^\d{4}-\d{2}-\d{2}/.test(timeDate)) {
      publishedDate = timeDate.slice(0, 10);
    }
  }
  if (!publishedDate) {
    publishedDate = new Date().toISOString().slice(0, 10);
  }

  // 2. Remove subscription widgets from the body
  $('.subscription-widget-wrap, .subscription-widget-wrap-editor').remove();
  // Remove preformatted helper labels (non-content)
  $('.preformatted-block label').remove();

  // 3. Prepare Markdown converter
  const turndownService = new TurndownService({
    headingStyle: 'atx',
    hr: '---',
    bulletListMarker: '*'
  });

  const parseDataAttrs = (node) => {
    if (!node || !node.getAttribute) return null;
    const raw = node.getAttribute('data-attrs') || node.getAttribute('dataattrs');
    if (!raw) return null;
    try {
      return JSON.parse(decodeHtmlEntities(raw));
    } catch {
      return null;
    }
  };

  turndownService.addRule('highlighted-code-block', {
    filter: (node) =>
      node.nodeName === 'DIV' &&
      node.classList &&
      (node.classList.contains('highlighted_code_block') ||
        node.classList.contains('codeblock') ||
        node.classList.contains('code-block')),
    replacement: (content, node) => {
      const codeEl = node.querySelector && node.querySelector('code');
      const preEl = node.querySelector && node.querySelector('pre');
      const codeText = (codeEl ? codeEl.textContent : preEl ? preEl.textContent : '').replace(
        /\s+$/g,
        ''
      );
      if (!codeText) return '';
      const attrs = parseDataAttrs(node);
      const className = codeEl ? codeEl.className || '' : '';
      const classLangMatch = className.match(/language-([\w-]+)/i);
      const lang = (attrs && attrs.language) || (classLangMatch ? classLangMatch[1] : '');
      return `\n\n\`\`\`${lang}\n${codeText}\n\`\`\`\n\n`;
    }
  });

  turndownService.addRule('shiki-pre', {
    filter: (node) =>
      node.nodeName === 'PRE' && node.classList && node.classList.contains('shiki'),
    replacement: (content, node) => {
      const text = node.textContent.replace(/\s+$/g, '');
      if (!text) return '';
      return `\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
    }
  });

  turndownService.addRule('latex-block', {
    filter: (node) =>
      node.nodeName === 'DIV' &&
      node.classList &&
      (node.classList.contains('latex-rendered') || node.classList.contains('latex')),
    replacement: (content, node) => {
      const attrs = parseDataAttrs(node);
      const latex = (attrs && attrs.persistentExpression ? attrs.persistentExpression : '').trim();
      if (latex) {
        return `\n\n$$\n${latex}\n$$\n\n`;
      }
      const mathEl = node.querySelector && node.querySelector('math');
      if (mathEl && mathEl.outerHTML) {
        return `\n\n\`\`\`mathml\n${mathEl.outerHTML}\n\`\`\`\n\n`;
      }
      return '';
    }
  });

  turndownService.addRule('poll-embed', {
    filter: (node) => node.nodeName === 'DIV' && node.classList && node.classList.contains('poll-embed'),
    replacement: (content, node) => {
      const attrs = parseDataAttrs(node);
      const id = attrs && attrs.id ? ` id=${attrs.id}` : '';
      const questionEl = node.querySelector && node.querySelector('.poll-question');
      const question = questionEl ? questionEl.textContent.trim() : '';
      const optionEls = node.querySelectorAll ? node.querySelectorAll('.poll-option-text') : [];
      const options = Array.from(optionEls)
        .map((el) => el.textContent.trim())
        .filter(Boolean);
      let block = `\n\n[Poll${id}${question ? `: ${question}` : ''}]\n\n`;
      if (options.length) {
        block += `${options.map((opt) => `- ${opt}`).join('\n')}\n\n`;
      }
      return block;
    }
  });

  turndownService.addRule('recipe-embed', {
    filter: (node) =>
      node.nodeName === 'DIV' && node.classList && node.classList.contains('recipe-embed'),
    replacement: (content, node) => {
      const attrs = parseDataAttrs(node);
      const id = attrs && attrs.id ? ` id=${attrs.id}` : '';
      const name = attrs && attrs.name ? attrs.name : '';
      const description = attrs && attrs.description ? attrs.description : '';
      const ingredients = attrs && Array.isArray(attrs.ingredients) ? attrs.ingredients : [];
      const instructions = attrs && Array.isArray(attrs.instructions) ? attrs.instructions : [];
      let block = `\n\n[Recipe${id}${name ? `: ${name}` : ''}]\n\n`;
      if (description) {
        block += `${description}\n\n`;
      }
      if (ingredients.length) {
        block += `Ingredients:\n${ingredients.map((item) => `- ${item}`).join('\n')}\n\n`;
      }
      if (instructions.length) {
        block += `Instructions:\n${instructions
          .map((step, idx) => `${idx + 1}. ${step}`)
          .join('\n')}\n\n`;
      }
      return block;
    }
  });

  // Replace recipe JSON blocks with a normalized recipe placeholder
  const bodyRoot = $('.body.markup');
  bodyRoot.find('script').each((i, el) => {
    const type = $(el).attr('type') || '';
    const text = $(el).text() || '';
    if (type === 'application/ld+json' && text.includes('"@type":"Recipe"')) {
      let data = null;
      try {
        data = JSON.parse(text);
      } catch {
        data = null;
      }
      if (data && data['@type'] === 'Recipe') {
        const parent = $(el).parent();
        const parentAttrs = parent.attr('data-attrs') || parent.attr('dataattrs');
        let parentData = null;
        if (parentAttrs) {
          try {
            parentData = JSON.parse(decodeHtmlEntities(parentAttrs));
          } catch {
            parentData = null;
          }
        }
        const recipeAttrs = {
          id: parentData && parentData.id ? parentData.id : undefined,
          name: data.name || undefined,
          description: data.description || undefined,
          ingredients: Array.isArray(data.recipeIngredient) ? data.recipeIngredient : undefined,
          instructions: Array.isArray(data.recipeInstructions)
            ? data.recipeInstructions.map((step) => (step && step.text ? step.text : String(step)))
            : undefined
        };
        const encoded = JSON.stringify(recipeAttrs).replace(/"/g, '&quot;');
        const fallbackText = recipeAttrs.name ? `Recipe: ${recipeAttrs.name}` : 'Recipe';
        parent.replaceWith(
          `<div class="recipe-embed" data-attrs="${encoded}"><p>${fallbackText}</p></div>`
        );
        return;
      }
    }
    // Remove scripts inside the body to avoid JSON/text leakage
    $(el).remove();
  });

  // Remove Substack CTA buttons and related captions
  const ctaSelectors = [
    '[data-component-name="ButtonCreateButton"]',
    '[data-component-name="CaptionedButtonToDOM"]',
    '[data-component-name="SubscribeWidgetToDOM"]',
    '[data-component-name="SubscribeWidget"]',
    '[data-component-name="DirectMessageToDOM"]',
    '[data-component-name="InstallSubstackAppToDOM"]',
    '.button-wrapper',
    '.captioned-button-wrap',
    '.subscription-widget-wrap',
    '.subscription-widget-wrap-editor',
    '.subscription-widget',
    '.subscribe-widget',
    '.post-ufi',
    '.post-ufi-button',
    '.post-ufi-comment-button',
    '.like-button-container',
    '.cta-caption',
    '.install-substack-app-embed'
  ];
  bodyRoot.find(ctaSelectors.join(',')).remove();

  const ctaTextRegex =
    /\b(subscribe|comment|share|like|restack|message|follow|get the app|start your substack)\b/i;
  bodyRoot.find('button, a.button, a.button.primary, a.button.secondary').each((i, el) => {
    const text = $(el).text().replace(/\s+/g, ' ').trim();
    if (text && ctaTextRegex.test(text)) {
      $(el).closest('p, div, section').remove();
    }
  });
  turndownService.addRule('preformatted-block', {
    filter: (node) =>
      node.nodeName === 'DIV' && node.classList && node.classList.contains('preformatted-block'),
    replacement: (content, node) => {
      const pre = node.querySelector && node.querySelector('pre');
      if (!pre) return '';
      const text = pre.textContent.replace(/\s+$/g, '');
      return `\n\n\`\`\`\n${text}\n\`\`\`\n\n`;
    }
  });

  // 4. Handle Footnotes
  // Convert in-text footnote anchors to [^n] (without original links)
  const bodyContainer = $('.body.markup');
  bodyContainer.find('a.footnote-number, a.footnote-anchor').each((i, el) => {
    if ($(el).closest('.footnote').length) return;
    const num = $(el).text().trim();
    if (num) {
      $(el).replaceWith(`[^${num}]`);
    }
  });

  // Extract footnote text from the bottom section (no original links)
  const footnotes = [];
  $('.footnote').each((i, el) => {
    const number = $(el).find('.footnote-number').first().text().trim();
    const contentEl = $(el).find('.footnote-content').first();
    const contentHtml = contentEl.html() || '';
    const contentMd = turndownService.turndown(contentHtml).trim();
    if (number && contentMd) {
      footnotes.push({ number, contentMd });
    }
  });

  const formatFootnote = (number, contentMd) => {
    const trimmed = (contentMd || '').trim();
    if (!trimmed) return '';
    const needsBlock =
      trimmed.includes('\n') ||
      /^\s*>/.test(trimmed) ||
      /^\s*[-*+]\s/.test(trimmed) ||
      /^\s*\d+\.\s/.test(trimmed);
    if (!needsBlock) {
      return `[^${number}]: ${trimmed}`;
    }
    const indented = trimmed
      .split('\n')
      .map((line) => `    ${line}`)
      .join('\n');
    return `[^${number}]:\n${indented}`;
  };

  const footnotesMarkdown = footnotes.length
    ? `\n\n---\n\n${footnotes
        .map((f) => formatFootnote(f.number, f.contentMd))
        .filter(Boolean)
        .join('\n')}\n`
    : '';

  // Remove footnote section from body before converting
  $('[data-component-name="FootnoteToDOM"], .footnote, .footnotes').remove();
  $('h2')
    .filter((i, el) => $(el).text().trim().toLowerCase() === 'footnotes')
    .remove();

  // 5. Process Images (Download and reference locally)
  const images = $('.body.markup img, .post-header img');
  let imageCounter = 1;

  for (const img of images) {
    const remoteSrc = $(img).attr('src');
    if (remoteSrc) {
      const ext = path.extname(new URL(remoteSrc).pathname) || '.jpg';
      const filename = `image_${imageCounter}${ext}`;
      const localPath = path.join(imageDir, filename);

      let success = false;
      if (fs.existsSync(localPath)) {
        success = true;
      } else {
        console.log(`Downloading: ${filename}...`);
        success = await downloadImage(remoteSrc, localPath);
      }

      if (success) {
        // Update the HTML to point to the local relative path for Turndown
        $(img).attr('src', `./images/${filename}`);
      }

      imageCounter++;
    }
  }

  // Remove links that wrap images (keep only local images)
  $('a:has(img)').each((i, el) => {
    const img = $(el).find('img').first();
    if (img.length) {
      $(el).replaceWith(img);
    }
  });

  // 6. Convert the main body to Markdown
  // Target the main content container
  const bodyHtml = $('.body.markup').html() || '';
  let bodyMd = turndownService.turndown(bodyHtml);

  // Remove editor placeholder lines that shouldn't be published
  bodyMd = bodyMd.replace(
    /^\s*>?\s*Text within this block will maintain its original spacing when published\s*$/gim,
    ''
  );

  // Unescape footnote markers so they render as actual footnotes
  bodyMd = bodyMd.replace(/\\\[\^(\d+)\\\]/g, '[^$1]');

  // Unescape bracketed text like \[example\] so it renders inline as [example]
  bodyMd = unescapeBracketedText(bodyMd);

  // Drop standalone image URLs (keep only local image embeds)
  bodyMd = bodyMd.replace(/^\s*https?:\/\/\S+\.(?:png|jpe?g|gif|webp)\s*$/gim, '');

  // Tidy excessive blank lines
  bodyMd = bodyMd.replace(/\n{3,}/g, '\n\n');

  // 7. Assemble final document
  const finalMarkdown = `---
title: "${title}"
subtitle: "${subtitle}"
author: "${author}"
date: "${publishedDate}"
---

# ${title}

${subtitle ? `> ${subtitle}\n` : ''}

${bodyMd}

${footnotesMarkdown}`;

  // 8. Output the file
  if (writeFile) {
    fs.writeFileSync(path.join(postDir, mdFilename), finalMarkdown, 'utf-8');
  }

  return {
    markdown: finalMarkdown,
    postSlug,
    postDir,
    imageDir,
    mdFilename,
    title,
    subtitle,
    author,
    publishedDate
  };
}
