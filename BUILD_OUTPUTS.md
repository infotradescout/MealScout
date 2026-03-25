# Build Outputs

This repo intentionally uses more than one generated output directory. The directories below are expected to be rebuildable artifacts, not source of truth.

- `dist/` - root production output. `dist/public` holds the Vite client bundle and `dist/server` holds the bundled server output.
- `client/dist/` - standalone client-only build output used by the static Vercel workflow.
- `server/public/` - server-served static assets and public documents that may be copied or regenerated during deployment-oriented workflows.

Scratch files and local investigation artifacts should not live at the repo root long-term. Temporary outputs such as `tmp_*.txt`, `ts-out.txt`, `logs/`, and `.tmp-tests/` should stay ignored.
