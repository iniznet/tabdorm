<script lang="ts">
  import Toggle from '@/lib/ui/controls/Toggle.svelte';
  import NumberField from '@/lib/ui/controls/NumberField.svelte';
  import SelectField from '@/lib/ui/controls/SelectField.svelte';
  import { ruleToRegExp } from '@/core/auto-route';
  import { VALID_GROUP_COLORS, type TabDormConfig } from '@/types';

  interface Props {
    config: TabDormConfig;
    onChange: (mutate: (draft: TabDormConfig) => void) => void;
  }

  let { config, onChange }: Props = $props();

  let patternDraft = $state('');
  let patternError = $state('');
  let titleDraft = $state('');

  const POLICY_OPTIONS = [
    { value: 'cooperative', label: 'Cooperative (shield whitelist only)' },
    { value: 'exclusive', label: 'Exclusive (shield everything)' },
    { value: 'custom_shield', label: 'Custom shield (shield whitelist only)' },
  ] as const;

  function addPattern(): void {
    const pattern = patternDraft.trim();
    if (pattern === '') return;
    if (ruleToRegExp(pattern) === null) {
      patternError = 'Invalid pattern — it would never match. Try "*.example.com/*" or "regexp:^https?:\\/\\/api\\."';
      return;
    }
    if (config.suspension.exemptions.urlPatterns.includes(pattern)) {
      patternError = 'That pattern is already whitelisted.';
      return;
    }
    onChange((draft) => {
      draft.suspension.exemptions.urlPatterns = [...draft.suspension.exemptions.urlPatterns, pattern];
    });
    patternDraft = '';
    patternError = '';
  }

  function removePattern(pattern: string): void {
    onChange((draft) => {
      draft.suspension.exemptions.urlPatterns = draft.suspension.exemptions.urlPatterns.filter((p) => p !== pattern);
    });
  }

  function toggleGroupColor(color: (typeof VALID_GROUP_COLORS)[number]): void {
    onChange((draft) => {
      const colors = draft.suspension.exemptions.protectedGroupColors;
      draft.suspension.exemptions.protectedGroupColors = colors.includes(color)
        ? colors.filter((c) => c !== color)
        : [...colors, color];
    });
  }

  function addTitle(): void {
    const title = titleDraft.trim();
    if (title === '') return;
    onChange((draft) => {
      if (!draft.suspension.exemptions.protectedGroupTitles.includes(title)) {
        draft.suspension.exemptions.protectedGroupTitles = [...draft.suspension.exemptions.protectedGroupTitles, title];
      }
    });
    titleDraft = '';
  }
</script>

<section id="suspension" class="scroll-mt-6 rounded-xl border border-line bg-raised p-5">
  <h2 class="text-xs font-semibold uppercase tracking-wider text-dim">Suspension</h2>
  <p class="mt-1 text-xs text-faint">Native tab discarding — sleeping tabs keep their slot, title, and favicon while Chrome frees their memory.</p>
  <div class="mt-2 divide-y divide-line/60">
    <Toggle
      checked={config.suspension.enabled}
      label="Enable automatic suspension"
      hint="The idle sweep discards tabs that have been inactive for the threshold below."
      onChange={(v) => onChange((d) => (d.suspension.enabled = v))}
    />
    <NumberField
      value={config.suspension.idleThresholdMinutes}
      label="Idle threshold"
      hint="Tabs inactive for longer than this get discarded by the sweep."
      min={1}
      max={10080}
      suffix="min"
      onChange={(v) => onChange((d) => (d.suspension.idleThresholdMinutes = v))}
    />
    <NumberField
      value={config.suspension.sweepIntervalMinutes}
      label="Sweep interval"
      hint="How often the background checks for idle tabs."
      min={1}
      max={1440}
      suffix="min"
      onChange={(v) => onChange((d) => (d.suspension.sweepIntervalMinutes = v))}
    />
    <SelectField
      value={config.suspension.memorySaverPolicy}
      label="Memory Saver interaction"
      hint="Exclusive shields every tab from Chrome's own Memory Saver; cooperative/custom_shield shield only whitelisted URLs."
      options={POLICY_OPTIONS}
      onChange={(v) => onChange((d) => (d.suspension.memorySaverPolicy = v as TabDormConfig['suspension']['memorySaverPolicy']))}
    />
    <NumberField
      value={Math.round(config.suspension.wakeCooldownMs / 1000)}
      label="Wake cooldown"
      hint="After the system wakes from sleep, no suspension runs for this long."
      min={0}
      max={3600}
      suffix="s"
      onChange={(v) => onChange((d) => (d.suspension.wakeCooldownMs = v * 1000))}
    />

    <div class="py-2.5">
      <p class="text-sm font-medium text-ink">Exemptions</p>
      <div class="mt-1 divide-y divide-line/40">
        <Toggle
          checked={config.suspension.exemptions.pinnedTabs}
          label="Never suspend pinned tabs"
          onChange={(v) => onChange((d) => (d.suspension.exemptions.pinnedTabs = v))}
        />
        <Toggle
          checked={config.suspension.exemptions.audibleTabs}
          label="Never suspend tabs playing audio"
          onChange={(v) => onChange((d) => (d.suspension.exemptions.audibleTabs = v))}
        />
        <Toggle
          checked={config.suspension.exemptions.activeInOtherWindows}
          label="Never suspend the active tab of other windows"
          onChange={(v) => onChange((d) => (d.suspension.exemptions.activeInOtherWindows = v))}
        />
      </div>
    </div>

    <div class="py-2.5">
      <p class="text-sm text-ink">URL whitelist</p>
      <p class="mt-0.5 text-xs text-faint">Match-pattern-lite wildcards, e.g. "*.github.com/*" — or "regexp:" followed by a raw regex. Whitelisted URLs are never auto-suspended.</p>
      <div class="mt-2 flex gap-2">
        <input
          class="min-w-0 flex-1 rounded-md border border-line bg-overlay px-2 py-1 text-xs text-ink placeholder:text-faint"
          placeholder="*.example.com/*"
          bind:value={patternDraft}
          onkeydown={(e) => {
            if (e.key === 'Enter') addPattern();
          }}
        />
        <button
          class="shrink-0 rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-strong"
          onclick={addPattern}>Add</button
        >
      </div>
      {#if patternError !== ''}<p class="mt-1 text-xs text-bad">{patternError}</p>{/if}
      {#if config.suspension.exemptions.urlPatterns.length > 0}
        <ul class="mt-2 flex flex-col gap-1">
          {#each config.suspension.exemptions.urlPatterns as pattern (pattern)}
            <li class="flex items-center gap-2 rounded-md bg-overlay px-2 py-1">
              <code class="min-w-0 flex-1 truncate text-xs text-dim">{pattern}</code>
              <button
                class="shrink-0 rounded px-1.5 text-xs text-bad hover:bg-line"
                aria-label="Remove pattern {pattern}"
                onclick={() => removePattern(pattern)}>✕</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>

    <div class="py-2.5">
      <p class="text-sm text-ink">Protected group colors</p>
      <p class="mt-0.5 text-xs text-faint">Tabs inside groups with these colors are never auto-suspended.</p>
      <div class="mt-2 flex flex-wrap gap-1.5">
        {#each VALID_GROUP_COLORS as color (color)}
          <button
            class="rounded-full border px-2.5 py-1 text-xs capitalize {config.suspension.exemptions.protectedGroupColors.includes(color)
              ? 'border-accent bg-accent/15 text-ink'
              : 'border-line text-faint hover:border-faint'}"
            aria-pressed={config.suspension.exemptions.protectedGroupColors.includes(color)}
            onclick={() => toggleGroupColor(color)}>{color}</button
          >
        {/each}
      </div>
    </div>

    <div class="py-2.5">
      <p class="text-sm text-ink">Protected group titles</p>
      <div class="mt-2 flex gap-2">
        <input
          class="min-w-0 flex-1 rounded-md border border-line bg-overlay px-2 py-1 text-xs text-ink placeholder:text-faint"
          placeholder="Work"
          bind:value={titleDraft}
          onkeydown={(e) => {
            if (e.key === 'Enter') addTitle();
          }}
        />
        <button
          class="shrink-0 rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-strong"
          onclick={addTitle}>Add</button
        >
      </div>
      {#if config.suspension.exemptions.protectedGroupTitles.length > 0}
        <ul class="mt-2 flex flex-wrap gap-1.5">
          {#each config.suspension.exemptions.protectedGroupTitles as title (title)}
            <li class="flex items-center gap-1 rounded-full bg-overlay px-2.5 py-1 text-xs text-dim">
              {title}
              <button
                class="text-bad hover:text-ink"
                aria-label="Remove protected title {title}"
                onclick={() =>
                  onChange((draft) => {
                    draft.suspension.exemptions.protectedGroupTitles =
                      draft.suspension.exemptions.protectedGroupTitles.filter((t) => t !== title);
                  })}>✕</button
              >
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  </div>
</section>
