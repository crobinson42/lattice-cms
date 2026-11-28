import { toast } from '@shadalaya/react/toast';
import type { SwrMatcher } from '@ts-pf/swr';
import { useCallback } from 'react';
import type { ApiError } from '../api.js';
import { useAfterWrite } from './after-write.js';

/** A write's answer, as asResult gives it. */
type Sent =
  | { readonly ok: true }
  | { readonly ok: false; readonly error: ApiError };

/**
 * What a list's row does after its own write, the same for activities and
 * tasks. Lists read again through useAfterWrite, the one path that reaches
 * a cursor list.
 * - `gone`: a row deleted elsewhere, or one the caller may not change, is
 *   NOT_FOUND to a write: it says so in words, and the lists read again.
 * - `save`: an edit closes its form, says Saved, and settles once the lists
 *   have read again, for focus. A refusal goes back to the form.
 * - `remove`: a delete says `says`. A refusal goes back to its dialog, in
 *   words.
 */
export function useRowActions({
  changed,
  noun,
}: {
  readonly changed: SwrMatcher;
  /** What a row is, for the words: "activity", "task". */
  readonly noun: string;
}) {
  const afterWrite = useAfterWrite();
  const gone = useCallback(
    (error: ApiError): boolean => {
      if (error.code !== 'NOT_FOUND') return false;
      toast.add({
        title: `That ${noun} is no longer there to change.`,
        type: 'error',
      });
      void afterWrite({ changed });
      return true;
    },
    [afterWrite, changed, noun],
  );
  return {
    gone,
    save: async (
      sent: Promise<Sent>,
      close: () => void,
    ): Promise<ApiError | undefined> => {
      const result = await sent;
      if (!result.ok && !gone(result.error)) return result.error;
      close();
      if (result.ok) await afterWrite({ changed, says: 'Saved' });
      return undefined;
    },
    remove: async (
      sent: Promise<Sent>,
      says: string,
    ): Promise<string | undefined> => {
      const result = await sent;
      if (result.ok) {
        void afterWrite({ changed, says });
        return undefined;
      }
      return gone(result.error) ? undefined : result.error.message;
    },
  };
}
