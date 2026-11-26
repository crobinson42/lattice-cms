/** "1 deal", "12 deals". */
export function dealCount(count: number): string {
  return count === 1 ? '1 deal' : `${count} deals`;
}
