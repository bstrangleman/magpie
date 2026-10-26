import { Folder, Globe, Inbox, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { Collection } from '../../../shared/types.ts';
import { useSidebar } from '../lib/queries.ts';
import { cn, flattenTrees } from '../lib/utils.ts';
import { TagField } from './TagField.tsx';

export function CollectionIcon({ collection, size = 18 }: { collection: Pick<Collection, 'icon' | 'color'>; size?: number }) {
  if (collection.icon) {
    return (
      <span className="inline-flex shrink-0 items-center justify-center leading-none" style={{ width: size, height: size, fontSize: size * 0.88 }}>
        {collection.icon}
      </span>
    );
  }
  return <Folder size={size} strokeWidth={1.6} className="shrink-0 text-ink-2" style={collection.color ? { color: collection.color } : undefined} />;
}

export function Favicon({ src, size = 16, className }: { src: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <Globe size={size} strokeWidth={1.6} className={cn('shrink-0 text-ink-3', className)} />;
  return (
    <img
      src={src}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn('shrink-0 rounded-[3px] object-contain', className)}
      style={{ width: size, height: size }}
    />
  );
}

/** Searchable list of collections, used inside popovers. `null` = Unsorted. */
export function CollectionPicker({
  value,
  onPick,
  exclude,
  allowUnsorted = true,
}: {
  value?: number | null;
  onPick: (id: number | null) => void;
  exclude?: Set<number>;
  allowUnsorted?: boolean;
}) {
  const { data } = useSidebar();
  const [filter, setFilter] = useState('');
  const groups = useMemo(() => (data ? flattenTrees(data.groups, data.collections) : []), [data]);
  const f = filter.trim().toLowerCase();
  return (
    <div className="w-72">
      <div className="relative px-2 pt-1 pb-1.5">
        <Search size={14} className="absolute top-3 left-4 text-ink-3" />
        <input
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Find collection"
          className="w-full rounded-md bg-field py-1.5 pr-2 pl-7 text-sm outline-none placeholder:text-ink-3"
        />
      </div>
      <div className="max-h-80 overflow-y-auto">
        {allowUnsorted && !f && (
          <PickerRow selected={value === null} onClick={() => onPick(null)} depth={0}>
            <Inbox size={17} strokeWidth={1.6} className="text-ink-2" /> Unsorted
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

function PickerRow({ selected, onClick, depth, children }: { selected: boolean; onClick: () => void; depth: number; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{ paddingLeft: 12 + depth * 16 }}
      className={cn('flex w-full items-center gap-2 py-1.5 pr-3 text-left text-sm hover:bg-hover', selected && 'bg-accent-soft font-medium')}
    >
      {children}
    </button>
  );
}

/** Tag input with suggestions from the user's existing tags. */
export function TagInput(props: { value: string[]; onChange: (tags: string[]) => void; autoFocus?: boolean }) {
  const { data } = useSidebar();
  return <TagField {...props} suggestions={data?.tags ?? []} />;
}

export function Logo({ size = 28 }: { size?: number }) {
  return <img src="/favicon.svg" alt="" width={size} height={size} className="shrink-0" />;
}

export function Avatar({ name, size = 24 }: { name: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-ink-2/15 font-semibold text-ink-2 uppercase"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
    >
      {name.trim()[0] ?? '?'}
    </span>
  );
}
