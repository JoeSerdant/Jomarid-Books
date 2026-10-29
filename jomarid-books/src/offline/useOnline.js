import { useEffect, useState } from 'react';

// Je zařízení připojené? Prohlížeč umí spolehlivě říct jen „určitě ne“ (navigator.onLine === false); „ano“ může být i Wi-Fi bez internetu.
export const useOnline = () => {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine !== false));
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  return online;
};
