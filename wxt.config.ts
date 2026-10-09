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
      'contextMenus',
    ],
    commands: {
      'tabdorm-suspend-others': {
        suggested_key: { default: 'Ctrl+Shift+S' },
        description: 'Suspend all inactive tabs in the current window',
      },
      'tabdorm-snapshot-now': {
        description: 'Take a session snapshot now',
      },
    },
    minimum_chrome_version: '116',
  },
});
