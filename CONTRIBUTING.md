# Contributing to FlavorForge

Thanks for your interest in FlavorForge. This project is a zero-dependency,
offline culinary chemistry and reaction kinetics notebook that models crust
browning, starch gelatinization, dough fermentation, and espresso extraction.
Contributions are welcome across the physical models, the notebook UI, and the
bench formula sheet output.

## Ground rules

- Be respectful and constructive. This project follows the Contributor
  Covenant, found in `CODE_OF_CONDUCT.md`.
- Keep the project dependency free. No `node_modules`, build steps, or runtime
  libraries. Node builtins and the `node:test` runner are fine.
- Keep the notebook offline. No network requests, no CDN assets, no analytics.
- Physical models need a source. If you add or change a rate law, cite the
  textbook, paper, or empirical study behind it and state the valid range.

## Development setup

Requirements:

- Node.js 22 or newer (the test runner is `node --test`)
- A modern browser for manual verification

```sh
git clone https://github.com/draarivpatel-ui/flavorforge.git
cd flavorforge
node --test
```

To open the notebook locally:

```sh
python3 -m http.server 8000
# then open http://localhost:8000/
```

## How the code is organised

| File | Role |
| --- | --- |
| `kinetics.js` | The physical model core: Arrhenius rates, gelatinization, fermentation, extraction curves, and unit conversions |
| `app.js` | UI wiring: parameter controls, curve plotting, and the formula sheet |
| `index.html`, `style.css` | The notebook shell and its styling |
| `test.js` | The test suite |

`kinetics.js` is a UMD module, so `require('./kinetics.js')` works in Node and
`window.FlavorForge` is available in the browser. Match that pattern in new
modules.

## Coding standards

- Use 2-space indentation and single quotes, matching the surrounding file.
- Prefer `const`, and use `let` only when reassignment is required.
- Keep functions small and single purpose. Name them after what they do.
- No comments that restate the code. Comment the reason, the citation, or the
  valid range of the model.
- Treat em-dashes and en-dashes as a defect in prose and identifiers. Use
  commas, parentheses, or a plain hyphen instead.
- Never swallow errors silently. Fail loudly with an actionable message.
- Keep constants in one place per model, with units spelled out, and never
  inline a magic number inside a formula.

## Testing a physical model

Every model function needs a test against a closed-form or hand-computed value,
not a snapshot of the current output. Include the boundary behaviour: zero
activation energy, monotonic trends, and the point where the approximation
breaks down.

## Opening a pull request

1. Fork the repository and create a branch from `main`.
2. Make your change with tests. Every bug fix should include a regression test
  that fails before your fix.
3. Run the full suite locally: `node --test`.
4. Update documentation where a model, range, or default changed.
5. Open the PR against `main` with:
   - a short summary of what changed and why,
   - the commands you ran and their result,
   - screenshots for UI changes,
   - the citation and valid range for any physical model you touched.
6. Keep the PR small enough to review in one sitting, and respond to review
   promptly.

Commit messages: use a short imperative subject line under 72 characters. Put
the reasoning in the body, not the subject.

## Reporting bugs

Open an issue with the smallest reproduction you can manage: the parameters,
the steps you ran, what you expected, and what happened instead. Say which
published value you compared against when a number looks wrong. Security issues
follow `SECURITY.md` instead.
