In this existing SeaTalk chatbot project.

Goal
Integrate the SeaTalk Model Context Protocol (MCP) Server into this codebase so the LLM can call SeaTalk tools (send messages, read chat history, fetch employee info, group info). Update the project structure, code, and configs accordingly.

Operating rules
- Do not invent files. First, scan the repository to understand the current architecture.
- Prefer minimal, safe changes with clear separation of concerns.
- Keep secrets out of source control. Use environment variables and update templates/docs.
- Add error handling using the SeaTalk error codes (token expired, rate limit, permission denied, bot not in group, etc.).
- Add tests (unit tests for the MCP client wrapper + one integration-style test stub/mocked server).
- Update documentation so another engineer can run this locally.

Step 0: Repo discovery (do this first)
1) List relevant files for bot runtime, SeaTalk integration, message handling, config, and deployment:
   - entrypoints (main/server)
   - SeaTalk client / webhook handlers
   - message formatting utilities
   - config/env loading
   - docker/k8s/ci scripts (if any)
2) Summarize current message flow: “incoming event -> handler -> business logic -> reply”.

Deliverable for Step 0:
- A short architecture summary
- A proposed file change plan (which files will be modified/added and why)

Integration requirements
A) Add MCP client capability
- Implement an MCP client wrapper (e.g., `src/integrations/seatalkMcpClient.*`) that can:
  - connect to the MCP server process (configured via MCP settings or spawned if needed)
  - list available tools (optional)
  - call tools with typed request/response envelopes
- Provide functions that map to the MCP tools:
  - get_employee_profile(employee_code)
  - get_employee_code_with_email(emails[])
  - check_employee_existence(id)
  - get_user_language_preference(employee_code)
  - get_joined_group_chat_list(page_size, cursor?)
  - get_group_info(group_id)
  - get_thread_by_thread_id(group_id, thread_id, page_size, cursor?)
  - get_message_by_message_id(message_id)
  - get_chat_history(group_id, page_size, cursor?)
  - send_message_to_group_chat(group_id, message payload)
  - send_message_to_bot_user(employee_code, message payload)

B) Wire MCP tools into the LLM agent
- Update the LLM orchestration layer to expose these MCP tools to the model as callable “functions/tools”.
- Add a tool selection policy:
  - When user asks for “latest status/backlog”, optionally call chat history/thread tools to ground context.
  - When user asks “who is X”, use employee lookup tools.
  - When posting to a group or DM, use send_message tools.
- Ensure tool calls are logged (structured) but without leaking secrets or message content when not needed.

C) Configuration & secrets
- env vars:
  - SEATALK_APP_ID
  - SEATALK_APP_SECRET
  - (optional) MCP_SERVER_NAME=seatalk-mcp-server
  - (optional) MCP_TRANSPORT or MCP_ENDPOINT depending on your implementation
- Update:
  - `.env.example` (or equivalent)
  - README/runbook
  - deployment manifests (docker compose/k8s) if present

D) Error handling and resiliency
- Implement:
  - retry with exponential backoff for rate limit (code 101)
  - token refresh / re-auth flow when token expired/invalid (code 100 / auth errors)
  - user-friendly bot messages for common failures (permission denied 103, bot not in group 7001, etc.)
- Provide a single error normalization layer: `normalizeSeatalkError(response)`.

E) Tests
- Unit tests for:
  - MCP client wrapper request/response parsing
  - error normalization
  - tool routing decisions (given an intent, correct tool is called)
- Use mocks for MCP responses; do not require real credentials in CI.

Implementation guidance
1) Add/modify types:
   - `BotEventType` (if not existing) and tool payload types
   - `SeatalkMessagePayload` schema for text/image/interactive_message
2) Add an “Integration boundary”:
   - Existing business logic should not directly call SeaTalk; it should call the MCP wrapper.
3) Keep the existing webhook/event handlers unchanged where possible; only adapt the outbound/inbound integration points.

What to output (in this Cursor session)
1) A precise list of files to be changed/added (path + purpose).
2) The code changes implementing A–E.
3) Any necessary refactors to keep the architecture clean.
4) Updated docs: how to run locally with MCP (including example MCP settings JSON) and how to configure env vars.
5) A short “verification checklist” (how to manually test in SeaTalk / staging).

Start now:
- Perform Step 0 repo discovery
- Then implement the plan incrementally with small commits/patches (grouped logically)

Here is the SeaTalk Model Context Protocol Server Documentation you can refer to this:

SeaTalk Model Context Protocol Server

This server provides Model Context Protocol (MCP) tools to interact with the SeaTalk API. It enables AI assistants to send and retrieve messages, access employee information, and interact with group chats via SeaTalk. 

Configuration in MCP Settings
This package can be used directly via npx without installing it globally. The -y flag automatically accepts installation prompts for seamless automation.

Configure the SeaTalk server in your MCP settings by providing the required environment variables:

{
  "mcpServers": {
    "seatalk-mcp-server": {
      "command": "npx",
      "args": ["-y", "seatalk-mcp-server"],
      "env": {
        "SEATALK_APP_ID": "your_app_id_here",
        "SEATALK_APP_SECRET": "your_app_secret_here"
      },
      "disabled": false
    }
  }
}

Required environment variables:

    - SEATALK_APP_ID: Your SeaTalk application ID 
    - SEATALK_APP_SECRET: Your SeaTalk application secret
Using with Cursor or other MCP-compatible tools

After configuring the server in your MCP settings, SeaTalk tools will be available for use in Cursor or other MCP-compatible environments.

Local Development & Manual Build

If you prefer to clone the repository and build the server yourself, follow these steps:

Prerequisites 
Node.js 16.0.0 or higher
npm or yarn package manager

Clone and Build
1. Clone the repository:
    git clone https://gitlab.com/sea-group/seatalk/mcp-server.git
2. Install dependencies:
    npm install
3. Create environment configuration:
    echo "SEATALK_APP_ID=your_app_id_here" > .env
    echo "SEATALK_APP_SECRET=your_app_secret_here" >> .env

4. Build the project:
    npm run build

Configuration in MCP Settings (Local Build)
When using the locally built version, configure your MCP settings to point to the built file:

{
  "mcpServers": {
    "seatalk-mcp-server": {
      "command": "node",
      "args": ["/path/to/your/seatalk-mcp-server/seatalk-server/build/index.js"],
      "env": {
        "SEATALK_APP_ID": "your_app_id_here",
        "SEATALK_APP_SECRET": "your_app_secret_here"
      },
      "disabled": false
    }
  }
}

Note: Replace /path/to/your/seatalk-mcp-server/seatalk-server/build/index.js with the actual absolute path to your built index.js file.
Available Tools
Employee Information

get_employee_profile
Get an employee's profile by employee code.

Example:
{
  "employee_code": "EMP123"
}

Response:
{
  "code": 0,
  "employee": {
    "employee_code": "EMP123",
    "name": "John Doe",
    "company_email": "john.doe@company.com",
    "department": {
      "department_code": "DEP001",
      "department_name": "Engineering"
    }
  }
}

Response:
{
  "code": 0,
  "employee": {
    "employee_code": "EMP123",
    "name": "John Doe",
    "company_email": "john.doe@company.com",
    "department": {
      "department_code": "DEP001",
      "department_name": "Engineering"
    }
  }
}

Copy
get_employee_code_with_email
Get employee codes by email addresses.

Example:
{
  "emails": ["john.doe@company.com", "jane.smith@company.com"]
}

Copy
Response:
{
  "code": 0,
  "results": [
    {
      "email": "john.doe@company.com",
      "employee_code": "EMP123",
      "exists": true
    },
    {
      "email": "jane.smith@company.com",
      "employee_code": "EMP456",
      "exists": true
    }
  ]
}

Copy
check_employee_existence
Verify whether employees exist in the organization via SeaTalk ID.

Example:
{
  "id": "ST12345"
}

Copy
Response:
{
  "code": 0,
  "exists": true
}

Copy
get_user_language_preference
Get a user's language preference.

Example:
{
  "employee_code": "EMP123"
}

Copy
Response:
{
  "code": 0,
  "language": "en"
}

Copy
Group Chat Management 
get_joined_group_chat_list
Obtain group chats the bot joined.

Example:
{
  "page_size": 10
}

Copy
Response:
{
  "code": 0,
  "groups": [
    {
      "group_id": "group123",
      "group_name": "Engineering Team",
      "member_count": 15
    },
    {
      "group_id": "group456",
      "group_name": "Project Alpha",
      "member_count": 8
    }
  ],
  "has_more": true,
  "next_cursor": "cursor_token_for_next_page"
}

Copy
get_group_info
Get information about a group chat, including member list.

Example:
{
  "group_id": "group456"
}

Copy
Response:
{
  "code": 0,
  "group_info": {
    "group_id": "group456",
    "group_name": "Project Alpha",
    "description": "Group for Project Alpha discussion",
    "created_at": 1615000000,
    "owner": {
      "employee_code": "EMP123",
      "name": "John Doe"
    }
  },
  "members": [
    {
      "employee_code": "EMP123",
      "name": "John Doe",
      "is_admin": true
    },
    {
      "employee_code": "EMP456",
      "name": "Jane Smith",
      "is_admin": false
    }
  ],
  "has_more": false
}

Copy
Messaging
get_thread_by_thread_id
Retrieve all messages within a thread of a group chat.

Example:
{
  "group_id": "group456",
  "thread_id": "thread123",
  "page_size": 20
}

Copy
Response:
{
  "code": 0,
  "messages": [
    {
      "message_id": "msg001",
      "sender": {
        "employee_code": "EMP123",
        "name": "John Doe"
      },
      "tag": "text",
      "text": {
        "plain_text": "Hello team!"
      },
      "created_at": 1615456789
    }
  ],
  "has_more": false
}

Copy
get_message_by_message_id
Retrieve a message by its message ID.

Example:
{
  "message_id": "msg001"
}

Copy
Response:
{
  "code": 0,
  "message_id": "msg001",
  "sender": {
    "employee_code": "EMP123",
    "name": "John Doe"
  },
  "tag": "text",
  "text": {
    "plain_text": "Hello team!"
  },
  "created_at": 1615456789
}

Copy
get_chat_history
Obtain the group chat history (messages sent within 7 days).

Example:
{
  "group_id": "group456",
  "page_size": 50
}

Copy
Response:
{
  "code": 0,
  "messages": [
    {
      "message_id": "msg001",
      "sender": {
        "employee_code": "EMP123",
        "name": "John Doe"
      },
      "tag": "text",
      "text": {
        "plain_text": "Hello team!"
      },
      "created_at": 1615456789
    },
    {
      "message_id": "msg002",
      "sender": {
        "employee_code": "EMP456",
        "name": "Jane Smith"
      },
      "tag": "image",
      "image": {
        "content": "https://example.com/image.jpg"
      },
      "created_at": 1615456890
    }
  ],
  "has_more": true,
  "next_cursor": "next_page_cursor"
}

Copy
send_message_to_group_chat
Send a message to a group chat which the bot has been added to.

Example (Text Message):
{
  "group_id": "group456",
  "message": {
    "tag": "text",
    "text": {
      "content": "Hello everyone! This is an announcement.",
      "format": 1
    }
  }
}

Copy
Example (Image Message):
{
  "group_id": "group456",
  "message": {
    "tag": "image",
    "image": {
      "content": "base64_encoded_image_data"
    }
  }
}

Copy
Response:
{
  "code": 0,
  "message_id": "msg123"
}

Copy
send_message_to_bot_user
Send a message to a user via the bot.

Example (Text Message):
{
  "employee_code": "EMP123",
  "message": {
    "tag": "text",
    "text": {
      "content": "Hi there! Just checking in.",
      "format": 1
    }
  }
}

Copy
Example (Interactive Message):
{
  "employee_code": "EMP123",
  "message": {
    "tag": "interactive_message",
    "interactive_message": {
      "elements": [
        {
          "tag": "header",
          "text": {
            "content": "Task Assignment",
            "tag": "plain_text"
          }
        },
        {
          "tag": "section",
          "text": {
            "content": "You have been assigned a new task.",
            "tag": "plain_text"
          }
        },
        {
          "tag": "action",
          "elements": [
            {
              "tag": "button",
              "text": {
                "content": "Accept",
                "tag": "plain_text"
              },
              "value": "accept_task"
            }
          ]
        }
      ]
    }
  }
}

Copy
Response:
{
  "code": 0,
  "message_id": "msg125"
}

Copy
Error Codes
All API responses include a `code` field that indicates the status of the request:

Code	Description
0	Success
2	Server error
5	Resource not found
8	Server error
100	
App access token is expired or invalid
101	
API is rejected due to rate limit control
102	
Request body contains invalid input
103	
App permission denied
104	
Bot capability is not turned on
105	
App is not online
Auth-specific errors
Code	Description
1000	
App Secret is invalid
2000	
Single Sign-On Token is expired or invalid
2001	
User is not an employee of the current company
2002	
Token belongs to another app
2003	
Cursor invalid
2004	
Cursor expired
User-specific errors
Code	Description
3000	
User not found with the current email
3001	
User not found with the current code
3002	
User is not a subscriber of the bot
3003	
User is not signed in to SeaTalk
3004	
Invalid custom field name
Message-specific errors
Code	Description
4000	
Message type is invalid
4001	
Message exceeds the maximum length
4002	
Message sending failed
4003	
Message cannot be empty
4004	
Fail to fetch the quoted message due to SeaTalk's internal error
4005	
The quoted message cannot be found
4009	
Message cannot be found via the message id provided
4010	
The thread cannot be found
4011	
Mention everyone (@all) is not allowed in thread replies
4012	
No permission to update this message
App-specific errors
Code	Description
5000	
appID mismatch
5001	
linkID expired
5002	
App not released yet
5003	
App link amount has reached the upper limit
Group chat errors
Code	Description
7000	
Group chat not found with the current code
7001	
Bot is not a member of the group chat