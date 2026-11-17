# token-radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/tamadung/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/tamadung/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

Launch Radar — a comps-fitted token launch radar. It reads a sealed DefiLlama snapshot, fits a size curve to the 128 protocols whose token already trades, ranks 181 pre-token protocols by implied value, and gives each one a farm plan netted to the dollar.

The verdict never guesses a launch chance: it shows the chance a launch would have to have to pay the plan. Farm pays at 1 launch in 10 in the hold, thin at 1 in 4, skip needs more. The board says skip 45 times — a radar that never says skip ranks nothing. Every row carries its uncertainty: a P25–P75 band from 200 bootstrap refits, a P10–P90 rank range, and a conservative read at the 25th percentile.

Validation is on the dashboard: four nested variants priced by fits that never saw the token, an 8-fold rank check, and a walk-forward test that fits before a date and tests on later launches. The weak parts are shown too — family and priors shrink the median miss but do not improve the ranking.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../input/snapshot.json
```

---

<sub>Entered on [make.fun](https://make.fun/?ref=tamadung&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
