import { get_page_url, lang } from './localization.js';

/**
 * Get a nested value from a locale.
 *
 * @param {object} locale
 * @param {string} key
 * @returns {unknown}
 */
function get_translation(locale, key) {
    return key.split('.').reduce((value, part) => value?.[part], locale);
}

/**
 * Apply localised text and attributes.
 *
 * @param {object} locale
 */
function set_localized_content(locale) {
    document.documentElement.lang = lang;

    document.querySelectorAll('[data-i18n]').forEach(element => {
        const translation = get_translation(locale, element.dataset.i18n);

        if (translation !== undefined) {
            element.textContent = translation;
        }
    });

    document.querySelectorAll('[data-i18n-attr]').forEach(element => {
        const [attribute, key] = element.dataset.i18nAttr.split(':');
        const translation = get_translation(locale, key);

        if (translation !== undefined) {
            element.setAttribute(attribute, translation);
        }
    });
}

/**
 * Keep metadata and alternate URLs aligned with the current language.
 */
function set_page_urls() {
    document.querySelector('link[rel="canonical"]').href = get_page_url(lang);
    document.querySelector('link[rel="alternate"][hreflang="en"]').href = get_page_url('en');
    document.querySelector('link[rel="alternate"][hreflang="es"]').href = get_page_url('es');
    document.querySelector('link[rel="alternate"][hreflang="x-default"]').href = get_page_url();
}

/**
 * Set language selector destinations and active state.
 */
function set_lang_selector() {
    document.querySelectorAll('[data-language]').forEach(link => {
        const language = link.dataset.language;
        const is_active = language === lang;

        link.href = get_page_url(language);
        link.classList.toggle('active', is_active);

        if (is_active) {
            link.setAttribute('aria-current', 'page');
        } else {
            link.removeAttribute('aria-current');
        }
    });
}

/**
 * Initialise page localisation and navigation.
 *
 * @param {object} locale
 */
export function init_page(locale) {
    set_localized_content(locale);
    set_page_urls();
    set_lang_selector();
}
