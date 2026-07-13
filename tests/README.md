# MapMaker tests

Phase 2 keeps MapMaker on the v1 authoring format. This standard-library suite protects canonical map round-trips and the formal `Campidoglio` fixture while the game-side v2 contract and validator stabilize.

Run:

```text
python -m unittest discover -s tests -v
```

The tests do not write to the configured game project and do not depend on browser state.
