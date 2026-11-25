import starlight from '@astrojs/starlight';
import { defineConfig } from 'astro/config';
import starlightLinksValidator from 'starlight-links-validator';

export default defineConfig({
  site: 'https://crobinson42.github.io',
  base: '/lattice-cms',
  integrations: [
    starlight({
      title: 'Lattice CMS',
      description:
        'Collections that compile into hexok use cases and a ts-pf contract, for internal tools, CRMs, admin panels and portals.',
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/crobinson42/lattice-cms',
        },
      ],
      plugins: [starlightLinksValidator()],
      sidebar: [
        { label: 'Start', items: ['index', 'getting-started'] },
        {
          label: 'Packages',
          items: [{ autogenerate: { directory: 'packages' } }],
        },
      ],
    }),
  ],
});
