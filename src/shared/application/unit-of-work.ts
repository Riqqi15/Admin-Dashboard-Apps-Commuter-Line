// One database transaction. Repositories handed to `work` are bound to it, so locks and writes commit or roll back together.
export interface UnitOfWork<Repositories> {
  run<T>(work: (repositories: Repositories) => Promise<T>): Promise<T>;
}
