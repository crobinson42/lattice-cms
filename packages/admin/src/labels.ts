import type { LatticeMeta } from '@latticecms/core';
import type { Field } from './schema.js';

/** `companyId` as "Company id", and `deal_contacts` as "Deal contacts". */
function inWords(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[\s_-]+/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
  return capitalize(words.join(' '));
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** A field's label: its schema `title`, or its name in words. */
export function fieldLabel(field: Pick<Field, 'name' | 'title'>): string {
  return field.title ?? inWords(field.name);
}

/** A relation's label: its name in words. */
export function relationLabel(name: string): string {
  return inWords(name);
}

/** A method's label: its name in words, such as "Close" for `close`. */
export function methodLabel(name: string): string {
  return inWords(name);
}

/** A collection's heading, such as "Deals". */
export function pluralHeading(label: LatticeMeta['label']): string {
  return capitalize(label.plural);
}

/** One document's heading, such as "Deal". */
export function singularHeading(label: LatticeMeta['label']): string {
  return capitalize(label.singular);
}
