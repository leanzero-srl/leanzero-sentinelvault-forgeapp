# Confluence Events for Forge Apps

This document covers all event types available for Confluence Forge apps, including their event names, required OAuth scopes, payload formats, type references, and examples.

---

## Table of Contents

1. [Pages, Live Docs, and Blog Posts](#1-pages-live-docs-and-blog-posts)
2. [Whiteboards, Databases, Smart Links, and Folders](#2-whiteboards-databases-smart-links-and-folders)
3. [Inline Tasks](#3-inline-tasks)
4. [Comments](#4-comments)
5. [Spaces](#5-spaces)
6. [Attachments](#6-attachments)
7. [Custom Content](#7-custom-content)
8. [Labels](#8-labels)
9. [Users](#9-users)
10. [Groups](#10-groups)
11. [Relations](#11-relations)
12. [Search](#12-search)

---

## Common Type Definitions

The following TypeScript interfaces are shared across multiple event categories.

```typescript
interface Space {
  id: string;
  key: string;
  name: string;
  type: "global" | "personal";
  status: "current" | "archived";
  icon: Image | null;
}

interface History {
  createdBy: User;
  createdDate: string; // ISO 8601 date string
}

interface Version {
  number: number;
  message: string;
  minorEdit: boolean;
  createdBy: User;
  createdDate: string; // ISO 8601 date string
}

interface User {
  type: "known" | "unknown" | "anonymous" | "user";
  accountId: string;
  accountType: "atlassian" | "app";
  email: string;
  publicName: string;
  profilePicture: Image;
  displayName: string;
  isExternalCollaborator: boolean;
}

interface Image {
  path: string;
  width: number;
  height: number;
  isDefault: boolean;
}
```

---

## 1. Pages, Live Docs, and Blog Posts

### Event Names

#### Pages

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:page` |
| Updated | `avi:confluence:updated:page` |
| Liked | `avi:confluence:liked:page` |
| Viewed | `avi:confluence:viewed:page` |
| Archived | `avi:confluence:archived:page` |
| Unarchived | `avi:confluence:unarchived:page` |
| Moved | `avi:confluence:moved:page` |
| Copied | `avi:confluence:copied:page` |
| Children Reordered | `avi:confluence:children_reordered:page` |
| Permissions Updated | `avi:confluence:permissions_updated:page` |
| Trashed | `avi:confluence:trashed:page` |
| Restored | `avi:confluence:restored:page` |
| Deleted | `avi:confluence:deleted:page` |

#### Live Docs

| Event | Event Name |
|---|---|
| Initialized | `avi:confluence:initialized:page` |
| Started | `avi:confluence:started:page` |
| Snapshotted | `avi:confluence:snapshotted:page` |
| Published | `avi:confluence:published:page` |

Live docs have `subType` set to `"live"` in their `Content` object.

#### Blog Posts

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:blogpost` |
| Updated | `avi:confluence:updated:blogpost` |
| Liked | `avi:confluence:liked:blogpost` |
| Viewed | `avi:confluence:viewed:blogpost` |
| Archived | `avi:confluence:archived:blogpost` |
| Unarchived | `avi:confluence:unarchived:blogpost` |
| Moved | `avi:confluence:moved:blogpost` |
| Copied | `avi:confluence:copied:blogpost` |
| Children Reordered | `avi:confluence:children_reordered:blogpost` |
| Permissions Updated | `avi:confluence:permissions_updated:blogpost` |
| Trashed | `avi:confluence:trashed:blogpost` |
| Restored | `avi:confluence:restored:blogpost` |
| Deleted | `avi:confluence:deleted:blogpost` |

### Required OAuth Scopes

- `read:confluence-content.summary` -- required for all events.
- `write:confluence-content` -- additionally required for `trashed` and `deleted` events.

### Payload

```typescript
interface PageOrBlogPostEventPayload {
  eventType: string;
  atlassianId: string;
  eventCreatedDate: string; // ISO 8601 date string
  suppressNotifications?: boolean;
  updateTrigger?: "edit_page" | "unknown"; // present on update events
  content: Content;
  prevContent?: Content;          // present on moved events (previous parent/space)
  originContentId?: string;       // present on copied events
  oldSortedChildPageIds?: string[]; // present on children_reordered events
  newSortedChildPageIds?: string[]; // present on children_reordered events
}

interface Content {
  id: string;
  type: "blogpost" | "page";
  subType?: "live";
  status: "current" | "draft" | "trashed" | "deleted" | "archived";
  title: string;
  space: Space;
  history: History;
  version: Version;
}
```

### Example

```json
{
  "eventType": "avi:confluence:created:page",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T10:15:30.000Z",
  "content": {
    "id": "123456",
    "type": "page",
    "status": "current",
    "title": "Project Requirements",
    "space": {
      "id": "65540",
      "key": "DEV",
      "name": "Development",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T10:15:30.000Z"
    },
    "version": {
      "number": 1,
      "message": "",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T10:15:30.000Z"
    }
  }
}
```

#### Example: Update Event

```json
{
  "eventType": "avi:confluence:updated:page",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-21T14:00:00.000Z",
  "suppressNotifications": false,
  "updateTrigger": "edit_page",
  "content": {
    "id": "123456",
    "type": "page",
    "status": "current",
    "title": "Project Requirements (Revised)",
    "space": {
      "id": "65540",
      "key": "DEV",
      "name": "Development",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T10:15:30.000Z"
    },
    "version": {
      "number": 2,
      "message": "Updated requirements section",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-21T14:00:00.000Z"
    }
  }
}
```

#### Example: Moved Event

```json
{
  "eventType": "avi:confluence:moved:page",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-22T09:00:00.000Z",
  "content": {
    "id": "123456",
    "type": "page",
    "status": "current",
    "title": "Project Requirements",
    "space": {
      "id": "65541",
      "key": "PROD",
      "name": "Production",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T10:15:30.000Z"
    },
    "version": {
      "number": 3,
      "message": "",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-22T09:00:00.000Z"
    }
  },
  "prevContent": {
    "id": "123456",
    "type": "page",
    "status": "current",
    "title": "Project Requirements",
    "space": {
      "id": "65540",
      "key": "DEV",
      "name": "Development",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T10:15:30.000Z"
    },
    "version": {
      "number": 2,
      "message": "",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-21T14:00:00.000Z"
    }
  }
}
```

#### Example: Children Reordered Event

```json
{
  "eventType": "avi:confluence:children_reordered:page",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-22T11:00:00.000Z",
  "content": {
    "id": "123456",
    "type": "page",
    "status": "current",
    "title": "Parent Page",
    "space": {
      "id": "65540",
      "key": "DEV",
      "name": "Development",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T10:15:30.000Z"
    },
    "version": {
      "number": 1,
      "message": "",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T10:15:30.000Z"
    }
  },
  "oldSortedChildPageIds": ["200001", "200002", "200003"],
  "newSortedChildPageIds": ["200003", "200001", "200002"]
}
```

#### Example: Live Doc Initialized

```json
{
  "eventType": "avi:confluence:initialized:page",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-23T08:00:00.000Z",
  "content": {
    "id": "789012",
    "type": "page",
    "subType": "live",
    "status": "current",
    "title": "Sprint Planning Live Doc",
    "space": {
      "id": "65540",
      "key": "DEV",
      "name": "Development",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-23T08:00:00.000Z"
    },
    "version": {
      "number": 1,
      "message": "",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-23T08:00:00.000Z"
    }
  }
}
```

---

## 2. Whiteboards, Databases, Smart Links, and Folders

### Event Names

#### Whiteboards

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:whiteboard` |
| Moved | `avi:confluence:moved:whiteboard` |
| Copied | `avi:confluence:copied:whiteboard` |
| Permissions Updated | `avi:confluence:permissions_updated:whiteboard` |

#### Databases

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:database` |
| Moved | `avi:confluence:moved:database` |
| Copied | `avi:confluence:copied:database` |
| Permissions Updated | `avi:confluence:permissions_updated:database` |

#### Smart Links

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:embed` |
| Moved | `avi:confluence:moved:embed` |
| Copied | `avi:confluence:copied:embed` |
| Permissions Updated | `avi:confluence:permissions_updated:embed` |

#### Folders

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:folder` |
| Moved | `avi:confluence:moved:folder` |
| Copied | `avi:confluence:copied:folder` |
| Permissions Updated | `avi:confluence:permissions_updated:folder` |

### Required OAuth Scopes

- `read:confluence-content.summary`

### Payload

The payload format for whiteboards, databases, smart links, and folders follows the same structure as pages and blog posts. See the [PageOrBlogPostEventPayload](#payload) interface in section 1.

The `content.type` field will reflect the content type:

- Whiteboards: `"whiteboard"`
- Databases: `"database"`
- Smart links: `"embed"`
- Folders: `"folder"`

### Example

```json
{
  "eventType": "avi:confluence:created:whiteboard",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T12:00:00.000Z",
  "content": {
    "id": "456789",
    "type": "whiteboard",
    "status": "current",
    "title": "Architecture Diagram",
    "space": {
      "id": "65540",
      "key": "DEV",
      "name": "Development",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T12:00:00.000Z"
    },
    "version": {
      "number": 1,
      "message": "",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T12:00:00.000Z"
    }
  }
}
```

---

## 3. Inline Tasks

### Event Names

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:task` |
| Updated | `avi:confluence:updated:task` |
| Removed | `avi:confluence:removed:task` |

### Required OAuth Scopes

- `read:confluence-content.all`

### Payload

```typescript
interface TaskEventPayload {
  eventType: string;
  atlassianId: string;
  eventCreatedDate: string;
  task: Task;
  oldTask?: Task;    // present on updated events
  content: Content;  // the page or blog post containing the task
}

interface Task {
  id: string;
  uuid: string;
  status: number;           // 0 = incomplete, 1 = complete
  statusAsString: string;   // "INCOMPLETE" | "COMPLETE"
  assignee: string | null;  // account ID of the assigned user, or null
  dueDate: string | null;   // ISO 8601 date string, or null
}
```

### Example

```json
{
  "eventType": "avi:confluence:created:task",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T15:30:00.000Z",
  "task": {
    "id": "100",
    "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": 0,
    "statusAsString": "INCOMPLETE",
    "assignee": "5b10ac8d82e05b22cc7d4ef5",
    "dueDate": "2026-04-01T00:00:00.000Z"
  },
  "content": {
    "id": "123456",
    "type": "page",
    "status": "current",
    "title": "Sprint Tasks",
    "space": {
      "id": "65540",
      "key": "DEV",
      "name": "Development",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T10:15:30.000Z"
    },
    "version": {
      "number": 5,
      "message": "",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T15:30:00.000Z"
    }
  }
}
```

#### Example: Updated Event (with oldTask)

```json
{
  "eventType": "avi:confluence:updated:task",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-21T09:00:00.000Z",
  "task": {
    "id": "100",
    "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": 1,
    "statusAsString": "COMPLETE",
    "assignee": "5b10ac8d82e05b22cc7d4ef5",
    "dueDate": "2026-04-01T00:00:00.000Z"
  },
  "oldTask": {
    "id": "100",
    "uuid": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    "status": 0,
    "statusAsString": "INCOMPLETE",
    "assignee": "5b10ac8d82e05b22cc7d4ef5",
    "dueDate": "2026-04-01T00:00:00.000Z"
  },
  "content": {
    "id": "123456",
    "type": "page",
    "status": "current",
    "title": "Sprint Tasks",
    "space": {
      "id": "65540",
      "key": "DEV",
      "name": "Development",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T10:15:30.000Z"
    },
    "version": {
      "number": 5,
      "message": "",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T15:30:00.000Z"
    }
  }
}
```

---

## 4. Comments

### Event Names

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:comment` |
| Updated | `avi:confluence:updated:comment` |
| Liked | `avi:confluence:liked:comment` |
| Deleted | `avi:confluence:deleted:comment` |

### Required OAuth Scopes

- `read:confluence-content.summary`

### Payload

```typescript
interface CommentEventPayload {
  eventType: string;
  atlassianId: string;
  eventCreatedDate: string;
  content: CommentContent;
}

interface CommentContent {
  id: string;
  type: "comment";
  status: "current" | "deleted";
  title: string;
  space: Space;
  history: History;
  version: Version;
  ancestors: Content[];             // parent content hierarchy
  container: CommentContainer;
  extensions: CommentExtensions;
}

interface CommentContainer {
  id: string;
  type: "page" | "blogpost" | "attachment";
  status: string;
  title: string;
}

interface CommentExtensions {
  location: "inline" | "footer" | "resolved";
}
```

### Example

```json
{
  "eventType": "avi:confluence:created:comment",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T16:45:00.000Z",
  "content": {
    "id": "300100",
    "type": "comment",
    "status": "current",
    "title": "Re: Project Requirements",
    "space": {
      "id": "65540",
      "key": "DEV",
      "name": "Development",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T16:45:00.000Z"
    },
    "version": {
      "number": 1,
      "message": "",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T16:45:00.000Z"
    },
    "ancestors": [
      {
        "id": "123456",
        "type": "page",
        "status": "current",
        "title": "Project Requirements",
        "space": {
          "id": "65540",
          "key": "DEV",
          "name": "Development",
          "type": "global",
          "status": "current",
          "icon": null
        },
        "history": {
          "createdBy": {
            "type": "known",
            "accountId": "5b10ac8d82e05b22cc7d4ef5",
            "accountType": "atlassian",
            "email": "user@example.com",
            "publicName": "Jane Smith",
            "profilePicture": {
              "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
              "width": 48,
              "height": 48,
              "isDefault": false
            },
            "displayName": "Jane Smith",
            "isExternalCollaborator": false
          },
          "createdDate": "2026-03-20T10:15:30.000Z"
        },
        "version": {
          "number": 2,
          "message": "",
          "minorEdit": false,
          "createdBy": {
            "type": "known",
            "accountId": "5b10ac8d82e05b22cc7d4ef5",
            "accountType": "atlassian",
            "email": "user@example.com",
            "publicName": "Jane Smith",
            "profilePicture": {
              "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
              "width": 48,
              "height": 48,
              "isDefault": false
            },
            "displayName": "Jane Smith",
            "isExternalCollaborator": false
          },
          "createdDate": "2026-03-21T14:00:00.000Z"
        }
      }
    ],
    "container": {
      "id": "123456",
      "type": "page",
      "status": "current",
      "title": "Project Requirements"
    },
    "extensions": {
      "location": "inline"
    }
  }
}
```

---

## 5. Spaces

These are V2 space events.

### Event Names

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:space` |
| Updated | `avi:confluence:updated:space` |
| Permissions Updated | `avi:confluence:permissions_updated:space` |
| Deleted | `avi:confluence:deleted:space` |

### Required OAuth Scopes

- `read:confluence-space.summary` -- required for all events.
- `write:confluence-space` -- additionally required for `permissions_updated` and `deleted` events.

### Payload

```typescript
interface SpaceEventPayload {
  eventType: string;
  atlassianId: string;
  eventCreatedDate: string;
  space: SpaceDetail;
}

interface SpaceDetail {
  id: string;
  key: string;
  name: string;
  type: "global" | "personal";
  status: "current" | "archived";
  icon: Image | null;
  history: History;
}
```

### Example

```json
{
  "eventType": "avi:confluence:created:space",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T08:00:00.000Z",
  "space": {
    "id": "65542",
    "key": "QA",
    "name": "Quality Assurance",
    "type": "global",
    "status": "current",
    "icon": null,
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T08:00:00.000Z"
    }
  }
}
```

---

## 6. Attachments

### Event Names

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:attachment` |
| Updated | `avi:confluence:updated:attachment` |
| Viewed | `avi:confluence:viewed:attachment` |
| Archived | `avi:confluence:archived:attachment` |
| Unarchived | `avi:confluence:unarchived:attachment` |
| Trashed | `avi:confluence:trashed:attachment` |
| Restored | `avi:confluence:restored:attachment` |
| Deleted | `avi:confluence:deleted:attachment` |

### Required OAuth Scopes

- `read:confluence-content.summary`

### Payload

```typescript
interface AttachmentEventPayload {
  eventType: string;
  atlassianId: string;
  eventCreatedDate: string;
  attachment: Attachment;
}

interface Attachment {
  id: string;
  type: "attachment";
  status: "current" | "trashed" | "deleted" | "archived";
  title: string;
  space: Space;
  history: History;
  version: Version;
  container: AttachmentContainer;
  extensions: AttachmentExtensions;
}

interface AttachmentContainer {
  id: string;
  type: "page" | "blogpost" | "whiteboard" | "database" | "embed" | "folder";
  status: string;
  title: string;
}

interface AttachmentExtensions {
  mediaType: string;       // MIME type, e.g. "image/png"
  fileSize: number;        // size in bytes
  fileId: string;          // unique file identifier
  downloadPath: string;    // relative download URL path
  comment: string;         // upload comment
  mediaTypeDescription: string; // human-readable media type description
}
```

### Example

```json
{
  "eventType": "avi:confluence:created:attachment",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T13:00:00.000Z",
  "attachment": {
    "id": "att500100",
    "type": "attachment",
    "status": "current",
    "title": "architecture-diagram.png",
    "space": {
      "id": "65540",
      "key": "DEV",
      "name": "Development",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T13:00:00.000Z"
    },
    "version": {
      "number": 1,
      "message": "Initial upload",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T13:00:00.000Z"
    },
    "container": {
      "id": "123456",
      "type": "page",
      "status": "current",
      "title": "Project Requirements"
    },
    "extensions": {
      "mediaType": "image/png",
      "fileSize": 245760,
      "fileId": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
      "downloadPath": "/wiki/download/attachments/123456/architecture-diagram.png",
      "comment": "Initial upload",
      "mediaTypeDescription": "PNG Image"
    }
  }
}
```

---

## 7. Custom Content

### Event Names

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:custom_content` |
| Updated | `avi:confluence:updated:custom_content` |
| Permissions Updated | `avi:confluence:permissions_updated:custom_content` |
| Trashed | `avi:confluence:trashed:custom_content` |
| Restored | `avi:confluence:restored:custom_content` |
| Deleted | `avi:confluence:deleted:custom_content` |

### Required OAuth Scopes

- `read:confluence-content.summary`

### Payload

```typescript
interface CustomContentEventPayload {
  eventType: string;
  atlassianId: string;
  eventCreatedDate: string;
  content: CustomContent;
}

interface CustomContent {
  id: string;
  type: string;           // the custom content type key
  status: "current" | "trashed" | "deleted";
  title: string;
  space: Space;
  history: History;
  version: Version;
}
```

### Example

```json
{
  "eventType": "avi:confluence:created:custom_content",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T14:00:00.000Z",
  "content": {
    "id": "cc-900100",
    "type": "ac:my-app:custom-type",
    "status": "current",
    "title": "Custom Data Entry",
    "space": {
      "id": "65540",
      "key": "DEV",
      "name": "Development",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T14:00:00.000Z"
    },
    "version": {
      "number": 1,
      "message": "",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T14:00:00.000Z"
    }
  }
}
```

---

## 8. Labels

### Event Names

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:label` |
| Added | `avi:confluence:added:label` |
| Removed | `avi:confluence:removed:label` |
| Deleted | `avi:confluence:deleted:label` |

### Required OAuth Scopes

- `read:confluence-content.summary`
- `read:confluence-space.summary`

### Payload

The payload contains a `label` object and exactly ONE of `content`, `space`, or `template` to indicate where the label was applied.

```typescript
interface LabelEventPayload {
  eventType: string;
  atlassianId: string;
  eventCreatedDate: string;
  label: Label;
  content?: Content;   // present if label is on a content item
  space?: Space;       // present if label is on a space
  template?: Template; // present if label is on a template
}

interface Label {
  id: string;
  prefix: string;     // "global", "my", or "team"
  name: string;
  label: string;      // the full label string (prefix:name)
}

interface Template {
  id: string;
  name: string;
  type: "page" | "blogpost";
  space: Space | null;
}
```

### Example: Label Added to Content

```json
{
  "eventType": "avi:confluence:added:label",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T17:00:00.000Z",
  "label": {
    "id": "lbl-1001",
    "prefix": "global",
    "name": "important",
    "label": "global:important"
  },
  "content": {
    "id": "123456",
    "type": "page",
    "status": "current",
    "title": "Project Requirements",
    "space": {
      "id": "65540",
      "key": "DEV",
      "name": "Development",
      "type": "global",
      "status": "current",
      "icon": null
    },
    "history": {
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-20T10:15:30.000Z"
    },
    "version": {
      "number": 2,
      "message": "",
      "minorEdit": false,
      "createdBy": {
        "type": "known",
        "accountId": "5b10ac8d82e05b22cc7d4ef5",
        "accountType": "atlassian",
        "email": "user@example.com",
        "publicName": "Jane Smith",
        "profilePicture": {
          "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
          "width": 48,
          "height": 48,
          "isDefault": false
        },
        "displayName": "Jane Smith",
        "isExternalCollaborator": false
      },
      "createdDate": "2026-03-21T14:00:00.000Z"
    }
  }
}
```

### Example: Label Added to Space

```json
{
  "eventType": "avi:confluence:added:label",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T17:30:00.000Z",
  "label": {
    "id": "lbl-1002",
    "prefix": "global",
    "name": "active-project",
    "label": "global:active-project"
  },
  "space": {
    "id": "65540",
    "key": "DEV",
    "name": "Development",
    "type": "global",
    "status": "current",
    "icon": null
  }
}
```

---

## 9. Users

### Event Names

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:user` |
| Deleted | `avi:confluence:deleted:user` |

### Required OAuth Scopes

- `read:confluence-user`

### Payload

```typescript
interface UserEventPayload {
  eventType: string;
  atlassianId: string;
  eventCreatedDate: string;
  user: User;
}
```

### Example

```json
{
  "eventType": "avi:confluence:created:user",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T09:00:00.000Z",
  "user": {
    "type": "known",
    "accountId": "5b10ac8d82e05b22cc7d4ef6",
    "accountType": "atlassian",
    "email": "newuser@example.com",
    "publicName": "John Doe",
    "profilePicture": {
      "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef6",
      "width": 48,
      "height": 48,
      "isDefault": true
    },
    "displayName": "John Doe",
    "isExternalCollaborator": false
  }
}
```

---

## 10. Groups

### Event Names

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:group` |
| Deleted | `avi:confluence:deleted:group` |

### Required OAuth Scopes

- `read:confluence-groups`

### Payload

```typescript
interface GroupEventPayload {
  eventType: string;
  atlassianId: string;
  eventCreatedDate: string;
  group: Group;
}

interface Group {
  id: string;
  name: string;
  type: "group";
}
```

### Example

```json
{
  "eventType": "avi:confluence:created:group",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T07:00:00.000Z",
  "group": {
    "id": "grp-2001",
    "name": "confluence-developers",
    "type": "group"
  }
}
```

---

## 11. Relations

### Event Names

| Event | Event Name |
|---|---|
| Created | `avi:confluence:created:relation` |
| Deleted | `avi:confluence:deleted:relation` |

### Required OAuth Scopes

- `read:confluence-content.summary`
- `read:confluence-space.summary`
- `read:confluence-user`

### Payload

```typescript
interface RelationEventPayload {
  eventType: string;
  atlassianId: string;
  eventCreatedDate: string;
  relationName: string;       // e.g. "favourite", "related"
  relationData: object | null;
  source: EntityWrapper;
  target: EntityWrapper;
}

interface EntityWrapper {
  // Exactly one of the following will be present
  content?: Content;
  space?: Space;
  user?: User;
}
```

The `source` and `target` are `EntityWrapper` objects, each containing exactly one of `content`, `space`, or `user` depending on the entities involved in the relation.

### Example: Favourite Relation (User to Content)

```json
{
  "eventType": "avi:confluence:created:relation",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T18:00:00.000Z",
  "relationName": "favourite",
  "relationData": null,
  "source": {
    "user": {
      "type": "known",
      "accountId": "5b10ac8d82e05b22cc7d4ef5",
      "accountType": "atlassian",
      "email": "user@example.com",
      "publicName": "Jane Smith",
      "profilePicture": {
        "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
        "width": 48,
        "height": 48,
        "isDefault": false
      },
      "displayName": "Jane Smith",
      "isExternalCollaborator": false
    }
  },
  "target": {
    "content": {
      "id": "123456",
      "type": "page",
      "status": "current",
      "title": "Project Requirements",
      "space": {
        "id": "65540",
        "key": "DEV",
        "name": "Development",
        "type": "global",
        "status": "current",
        "icon": null
      },
      "history": {
        "createdBy": {
          "type": "known",
          "accountId": "5b10ac8d82e05b22cc7d4ef5",
          "accountType": "atlassian",
          "email": "user@example.com",
          "publicName": "Jane Smith",
          "profilePicture": {
            "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
            "width": 48,
            "height": 48,
            "isDefault": false
          },
          "displayName": "Jane Smith",
          "isExternalCollaborator": false
        },
        "createdDate": "2026-03-20T10:15:30.000Z"
      },
      "version": {
        "number": 2,
        "message": "",
        "minorEdit": false,
        "createdBy": {
          "type": "known",
          "accountId": "5b10ac8d82e05b22cc7d4ef5",
          "accountType": "atlassian",
          "email": "user@example.com",
          "publicName": "Jane Smith",
          "profilePicture": {
            "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
            "width": 48,
            "height": 48,
            "isDefault": false
          },
          "displayName": "Jane Smith",
          "isExternalCollaborator": false
        },
        "createdDate": "2026-03-21T14:00:00.000Z"
      }
    }
  }
}
```

### Example: Related Content Relation

```json
{
  "eventType": "avi:confluence:created:relation",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T18:30:00.000Z",
  "relationName": "related",
  "relationData": null,
  "source": {
    "content": {
      "id": "123456",
      "type": "page",
      "status": "current",
      "title": "Project Requirements",
      "space": {
        "id": "65540",
        "key": "DEV",
        "name": "Development",
        "type": "global",
        "status": "current",
        "icon": null
      },
      "history": {
        "createdBy": {
          "type": "known",
          "accountId": "5b10ac8d82e05b22cc7d4ef5",
          "accountType": "atlassian",
          "email": "user@example.com",
          "publicName": "Jane Smith",
          "profilePicture": {
            "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
            "width": 48,
            "height": 48,
            "isDefault": false
          },
          "displayName": "Jane Smith",
          "isExternalCollaborator": false
        },
        "createdDate": "2026-03-20T10:15:30.000Z"
      },
      "version": {
        "number": 2,
        "message": "",
        "minorEdit": false,
        "createdBy": {
          "type": "known",
          "accountId": "5b10ac8d82e05b22cc7d4ef5",
          "accountType": "atlassian",
          "email": "user@example.com",
          "publicName": "Jane Smith",
          "profilePicture": {
            "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
            "width": 48,
            "height": 48,
            "isDefault": false
          },
          "displayName": "Jane Smith",
          "isExternalCollaborator": false
        },
        "createdDate": "2026-03-21T14:00:00.000Z"
      }
    }
  },
  "target": {
    "content": {
      "id": "654321",
      "type": "page",
      "status": "current",
      "title": "Technical Specifications",
      "space": {
        "id": "65540",
        "key": "DEV",
        "name": "Development",
        "type": "global",
        "status": "current",
        "icon": null
      },
      "history": {
        "createdBy": {
          "type": "known",
          "accountId": "5b10ac8d82e05b22cc7d4ef5",
          "accountType": "atlassian",
          "email": "user@example.com",
          "publicName": "Jane Smith",
          "profilePicture": {
            "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
            "width": 48,
            "height": 48,
            "isDefault": false
          },
          "displayName": "Jane Smith",
          "isExternalCollaborator": false
        },
        "createdDate": "2026-03-19T11:00:00.000Z"
      },
      "version": {
        "number": 3,
        "message": "",
        "minorEdit": false,
        "createdBy": {
          "type": "known",
          "accountId": "5b10ac8d82e05b22cc7d4ef5",
          "accountType": "atlassian",
          "email": "user@example.com",
          "publicName": "Jane Smith",
          "profilePicture": {
            "path": "/wiki/aa-avatar/5b10ac8d82e05b22cc7d4ef5",
            "width": 48,
            "height": 48,
            "isDefault": false
          },
          "displayName": "Jane Smith",
          "isExternalCollaborator": false
        },
        "createdDate": "2026-03-21T16:00:00.000Z"
      }
    }
  }
}
```

---

## 12. Search

### Event Names

| Event | Event Name |
|---|---|
| Performed | `avi:confluence:performed:search` |

### Required OAuth Scopes

- `search:confluence`

### Payload

```typescript
interface SearchEventPayload {
  eventType: string;
  atlassianId: string;
  eventCreatedDate: string;
  query: string;
  accountType: "atlassian" | "app";
  results: number;     // count of search results returned
}
```

### Example

```json
{
  "eventType": "avi:confluence:performed:search",
  "atlassianId": "5b10ac8d82e05b22cc7d4ef5",
  "eventCreatedDate": "2026-03-20T19:00:00.000Z",
  "query": "project requirements",
  "accountType": "atlassian",
  "results": 15
}
```

---

## Summary of OAuth Scopes

| Scope | Used By |
|---|---|
| `read:confluence-content.summary` | Pages, blog posts, whiteboards, databases, smart links, folders, comments, attachments, custom content, labels, relations |
| `read:confluence-content.all` | Inline tasks |
| `write:confluence-content` | Page/blog post trashed and deleted events |
| `read:confluence-space.summary` | Spaces, labels, relations |
| `write:confluence-space` | Space permissions_updated and deleted events |
| `read:confluence-user` | Users, relations |
| `read:confluence-groups` | Groups |
| `search:confluence` | Search |
