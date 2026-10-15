import type { ReactNode } from "react";
import { Controller, type FieldValues, type Path, type UseFormReturn } from "react-hook-form";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * `any` for the context/transformed-values type args so forms whose Zod
 * resolver infers a transformed value type still satisfy every field helper.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Form<T extends FieldValues> = UseFormReturn<T, any, any>;

function FieldShell({
  label,
  htmlFor,
  error,
  hint,
  required,
  className,
  children,
  description,
}: {
  label?: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  className?: string;
  children: ReactNode;
  description?: string;
}) {
  return (
    <div className={cn("space-y-1.5", className)}>
      {label ? (
        <Label htmlFor={htmlFor} className="text-xs font-medium text-muted-foreground">
          {label}
          {required ? <span className="ml-0.5 text-destructive">*</span> : null}
        </Label>
      ) : null}
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {description && !error ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      {error ? <p className="text-xs font-medium text-destructive">{error}</p> : null}
    </div>
  );
}

export function TextField<T extends FieldValues>({
  form,
  name,
  label,
  placeholder,
  type = "text",
  required,
  hint,
  description,
  className,
  disabled,
  autoComplete,
  min,
  max,
  step,
  maxLength,
}: {
  form: Form<T>;
  name: Path<T>;
  label?: string;
  placeholder?: string;
  type?: string;
  required?: boolean;
  hint?: string;
  description?: string;
  className?: string;
  disabled?: boolean;
  autoComplete?: string;
  min?: string | number;
  max?: string | number;
  step?: string | number;
  maxLength?: number;
}) {
  const error = form.formState.errors[name]?.message as string | undefined;
  return (
    <FieldShell label={label} htmlFor={String(name)} error={error} hint={hint} description={description} required={required} className={className}>
      <Input
        id={String(name)}
        type={type}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete={autoComplete}
        min={min}
        max={max}
        step={step}
        maxLength={maxLength}
        {...form.register(name)}
      />
    </FieldShell>
  );
}

export function TextareaField<T extends FieldValues>({
  form,
  name,
  label,
  placeholder,
  rows = 4,
  required,
  description,
  className,
}: {
  form: Form<T>;
  name: Path<T>;
  label?: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
  description?: string;
  className?: string;
}) {
  const error = form.formState.errors[name]?.message as string | undefined;
  return (
    <FieldShell label={label} htmlFor={String(name)} error={error} description={description} required={required} className={className}>
      <Textarea id={String(name)} rows={rows} placeholder={placeholder} {...form.register(name)} />
    </FieldShell>
  );
}

export function SelectField<T extends FieldValues>({
  form,
  name,
  label,
  options,
  placeholder = "Select...",
  required,
  description,
  className,
  disabled,
  valueType = "string",
}: {
  form: Form<T>;
  name: Path<T>;
  label?: string;
  options: readonly string[] | Array<{ value: string; label: string }>;
  placeholder?: string;
  required?: boolean;
  description?: string;
  className?: string;
  disabled?: boolean;
  valueType?: "string" | "number";
}) {
  const error = form.formState.errors[name]?.message as string | undefined;
  const normalized = options.map((option) =>
    typeof option === "string" ? { value: option, label: option.replace(/_/g, " ") } : option,
  );
  return (
    <FieldShell label={label} htmlFor={String(name)} error={error} description={description} required={required} className={className}>
      <Controller
        control={form.control}
        name={name}
        render={({ field }) => (
          <Select
            value={field.value === undefined || field.value === null ? "" : String(field.value)}
            onValueChange={(value) => field.onChange(valueType === "number" ? Number(value) : value)}
            disabled={disabled}
          >
            <SelectTrigger id={String(name)}>
              <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
              {normalized.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      />
    </FieldShell>
  );
}

export function CheckboxField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  className,
}: {
  form: Form<T>;
  name: Path<T>;
  label: string;
  description?: string;
  className?: string;
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <label className={cn("flex cursor-pointer items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3", className)}>
          <Checkbox checked={Boolean(field.value)} onCheckedChange={(checked) => field.onChange(Boolean(checked))} className="mt-0.5" />
          <span className="space-y-0.5">
            <span className="block text-sm font-medium text-foreground">{label}</span>
            {description ? <span className="block text-xs text-muted-foreground">{description}</span> : null}
          </span>
        </label>
      )}
    />
  );
}

export function SwitchField<T extends FieldValues>({
  form,
  name,
  label,
  description,
  className,
}: {
  form: Form<T>;
  name: Path<T>;
  label: string;
  description?: string;
  className?: string;
}) {
  return (
    <Controller
      control={form.control}
      name={name}
      render={({ field }) => (
        <div className={cn("flex items-center justify-between gap-4 rounded-lg border border-white/10 bg-white/5 p-3", className)}>
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">{label}</p>
            {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
          </div>
          <Switch checked={Boolean(field.value)} onCheckedChange={field.onChange} />
        </div>
      )}
    />
  );
}

export { FieldShell };
