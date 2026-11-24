import { Button } from '@shadalaya/react/button';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from '@shadalaya/react/card';
import { useState } from 'react';
import { isRecord } from './catalog.js';
import type { Collection, Method } from './collections.js';
import { ConfirmDialog } from './confirm.js';
import { useCaller, useRevalidate } from './data.js';
import { draftsOf, InputForm, inputFieldsOf } from './form.js';
import { methodLabel } from './labels.js';
import { type Refusal, refusalOf } from './refusal.js';
import { RefusalAlert } from './refusal-alert.js';
import { fieldsOf, propertiesOf } from './schema.js';
import { FieldList } from './value.js';

/** Whether a method acts on one document: its input takes an `id`. */
export function isDocumentMethod({ procedure }: Method): boolean {
  return (
    procedure.input !== undefined &&
    propertiesOf(procedure.input).some(([name]) => name === 'id')
  );
}

/**
 * What a method returned, read-only: the fields its output schema names,
 * or JSON when it names none. Nothing returned shows nothing.
 */
function MethodResult({
  method,
  output,
}: {
  readonly method: Method;
  readonly output: unknown;
}) {
  if (output === undefined || output === null) return null;
  const fields = fieldsOf(method.procedure.output ?? {});
  return (
    <Card
      size="sm"
      role="region"
      aria-label={`${methodLabel(method.name)} result`}
    >
      <CardContent>
        {isRecord(output) && fields.length > 0 ? (
          <FieldList fields={fields} doc={output} />
        ) : (
          <pre>{JSON.stringify(output, null, 2)}</pre>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * A method as an action: a document action when `id` is given, else a
 * collection action. It is labelled by its name, with its summary beside
 * it. Its form is its input but `id`. With no other field it is a button:
 * a read runs at once, and a write asks first. A destructive method always
 * asks first.
 */
export function MethodAction({
  collection,
  method,
  id,
}: {
  readonly collection: Collection;
  readonly method: Method;
  readonly id: string | undefined;
}) {
  const call = useCaller();
  const revalidate = useRevalidate('refresh');
  const [open, setOpen] = useState(false);
  const [output, setOutput] = useState<
    { readonly value: unknown } | undefined
  >();
  const [refusal, setRefusal] = useState<Refusal | undefined>();
  const { procedure } = method;
  const label = methodLabel(method.name);
  const summary = procedure.docs?.summary ?? '';
  const fields = inputFieldsOf(procedure.input, id === undefined ? [] : ['id']);
  const confirmation = {
    title: `${label}?`,
    description: summary,
    action: label,
    destructive: procedure.effect === 'destructive',
  };

  const run = async (body: Record<string, unknown>) => {
    const value = await call(
      procedure,
      id === undefined ? body : { ...body, id },
    );
    await revalidate(collection);
    setOpen(false);
    // The page's own document, refreshed: the page shows it.
    setOutput(
      isRecord(value) && id !== undefined && value.id === id
        ? undefined
        : { value },
    );
  };
  const runAlone = () => {
    run({}).catch((error: unknown) => setRefusal(refusalOf(error)));
  };

  return (
    <div className="flex flex-col gap-2">
      <Button
        type="button"
        variant="outline"
        title={summary}
        onClick={() => {
          setRefusal(undefined);
          setOutput(undefined);
          if (fields.length > 0) {
            setOpen(!open);
          } else if (procedure.effect === 'read') {
            runAlone();
          } else {
            setOpen(true);
          }
        }}
      >
        {label}
      </Button>
      {fields.length === 0 && procedure.effect !== 'read' ? (
        <ConfirmDialog
          confirmation={confirmation}
          open={open}
          onOpenChange={setOpen}
          onConfirm={runAlone}
        />
      ) : null}
      {fields.length > 0 && open ? (
        <Card>
          <CardHeader>
            <CardTitle>{label}</CardTitle>
            <p className="text-sm text-muted-foreground">{summary}</p>
          </CardHeader>
          <CardContent>
            <InputForm
              label={label}
              fields={fields}
              initial={draftsOf(fields, {})}
              submitLabel={label}
              {...(confirmation.destructive ? { confirmation } : {})}
              onSubmit={run}
            />
          </CardContent>
        </Card>
      ) : null}
      {refusal === undefined ? null : <RefusalAlert refusal={refusal} />}
      {output === undefined ? null : (
        <MethodResult method={method} output={output.value} />
      )}
    </div>
  );
}
