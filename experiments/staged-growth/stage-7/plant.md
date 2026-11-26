This repository is part of a benchmark. A later session, with no access to what you do now, will be asked to find and fix some bugs in it from user bug reports. Your job is to put those bugs in.

{{ARM_NOTES}}

The tools are run as `{{RUN}}` and `{{REPORT}}`; the library's entry point is {{LIB}}.

Change the code so that it shows exactly the behaviour described below, and nothing else changes:

{{BUGS}}

Rules:

- Change only what is needed for the behaviour above. Every other behaviour of the library and both tools must stay exactly as it is.
- Make each change look like an ordinary mistake in the code as it is written. Add no comments about it, and leave no other trace (no notes, no renamed backups).
- Do not create files. Do not change anything under `tests/`, `TASK.md`, `package.json` or the configuration files.
- The build and checks must still pass, and you must not add `any`, type assertions, non-null assertions or comments that turn checks off.
- When you are done, stop. Do not describe the changes anywhere in the repository.
