# TabDorm brand mark

A real browser tab at rest: flat bottom, rounded top, and a crescent of night
sitting inside it. Two shapes, two colours, nothing else.

## Why this mark

The product's mechanism is the message. TabDorm never replaces a page with a
placeholder and never rewrites a URL: a sleeping tab is still a real tab, just
put down. So the mark is the tab itself, holding night, rather than a ghost, a
broken chain, a pillow, or a literal "Z".

- **Tab silhouette** - flat bottom and rounded top corners are what a tab looks
  like in Chrome's strip; a generic rounded square is not a tab and was rejected.
- **Crescent** - the sleep state, drawn in the same crescent the panel already
  uses for its suspended-tab count, so the mark and the UI speak one language.
- **Two colours** - tab in the awake amber, crescent in the on-awake near-black
  (both existing tokens). No gradient, no third colour, no outline ring.

## Files

| File | Use |
|---|---|
| `tabdorm-mark.svg` | Primary mark, 24x24 grid, two-tone. Works on light and dark chrome. |
| `tabdorm-mark-mono.svg` | Single colour; the crescent is cut through. Use inline with `color` set, or hard-code the fill. |
| `tabdorm-lockup-dark.svg` | Mark + "TabDorm" for dark surfaces. |
| `tabdorm-lockup-light.svg` | Mark + "TabDorm" for light surfaces. |

Extension icons are generated, never hand-edited:

```
npm run icons        # public/icon/{16,32,48,128}.png from tabdorm-mark.svg
```

The script asserts each PNG is exactly the size the manifest promises.

## Rules

- **Clear space**: leave at least a quarter of the mark's height empty on every
  side. Nothing overlaps the tab's flat bottom.
- **Minimum size**: 16 px for the mark (it is tuned for a 16 px toolbar slot),
  24 px for the lockup at the current wordmark scale.
- **Do not** outline the crescent, stretch the mark, round its flat bottom, add
  a shadow or gradient, or set the crescent to a third colour. On light
  surfaces the crescent stays near-black; it does not become white.
- **Do not change the tab's top corner radius.** It is 5.2 units of 24; the mark
  reads as a keyhole above that and as a folder below it.
- The wordmark is **live text**, deliberately: it uses the same platform UI stack
  as the product, so the lockup matches the panel. Do not outline-convert it.
  In a non-browser renderer without that stack, supply a suitable sans fallback.

## Colour

| Part | Token | Value |
|---|---|---|
| Tab | the awake token | `#e9b46a` |
| Crescent | the on-awake token | `#17120a` |

The mark is rendered with masks (`td-crescent`, `td-cut`), so **if you inline it
next to itself, rename the ids** - duplicate ids in one document collide.

Contrast: the two-tone construction is what keeps the icon legible on both
Chrome toolbars. Amber alone measures 1.68:1 against Chrome's light toolbar
(`#f1f3f4`), which is too weak for a 16 px icon; the near-black crescent gives
the icon a hard internal edge in light mode, and in dark mode the amber body
carries it while the crescent merges into the toolbar. Neither the amber body
nor the crescent was chosen by taste alone.
