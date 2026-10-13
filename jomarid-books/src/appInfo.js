// Verze aplikace: jedno místo pro text v hlášení na úvodní stránce, v patičce a v Nastavení.
// Při vydání nové verze se mění jen tady (package.json verzi nenese).
export const APP_VERSION = '1.3.0';
export const APP_VERSION_SHORT = APP_VERSION.split('.').slice(0, 2).join('.');
export const APP_VERSION_LABEL = `Verze ${APP_VERSION_SHORT}`;

// Veřejný kontakt na úvodní stránce (odkazy „Kontakt“ a „Podpora“, text u role nakladatele).
export const CONTACT_EMAIL = 'wwsigmamango@gmail.com';
