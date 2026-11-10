import { Check, Loader2, X } from 'lucide-react';
import { ROLE_LABELS } from '../constants/roles';
import { t } from '../i18n';
import { accountInitial } from './vault.js';

// Barva kolečka podle id účtu: stejný účet má vždy stejnou barvu.
const HUES = [262, 199, 142, 24, 330, 48, 175, 8];
const hueOf = (id) => { let h = 0; for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) >>> 0; return HUES[h % HUES.length]; };

export const accountName = (a) => a.username || (a.email ? a.email.split('@')[0] : '') || t('Čtenář');

export const Avatar = ({ account, size = 32 }) => (
  <span
    aria-hidden="true"
    style={{ width: size, height: size, backgroundColor: `hsl(${hueOf(account.id)} 60% 45%)`, fontSize: size * 0.45 }}
    className="shrink-0 rounded-full inline-flex items-center justify-center text-white font-black"
  >
    {accountInitial(account)}
  </span>
);

// Seznam účtů na tomto zařízení: klepnutím se přepne, křížek účet z tohoto zařízení odebere (aktivní se odebrat nedá, ten se odhlašuje).
export const AccountList = ({ accounts, active, busy, onSwitch, onRemove }) => (
  <ul className="list-none m-0 p-0 space-y-1.5" aria-label={t('Účty na tomto zařízení')}>
    {accounts.map((a) => {
      const isActive = a.id === active;
      const working = busy === a.id;
      return (
        <li key={a.id} className="flex items-stretch gap-1.5" data-testid={`account-${a.id}`}>
          <button
            type="button"
            onClick={() => { if (!isActive && !busy) onSwitch(a.id); }}
            aria-current={isActive ? 'true' : undefined}
            aria-disabled={isActive || !!busy}
            title={isActive ? t('Aktivní účet') : t('Přepnout na účet {name}', { name: accountName(a) })}
            style={{ backgroundColor: isActive ? 'var(--bg-badge)' : 'var(--bg-secondary)', borderColor: isActive ? 'var(--bg-primary)' : 'var(--border-color)', color: 'var(--text-body)' }}
            className={`flex-1 min-w-0 flex items-center gap-2.5 p-2 border rounded-xl text-left ${isActive ? 'cursor-default' : 'cursor-pointer hover:brightness-95'}`}
          >
            <Avatar account={a} />
            <span className="min-w-0 flex-1">
              <span className="block text-xs font-black truncate">{accountName(a)}</span>
              <span style={{ color: 'var(--text-muted)' }} className="block text-[0.625rem] truncate opacity-80">
                {a.email}{a.role ? ` · ${t(ROLE_LABELS[a.role] || a.role)}` : ''}
              </span>
            </span>
            {working ? <Loader2 size={14} className="animate-spin shrink-0" aria-label={t('Přepínám...')} /> : isActive ? <Check size={14} className="shrink-0 text-emerald-500" aria-label={t('Aktivní účet')} /> : null}
          </button>
          {!isActive && (
            <button
              type="button"
              onClick={() => { if (!busy) onRemove(a.id); }}
              aria-label={t('Odebrat účet {name} z tohoto zařízení', { name: accountName(a) })}
              title={t('Odebrat z tohoto zařízení')}
              style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border-color)', color: 'var(--text-muted)' }}
              className="shrink-0 px-2 border rounded-xl cursor-pointer hover:bg-red-500/10 hover:text-red-500 hover:border-red-500/30 inline-flex items-center"
            >
              <X size={14} />
            </button>
          )}
        </li>
      );
    })}
  </ul>
);
