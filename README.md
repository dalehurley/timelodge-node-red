# TimeLodge Day Summary for Node-RED

See how much time you recorded and how much was billable for one date in your TimeLodge workspace. Import the flow into Node-RED and use its totals in your own reports or automations.

## Set it up

1. The flow uses built-in nodes. It was tested on Node-RED 5.0.10, which requires Node.js 22.9 or later.
2. In [TimeLodge API & webhooks](https://timelodge.com/developers), create a dedicated workspace service token with the `time:read` scope. You need a TimeLodge workspace with API access.
3. Set `TIMELODGE_AUTHORIZATION` in your Node-RED process environment to `Bearer ` followed by your token. Use the secret configuration for your hosting environment and restart Node-RED as needed.
4. Import `flow.json` into a new tab. Edit **Select entry date** to the date on the entries you want to read, deploy and press its Inject button.

You’ll find the date, entry count and durations in seconds in the **TimeLodge daily total** debug message. Connect your own output to the second output of **Add durations and paginate** to use the summary elsewhere. Errors use **TimeLodge summary error**. The flow sends read-only requests to `https://timelodge.com/api/v1/time-entries`, keeps the token in your runtime environment and supports up to 10,000 entries per date. To disconnect, remove the environment variable and revoke the token in TimeLodge.

[Import instructions](https://nodered.org/docs/user-guide/editor/workspace/import-export) · [TimeLodge product facts](https://timelodge.com/facts)

The pagination and duration checks are adapted from [TimeLodge Day Summary for Obsidian](https://github.com/dalehurley/timelodge-obsidian) under the MIT license.
