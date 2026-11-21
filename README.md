# FlavorForge

An offline culinary notebook with recipe scaling, illustrative reaction models, SVG plots, and portable recipe JSON. Open [index.html](index.html) directly in a browser. No build step, dependency install, or server is required.

## Notebook features

- Maillard rate, relative rate, Q10, and first-order half-life readouts.
- An exact staged browning analyzer with Steady surface and Warm then hot presets.
- Tapioca, wheat, potato, and rice gelatinization curves, including a selected-profile midpoint and 90% temperature.
- A fermentation model whose relative dough volume starts at 1 and reaches 2 at its calibrated doubling time.
- A grind/yield model and bisection solver with explicit reachable-range feedback.
- A starter inspector that includes the starter's flour and water in effective hydration and flour already fermented.
- A printable formula card, labeled regime maps, self-contained SVG downloads, and validated recipe JSON.
- A pinned-reference comparison that snapshots the current configuration and draws ghost curves and markers beside the live ones on every chart.
- Linked hydration controls, keyboard tab navigation, optional themes, and visible input/import errors.

These are teaching approximations. They do not predict a particular food, dough culture, or espresso machine. Thermal models omit heat transfer, moisture loss, pH, and measured ingredient-specific parameters. Maillard browning and sugar caramelization are different reactions. The espresso curve uses grind size only; brew temperature is stored and printed in the recipe.

## Models

| Model | Computation |
| --- | --- |
| Arrhenius rate | `k = A * exp(-Ea / (R * T))`, with Kelvin temperature and R = 8.314462618 J/(mol K) |
| Browning progress | `X = -expm1(-k * t)`; inverse time uses log1p to preserve small conversion values |
| Default browning calibration | Ea = 100000 J/mol; A is chosen for a 20 minute half-life at 150 C |
| Gelatinization | Logistic fraction around `Tm = baseTmC - waterShiftC * H / 100`; H is limited to 0 to 100% |
| Fermentation | Arrhenius rate with a sigmoid denaturation factor centered at 46 C; reference doubling time is 120 minutes at 28 C |
| Relative dough volume | `V = 4 / (1 + 3 * exp(-ln(3) * t / doublingTime))`; V(0) = 1, V(dt) = 2, V(2dt) = 3 |
| Espresso yield | `E = 14 + 10 / (1 + (grindMicrons / 600)^2)`, inverted with up to 200 bisection iterations |
| Ingredient scaling | `mass = baseFlourMass * bakerPercentage / 100` |

All temperatures, rates, model parameters, and weights must be finite. Invalid domains and numerical overflow are rejected. Curve samplers require 2 to 10000 points and include their endpoints.

### Browning schedules

Stages specify a constant surface temperature and a positive duration. The analyzer integrates dose exactly as `sum(k(T) * duration)` and reports conversion at each stage boundary and the time of the first 50% crossing.

| Preset | Stages |
| --- | --- |
| Steady surface | 180 C for 10 minutes |
| Warm then hot | 140 C for 5 minutes, then 200 C for 5 minutes |

You can edit the stage array and select Analyze schedule. Temperatures must be from 0 to 300 C, with 1 to 32 stages and no more than 1440 minutes total. The selected activation energy controls the result. Schedules are separate from recipe JSON.

### Starter and hydration math

The formula's hydrationPct is added water as a percentage of the base flour. The starter inspector also counts flour and water contained in the starter.

For the default 1000 g base flour, 70% added water, 2% salt, and 20% starter at 100% hydration:

| Quantity | Result |
| --- | --- |
| Added water | 700 g |
| Starter flour / water | 100 g / 100 g |
| Total flour / water | 1100 g / 800 g |
| Hydration including starter | 72.73% |
| Flour already fermented | 9.09% |
| Total batch | 1920 g |

Thermal plots use the added-water ratio. The inspector and printed card report hydration including the starter. The boba example contains 500 g dry base, 62% added water, no salt, and no starter.

## Recipe JSON

The schema is `flavorforge/recipe`, version 1. Styles are sourdough, boba, espresso, and hybrid. Unknown fields are dropped, key order is stable, and failed imports leave the current notebook intact.

| Field | Accepted range |
| --- | --- |
| flourGrams | 1 to 10000 |
| hydrationPct | 0 to 100 |
| saltPct | 0 to 10 |
| starterPct | 0 to 100 |
| starterHydrationPct | 0 to 200 |
| targetYieldPct | 0 to 100 |
| grindMicrons | 180 to 1400 |
| brewTempC | 80 to 100 |
| name | Nonempty text without control characters, at most 120 characters |
| notes | Text, at most 4000 characters |

Earlier version 1 cards without starterHydrationPct default to 100%. JSON imports are limited to 64 KiB. A valid target yield can still be outside the grind model's reachable range; the solver then reports the range and disables Apply. Imported fractional slider values are preserved. Thermal view settings and schedules are not part of the recipe document.

## Node usage

```js
const F = require('./kinetics.js');
const recipe = F.createRecipe();
const dough = F.analyzeDoughRecipe(recipe);
console.log(dough.totalWeight); // 1920
console.log(dough.effectiveHydrationPct); // 72.72727272727273
const schedule = F.browningSchedule([{ tempC: 150, durationMin: 20 }]);
console.log(schedule.fraction); // approximately 0.5
const restored = F.importRecipe(F.exportRecipe(recipe));
```

## Verification

Run from this repository:

```sh
node --test
```

**85 tests pass, with zero failures or skipped tests.** Coverage includes rate identities, finite-number validation, tiny conversions, underflow regressions, all curve endpoints, recipe bounds and Unicode round-trips, starter mass conservation, fermentation doubling, solver endpoints, exact schedule integration, reserved ingredient names, and exact regime boundaries.

The UI tests execute the actual scripts against [dom-harness.cjs](dom-harness.cjs), with fixed time, optional blocked storage, DOM events, and Blob downloads. They verify HTML references, all four starch series, control synchronization, multiword title editing, fractional imports, invalid-input recovery, keyboard tabs, SVG label styles, schedule actions, pinned-reference ghost series, the dough-temperature phase marker, and clipboard fallback. They do not perform browser layout or visual rendering.

| File | Purpose |
| --- | --- |
| [kinetics.js](kinetics.js) | Pure UMD models, recipe validation, and analysis APIs |
| [app.js](app.js) | Controls, plots, cards, schedule analyzer, and exports |
| [index.html](index.html), [style.css](style.css) | Notebook, responsive layout, and print styles |
| [test.js](test.js), [regression.test.js](regression.test.js), [ui.test.js](ui.test.js) | Automated verification |

## License

MIT. See [LICENSE](LICENSE).
