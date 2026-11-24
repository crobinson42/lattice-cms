import { reservedFields, reservedNames } from '@latticecms/core';
import { Exit } from './exit.js';

/** What a slug becomes: its file name, its export and its events' prefix. */
export type Names = {
  readonly slug: string;
  /** Kebab case, without an extension: `deal-notes`. */
  readonly file: string;
  /** Pascal case: `DealNotes`. */
  readonly exportName: string;
  /** Camel case, the events' prefix: `dealNotes`. */
  readonly camel: string;
};

/** Lower snake case: a MongoDB collection, a URL segment and a label. */
const slugPattern = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

/** The names of a slug, or a refusal when the slug breaks the rule. */
export function namesOf(slug: string): Names {
  if (!slugPattern.test(slug)) {
    throw new Exit(
      `"${slug}" is not a slug: use lower snake case, as deal_notes`,
      1,
    );
  }
  if (reservedNames.some((name) => name === slug)) {
    throw new Exit(`"${slug}" is reserved: a ts-pf implementer key`, 1);
  }
  const words = slug.split('_');
  const upper = (word: string) => `${word[0]?.toUpperCase()}${word.slice(1)}`;
  return {
    slug,
    file: words.join('-'),
    exportName: words.map(upper).join(''),
    camel: `${words[0]}${words.slice(1).map(upper).join('')}`,
  };
}

/** Why `name` cannot be a field, such as the tenant field, or undefined when it can. */
export function fieldProblem(name: string): string | undefined {
  if (reservedFields.some((field) => field === name)) {
    return `"${name}" is a reserved field name`;
  }
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(name)) {
    return `"${name}" is not a field name`;
  }
  return undefined;
}
