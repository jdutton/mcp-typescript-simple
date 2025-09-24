# Repository Guidelines

## Project Structure & Module Organization
Core server logic lives in `src/`, with feature folders for auth, transport, and tool handlers; entrypoints are `src/index.ts` and the optional `api/` Vercel handlers. Shared scripts, debug helpers, demos, and other manual tooling live in `tools/` (see `tools/manual/` for the CLI probes moved out of `test/`). Reusable demos stay in `examples/`, and long-form references in `docs/`. Automated tests live under `test/` (`test/unit/**` mirrors the `src/**` paths for Jest suites, `test/integration/**` hosts the CI runner and helpers). Build artifacts should stay out of version control and land in `build/` after compilation.

## Build, Test, and Development Commands
Install dependencies with `npm install`. Use `npm run dev:stdio` for STDIO mode, `npm run dev:sse` to exercise the SSE transport, and `npm run dev:vercel` when validating serverless routes. Create production bundles via `npm run build`, then start with `npm start` or `npm run start:sse`. Run targeted checks with `npm run lint`, `npm run typecheck`, `npm run test:unit` for Jest coverage, or the integration sweep `npm run test:integration`. The comprehensive gate `npm run validate` now chains unit coverage ahead of the integration suite.

## Coding Style & Naming Conventions
TypeScript files use ES modules, two-space indentation, and `camelCase` for functions with `PascalCase` classes. Prefer `const`, avoid `var`, and keep unused identifiers prefixed with `_` only when intentional. ESLint (`eslint.config.js`) enforces the TypeScript-ESLint recommended rules plus `no-unused-vars` and discourages `any` in production code. Align new tooling with the existing folder-per-domain layout.

## Testing Guidelines
Jest (`jest.config.js`) discovers `*.test.ts` files and treats the project as ESM; keep fast unit suites under `test/unit` or co-located with source. Higher-level regression coverage should flow through `npm run test:ci`, which runs `test/integration/ci-test.ts` and its helper scripts (transport + Vercel checks). When adding new transports or tools, extend the suites in `test/unit` or `test/integration` as appropriate and ensure they pass locally before pushing.

## Commit & Pull Request Guidelines
Follow the conventional commit pattern already in history (e.g., `feat: add dual-mode helper`). Write focused commits with clear motivations and reference issue numbers when relevant. PRs should link to requirements, describe testing performed, and capture any configuration updates (env variables, Vercel settings). Attach CLI output or screenshots for behavior changes, and confirm `npm run validate` succeeds in the PR description.

## Security & Configuration Tips
Copy `.env.example` to `.env` and scope credentials to least privilege; never commit secrets. For OAuth or LLM providers, document new variables in `.env.example` and `docs/` so other agents remain aligned. When working against Vercel, rely on `vercel env pull` and avoid storing tokens in plain text within the repo.
