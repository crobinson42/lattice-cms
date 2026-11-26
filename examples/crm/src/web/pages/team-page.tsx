import { UsersRoundIcon } from 'lucide-react';
import { memberColumns } from '../resources/members/member-columns.js';
import { DataTable } from '../ui/data-table.js';
import { PageHeader } from '../ui/page-header.js';
import { type Team, TeamGate } from '../workspace/team.js';

/**
 * The organization's members and their roles, from the team the workspace
 * has already read. Memberships are written only by trusted code, so there
 * is nothing to edit here.
 */
export default function TeamPage() {
  return <TeamGate>{(team) => <Members team={team} />}</TeamGate>;
}

function Members({ team }: { readonly team: Team }) {
  return (
    <>
      <PageHeader
        title="Team"
        icon={<UsersRoundIcon />}
        description="Roles are managed by an administrator."
      />
      <DataTable
        label="Team"
        columns={memberColumns(team.me.userId)}
        rows={team.members}
        rowKey={(member) => member.userId}
      />
    </>
  );
}
