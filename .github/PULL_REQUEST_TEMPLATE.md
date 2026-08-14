## What does this change, and why?

<!-- The why matters more than the what. The diff already says what. -->

Closes #

## Definition of done

- [ ] `pnpm turbo run typecheck lint test build` passes
- [ ] `pnpm --filter @reportly/api test:integration` passes
- [ ] `pnpm format` has been run
- [ ] Tests cover the behaviour, including the failure paths
- [ ] Anything both the API and the web app rely on lives in `packages/shared`
- [ ] Only repository code touches the database
- [ ] New tests are in a `tests/` folder inside the thing they test
- [ ] Documentation updated if behaviour, settings or environment changed
- [ ] Permission checks are enforced by the API, not only hidden in the UI

## Anything a reviewer should look at closely?

<!-- Trade-offs you made, things you were unsure about, what you could not test. -->
