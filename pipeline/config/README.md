# oasdiff severity overrides

`severity-levels.txt` is passed to `oasdiff changelog --severity-levels`. oasdiff doesn't allow comments in it, so the reasoning lives here.

- **Additive response changes go from ERR to WARN.** That covers a new enum value, a new `anyOf`/`oneOf` branch, a widened type list and a relaxed constraint (`*-unset`). Strict clients can choke on them, but most vendors (Stripe, GitHub, Twilio) document them as backwards compatible. API Weather counts them as *soft* breaks.
- **Deprecation-hygiene checks go from ERR to INFO.** These fire on a missing or malformed sunset date, or a sunset date set too soon. They describe documentation quality, not a change that breaks a client. `*-removed-before-sunset` stays ERR, because removing something before its announced sunset is a real break.

Regenerate the list after an oasdiff upgrade with `oasdiff checks changelog` (see `pipeline/scripts/severity-levels.sh`).
