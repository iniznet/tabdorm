<script lang="ts">
  import Toggle from '@/lib/ui/controls/Toggle.svelte';
  import NumberField from '@/lib/ui/controls/NumberField.svelte';
  import { ruleToRegExp } from '@/core/auto-route';
  import { VALID_GROUP_COLORS, type AutoRouteRule, type GroupColor, type TabDormConfig } from '@/types';

  interface Props {
    config: TabDormConfig;
    onChange: (mutate: (draft: TabDormConfig) => void) => void;
  }

  let { config, onChange }: Props = $props();

  let newPattern = $state('');
  let newTitle = $state('');
  let newColor = $state<GroupColor>('grey');
  let newAutoCollapse = $state(false);
  let addError = $state('');

  function ruleOf(draft: TabDormConfig, id: string): AutoRouteRule | undefined {
    return draft.groups.routing.rules.find((r) => r.id === id);
  }

  function patchRule(id: string, patch: Partial<AutoRouteRule>): void {
    onChange((draft) => {
      const rule = ruleOf(draft, id);
      if (rule !== undefined) Object.assign(rule, patch);
    });
  }

  function moveRule(id: string, direction: -1 | 1): void {
    onChange((draft) => {
      const rules = draft.groups.routing.rules;
      const index = rules.findIndex((r) => r.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= rules.length) return;
      const [removed] = rules.splice(index, 1);
      rules.splice(target, 0, removed as AutoRouteRule);
    });
  }

  function removeRule(id: string): void {
    onChange((draft) => {
      draft.groups.routing.rules = draft.groups.routing.rules.filter((r) => r.id !== id);
    });
  }

  function addRule(): void {
    const pattern = newPattern.trim();
    const title = newTitle.trim();
    if (pattern === '' || title === '') {
      addError = 'Both a URL pattern and a group title are required.';
      return;
    }
    if (ruleToRegExp(pattern) === null) {
      addError = 'Invalid pattern — it would never match. Try "*.example.com/*".';
      return;
    }
    onChange((draft) => {
      draft.groups.routing.rules = [
        ...draft.groups.routing.rules,
        { id: crypto.randomUUID(), enabled: true, pattern, groupTitle: title, groupColor: newColor, autoCollapse: newAutoCollapse },
      ];
    });
    newPattern = '';
    newTitle = '';
    addError = '';
  }
</script>

<section id="groups" class="scroll-mt-6 rounded-xl border border-line bg-raised p-5">
  <h2 class="text-xs font-semibold uppercase tracking-wider text-dim">Tab groups</h2>
  <p class="mt-1 text-xs text-faint">Auto-routing sorts tabs into native Chrome tab groups as you browse — rules are evaluated top to bottom.</p>
  <div class="mt-2 divide-y divide-line/60">
    <Toggle
      checked={config.groups.collapseOnSwitch}
      label="Collapse the previous group when you switch groups"
      hint="Activating a tab outside its group folds that group back up."
      onChange={(v) => onChange((d) => (d.groups.collapseOnSwitch = v))}
    />
    <Toggle
      checked={config.groups.suspendOnGroupCollapse}
      label="Suspend all tabs when a group collapses"
      hint="Applies to every collapse source — automatic or your own manual collapse."
      onChange={(v) => onChange((d) => (d.groups.suspendOnGroupCollapse = v))}
    />
    <NumberField
      value={config.groups.autoCollapseOnIdleMinutes}
      label="Auto-collapse idle groups"
      hint="0 disables auto-collapse."
      min={0}
      max={10080}
      suffix="min"
      onChange={(v) => onChange((d) => (d.groups.autoCollapseOnIdleMinutes = v))}
    />
    <Toggle
      checked={config.groups.routing.enabled}
      label="Enable domain auto-routing"
      onChange={(v) => onChange((d) => (d.groups.routing.enabled = v))}
    />
    <Toggle
      checked={config.groups.routing.reRouteAlreadyGrouped}
      label="Re-route tabs that are already grouped"
      hint="Otherwise a tab keeps whatever group it is in once grouped."
      onChange={(v) => onChange((d) => (d.groups.routing.reRouteAlreadyGrouped = v))}
    />
    <Toggle
      checked={config.groups.routing.autoGroupByDomain}
      label="Auto-group sites without a rule"
      hint="Tabs group by site automatically (title + color from the domain); rules below override it."
      onChange={(v) => onChange((d) => (d.groups.routing.autoGroupByDomain = v))}
    />
    <NumberField
      value={config.groups.routing.minTabsPerGroup}
      label="Minimum tabs per group"
      hint="A site only becomes a group with this many tabs in one window. Rules ignore this."
      min={1}
      max={50}
      suffix="tabs"
      onChange={(v) => onChange((d) => (d.groups.routing.minTabsPerGroup = v))}
    />
    <Toggle
      checked={config.groups.routing.bucketLonelyTabs}
      label="Collect lonely tabs into an Ungrouped group"
      hint="Below the minimum, tabs gather in one grey group instead of staying loose. They leave it automatically once their site qualifies."
      onChange={(v) => onChange((d) => (d.groups.routing.bucketLonelyTabs = v))}
    />

    <div class="py-2.5">
      <div class="flex items-center justify-between">
        <p class="text-sm text-ink">Routing rules <span class="text-faint">({config.groups.routing.rules.length})</span></p>
      </div>

      <ul class="mt-2 flex flex-col gap-2">
        {#each config.groups.routing.rules as rule, index (rule.id)}
          <li class="rounded-lg border border-line bg-overlay p-2.5">
            <div class="flex items-center gap-2">
              <input
                type="checkbox"
                checked={rule.enabled}
                aria-label="Rule enabled"
                class="h-3.5 w-3.5 accent-[var(--color-accent)]"
                onchange={(e) => patchRule(rule.id, { enabled: e.currentTarget.checked })}
              />
              <input
                class="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink font-mono placeholder:text-faint"
                value={rule.pattern}
                placeholder="*.example.com/*"
                onchange={(e) => patchRule(rule.id, { pattern: e.currentTarget.value.trim() })}
              />
              <span class="flex shrink-0 gap-0.5">
                <button
                  class="grid h-6 w-6 place-items-center rounded text-faint hover:bg-line hover:text-ink disabled:opacity-30"
                  aria-label="Move rule up"
                  disabled={index === 0}
                  onclick={() => moveRule(rule.id, -1)}>↑</button
                >
                <button
                  class="grid h-6 w-6 place-items-center rounded text-faint hover:bg-line hover:text-ink disabled:opacity-30"
                  aria-label="Move rule down"
                  disabled={index === config.groups.routing.rules.length - 1}
                  onclick={() => moveRule(rule.id, 1)}>↓</button
                >
                <button
                  class="grid h-6 w-6 place-items-center rounded text-bad hover:bg-line"
                  aria-label="Delete rule"
                  onclick={() => removeRule(rule.id)}>✕</button
                >
              </span>
            </div>
            <div class="mt-2 flex items-center gap-2">
              <input
                class="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink placeholder:text-faint"
                value={rule.groupTitle}
                placeholder="Group title"
                onchange={(e) => patchRule(rule.id, { groupTitle: e.currentTarget.value.trim() })}
              />
              <select
                class="shrink-0 rounded-md border border-line bg-raised px-1.5 py-1 text-xs capitalize text-ink"
                value={rule.groupColor}
                aria-label="Group color"
                onchange={(e) => patchRule(rule.id, { groupColor: e.currentTarget.value as GroupColor })}
              >
                {#each VALID_GROUP_COLORS as color (color)}
                  <option value={color}>{color}</option>
                {/each}
              </select>
              <label class="flex shrink-0 items-center gap-1 text-xs text-dim">
                <input
                  type="checkbox"
                  checked={rule.autoCollapse === true}
                  class="h-3.5 w-3.5 accent-[var(--color-accent)]"
                  onchange={(e) => patchRule(rule.id, { autoCollapse: e.currentTarget.checked })}
                />
                auto-collapse
              </label>
            </div>
            {#if ruleToRegExp(rule.pattern) === null}
              <p class="mt-1 text-xs text-bad">Invalid pattern — this rule matches nothing until fixed.</p>
            {/if}
          </li>
        {/each}
      </ul>

      <div class="mt-3 rounded-lg border border-dashed border-line p-2.5">
        <p class="text-xs font-medium text-dim">Add rule</p>
        <div class="mt-2 flex items-center gap-2">
          <input
            class="min-w-0 flex-[2] rounded-md border border-line bg-raised px-2 py-1 text-xs font-mono text-ink placeholder:text-faint"
            placeholder="*.github.com/*"
            bind:value={newPattern}
          />
          <input
            class="min-w-0 flex-1 rounded-md border border-line bg-raised px-2 py-1 text-xs text-ink placeholder:text-faint"
            placeholder="Group title"
            bind:value={newTitle}
          />
        </div>
        <div class="mt-2 flex items-center gap-2">
          <select
            class="rounded-md border border-line bg-raised px-1.5 py-1 text-xs capitalize text-ink"
            bind:value={newColor}
            aria-label="New rule color"
          >
            {#each VALID_GROUP_COLORS as color (color)}
              <option value={color}>{color}</option>
            {/each}
          </select>
          <label class="flex items-center gap-1 text-xs text-dim">
            <input type="checkbox" bind:checked={newAutoCollapse} class="h-3.5 w-3.5 accent-[var(--color-accent)]" />
            auto-collapse
          </label>
          <button
            class="ml-auto rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-strong"
            onclick={addRule}>Add rule</button
          >
        </div>
        {#if addError !== ''}<p class="mt-1 text-xs text-bad">{addError}</p>{/if}
      </div>
    </div>
  </div>
</section>
