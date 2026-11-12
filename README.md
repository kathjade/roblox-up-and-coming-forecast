# Roblox Up-and-Coming Forecast

Deterministic, standard-library-only Node.js forecaster for make.fun's Roblox Up-and-Coming chart bounty. It estimates place probabilities from the final chart's current ranks and shrunk recent rank velocity, while widening uncertainty for the 30-hour representative horizon. Probabilities are intentionally spread across currently observed games; the remaining mass accounts for entrants not yet on the recorded chart.

## Run

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
```

The program reads `task.json` and `history.ndjson` and writes the requested forecast file (normally `/output/forecast.json`). It uses no network, package installs, or non-standard libraries.

## Backtest note

The public practice history is sparse (34 snapshots, usually several hours apart) and its 72-hour scored sample has only 10 reads. On rolling pairs of available history snapshots, a soft rank distribution with temporal rank diffusion improved average log score over a concentrated persistence forecast; the 30-hour rank trend is heavily shrunk because short surges are noisy and the final scored horizon is much longer than the observed intervals.

The supplied history's source and archive license are documented in the official kit's `input/NOTICE.txt`.
