import { useEffect, useState } from 'react';

const defaultFormatter = (date) =>
  date.toLocaleString('en-US', {
    weekday: 'short',
    month: 'short',
    day: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

export const useLiveClock = (formatter = defaultFormatter, intervalMs = 1000) => {
  const [value, setValue] = useState(() => formatter(new Date()));

  useEffect(() => {
    let active = true;
    const tick = () => {
      if (!active) {
        return;
      }
      setValue(formatter(new Date()));
    };
    const timer = setInterval(tick, intervalMs);
    tick();
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [formatter, intervalMs]);

  return value;
};
