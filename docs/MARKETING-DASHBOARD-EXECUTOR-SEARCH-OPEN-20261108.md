# MZJ Marketing – Dashboard search opening and publication statuses

## Scope

Dashboard > بحث... > نتائج البحث only.

- When a search task is matched by an executor's full name or a meaningful part of that name, clicking `فتح` shows only the current requirements assigned to the matched executor(s).
- Search result task rows show the matching executor names rather than every executor when that name was matched.
- If exactly one current requirement is matched, open that requirement automatically. Multiple matched requirements stay listed for selection.
- Scope requirement counts, due-date range, readiness, archived rejected requirements, and item-level history to the matching executor(s) within this temporary task-detail view.
- Searches by task name, task number, idea, or dates without an executor-name match keep the usual complete task view. Ordinary dashboard task-opening, delivery-calendar shortcuts, and database pages retain their existing behavior.
- This is **view filtering**, never login as another user and never a change to existing authorizations, task assignments, or saved data.
- In publication search results: `بانتظار النشر` is yellow and `تم النشر` green. Overdue and late publication labels stay red.

## Validation

- Keyword search regression: 28/28 checks.
- Search task executor and publication status regression: 23/23 checks.
- Existing calendar rating/navigation test (including TaskDetail mock compatibility): 7/7 checks.
- Existing agenda report, publishing deadline, dashboard presentation, campaign review and ratings checks passed.
- TS/TSX transpilation syntax passed for every changed application component. Complete dependency-based Vercel build was not run in this environment (dependencies are not installed).

No SQL, database edits, external API changes or deployment performed.
