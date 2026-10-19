import { defineConfig } from 'vitepress';
import type MarkdownIt from 'markdown-it';

const repo = 'https://github.com/snuffish/hallucinate';
const demo = 'https://snuffish.github.io/hallucinate/';

// The docs are written to be read on GitHub, so some links leave docs/ (../README.md, ../PERF.md, …) or point into
// folders the site leaves out. On the site, the README link goes to the docs home and the rest go to GitHub. Their
// <img src="screenshots/…"> tags get a leading ./ so Vite bundles the images instead of reading them as packages.
const excluded = ['agents/', 'research/'];

function siteLinks(md: MarkdownIt) {
  md.core.ruler.push('site-links', (state) => {
    const page = state.env.relativePath as string; // e.g. 'audio.md' or 'adr/0001-….md'
    for (const token of state.tokens) {
      if (token.type === 'html_block') token.content = token.content.replace(/src="(?![a-z]+:|[./])/gi, 'src="./');
      for (const child of token.children ?? []) {
        if (child.type === 'html_inline') child.content = child.content.replace(/src="(?![a-z]+:|[./])/gi, 'src="./');
        if (child.type !== 'link_open') continue;
        const href = child.attrGet('href');
        if (!href || /^[a-z]+:|^#|^\//i.test(href)) continue;
        const [path = '', hash = ''] = href.split(/(?=#)/);
        const target = new URL(path, `file:///docs/${page}`).pathname.replace(/^\//, ''); // repo-relative
        if (target === 'README.md') child.attrSet('href', `/${hash}`);
        else if (!target.startsWith('docs/') || excluded.some((dir) => target.startsWith(`docs/${dir}`)))
          child.attrSet('href', `${repo}/blob/main/${target}${hash}`);
      }
    }
  });
}

export default defineConfig({
  title: 'Hallucinate',
  description: 'Psychedelic, audio-reactive WebGL visuals for your music',
  // The Pages build is served from /hallucinate/, with the app at its root and the docs under docs/.
  base: `${process.env.BASE_PATH || '/'}docs/`,
  outDir: '../dist/docs',
  srcExclude: excluded.map((dir) => `${dir}**`),
  cleanUrls: true,
  lastUpdated: true,
  head: [['meta', { name: 'theme-color', content: '#ff4fd8' }]],
  markdown: { config: siteLinks },
  themeConfig: {
    nav: [
      { text: 'Guide', link: '/audio' },
      { text: 'Decisions', link: '/adr/0001-replace-all-built-in-scenes' },
      { text: 'Try the demo', link: demo },
    ],
    sidebar: [
      {
        text: 'Using Hallucinate',
        items: [
          { text: 'Audio', link: '/audio' },
          { text: 'Scenes & the library', link: '/scenes' },
          { text: 'Code editor', link: '/editor' },
          { text: 'Visual maker', link: '/visual-maker' },
          { text: 'Media', link: '/media' },
          { text: 'Studio & projector', link: '/studio' },
          { text: 'AI assistant', link: '/assistant' },
          { text: 'Interface', link: '/interface' },
          { text: 'Settings', link: '/settings' },
          { text: 'Back up', link: '/backup' },
          { text: 'Keys', link: '/keys' },
          { text: 'Desktop app & web demo', link: '/desktop' },
        ],
      },
      {
        text: 'Developing',
        items: [
          { text: 'Development', link: '/development' },
          { text: 'Reference clips', link: '/reference-clips' },
        ],
      },
      {
        text: 'Decisions (ADRs)',
        items: [
          { text: '0001 · Replace every built-in scene', link: '/adr/0001-replace-all-built-in-scenes' },
          { text: '0002 · The Look serves the laser set', link: '/adr/0002-the-look-serves-the-laser-set' },
          { text: '0003 · Effects belong to the show scene', link: '/adr/0003-effects-belong-to-the-show-scene' },
          { text: '0004 · Palettes are hues on the laser wheel', link: '/adr/0004-palettes-are-hues-on-the-laser-wheel' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: repo }],
    editLink: { pattern: `${repo}/edit/main/docs/:path`, text: 'Edit this page on GitHub' },
    search: { provider: 'local' },
    outline: [2, 3],
  },
});
