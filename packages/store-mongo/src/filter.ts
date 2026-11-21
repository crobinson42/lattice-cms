import type { AnyWhere, FieldOps, Order } from '@latticecms/core/store';
import type { Document } from 'mongodb';

/** The Mongo field that holds a Lattice field: `id` is kept in `_id`. */
export function mongoField(field: string): string {
  return field === 'id' ? '_id' : field;
}

/** `text` with every regex metacharacter escaped, so it matches literally. */
export function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}

/**
 * Both filters. Never merged by spreading: two filters can name the same
 * field, and a spread would let one replace the other's condition.
 */
export function and(...filters: readonly (Document | undefined)[]): Document {
  const present = filters.filter(
    (filter): filter is Document =>
      filter !== undefined && Object.keys(filter).length > 0,
  );
  if (present.length === 0) return {};
  if (present.length === 1) return present[0] ?? {};
  return { $and: present };
}

/** Matches no document. Mongo rejects an empty `$or`; the matcher finds nothing. */
const nothing: Document = { $expr: false };

/** The Mongo conditions of one field's operators, each as `[operator, value]`. */
function conditions(ops: FieldOps): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [op, value] of Object.entries(ops)) {
    if (value === undefined) continue;
    switch (op) {
      case 'eq':
      case 'ne':
      case 'in':
      case 'nin':
      case 'gt':
      case 'gte':
      case 'lt':
      case 'lte':
        out.push([`$${op}`, value]);
        break;
      case 'contains':
        // Case-insensitive and literal, never a pattern. A regex matches
        // strings only, as `contains` does.
        out.push(['$regex', escapeRegex(String(value))], ['$options', 'i']);
        break;
      case 'exists':
        // Lattice's exists asks whether a field has a value, so null does
        // not exist. Mongo's $exists would count null as present.
        out.push(value === true ? ['$ne', null] : ['$eq', null]);
        break;
      default:
        throw new Error(`MongoStore: unknown operator "${op}"`);
    }
  }
  return out;
}

/**
 * The filter for one field. Its operators share one object, unless two map
 * to the same Mongo operator (`ne` with `exists: true`), when each gets its
 * own clause.
 */
function fieldFilter(field: string, ops: FieldOps): Document {
  const name = mongoField(field);
  const pairs = conditions(ops);
  const operators = pairs.map(([op]) => op);
  if (new Set(operators).size === operators.length) {
    return { [name]: Object.fromEntries(pairs) };
  }
  return and(
    ...pairs
      .filter(([op]) => op !== '$options')
      .map(([op, value]) =>
        op === '$regex'
          ? { [name]: { $regex: value, $options: 'i' } }
          : { [name]: { [op]: value } },
      ),
  );
}

function isClauses(
  condition: FieldOps | readonly AnyWhere[],
): condition is readonly AnyWhere[] {
  return Array.isArray(condition);
}

/**
 * A parsed `Where` as a Mongo filter, one to one: the matcher already
 * follows Mongo's null and missing rules. Fields become one object, which
 * Mongo ANDs; `and` and `or` become `$and` and `$or`.
 */
export function toFilter(where: AnyWhere | undefined): Document {
  if (where === undefined) return {};
  const fields: Document[] = [];
  const clauses: Document[] = [];
  for (const [field, condition] of Object.entries(where)) {
    if (condition === undefined) continue;
    if (!isClauses(condition)) {
      fields.push(fieldFilter(field, condition));
    } else if (field === 'and') {
      clauses.push(...condition.map(toFilter));
    } else {
      clauses.push(
        condition.length === 0 ? nothing : { $or: condition.map(toFilter) },
      );
    }
  }
  // Each field is named once, so field filters without `$and` merge.
  const simple = fields.filter((filter) => !('$and' in filter));
  const nested = fields.filter((filter) => '$and' in filter);
  return and(Object.assign({}, ...simple), ...nested, ...clauses);
}

/** A Lattice order as a Mongo sort spec, in key order. */
export function toSort(order: Order): [string, 1 | -1][] {
  return order.map(({ field, direction }) => [mongoField(field), direction]);
}
