import type { ActivityParents } from './activity.js';

/** Where an activity is logged: the page it is logged from. */
export type LoggedOn =
  | { readonly on: 'company'; readonly id: string }
  | { readonly on: 'contact'; readonly id: string; readonly companyId: string }
  | { readonly on: 'deal'; readonly id: string; readonly companyId: string };

/**
 * The parents an activity records, by the rule: on a deal, the deal and
 * its company; on a contact, the contact and its company; on a company, the
 * company. So a company's timeline, a filter on companyId alone, shows all
 * that happened around it, with no join and no OR. The domain allows any
 * combination; this is how the app logs.
 *
 * The company is the one at logging time. A contact or deal that later
 * moves to another company leaves its activities on the old company's
 * timeline: they happened with that company.
 */
export function parentsOf(logged: LoggedOn): ActivityParents {
  switch (logged.on) {
    case 'company':
      return { companyId: logged.id };
    case 'contact':
      return { contactId: logged.id, companyId: logged.companyId };
    case 'deal':
      return { dealId: logged.id, companyId: logged.companyId };
  }
}

/** A timeline's filter: the activities on that one parent. */
export function timelineOf(logged: LoggedOn) {
  switch (logged.on) {
    case 'company':
      return { companyId: { eq: logged.id } };
    case 'contact':
      return { contactId: { eq: logged.id } };
    case 'deal':
      return { dealId: { eq: logged.id } };
  }
}
