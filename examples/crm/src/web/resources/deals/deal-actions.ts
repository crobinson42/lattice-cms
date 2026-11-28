import { toast } from '@shadalaya/react/toast';
import { asResult } from '@ts-pf/client';
import { useCallback } from 'react';
import { useSWRConfig } from 'swr';
import { type ApiError, useApi } from '../../api.js';
import { useAfterWrite } from '../../ui/after-write.js';
import type { Deal, DealOutcome } from './deal.js';
import { type DealStage, dealStages, type OpenStage } from './deal-stages.js';

type Named = Pick<Deal, 'id' | 'title'>;

/** What the dialog that closes a deal says, wherever it opens from. */
export function closeDialog(deal: Named, outcome: DealOutcome) {
  return {
    title: `Close ${deal.title} as ${outcome}?`,
    description: 'A deal closes once, and then cannot be edited.',
    confirm: `Close as ${outcome}`,
    pending: 'Closing…',
  } as const;
}

/**
 * The writes a page makes to deals it shows, the deal page's and the
 * board's. Each answers with the refusal in words, or undefined.
 */
export function useDealActions() {
  const { rpc, swr } = useApi();
  const { mutate } = useSWRConfig();
  const afterWrite = useAfterWrite();

  /**
   * Whether `error` says another tab changed the deal first: closed it
   * (AlreadyClosed), or closed or archived it, which a write's filter
   * answers as NOT_FOUND. The deals are read again, so the page shows it
   * closed, moved or gone, and a toast says why.
   */
  const changedElsewhere = useCallback(
    (deal: Named, error: ApiError): boolean => {
      if (error.code !== 'AlreadyClosed' && error.code !== 'NOT_FOUND') {
        return false;
      }
      toast.add({
        title:
          error.code === 'AlreadyClosed'
            ? `${deal.title} was already closed, perhaps in another tab.`
            : `${deal.title} was closed or archived, perhaps in another tab.`,
        type: 'error',
      });
      void mutate(swr.deals.matcher());
      return true;
    },
    [mutate, swr],
  );

  const close = useCallback(
    async (deal: Named, outcome: DealOutcome) => {
      const result = await asResult(rpc.deals.close({ id: deal.id, outcome }));
      if (result.ok) {
        void afterWrite({
          changed: swr.deals.matcher(),
          says: `Closed ${deal.title} as ${outcome}`,
        });
        return undefined;
      }
      // A refusal the page shows by reading the deal again closes the
      // dialog: the dialog may be gone with the open deal's buttons.
      return changedElsewhere(deal, result.error)
        ? undefined
        : result.error.message;
    },
    [rpc, swr, afterWrite, changedElsewhere],
  );

  /**
   * Moves an open deal to another open stage. The board announces it, so
   * there is no toast; a refusal is one, with its reason.
   */
  const move = useCallback(
    async (deal: Named, stage: OpenStage): Promise<boolean> => {
      const result = await asResult(rpc.deals.update({ id: deal.id, stage }));
      // Settles once the board's columns have read again: the card shows
      // as moving until it is in its new column.
      if (result.ok) {
        await afterWrite({ changed: swr.deals.matcher() });
        return true;
      }
      if (!changedElsewhere(deal, result.error)) {
        toast.add({
          title: `${deal.title} could not move to ${stageLabel(stage)}: ${result.error.message}`,
          type: 'error',
        });
      }
      return false;
    },
    [rpc, swr, afterWrite, changedElsewhere],
  );

  return { changedElsewhere, close, move };
}

function stageLabel(stage: DealStage): string {
  return dealStages[stage].label;
}
