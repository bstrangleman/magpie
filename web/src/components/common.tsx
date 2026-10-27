import { GlobeIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { useSidebar } from '../lib/queries.ts';
import { cn } from '../lib/utils.ts';
import { CollectionList, type CollectionListProps } from './collection-list.tsx';
import { TagField } from './TagField.tsx';

export { CollectionIcon, PhosphorGlyph } from './collection-list.tsx';

export function Favicon({ src, size = 16, className }: { src: string | null; size?: number; className?: string }) {
  const [failed, setFailed] = useState(false);
  if (!src || failed) return <GlobeIcon size={size} className={cn('shrink-0 text-ink-3', className)} />;
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

/** Searchable list of the signed-in user's collections, used inside popovers. `null` = Unsorted. */
export function CollectionPicker(props: Omit<CollectionListProps, 'sidebar'>) {
  const { data } = useSidebar();
  return <CollectionList sidebar={data} {...props} />;
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
