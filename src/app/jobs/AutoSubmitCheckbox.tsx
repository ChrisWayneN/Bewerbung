'use client';

import { ReactNode } from 'react';

interface Props {
  name: string;
  value: string;
  defaultChecked?: boolean;
  children: ReactNode;
}

/** Checkbox, die das umschließende <form> bei jeder Änderung sofort
 *  abschickt – damit Counts im Firmen-Dropdown live auf die Filter
 *  reagieren, ohne dass der User "Anwenden" klicken muss. */
export function AutoSubmitCheckbox({ name, value, defaultChecked, children }: Props) {
  return (
    <label className="flex items-center gap-2 text-sm pb-2">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={defaultChecked}
        onChange={e => e.currentTarget.form?.requestSubmit()}
      />
      {children}
    </label>
  );
}
