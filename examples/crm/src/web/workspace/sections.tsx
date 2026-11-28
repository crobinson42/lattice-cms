import {
  BriefcaseIcon,
  Building2Icon,
  HouseIcon,
  ListChecksIcon,
  UsersIcon,
  UsersRoundIcon,
} from 'lucide-react';
import { OverdueTasksBadge } from './overdue-tasks-badge.js';

/**
 * The app's sections, in the sidebar's order: the sidebar and the search
 * palette's navigation list them. A page adds itself here.
 */
export const sections = [
  { href: '/', label: 'Home', icon: <HouseIcon /> },
  { href: '/companies', label: 'Companies', icon: <Building2Icon /> },
  { href: '/contacts', label: 'Contacts', icon: <UsersIcon /> },
  { href: '/deals', label: 'Deals', icon: <BriefcaseIcon /> },
  {
    href: '/tasks',
    label: 'Tasks',
    icon: <ListChecksIcon />,
    badge: <OverdueTasksBadge />,
  },
  { href: '/team', label: 'Team', icon: <UsersRoundIcon /> },
];
