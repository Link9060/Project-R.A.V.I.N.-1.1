export const ARROW_TOOL_DEFINITIONS = [
  {
    type: "function",
    function: {
      name: "arrow_list_tasks",
      description:
        "List the signed-in user's shared ARROW tasks from the canonical task store used by Waypoint, Relay, and Arrow Control. Use this before completing a task when you need its id.",
      parameters: {
        type: "object",
        properties: {
          status: {
            type: "string",
            enum: ["open", "completed", "all"],
            description: "Which tasks to return. Defaults to open."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 50,
            description: "Maximum number of tasks to return. Defaults to 20."
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "arrow_create_task",
      description:
        "Create a task in ARROW's shared task store so it appears everywhere, including Waypoint, Relay, and Arrow Control.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            minLength: 1,
            maxLength: 240,
            description: "Task title."
          },
          due_on: {
            type: "string",
            description: "Due date in YYYY-MM-DD format. Omit for today."
          },
          estimated_minutes: {
            type: "integer",
            minimum: 1,
            maximum: 1440,
            description: "Optional estimate in minutes."
          }
        },
        required: ["title"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "arrow_complete_task",
      description:
        "Mark one shared ARROW task complete or incomplete. Use arrow_list_tasks first if the task id is not already known.",
      parameters: {
        type: "object",
        properties: {
          id: {
            type: "string",
            description: "Task UUID."
          },
          completed: {
            type: "boolean",
            description: "True to complete the task; false to reopen it."
          }
        },
        required: ["id", "completed"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "arrow_list_calendar",
      description:
        "List the signed-in user's shared ARROW calendar events. These are the same events surfaced by Waypoint, Relay, and Arrow Control.",
      parameters: {
        type: "object",
        properties: {
          from_date: {
            type: "string",
            description: "Optional first date in YYYY-MM-DD format."
          },
          to_date: {
            type: "string",
            description: "Optional last date in YYYY-MM-DD format."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 80,
            description: "Maximum number of events. Defaults to 30."
          }
        },
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "arrow_create_event",
      description:
        "Create an event in ARROW's shared calendar so it appears everywhere.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            minLength: 1,
            maxLength: 240,
            description: "Event title."
          },
          event_date: {
            type: "string",
            description: "Event date in YYYY-MM-DD format."
          },
          start_time: {
            type: "string",
            description: "Optional local start time in HH:MM 24-hour format."
          },
          end_time: {
            type: "string",
            description: "Optional local end time in HH:MM 24-hour format."
          },
          details: {
            type: "string",
            maxLength: 2000,
            description: "Optional event details."
          }
        },
        required: ["title", "event_date"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "arrow_create_note",
      description:
        "Create a shared ARROW note. The note is stored once, then Field indexes it for RAVIN/Atlas according to the user's source permissions.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            minLength: 1,
            maxLength: 120,
            description: "Note title."
          },
          content: {
            type: "string",
            minLength: 1,
            maxLength: 12000,
            description: "Plain-text note content."
          }
        },
        required: ["title", "content"],
        additionalProperties: false
      }
    }
  },
  {
    type: "function",
    function: {
      name: "arrow_search_field",
      description:
        "Search the signed-in user's RAVIN-readable ARROW Field across notes, tasks, calendar items, projects, files, and other indexed sources. Relay private chats are not included unless they are explicitly indexed and permitted by the user.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            minLength: 1,
            maxLength: 300,
            description: "What to search for."
          },
          limit: {
            type: "integer",
            minimum: 1,
            maximum: 20,
            description: "Maximum number of matching Field items. Defaults to 8."
          }
        },
        required: ["query"],
        additionalProperties: false
      }
    }
  }
];

export const ARROW_TOOL_NAMES = new Set(
  ARROW_TOOL_DEFINITIONS.map((tool) => tool.function.name)
);
