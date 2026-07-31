# Mosaic Compose invocation helper, sourced by the operational scripts.
#
# A host can run more than one Mosaic installation: the real one, plus a
# verification, drill, or restore-check environment. A bare `docker compose`
# always resolves to whichever project the working directory implies, so an
# operator who runs a backup or an upgrade "against the other stack" silently
# acts on the wrong data. Every script therefore routes through mosaic_compose,
# which carries an explicit project, file set, and env-file set.
#
# Resolution order (first non-empty wins):
#
#   project    -p/--project flag  >  MOSAIC_COMPOSE_PROJECT  >  COMPOSE_PROJECT_NAME
#   files      --compose-file     >  MOSAIC_COMPOSE_FILE     >  COMPOSE_FILE
#   env files  --env-file         >  MOSAIC_COMPOSE_ENV_FILE >  COMPOSE_ENV_FILES
#
# When nothing is set, Compose's own defaults apply, so existing single-
# installation usage is unchanged. Files and env files accept several paths
# separated by ':' or ','.

mosaic_compose_project="${MOSAIC_COMPOSE_PROJECT:-${COMPOSE_PROJECT_NAME:-}}"
mosaic_compose_file="${MOSAIC_COMPOSE_FILE:-${COMPOSE_FILE:-}}"
mosaic_compose_env_file="${MOSAIC_COMPOSE_ENV_FILE:-${COMPOSE_ENV_FILES:-}}"

# mosaic_compose_parse_option consumes a shared Compose option from the front of
# the argument list and records how many arguments it took in the global
# mosaic_compose_consumed (0 when the argument is not a Compose option) so
# callers can advance their own loop.
#
# The count is a global rather than a printed value on purpose: a caller writing
# `count="$(mosaic_compose_parse_option "$@")"` would run this in a subshell and
# silently discard the selection it just parsed.
mosaic_compose_consumed=0

mosaic_compose_parse_option() {
  case "${1:-}" in
    -p|--project) mosaic_compose_project="${2:-}"; mosaic_compose_consumed=2 ;;
    -p=*|--project=*) mosaic_compose_project="${1#*=}"; mosaic_compose_consumed=1 ;;
    --compose-file) mosaic_compose_file="${2:-}"; mosaic_compose_consumed=2 ;;
    --compose-file=*) mosaic_compose_file="${1#*=}"; mosaic_compose_consumed=1 ;;
    --env-file) mosaic_compose_env_file="${2:-}"; mosaic_compose_consumed=2 ;;
    --env-file=*) mosaic_compose_env_file="${1#*=}"; mosaic_compose_consumed=1 ;;
    *) mosaic_compose_consumed=0 ;;
  esac
  return 0
}

# mosaic_compose_split splits a ':' or ','-separated list into one argument per
# entry, each prefixed by the given flag.
mosaic_compose_split() {
  local flag="$1" value="$2" entry
  local saved_ifs="${IFS}"
  IFS=':,'
  # shellcheck disable=SC2086 # deliberate word splitting on IFS
  set -- ${value}
  IFS="${saved_ifs}"
  for entry in "$@"; do
    [[ -n "${entry}" ]] && printf '%s\n%s\n' "${flag}" "${entry}"
  done
}

# mosaic_compose runs `docker compose` against the resolved installation.
mosaic_compose() {
  local arguments=(compose)
  if [[ -n "${mosaic_compose_project}" ]]; then
    arguments+=(-p "${mosaic_compose_project}")
  fi
  local line
  if [[ -n "${mosaic_compose_file}" ]]; then
    while IFS= read -r line; do arguments+=("${line}"); done < <(mosaic_compose_split -f "${mosaic_compose_file}")
  fi
  if [[ -n "${mosaic_compose_env_file}" ]]; then
    while IFS= read -r line; do arguments+=("${line}"); done < <(mosaic_compose_split --env-file "${mosaic_compose_env_file}")
  fi
  docker "${arguments[@]}" "$@"
}

# mosaic_compose_export makes the resolved selection visible to child scripts
# (upgrade.sh calls backup-postgres.sh, for example) without re-parsing flags.
mosaic_compose_export() {
  [[ -n "${mosaic_compose_project}" ]] && export MOSAIC_COMPOSE_PROJECT="${mosaic_compose_project}"
  [[ -n "${mosaic_compose_file}" ]] && export MOSAIC_COMPOSE_FILE="${mosaic_compose_file}"
  [[ -n "${mosaic_compose_env_file}" ]] && export MOSAIC_COMPOSE_ENV_FILE="${mosaic_compose_env_file}"
  return 0
}

# mosaic_compose_describe prints the installation a script is about to act on.
# Operational scripts print this before doing anything destructive.
mosaic_compose_describe() {
  printf '==> Compose installation: project=%s files=%s env-files=%s\n' \
    "${mosaic_compose_project:-<compose default>}" \
    "${mosaic_compose_file:-<compose default>}" \
    "${mosaic_compose_env_file:-<compose default>}"
}
