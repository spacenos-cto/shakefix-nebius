# GitLab Orbit — internal notes (2026-10-12)

Internal only. Investigated read-only; nothing on GitLab was changed.

## TL;DR

- Orbit **service is reachable and the feature flag is on for our user** (`GET /api/v4/orbit/status` -> 200, `user.available: true`, Orbit v0.137.0).
- Our top-level group **`nxt-spacenos-global` (id 144412879) is NOT indexed yet**:
  `GET /api/v4/orbit/graph_status?namespace_id=144412879` and `?project_id=87458663` -> 404 `Knowledge graph request failed`;
  a bounded query for `Project` 87458663 returns 200 with 0 rows.
- Fix = one toggle by a group **Owner** (`cto.spacenos` is Owner, access_level 50):
  **Left sidebar > Your Work > Orbit > Configuration > Indexes list > `nxt-spacenos-global` > Enable.**
  Indexing starts immediately; small groups finish in minutes. Verify with `GET /api/v4/orbit/graph_status?project_id=87458663`.
- Tier: Premium/Ultimate, GitLab.com, beta. Group plan = `ultimate_trial` (ends 2026-11-09). Docs do not say whether trials count; the toggle will show it. Queries are free during beta.
- Caveat: Orbit indexes the **default branch only**. MR blast radius = map the MR's changed files/lines onto default-branch `Definition`s, then walk callers.
- Caveat: Orbit has **no "route/endpoint" entity**. Express routes with inline arrow handlers (`app.get('/x', (req,res)=>...)`) may not exist as named `Definition`s. Routes need our own extractor either way.

Docs:
- Overview: https://docs.gitlab.com/orbit/
- Enable (Remote getting started): https://docs.gitlab.com/orbit/remote/getting-started/
- Query DSL: https://docs.gitlab.com/orbit/remote/queries/query-language/
- Queries / Cookbook: https://docs.gitlab.com/orbit/remote/queries/ , https://docs.gitlab.com/orbit/remote/cookbook/
- Schema: https://docs.gitlab.com/orbit/remote/schema/
- REST API: https://docs.gitlab.com/orbit/remote/access/api/
- glab: https://docs.gitlab.com/orbit/remote/access/glab/
- MCP: https://docs.gitlab.com/orbit/remote/access/mcp/
- Duo Agent Platform: https://docs.gitlab.com/orbit/remote/access/duo/
- Security / auth: https://docs.gitlab.com/orbit/remote/security/
- Troubleshooting: https://docs.gitlab.com/orbit/remote/troubleshooting/
- Agent skill: https://docs.gitlab.com/orbit/ai_coding_agents/
- Source: https://github.com/gitlabhq/orbit-knowledge-graph

## 1. How Orbit is enabled

| Item | Value |
|---|---|
| Tier | Premium, Ultimate (GitLab.com; Self-Managed from 19.2.2 with its own k8s stack) |
| Status | Beta (since 19.1), "not ready for production use" |
| Feature flag | `knowledge_graph` (GitLab-managed on .com). Already on for us (status 200). If it were off: 404 / glab exit code 2 |
| Scope | Top-level group only; subgroups and projects inherit |
| Who enables | Owner of the top-level group |
| Where | Your Work > Orbit > Configuration > Indexes > toggle Enable |
| Who can query | Reporter+ on the indexed group (Security Manager for vuln data) |
| Cost | Queries do not consume GitLab Credits during beta |

## 2. Probe results (read-only, 2026-10-12)

| Call | Result |
|---|---|
| `GET /api/v4/orbit/status` | 200, healthy, `user.available: true` |
| `GET /api/v4/orbit/schema` | 200 (ontology incl. code edges) |
| `GET /api/v4/orbit/schema/dsl` | 200 (DSL JSON Schema v12) |
| `GET /api/v4/orbit/tools` | 200 (`list_commands`, `invoke_command`) |
| `GET /api/v4/orbit/graph_status?namespace_id=144412879` | 404 -> group not indexed |
| `GET /api/v4/orbit/graph_status?project_id=87458663` | 404 -> project not indexed |
| `POST /api/v4/orbit/query` (Project node_ids [87458663]) | 200, 0 rows |
| `glab` locally | not installed (need glab >= 1.117 for `glab orbit query`) |

Group facts: private, `duo_features_enabled: true`, `experiment_features_enabled: false`, plan `ultimate_trial`.

## 3. Code graph ontology (live schema)

Nodes: `File`, `Directory`, `Definition`, `ImportedSymbol`, `Branch`, `Commit`.
`Definition` columns: `id, project_id, branch, commit_sha, file_path, fqn, name, definition_type, start_line, end_line, content(virtual, slow)`.
`File` columns: `id, project_id, branch, path, name, extension, language, content`.

Code edges (direction = source -> target):
- `CALLS`: Definition->Definition, File->Definition, Definition->ImportedSymbol, File->ImportedSymbol
- `DEFINES`: File->Definition, Definition->Definition
- `IMPORTS`: File->ImportedSymbol, ImportedSymbol->Definition
- `EXTENDS`: Definition->Definition
- `CONTAINS`: Project->Branch->Directory->File; `ON_BRANCH`: File/Directory->Branch

Note: there is no `called_by` edge type; "called by" = `CALLS` with `direction: "incoming"` (or put the caller on the `from` side).
Languages: Ruby, Java, Kotlin, Python, TypeScript, JavaScript, Rust, Go, C#, C, C++, PHP.

DSL limits: max 5 nodes, 5 relationships, `hops` max `[1,3]`, `path_finding.max_depth` max 3, `limit` default 30 / max 1000, needs at least one selective node (node_ids / filter).

## 4. Query syntax for our two questions

REST envelope (glab sends `response_format: "llm"` by default):

```shell
curl --request POST "https://gitlab.com/api/v4/orbit/query" \
  --header "PRIVATE-TOKEN: $ORBIT_TOKEN" \
  --header "Content-Type: application/json" \
  --data @callers.json
```

### 4a. "Which functions call this function (up to 3 hops)"

`callers.json`:

```json
{
  "query": {
    "query_type": "traversal",
    "nodes": [
      {"id": "target", "entity": "Definition",
       "filters": {"project_id": {"eq": 87458663},
                   "name": {"eq": "computeBalances"},
                   "file_path": {"ends_with": "server/index.js"}},
       "columns": ["name", "fqn", "file_path", "start_line"]},
      {"id": "caller", "entity": "Definition",
       "filters": {"project_id": {"eq": 87458663}},
       "columns": ["name", "fqn", "file_path", "start_line", "definition_type"]}
    ],
    "relationships": [
      {"type": "CALLS", "from": "caller", "to": "target", "hops": [1, 3]}
    ],
    "limit": 200
  },
  "response_format": "raw"
}
```

Module-level callers (code outside any function, e.g. route registration lines) come from `File -CALLS-> Definition`: same query with the `caller` node as `"entity": "File"` and columns `["path"]`.

Neighbors shape (1 hop, both directions, quick "who touches this"):

```json
{"query": {"query_type": "neighbors",
  "nodes": [{"id": "fn", "entity": "Definition", "node_ids": [123456]}],
  "neighbors": {"direction": "incoming", "rel_types": ["CALLS"]},
  "limit": 50}}
```

Path finding (is route handler X connected to function Y within 3 hops):

```json
{"query": {"query_type": "path_finding",
  "nodes": [
    {"id": "start", "entity": "Definition", "node_ids": [111]},
    {"id": "end", "entity": "Definition", "node_ids": [222]}],
  "path": {"type": "shortest", "from": "start", "to": "end", "max_depth": 3, "rel_types": ["CALLS"]},
  "limit": 5}}
```

Riskiest definitions (most imported) — aggregation over `ImportedSymbol -IMPORTS-> Definition`, group by definition, count, sort desc (see Cookbook).

### 4b. "Which public endpoints are reachable"

Orbit has no Route/Endpoint entity. Options:
1. Approximate: callers query with the `caller` node = `File` filtered to `path ends_with server/index.js` (the file that registers routes) -> tells you the change reaches the server entry file, not which route.
2. Exact (recommended): our own route extractor maps `METHOD path -> handler name / line range`, then intersect with the Orbit caller set (or our own call graph). See section 6.

glab equivalent (glab >= 1.117; older docs show `glab orbit remote query`):

```shell
glab orbit query --file callers.json --response-format raw --yes
glab orbit graph-status --project-id 87458663
glab orbit ontology Definition File
```

## 5. Calling Orbit from CI and from a Duo flow

### CI job
- Auth: PAT with `read_api` (or fine-grained PAT with the **GitLab Orbit** resource), or a **service account** PAT (`read_api`, direct member of the group, Reporter+). `CI_JOB_TOKEN` is not documented as supported — do not rely on it.
- Store as masked+protected CI variable (e.g. `ORBIT_TOKEN`), call `POST /api/v4/orbit/query` with curl (no glab needed in the image).
- Index is default-branch, refreshed per index cycle, so CI on an MR asks about the pre-change graph — which is what blast radius wants.

### Duo Agent Platform flow / custom agent
- Foundational agents (Duo Agent, Developer Flow, etc.) call Orbit automatically. **Code Review Flow does not** — docs point to a custom flow.
- Custom flow: add to each component's `toolset`:

```yaml
toolset:
  - orbit_list_commands
  - orbit_invoke_command
```

  and tell the agent in the prompt to call `orbit_invoke_command` with `command_name: "query_graph"` and the DSL in `parameters` (call `get_query_dsl` first).
- Prereqs: Orbit enabled on group; Maintainer/Owner on the project that manages the flow; **each user who triggers the flow must turn it on**: Avatar > Preferences > "Orbit in GitLab Duo" > check "Use Orbit in GitLab Duo" (and "Other Foundational Agents") > Save changes.
- Alternative inside a flow: `run_command` with curl to the REST API (needs a token in the runner env) — the native toolset is simpler.

### MCP (local agents)
- Endpoint `https://gitlab.com/api/v4/orbit/mcp`, tools `list_commands` / `invoke_command`, OAuth scope `mcp_orbit` or PAT `read_api`.
- Claude Code: `claude mcp add --transport http gitlab-orbit https://gitlab.com/api/v4/orbit/mcp`.

## 6. Fallback: our own static call graph in CI (no Orbit needed)

Goal: same answer — changed function -> callers (<=3 hops) -> Express routes -> files — rendered as Mermaid in an MR note.

Parser: `typescript` 5.6.3 is already a root devDependency. Use the TS compiler API with `allowJs: true` (no new deps; handles ESM/CJS, JSX). Alternative: `acorn` + `acorn-walk` (tiny) if we want zero TS coupling.

Pipeline (`scripts/blast-radius.mjs`, ~200 lines):
1. **Collect files**: `apps/*/server/**/*.js`, `apps/*/src/**/*.js`, `services/*/src/**/*.js` (skip node_modules, dist).
2. **Definitions**: function declarations, `const x = (...) =>`, class methods, object-literal methods -> id `file#name`, with line range.
3. **Call edges**: walk `CallExpression`; resolve callee by (a) same-file name, (b) import binding (`import {x} from './y.js'` / `require`) -> target file#name. Unresolved -> drop (good enough for vanilla JS).
4. **Routes**: match `app|router|api.(get|post|put|patch|delete|use)(pathLiteral, ...handlers)`; handler = named ident -> its definition, or inline arrow -> synthetic `ROUTE GET /api/x` node whose calls are walked like a function. Track `app.use('/api', api)` to prefix router paths.
5. **Changed set**: `git diff --unified=0 $CI_MERGE_REQUEST_DIFF_BASE_SHA...HEAD` -> changed line ranges -> definitions overlapping them.
6. **Reverse BFS** over call edges up to 3 hops from changed defs; collect reached ROUTE nodes = affected public endpoints.
7. **Render** Mermaid `graph LR` (route -> fn -> changed fn, changed nodes styled red), plus a table: endpoint | path through functions | files.
8. **Post**: CI job `rules: if $CI_PIPELINE_SOURCE == "merge_request_event"`, POST/PUT one MR note via `/projects/:id/merge_requests/:iid/notes` using a project access token var (upsert by a hidden marker `<!-- blast-radius -->`). GitLab renders ```mermaid blocks natively in notes.

Hybrid (best of both): when Orbit is indexed, use Orbit for steps 2/3/6 (cross-file, cross-project callers incl. packages/sdk) and keep our step 4 route extractor + step 7 render. If Orbit returns 404/403/0 rows, fall back to the local graph automatically.

## 7. Open questions
- Does the Ultimate **trial** appear in Orbit > Configuration? (Verify when the Owner opens the page.)
- How does Orbit's JS indexer name inline arrow route handlers (definition_type values)? Check with `glab orbit ontology Definition` + a sample query after indexing.
- Re-index cadence after a merge to default branch (watch `graph_status`).
