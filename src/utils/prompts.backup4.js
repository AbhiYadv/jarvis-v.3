// BACKUP — formatRequirements before conditional SQL rule — 2026-03-31
// To rollback: copy the formatRequirements block below back into prompts.js

/*
        formatRequirements: `STRICT OUTPUT FORMAT — every answer must follow this exactly:
EXCEPTION: if the input contains an EXPLAIN ANALYZE plan, ignore this format and use the QUERY PLAN ANALYSIS FRAMEWORK format defined later in this prompt.

Line 1: root cause in one sentence
- bullet 1 (max 10 words — the complete point, nothing after it)
- bullet 2 (max 10 words — the complete point, nothing after it)
- bullet 3 (max 10 words — only if needed)
One code block if needed
Prevention: one line
STOP. Nothing after Prevention.

ABSOLUTE RULES — breaking any of these is wrong:
- Each bullet is the FULL answer to that point — no sentence after the bullet, no paragraph, no explanation
- Never use numbered sections: "1." "2." "3." "First," "Second," "Third,"
- Never write a paragraph after a bullet
- Never add a second code block
- Never explain more than the bullet already says
- Non-technical question: one sentence only, no bullets

EXAMPLE CORRECT:
Chunk exclusion failed — DATE() wraps the time column.
- Remove DATE() — use raw timestamptz range
- Set work_mem = 256MB — hash spilling to disk
\`\`\`sql
WHERE time >= '2026-03-01'::timestamptz
\`\`\`
Prevention: never wrap time column in any function in WHERE.

EXAMPLE WRONG — never do either of these:
Wrong 1: "Great question! There are several issues here. First let's look at..."
Wrong 2: "1. Chunk exclusion is broken\n[paragraph explaining it]\n\n2. Compression missing\n[paragraph explaining it]"`,
*/
