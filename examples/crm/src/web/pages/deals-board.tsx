import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@shadalaya/react/dropdown-menu';
import { MoreHorizontalIcon, ThumbsDownIcon, TrophyIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import useSWR from 'swr';
import { Link } from 'wouter';
import { useApi } from '../api.js';
import type {
  DealOutcome,
  DealWhere,
  DealWithCompany,
} from '../resources/deals/deal.js';
import {
  closeDialog,
  useDealActions,
} from '../resources/deals/deal-actions.js';
import { DealCard } from '../resources/deals/deal-card.js';
import {
  type DealSort,
  defaultDealSort,
} from '../resources/deals/deal-sorts.js';
import {
  dealStages,
  type OpenStage,
  openStages,
} from '../resources/deals/deal-stages.js';
import { memberOf } from '../resources/members/member.js';
import { ConfirmAction } from '../ui/confirm-action.js';
import { LoadMore, useCursorPages } from '../ui/cursor-pages.js';
import { isoDay } from '../ui/format.js';
import { writeListParams } from '../ui/list-params.js';
import { ErrorState, Loading } from '../ui/states.js';
import { type Team, useRoleRecheck } from '../workspace/team.js';

/** What a move needs from the board. */
type Moves = {
  readonly moving: ReadonlySet<string>;
  /** The deal whose menu button takes focus once it is in its new column. */
  readonly focusing: string | undefined;
  readonly onFocused: () => void;
  readonly onMove: (
    deal: DealWithCompany,
    stage: OpenStage,
    by: 'keyboard' | 'drag',
  ) => void;
};

/**
 * The pipeline: a column per open stage, each a page at a time. A deal
 * moves to another stage by drag and drop, or by its menu, an equal path
 * for the keyboard; a move is announced once the card is in its new
 * column. Won and lost deals are not on the board: the line under it
 * counts them, and links to them.
 */
export function DealsBoard({
  team,
  where,
  q,
  sort,
}: {
  readonly team: Team;
  readonly where: DealWhere;
  /** The page's search and sort, kept in the closed deals' links. */
  readonly q: string;
  readonly sort: DealSort;
}) {
  const { move } = useDealActions();
  const [moving, setMoving] = useState<ReadonlySet<string>>(new Set());
  const [dragged, setDragged] = useState<DealWithCompany>();
  const [focusing, setFocusing] = useState<string>();
  const [said, setSaid] = useState('');
  const onMove = async (
    deal: DealWithCompany,
    stage: OpenStage,
    by: 'keyboard' | 'drag',
  ) => {
    // One move at a time per card.
    if (deal.stage === stage || moving.has(deal.id)) return;
    setMoving((ids) => new Set(ids).add(deal.id));
    // Settles once the columns have read again.
    const moved = await move(deal, stage);
    setMoving((ids) => {
      const left = new Set(ids);
      left.delete(deal.id);
      return left;
    });
    if (!moved) return;
    setSaid(`Moved ${deal.title} to ${dealStages[stage].label}`);
    // The keyboard follows the card: its menu button is a new one.
    if (by === 'keyboard') setFocusing(deal.id);
  };
  const moves: Moves = {
    moving,
    focusing,
    onFocused: () => setFocusing(undefined),
    onMove: (deal, stage, by) => void onMove(deal, stage, by),
  };
  return (
    <>
      {/* Polite: a move is said once it is done. */}
      <div role="status" className="sr-only">
        {said}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {openStages.map((stage) => (
          <BoardColumn
            key={stage}
            stage={stage}
            where={where}
            sort={sort}
            team={team}
            moves={moves}
            dragged={dragged}
            onDrag={setDragged}
          />
        ))}
      </div>
      <ClosedSummary where={where} q={q} sort={sort} />
    </>
  );
}

function BoardColumn({
  stage,
  where,
  sort,
  team,
  moves,
  dragged,
  onDrag,
}: {
  readonly stage: OpenStage;
  readonly where: DealWhere;
  readonly sort: DealSort;
  readonly team: Team;
  readonly moves: Moves;
  readonly dragged: DealWithCompany | undefined;
  readonly onDrag: (deal: DealWithCompany | undefined) => void;
}) {
  const { swr } = useApi();
  const inStage = { ...where, stage: { eq: stage } };
  const count = useSWR(
    swr.deals.count.key({ input: { where: inStage } }),
    swr.deals.count.fetcher(),
  );
  const pages = useCursorPages(
    swr.deals.find.key,
    { where: inStage, sort: [sort], limit: 10, populate: ['companyId'] },
    (input) => swr.deals.find({ ...input, populate: ['companyId'] }),
  );
  useRoleRecheck(pages.error);
  const [over, setOver] = useState(false);
  const label = dealStages[stage].label;
  const today = isoDay(new Date());
  const accepts = dragged !== undefined && dragged.stage !== stage;
  return (
    <section
      aria-labelledby={`stage-${stage}`}
      onDragOver={(event) => {
        if (!accepts) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(event) => {
        event.preventDefault();
        setOver(false);
        // Only this board's own drag: its deal's id, as the drag set it.
        const id = event.dataTransfer.getData('text/plain');
        if (dragged !== undefined && accepts && id === dragged.id) {
          moves.onMove(dragged, stage, 'drag');
        }
        onDrag(undefined);
      }}
      className={`grid content-start gap-3 rounded-lg bg-muted/50 p-3 ${over ? 'ring-2 ring-ring' : ''}`}
    >
      <h2 id={`stage-${stage}`} className="flex justify-between font-semibold">
        {label}
        {count.data === undefined ? null : (
          // Read as "Lead, 3 deals"; shown as the number alone.
          <span className="text-muted-foreground">
            <span className="sr-only">, </span>
            {count.data.count}
            <span className="sr-only">
              {count.data.count === 1 ? ' deal' : ' deals'}
            </span>
          </span>
        )}
      </h2>
      {pages.rows === undefined ? (
        pages.error === undefined ? (
          <Loading />
        ) : (
          <ErrorState
            message={`The ${label.toLowerCase()} deals could not be loaded.`}
            onRetry={pages.refresh}
          />
        )
      ) : (
        <ul aria-label={label} className="grid gap-2">
          {pages.rows.map((deal) => (
            <li
              key={deal.id}
              draggable={!moves.moving.has(deal.id)}
              onDragStart={(event) => {
                event.dataTransfer.setData('text/plain', deal.id);
                event.dataTransfer.effectAllowed = 'move';
                onDrag(deal);
              }}
              onDragEnd={() => onDrag(undefined)}
            >
              <DealCard
                deal={deal}
                owner={memberOf(team.members, deal.ownerId)}
                today={today}
                moving={moves.moving.has(deal.id)}
                actions={<CardMenu deal={deal} moves={moves} />}
              />
            </li>
          ))}
          {pages.rows.length === 0 ? (
            <li className="text-sm text-muted-foreground">No deals</li>
          ) : null}
        </ul>
      )}
      <LoadMore pages={pages} what={`${label.toLowerCase()} deals`} />
    </section>
  );
}

/**
 * A card's menu: move to another open stage, or close the deal, through the
 * same dialog as the deal's page. Its button takes focus when the card has
 * just moved by keyboard, and when the dialog closes.
 */
function CardMenu({
  deal,
  moves,
}: {
  readonly deal: DealWithCompany;
  readonly moves: Moves;
}) {
  const { close } = useDealActions();
  const [closing, setClosing] = useState<DealOutcome>();
  const trigger = useRef<HTMLButtonElement>(null);
  const moving = moves.moving.has(deal.id);
  const { focusing, onFocused } = moves;
  useEffect(() => {
    if (focusing !== deal.id) return;
    trigger.current?.focus();
    onFocused();
  }, [focusing, deal.id, onFocused]);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          ref={trigger}
          aria-label={`Actions for ${deal.title}`}
          className="rounded-md p-1 text-muted-foreground hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
        >
          <MoreHorizontalIcon className="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-44">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Move to</DropdownMenuLabel>
            {openStages
              .filter((stage) => stage !== deal.stage)
              .map((stage) => (
                <DropdownMenuItem
                  key={stage}
                  disabled={moving}
                  onClick={() => moves.onMove(deal, stage, 'keyboard')}
                >
                  {dealStages[stage].label}
                </DropdownMenuItem>
              ))}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={moving} onClick={() => setClosing('won')}>
            <TrophyIcon />
            Close as won…
          </DropdownMenuItem>
          <DropdownMenuItem
            disabled={moving}
            onClick={() => setClosing('lost')}
          >
            <ThumbsDownIcon />
            Close as lost…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {closing === undefined ? null : (
        <ConfirmAction
          open
          onOpenChange={(open) => {
            if (!open) setClosing(undefined);
          }}
          finalFocus={trigger}
          {...closeDialog(deal, closing)}
          onConfirm={() => close(deal, closing)}
        />
      )}
    </>
  );
}

/** Under the board: how many deals closed, each count a link to them. */
function ClosedSummary({
  where,
  q,
  sort,
}: {
  readonly where: DealWhere;
  readonly q: string;
  readonly sort: DealSort;
}) {
  const { swr } = useApi();
  const won = useSWR(
    swr.deals.count.key({
      input: { where: { ...where, stage: { eq: 'won' } } },
    }),
    swr.deals.count.fetcher(),
  );
  const lost = useSWR(
    swr.deals.count.key({
      input: { where: { ...where, stage: { eq: 'lost' } } },
    }),
    swr.deals.count.fetcher(),
  );
  if (won.data === undefined || lost.data === undefined) return null;
  // The table, filtered by the stage, with the board's search and sort.
  const tableOf = (stage: 'won' | 'lost') =>
    `/deals${writeListParams({ q, sort }, defaultDealSort, `?view=table&stage=${stage}`)}`;
  return (
    <p className="mt-4 text-sm text-muted-foreground">
      <Link
        href={tableOf('won')}
        className="underline-offset-4 hover:underline"
      >
        {won.data.count} won
      </Link>
      {' · '}
      <Link
        href={tableOf('lost')}
        className="underline-offset-4 hover:underline"
      >
        {lost.data.count} lost
      </Link>
    </p>
  );
}
