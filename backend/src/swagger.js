const swaggerJsdoc = require('swagger-jsdoc');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Senior Project Management System API',
      version: '1.0.0',
      description: 'API documentation for the Senior Project Management System',
    },
    servers: [
      {
        url: 'http://localhost:5001/api/v1',
        description: 'Development server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
    },
    tags: [
      { name: 'Auth', description: 'Authentication & user management' },
      { name: 'Onboarding', description: 'Student onboarding & account setup' },
      { name: 'Groups', description: 'Group lifecycle & membership' },
      { name: 'Advisor Requests', description: 'Advisor assignment flow' },
      { name: 'Committees', description: 'Committee creation & publishing' },
      { name: 'Deliverables', description: 'Deliverable submission & validation' },
      { name: 'Schedule Windows', description: 'Operation schedule management' },
      { name: 'Audit Logs', description: 'Audit trail & logging' },
    ],
    paths: {
      // ── AUTH ──────────────────────────────────────────────────────────────
      '/auth/login': {
        post: {
          tags: ['Auth'],
          summary: 'Login with email & password',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password'],
                  properties: {
                    email: { type: 'string', example: 'alice@university.edu' },
                    password: { type: 'string', example: 'Password123!' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Login successful, returns access & refresh tokens' },
            401: { description: 'Invalid credentials' },
          },
        },
      },
      '/auth/register': {
        post: {
          tags: ['Auth'],
          summary: 'Register a new student account',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'password', 'studentId'],
                  properties: {
                    email: { type: 'string', example: 'student@university.edu' },
                    password: { type: 'string', example: 'Password123!' },
                    studentId: { type: 'string', example: 'STU-2025-001' },
                  },
                },
              },
            },
          },
          responses: {
            201: { description: 'Account created' },
            400: { description: 'Validation error' },
          },
        },
      },
      '/auth/refresh': {
        post: {
          tags: ['Auth'],
          summary: 'Refresh access token',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['refreshToken'],
                  properties: { refreshToken: { type: 'string' } },
                },
              },
            },
          },
          responses: {
            200: { description: 'New access token returned' },
            401: { description: 'Invalid or expired refresh token' },
          },
        },
      },
      '/auth/logout': {
        post: {
          tags: ['Auth'],
          summary: 'Logout (invalidate refresh token)',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Logged out' }, 401: { description: 'Unauthorized' } },
        },
      },
      '/auth/change-password': {
        post: {
          tags: ['Auth'],
          summary: 'Change password',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['currentPassword', 'newPassword'],
                  properties: {
                    currentPassword: { type: 'string' },
                    newPassword: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Password changed' }, 400: { description: 'Validation error' } },
        },
      },
      '/auth/password-reset/request': {
        post: {
          tags: ['Auth'],
          summary: 'Request password reset email',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email'],
                  properties: { email: { type: 'string', example: 'alice@university.edu' } },
                },
              },
            },
          },
          responses: { 200: { description: 'Reset email sent' } },
        },
      },
      '/auth/password-reset/validate-token': {
        post: {
          tags: ['Auth'],
          summary: 'Validate password reset token',
          responses: { 200: { description: 'Token valid' }, 400: { description: 'Invalid/expired token' } },
        },
      },
      '/auth/password-reset/confirm': {
        post: {
          tags: ['Auth'],
          summary: 'Confirm password reset with new password',
          responses: { 200: { description: 'Password reset successful' } },
        },
      },
      '/auth/github/oauth/callback': {
        get: {
          tags: ['Auth'],
          summary: 'GitHub OAuth callback',
          responses: { 200: { description: 'OAuth handled' } },
        },
      },
      '/auth/github/oauth/initiate': {
        post: {
          tags: ['Auth'],
          summary: 'Initiate GitHub OAuth flow',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'OAuth URL returned' } },
        },
      },
      '/auth/professor/onboard': {
        post: {
          tags: ['Auth'],
          summary: 'Professor first-login onboarding (set permanent password)',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Onboarded' } },
        },
      },
      '/auth/users/professors': {
        get: {
          tags: ['Auth'],
          summary: 'List all professors',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Professor list' } },
        },
      },
      '/auth/admin/users': {
        get: {
          tags: ['Auth'],
          summary: 'Admin — list all users',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'User list' } },
        },
      },
      '/auth/admin/professor/create': {
        post: {
          tags: ['Auth'],
          summary: 'Admin — create professor account (sends temp password via email)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['email', 'firstName', 'lastName'],
                  properties: {
                    email: { type: 'string', example: 'prof.new@university.edu' },
                    firstName: { type: 'string', example: 'Jane' },
                    lastName: { type: 'string', example: 'Doe' },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'Professor account created' } },
        },
      },
      '/auth/password-reset/admin-initiate': {
        post: {
          tags: ['Auth'],
          summary: 'Admin — force password reset for a user',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Reset initiated' } },
        },
      },

      // ── ONBOARDING ────────────────────────────────────────────────────────
      '/onboarding/validate-student-id': {
        post: {
          tags: ['Onboarding'],
          summary: 'Validate student ID against whitelist',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['studentId'],
                  properties: { studentId: { type: 'string', example: 'STU-2025-001' } },
                },
              },
            },
          },
          responses: { 200: { description: 'Valid student ID' }, 404: { description: 'Not found in whitelist' } },
        },
      },
      '/onboarding/verify-email': {
        post: {
          tags: ['Onboarding'],
          summary: 'Verify email with token',
          responses: { 200: { description: 'Email verified' } },
        },
      },
      '/onboarding/send-verification-email': {
        post: {
          tags: ['Onboarding'],
          summary: 'Send email verification link',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Email sent' } },
        },
      },
      '/onboarding/complete': {
        post: {
          tags: ['Onboarding'],
          summary: 'Complete onboarding',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Onboarding complete' } },
        },
      },
      '/onboarding/accounts/{userId}': {
        get: {
          tags: ['Onboarding'],
          summary: 'Get user account details',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Account details' } },
        },
        patch: {
          tags: ['Onboarding'],
          summary: 'Update user account',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'userId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Updated' } },
        },
      },
      '/onboarding/upload-student-ids': {
        post: {
          tags: ['Onboarding'],
          summary: 'Admin/Coordinator — bulk upload student IDs via CSV',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } },
              },
            },
          },
          responses: { 200: { description: 'Upload processed' } },
        },
      },

      // ── GROUPS ────────────────────────────────────────────────────────────
      '/groups': {
        post: {
          tags: ['Groups'],
          summary: 'Create a new group (student only)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['groupName'],
                  properties: {
                    groupName: { type: 'string', example: 'Alpha Team' },
                    githubOrg: { type: 'string' },
                    githubPat: { type: 'string' },
                    jiraUrl: { type: 'string' },
                    jiraUsername: { type: 'string' },
                    jiraToken: { type: 'string' },
                    projectKey: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'Group created' } },
        },
        get: {
          tags: ['Groups'],
          summary: 'List all groups (coordinator only)',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Group list' } },
        },
      },
      '/groups/pending-invitation': {
        get: {
          tags: ['Groups'],
          summary: "Get current user's pending group invitation",
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Pending invitation or null' } },
        },
      },
      '/groups/advisor-sanitization': {
        post: {
          tags: ['Groups'],
          summary: 'Disband groups without advisor after deadline (coordinator/admin)',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Sanitization result' } },
        },
      },
      '/groups/{groupId}': {
        get: {
          tags: ['Groups'],
          summary: 'Get group details',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Group details' } },
        },
      },
      '/groups/{groupId}/committee-status': {
        get: {
          tags: ['Groups'],
          summary: 'Get committee status for a group',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Committee status' } },
        },
      },
      '/groups/{groupId}/members': {
        post: {
          tags: ['Groups'],
          summary: 'Add/invite a member to the group',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 201: { description: 'Member invited' } },
        },
        get: {
          tags: ['Groups'],
          summary: 'List group members',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Member list' } },
        },
      },
      '/groups/{groupId}/member-requests': {
        post: {
          tags: ['Groups'],
          summary: 'Student requests to join a group',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 201: { description: 'Request submitted' } },
        },
      },
      '/groups/{groupId}/member-requests/{requestId}': {
        patch: {
          tags: ['Groups'],
          summary: 'Leader decides on a join request',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'groupId', in: 'path', required: true, schema: { type: 'string' } },
            { name: 'requestId', in: 'path', required: true, schema: { type: 'string' } },
          ],
          responses: { 200: { description: 'Decision recorded' } },
        },
      },
      '/groups/{groupId}/membership-decisions': {
        post: {
          tags: ['Groups'],
          summary: 'Student accepts or rejects a group invitation',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Decision recorded' } },
        },
      },
      '/groups/{groupId}/approvals': {
        get: {
          tags: ['Groups'],
          summary: 'Get approval queue for a group',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Approval records' } },
        },
      },
      '/groups/{groupId}/approval-results': {
        post: {
          tags: ['Groups'],
          summary: 'Forward approval results (professor/admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Results forwarded' } },
        },
      },
      '/groups/{groupId}/notifications': {
        post: {
          tags: ['Groups'],
          summary: 'Dispatch notification for a group event',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Notification dispatched' } },
        },
      },
      '/groups/{groupId}/github': {
        post: {
          tags: ['Groups'],
          summary: 'Configure GitHub integration for group',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'GitHub configured' } },
        },
        get: {
          tags: ['Groups'],
          summary: 'Get GitHub integration details',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'GitHub details' } },
        },
      },
      '/groups/{groupId}/jira': {
        post: {
          tags: ['Groups'],
          summary: 'Configure Jira integration for group',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Jira configured' } },
        },
        get: {
          tags: ['Groups'],
          summary: 'Get Jira integration details',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Jira details' } },
        },
      },
      '/groups/{groupId}/override': {
        patch: {
          tags: ['Groups'],
          summary: 'Coordinator override on group',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Override applied' } },
        },
      },
      '/groups/{groupId}/status': {
        get: {
          tags: ['Groups'],
          summary: 'Get group status',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Status info' } },
        },
        patch: {
          tags: ['Groups'],
          summary: 'Transition group status (coordinator/professor/admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Status updated' } },
        },
      },
      '/groups/{groupId}/deliverables': {
        post: {
          tags: ['Groups'],
          summary: 'Submit a deliverable for a group',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 202: { description: 'Deliverable submitted' } },
        },
      },
      '/groups/{groupId}/advisor': {
        delete: {
          tags: ['Groups'],
          summary: 'Release current advisor from group',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Advisor released' } },
        },
      },
      '/groups/{groupId}/advisor/transfer': {
        post: {
          tags: ['Groups'],
          summary: 'Coordinator transfers advisor to another professor',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'groupId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Advisor transferred' } },
        },
      },

      // ── ADVISOR REQUESTS ──────────────────────────────────────────────────
      '/advisor-requests': {
        post: {
          tags: ['Advisor Requests'],
          summary: 'Student submits advisor request to a professor',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['groupId', 'professorId'],
                  properties: {
                    groupId: { type: 'string' },
                    professorId: { type: 'string' },
                    message: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'Request submitted' } },
        },
      },
      '/advisor-requests/mine': {
        get: {
          tags: ['Advisor Requests'],
          summary: 'Professor — list all advisor requests received',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Request list' } },
        },
      },
      '/advisor-requests/pending': {
        get: {
          tags: ['Advisor Requests'],
          summary: 'Professor — list pending advisor requests',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Pending requests' } },
        },
      },
      '/advisor-requests/{requestId}': {
        patch: {
          tags: ['Advisor Requests'],
          summary: 'Professor approves or rejects an advisor request',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'requestId', in: 'path', required: true, schema: { type: 'string' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['decision'],
                  properties: {
                    decision: { type: 'string', enum: ['approved', 'rejected'] },
                    reason: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 200: { description: 'Decision recorded' } },
        },
      },

      // ── COMMITTEES ────────────────────────────────────────────────────────
      '/committees': {
        post: {
          tags: ['Committees'],
          summary: 'Create a committee draft (coordinator)',
          security: [{ bearerAuth: [] }],
          responses: { 201: { description: 'Committee created' } },
        },
      },
      '/committees/{committeeId}': {
        get: {
          tags: ['Committees'],
          summary: 'Get committee details',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'committeeId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Committee details' } },
        },
      },
      '/committees/{committeeId}/advisors': {
        post: {
          tags: ['Committees'],
          summary: 'Assign advisors to committee (coordinator)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'committeeId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Advisors assigned' } },
        },
      },
      '/committees/{committeeId}/jury': {
        post: {
          tags: ['Committees'],
          summary: 'Assign jury members to committee (coordinator)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'committeeId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Jury assigned' } },
        },
      },
      '/committees/{committeeId}/validate': {
        post: {
          tags: ['Committees'],
          summary: 'Validate committee (coordinator)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'committeeId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Validation result' } },
        },
      },
      '/committees/{committeeId}/publish': {
        post: {
          tags: ['Committees'],
          summary: 'Publish committee — notifies all members (coordinator)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'committeeId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Published' } },
        },
      },

      // ── DELIVERABLES ──────────────────────────────────────────────────────
      '/deliverables': {
        get: {
          tags: ['Deliverables'],
          summary: 'List deliverables for a group (paginated)',
          security: [{ bearerAuth: [] }],
          parameters: [
            { name: 'groupId', in: 'query', required: false, schema: { type: 'string' }, description: 'Required for coordinator; defaults to own group for student' },
            { name: 'sprintId', in: 'query', required: false, schema: { type: 'string' } },
            { name: 'status', in: 'query', required: false, schema: { type: 'string', enum: ['submitted', 'reviewed', 'accepted', 'rejected', 'retracted'] } },
            { name: 'page', in: 'query', required: false, schema: { type: 'integer', default: 1 } },
            { name: 'limit', in: 'query', required: false, schema: { type: 'integer', default: 20, maximum: 100 } },
          ],
          responses: {
            200: {
              description: 'Paginated deliverable list',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      groupId: { type: 'string' },
                      total: { type: 'integer' },
                      page: { type: 'integer' },
                      limit: { type: 'integer' },
                      deliverables: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            deliverableId: { type: 'string' },
                            deliverableType: { type: 'string' },
                            sprintId: { type: 'string', nullable: true },
                            status: { type: 'string' },
                            submittedAt: { type: 'string', format: 'date-time' },
                            version: { type: 'integer' },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            403: { description: 'Student querying another group' },
          },
        },
      },
      '/deliverables/{deliverableId}': {
        get: {
          tags: ['Deliverables'],
          summary: 'Get full deliverable details including validation history',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'deliverableId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: {
            200: {
              description: 'Full deliverable record',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      deliverableId: { type: 'string' },
                      groupId: { type: 'string' },
                      committeeId: { type: 'string' },
                      deliverableType: { type: 'string' },
                      sprintId: { type: 'string', nullable: true },
                      version: { type: 'integer' },
                      status: { type: 'string' },
                      submittedAt: { type: 'string', format: 'date-time' },
                      storageRef: { type: 'string' },
                      feedback: { type: 'string', nullable: true },
                      validationHistory: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            step: { type: 'string', enum: ['format_validation', 'deadline_validation', 'storage'] },
                            passed: { type: 'boolean' },
                            checkedAt: { type: 'string', format: 'date-time' },
                            failureReasons: { type: 'array', items: { type: 'string' } },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
            403: { description: 'Student viewing another group deliverable' },
            404: { description: 'Deliverable not found' },
          },
        },
      },
      '/deliverables/validate-group': {
        post: {
          tags: ['Deliverables'],
          summary: 'Process 5.1 — Gate check: active group + committee assigned',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['groupId'],
                  properties: { groupId: { type: 'string', example: 'grp_abc123' } },
                },
              },
            },
          },
          responses: { 200: { description: 'Validation token returned' } },
        },
      },
      '/deliverables/submit': {
        post: {
          tags: ['Deliverables'],
          summary: 'Process 5.2 — Submit deliverable file (multipart/form-data)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'multipart/form-data': {
                schema: {
                  type: 'object',
                  required: ['file', 'groupId', 'deliverableType', 'sprintId'],
                  properties: {
                    file: { type: 'string', format: 'binary' },
                    groupId: { type: 'string', example: 'grp_abc123' },
                    deliverableType: {
                      type: 'string',
                      enum: ['proposal', 'statement_of_work', 'demo', 'interim_report', 'final_report'],
                    },
                    sprintId: { type: 'string', example: 'sprint_1' },
                    description: { type: 'string' },
                  },
                },
              },
            },
          },
          responses: { 202: { description: 'Staging record created, returns stagingId' } },
        },
      },
      '/deliverables/{stagingId}/validate-format': {
        post: {
          tags: ['Deliverables'],
          summary: 'Process 5.3 — Validate staged file format and size',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'stagingId', in: 'path', required: true, schema: { type: 'string', example: 'stg_5e8a9c2f1b' } }],
          responses: {
            200: {
              description: 'Format valid',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      stagingId: { type: 'string' },
                      valid: { type: 'boolean' },
                      format: { type: 'string', enum: ['pdf', 'docx', 'md', 'zip'] },
                      checks: {
                        type: 'object',
                        properties: {
                          formatValid: { type: 'boolean' },
                          sizeValid: { type: 'boolean' },
                          virusScanPassed: { type: 'boolean', nullable: true },
                        },
                      },
                      nextStep: { type: 'string', example: 'deadline_validation' },
                    },
                  },
                },
              },
            },
            400: { description: 'Validation failed — bad format or size exceeded' },
            404: { description: 'Staging record not found or expired' },
          },
        },
      },
      '/deliverables/{stagingId}/validate-deadline': {
        post: {
          tags: ['Deliverables'],
          summary: 'Process 5.4 — Validate submission deadline and team requirements',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'stagingId', in: 'path', required: true, schema: { type: 'string', example: 'stg_5e8a9c2f1b' } }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['sprintId'],
                  properties: {
                    sprintId: { type: 'string', example: 'sprint_1' },
                  },
                },
              },
            },
          },
          responses: {
            200: {
              description: 'Deadline and team requirements met — ready for storage',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      stagingId: { type: 'string', example: 'stg_5e8a9c2f1b' },
                      deadlineOk: { type: 'boolean', example: true },
                      sprintDeadline: { type: 'string', format: 'date-time' },
                      timeRemainingMinutes: { type: 'integer', example: 120 },
                      submissionVersion: { type: 'integer', example: 1 },
                      priorSubmissions: { type: 'integer', example: 0 },
                      readyForStorage: { type: 'boolean', example: true },
                    },
                  },
                },
              },
            },
            400: { description: 'Team requirements not met or deadline not configured' },
            403: { description: 'Deadline exceeded — { code: "DEADLINE_EXCEEDED" }' },
            404: { description: 'Staging record not found or not in format_validated status' },
          },
        },
      },
      '/deliverables/{stagingId}/submit': {
        post: {
          tags: ['Deliverables'],
          summary: 'Process 5.2 — Submit deliverable (finalize staging)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'stagingId', in: 'path', required: true, schema: { type: 'string', example: 'stg_5e8a9c2f1b' } }],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    comment: { type: 'string', description: 'Optional submission comment' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Deliverable submitted successfully' },
            400: { description: 'Validation failed or invalid request' },
            404: { description: 'Staging record not found' },
          },
        },
      },
      '/deliverables/{deliverableId}/retract': {
        delete: {
          tags: ['Deliverables'],
          summary: 'Retract a submitted deliverable',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'deliverableId', in: 'path', required: true, schema: { type: 'string', example: 'del_abc123' } }],
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    reason: { type: 'string', description: 'Reason for retraction' },
                  },
                },
              },
            },
          },
          responses: {
            200: { description: 'Deliverable retracted successfully' },
            400: { description: 'Cannot retract — deadline passed or status prevents retraction' },
            404: { description: 'Deliverable not found' },
          },
        },
      },

      // ── AUDIT LOGS ────────────────────────────────────────────────────────
      '/audit-logs': {
        get: {
          tags: ['Audit Logs'],
          summary: 'Get audit logs (admin/coordinator)',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'groupId',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Filter by group ID',
            },
            {
              name: 'action',
              in: 'query',
              required: false,
              schema: { type: 'string' },
              description: 'Filter by action type',
            },
            {
              name: 'limit',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 50 },
              description: 'Number of logs to return',
            },
            {
              name: 'skip',
              in: 'query',
              required: false,
              schema: { type: 'integer', default: 0 },
              description: 'Number of logs to skip (pagination)',
            },
          ],
          responses: {
            200: {
              description: 'Audit logs retrieved',
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    properties: {
                      logs: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            _id: { type: 'string' },
                            action: { type: 'string' },
                            actorId: { type: 'string' },
                            groupId: { type: 'string' },
                            payload: { type: 'object' },
                            timestamp: { type: 'string', format: 'date-time' },
                          },
                        },
                      },
                      total: { type: 'integer' },
                    },
                  },
                },
              },
            },
            401: { description: 'Unauthorized' },
          },
        },
      },

      // ── SCHEDULE WINDOWS ─────────────────────────────────────────────────
      '/schedule-window': {
        get: {
          tags: ['Schedule Windows'],
          summary: 'List all schedule windows (coordinator/admin)',
          security: [{ bearerAuth: [] }],
          responses: { 200: { description: 'Window list' } },
        },
        post: {
          tags: ['Schedule Windows'],
          summary: 'Create a new schedule window (coordinator/admin)',
          security: [{ bearerAuth: [] }],
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['operationType', 'startDate', 'endDate'],
                  properties: {
                    operationType: { type: 'string', example: 'group_creation' },
                    startDate: { type: 'string', format: 'date-time' },
                    endDate: { type: 'string', format: 'date-time' },
                  },
                },
              },
            },
          },
          responses: { 201: { description: 'Window created' } },
        },
      },
      '/schedule-window/active': {
        get: {
          tags: ['Schedule Windows'],
          summary: 'Check if a schedule window is currently open',
          security: [{ bearerAuth: [] }],
          parameters: [
            {
              name: 'operationType',
              in: 'query',
              required: true,
              schema: { type: 'string', example: 'group_creation' },
            },
          ],
          responses: { 200: { description: 'Window status' } },
        },
      },
      '/schedule-window/{windowId}': {
        delete: {
          tags: ['Schedule Windows'],
          summary: 'Deactivate a schedule window (coordinator/admin)',
          security: [{ bearerAuth: [] }],
          parameters: [{ name: 'windowId', in: 'path', required: true, schema: { type: 'string' } }],
          responses: { 200: { description: 'Deactivated' } },
        },
      },
    },
  },
  apis: [],
};

module.exports = swaggerJsdoc(options);
