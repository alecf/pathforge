# Densification Setup

This project uses non‑ML, in‑browser densification (MLS smoothing and interpolation). No model files are required.

## Usage

- The `densify` function auto-selects `mls`.
- You can explicitly select:
  - `method: 'mls'` for MLS smoothing on a grid (recommended)
  - `method: 'interpolation'` for simple nearest-neighbor interpolation

## Performance Tips

- Reduce `density` if the area is large.
- Use surface visualization for very large point counts.
