import { framework } from '@latticecms/core';
import { AppUseCase } from '../../app/use-cases/context.js';
import { Companies } from '../../domain/collections/companies.js';
import { Contacts } from '../../domain/collections/contacts.js';

const anyone = () => true;

/** The app's API. */
export const api = framework({ family: AppUseCase })
  .collection(Companies, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  })
  .collection(Contacts, {
    access: { read: anyone, create: anyone, update: anyone, delete: anyone },
  });
