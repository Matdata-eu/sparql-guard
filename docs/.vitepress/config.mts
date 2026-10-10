import { defineConfig } from 'vitepress';

export default defineConfig({
  title: 'sparql-guard',
  description: 'Store-neutral access control for SPARQL endpoints, with policies written in SHACL.',
  base: process.env.DOCS_BASE ?? '/sparql-guard/',
  cleanUrls: true,
  // Links to the local playground only work on the reader's machine.
  ignoreDeadLinks: 'localhostLinks',
  lastUpdated: true,
  head: [['link', { rel: 'icon', href: `${process.env.DOCS_BASE ?? '/sparql-guard/'}shield.svg` }]],
  themeConfig: {
    logo: '/shield.svg',
    nav: [
      { text: 'Guide', link: '/guide/introduction' },
      { text: 'Reference', link: '/reference/policy-language' },
      { text: 'Playground', link: '/guide/playground' },
    ],
    sidebar: [
      {
        text: 'Introduction',
        items: [
          { text: 'What is sparql-guard?', link: '/guide/introduction' },
          { text: 'Getting started', link: '/guide/getting-started' },
          { text: 'Playground', link: '/guide/playground' },
          { text: 'How it works', link: '/guide/how-it-works' },
        ],
      },
      {
        text: 'Guide',
        items: [
          { text: 'Writing policies', link: '/guide/writing-policies' },
          { text: 'Policy recipes', link: '/guide/recipes' },
          { text: 'Authentication', link: '/guide/authentication' },
          { text: 'Deployment', link: '/guide/deployment' },
          { text: 'Triple stores', link: '/guide/triple-stores' },
          { text: 'SPARQL 1.2', link: '/guide/sparql-1-2' },
          { text: 'Using it as a library', link: '/guide/library' },
          { text: 'Security model', link: '/guide/security-model' },
          { text: 'Troubleshooting', link: '/guide/troubleshooting' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'Policy language', link: '/reference/policy-language' },
          { text: 'Configuration', link: '/reference/configuration' },
          { text: 'HTTP API', link: '/reference/http-api' },
          { text: 'Command line', link: '/reference/cli' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/Matdata-eu/sparql-guard' }],
    editLink: {
      pattern: 'https://github.com/Matdata-eu/sparql-guard/edit/main/docs/:path',
    },
    search: { provider: 'local' },
    footer: { message: 'Released under the Apache-2.0 license.' },
  },
});
