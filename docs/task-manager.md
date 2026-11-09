# Task Manager

Install Task Manager from Widgets → Productivity, then choose Open in Projects. Its Projects tab shares the existing task records used by `/task` and the Tasks category. No account or provider is required. Tasks stay in the existing device-local item storage; lists are the existing Projects, including Inbox.

Add a title, choose a list and priority, and optionally set a due date. High, normal and low priorities are available. Due dates are calendar dates in the local time zone; overdue and due-today tasks are labeled. Dates do not schedule notifications. Use New list to create a shared Project, or choose an existing one. Select a task title to edit its title, list, priority or date. Existing task details and unrelated metadata are preserved.

Check a task to complete and archive it through the existing workflow. The Completed filter retains finished tasks; uncheck one to restore it to its previous stage. Search by title, filter by list, status and priority, and sort by due date, priority, title or newest. Lists use 25-task pages. Counts cover the selected list, independent of the search and priority filter. Existing item limits apply: 30 active items across Projects and 300 total items, with up to 30 lists/Projects.

Task mutations are explicit. Failed storage writes roll back the data change and keep the form input available for retry. Closing the tab preserves its form draft in memory; workspace window handoffs transfer that draft along with shared task data. Restart preserves saved tasks, rather than unsaved drafts. Deactivation and uninstall remove the widget surface while preserving all saved tasks and lists in Projects. Inactive widgets cannot create or modify tasks through the widget store.

## Implementation and verification

[The model](../dist/task-manager-model.js) validates dates, priorities and task fields and owns filtering/sorting. [The store adapter](../dist/task-manager-store.js) uses the existing Projects items and workflow, and [the interface](../dist/task-manager.js) retains form state. [Page adapters](../dist/page-widgets.js) mount the retained surface in Projects. [Window handoffs](../dist/window.js) transfer drafts without a separate task database.

Run `node scripts/check-task-manager.mjs`, `node scripts/check-page-widgets.mjs`, `npm run check` and `npm run verify` on Mac. Model/store regressions cover legacy tasks, metadata preservation, list creation, dates, priority, completion/restoration, item limits, storage rollback and inactive mutation refusal. Rendered fixtures exercise installation, task creation/editing, completion, filters, draft handoff, failed saves, layout and uninstall preservation with isolated browser storage. These checks do not establish installed Mac GUI acceptance or deployment.
