# FlavorForge

FlavorForge is a zero-dependency, offline culinary chemistry and reaction kinetics notebook built as a single-page web application. Inspired by Harold McGee's *On Food and Cooking* and *Modernist Cuisine*, it models the rate laws behind crust browning, starch gelatinization, dough fermentation, and espresso extraction so you can adjust a physical parameter, inspect the governing curve, and print a ruled bench formula sheet.

Built for Hack Club culinary engineering programs:

- [FlavorTown](https://flavortown.hackclub.com)
- [Boba Drops / Fraps](https://fraps.hackclub.com)

## Mathematical Models

| Notebook Section | Phenomenon | Governing Equation |
| --- | --- | --- |
| 1. Maillard Kinetics | Thermal activation of non-enzymatic browning | `k(T) = A * exp(-Ea / (R * T))` (Arrhenius), `Q10`, first-order conversion `X(t) = 1 - exp(-k*t)`, half-life `ln(2)/k`, and hydration-shifted onset `T_onset(H) = 120 + 0.55 * H` |
| 2. Starch & Fermentation | Granule swelling and yeast metabolism | Hydration-shifted gelatinization sigmoid `alpha(T, H) = 1 / (1 + exp(-s * (T - Tm(H))))` across tapioca, wheat, potato, and rice starches; Arrhenius yeast growth coupled with a 46 deg C thermal denaturation cutoff |
| 3. Espresso Extraction | Solubles yield vs burr particle size | Decreasing Hill equation `E(g) = Emin + (Emax - Emin) / (1 + (g / g0)^p)` paired with a 200-iteration binary bisection solver (`solveGrindForYield`) |
| 4. Bench Formula Sheet | Baker's percentage scaling | Individual ingredient mass `w_i = w_flour * P_i / 100`, hydration ratio, and total batch yield |
| 5. Phase Diagrams | Two-dimensional regime maps | Standalone printable SVG maps for Maillard browning regimes, starch crystallinity transitions, and espresso extraction |
| 6. Recipe JSON | Deterministic serialization | Strict schema validation (`schema: "flavorforge/recipe"`, `version: 1`) |

## Repository Layout

| File | Purpose |
| --- | --- |
| `index.html` | Culinary laboratory notebook markup |
| `style.css` | Warm alabaster parchment (`#FAF6F0`) and espresso ink (`#1E1916`) typography, terracotta and sage accents, print stylesheet |
| `app.js` | Interactive SVG curve and phase-diagram renderer, crosshair readouts, and JSON state management |
| `kinetics.js` | Pure UMD mathematical core (`window.FlavorForge` in browser, `module.exports` in Node.js) |
| `test.js` | 33 automated verification tests (`node --test test.js`) |
| `LICENSE` | MIT |

## Running Locally

Open `index.html` in any browser with no build step or server required, or run the Node.js verification suite:

```bash
node --test test.js
```

## License

MIT. See [LICENSE](LICENSE).
