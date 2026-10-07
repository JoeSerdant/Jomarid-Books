import { useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { settingsSync } from './settingsSyncStore';
import { SETTINGS_CHANGED } from './settingsEvents';

// Nevykresluje nic: po přihlášení stáhne nastavení z účtu, změny z Nastavení a knihovny posílá do účtu a při skrytí karty
// nebo obnovení připojení odešle, co čeká. Při odhlášení se zastaví (nastavení v zařízení zůstává).
export const SettingsSyncRunner = () => {
  const { user } = useAuth();
  const userId = user?.id ?? null;

  useEffect(() => {
    settingsSync.start(userId);
    return () => settingsSync.stop();
  }, [userId]);

  useEffect(() => {
    const onChange = () => settingsSync.changed();
    const onHide = () => { if (document.visibilityState === 'hidden') settingsSync.flush(); };
    const onOnline = () => settingsSync.flush();
    window.addEventListener(SETTINGS_CHANGED, onChange);
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener(SETTINGS_CHANGED, onChange);
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('online', onOnline);
    };
  }, []);

  return null;
};
