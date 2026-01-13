# SeaTalk Bot Summary

## Project Summary

This is a nodejs project app with a SeaTalk group chat bot that reads data from a fixed Google Sheet using a service account. The bot responds only when mentioned and supports three core intents: backlogs inquiry (send a PNG dashboard export plus a text summary), top contributors by region (ranked list from precomputed sheet ranges), and truck request queries (latest request per cluster based on request time). It includes a Sheets client, backlogs and truck services, intent parsing, response formatting, and a webhook at `/seatalk/webhook`. SeaTalk messages are sent using the `group_id` + `message.tag` payload format and the app access token is auto-refreshed via app credentials.

## Plain-English Prompt

When mentioned, the bot reads from a fixed Google Sheet via a service account and responds using one of these intents:

1. Backlogs inquiry - Export the `backlogs` dashboard as a PNG and send it, then send a short text summary with totals and the latest timestamp.
2. Top contributors - Read the precomputed region/cluster/pending values and return a ranked list for the requested region.
3. Truck request questions - Extract a cluster name from natural language, apply the latest-row-per-cluster rule by request time, and answer status, requested by, LHTrip, or provide a full summary.

If the request does not match, ask a brief clarifying question and give one example query.

Implement a Sheets client, parsing/intents, response formatting, and a SeaTalk webhook at `/seatalk/webhook`. Use the SeaTalk messaging API with `group_id` and `message.tag` payloads, and auto-refresh the app access token using app_id/app_secret.
