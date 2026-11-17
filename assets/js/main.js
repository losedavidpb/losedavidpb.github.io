import { load_localization } from './localization.js';
import { init_page } from './page.js';

// Application entry point
// ==========================

/**
 * Initialise the page.
 */
async function main() {
    try {
        const locale = await load_localization();
        init_page(locale);
    } catch (error) {
        console.error(error);
    } finally {
        document.documentElement.classList.remove('i18n-loading');
    }
}

main();
