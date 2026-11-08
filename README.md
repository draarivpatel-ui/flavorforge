# FlavorForge

A zero-dependency, offline-first scientific and culinary reaction simulator and fermentation kinetics calculator, built as a single-page web app. FlavorForge models the chemistry behind cooking so a curious maker can change a number, watch a curve move, and print a lab-style recipe card.

Built for Hack Club YSWS programs:

- [FlavorTown](https://flavortown.hackclub.com) - cook something, ship it.
- [Boba Drops / Fraps](https://fraps.hackclub.com) - drinks, pearls and everything in between.

## What it models

| Module | Science | Key formula |
| --- | --- | --- |
| Maillard browning | Thermal activation of browning reactions | `k = A * exp(-Ea / (R * T))` (Arrhenius), Q10, first-order conversion, half-life |
| Starch gelatinization | Granule swelling / loss of crystallinity | Logistic degree of gelatinization with a hydration-shifted midpoint `Tm` |
| Dough fermentation | Yeast activity vs temperature | Arrhenius growth times a thermal-denaturation cutoff, logistic dough rise, doubling time |
| Espresso extraction | Yield vs grind size | Decreasing Hill curve plus a bisection solver for grind-to-target-yield |
| Recipe math | Baker's percentages | Hydration, ingredient scaling, total yield |
| Recipe data | Portable JSON | Validated import / export with a fixed schema and version |

All models are compact, documented teaching approximations, not production process controls. Real kinetics depend on pH, water activity, sugar type, cultivar, roast, and dozens of other variables. The point here is to make the relationships visible and tweakable.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | The whole app: layout, controls, inline chart renderer, SVG phase diagrams, recipe card, JSON tools |
| `kinetics.js` | Pure UMD science module. Works in Node (CommonJS) and in the browser (`window.FlavorForge`). No dependencies |
| `style.css` | Light and dark themes, accessible chart palette, responsive layout, print styles |
| `test.js` | Node test suite (`node --test test.js`) |
| `README.md` | This file |
| `LICENSE` | MIT |

There is no build step, no package manager, no network calls, and no external assets. Open `index.html` directly, or serve the folder from any static host (including GitHub Pages).

## Run it

The simplest option:

```
open index.html
```

Or serve the folder locally:

```
python3 -m http.server 8000
# then visit http://localhost:8000
```

Everything runs inside the browser. Once loaded, it keeps working with no connection.

## Run the tests

```
node --test test.js
```

The suite verifies:

- Arrhenius rate, rate ratio, Q10, activation-energy recovery, first-order conversion and half-life
- Hydration and baker's-percentage math, recipe scaling and total yield
- Gelatinization and fermentation curve behavior
- Espresso extraction yield, the extraction-window classifier, and the grind solver (including inversion accuracy and out-of-range rejection)
- Recipe JSON import / export, schema validation, version checks, and error handling

## Using the app

Six tabs, each a small lab:

1. **Reaction Lab** - slide the surface temperature and activation energy to see the relative Maillard browning rate, Q10, half-life, and the hydration-dependent browning onset. A single-series rate-vs-temperature chart carries a crosshair tooltip and a data table.
2. **Dough & Starch** - compare gelatinization curves for tapioca (boba), wheat (sourdough), and potato starch at your hydration, then watch a logistic dough-rise curve at the chosen fermentation temperature. Three-series charts include a legend, hover tooltip, and table view.
3. **Espresso** - move the grind slider to see extraction yield and its tasting note, set a target yield, and let the solver find the grind that hits it. A shaded band marks the balanced 18 to 22 percent window.
4. **Recipe Card** - a print-ready lab card with the scaled formula, process targets, an embedded phase snapshot, and your notes. Use **Print recipe card** for paper or **Download phase snapshot SVG** for a standalone vector.
5. **Phase Diagrams** - three printable SVG region maps (browning regimes, starch gelatinization, extraction compass). Each region is labelled in place, so the diagram is readable without relying on color.
6. **Data / JSON** - copy, download, or paste recipe JSON. Import validates the schema, version, and every field before it changes the lab.

The **Dark mode** toggle is selected for the dark surface separately (its own palette steps), not an automatic inversion. Charts ship direct labels, legends, hover tooltips, and data tables so identity and values never depend on color alone.

## Recipe JSON schema

```json
{
  "schema": "flavorforge/recipe",
  "version": 1,
  "name": "House Sourdough and Boba Lab Card",
  "style": "sourdough",
  "flourGrams": 1000,
  "hydrationPct": 70,
  "saltPct": 2,
  "starterPct": 20,
  "targetYieldPct": 20,
  "grindMicrons": 600,
  "brewTempC": 93,
  "notes": "Log observations here."
}
```

`style` is one of `sourdough`, `boba`, `espresso`, `hybrid`. All numeric fields must be finite and non-negative. Export drops unknown keys so round-trips are stable; import rejects wrong schema, wrong version, malformed JSON, and invalid fields with a clear message.

## Accessibility and visualization

The three categorical chart colors were validated against both light and dark chart surfaces for CVD separation, normal-vision separation, lightness, chroma, and contrast. Because one light-mode hue sits below a 3:1 contrast ratio, every chart also ships visible direct labels, a legend (for two or more series), a hover tooltip, and a toggleable data table. Region maps label every regime in place. Print styles keep charts legible on paper.

## License

MIT. See `LICENSE`.
