import { Button } from '@shadalaya/react/button';
import {
  Field,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@shadalaya/react/field';
import { Input } from '@shadalaya/react/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@shadalaya/react/native-select';
import { Textarea } from '@shadalaya/react/textarea';
import type { JsonSchema } from '@ts-pf/docs';
import { useId, useState } from 'react';
import { isRecord } from './catalog.js';
import { type Confirmation, ConfirmDialog } from './confirm.js';
import { fieldLabel } from './labels.js';
import { RefPicker, RefsPicker } from './ref-picker.js';
import { type Issue, issuesUnder, type Refusal, refusalOf } from './refusal.js';
import { RefusalAlert } from './refusal-alert.js';
import { plainOf, propertiesOf, typesOf } from './schema.js';
import { refIdOf } from './value.js';

/** How a field is edited, from the subset of JSON Schema Lattice emits. */
type InputKind =
  | 'text'
  | 'datetime'
  | 'enum'
  | 'number'
  | 'boolean'
  | 'ref'
  | 'texts'
  | 'enums'
  | 'refs'
  | 'json';

/** An input field: one property of a procedure's input schema. */
export type InputField = {
  readonly name: string;
  readonly title: string | undefined;
  readonly kind: InputKind;
  /** Null is a value: clearing the field sends null. */
  readonly nullable: boolean;
  /** An enum's values, or a list of enums' values. */
  readonly values: readonly string[];
  /** The collection a ref, or a list of refs, points to. */
  readonly ref: string | undefined;
  readonly min: number | undefined;
  readonly max: number | undefined;
  readonly integer: boolean;
  readonly defaultValue: unknown;
};

/** What an input holds while it is edited. */
export type Draft = string | boolean | readonly string[];

export type Drafts = Readonly<Record<string, Draft>>;

function enumOf(schema: JsonSchema): string[] {
  return Array.isArray(schema.enum)
    ? schema.enum.filter((value): value is string => typeof value === 'string')
    : [];
}

function numberOf(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function isNullable(schema: JsonSchema): boolean {
  const { anyOf, type } = schema;
  return (
    (Array.isArray(type) && type.includes('null')) ||
    (Array.isArray(anyOf) &&
      anyOf.some((branch) => isRecord(branch) && branch.type === 'null'))
  );
}

/** A list's kind, from its items: strings, enums or refs. Else JSON. */
function listKindOf(items: JsonSchema): InputKind {
  if (typeof items['x-lattice-ref'] === 'string') return 'refs';
  if (enumOf(items).length > 0) return 'enums';
  const [type] = typesOf(items);
  return type === 'string' && items.format === undefined ? 'texts' : 'json';
}

function kindOf(schema: JsonSchema): InputKind {
  if (typeof schema['x-lattice-ref'] === 'string') return 'ref';
  if (enumOf(schema).length > 0) return 'enum';
  const [type, ...others] = typesOf(schema);
  // A union of types has no one input: JSON says it exactly.
  if (others.length > 0) return 'json';
  if (type === 'string') {
    return schema.format === 'date-time' ? 'datetime' : 'text';
  }
  if (type === 'number' || type === 'integer') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'array' && isRecord(schema.items)) {
    return listKindOf(plainOf(schema.items));
  }
  return 'json';
}

/**
 * The fields of an input schema, in schema order, but `omit`: such as
 * update's `id`, which the page supplies. The schema says which kind of
 * input each one gets; anything outside Lattice's subset is JSON text.
 */
export function inputFieldsOf(
  schema: JsonSchema | undefined,
  omit: readonly string[],
): InputField[] {
  if (schema === undefined) return [];
  return propertiesOf(schema)
    .filter(([name]) => !omit.includes(name))
    .map(([name, property]) => {
      const plain = plainOf(property);
      const kind = kindOf(plain);
      const items = isRecord(plain.items) ? plainOf(plain.items) : {};
      const element = kind === 'enums' || kind === 'refs' ? items : plain;
      const ref = element['x-lattice-ref'];
      const title = property.title ?? plain.title;
      return {
        name,
        title: typeof title === 'string' ? title : undefined,
        kind,
        nullable: isNullable(property),
        values: enumOf(element),
        ref: typeof ref === 'string' ? ref : undefined,
        min: numberOf(plain.minimum),
        max: numberOf(plain.maximum),
        integer: typesOf(plain).includes('integer'),
        defaultValue: property.default,
      };
    });
}

/** `2026-11-23T09:30` in local time, as a datetime-local input takes it. */
function localDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (part: number) => String(part).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** What a field's input starts with: `value`, else its default. */
export function draftOf(field: InputField, value: unknown): Draft {
  const start = value === undefined ? field.defaultValue : value;
  switch (field.kind) {
    case 'boolean':
      // A nullable boolean has three answers, so it is a select.
      if (field.nullable) {
        return start === true ? 'true' : start === false ? 'false' : '';
      }
      return start === true;
    case 'texts':
    case 'enums':
    case 'refs':
      return Array.isArray(start)
        ? start.flatMap((item) => {
            const id = refIdOf(item);
            return id === undefined ? [] : [id];
          })
        : [];
    case 'ref':
      return refIdOf(start) ?? '';
    case 'datetime':
      return typeof start === 'string' ? localDateTime(start) : '';
    case 'number':
      return typeof start === 'number' ? String(start) : '';
    case 'json':
      return start === undefined ? '' : JSON.stringify(start, null, 2);
    default:
      return typeof start === 'string' ? start : '';
  }
}

/** The drafts of `fields`, from a document or input, else defaults. */
export function draftsOf(
  fields: readonly InputField[],
  values: Readonly<Record<string, unknown>>,
): Drafts {
  return Object.fromEntries(
    fields.map((field) => [field.name, draftOf(field, values[field.name])]),
  );
}

/** A draft as JSON: a value to send, nothing to send, or why it is not one. */
type Converted =
  | { readonly value: unknown }
  | { readonly omit: true }
  | { readonly problem: string };

function converted(field: InputField, draft: Draft | undefined): Converted {
  if (typeof draft === 'boolean') return { value: draft };
  // A list of refs with no title field to search is typed as ids.
  const list = Array.isArray(draft)
    ? draft
    : field.kind === 'refs' && typeof draft === 'string'
      ? draft.split(',')
      : undefined;
  if (list !== undefined) {
    const items = list.map((item) => item.trim()).filter((item) => item !== '');
    return items.length === 0 && field.nullable
      ? { value: null }
      : { value: items };
  }
  const text = typeof draft === 'string' ? draft : '';
  // An empty input sends nothing, or null where null is a value. The server
  // says when a required field is missing.
  if (text.trim() === '')
    return field.nullable ? { value: null } : { omit: true };
  switch (field.kind) {
    case 'boolean':
      return { value: text === 'true' };
    case 'number': {
      const number = Number(text);
      return Number.isNaN(number)
        ? { problem: 'Enter a number.' }
        : { value: number };
    }
    case 'datetime': {
      const date = new Date(text);
      return Number.isNaN(date.getTime())
        ? { problem: 'Enter a date and time.' }
        : { value: date.toISOString() };
    }
    case 'json':
      try {
        return { value: JSON.parse(text) };
      } catch {
        return { problem: 'Enter valid JSON.' };
      }
    default:
      return { value: text };
  }
}

/** An input body, and any field whose draft is not a value. */
export type Body = {
  readonly body: Record<string, unknown>;
  readonly problems: readonly Issue[];
};

/**
 * Why a cleared field is not sent: only update's optional fields take null,
 * which clears them, so a field that does not is required or defaulted.
 */
const cannotClear = 'This field is required.';

/**
 * The input `drafts` make: only the fields that differ from `baseline`.
 * An untouched field is not sent, so update leaves it as it is and create
 * applies its default. A field cleared to nothing sends null where the
 * schema takes it, which clears it on update, and cannot be sent otherwise.
 */
export function bodyOf(
  fields: readonly InputField[],
  drafts: Drafts,
  baseline: Drafts,
): Body {
  const body: Record<string, unknown> = {};
  const problems: Issue[] = [];
  for (const field of fields) {
    const now = converted(field, drafts[field.name]);
    if ('problem' in now) {
      problems.push({ path: [field.name], message: now.problem });
      continue;
    }
    const before = converted(field, baseline[field.name]);
    if (JSON.stringify(now) === JSON.stringify(before)) continue;
    if ('value' in now) {
      body[field.name] = now.value;
    } else {
      problems.push({ path: [field.name], message: cannotClear });
    }
  }
  return { body, problems };
}

function textOf(draft: Draft): string {
  return typeof draft === 'string' ? draft : '';
}

function listOf(draft: Draft): readonly string[] {
  return Array.isArray(draft) ? draft : [];
}

/** A native checkbox, styled: Base UI's would add about 5 KB gzip. */
const checkbox = 'size-4 accent-primary';

/**
 * What a number input reports for text that is not a number, such as `1e`:
 * it reports '', so the draft keeps NaN, and the form says why.
 */
const notANumber = 'NaN';

/** The input for one field, by its kind. Not a list of enums. */
function FieldControl({
  id,
  field,
  draft,
  onChange,
}: {
  readonly id: string;
  readonly field: InputField;
  readonly draft: Draft;
  readonly onChange: (draft: Draft) => void;
}) {
  const text = textOf(draft);
  switch (field.kind) {
    case 'boolean':
      return typeof draft === 'boolean' ? (
        <input
          id={id}
          type="checkbox"
          className={checkbox}
          checked={draft}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : (
        <NativeSelect
          id={id}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        >
          <NativeSelectOption value="">—</NativeSelectOption>
          <NativeSelectOption value="true">Yes</NativeSelectOption>
          <NativeSelectOption value="false">No</NativeSelectOption>
        </NativeSelect>
      );
    case 'enum':
      return (
        <NativeSelect
          id={id}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        >
          <NativeSelectOption value="">—</NativeSelectOption>
          {field.values.map((value) => (
            <NativeSelectOption key={value} value={value}>
              {value}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      );
    case 'ref':
      return (
        <RefPicker
          id={id}
          target={field.ref}
          value={text}
          onChange={onChange}
        />
      );
    case 'refs':
      return (
        <RefsPicker
          id={id}
          target={field.ref}
          value={typeof draft === 'boolean' ? [] : draft}
          onChange={onChange}
        />
      );
    case 'texts':
      return (
        <Textarea
          id={id}
          placeholder="One per line"
          value={listOf(draft).join('\n')}
          onChange={(event) => onChange(event.target.value.split('\n'))}
        />
      );
    case 'json':
      return (
        <Textarea
          id={id}
          className="font-mono"
          placeholder="JSON"
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    case 'number':
      return (
        <Input
          id={id}
          type="number"
          min={field.min}
          max={field.max}
          step={field.integer ? 1 : 'any'}
          value={text}
          onChange={(event) =>
            onChange(
              event.target.validity.badInput ? notANumber : event.target.value,
            )
          }
        />
      );
    default:
      return (
        <Input
          id={id}
          type={field.kind === 'datetime' ? 'datetime-local' : 'text'}
          value={text}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

/** A list of enums: a checkbox per value, in a fieldset named by the field. */
function EnumsInput({
  field,
  draft,
  issues,
  onChange,
}: {
  readonly field: InputField;
  readonly draft: Draft;
  readonly issues: readonly Issue[];
  readonly onChange: (draft: Draft) => void;
}) {
  const picked = listOf(draft);
  return (
    <FieldSet data-invalid={issues.length > 0 || undefined}>
      <FieldLegend variant="label">{fieldLabel(field)}</FieldLegend>
      <div className="flex flex-wrap gap-3">
        {field.values.map((value) => (
          <label key={value} className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              className={checkbox}
              checked={picked.includes(value)}
              onChange={(event) =>
                onChange(
                  event.target.checked
                    ? [...picked, value]
                    : picked.filter((item) => item !== value),
                )
              }
            />
            {value}
          </label>
        ))}
      </div>
      <FieldError errors={[...issues]} />
    </FieldSet>
  );
}

/** One field: its label, its input, and any issue at it. */
export function FieldInput({
  field,
  draft,
  issues,
  onChange,
}: {
  readonly field: InputField;
  readonly draft: Draft;
  readonly issues: readonly Issue[];
  readonly onChange: (draft: Draft) => void;
}) {
  const id = useId();
  if (field.kind === 'enums') {
    return (
      <EnumsInput
        field={field}
        draft={draft}
        issues={issues}
        onChange={onChange}
      />
    );
  }
  return (
    <Field data-invalid={issues.length > 0 || undefined}>
      <FieldLabel htmlFor={id}>{fieldLabel(field)}</FieldLabel>
      <FieldControl id={id} field={field} draft={draft} onChange={onChange} />
      <FieldError errors={[...issues]} />
    </Field>
  );
}

/**
 * The fields of an input, each with the issues whose path starts with its
 * name below `at`, such as `['links', 0]` for a link of a relation's set.
 */
export function FormFields({
  fields,
  drafts,
  issues,
  at = [],
  onChange,
}: {
  readonly fields: readonly InputField[];
  readonly drafts: Drafts;
  readonly issues: readonly Issue[];
  readonly at?: readonly (string | number)[];
  readonly onChange: (drafts: Drafts) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      {fields.map((field) => (
        <FieldInput
          key={field.name}
          field={field}
          draft={drafts[field.name] ?? draftOf(field, undefined)}
          issues={issuesUnder(issues, [...at, field.name])}
          onChange={(draft) => onChange({ ...drafts, [field.name]: draft })}
        />
      ))}
    </div>
  );
}

/**
 * A form for one procedure's input: its fields, its submit, and what the
 * server refused. It sends only what differs from `initial`. Each issue
 * shows at the field its path names; the rest, and any other refusal, show
 * in the form's alert. With `confirmation`, a submit asks first.
 */
export function InputForm({
  label,
  fields,
  initial,
  submitLabel,
  confirmation,
  onSubmit,
}: {
  readonly label: string;
  readonly fields: readonly InputField[];
  readonly initial: Drafts;
  readonly submitLabel: string;
  readonly confirmation?: Confirmation;
  readonly onSubmit: (body: Record<string, unknown>) => Promise<void>;
}) {
  // Frozen with the drafts: a refetch of the document must not change what
  // counts as changed, or a stale value would be sent over another's edit.
  const [baseline] = useState(initial);
  const [drafts, setDrafts] = useState(initial);
  const [problems, setProblems] = useState<readonly Issue[]>([]);
  const [refusal, setRefusal] = useState<Refusal | undefined>();
  const [pending, setPending] = useState<Record<string, unknown> | undefined>();
  const [busy, setBusy] = useState(false);
  const submit = async (body: Record<string, unknown>) => {
    setBusy(true);
    setRefusal(undefined);
    try {
      await onSubmit(body);
    } catch (error) {
      setRefusal(refusalOf(error));
    } finally {
      setBusy(false);
    }
  };
  const issues = [...problems, ...(refusal?.issues ?? [])];
  return (
    <form
      aria-label={label}
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const made = bodyOf(fields, drafts, baseline);
        setProblems(made.problems);
        if (made.problems.length > 0) return;
        if (confirmation === undefined) {
          void submit(made.body);
        } else {
          setPending(made.body);
        }
      }}
    >
      <FormFields
        fields={fields}
        drafts={drafts}
        issues={issues}
        onChange={setDrafts}
      />
      {refusal === undefined ? null : (
        <RefusalAlert
          refusal={refusal}
          placed={(issue) => fields.some(({ name }) => issue.path[0] === name)}
        />
      )}
      <div>
        <Button type="submit" disabled={busy}>
          {submitLabel}
        </Button>
      </div>
      {confirmation === undefined ? null : (
        <ConfirmDialog
          confirmation={confirmation}
          open={pending !== undefined}
          onOpenChange={(open) => {
            if (!open) setPending(undefined);
          }}
          onConfirm={() => {
            if (pending !== undefined) void submit(pending);
          }}
        />
      )}
    </form>
  );
}
