// Verze aplikace: jedno místo pro text v hlášení na úvodní stránce, v patičce a v Nastavení. Musí odpovídat "version"
// v package.json (hlídá to src/tests/settings.test.mjs); při vydání nové verze se mění jen tady a v package.json.
export const APP_VERSION = '1.3.0';
export const APP_VERSION_SHORT = APP_VERSION.split('.').slice(0, 2).join('.');
export const APP_VERSION_LABEL = `Verze ${APP_VERSION_SHORT}`;
