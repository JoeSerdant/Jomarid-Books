import { useEffect, useState } from 'react';
import { accounts } from './index.js';

// Seznam účtů na tomto zařízení (aktivní první); překreslí se při každé změně trezoru.
export function useAccounts() {
  const [snap, setSnap] = useState(() => accounts.snapshot());
  useEffect(() => { setSnap(accounts.snapshot()); return accounts.subscribe(() => setSnap(accounts.snapshot())); }, []);
  return snap;
}
