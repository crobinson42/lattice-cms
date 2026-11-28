import { Button } from '@shadalaya/react/button';
import { asResult } from '@ts-pf/client';
import { PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useApi } from '../api.js';
import {
  type Activity,
  type ActivityLog,
  type ActivityPatch,
  activityPopulate,
} from '../resources/activities/activity.js';
import { ActivityForm } from '../resources/activities/activity-form.js';
import { ActivityItem } from '../resources/activities/activity-item.js';
import { activityKinds } from '../resources/activities/activity-kinds.js';
import { ActivityTimeline } from '../resources/activities/activity-timeline.js';
import { memberOf } from '../resources/members/member.js';
import { type Parent, parentsOf, whereOn } from '../resources/parents.js';
import { useAfterWrite } from '../ui/after-write.js';
import { ConfirmAction } from '../ui/confirm-action.js';
import { useCursorPages } from '../ui/cursor-pages.js';
import { FormSheet } from '../ui/form.js';
import { useRowActions } from '../ui/row-actions.js';
import { Section } from '../ui/section.js';
import { EmptyState } from '../ui/states.js';
import { type Team, TeamGate } from '../workspace/team.js';

/**
 * A page's activity: a composer to log a note, call, email or meeting on
 * what the page shows, collapsed until asked for, over its timeline, newest
 * first. The company, contact and deal pages share it. An activity's
 * author may edit or delete it; the access filter refuses anyone else.
 */
export function ActivitySection({
  parent,
  name,
}: {
  /** What the page shows, and so what an activity is logged on. */
  readonly parent: Parent;
  /** Its name, for the timeline's label: "Activity on Acme". */
  readonly name: string;
}) {
  return (
    <Section id="activity" title="Activity">
      <TeamGate>
        {(team) => <Timeline parent={parent} name={name} team={team} />}
      </TeamGate>
    </Section>
  );
}

function Timeline({
  parent,
  name,
  team,
}: {
  readonly parent: Parent;
  readonly name: string;
  readonly team: Team;
}) {
  const { rpc, swr } = useApi();
  const afterWrite = useAfterWrite();
  // Each activity with its company, deal and contact, for its links.
  const pages = useCursorPages(
    swr.activities.find.key,
    {
      where: whereOn(parent),
      sort: ['-occurredAt'],
      limit: 20,
      populate: [...activityPopulate],
    },
    (input) =>
      swr.activities.find({ ...input, populate: [...activityPopulate] }),
  );

  const [composing, setComposing] = useState(false);
  const [editing, setEditing] = useState<Activity>();
  // After logging, the composer folds back up, and focus goes to its button.
  const composer = useRef<HTMLButtonElement>(null);
  const [refocus, setRefocus] = useState(false);
  const [refocusEdit, setRefocusEdit] = useState<string>();
  const editButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (refocusEdit === undefined) return;
    editButton.current?.focus();
    setRefocusEdit(undefined);
  }, [refocusEdit]);
  useEffect(() => {
    if (!refocus) return;
    composer.current?.focus();
    setRefocus(false);
  }, [refocus]);

  // An activity that is not yours, or no longer there, is NOT_FOUND.
  const rows = useRowActions({
    changed: swr.activities.matcher(),
    noun: 'activity',
  });

  const log = async (input: ActivityLog) => {
    const result = await asResult(rpc.activities.log(input));
    if (!result.ok) return result.error;
    setComposing(false);
    setRefocus(true);
    void afterWrite({
      changed: swr.activities.matcher(),
      says: `${activityKinds[result.data.kind].label} logged`,
    });
    return undefined;
  };

  const update = (activity: Activity) => async (patch: ActivityPatch) => {
    if (Object.keys(patch).length === 0) {
      setEditing(undefined);
      return undefined;
    }
    const refused = await rows.save(
      asResult(rpc.activities.update({ id: activity.id, ...patch })),
      () => setEditing(undefined),
    );
    // A new time can move it to another day, where it is a new row: now
    // that the timeline has read again, focus that row's Edit button.
    if (refused === undefined) setRefocusEdit(activity.id);
    return refused;
  };

  const remove = (activity: Activity) =>
    rows.remove(
      asResult(rpc.activities.delete({ id: activity.id })),
      'Deleted',
    );

  const what = (activity: Activity) =>
    `this ${activityKinds[activity.kind].label.toLowerCase()}`;
  return (
    <div className="grid gap-6">
      {composing ? (
        <div className="rounded-lg border p-4">
          <ActivityForm
            focusFirst
            parents={parentsOf(parent)}
            onSubmit={log}
            onCancel={() => {
              setComposing(false);
              setRefocus(true);
            }}
          />
        </div>
      ) : (
        <Button
          ref={composer}
          variant="outline"
          className="justify-start text-muted-foreground"
          onClick={() => setComposing(true)}
        >
          <PlusIcon />
          Log a note, call, email or meeting…
        </Button>
      )}
      <ActivityTimeline
        label={`Activity on ${name}`}
        pages={pages}
        empty={
          <EmptyState
            title="No activity yet"
            description="What happens here shows up as it is logged."
          />
        }
        item={(activity) => (
          <ActivityItem
            activity={activity}
            author={memberOf(team.members, activity.authorId)}
            on={parent.on}
            {...(activity.authorId === team.me.userId
              ? {
                  actions: (
                    <>
                      <Button
                        ref={
                          activity.id === refocusEdit ? editButton : undefined
                        }
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${what(activity)}`}
                        onClick={() => setEditing(activity)}
                      >
                        <PencilIcon />
                      </Button>
                      <ConfirmAction
                        trigger={
                          <>
                            <Trash2Icon />
                            {/* The icon is hidden: this names the button. */}
                            <span className="sr-only">
                              Delete {what(activity)}
                            </span>
                          </>
                        }
                        variant="ghost"
                        size="icon-sm"
                        // Its row goes: focus goes back to the composer.
                        finalFocus={composer}
                        title={`Delete ${what(activity)}?`}
                        description="It leaves every timeline it is on. This cannot be undone."
                        confirm="Delete"
                        pending="Deleting…"
                        onConfirm={() => remove(activity)}
                      />
                    </>
                  ),
                }
              : {})}
          />
        )}
      />
      <FormSheet
        open={editing !== undefined}
        onOpenChange={(open) => {
          if (!open) setEditing(undefined);
        }}
        title={editing === undefined ? 'Edit' : `Edit ${what(editing)}`}
        description="Only what you change is saved."
      >
        {editing === undefined ? null : (
          <ActivityForm activity={editing} onSubmit={update(editing)} />
        )}
      </FormSheet>
    </div>
  );
}
