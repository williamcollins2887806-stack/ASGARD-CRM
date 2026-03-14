# Codex Execution Protocol v2

This document defines how execution Codex must operate on the live server.

## 1. Core operating rules

- Execute one task at a time.
- Do not perform unrelated fixes.
- Modify only the files explicitly allowed by the current task pack.
- Stop when ambiguity, contradiction, or unsafe scope expansion is discovered.
- Always report changed files.
- Always report risks and unverified items.

## 2. Mandatory pre-task safety checkpoint

Execution Codex must create a full safety checkpoint before editing anything.

### 2.1 If `/var/www/asgard-crm` is a git repo

Required sequence:
- run `git status`
- run `git diff --stat`
- create a checkpoint before edits using one of:
  - a checkpoint commit on a safe temporary branch
  - a patch bundle / diff snapshot stored in a safe location
- even if git exists, high-risk shell files must also get file-level backups before editing

High-risk shell files include at minimum:
- `public/index.html`
- `public/sw.js`
- `public/assets/js/app.js`
- `public/assets/js/ui.js`
- any task-designated shell-critical JS/CSS file

### 2.2 If `/var/www/asgard-crm` is not a git repo

Required sequence:
- create timestamped backups of every target file before editing
- store them under `/var/www/asgard-crm/backups/<timestamp>/...`
- preserve directory structure in backups

### 2.3 Backup evidence

Execution Codex must report:
- git status summary
- checkpoint method used
- backup paths created

## 3. Editing rules

- Keep edits scoped to the task pack.
- Do not redesign outside the task goals.
- Do not touch backend business logic unless the task pack explicitly allows it.
- Do not modify permissions, workflows, or unrelated modules unless explicitly required by the task pack.
- Do not restart services unless a later task pack explicitly requires it.

## 4. Verification rules

For every task:
- run syntax checks relevant to changed JS files
- run any task-specific verification commands
- perform targeted manual verification steps described in the task pack
- if no reliable verification can be performed, report that explicitly and stop

## 5. Reporting format required from execution Codex

Execution Codex must return:
- exact files changed
- backups/checkpoint created
- verification commands run
- results of those checks
- risks
- unverified items
- whether task acceptance criteria were met: yes/no

## 6. Stop conditions

Execution Codex must stop immediately if:
- live code contradicts the task pack in a way that changes risk materially
- backups/checkpoint cannot be created
- the required file set is larger than the task pack allowed scope
- verification fails and safe rollback is uncertain
- new ambiguity is found in business logic or authorization behavior

## 7. Rollback rules

- Rollback must use the exact pre-task checkpoint created for that task.
- Do not improvise rollback from memory.
- For file-level rollback, restore only the files touched by the task unless broader rollback is explicitly required.
- For git-based rollback, use the checkpoint commit/patch reference created before edits.

## 8. Task-pack discipline

- Execution Codex must read only the current task pack plus directly referenced live files.
- After task completion, stop.
- Do not continue into the next phase unless a new supervisor-approved task pack is provided.
