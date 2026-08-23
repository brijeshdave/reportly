// Author: Brijesh Dave <https://github.com/brijeshdave>
// Pick a person by name, for a filter that stores their id.
//
// The logs and audit screens filtered by uuid, which meant an administrator had to
// find an id somewhere else before they could ask a question about a colleague.
// The id still travels in the URL — so a link keeps working and a support ticket
// can carry one — but nobody has to read or type it.
//
// The search runs on the server. Downloading everybody to filter in the browser is
// fine at fifty people and unusable at five thousand.
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { SearchableSelect, type SelectOption } from "@/components/searchable-select.js";
import { useDebounced } from "@/hooks/use-debounced.js";
import { fetchUser, searchUsers } from "@/services/users.js";

export function PeopleFilter({
  id,
  value,
  onChange,
  label,
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query, 250);

  const matches = useQuery({
    queryKey: ["users", "search", debounced],
    queryFn: () => searchUsers(debounced),
    staleTime: 30_000,
  });

  /**
   * The chosen person, when the filter arrived from a URL and they are not in the
   * current results. Without this the box would show a bare uuid — the very thing
   * this control exists to stop.
   */
  const chosen = useQuery({
    queryKey: ["users", value],
    queryFn: () => fetchUser(value),
    enabled: value !== "" && !(matches.data ?? []).some((person) => person.id === value),
  });

  const options: SelectOption[] = [
    ...(chosen.data
      ? [{ value: chosen.data.id, label: chosen.data.name, hint: chosen.data.email }]
      : []),
    ...(matches.data ?? [])
      .filter((person) => person.id !== chosen.data?.id)
      .map((person) => ({ value: person.id, label: person.name, hint: person.email })),
  ];

  return (
    <SearchableSelect
      id={id}
      value={value}
      onChange={onChange}
      options={options}
      onQueryChange={setQuery}
      ariaLabel={label}
      placeholder={`Any ${label.toLowerCase()}`}
    />
  );
}
