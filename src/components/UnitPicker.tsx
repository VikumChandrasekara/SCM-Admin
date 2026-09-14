import { Check, ChevronDown, Plus, Search } from 'lucide-react';
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';

import { findUnit, groupLabel, searchUnits, type Unit } from '../lib/units';
import { cx } from './ui';

type Option = { kind: 'unit'; unit: Unit } | { kind: 'custom'; text: string };

/**
 * Picks a store item's unit from a searchable list, or takes whatever was
 * typed when nothing in the list fits.
 *
 * The list opens in a portal so a dialog's scrolling body cannot clip it.
 */
export function UnitPicker({
  value,
  onChange,
  disabled = false,
}: {
  value: string;
  onChange: (unit: string) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const id = useId();

  const typed = query.trim();
  const results = searchUnits(query);
  const options: Option[] = [
    ...results.map((unit): Option => ({ kind: 'unit', unit })),
    ...(typed && !results.some((unit) => unit.symbol.toLowerCase() === typed.toLowerCase())
      ? [{ kind: 'custom', text: typed } as Option]
      : []),
  ];
  const selected = findUnit(value);

  // Follows the button while the page or dialog scrolls under it.
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => setAnchor(button.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!button.current?.contains(target) && !panel.current?.contains(target)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    list.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [active, open]);

  function show() {
    setQuery('');
    setActive(Math.max(0, searchUnits('').findIndex((unit) => unit.symbol === value)));
    setOpen(true);
  }

  function choose(option: Option | undefined) {
    if (!option) return;
    onChange(option.kind === 'unit' ? option.unit.symbol : option.text);
    setOpen(false);
    button.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActive((index) => Math.min(index + 1, options.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActive((index) => Math.max(index - 1, 0));
        break;
      case 'Enter':
        event.preventDefault();
        choose(options[active]);
        break;
      case 'Escape':
        // Closes the list, not the dialog around it.
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        button.current?.focus();
        break;
      case 'Tab':
        setOpen(false);
        break;
    }
  }

  // Below the button when it fits, above it when it does not.
  const width = anchor ? Math.min(Math.max(anchor.width, 340), window.innerWidth - 16) : 340;
  const left = anchor ? Math.max(8, Math.min(anchor.left, window.innerWidth - width - 8)) : 0;
  const below = anchor ? window.innerHeight - anchor.bottom > 380 || anchor.top < 380 : true;
  const listId = `${id}-units`;

  return (
    <>
      <button
        ref={button}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' && !open) {
            event.preventDefault();
            show();
          }
        }}
        className="flex w-full items-center gap-2 rounded-xl bg-well px-3 py-2.5 text-left text-[15px] ring-1 ring-transparent focus:ring-2 focus:ring-amber-hi focus:outline-none disabled:opacity-60"
      >
        <span className="min-w-0 flex-1 truncate">
          {selected ? (
            <>
              <b className="font-extrabold">{selected.symbol}</b>
              <span className="text-white/70"> · {selected.sinhala}</span>
            </>
          ) : value ? (
            <b className="font-extrabold">{value}</b>
          ) : (
            <span className="text-white/40">ඒකකය තෝරන්න</span>
          )}
        </span>
        <ChevronDown className={cx('size-4 shrink-0 text-white/60 transition', open && 'rotate-180')} />
      </button>

      {open &&
        anchor &&
        createPortal(
          <div
            ref={panel}
            style={{
              position: 'fixed',
              left,
              width,
              ...(below ? { top: anchor.bottom + 6 } : { bottom: window.innerHeight - anchor.top + 6 }),
            }}
            className="z-[70] overflow-hidden rounded-2xl bg-blue-lo text-white shadow-panel ring-1 ring-hairline"
          >
            <div className="relative border-b border-hairline p-2">
              <Search className="pointer-events-none absolute top-1/2 left-5 size-4 -translate-y-1/2 text-white/50" />
              <input
                autoFocus
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={options.length ? `${listId}-${active}` : undefined}
                aria-label="ඒකකයක් සොයන්න"
                placeholder="සොයන්න: L, kg, ලීටර්, gallon, bag…"
                value={query}
                onChange={(event) => {
                  setQuery(event.target.value);
                  setActive(0);
                }}
                onKeyDown={onKeyDown}
                className="w-full rounded-xl bg-well py-2 pr-3 pl-9 text-sm text-white placeholder:text-white/40 focus:ring-2 focus:ring-amber-hi focus:outline-none"
              />
            </div>

            <ul ref={list} id={listId} role="listbox" className="max-h-[300px] overflow-y-auto py-1">
              {options.map((option, index) => {
                const heading =
                  !typed &&
                  option.kind === 'unit' &&
                  (index === 0 ||
                    (options[index - 1].kind === 'unit' &&
                      (options[index - 1] as { unit: Unit }).unit.group !== option.unit.group));

                return (
                  <li key={option.kind === 'unit' ? option.unit.symbol : `custom:${option.text}`} role="presentation">
                    {heading && option.kind === 'unit' && (
                      <p className="px-4 pt-3 pb-1 text-[10.5px] font-bold tracking-[0.12em] text-white/50 uppercase">
                        {groupLabel(option.unit.group)}
                      </p>
                    )}
                    <div
                      id={`${listId}-${index}`}
                      data-index={index}
                      role="option"
                      aria-selected={option.kind === 'unit' && option.unit.symbol === value}
                      onMouseDown={(event) => event.preventDefault()}
                      onMouseEnter={() => setActive(index)}
                      onClick={() => choose(option)}
                      className={cx(
                        'mx-1 flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm',
                        index === active ? 'bg-white/15' : 'hover:bg-white/10',
                      )}
                    >
                      {option.kind === 'unit' ? (
                        <>
                          <span className="w-16 shrink-0 truncate font-extrabold">{option.unit.symbol}</span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate">{option.unit.sinhala}</span>
                            <span className="block truncate text-xs text-white/55">
                              {option.unit.english}
                              {typed && ` · ${groupLabel(option.unit.group).split(' · ')[0]}`}
                            </span>
                          </span>
                          {option.unit.symbol === value && <Check className="size-4 shrink-0 text-amber-hi" />}
                        </>
                      ) : (
                        <>
                          <Plus className="size-4 shrink-0 text-amber-hi" />
                          <span className="min-w-0 flex-1 truncate">
                            "<b>{option.text}</b>" ඒකකය ලෙස භාවිත කරන්න
                          </span>
                        </>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>,
          document.body,
        )}
    </>
  );
}
