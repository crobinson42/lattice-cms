---
'@latticecms/core': minor
---

In the overrides factory, `transaction`'s `work` also receives `generated`, bound to the transaction: `transaction(async (repos, generated) => …)`. An override runs the generated operation and its own repo writes as one unit. The generated operations' events are held until the commit and published after it, so a rollback publishes nothing and a retried attempt publishes once. `Transaction<R, G>` names the generated operations a use case calls; `G` defaults to none.

**Breaking**, for code that implements a `Transaction` itself, such as a test fake: `work` now takes a second argument. Code that calls `transaction` is unchanged.

```ts
// before
const transaction: Transaction<Repos> = (work) => work(repos);
// after
const transaction: Transaction<Repos> = (work) => work(repos, {});
```
