// Znak appky: otevřená kniha se zlatou mincí. Stránky mají barvu textu (currentColor), takže se drží motivu appky; mince je vždy zlatá.
// Stejný tvar je v ikoně appky (public/icon.svg).
export const LogoMark = ({ size = 22, className = '' }) => (
  <svg viewBox="92 92 328 304" width={size} height={size * (304 / 328)} className={className} aria-hidden="true" focusable="false">
    <path d="M250 218C214 190 152 184 100 206V372C152 352 214 358 250 388Z" fill="currentColor" />
    <path d="M262 218C298 190 360 184 412 206V372C360 352 298 358 262 388Z" fill="currentColor" opacity="0.85" />
    <circle cx="256" cy="142" r="42" fill="#fbbf24" />
    <circle cx="256" cy="142" r="26" fill="none" stroke="#b45309" strokeOpacity="0.4" strokeWidth="7" />
  </svg>
);
