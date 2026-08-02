{{context}}

---

Implement the following task in this repository.

## Task

{{task}}

## Rules

- Change as few files as possible. Prefer the smallest edit that does the job.
- Match the existing architecture, naming, and style exactly.
- Update or add tests alongside any behaviour change.
- Do not reformat, reorganize, or "improve" code unrelated to the task.
- If the task cannot be done safely from what you were shown, emit no change
  blocks and explain what is missing instead.

## Output format

Emit each changed file in full, between markers, with no diff syntax:

<<<FILE path/relative/to/repo/root.ts
complete new contents of the file
>>>

To remove a file:

<<<DELETE path/relative/to/repo/root.ts>>>

Rules for the blocks:

- The path is relative to the repository root. Never absolute, never `..`.
- Emit the entire file contents, not an excerpt and not a patch.
- Any explanation goes outside the blocks, before or after them. Keep it to a
  few sentences.
