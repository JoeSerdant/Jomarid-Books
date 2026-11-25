// Znak appky: písmeno J v zaobleném tahu s plastickou hranou (stejný tvar jako v ikoně appky, public/icon.svg). Přední plocha má barvu textu (currentColor),
// takže se drží motivu appky; hloubka je tmavá kopie tahu posunutá dolů a doprava.
const J = 'M254 138H372M316 138V292C316 342 282 374 236 374C212 374 192 365 176 349';
export const LogoMark = ({ size = 22, className = '' }) => (
  <svg viewBox="196 96 244 340" width={size * (244 / 340)} height={size} className={className} aria-hidden="true" focusable="false">
    <g fill="none" stroke="#000" strokeWidth="62" strokeLinecap="round" strokeLinejoin="round" opacity="0.3">
      <path d={J} transform="translate(14 20)" />
      <path d={J} transform="translate(9 13)" />
      <path d={J} transform="translate(4 7)" />
    </g>
    <path d={J} fill="none" stroke="currentColor" strokeWidth="62" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
