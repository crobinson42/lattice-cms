@AGENTS.md

## Claude Code

- If this session is `lattice-orchestrator` or `lattice-engineer`, read `docs/roles/orchestrator.md` or `docs/roles/engineer.md` first, and again after every compaction. Its ownership and messaging rules override `AGENTS.md` where they differ.
- Start each session by reading the current phase plan and continuing from its first unchecked step. Tick a step only when its tests pass.
- Use plan mode for any step the plan marks **Checkpoint**, and whenever a decision record or existing code seems to force a workaround. Show the maintainer the plan and wait for a yes.
- The hexok and ts-pf repositories sit next to this one, at `../hexok` and `../ts-pf`. Read them through `.claude/settings.json` (`permissions.additionalDirectories`) or `/add-dir` when a README does not answer a question. Never edit them.
- After `npm install`, run `npx skills experimental_sync -y -r` once (`-r` reaches the workspace packages' dependencies, which ship the skills). It links the agent skills that ship inside `hexok` and the `@ts-pf/*` packages. Use the `hexok` and `ts-pf-*` skills when you write use cases, ports, adapters, contracts and routers.
