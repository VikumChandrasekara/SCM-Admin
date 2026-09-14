import { ChevronLeft, ChevronRight } from 'lucide-react';

import { addDays } from '../lib/format';
import { Button, IconButton, Input } from './ui';

/** Back a day, pick a date, forward a day — never past [max]. */
export function DateStepper({
  value,
  onChange,
  max,
}: {
  value: string;
  onChange: (date: string) => void;
  max: string;
}) {
  return (
    <div className="flex items-center gap-1 rounded-2xl bg-well p-1">
      <IconButton label="පෙර දිනය" onClick={() => onChange(addDays(value, -1))}>
        <ChevronLeft className="size-5" />
      </IconButton>
      <Input
        type="date"
        aria-label="දිනය"
        value={value}
        max={max}
        onChange={(event) => event.target.value && onChange(event.target.value)}
        className="w-[9.5rem] bg-transparent py-1.5 text-center"
      />
      <IconButton label="ඊළඟ දිනය" disabled={value >= max} onClick={() => onChange(addDays(value, 1))}>
        <ChevronRight className="size-5" />
      </IconButton>
      {value !== max && (
        <Button size="sm" variant="secondary" onClick={() => onChange(max)}>
          අද
        </Button>
      )}
    </div>
  );
}
