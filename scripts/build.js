import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { transform } from 'esbuild';
import { minify as minify_html } from 'html-minifier-terser';

// Configuration
// ==========================

const script_dir = path.dirname(fileURLToPath(import.meta.url));
const project_dir = path.resolve(script_dir, '..');
const dist_dir = path.join(project_dir, 'dist');

// Public URL used to generate canonical links, language alternatives, and the sitemap
const site_url = new URL('/', 'https://losedavidpb.github.io');

const languages = ['en', 'es'];
const default_language = 'en';
const language_locales = { en: 'en-US', es: 'es-ES' };

// Canonical public pages grouped by the website that owns them
const sitemap_sections = [
    { name: 'Personal site', paths: ['en/', 'es/'] },
    { name: 'Portfolio', paths: ['portfolio/en/', 'portfolio/es/'] },
    { name: 'Netviz Web', paths: ['netvizWeb/'] }
];

// Page rendering
// ==========================

/**
 * Get a nested locale value
 *
 * @param {object} locale
 * @param {string} key
 * @returns {unknown}
 */
function get_locale_value(locale, key) {
    const value = key.split('.').reduce((current, part) => current?.[part], locale);

    if (value === undefined) {
        throw new Error(`Missing locale value: ${key}`);
    }

    return value;
}

/**
 * Escape visible HTML text
 *
 * @param {unknown} value
 * @returns {string}
 */
function escape_html(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

/**
 * Replace localized element text markers
 *
 * @param {string} html
 * @param {object} locale
 * @returns {string}
 */
function render_text_markers(html, locale) {
    return html.replace(
        /<([a-z][\w-]*)([^>]*\sdata-i18n="([^"]+)"[^>]*)>[\s\S]*?<\/\1>/gi,
        (_, tag, attributes, key) => {
            const clean_attributes = attributes.replace(/\sdata-i18n="[^"]+"/i, '');
            return `<${tag}${clean_attributes}>${escape_html(get_locale_value(locale, key))}</${tag}>`;
        }
    );
}

/**
 * Replace localized attribute markers
 *
 * @param {string} html
 * @param {object} locale
 * @returns {string}
 */
function render_attribute_markers(html, locale) {
    return html.replace(
        /<([a-z][\w-]*)([^>]*\sdata-i18n-attr="([^:"]+):([^"]+)"[^>]*)>/gi,
        (_, tag, raw_attributes, attribute, key) => {
            const value = escape_html(get_locale_value(locale, key));
            const marker_pattern = /\sdata-i18n-attr="[^"]+"/i;
            const attribute_pattern = new RegExp(`\\s${attribute.replace('-', '\\-')}="[^"]*"`, 'i');
            let attributes = raw_attributes.replace(marker_pattern, '');

            if (attribute_pattern.test(attributes)) {
                attributes = attributes.replace(attribute_pattern, ` ${attribute}="${value}"`);
            } else {
                attributes += ` ${attribute}="${value}"`;
            }

            return `<${tag}${attributes}>`;
        }
    );
}

/**
 * Set or replace an HTML attribute
 *
 * @param {string} tag
 * @param {string} attribute
 * @param {string} value
 * @returns {string}
 */
function set_attribute(tag, attribute, value) {
    const pattern = new RegExp(`\\s${attribute}="[^"]*"`, 'i');

    return pattern.test(tag)
        ? tag.replace(pattern, ` ${attribute}="${escape_html(value)}"`)
        : tag.replace(/>$/, ` ${attribute}="${escape_html(value)}">`);
}

/**
 * Resolve language-aware link templates in prerendered pages.
 *
 * @param {string} html
 * @param {string} language
 * @returns {string}
 */
function render_localized_links(html, language) {
    return html.replace(
        /<a\b([^>]*\sdata-localized-href="([^"]+)"[^>]*)>/gi,
        (_, raw_attributes, href_template) => {
            const href = href_template
                .replace('{lang}', language)
                .replace('{locale}', language_locales[language]);

            const attributes = raw_attributes.replace(/\sdata-localized-href="[^"]+"/i, '');

            return set_attribute(`<a${attributes}>`, 'href', href);
        }
    );
}

/**
 * Render one localized production page
 *
 * @param {string} template
 * @param {string} language
 * @param {object} locale
 * @returns {string}
 */
function render_page(template, language, locale) {
    const canonical = new URL(`${language}/`, site_url).toString();
    const default_url = new URL(`${default_language}/`, site_url).toString();
    let html = template;

    // Mark the page with its language and production environment
    html = html.replace(/<html\b[^>]*>/i, `<html lang="${language}" data-environment="production">`);

    // Replace every localization marker with content from the selected locale
    html = render_text_markers(html, locale);
    html = render_attribute_markers(html, locale);
    html = render_localized_links(html, language);

    // Localized pages are one directory below the shared assets and favicon
    html = html.replaceAll('./assets/', '../assets/');
    html = html.replaceAll('./favicon.ico', '../favicon.ico');

    // Generate absolute SEO links for the current and alternative languages
    html = html.replace(/<link\b[^>]*rel="canonical"[^>]*>/i, tag =>
        set_attribute(tag, 'href', canonical)
    );
    html = html.replace(/<link\b[^>]*hreflang="en"[^>]*>/i, tag =>
        set_attribute(tag, 'href', new URL('en/', site_url).toString())
    );
    html = html.replace(/<link\b[^>]*hreflang="es"[^>]*>/i, tag =>
        set_attribute(tag, 'href', new URL('es/', site_url).toString())
    );
    html = html.replace(/<link\b[^>]*hreflang="x-default"[^>]*>/i, tag =>
        set_attribute(tag, 'href', default_url)
    );

    // Convert language selectors into links between the generated directories.
    // Keep data-language so the browser can highlight the active selector.
    html = html.replace(/<a\b([^>]*\sdata-language="(en|es)"[^>]*)>/gi, (_, attributes, target) =>
        `<a${attributes.replace(/\shref="[^"]*"/i, ` href="../${target}/"`)}>`
    );

    // Ensure no unresolved localization marker reaches the production output
    if (/data-(?:i18n|i18n-attr)=/i.test(html)) {
        throw new Error(`Unresolved localisation marker in ${language}/index.html`);
    }

    return html;
}

// Root files
// ==========================

/**
 * Generate the root language redirect page
 *
 * @param {Map<string, object>} locales
 * @returns {string}
 */
function render_root_page(locales) {
    const locale = locales.get(default_language);
    const default_url = new URL(`${default_language}/`, site_url).toString();

    return `<!DOCTYPE html>
<html lang="${default_language}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escape_html(locale.site.title)}</title>
    <meta name="description" content="${escape_html(locale.site.description)}">
    <meta http-equiv="refresh" content="0; url=./${default_language}/">
    <link rel="canonical" href="${default_url}">
    <link rel="alternate" hreflang="en" href="${new URL('en/', site_url)}">
    <link rel="alternate" hreflang="es" href="${new URL('es/', site_url)}">
    <link rel="alternate" hreflang="x-default" href="${default_url}">
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "WebSite",
        "name": "David Parreño Barbuzano",
        "alternateName": "David Parreño",
        "url": "${site_url}"
    }
    </script>
    <script>window.location.replace('./${default_language}/');</script>
</head>
<body>
    <p><a href="./${default_language}/">Continue</a></p>
</body>
</html>
`;
}

/**
 * Generate the consolidated production sitemap
 *
 * @returns {string}
 */
function render_sitemap() {
    const sections = sitemap_sections.map(section => `
  <!-- ${section.name} -->
${section.paths.map(page_path => `
  <url>
    <loc>${new URL(page_path, site_url)}</loc>
  </url>`).join('\n')}`).join('\n');

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${sections}
</urlset>
`;
}

// Localisation
// ==========================

/**
 * Remove JSON comments without changing strings
 *
 * @param {string} jsonc
 * @returns {string}
 */
function strip_json_comments(jsonc) {
    return jsonc.replace(
        /("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/.*$/gm,
        (_, string_literal) => string_literal ?? ''
    );
}

/**
 * Load the locale data for every supported language
 *
 * @returns {Promise<Map<string, object>>}
 */
async function load_locales() {
    const locales = new Map();

    // Preserve the configured language order in the resulting map
    for (const language of languages) {
        const file = path.join(project_dir, 'locales', `${language}.jsonc`);
        locales.set(language, JSON.parse(strip_json_comments(await readFile(file, 'utf8'))));
    }

    return locales;
}

// Asset optimisation
// ==========================

/**
 * Find files with a given extension inside a directory tree
 *
 * @param {string} directory
 * @param {string} extension
 * @returns {Promise<string[]>}
 */
async function find_files(directory, extension) {
    // Read entry types once so directories can be traversed without extra filesystem calls
    const entries = await readdir(directory, { withFileTypes: true });
    const matches = await Promise.all(entries.map(async entry => {
        const file = path.join(directory, entry.name);

        if (entry.isDirectory()) {
            return find_files(file, extension);
        }

        return entry.isFile() && path.extname(entry.name) === extension ? [file] : [];
    }));

    return matches.flat();
}

/**
 * Minify generated JavaScript and CSS without changing readable source files
 *
 * @returns {Promise<void>}
 */
async function optimize_static_assets() {
    // Limit optimization to generated production assets so source files remain readable
    const asset_types = [
        { directory: path.join(dist_dir, 'assets', 'js'), extension: '.js', loader: 'js' },
        { directory: path.join(dist_dir, 'assets', 'css'), extension: '.css', loader: 'css' }
    ];

    // Process JavaScript and CSS with their corresponding esbuild loader
    for (const asset_type of asset_types) {
        for (const file of await find_files(asset_type.directory, asset_type.extension)) {
            const result = await transform(await readFile(file, 'utf8'), {
                charset: 'utf8',
                legalComments: 'none',
                loader: asset_type.loader,
                minify: true,
                target: 'es2020'
            });

            // Replace only the generated copy with its minified output
            await writeFile(file, result.code);
        }
    }
}

/**
 * Minify JSON-LD script contents as JSON rather than JavaScript
 *
 * @param {string} html
 * @returns {string}
 */
function minify_json_ld(html) {
    return html.replace(
        /(<script\b[^>]*\btype\s*=\s*(["'])application\/ld\+json\2[^>]*>)([\s\S]*?)(<\/script\s*>)/gi,
        (_, opening_tag, _quote, json, closing_tag) => {
            try {
                return `${opening_tag}${JSON.stringify(JSON.parse(json))}${closing_tag}`;
            } catch (error) {
                throw new Error(`Invalid JSON-LD: ${error.message}`, { cause: error });
            }
        }
    );
}

/**
 * Minify generated HTML pages without changing the readable template
 *
 * @returns {Promise<void>}
 */
async function optimize_html_files() {
    // Include the root redirect and every localized page generated inside dist
    for (const file of await find_files(dist_dir, '.html')) {
        const html = minify_json_ld(await readFile(file, 'utf8'));
        const result = await minify_html(html, {
            collapseWhitespace: true,
            removeComments: true,
            removeRedundantAttributes: true,
            removeScriptTypeAttributes: true,
            removeStyleLinkTypeAttributes: true,
            useShortDoctype: true
        });

        // Replace only the generated page with its optimized output
        await writeFile(file, result);
    }
}

// Build generation and validation
// ==========================

/**
 * Recreate the build directory and copy the shared static assets
 *
 * @returns {Promise<void>}
 */
async function prepare_build_directory() {
    // Start from a clean output directory to avoid retaining stale files
    await rm(dist_dir, { recursive: true, force: true });
    await mkdir(path.join(dist_dir, 'locales'), { recursive: true });

    // Static assets and the favicon are shared by every generated language page
    await cp(path.join(project_dir, 'assets'), path.join(dist_dir, 'assets'), { recursive: true });
    await cp(path.join(project_dir, 'favicon.ico'), path.join(dist_dir, 'favicon.ico'));
}

/**
 * Generate the localized HTML and JSON files for every language
 *
 * @param {Map<string, object>} locales
 * @returns {Promise<void>}
 */
async function write_localized_files(locales) {
    const template = await readFile(path.join(project_dir, 'index.html'), 'utf8');

    // Generate one HTML page and one browser locale file per language
    for (const [language, locale] of locales) {
        const language_dir = path.join(dist_dir, language);

        // Write the prerendered language page
        await mkdir(language_dir, { recursive: true });
        await writeFile(path.join(language_dir, 'index.html'), render_page(template, language, locale));

        // Export locale data for client-side use
        await writeFile(
            path.join(dist_dir, 'locales', `${language}.json`),
            `${JSON.stringify(locale, null, 2)}\n`
        );
    }
}

/**
 * Write the root redirect, consolidated SEO files, and deployment marker
 *
 * @param {Map<string, object>} locales
 * @returns {Promise<void>}
 */
async function write_root_files(locales) {
    // Write the default-language redirect and the public URL index
    await writeFile(path.join(dist_dir, 'index.html'), render_root_page(locales));
    await writeFile(path.join(dist_dir, 'sitemap.xml'), render_sitemap());

    // Add the crawler configuration and GitHub Pages deployment marker
    await cp(path.join(project_dir, 'robots.txt'), path.join(dist_dir, 'robots.txt'));
    await writeFile(path.join(dist_dir, '.nojekyll'), '');
}

/**
 * Validate and parse every JSON-LD block in a generated page
 *
 * @param {string} html
 * @param {string} output_file
 * @returns {object[]}
 */
function validate_json_ld(html, output_file) {
    const scripts = [...html.matchAll(
        /<script\b[^>]*\btype\s*=\s*(["'])application\/ld\+json\1[^>]*>([\s\S]*?)<\/script\s*>/gi
    )];

    if (scripts.length === 0) {
        throw new Error(`Missing JSON-LD in ${output_file}`);
    }

    return scripts.map(([, , json_ld]) => {
        if (/\r|\n/.test(json_ld)) {
            throw new Error(`Unminified JSON-LD in ${output_file}`);
        }

        return JSON.parse(json_ld);
    });
}

/**
 * Validate generated production files
 *
 * @param {Map<string, object>} locales
 * @returns {Promise<void>}
 */
async function validate_build(locales) {
    const sitemap = await readFile(path.join(dist_dir, 'sitemap.xml'), 'utf8');
    const root_html = await readFile(path.join(dist_dir, 'index.html'), 'utf8');
    const [root_json_ld] = validate_json_ld(root_html, 'index.html');

    // Confirm that every configured public page is present in the consolidated sitemap
    for (const section of sitemap_sections) {
        for (const page_path of section.paths) {
            if (!sitemap.includes(new URL(page_path, site_url).toString())) {
                throw new Error(`Missing sitemap URL: ${page_path}`);
            }
        }
    }

    for (const language of languages) {
        const locale = locales.get(language);
        const html = await readFile(path.join(dist_dir, language, 'index.html'), 'utf8');
        const json = await readFile(path.join(dist_dir, 'locales', `${language}.json`), 'utf8');

        // Confirm that the exported locale file contains valid JSON
        JSON.parse(json);

        // Every home-page variant must use the same valid, compact site identity
        const [localized_json_ld] = validate_json_ld(html, `${language}/index.html`);

        if (JSON.stringify(localized_json_ld) !== JSON.stringify(root_json_ld)) {
            throw new Error(`Inconsistent JSON-LD in ${language}/index.html`);
        }

        // Check the language and environment metadata on the generated page
        if (!html.includes(`<html lang="${language}" data-environment="production">`)) {
            throw new Error(`Invalid HTML language for ${language}`);
        }

        // Confirm that representative personal-site content was prerendered
        if (!html.includes(locale.links[0].name) || !html.includes(locale.links[0].desc)) {
            throw new Error(`Missing localised content for ${language}`);
        }

        // Reject development URLs, malformed paths, and undefined values
        if (html.includes('?lang=') || html.includes('.../assets/') || html.includes('="undefined"')) {
            throw new Error(`Invalid generated value in ${language}/index.html`);
        }

        // Every localized page must include its absolute canonical URL
        if (!html.includes(new URL(`${language}/`, site_url).toString())) {
            throw new Error(`Missing canonical URL for ${language}`);
        }

        // Language-aware destinations must match the language of the generated page
        if (!html.includes(`href="/portfolio/${language}/"`)) {
            throw new Error(`Invalid portfolio URL for ${language}`);
        }

        const linked_in_url = `https://www.linkedin.com/in/losedavidpb/?locale=${language_locales[language]}`;

        if ((html.match(new RegExp(linked_in_url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) ?? []).length !== 2) {
            throw new Error(`Invalid LinkedIn URLs for ${language}`);
        }
    }
}

/**
 * Build the website
 *
 * @returns {Promise<void>}
 */
async function build() {
    const locales = await load_locales();

    // Generate and optimize the production files
    await prepare_build_directory();
    await optimize_static_assets();
    await write_localized_files(locales);
    await write_root_files(locales);
    await optimize_html_files();

    // Validate the completed build
    await validate_build(locales);
}

await build();
