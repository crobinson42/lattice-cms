import { framework } from '@latticecms/core';
import { AppUseCase } from '../../app/use-cases/context.js';
import { ArchiveDeal } from '../../app/use-cases/deals/archive-deal.js';
import { CloseDeal } from '../../app/use-cases/deals/close-deal.js';
import { Companies } from '../../domain/collections/companies.js';
import { Contacts } from '../../domain/collections/contacts.js';
import { Deals } from '../../domain/collections/deals.js';
import { clientErrors, toRpcError } from './errors.js';

/** The CRM's API: three collections, one override and one method. No ports. */
export const crm = framework({
  family: AppUseCase,
  errors: { declared: clientErrors, map: toRpcError },
})
  .collection(Companies)
  .collection(Contacts)
  .collection(Deals, {
    methods: { close: CloseDeal },
    overrides: { delete: ArchiveDeal },
  });

/** What clients and codegen import. */
export const contract = crm.contract;

export { AppUseCase, Companies, Contacts, Deals };
