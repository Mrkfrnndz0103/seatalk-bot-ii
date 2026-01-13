# Concise list of bot events on a SeaTalk + OpenAI bot platform

## Real-time events
Triggered immediately by a user action in chat/UI:
- DIRECT_MESSAGE: User sends the bot a 1:1 message
- MENTION: User mentions the bot in a group chat
- COMMAND: User invokes a command (slash or text command)
- KEYWORD_TRIGGER: Message matches configured keywords/patterns
- THREAD_REPLY: User replies in a thread where bot participated
- BUTTON_CLICK: User clicks an interactive button
- DROPDOWN_SELECTION: User selects an option from a dropdown
- MODAL_SUBMISSION: User submits a modal/form
- HELP_REQUEST: User asks for help/usage
- INVALID_COMMAND: Command is unrecognized/malformed
- FALLBACK: No intent/action confidently resolved
- ERROR: Processing/runtime failure while handling an event
- USER_JOIN: User joins a chat/channel where bot is present
- USER_LEAVE: User leaves a chat/channel where bot is present
- PERMISSION_CHANGE: Bot/user role or access scope changes

## Async events
Triggered by time, background jobs, or outbound pushes (not directly from an immediate user UI action).
- SCHEDULED: Time-based trigger (cron/hourly/daily)
- NOTIFICATION: Bot pushes an alert/update based on external condition

##Technical Event Enum + API Spec
Enum:
```typescript
export enum BotEventType {
  DIRECT_MESSAGE = "DIRECT_MESSAGE",
  MENTION = "MENTION",
  COMMAND = "COMMAND",
  KEYWORD_TRIGGER = "KEYWORD_TRIGGER",
  THREAD_REPLY = "THREAD_REPLY",
  BUTTON_CLICK = "BUTTON_CLICK",
  DROPDOWN_SELECTION = "DROPDOWN_SELECTION",
  MODAL_SUBMISSION = "MODAL_SUBMISSION",
  HELP_REQUEST = "HELP_REQUEST",
  INVALID_COMMAND = "INVALID_COMMAND",
  FALLBACK = "FALLBACK",
  ERROR = "ERROR",
  USER_JOIN = "USER_JOIN",
  USER_LEAVE = "USER_LEAVE",
  PERMISSION_CHANGE = "PERMISSION_CHANGE",
  SCHEDULED = "SCHEDULED",
  NOTIFICATION = "NOTIFICATION",
}
```

Webhook contract (JSON)
```json
{
  "event_id": "evt_01HXYZ...",
  "event_type": "MENTION",
  "mode": "REALTIME",
  "occurred_at": "2026-01-13T08:15:30Z",
  "tenant_id": "shopee-ph",
  "chat": {
    "chat_id": "ct_123",
    "chat_type": "group",
    "thread_id": "th_456"
  },
  "actor": {
    "user_id": "u_001",
    "display_name": "Mark"
  },
  "message": {
    "message_id": "m_789",
    "text": "@obbot backlog",
    "attachments": []
  },
  "interaction": {
    "component_id": "btn_refresh",
    "value": "refresh"
  },
  "command": {
    "name": "backlog",
    "args": ["ph", "ops"]
  },
  "metadata": {
    "locale": "en",
    "timezone": "Asia/Manila"
  }
}
```

## Minimal OpenAPI-style spec (event ingest)

```yaml
openapi: 3.0.3
info:
  title: SeaTalk Bot Event API
  version: 1.0.0
paths:
  /v1/bot/events:
    post:
      summary: Ingest a bot event (webhook)
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: "#/components/schemas/BotEvent"
      responses:
        "200":
          description: Accepted
          content:
            application/json:
              schema:
                type: object
                properties:
                  status: { type: string, example: "ok" }
                  event_id: { type: string, example: "evt_01HXYZ..." }

components:
  schemas:
    BotEvent:
      type: object
      required: [event_id, event_type, mode, occurred_at]
      properties:
        event_id:
          type: string
          description: Unique id for idempotency
        event_type:
          type: string
          enum:
            - DIRECT_MESSAGE
            - MENTION
            - COMMAND
            - KEYWORD_TRIGGER
            - THREAD_REPLY
            - BUTTON_CLICK
            - DROPDOWN_SELECTION
            - MODAL_SUBMISSION
            - HELP_REQUEST
            - INVALID_COMMAND
            - FALLBACK
            - ERROR
            - USER_JOIN
            - USER_LEAVE
            - PERMISSION_CHANGE
            - SCHEDULED
            - NOTIFICATION
        mode:
          type: string
          enum: [REALTIME, ASYNC]
        occurred_at:
          type: string
          format: date-time
        tenant_id:
          type: string
        chat:
          type: object
          properties:
            chat_id: { type: string }
            chat_type: { type: string, enum: [dm, group] }
            thread_id: { type: string }
        actor:
          type: object
          properties:
            user_id: { type: string }
            display_name: { type: string }
        message:
          type: object
          properties:
            message_id: { type: string }
            text: { type: string }
            attachments:
              type: array
              items: { type: object }
        interaction:
          type: object
          properties:
            component_id: { type: string }
            value: { type: string }
        command:
          type: object
          properties:
            name: { type: string }
            args:
              type: array
              items: { type: string }
        error:
          type: object
          properties:
            code: { type: string }
            message: { type: string }
```

