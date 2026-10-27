// Collection icons and the searchable collection list. Kept free of the web app's data layer
// (React Query), so the browser extension's popup can use them with its own sidebar data.
import { FolderIcon, MagnifyingGlassIcon, TrayIcon } from '@phosphor-icons/react';
import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { phosphorName, type Collection, type Sidebar } from '../../../shared/types.ts';
import { usePhosphor } from '../lib/phosphor.ts';
import { cn, flattenTrees } from '../lib/utils.ts';

/** A Phosphor icon by name, drawn in the current text colour. Blank (same size) until the set has loaded. */
export function PhosphorGlyph({ name, size = 18, className, style }: { name: string; size?: number; className?: string; style?: CSSProperties }) {
  const icon = usePhosphor()?.get(name);
  return (
    <svg viewBox="0 0 256 256" width={size} height={size} fill="currentColor" aria-hidden className={cn('shrink-0', className)} style={style}>
      {icon && <path d={icon.d} />}
    </svg>
  );
}

export function CollectionIcon({ collection, size = 18 }: { collection: Pick<Collection, 'icon' | 'color'>; size?: number }) {
  const phosphor = phosphorName(collection.icon);
  if (phosphor) {
    return <PhosphorGlyph name={phosphor} size={size} className="text-ink-2" style={collection.color ? { color: collection.color } : undefined} />;
  }
  if (collection.icon) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center leading-none" style={{ width: size, height: size, fontSize: size * 0.88 }}>
        {collection.icon}
      </span>
    );
  }
  return <FolderIcon size={size} className="shrink-0 text-ink-2" style={collection.color ? { color: collection.color } : undefined} />;
}

/** The Unsorted "collection" (no collection), as shown in pickers. */
export const UnsortedIcon = ({ size = 17 }: { size?: number }) => <TrayIcon size={size} className="shrink-0 text-ink-2" />;

export interface CollectionListProps {
  /** Groups and collections to list; nothing is shown until they've loaded. */
  sidebar: Pick<Sidebar, 'groups' | 'collections'> | undefined;
  value?: number | null;
  onPick: (id: number | null) => void;
  exclude?: Set<number>;
  allowUnsorted?: boolean;
  /** Height limit for the scrolling list (a Tailwind class). */
  listClassName?: string;
}

/** Searchable list of collections, used inside popovers. `null` = Unsorted. */
export function CollectionList({ sidebar, value, onPick, exclude, allowUnsorted = true, listClassName = 'max-h-80' }: CollectionListProps) {
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => (sidebar ? flattenTrees(sidebar.groups, sidebar.collections) : []), [sidebar]);
  const f = filter.trim().toLowerCase();
  return (
    // Shrinks to fit a short popover (min-h-0), so only the list below scrolls.
    <div className="flex min-h-0 w-72 flex-col">
      <div className="relative shrink-0 px-2 pt-1 pb-1.5">
        <MagnifyingGlassIcon size={14} className="absolute top-3 left-4 text-ink-3" />
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find collection"
          className="w-full rounded-md bg-field py-1.5 pr-2 pl-7 text-sm outline-none placeholder:text-ink-3"
        />
      </div>
      <div className={cn('min-h-0 overflow-y-auto', listClassName)}>
        {allowUnsorted && !f && (
          <PickerRow selected={value === null} onClick={() => onPick(null)} depth={0}>
            <UnsortedIcon /> Unsorted
          </PickerRow>
        )}
        {groups.map(({ group, items }) => {
          const visible = items.filter((i) => !exclude?.has(i.collection.id) && (!f || i.collection.name.toLowerCase().includes(f)));
          if (!visible.length) return null;
          return (
            <div key={group.id}>
              {groups.length > 1 && <div className="px-3 pt-2 pb-0.5 text-xs text-ink-3">{group.name}</div>}
              {visible.map(({ collection, depth }) => (
                <PickerRow key={collection.id} selected={value === collection.id} onClick={() => onPick(collection.id)} depth={f ? 0 : depth}>
                  <CollectionIcon collection={collection} size={17} />
                  <span className="truncate">{collection.name}</span>
                </PickerRow>
              ))}
            </div>
          );
        })}
        {f && !groups.some((g) => g.items.some((i) => i.collection.name.toLowerCase().includes(f))) && (
          <p className="px-3 py-2 text-sm text-ink-3">No collections match</p>
        )}
      </div>
    </div>
  );
}

function PickerRow({ selected, onClick, depth, children }: { selected: boolean; onClick: () => void; depth: number; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{ paddingLeft: 12 + depth * 16 }}
      className={cn('flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-hover', selected && 'bg-accent-soft font-medium')}
    >
      {children}
    </button>
  );
}
