import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@shadalaya/react/input-group';
import { SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * A search box over the URL's search, `q`. It shows what the user types at
 * once, and searches when they pause, so the list changes once per pause.
 */
export function SearchBox({
  q,
  onSearch,
  label,
  placeholder,
}: {
  readonly q: string;
  readonly onSearch: (q: string) => void;
  readonly label: string;
  readonly placeholder: string;
}) {
  const [text, setText] = useState(q);
  // A search from outside, such as Clear search or back, shows here. Text
  // that already searches for `q`, such as "blue " mid-typing, is kept.
  useEffect(() => {
    setText((typed) => (typed.trim() === q ? typed : q));
  }, [q]);
  useEffect(() => {
    if (text.trim() === q) return;
    const timer = setTimeout(() => onSearch(text.trim()), 300);
    return () => clearTimeout(timer);
  }, [text, q, onSearch]);
  return (
    <InputGroup className="max-w-xs">
      <InputGroupAddon>
        <SearchIcon />
      </InputGroupAddon>
      <InputGroupInput
        type="search"
        aria-label={label}
        placeholder={placeholder}
        value={text}
        onChange={(event) => setText(event.target.value)}
      />
    </InputGroup>
  );
}
