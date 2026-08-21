#!/usr/bin/env bash
# Author: Brijesh Dave <https://github.com/brijeshdave>
# Which compose file the scripts should drive. Sourced, not run.
#
# `compose.prod.yaml` is the shipped reference and is tracked, which means a
# `git pull` rewrites it. An operator who has tailored their stack — different
# volumes, an extra service, their own ports — therefore keeps their own
# `compose.yaml` instead, and `.gitignore` has always said that is theirs to keep.
# The scripts did not honour it: they passed `-f compose.prod.yaml` explicitly, so
# `scripts/upgrade.sh` rebuilt and restarted a stack the operator was not running.
#
# Precedence, most specific first:
#
#   1. `COMPOSE_FILE` in the environment — Docker Compose's own variable, so a
#      value already exported for manual `docker compose` calls is obeyed here too.
#   2. `COMPOSE_FILE` in `.env` — untracked, so a preference set once survives
#      every pull without having to be exported in each shell.
#   3. **The file the running stack was actually started from.** Compose stamps
#      every container it creates with `com.docker.compose.project.config_files`,
#      so this is the one place the answer is a fact rather than a convention: if
#      a stack is up in this directory, that is the stack to act on, whatever it
#      happens to be called. `compose.dev.yaml` is excluded — a developer with the
#      development stack running must not have `upgrade.sh` rebuild it.
#   4. Whichever of the four names Docker Compose itself picks up — `compose.yaml`,
#      `compose.yml`, `docker-compose.yaml`, `docker-compose.yml` — in that order,
#      which is Compose's own precedence. Nothing tracked uses those names, so one
#      being present means somebody put it there deliberately, and it is exactly
#      what a bare `docker compose up` in this directory would run.
#   5. `compose.prod.yaml`, the shipped default.
#
# Docker Compose reads `COMPOSE_FILE` as a `:`-separated list; that is passed
# through unchanged, so `compose.yaml:compose.override.yaml` works.

# The config files of a compose project already running from this directory, as a
# `:`-separated list of paths relative to it. Empty when nothing is up, when Docker
# is unreachable, or when the only thing running is the development stack.
running_stack_config_files() {
  command -v docker >/dev/null 2>&1 || return 0

  local here files
  here="$(pwd -P)"
  files="$(
    docker ps \
      --filter "label=com.docker.compose.project.working_dir=$here" \
      --format '{{.Label "com.docker.compose.project.config_files"}}' 2>/dev/null |
      head -1
  )"
  [ -n "$files" ] || return 0

  local part relative
  local -a kept=()
  local IFS=,
  for part in $files; do
    relative="${part#"$here"/}"
    # Never the development stack: `pnpm app:infra` leaves it up on a machine that
    # may also hold a checkout somebody upgrades, and rebuilding it there would
    # replace the databases they are working against.
    [ "$relative" = "compose.dev.yaml" ] && return 0
    kept+=("$relative")
  done

  local out
  out="$(
    IFS=:
    echo "${kept[*]}"
  )"
  echo "$out"
}

resolve_compose_file() {
  local from_env from_dotenv

  from_env="${COMPOSE_FILE:-}"
  if [ -n "$from_env" ]; then
    echo "$from_env"
    return
  fi

  if [ -f .env ]; then
    from_dotenv="$(grep -E '^COMPOSE_FILE=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r' || true)"
    if [ -n "$from_dotenv" ]; then
      echo "$from_dotenv"
      return
    fi
  fi

  local running
  running="$(running_stack_config_files)"
  if [ -n "$running" ]; then
    echo "$running"
    return
  fi

  local candidate
  for candidate in compose.yaml compose.yml docker-compose.yaml docker-compose.yml; do
    if [ -f "$candidate" ]; then
      echo "$candidate"
      return
    fi
  done

  echo "compose.prod.yaml"
}

# Turn a `:`-separated list into the repeated `-f` arguments docker compose wants.
compose_file_args() {
  local list="$1" part
  local -a args=()
  local IFS=:
  for part in $list; do
    [ -n "$part" ] && args+=(-f "$part")
  done
  printf '%s\n' "${args[@]}"
}
