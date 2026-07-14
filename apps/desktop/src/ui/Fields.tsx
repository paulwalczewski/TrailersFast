import { Label, ListBox, Select, Slider, Switch } from "@heroui/react";
import type { ReactNode } from "react";

type Option = { id: string; label: string };

export function LabeledSlider({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  disabled,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format?: (v: number) => string;
  disabled?: boolean;
}) {
  return (
    <Slider
      aria-label={label}
      value={value}
      minValue={min}
      maxValue={max}
      step={step}
      isDisabled={disabled}
      onChange={(v) => onChange(Array.isArray(v) ? v[0]! : v)}
    >
      <div className="flex items-center justify-between">
        <Label>{label}</Label>
        <span className="text-sm font-medium tabular-nums text-accent">
          {(format ?? String)(value)}
        </span>
      </div>
      <Slider.Track>
        <Slider.Fill />
        <Slider.Thumb />
      </Slider.Track>
    </Slider>
  );
}

export function LabeledSwitch({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <Switch isSelected={checked} onChange={onChange}>
      <Switch.Content>
        <Switch.Control>
          <Switch.Thumb />
        </Switch.Control>
        {label}
      </Switch.Content>
    </Switch>
  );
}

export function LabeledSelect({
  label,
  selectedKey,
  options,
  onChange,
  renderOption,
}: {
  label: string;
  selectedKey: string;
  options: readonly Option[];
  onChange: (id: string) => void;
  renderOption?: (o: Option) => ReactNode;
}) {
  return (
    <Select selectedKey={selectedKey} onSelectionChange={(k) => onChange(String(k))}>
      <Label>{label}</Label>
      <Select.Trigger>
        <Select.Value />
        <Select.Indicator />
      </Select.Trigger>
      <Select.Popover>
        <ListBox>
          {options.map((o) => (
            <ListBox.Item key={o.id} id={o.id} textValue={o.label}>
              {renderOption ? renderOption(o) : o.label}
              <ListBox.ItemIndicator />
            </ListBox.Item>
          ))}
        </ListBox>
      </Select.Popover>
    </Select>
  );
}

export function LabeledColor({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label>{label}</Label>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="size-8 cursor-pointer rounded border border-border bg-transparent"
        aria-label={label}
      />
    </div>
  );
}
