import { useEffect, useState } from 'react';

import { todayKey } from './format';

/** Today's date key, rolling over at midnight while the panel stays open. */
export function useToday(): string {
  const [today, setToday] = useState(todayKey);
  useEffect(() => {
    const timer = window.setInterval(() => setToday(todayKey()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return today;
}
