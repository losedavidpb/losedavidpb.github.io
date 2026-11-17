// URL and language resolution
// ==========================

export const base_path = '/';
export const is_production = document.documentElement.dataset.environment === 'production';

const supported_languages = ['en', 'es'];
const relative_path = window.location.pathname.slice(base_path.length);
const path_lang = relative_path.split('/').find(segment => supported_languages.includes(segment));
const query_lang = new URLSearchParams(window.location.search).get('lang');

// Prefer a production path, then an explicit development query, then English.
export const lang = path_lang ?? (supported_languages.includes(query_lang) ? query_lang : 'en');

/**
 * Get the current page URL for a language.
 *
 * @param {string|null} target_lang
 * @returns {string}
 */
export function get_page_url(target_lang = null) {
    if (is_production) {
        return new URL(`${base_path}${target_lang ?? 'en'}/`, window.location.origin).toString();
    }

    const url = new URL(base_path, window.location.origin);

    if (target_lang) {
        url.searchParams.set('lang', target_lang);
    }

    return url.toString();
}

// JSONC parsing
// ==========================

/**
 * Parse JSON with comments.
 *
 * @param {string} jsonc
 * @returns {object}
 */
function parse_jsonc(jsonc) {
    const json = jsonc.replace(
        /("(?:\\.|[^"\\])*")|\/\*[\s\S]*?\*\/|\/\/.*$/gm,
        (_, string_literal) => string_literal ?? ''
    );

    return JSON.parse(json);
}

// Locale loading
// ==========================

const localization_extension = is_production ? 'json' : 'jsonc';

/**
 * Load the selected localisation.
 *
 * @returns {Promise<object>}
 */
export async function load_localization() {
    const response = await fetch(`${base_path}locales/${lang}.${localization_extension}`);

    if (!response.ok) {
        throw new Error(`Unable to load localization: ${response.status} ${response.statusText}`);
    }

    return parse_jsonc(await response.text());
}
