import { Button } from '@shadalaya/react/button';
import { Field, FieldError, FieldLabel } from '@shadalaya/react/field';
import { Input } from '@shadalaya/react/input';
import {
  NativeSelect,
  NativeSelectOption,
} from '@shadalaya/react/native-select';
import type { JsonSchema } from '@ts-pf/docs';
import { useId, useState } from 'react';
import { isRecord } from './catalog.js';
import type { Collection } from './collections.js';
import { fieldLabel } from './labels.js';
import type { Filter } from './list-state.js';
import type { Issue } from './refusal.js';
import {
  type Field as DocumentField,
  operatorsOf,
  plainOf,
  typesOf,
} from './schema.js';

/** A filter resolved against the collection: its field and operators. */
type Condition = {
  readonly field: DocumentField;
  readonly operators: readonly [string, JsonSchema][];
  readonly operator: string;
  readonly value: string;
};

const operatorLabels: Readonly<Record<string, string>> = {
  eq: 'is',
  ne: 'is not',
  in: 'is one of',
  nin: 'is none of',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  contains: 'contains',
  has: 'has',
  nhas: 'does not have',
  exists: 'exists',
};

function isList(operator: string): boolean {
  return operator === 'in' || operator === 'nin';
}

/** Whether the value is a yes or no choice, rather than typed. */
function isYesNo(field: DocumentField, operator: string): boolean {
  return (
    operator === 'exists' || (field.kind === 'boolean' && !isList(operator))
  );
}

/** A new condition's value: yes for a yes-or-no choice, else empty. */
function initialValue(field: DocumentField, operator: string): string {
  return isYesNo(field, operator) ? 'true' : '';
}

/**
 * The filters whose field and operator the collection's where schema has,
 * resolved. One per field: a later one for the same field is dropped.
 */
function conditionsOf(
  collection: Collection,
  filters: readonly Filter[],
): Condition[] {
  const operators = operatorsOf(collection.operations.find?.input);
  const conditions: Condition[] = [];
  for (const [name, operator, value] of filters) {
    const field = collection.fields.find(
      (candidate) => candidate.name === name,
    );
    const available = operators.get(name) ?? [];
    if (
      field === undefined ||
      !available.some(([candidate]) => candidate === operator) ||
      conditions.some((condition) => condition.field.name === name)
    ) {
      continue;
    }
    conditions.push({ field, operators: available, operator, value });
  }
  return conditions;
}

function scalar(
  schema: JsonSchema,
  field: DocumentField,
  raw: string,
): unknown {
  const [type] = typesOf(schema);
  if (type === 'boolean') return raw === 'true';
  if (type === 'number' || type === 'integer') {
    const number = Number(raw);
    return Number.isNaN(number) ? raw : number;
  }
  if (field.kind === 'datetime') {
    const date = new Date(raw);
    return Number.isNaN(date.getTime()) ? raw : date.toISOString();
  }
  return raw;
}

/** The value as the operator's schema types it. The server checks the rest. */
function conditionValue(condition: Condition): unknown {
  const entry = condition.operators.find(
    ([name]) => name === condition.operator,
  );
  const schema = plainOf(entry?.[1] ?? {});
  if (typesOf(schema)[0] !== 'array') {
    return scalar(schema, condition.field, condition.value);
  }
  const item = isRecord(schema.items) ? plainOf(schema.items) : {};
  return condition.value
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '')
    .map((part) => scalar(item, condition.field, part));
}

/** The where the filters make, ANDed: one key per field. */
export function whereOf(
  collection: Collection,
  filters: readonly Filter[],
): Record<string, unknown> {
  return Object.fromEntries(
    conditionsOf(collection, filters)
      .filter((condition) => condition.value !== '')
      .map((condition) => [
        condition.field.name,
        { [condition.operator]: conditionValue(condition) },
      ]),
  );
}

/** The control for one condition's value, by the operator and field. */
function ValueControl({
  id,
  condition,
  label,
  onChange,
}: {
  readonly id: string;
  readonly condition: Condition;
  readonly label: string;
  readonly onChange: (value: string) => void;
}) {
  const { field, operator, value } = condition;
  const list = isList(operator);
  if (isYesNo(field, operator)) {
    return (
      <NativeSelect
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <NativeSelectOption value="true">Yes</NativeSelectOption>
        <NativeSelectOption value="false">No</NativeSelectOption>
      </NativeSelect>
    );
  }
  if (field.kind === 'enum' && !list) {
    return (
      <NativeSelect
        id={id}
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <NativeSelectOption value="">Any</NativeSelectOption>
        {field.values.map((option) => (
          <NativeSelectOption key={option} value={option}>
            {option}
          </NativeSelectOption>
        ))}
      </NativeSelect>
    );
  }
  const type = list
    ? 'text'
    : field.kind === 'number'
      ? 'number'
      : field.kind === 'datetime'
        ? 'datetime-local'
        : 'text';
  return (
    <Input
      id={id}
      aria-label={label}
      type={type}
      value={value}
      placeholder={list ? 'Comma-separated' : ''}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** One condition's row: its field, operator, value, and any issue. */
function ConditionRow({
  condition,
  issues,
  onChange,
  onRemove,
}: {
  readonly condition: Condition;
  readonly issues: readonly Issue[];
  readonly onChange: (operator: string, value: string) => void;
  readonly onRemove: () => void;
}) {
  const id = useId();
  const label = fieldLabel(condition.field);
  return (
    <Field orientation="horizontal">
      <FieldLabel htmlFor={id} className="w-32 shrink-0">
        {label}
      </FieldLabel>
      <NativeSelect
        aria-label={`${label} operator`}
        value={condition.operator}
        onChange={(event) =>
          onChange(
            event.target.value,
            initialValue(condition.field, event.target.value),
          )
        }
      >
        {condition.operators.map(([operator]) => (
          <NativeSelectOption key={operator} value={operator}>
            {operatorLabels[operator] ?? operator}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <ValueControl
        id={id}
        condition={condition}
        label={`${label} value`}
        onChange={(value) => onChange(condition.operator, value)}
      />
      <Button type="button" variant="ghost" size="sm" onClick={onRemove}>
        Remove
      </Button>
      <FieldError errors={[...issues]} />
    </Field>
  );
}

/**
 * The list's filters: at most one condition per field, ANDed, with the
 * operators the where schema gives each field. They apply on submit. A
 * `VALIDATION` issue on a field shows at its condition, with the server's
 * message.
 */
export function Filters({
  collection,
  applied,
  issues,
  onApply,
}: {
  readonly collection: Collection;
  readonly applied: readonly Filter[];
  readonly issues: (field: string) => readonly Issue[];
  readonly onApply: (filters: readonly Filter[]) => void;
}) {
  const [drafts, setDrafts] = useState<readonly Filter[]>(applied);
  const [picked, setPicked] = useState('');
  const conditions = conditionsOf(collection, drafts);
  const operators = operatorsOf(collection.operations.find?.input);
  const unused = collection.fields.filter(
    (field) =>
      operators.has(field.name) &&
      !conditions.some((condition) => condition.field.name === field.name),
  );

  const add = (name: string) => {
    const field = unused.find((candidate) => candidate.name === name);
    const first = operators.get(name)?.[0];
    if (field === undefined || first === undefined) return;
    const [operator] = first;
    setDrafts([...drafts, [name, operator, initialValue(field, operator)]]);
    setPicked('');
  };
  const change = (name: string, operator: string, value: string) =>
    setDrafts(
      drafts.map((filter) =>
        filter[0] === name ? [name, operator, value] : filter,
      ),
    );
  const remove = (name: string) =>
    setDrafts(drafts.filter(([field]) => field !== name));

  return (
    <form
      aria-label="Filters"
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        onApply(
          conditionsOf(collection, drafts).map(({ field, operator, value }) => [
            field.name,
            operator,
            value,
          ]),
        );
      }}
    >
      {conditions.map((condition) => (
        <ConditionRow
          key={condition.field.name}
          condition={condition}
          issues={issues(condition.field.name)}
          onChange={(operator, value) =>
            change(condition.field.name, operator, value)
          }
          onRemove={() => remove(condition.field.name)}
        />
      ))}
      <div className="flex items-center gap-2">
        <NativeSelect
          aria-label="Filter by"
          value={picked}
          onChange={(event) => setPicked(event.target.value)}
        >
          <NativeSelectOption value="">Filter by…</NativeSelectOption>
          {unused.map((field) => (
            <NativeSelectOption key={field.name} value={field.name}>
              {fieldLabel(field)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={picked === ''}
          onClick={() => add(picked)}
        >
          Add filter
        </Button>
        <Button type="submit" size="sm">
          Apply filters
        </Button>
      </div>
    </form>
  );
}
