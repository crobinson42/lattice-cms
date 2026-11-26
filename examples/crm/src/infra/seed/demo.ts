import { NoopLogger } from '@hexok/logger';
import { unscoped } from '@latticecms/core';
import { createLocalClient } from '@ts-pf/server';
import type { Credentials } from '../../app/ports/auth/credentials.js';
import type { Actor } from '../../app/use-cases/context.js';
import type { CrmApp } from '../../servers/app.js';

/** The password every demo user signs in with. */
export const demoPassword = 'a long password';

/** One demo user, as the sign-in table shows them. */
export type DemoUser = {
  readonly userId: string;
  readonly name: string;
  readonly email: string;
  readonly role: string;
};

export const demoUsers: readonly DemoUser[] = [
  {
    userId: 'ann',
    name: 'Ann Lee',
    email: 'ann@example.com',
    role: 'manager in Acme Corp and Globex',
  },
  {
    userId: 'ben',
    name: 'Ben Ortiz',
    email: 'ben@example.com',
    role: 'member of Acme Corp',
  },
  {
    userId: 'sam',
    name: 'Sam Patel',
    email: 'sam@example.com',
    role: 'support (CRM_SUPPORT_USER_IDS)',
  },
];

const organizationNames = ['Acme Corp', 'Globex'] as const;

/** Why a second seed refuses: one line, with how to reset. */
export const alreadySeeded =
  'The database already has the demo organizations; `docker compose down -v` (then up and seed again) resets it.';

const day = 86_400_000;

/**
 * Writes the demo data: two organizations, three users, and a pipeline
 * worth opening. Users, organizations, memberships and credentials are
 * trusted writes, as dev:user makes them. Everything else goes through the
 * API as Ann or Ben, so it passes access, hooks, overrides and methods.
 * The data is fixed, and its dates are relative to `now`. Refuses, before
 * writing anything, when the demo organizations exist.
 */
export async function seedDemo(deps: {
  readonly crm: Pick<CrmApp, 'app' | 'repos'>;
  readonly credentials: Credentials;
  readonly now: Date;
}): Promise<readonly DemoUser[]> {
  const { organizations, memberships } = deps.crm.repos;
  const existing = await organizations.count(
    { name: { in: [...organizationNames] } },
    unscoped,
  );
  if (existing > 0) throw new Error(alreadySeeded);

  const acme = await organizations.insert({ name: 'Acme Corp' }, unscoped);
  const globex = await organizations.insert({ name: 'Globex' }, unscoped);
  const members = [
    { userId: 'ann', name: 'Ann Lee', org: acme.id, role: 'manager' },
    { userId: 'ann', name: 'Ann Lee', org: globex.id, role: 'manager' },
    { userId: 'ben', name: 'Ben Ortiz', org: acme.id, role: 'member' },
  ] as const;
  for (const { userId, name, org, role } of members) {
    await memberships.insert(
      { userId, name, organizationId: org, role },
      unscoped,
    );
  }
  for (const { userId, email } of demoUsers) {
    await deps.credentials.set({ userId, email }, demoPassword);
  }

  const as = (actor: Actor) => clientOf(deps.crm.app, actor);
  const at = (offsetDays: number, hour = 10) => {
    const date = new Date(deps.now.getTime() + offsetDays * day);
    date.setUTCHours(hour, 0, 0, 0);
    return date.toISOString();
  };
  const date = (offsetDays: number) => at(offsetDays).slice(0, 10);

  await pipeline({
    ann: as({ userId: 'ann', organizationId: acme.id, role: 'manager' }),
    ben: as({ userId: 'ben', organizationId: acme.id, role: 'member' }),
    companies: acmeCompanies,
    deals: acmeDeals,
    at,
    date,
  });
  const globexAnn = as({
    userId: 'ann',
    organizationId: globex.id,
    role: 'manager',
  });
  await pipeline({
    ann: globexAnn,
    ben: globexAnn,
    companies: globexCompanies,
    deals: globexDeals,
    at,
    date,
  });
  return demoUsers;
}

/** The API as one actor, over the app's router: what the seed writes through. */
function clientOf(app: CrmApp['app'], actor: Actor) {
  return createLocalClient(app, {
    context: { actor, logger: new NoopLogger() },
  });
}

type Client = ReturnType<typeof clientOf>;

type CompanySeed = {
  readonly name: string;
  readonly domain: string;
  readonly industry: string;
  readonly phone: string;
  /** First and last names of its contacts, with their job titles. */
  readonly contacts: readonly (readonly [string, string, string])[];
};

type DealSeed = {
  readonly title: string;
  /** The company's index in its organization's list. */
  readonly company: number;
  readonly amount: number;
  readonly stage:
    | 'lead'
    | 'qualified'
    | 'proposal'
    | 'negotiation'
    | 'won'
    | 'lost';
  readonly owner: 'ann' | 'ben';
  /** Days from now to the expected close date. */
  readonly closeIn: number;
};

const acmeCompanies: readonly CompanySeed[] = [
  {
    name: 'Northwind Outfitters',
    domain: 'northwind.test',
    industry: 'Retail',
    phone: '+1 555 0101',
    contacts: [
      ['Maya', 'Chen', 'Head of Purchasing'],
      ['Leo', 'Brandt', 'Store Operations Lead'],
    ],
  },
  {
    name: 'Blue Harbor Logistics',
    domain: 'blueharbor.test',
    industry: 'Logistics',
    phone: '+1 555 0102',
    contacts: [
      ['Priya', 'Nair', 'VP Operations'],
      ['Tom', 'Okafor', 'Fleet Manager'],
      ['Ines', 'Duarte', 'Procurement Analyst'],
    ],
  },
  {
    name: 'Pinecrest Health',
    domain: 'pinecrest.test',
    industry: 'Healthcare',
    phone: '+1 555 0103',
    contacts: [
      ['Grace', 'Holm', 'CIO'],
      ['Samir', 'Haddad', 'IT Director'],
    ],
  },
  {
    name: 'Summit Analytics',
    domain: 'summit.test',
    industry: 'Software',
    phone: '+1 555 0104',
    contacts: [
      ['Elena', 'Rossi', 'CTO'],
      ['Jonah', 'Weiss', 'Engineering Manager'],
      ['Aiko', 'Tanaka', 'Data Lead'],
    ],
  },
  {
    name: 'Redwood Energy',
    domain: 'redwood.test',
    industry: 'Energy',
    phone: '+1 555 0105',
    contacts: [
      ['Carlos', 'Mendes', 'Plant Director'],
      ['Hannah', 'Byrne', 'Finance Manager'],
    ],
  },
  {
    name: 'Lumen Labs',
    domain: 'lumen.test',
    industry: 'Software',
    phone: '+1 555 0106',
    contacts: [
      ['Noah', 'Fischer', 'Founder'],
      ['Zara', 'Ahmed', 'Head of Product'],
    ],
  },
  {
    name: 'Granite Builders',
    domain: 'granite.test',
    industry: 'Construction',
    phone: '+1 555 0107',
    contacts: [
      ['Owen', 'Price', 'Project Director'],
      ['Lucia', 'Ferrer', 'Office Manager'],
      ['Ravi', 'Kapoor', 'Estimator'],
    ],
  },
  {
    name: 'Silverline Foods',
    domain: 'silverline.test',
    industry: 'Retail',
    phone: '+1 555 0108',
    contacts: [
      ['Mia', 'Larsen', 'Category Manager'],
      ['Ethan', 'Cole', 'Supply Chain Lead'],
    ],
  },
  {
    name: 'Atlas Freightways',
    domain: 'atlasfreight.test',
    industry: 'Logistics',
    phone: '+1 555 0109',
    contacts: [
      ['Sofia', 'Moreau', 'COO'],
      ['Daniel', 'Kim', 'Dispatch Manager'],
    ],
  },
  {
    name: 'Cobalt Security',
    domain: 'cobalt.test',
    industry: 'Software',
    phone: '+1 555 0110',
    contacts: [
      ['Isaac', 'Novak', 'CISO'],
      ['Lena', 'Vogel', 'Security Engineer'],
      ['Marcus', 'Reed', 'IT Manager'],
    ],
  },
  {
    name: 'Meadow Clinics',
    domain: 'meadow.test',
    industry: 'Healthcare',
    phone: '+1 555 0111',
    contacts: [
      ['Olivia', 'Grant', 'Practice Manager'],
      ['Felix', 'Hart', 'Medical Director'],
    ],
  },
  {
    name: 'Ironbridge Manufacturing',
    domain: 'ironbridge.test',
    industry: 'Manufacturing',
    phone: '+1 555 0112',
    contacts: [
      ['Nadia', 'Petrova', 'Plant Manager'],
      ['George', 'Lund', 'Quality Lead'],
      ['Amara', 'Obi', 'Buyer'],
    ],
  },
];

const acmeDeals: readonly DealSeed[] = [
  {
    title: 'Spring store refit',
    company: 0,
    amount: 18_000,
    stage: 'lead',
    owner: 'ben',
    closeIn: 45,
  },
  {
    title: 'Fleet tracking rollout',
    company: 1,
    amount: 64_000,
    stage: 'proposal',
    owner: 'ann',
    closeIn: 20,
  },
  {
    title: 'Warehouse scanners',
    company: 1,
    amount: 22_500,
    stage: 'won',
    owner: 'ben',
    closeIn: -12,
  },
  {
    title: 'Patient portal',
    company: 2,
    amount: 120_000,
    stage: 'negotiation',
    owner: 'ann',
    closeIn: 9,
  },
  {
    title: 'Clinic Wi-Fi upgrade',
    company: 2,
    amount: 15_000,
    stage: 'lost',
    owner: 'ben',
    closeIn: -20,
  },
  {
    title: 'Analytics seats renewal',
    company: 3,
    amount: 48_000,
    stage: 'qualified',
    owner: 'ann',
    closeIn: 30,
  },
  {
    title: 'Data platform pilot',
    company: 3,
    amount: 35_000,
    stage: 'won',
    owner: 'ann',
    closeIn: -5,
  },
  {
    title: 'Grid monitoring',
    company: 4,
    amount: 210_000,
    stage: 'proposal',
    owner: 'ann',
    closeIn: 40,
  },
  {
    title: 'Field tablets',
    company: 4,
    amount: 27_000,
    stage: 'lead',
    owner: 'ben',
    closeIn: 60,
  },
  {
    title: 'Design system audit',
    company: 5,
    amount: 12_000,
    stage: 'qualified',
    owner: 'ben',
    closeIn: 25,
  },
  {
    title: 'Site safety platform',
    company: 6,
    amount: 58_000,
    stage: 'negotiation',
    owner: 'ben',
    closeIn: 6,
  },
  {
    title: 'Estimating software',
    company: 6,
    amount: 19_500,
    stage: 'lost',
    owner: 'ann',
    closeIn: -30,
  },
  {
    title: 'Shelf analytics',
    company: 7,
    amount: 31_000,
    stage: 'proposal',
    owner: 'ben',
    closeIn: 18,
  },
  {
    title: 'Cold chain sensors',
    company: 7,
    amount: 44_000,
    stage: 'won',
    owner: 'ann',
    closeIn: -2,
  },
  {
    title: 'Route optimisation',
    company: 8,
    amount: 76_000,
    stage: 'qualified',
    owner: 'ann',
    closeIn: 35,
  },
  {
    title: 'Managed SOC',
    company: 9,
    amount: 95_000,
    stage: 'negotiation',
    owner: 'ann',
    closeIn: 14,
  },
  {
    title: 'Pen test retainer',
    company: 9,
    amount: 16_000,
    stage: 'lead',
    owner: 'ben',
    closeIn: 50,
  },
  {
    title: 'Scheduling system',
    company: 10,
    amount: 29_000,
    stage: 'proposal',
    owner: 'ben',
    closeIn: 22,
  },
  {
    title: 'Line sensors',
    company: 11,
    amount: 132_000,
    stage: 'qualified',
    owner: 'ann',
    closeIn: 28,
  },
  {
    title: 'Quality dashboards',
    company: 11,
    amount: 24_000,
    stage: 'won',
    owner: 'ben',
    closeIn: -8,
  },
];

const globexCompanies: readonly CompanySeed[] = [
  {
    name: 'Hightower Media',
    domain: 'hightower.test',
    industry: 'Media',
    phone: '+1 555 0201',
    contacts: [
      ['Ruth', 'Adler', 'Head of Digital'],
      ['Victor', 'Sato', 'Producer'],
    ],
  },
  {
    name: 'Seaside Hotels',
    domain: 'seaside.test',
    industry: 'Hospitality',
    phone: '+1 555 0202',
    contacts: [
      ['Beatrice', 'Lowe', 'General Manager'],
      ['Kofi', 'Mensah', 'Revenue Manager'],
    ],
  },
  {
    name: 'Orbit Aerospace',
    domain: 'orbit.test',
    industry: 'Manufacturing',
    phone: '+1 555 0203',
    contacts: [['Yara', 'Haddad', 'Program Manager']],
  },
];

const globexDeals: readonly DealSeed[] = [
  {
    title: 'Streaming archive',
    company: 0,
    amount: 54_000,
    stage: 'proposal',
    owner: 'ann',
    closeIn: 16,
  },
  {
    title: 'Booking engine',
    company: 1,
    amount: 38_000,
    stage: 'won',
    owner: 'ann',
    closeIn: -10,
  },
  {
    title: 'Telemetry pipeline',
    company: 2,
    amount: 88_000,
    stage: 'qualified',
    owner: 'ann',
    closeIn: 33,
  },
];

const activityKinds = ['call', 'email', 'meeting', 'note'] as const;

/** One organization's companies, contacts, deals, activities and tasks. */
async function pipeline(seed: {
  readonly ann: Client;
  readonly ben: Client;
  readonly companies: readonly CompanySeed[];
  readonly deals: readonly DealSeed[];
  readonly at: (offsetDays: number, hour?: number) => string;
  readonly date: (offsetDays: number) => string;
}): Promise<void> {
  const { ann, ben, at, date } = seed;
  const client = (owner: 'ann' | 'ben') => (owner === 'ann' ? ann : ben);
  const companies: { id: string; contacts: string[] }[] = [];
  for (const [index, company] of seed.companies.entries()) {
    const { contacts, ...fields } = company;
    const created = await client(
      index % 3 === 2 ? 'ben' : 'ann',
    ).companies.create(fields);
    const ids: string[] = [];
    for (const [first, last, title] of contacts) {
      const contact = await ann.contacts.create({
        name: `${first} ${last}`,
        email: `${first}.${last}@${company.domain}`.toLowerCase(),
        title,
        phone: `${company.phone}${ids.length + 1}`,
        companyId: created.id,
      });
      ids.push(contact.id);
    }
    companies.push({ id: created.id, contacts: ids });
  }

  for (const [index, deal] of seed.deals.entries()) {
    const company = companies[deal.company];
    if (company === undefined) continue;
    const owner = client(deal.owner);
    const closes = deal.stage === 'won' || deal.stage === 'lost';
    // A member creates a deal with its amount, and does not read it back.
    const created = await owner.deals.create({
      title: deal.title,
      companyId: company.id,
      amount: deal.amount,
      stage: closes ? 'negotiation' : deal.stage,
      ownerId: deal.owner,
      expectedCloseDate: date(deal.closeIn),
    });
    // The first contact decides; a second, when there is one, champions.
    const [decider, champion] = company.contacts;
    await owner.deals.contacts.set({
      id: created.id,
      links: [
        ...(decider === undefined
          ? []
          : [{ contactsId: decider, role: 'decision_maker' as const }]),
        ...(champion === undefined
          ? []
          : [{ contactsId: champion, role: 'champion' as const }]),
      ],
    });
    await owner.activities.log({
      kind: activityKinds[index % activityKinds.length] ?? 'note',
      body: `${deal.title}: ${closes ? 'final terms discussed' : 'next steps agreed'}.`,
      occurredAt: at(-((index * 3) % 58) - 1, 9 + (index % 8)),
      dealId: created.id,
    });
    if (closes) {
      await owner.deals.close({
        id: created.id,
        outcome: deal.stage === 'won' ? 'won' : 'lost',
      });
    }
  }

  // Calls, emails, meetings and notes on companies and contacts, spread
  // over the last 60 days.
  for (const [index, company] of companies.entries()) {
    const author = client(index % 2 === 0 ? 'ann' : 'ben');
    await author.activities.log({
      kind: activityKinds[(index + 1) % activityKinds.length] ?? 'note',
      body: 'Quarterly check-in: priorities and budget reviewed.',
      occurredAt: at(-((index * 5) % 60) - 2, 14),
      companyId: company.id,
    });
    const [contact] = company.contacts;
    if (contact !== undefined) {
      await author.activities.log({
        kind: activityKinds[(index + 2) % activityKinds.length] ?? 'note',
        body: 'Followed up on the open questions from last week.',
        occurredAt: at(-((index * 7) % 59) - 1, 11),
        contactId: contact,
      });
    }
  }

  // Tasks for both: overdue, due soon, undated and done.
  const tasks = [
    { title: 'Send the revised quote', due: -3, done: false, who: 'ann' },
    { title: 'Book an onsite demo', due: 2, done: false, who: 'ann' },
    {
      title: 'Prepare the renewal brief',
      due: undefined,
      done: false,
      who: 'ann',
    },
    { title: 'Share the case study', due: -6, done: true, who: 'ann' },
    { title: 'Call back about pricing', due: -1, done: false, who: 'ben' },
    {
      title: 'Collect security questionnaire',
      due: 4,
      done: false,
      who: 'ben',
    },
    {
      title: 'Update contact details',
      due: undefined,
      done: false,
      who: 'ben',
    },
    { title: 'Log the kickoff notes', due: -2, done: true, who: 'ben' },
  ] as const;
  for (const [index, task] of tasks.entries()) {
    const company = companies[index % companies.length];
    if (company === undefined) continue;
    await client(task.who).tasks.create({
      title: task.title,
      done: task.done,
      assigneeId: task.who,
      companyId: company.id,
      ...(task.due === undefined ? {} : { dueDate: date(task.due) }),
    });
  }
}
