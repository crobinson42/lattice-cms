/** "1 contact", "12 contacts". */
export function contactCount(count: number): string {
  return count === 1 ? '1 contact' : `${count} contacts`;
}
