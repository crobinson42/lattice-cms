import { framework } from '@latticecms/core';
import { AppUseCase } from '../../app/use-cases/context.js';
import { ArchiveDeal } from '../../app/use-cases/deals/archive-deal.js';
import { CloseDeal } from '../../app/use-cases/deals/close-deal.js';
import { Companies } from '../../domain/collections/companies.js';
import { Contacts } from '../../domain/collections/contacts.js';
import { Deals } from '../../domain/collections/deals.js';
import { clientErrors, toRpcError } from './errors.js';

/** Any signed-in caller may do this. The edge has already checked the actor. */
const anyone = () => true;

// An archived deal is hidden from every read and can no longer change.
const live = () => ({ archived: { eq: false } });

/** The CRM's API: three collections, one override and one method. No ports. */
export const crm = framework({
  family: AppUseCase,
  errors: { declared: clientErrors, map: toRpcError },
})
  .collection(Companies, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
  .collection(Contacts, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
  .collection(Deals, {
    access: {
      read: live,
      create: anyone,
      update: live,
      delete: live,
      close: live,
    },
    methods: { close: CloseDeal },
    overrides: { delete: ArchiveDeal },
  });

/** What clients and codegen import. */
export const contract = crm.contract;

export { AppUseCase, Companies, Contacts, Deals };
