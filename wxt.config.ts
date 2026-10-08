import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-svelte'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  manifest: {
    name: 'TabDorm',
    description:
      'Native tab suspension, tab-group auto-routing, and fast session snapshots. No placeholder pages.',
    permissions: [
      'tabs',
      'tabGroups',
      'storage',
      'alarms',
      'downloads',
      'webNavigation',
      'idle',
      'sidePanel',
    ],
    minimum_chrome_version: '116',
  },
});
