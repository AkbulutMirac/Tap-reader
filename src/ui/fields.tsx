import { Label, ListBox, Select, Switch } from "@heroui/react";
import type { ReactNode } from "react";

interface SelectFieldProps<T extends string> {
  label: string;
  value: T;
  options: readonly (readonly [T, string])[];
  onChange: (value: T) => void;
  className?: string;
}

/** HeroUI Select with a label and a flat list of [value, label] options. */
export function SelectField<T extends string>({ label, value, options, onChange, className }: SelectFieldProps<T>) {
  return (
    <Select
      className={className}
      value={value}
      onChange={(v) => {
        if (v != null) onChange(String(v) as T);
      }}
    >
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map(([id, text]) => (
            <ListBox.Item key={id} id={id} textValue={text}>
              {text}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function SwitchField({
  isSelected,
  onChange,
  children,
}: {
  isSelected: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <Switch isSelected={isSelected} onChange={onChange}>
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        {children}
      </Switch.Content>
    </Switch>
  );
}
