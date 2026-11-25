// Znak appky: písmeno J v zaobleném tahu (stejný tvar jako v ikoně appky, public/icon.svg). Barva je barva textu (currentColor), takže se drží motivu appky.
export const LogoMark = ({ size = 22, className = '' }) => (
  <svg viewBox="196 96 220 320" width={size * 0.7} height={size} className={className} aria-hidden="true" focusable="false">
    <path d="M254 138H372M316 138V292C316 342 282 374 236 374C212 374 192 365 176 349" fill="none" stroke="currentColor" strokeWidth="62" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);
